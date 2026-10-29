import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {parseReading, panelText, formatValue} from '../lib/readings.js';
import {isHighPower} from '../lib/history.js';

// Test Shell lifecycle and async races with a small, in-memory panel. Real Shell
// imports require a running compositor; the production extension logic is used.
const source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace('export default class', 'return class');

function harness() {
    class Widget {
        constructor(properties = {}) {
            Object.assign(this, properties);
            this.children = [];
            this.clutter_text = {};
            this.visible = true;
            this.classes = new Set();
        }
        add_child(child) { this.children.push(child); }
        add_style_class_name(name) { this.classes.add(name); }
        remove_style_class_name(name) { this.classes.delete(name); }
        destroy() { this.destroyed = true; }
    }
    class Item extends Widget {
        constructor(text) { super(); this.label = new Widget({text}); }
    }
    class Button extends Widget {
        constructor() {
            super();
            this.menu = {items: [], addMenuItem(item) { this.items.push(item); }, addAction() {}, connect() {}};
        }
    }
    class Cancellable {
        cancel() { this.cancelled = true; }
    }
    class AuthenticationError extends Error {}
    const requests = [];
    const clients = [];
    class HistoryStore {
        constructor(origin) { this.origin = origin; this.points = []; this.ready = Promise.resolve(); }
        append(watts) { this.points.push([Date.now(), watts]); }
        close() { this.closed = true; }
    }
    class HistoryChart {
        constructor() { this.sparkline = new Widget(); this.item = new Widget(); }
        setHistory(history) { this.history = history; }
        refresh() {}
        destroy() { this.destroyed = true; }
    }
    class Client {
        constructor(address) { this.origin = `http://${address}`; clients.push(this); }
        read() { return new Promise((resolve, reject) => requests.push({resolve, reject})); }
        destroy() { this.destroyed = true; }
    }
    const timers = new Map();
    let nextTimer = 1;
    const GLib = {
        PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
        timeout_add_seconds(_priority, _interval, callback) {
            const id = nextTimer++;
            timers.set(id, callback);
            return id;
        },
        Source: {remove(id) { assert.ok(timers.delete(id), 'Removing a timer twice'); }},
        DateTime: {new_now_local: () => ({format: () => '12:00:00'})},
    };
    const values = {'device-address': '192.168.30.91', 'refresh-interval': 5};
    const settings = {
        get_string: key => values[key], get_int: key => values[key],
        connect(_signal, callback) { this.callback = callback; return 1; },
        disconnect() { this.disconnected = true; },
    };
    class Extension { getSettings() { return settings; } }
    const ExtensionClass = new Function('Clutter', 'Gio', 'GLib', 'St', 'Extension', 'Main',
        'PanelMenu', 'PopupMenu', 'AuthenticationError', 'ShellyClient', 'formatValue', 'panelText',
        'isHighPower', 'HistoryStore', 'HistoryChart', source)(
        {ActorAlign: {CENTER: 1}}, {Cancellable}, GLib,
        {BoxLayout: Widget, Icon: Widget, Label: Widget}, Extension,
        {panel: {addToStatusArea() {}}}, {Button},
        {PopupMenuItem: Item, PopupBaseMenuItem: Widget, PopupSeparatorMenuItem: Widget},
        AuthenticationError, Client, formatValue, panelText, isHighPower, HistoryStore, HistoryChart);
    const extension = new ExtensionClass();
    extension.enable();
    return {extension, requests, clients, timers, settings, values, AuthenticationError};
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const reading = parseReading({apower: 842, output: true});

test('successful readings update the panel, network failures clear them, disable cleans up', async () => {
    const {extension, requests, timers, settings} = harness();
    await settle();
    requests[0].resolve(reading);
    await settle();
    assert.equal(extension._label.text, '842 W');
    assert.equal(extension._power.text, '842 W');
    assert.ok(!extension._button.menu.items.some(item => /energy|total|reset/i.test(item.label?.text ?? '')));
    assert.equal(timers.size, 1);
    extension._refresh(extension._run);
    assert.equal(timers.size, 0);
    await settle();
    requests[1].reject(new Error('Unreachable'));
    await settle();
    assert.equal(extension._label.text, '— W');
    assert.equal(extension._error.label.text, 'Unreachable');
    assert.equal(timers.size, 1);
    const button = extension._button;
    const run = extension._run;
    extension.disable();
    assert.equal(timers.size, 0);
    assert.ok(run.cancellable.cancelled && run.client.destroyed && button.destroyed && settings.disconnected);
});

test('an in-flight response after disable cannot access destroyed UI or add timers', async () => {
    const {extension, requests, timers} = harness();
    await settle();
    extension.disable();
    requests[0].resolve(reading);
    await settle();
    assert.equal(timers.size, 0);
    assert.equal(extension._button, null);
});

test('reconfiguration ignores a stale response from the old device', async () => {
    const {extension, requests, settings, timers} = harness();
    await settle();
    const oldRun = extension._run;
    settings.callback(settings, 'device-address');
    await settle();
    assert.ok(oldRun.stopped && oldRun.cancellable.cancelled);
    requests[1].resolve(reading);
    await settle();
    const text = extension._label.text;
    requests[0].reject(new Error('Old device failed'));
    await settle();
    assert.equal(extension._label.text, text);
    assert.equal(timers.size, 1);
    extension.disable();
});

test('authentication failures pause automatic retries until configuration changes', async () => {
    const {extension, requests, AuthenticationError, timers, settings} = harness();
    await settle();
    requests[0].reject(new AuthenticationError('Wrong password'));
    await settle();
    assert.equal(timers.size, 0);
    assert.ok(extension._run.authBlocked);
    extension._refresh(extension._run);
    assert.equal(requests.length, 1);
    settings.callback(settings, 'credentials-revision');
    await settle();
    assert.equal(requests.length, 2);
    extension.disable();
    requests[1].reject(new Error('Cancelled'));
    await settle();
    assert.equal(timers.size, 0);
});

test('overlapping refreshes are skipped', async () => {
    const {extension, requests} = harness();
    await settle();
    extension._refresh(extension._run);
    assert.equal(requests.length, 1);
    requests[0].resolve(reading);
    await settle();
    assert.equal(extension._label.text, '842 W');
    assert.equal(requests.length, 1);
    extension.disable();
});

test('values above 350 W turn red and recovery removes red styling', async () => {
    const {extension, requests} = harness();
    await settle();
    requests[0].resolve(parseReading({apower: 351}));
    await settle();
    assert.ok(extension._button.classes.has('shelly-high-power'));
    assert.ok(extension._power.classes.has('shelly-high-reading'));
    const history = extension._run.history;
    assert.equal(history.points.at(-1)[1], 351);
    extension._refresh(extension._run);
    await settle();
    requests[1].resolve(parseReading({apower: 350}));
    await settle();
    assert.ok(!extension._button.classes.has('shelly-high-power'));
    assert.ok(!extension._power.classes.has('shelly-high-reading'));
    extension.disable();
    assert.ok(history.closed);
    assert.equal(history.points.at(-1)[1], null);
});

test('switching device addresses keeps separate histories', async () => {
    const {extension, requests, settings, values} = harness();
    await settle();
    requests[0].resolve(reading);
    await settle();
    const first = extension._run.history;
    settings.callback(settings, 'refresh-interval');
    await settle();
    assert.equal(extension._run.history, first, 'An interval change should keep history for the same origin');
    requests[1].resolve(reading);
    await settle();
    values['device-address'] = 'other-device';
    settings.callback(settings, 'device-address');
    await settle();
    const second = extension._run.history;
    assert.notEqual(second, first);
    assert.deepEqual(second.points, []);
    extension.disable();
    requests[2].reject(new Error('Cancelled'));
    await settle();
});
