export const RETENTION_MS = 24 * 60 * 60 * 1000;
// Allow timing jitter around one-second polls while bounding manual refreshes.
export const MIN_SAMPLE_MS = 500;
export const MAX_POINTS = RETENTION_MS / MIN_SAMPLE_MS + 2;
export const HIGH_POWER_WATTS = 350;
export const SPARKLINE_WINDOW_MS = 60 * 1000;
export const CHART_RANGES = [
    {label: '5m', duration: 5 * 60 * 1000, description: '5 minutes'},
    {label: '1h', duration: 60 * 60 * 1000, description: '1 hour'},
    {label: '6h', duration: 6 * 60 * 60 * 1000, description: '6 hours'},
    {label: '24h', duration: RETENTION_MS, description: '24 hours'},
];

export function plotWidth(width) {
    return Math.max(1, width - 4);
}

export function secondsPerPixel(duration, width) {
    return duration / 1000 / plotWidth(width);
}

export function isHighPower(watts) {
    return typeof watts === 'number' && Number.isFinite(watts) && watts > HIGH_POWER_WATTS;
}

export function sanitizePoints(points, now = Date.now()) {
    if (!Array.isArray(points))
        return [];
    return points.filter(point => Array.isArray(point) && point.length === 2 &&
        Number.isFinite(point[0]) && point[0] >= now - RETENTION_MS && point[0] <= now &&
        (point[1] === null || (typeof point[1] === 'number' && Number.isFinite(point[1]))))
        .sort((a, b) => a[0] - b[0])
        .filter((point, index, all) => index === 0 || point[0] > all[index - 1][0])
        .slice(-MAX_POINTS);
}

export class PowerHistory {
    constructor(points = [], now = Date.now()) {
        this.points = sanitizePoints(points, now);
    }

    // Null marks unavailable data. Never draw a line through an outage or sleep.
    append(watts, now = Date.now(), intervalMs = 1000) {
        if (watts !== null && (typeof watts !== 'number' || !Number.isFinite(watts)))
            return false;
        if (this.points.length && now <= this.points.at(-1)[0])
            return false;
        this.points = this.points.filter(point => point[0] >= now - RETENTION_MS);
        const previous = this.points.at(-1);
        if (previous?.[1] === null && watts === null)
            return false;
        if (previous && now <= previous[0])
            return false;
        if (watts !== null && previous && previous[1] !== null) {
            if (now - previous[0] > Math.max(15000, intervalMs * 3))
                this.points.push([now - 1, null]);
            else if (now - previous[0] < MIN_SAMPLE_MS)
                return false;
        }
        this.points.push([now, watts]);
        if (this.points.length > MAX_POINTS)
            this.points.splice(0, this.points.length - MAX_POINTS);
        return true;
    }
}

function ceiling(value) {
    if (value <= 0)
        return 0;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    return [1, 2, 5, 10].find(step => step * magnitude >= value) * magnitude;
}

// Reduce dense data to at most four points per horizontal pixel, retaining the
// extrema in time order so short spikes remain visible in the 24-hour view.
function reduceSegment(segment, start, duration, width) {
    const bins = new Map();
    for (const point of segment) {
        const column = Math.floor((point[0] - start) / duration * plotWidth(width));
        let bin = bins.get(column);
        if (!bin) {
            bin = {first: point, min: point, max: point, last: point};
            bins.set(column, bin);
        }
        bin.last = point;
        if (point[1] < bin.min[1]) bin.min = point;
        if (point[1] > bin.max[1]) bin.max = point;
    }
    return [...bins.values()].flatMap(bin => [...new Set([bin.first, bin.min, bin.max, bin.last])]
        .sort((a, b) => a[0] - b[0]));
}

export function chartSeries(points, now, duration, width = 360) {
    const start = now - duration;
    const segments = [];
    let segment = [];
    let count = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const point of points) {
        if (point[0] < start || point[0] > now)
            continue;
        if (point[1] === null) {
            if (segment.length) segments.push(reduceSegment(segment, start, duration, width));
            segment = [];
            continue;
        }
        segment.push(point);
        count++;
        sum += point[1];
        min = Math.min(min, point[1]);
        max = Math.max(max, point[1]);
    }
    if (segment.length) segments.push(reduceSegment(segment, start, duration, width));
    return {
        start, end: now, duration, segments, count,
        average: count ? sum / count : null,
        peak: count ? max : null,
        lower: count && min < 0 ? -ceiling(-min) : 0,
        upper: count ? Math.max(1, ceiling(Math.max(0, max))) : 1,
    };
}
