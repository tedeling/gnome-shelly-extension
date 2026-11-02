import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {CHART_RANGES, SPARKLINE_WINDOW_MS, chartSeries, secondsPerPixel} from './history.js';
import {drawHistory} from './chartDrawing.js';
import {formatValue} from './readings.js';

function drawingArea(mini, getSeries) {
    const area = new St.DrawingArea({style_class: mini ? 'shelly-sparkline' : 'shelly-chart-canvas'});
    area.connect('repaint', () => {
        const cr = area.get_context();
        try {
            const [width, height] = area.get_surface_size();
            drawHistory(cr, width, height, getSeries(width), mini);
        } finally {
            cr.$dispose();
        }
    });
    return area;
}

export class HistoryChart {
    constructor() {
        this._history = null;
        this._duration = CHART_RANGES[0].duration;
        this._now = Date.now();
        this.sparkline = drawingArea(true, width => chartSeries(this._history?.points ?? [], this._now, SPARKLINE_WINDOW_MS, width));
        this.sparkline.y_align = Clutter.ActorAlign.CENTER;
        this.sparkline.accessible_name = 'Power history over the last minute, about one second per horizontal pixel';
        this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        // GNOME 51 removed vertical; orientation is available since GNOME 48.
        const direction = 'orientation' in St.BoxLayout.prototype
            ? {orientation: Clutter.Orientation.VERTICAL}
            : {vertical: true};
        const box = new St.BoxLayout({...direction, style_class: 'shelly-chart', x_expand: true});
        this.item.add_child(box);
        const header = new St.BoxLayout({style_class: 'shelly-chart-header'});
        header.add_child(new St.Label({text: 'Power history', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        this._buttons = [];
        for (const range of CHART_RANGES) {
            const button = new St.Button({
                label: range.label, toggle_mode: true, checked: range.duration === this._duration,
                can_focus: true, accessible_name: `Show the last ${range.description}`,
                style_class: 'shelly-chart-range',
            });
            button.connect('clicked', () => {
                this._duration = range.duration;
                this.refresh();
            });
            this._buttons.push([range.duration, button]);
            header.add_child(button);
        }
        box.add_child(header);
        this._upper = new St.Label({style_class: 'shelly-chart-axis'});
        box.add_child(this._upper);
        const plot = new St.Widget({layout_manager: new Clutter.BinLayout()});
        this._area = drawingArea(false, width => chartSeries(this._history?.points ?? [], this._now, this._duration, width));
        plot.add_child(this._area);
        this._empty = new St.Label({text: 'Waiting for readings…', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        plot.add_child(this._empty);
        box.add_child(plot);
        this._lower = new St.Label({style_class: 'shelly-chart-axis'});
        box.add_child(this._lower);
        const times = new St.BoxLayout();
        this._start = new St.Label({x_expand: true, style_class: 'shelly-chart-axis'});
        this._end = new St.Label({style_class: 'shelly-chart-axis'});
        times.add_child(this._start);
        times.add_child(this._end);
        box.add_child(times);
        this._scale = new St.Label({style_class: 'shelly-chart-axis'});
        box.add_child(this._scale);
        this._summary = new St.Label({style_class: 'shelly-chart-summary'});
        box.add_child(this._summary);
        box.add_child(new St.Label({text: 'Red above 350 W · gaps mean no readings', style_class: 'shelly-chart-axis'}));
        this._notice = new St.Label({style_class: 'shelly-chart-axis'});
        box.add_child(this._notice);
        this.refresh();
    }

    setHistory(history) {
        this._history = history;
        this.refresh();
    }

    refresh() {
        this._now = Date.now();
        const series = chartSeries(this._history?.points ?? [], this._now, this._duration);
        for (const [duration, button] of this._buttons)
            button.checked = duration === this._duration;
        this._upper.text = formatValue(series.upper, 'W', 0);
        this._lower.text = formatValue(series.lower, 'W', 0);
        const time = timestamp => new Date(timestamp).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
        this._start.text = time(series.start);
        this._end.text = time(series.end);
        const seconds = secondsPerPixel(this._duration, this._area.width || 340);
        const resolution = seconds < 60
            ? formatValue(seconds, 's', 1)
            : formatValue(seconds / 60, 'min', 1);
        this._scale.text = `Horizontal scale: 1 px ≈ ${resolution}`;
        this._empty.visible = !series.count;
        this._empty.text = 'No readings in this period';
        this._summary.text = series.count
            ? `Sample avg ${formatValue(series.average, 'W', 0)} · Peak ${formatValue(series.peak, 'W', 0)}`
            : 'History starts when readings are collected.';
        const range = CHART_RANGES.find(item => item.duration === this._duration);
        this._area.accessible_name = `Power history, last ${range.description}. ${this._summary.text}`;
        this._notice.text = this._history?.error ?? '';
        this._notice.visible = Boolean(this._history?.error);
        this._area.queue_repaint();
        this.sparkline.queue_repaint();
    }

    destroy() {
        this._history = null;
        this.sparkline.destroy();
        this.item.destroy();
    }
}
