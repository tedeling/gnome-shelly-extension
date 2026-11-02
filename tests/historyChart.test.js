import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {CHART_RANGES, SPARKLINE_WINDOW_MS, chartSeries, secondsPerPixel} from '../lib/history.js';
import {formatValue} from '../lib/readings.js';

const source = readFileSync(new URL('../lib/historyChart.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace('export class HistoryChart', 'class HistoryChart');

// Reject the removed constructor property just as GNOME 51 does, while also
// exercising the fallback needed by supported Shell versions before GNOME 48.
function createChart(modern) {
    class Widget {
        constructor(properties = {}) {
            Object.assign(this, properties);
            this.children = [];
        }
        add_child(child) { this.children.push(child); }
        connect() {}
        queue_repaint() {}
        destroy() { this.destroyed = true; }
    }
    class BoxLayout extends Widget {
        constructor(properties = {}) {
            if (modern && 'vertical' in properties)
                throw new Error('No property vertical on StBoxLayout');
            if (!modern && 'orientation' in properties)
                throw new Error('No property orientation on StBoxLayout');
            super(properties);
        }
    }
    if (modern)
        Object.defineProperty(BoxLayout.prototype, 'orientation', {value: 0, writable: true});

    const Chart = new Function('Clutter', 'St', 'PopupMenu', 'CHART_RANGES',
        'SPARKLINE_WINDOW_MS', 'chartSeries', 'secondsPerPixel', 'drawHistory', 'formatValue',
        `${source}\nreturn HistoryChart;`)(
        {ActorAlign: {CENTER: 0}, Orientation: {VERTICAL: 1}, BinLayout: class {}},
        {Widget, BoxLayout, DrawingArea: Widget, Label: Widget, Button: Widget},
        {PopupBaseMenuItem: Widget}, CHART_RANGES, SPARKLINE_WINDOW_MS,
        chartSeries, secondsPerPixel, () => {}, formatValue);
    return new Chart();
}

for (const modern of [false, true]) {
    test(`chart constructs with the ${modern ? 'GNOME 48–51 orientation' : 'GNOME 45–47 vertical'} API`, () => {
        const chart = createChart(modern);
        const box = chart.item.children[0];
        assert.equal(modern ? box.orientation : box.vertical, modern ? 1 : true);
        chart.setHistory({points: [[Date.now() - 1000, 400]]});
        assert.match(chart._summary.text, /400 W/);
        assert.equal(chart._buttons.length, 4);
        chart.destroy();
        assert.ok(chart.item.destroyed && chart.sparkline.destroyed);
    });
}
