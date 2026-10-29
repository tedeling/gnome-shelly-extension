import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {normalizeAddress} from './lib/address.js';
import {clearPassword, savePassword} from './lib/secrets.js';

export default class ShellyPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(600, 620);
        const page = new Adw.PreferencesPage({title: 'Shelly Energy', icon_name: 'thunderbolt-symbolic'});
        window.add(page);
        const device = new Adw.PreferencesGroup({
            title: 'Shelly Plus Plug S',
            description: 'Read live power in watts directly from your plug on the local network.',
        });
        page.add(device);
        const address = new Adw.EntryRow({
            title: 'IP address or hostname',
            text: settings.get_string('device-address'),
            show_apply_button: true,
        });
        device.add(address);
        const addressStatus = new Adw.ActionRow({
            title: 'Device address', subtitle: 'Press Enter or the checkmark to apply an address change.',
        });
        device.add(addressStatus);
        address.connect('apply', () => {
            try {
                const origin = normalizeAddress(address.text);
                settings.set_string('device-address', origin);
                address.remove_css_class('error');
                addressStatus.subtitle = `Using ${origin}`;
            } catch (error) {
                address.add_css_class('error');
                addressStatus.subtitle = error.message;
            }
        });

        const display = new Adw.PreferencesGroup({title: 'Top bar'});
        page.add(display);
        const interval = new Adw.SpinRow({
            title: 'Refresh interval', subtitle: 'Seconds between readings',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 300, step_increment: 1, page_increment: 5}),
            digits: 0,
        });
        settings.bind('refresh-interval', interval, 'value', Gio.SettingsBindFlags.DEFAULT);
        display.add(interval);
        display.add(new Adw.ActionRow({
            title: 'Teal up to 350 W · red above 350 W',
            subtitle: 'The top bar shows the last minute: about 1 second per pixel. Open the menu for 5-minute to 24-hour charts.',
        }));
        display.add(new Adw.ActionRow({
            title: 'History is saved locally for 24 hours',
            subtitle: 'Recording starts while the extension is running. Missing readings appear as gaps.',
        }));

        const auth = new Adw.PreferencesGroup({
            title: 'Device password (optional)',
            description: 'Only needed when authentication is enabled on the plug. The username is admin. Passwords are saved in your login keyring.',
        });
        page.add(auth);
        const password = new Adw.PasswordEntryRow({title: 'Device password'});
        auth.add(password);
        const actions = new Adw.ActionRow({title: 'Password for this address', subtitle: 'Leave empty for a plug without authentication.'});
        const save = new Gtk.Button({label: 'Save', valign: Gtk.Align.CENTER});
        const remove = new Gtk.Button({label: 'Remove', valign: Gtk.Align.CENTER});
        actions.add_suffix(remove);
        actions.add_suffix(save);
        auth.add(actions);

        const cancellable = new Gio.Cancellable();
        window.connect('close-request', () => {
            cancellable.cancel();
            return false;
        });
        const updatePassword = async shouldRemove => {
            save.sensitive = remove.sensitive = false;
            try {
                // Do not silently save a password against an unapplied address.
                const origin = normalizeAddress(address.text);
                if (origin !== normalizeAddress(settings.get_string('device-address')))
                    throw new Error('Apply the device address before saving a password.');
                if (!shouldRemove && !password.text)
                    throw new Error('Enter a password first, or use Remove.');
                if (shouldRemove)
                    await clearPassword(origin, cancellable);
                else
                    await savePassword(origin, password.text, cancellable);
                if (cancellable.is_cancelled())
                    return;
                password.text = '';
                settings.set_uint('credentials-revision', (settings.get_uint('credentials-revision') + 1) >>> 0);
                actions.subtitle = shouldRemove ? 'Saved password removed.' : 'Password saved in your login keyring.';
            } catch (error) {
                if (!cancellable.is_cancelled())
                    actions.subtitle = `Could not update password: ${error.message}`;
            } finally {
                if (!cancellable.is_cancelled())
                    save.sensitive = remove.sensitive = true;
            }
        };
        save.connect('clicked', () => updatePassword(false));
        remove.connect('clicked', () => updatePassword(true));
    }
}
