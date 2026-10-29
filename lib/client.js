import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {normalizeAddress} from './address.js';
import {digestAuthorization} from './digest.js';
import {parseReading} from './readings.js';
import {lookupPassword} from './secrets.js';

const STATUS_PATH = '/rpc/Switch.GetStatus?id=0';

export class AuthenticationError extends Error {}

export class ShellyClient {
    constructor(address, passwordLookup = lookupPassword) {
        this.origin = normalizeAddress(address);
        this._passwordLookup = passwordLookup;
        this._session = new Soup.Session({timeout: 8, user_agent: 'ShellyEnergy/1.0'});
        // A device must not send us to another host (or forward credentials).
        this._session.proxy_resolver = new Gio.SimpleProxyResolver({default_proxy: null});
    }

    async read(cancellable) {
        let response = await this._request(cancellable);
        if (response.status === 401) {
            let password;
            try {
                password = await this._passwordLookup(this.origin, cancellable);
            } catch (error) {
                if (cancellable.is_cancelled())
                    throw error;
                throw new AuthenticationError('Unlock your login keyring, then click Refresh.');
            }
            if (cancellable.is_cancelled())
                throw new Error('Request cancelled.');
            if (!password)
                throw new AuthenticationError('Save the Shelly device password in Settings.');
            const sha256 = value => GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, value, -1);
            let authorization;
            try {
                authorization = digestAuthorization(response.challenge, password,
                    GLib.uuid_string_random().replaceAll('-', ''), sha256, STATUS_PATH);
            } catch (error) {
                throw new AuthenticationError(error.message);
            }
            response = await this._request(cancellable, authorization);
        }
        if (response.status === 401 || response.status === 403)
            throw new AuthenticationError('Authentication failed. Check the device password in Settings.');
        if (response.status === 429)
            throw new AuthenticationError('The device is rate limiting requests. Wait, then click Refresh.');
        if (response.status !== 200)
            throw new Error(`The device returned HTTP ${response.status}. Check the address in Settings.`);
        let status;
        try {
            status = JSON.parse(response.body);
        } catch {
            throw new Error('The device returned invalid JSON. Check that this is a Shelly Plus Plug S.');
        }
        return parseReading(status);
    }

    _request(cancellable, authorization = null) {
        const message = Soup.Message.new('GET', `${this.origin}${STATUS_PATH}`);
        message.set_flags(Soup.MessageFlags.NO_REDIRECT);
        // We handle Shelly's SHA-256 challenge explicitly, with one retry.
        message.connect('authenticate', (_message, auth) => {
            auth.cancel();
            return true;
        });
        if (authorization)
            message.request_headers.replace('Authorization', authorization);

        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        resolve({
                            status: message.status_code,
                            challenge: message.response_headers.get_one('WWW-Authenticate'),
                            body: new TextDecoder().decode(bytes.get_data()),
                        });
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    }

    destroy() {
        this._session.abort();
    }
}
