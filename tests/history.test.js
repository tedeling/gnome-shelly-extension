import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PowerHistory, chartSeries, sanitizePoints, RETENTION_MS, MAX_POINTS, isHighPower,
    CHART_RANGES, SPARKLINE_WINDOW_MS, secondsPerPixel} from '../lib/history.js';
import {CHART_COLORS} from '../lib/chartDrawing.js';

const now = 1800000000000;

test('the screenshot palette and strictly greater than 350 W threshold are used', () => {
    assert.deepEqual(CHART_COLORS.normal, [29 / 255, 172 / 255, 214 / 255]);
    assert.deepEqual(CHART_COLORS.high, [214 / 255, 29 / 255, 29 / 255]);
    for (const watts of [0, 349, 350, null, undefined, NaN])
        assert.equal(isHighPower(watts), false);
    assert.equal(isHighPower(350.01), true);
});

test('history retains watts and separates outages and sleep into segments', () => {
    const history = new PowerHistory([], now);
    history.append(120, now - 120000);
    history.append(300, now - 115000);
    history.append(null, now - 110000);
    history.append(null, now - 105000);
    history.append(420, now - 100000);
    history.append(50, now); // Long sleep without a poll must also create a gap.
    const series = chartSeries(history.points, now, 3600000);
    assert.equal(series.segments.length, 3);
    assert.equal(series.count, 4);
    assert.equal(series.peak, 420);
    assert.equal(series.average, 222.5);
    assert.equal(series.upper, 500);
    assert.equal(series.lower, 0);
});

test('invalid, old, future, duplicate, or out-of-order saved samples are sanitized', () => {
    const points = sanitizePoints([
        [now - 10, 200], [now - 20, 100], [now - 20, 999],
        [now - RETENTION_MS - 1, 1], [now + 1, 1], [now, Infinity],
        [now, '2'], null, [], [now, null],
    ], now);
    assert.deepEqual(points, [[now - 20, 100], [now - 10, 200], [now, null]]);
});

test('history is bounded and rapid manual refresh cannot flood storage', () => {
    const history = new PowerHistory([], now);
    assert.ok(history.append(10, now));
    assert.equal(history.append(20, now + 100), false);
    assert.equal(history.append(20, now - 1), false);
    assert.equal(history.append(NaN, now + 2000), false);
    assert.ok(history.append(30, now + 2000));
    history.append(40, now + RETENTION_MS + 5000);
    assert.ok(history.points.every(point => point[0] >= now + 5000));
    const excessive = Array.from({length: MAX_POINTS + 100}, (_, i) => [now - MAX_POINTS - 100 + i, i]);
    assert.equal(sanitizePoints(excessive, now).length, MAX_POINTS);
});

test('live chart uses one minute at one second per pixel and accepts one-second samples with jitter', () => {
    assert.equal(SPARKLINE_WINDOW_MS, 60000);
    assert.equal(secondsPerPixel(SPARKLINE_WINDOW_MS, 64), 1);
    assert.ok(Math.abs(secondsPerPixel(CHART_RANGES[0].duration, 340) - 0.893) < 0.001);
    const history = new PowerHistory([], now);
    for (const offset of [-4000, -3005, -2010, -1000, 0])
        assert.ok(history.append(200, now + offset, 1000));
    assert.equal(history.points.length, 5);
});

test('time window and downsampling keep short peaks visible without joining gaps', () => {
    const points = Array.from({length: 10000}, (_, index) => [now - 10000 + index, index === 5000 ? 2000 : 20]);
    const series = chartSeries(points, now, 10000, 64);
    assert.equal(series.count, 10000);
    assert.ok(series.segments[0].some(point => point[1] === 2000));
    assert.ok(series.segments[0].length <= 64 * 4);
    const shorter = chartSeries(points, now, 1000);
    assert.equal(shorter.count, 1000);
    assert.equal(shorter.peak, 20);
});

test('empty, zero, negative, and one-point charts have valid scales', () => {
    for (const watts of [null, 0, -20, 200, 1000]) {
        const series = chartSeries([[now, watts]], now, 3600000);
        assert.ok(series.upper > series.lower);
        if (watts !== null) {
            assert.ok(series.upper >= watts && series.lower <= watts);
            assert.equal(series.count, 1);
        } else {
            assert.equal(series.count, 0);
        }
    }
});
