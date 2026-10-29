import Cairo from 'cairo';
import GLib from 'gi://GLib';
import {chartSeries, SPARKLINE_WINDOW_MS} from '../lib/history.js';
import {drawHistory} from '../lib/chartDrawing.js';

const now = Date.now();
const duration = 3600000;
const points = [];
for (let index = 0; index <= 360; index++) {
    const watts = 160 + Math.sin(index / 23) * 70 +
        (index > 110 && index < 180 ? 270 : 0) + (index > 290 ? 130 : 0);
    points.push([now - duration + index * 10000, index >= 235 && index <= 255 ? null : watts]);
}

const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 380, 220);
const cr = new Cairo.Context(surface);
cr.setSourceRGB(0.0745, 0.0745, 0.0745);
cr.paint();
cr.save();
cr.translate(20, 15);
drawHistory(cr, 340, 130, chartSeries(points, now, duration, 340));
cr.restore();
cr.save();
cr.translate(20, 175);
const livePoints = Array.from({length: 61}, (_, index) => [now - SPARKLINE_WINDOW_MS + index * 1000,
    180 + 60 * Math.sin(index / 7) + (index > 30 && index < 40 ? 230 : 0)]);
drawHistory(cr, 64, 22, chartSeries(livePoints, now, SPARKLINE_WINDOW_MS, 64), true);
cr.restore();
const path = ARGV[0] ?? GLib.build_filenamev([GLib.get_tmp_dir(), 'shelly-chart-preview.png']);
surface.writeToPNG(path);
cr.$dispose();
print(`Cairo chart rendered: ${path}`);
