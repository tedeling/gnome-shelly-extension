import {HIGH_POWER_WATTS, isHighPower, plotWidth} from './history.js';

// Sampled from the user's top-bar reference screenshot.
export const CHART_COLORS = {
    normal: [0x1d / 255, 0xac / 255, 0xd6 / 255],
    high: [0xd6 / 255, 0x1d / 255, 0x1d / 255],
    background: [0x0f / 255, 0x0f / 255, 0x0f / 255],
};

export function drawHistory(cr, width, height, series, mini = false) {
    cr.save();
    cr.rectangle(0, 0, width, height);
    cr.clip();
    const color = (rgb, alpha = 1) => cr.setSourceRGBA(...rgb, alpha);
    const x = point => 2 + (point[0] - series.start) / series.duration * plotWidth(width);
    const y = watts => 2 + (series.upper - watts) / (series.upper - series.lower) * Math.max(1, height - 4);
    const thresholdY = Math.max(0, Math.min(height, y(HIGH_POWER_WATTS)));

    color(CHART_COLORS.background);
    cr.paint();
    if (!mini) {
        cr.setSourceRGBA(1, 1, 1, 0.08);
        cr.setLineWidth(1);
        for (const fraction of [0, 0.5, 1]) {
            const yy = 2 + (height - 4) * fraction;
            cr.moveTo(0, yy);
            cr.lineTo(width, yy);
        }
        cr.stroke();
    }

    for (const segment of series.segments) {
        if (segment.length > 1) {
            for (const [rgb, top, bottom] of [
                [CHART_COLORS.normal, thresholdY, height],
                [CHART_COLORS.high, 0, thresholdY],
            ]) {
                cr.save();
                cr.rectangle(0, top, width, bottom - top);
                cr.clip();
                cr.moveTo(x(segment[0]), y(0));
                for (const point of segment) cr.lineTo(x(point), y(point[1]));
                cr.lineTo(x(segment.at(-1)), y(0));
                cr.closePath();
                color(rgb, mini ? 0.8 : 0.25);
                cr.fill();
                cr.restore();
            }
        }

        cr.setLineWidth(mini ? 1.3 : 2);
        if (segment.length === 1) {
            const point = segment[0];
            color(isHighPower(point[1]) ? CHART_COLORS.high : CHART_COLORS.normal);
            cr.arc(x(point), y(point[1]), mini ? 1 : 2, 0, 2 * Math.PI);
            cr.fill();
        }
        for (let index = 1; index < segment.length; index++) {
            const a = segment[index - 1];
            const b = segment[index];
            const parts = [a];
            if (isHighPower(a[1]) !== isHighPower(b[1])) {
                const fraction = (HIGH_POWER_WATTS - a[1]) / (b[1] - a[1]);
                parts.push([a[0] + (b[0] - a[0]) * fraction, HIGH_POWER_WATTS]);
            }
            parts.push(b);
            for (let part = 1; part < parts.length; part++) {
                const from = parts[part - 1];
                const to = parts[part];
                color(isHighPower((from[1] + to[1]) / 2) ? CHART_COLORS.high : CHART_COLORS.normal);
                cr.moveTo(x(from), y(from[1]));
                cr.lineTo(x(to), y(to[1]));
                cr.stroke();
            }
        }
    }
    if (!mini && HIGH_POWER_WATTS < series.upper && HIGH_POWER_WATTS > series.lower) {
        color(CHART_COLORS.high, 0.55);
        cr.setLineWidth(1);
        cr.setDash([3, 4], 0);
        cr.moveTo(0, thresholdY);
        cr.lineTo(width, thresholdY);
        cr.stroke();
        cr.setDash([], 0);
    }
    cr.restore();
}
