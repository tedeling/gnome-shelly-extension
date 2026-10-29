import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {PowerHistory} from './history.js';

export class HistoryStore {
    constructor(origin, directory = null, previousClose = Promise.resolve()) {
        const directoryPath = directory ?? GLib.build_filenamev([GLib.get_user_state_dir(), 'shelly-energy']);
        const key = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, origin, -1);
        this._directory = directoryPath;
        this._file = Gio.File.new_for_path(GLib.build_filenamev([directoryPath, `${key}.json`]));
        this._history = new PowerHistory();
        this._timer = 0;
        this._revision = 0;
        this._savedRevision = 0;
        this._writing = null;
        this._closed = false;
        this.error = null;
        this.ready = previousClose.then(() => this._load());
    }

    get points() {
        return this._history.points;
    }

    async _load() {
        try {
            const contents = await new Promise((resolve, reject) => {
                this._file.load_contents_async(null, (file, result) => {
                    try {
                        const [, data] = file.load_contents_finish(result);
                        resolve(data);
                    } catch (error) { reject(error); }
                });
            });
            const data = JSON.parse(new TextDecoder().decode(contents));
            if (data.version !== 1 || !Array.isArray(data.points))
                throw new Error('Invalid history file.');
            this._history = new PowerHistory(data.points);
            // A new extension session is a new recording period.
            this._history.append(null);
        } catch (error) {
            if (!error.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND))
                this.error = 'Previous history could not be loaded.';
        }
    }

    append(watts, intervalMs, now = Date.now()) {
        if (this._closed || !this._history.append(watts, now, intervalMs))
            return;
        this._revision++;
        if (!this._timer) {
            this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
                this._timer = 0;
                this.flush();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    // Serialize writes. A disable during an in-flight save must still persist
    // the final samples, rather than letting an older snapshot win the race.
    async flush() {
        await this.ready;
        if (this._writing) {
            await this._writing;
            if (this._revision !== this._savedRevision)
                return this.flush();
            return;
        }
        if (this._revision === this._savedRevision)
            return;
        const revision = this._revision;
        this._writing = this._save();
        const success = await this._writing;
        if (success)
            this._savedRevision = revision;
        this._writing = null;
    }

    async _save() {
        try {
            if (GLib.mkdir_with_parents(this._directory, 0o700) !== 0)
                throw new Error('Could not create history directory.');
            const json = JSON.stringify({version: 1, points: this.points});
            const bytes = new GLib.Bytes(new TextEncoder().encode(json));
            await new Promise((resolve, reject) => {
                this._file.replace_contents_bytes_async(bytes, null, false,
                    Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null, (file, result) => {
                        try { file.replace_contents_finish(result); resolve(); } catch (error) { reject(error); }
                    });
            });
            this.error = null;
            return true;
        } catch {
            this.error = 'History could not be saved. Live readings still work.';
            return false;
        }
    }

    async close() {
        this._closed = true;
        if (this._timer) {
            GLib.Source.remove(this._timer);
            this._timer = 0;
        }
        await this.flush();
    }
}
