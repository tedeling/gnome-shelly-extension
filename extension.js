import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {AuthenticationError, ShellyClient} from './lib/client.js';
import {formatValue, panelText} from './lib/readings.js';
import {isHighPower} from './lib/history.js';
import {HistoryStore} from './lib/historyStore.js';
import {HistoryChart} from './lib/historyChart.js';

export default class ShellyEnergy extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._histories = new Map();
        this._chart = new HistoryChart();
        this._button = new PanelMenu.Button(0.0, 'Shelly Energy');
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        box.add_child(new St.Icon({icon_name: 'thunderbolt-symbolic', style_class: 'system-status-icon'}));
        box.add_child(this._chart.sparkline);
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER, style_class: 'shelly-reading'});
        box.add_child(this._label);
        this._button.add_child(box);

        this._title = new PopupMenu.PopupMenuItem('Shelly Plus Plug S', {reactive: false});
        this._title.label.add_style_class_name('shelly-title');
        this._button.menu.addMenuItem(this._title);
        this._status = new PopupMenu.PopupMenuItem('Connecting…', {reactive: false});
        this._button.menu.addMenuItem(this._status);
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._power = this._addValue('Live power');
        this._voltage = this._addValue('Voltage');
        this._current = this._addValue('Current');
        this._output = this._addValue('Plug output');
        this._updated = new PopupMenu.PopupMenuItem('No readings yet', {reactive: false});
        this._updated.label.add_style_class_name('shelly-detail');
        this._button.menu.addMenuItem(this._updated);
        this._error = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._error.label.clutter_text.line_wrap = true;
        this._error.label.add_style_class_name('shelly-error');
        this._button.menu.addMenuItem(this._error);
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._button.menu.addMenuItem(this._chart.item);
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._button.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._chart.refresh();
        });
        this._button.menu.addAction('Refresh', () => {
            if (this._run) {
                this._run.authBlocked = false;
                this._refresh(this._run);
            }
        });
        this._button.menu.addAction('Settings…', () => this.openPreferences());
        Main.panel.addToStatusArea(this.uuid, this._button, 0, 'right');
        this._settingsId = this._settings.connect('changed', () => this._restart());
        this._restart();
    }

    _addValue(title) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false});
        item.add_child(new St.Label({text: title, x_expand: true}));
        const value = new St.Label({text: '—', style_class: 'shelly-reading'});
        item.add_child(value);
        this._button.menu.addMenuItem(item);
        return value;
    }

    _restart() {
        this._stop();
        const run = {cancellable: new Gio.Cancellable(), timer: 0, busy: false, stopped: false};
        this._run = run;
        this._updated.label.text = 'No readings yet';
        this._render(null);
        this._chart.setHistory(null);
        try {
            run.client = new ShellyClient(this._settings.get_string('device-address'));
            if (!this._histories.has(run.client.origin))
                this._histories.set(run.client.origin, new HistoryStore(run.client.origin, null, this._historyClosing));
            run.history = this._histories.get(run.client.origin);
            this._chart.setHistory(run.history);
            this._title.label.text = `Shelly · ${run.client.origin.replace(/^https?:\/\//, '')}`;
            this._status.label.text = 'Connecting…';
            this._error.visible = false;
            this._refresh(run);
        } catch (error) {
            this._status.label.text = 'Setup needed';
            this._error.label.text = error.message;
            this._error.visible = true;
        }
    }

    async _refresh(run) {
        if (run.stopped || run.busy || run.authBlocked || !run.client)
            return;
        if (run.timer) {
            GLib.Source.remove(run.timer);
            run.timer = 0;
        }
        run.busy = true;
        try {
            await run.history.ready;
            if (run.stopped)
                return;
            run.historyReady = true;
            this._chart.refresh();
            const reading = await run.client.read(run.cancellable);
            if (run.stopped)
                return;
            run.reading = reading;
            run.history.append(reading.powerWatts, this._settings.get_int('refresh-interval') * 1000);
            this._chart.refresh();
            this._render(reading);
            this._status.label.text = 'Connected · local network';
            this._updated.label.text = `Updated at ${GLib.DateTime.new_now_local().format('%X')}`;
            this._error.visible = false;
        } catch (error) {
            if (run.stopped)
                return;
            run.reading = null;
            run.history.append(null, this._settings.get_int('refresh-interval') * 1000);
            this._chart.refresh();
            run.authBlocked = error instanceof AuthenticationError;
            this._render(null);
            this._status.label.text = run.authBlocked ? 'Authentication needed · updates paused' : 'Unavailable · retrying';
            this._error.label.text = error.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.TIMED_OUT)
                ? 'Connection timed out. Check that the Shelly is online and on your network.'
                : error.message;
            this._error.visible = true;
        } finally {
            run.busy = false;
            if (!run.stopped && !run.authBlocked) {
                run.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
                    this._settings.get_int('refresh-interval'), () => {
                        run.timer = 0;
                        this._refresh(run);
                        return GLib.SOURCE_REMOVE;
                    });
            }
        }
    }

    _render(reading) {
        this._label.text = panelText(reading);
        this._button.accessible_name = `Shelly Energy: ${this._label.text}${reading ? '' : ', unavailable'}`;
        this._button[reading ? 'remove_style_class_name' : 'add_style_class_name']('shelly-offline');
        this._button[isHighPower(reading?.powerWatts) ? 'add_style_class_name' : 'remove_style_class_name']('shelly-high-power');
        this._power.text = panelText(reading);
        this._power[isHighPower(reading?.powerWatts) ? 'add_style_class_name' : 'remove_style_class_name']('shelly-high-reading');
        this._voltage.text = formatValue(reading?.voltage, 'V', 1);
        this._current.text = formatValue(reading?.current, 'A', 2);
        this._output.text = reading?.output === null || !reading ? '—' : reading.output ? 'On' : 'Off';
    }

    _stop() {
        if (!this._run)
            return;
        this._run.stopped = true;
        if (this._run.historyReady)
            this._run.history.append(null, this._settings.get_int('refresh-interval') * 1000);
        this._run.cancellable.cancel();
        if (this._run.timer)
            GLib.Source.remove(this._run.timer);
        this._run.client?.destroy();
        this._run = null;
    }

    disable() {
        this._stop();
        this._historyClosing = Promise.all([...this._histories.values()].map(history => history.close()));
        this._histories.clear();
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        this._settingsId = 0;
        this._chart?.destroy();
        this._chart = null;
        this._button?.destroy();
        this._button = null;
        this._settings = null;
        this._label = this._title = this._status = this._error = null;
        this._power = this._voltage = this._current = this._output = this._updated = null;
    }
}
