import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {HistoryStore} from '../lib/historyStore.js';

function assert(value, message) {
    if (!value) throw new Error(message);
}

const directory = GLib.dir_make_tmp('shelly-history-test-XXXXXX');
const origin = 'http://192.168.30.91';
const key = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, origin, -1);
const path = GLib.build_filenamev([directory, `${key}.json`]);
const now = Date.now();
const file = Gio.File.new_for_path(path);
try {
    const store = new HistoryStore(origin, directory);
    await store.ready;
    assert(store.points.length === 0, 'First run should start with empty history');
    store.append(200, 5000, now - 10000);
    store.append(500, 5000, now - 5000);
    const saving = store.flush();
    store.append(300, 5000, now);
    await store.close();
    await saving;
    assert(store.error === null, `Save failed: ${store.error}`);
    const [, contents] = file.load_contents(null);
    const saved = JSON.parse(new TextDecoder().decode(contents));
    assert(saved.points.length === 3 && saved.points.at(-1)[1] === 300, 'A concurrent close must persist the latest sample');
    const info = file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
    assert((info.get_attribute_uint32('unix::mode') & 0o777) === 0o600, 'History must be private');

    const reopened = new HistoryStore(origin, directory);
    await reopened.ready;
    assert(reopened.points.filter(point => point[1] !== null).length === 3, 'History should survive a restart');
    assert(reopened.points.at(-1)[1] === null, 'A new recording session should create a gap');
    await reopened.close();

    const other = new HistoryStore('http://another-device', directory);
    await other.ready;
    assert(other.points.length === 0, 'Devices must not share history');
    await other.close();

    GLib.file_set_contents(path, '{corrupted');
    const corrupt = new HistoryStore(origin, directory);
    await corrupt.ready;
    assert(corrupt.error !== null && corrupt.points.length === 0, 'Corrupt history should not stop live collection');
    corrupt.append(100, 5000);
    await corrupt.close();
    assert(corrupt.error === null, 'A successful save should recover corrupt history');

    const invalidDirectory = GLib.build_filenamev([directory, 'not-a-directory']);
    GLib.file_set_contents(invalidDirectory, 'file');
    const unwritable = new HistoryStore(origin, invalidDirectory);
    await unwritable.ready;
    unwritable.append(300, 5000);
    await unwritable.close();
    assert(unwritable.error?.includes('could not be saved'), 'Write errors must be handled without breaking polling');
    GLib.unlink(invalidDirectory);
    print('GJS history checks passed (persistence, concurrent close, privacy, device separation, corrupt file, write errors).');
} finally {
    GLib.unlink(path);
    GLib.rmdir(directory);
}
