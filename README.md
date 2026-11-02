# Shelly Energy for GNOME

Shows a Shelly Plus Plug S’s **live power in watts** and a small **one-minute history sparkline** in the GNOME top bar:

```text
ϟ ▂▃▆▅▃▂ 284 W
```

Click the indicator for a larger chart with **5-minute, 1-hour, 6-hour, and 24-hour** views, voltage, current, plug output status, the last successful update time, Refresh, and Settings. The chart initially shows five minutes. Readings refresh about once per second by default, plus the device's response time. You can change the polling interval in Settings. Unavailable readings display `—`, with an explanation in the menu; network errors retry automatically. The extension only reads measurements and never switches the plug or resets its counters.

The initial device address is **192.168.30.91**. Change it in Settings to your own plug’s IP address or hostname. Power is rounded to whole watts; accumulated energy is not displayed.

The chart uses **teal `#1dacd6`**, **red `#d61d1d`**, and a **dark `#0f0f0f`** background. The live watt value and icon turn red when the actual reading is **greater than 350 W**; exactly 350 W stays teal. Chart lines and filled areas above that threshold are red, with a dotted 350 W reference line in the larger chart.

## History

History starts when this version of the extension runs; earlier usage is not fetched from the plug. Samples come from the same periodic readings as the live watt display. The chart preserves short peaks when compressing a large time range, and shows gaps during connection failures, sleep, or periods when the extension was disabled. Its summary shows the average of the recorded samples and the highest recorded watt value in the selected period.

Horizontal pixels represent time. The 64-pixel top-bar chart has 60 usable pixels after padding, so its one-minute window spans **1 second per pixel**. The larger chart has 336 usable pixels: approximately **0.9 seconds per pixel** at 5 minutes, **10.7 seconds** at 1 hour, **64.3 seconds** at 6 hours, and **4.3 minutes** at 24 hours. The selected horizontal scale appears below the chart. These are logical pixels; display scaling can change the physical pixel count. Vertical pixels represent watts and auto-scale to the visible readings; the top and bottom labels show the watt range.

Up to 24 hours of readings are kept separately for each device address in `$XDG_STATE_HOME/shelly-energy/` (normally `~/.local/state/shelly-energy/`). Files have private permissions and contain only sample times and watts. Saves run asynchronously about once a minute and when the extension is disabled. An abrupt crash may lose the most recent minute. Saved history is restored when the extension starts again; only samples from the last 24 hours are shown. A history file or storage error is displayed below the chart and does not stop live readings.

No data is recorded while GNOME is logged out, the computer is asleep, or the extension is disabled. Uninstalling the extension leaves saved history in place; delete the directory above if you want to remove it too.

## Install

Requires GNOME Shell 45–51, GJS, libsoup 3, libadwaita, and libsecret introspection bindings. Ubuntu’s GNOME desktop normally includes these; if needed:

```sh
sudo apt install gnome-shell gjs gir1.2-soup-3.0 gir1.2-adw-1 gir1.2-secret-1 libglib2.0-bin
```

Clone the repository and install the extension:

```sh
git clone https://github.com/tedeling/gnome-shelly-extension.git
cd gnome-shelly-extension
make install
```

After the first installation, **log out and back in** so GNOME discovers the extension. Then:

```sh
gnome-extensions enable shelly-energy@local
gnome-extensions prefs shelly-energy@local
```

You can also enable it using GNOME Extensions or Extension Manager. When updating an already loaded version, log out and back in to reload its JavaScript.

### First installation without logging out (GNOME 50)

After `make install`, you can register the new extension with the running Shell using Looking Glass instead of logging out. Press **Alt+F2**, enter `lg`, and press Enter. Paste the following into its evaluator and press Enter:

```js
const m = Main.extensionManager; const u = 'shelly-energy@local'; if (!m.lookup(u)) await m.loadExtension(m.createExtensionObject(u, Gio.File.new_for_path(global.userdatadir + '/extensions/' + u), 2)); m.enableExtension(u)
```

Press Escape to close Looking Glass. This uses the extension manager APIs in the installed GNOME 50 Shell source. It registers a fresh installation; it does not reload changed JavaScript for a version already imported into the running Shell.

### Restoring the extension after a GNOME upgrade

GNOME disables extensions whose metadata does not list its new major version. Install the latest build with `make install`, then enable it with `gnome-extensions enable shelly-energy@local`. Version 5 adds GNOME 51 compatibility and replaces the chart layout property removed in that release, while retaining compatibility with older supported versions.

If the extension was rejected as out of date and has not been imported in the current session, it can be loaded without logging out. After installing the updated build, open Looking Glass with **Alt+F2**, `lg`, and run:

```js
const m = Main.extensionManager; const u = 'shelly-energy@local'; const e = m.lookup(u); if (e?.isImported) throw new Error('Log out and back in to load changed code'); if (e) await m.reloadExtension(e); else await m.loadExtension(m.createExtensionObject(u, Gio.File.new_for_path(global.userdatadir + '/extensions/' + u), 2)); m.enableExtension(u)
```

Press Escape to close Looking Glass. If JavaScript was already imported, log out and back in to load the updated code. Device settings, keyring passwords, and saved history are retained by an ordinary reinstall.

`make pack` creates `dist/shelly-energy@local.shell-extension.zip` for installation with `gnome-extensions install --force FILE`. Build/install require `make` and `gnome-extensions`; Node.js is only used for developer checks. No npm dependencies are needed.

## Device setup

- Connect the computer and plug to a network where they can reach each other. Use a DHCP reservation to keep the plug’s IP stable.
- Open Settings from the indicator and enter the address, then press Enter or the checkmark. Hostnames, optional ports, and HTTP/HTTPS origins are accepted. The device’s local web interface must be reachable; Shelly Cloud is not needed.
- If device authentication is enabled, enter its password and click Save. The username is `admin`. The password is stored per address in the desktop’s login keyring, not in GSettings or the extension’s files. No password is needed for an unprotected plug. After an authentication failure, polling pauses until you update settings or click Refresh, avoiding repeated failed logins.

The live reading uses the device’s `apower` value directly in watts. Values use your locale’s number formatting.

The extension uses the read-only [`Switch.GetStatus?id=0` API](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Switch/#switchgetstatus) for the [Shelly Plus Plug S](https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen2/ShellyPlusPlugS/) and supports its [SHA-256 HTTP authentication](https://shelly-api-docs.shelly.cloud/gen2/General/Authentication/). Other metering devices exposing the same API may work; Gen1 devices and EM/3EM meters use different APIs and are not supported.

## Development and troubleshooting

For day-to-day development, preview the extension in a separate GNOME desktop window. On Ubuntu with GNOME 49 or later, install the development kit once:

```sh
sudo apt install mutter-dev-bin
```

Then run:

```sh
make dev
```

The preview starts with this project's extension already enabled. Look at its top-right watt indicator and click it to open the history chart. After changing code, close the preview and rerun `make dev`; your main desktop stays running. GNOME 49+ uses `--devkit`, while earlier supported versions use `--nested`, following the [GNOME development workflow](https://gjs.guide/extensions/development/debugging.html#running-a-nested-gnome-shell).

The preview uses temporary extension files and settings, with history kept in this project's ignored `.dev-state/` directory so it survives preview restarts. It reads the plug at the configured address, which initially defaults to `192.168.30.91`.

```sh
make check       # schemas, readings, auth, history, lifecycle, persistence, Cairo rendering
make pack        # installable bundle
journalctl --user -b -o cat | rg -i 'shelly|JS ERROR'
```

Tests use simulated responses; a real plug and a running GNOME session are needed for an end-to-end check. To inspect the plug directly from your own computer:

```sh
curl --max-time 8 'http://192.168.30.91/rpc/Switch.GetStatus?id=0'
# If authentication is enabled (curl prompts for the password):
curl --digest --user admin --max-time 8 'http://192.168.30.91/rpc/Switch.GetStatus?id=0'
```

GNOME 45–51 are declared compatible. Automated runtime checks have used GJS and libraries installed with GNOME 50 and 51; chart construction tests cover both the legacy and current layout APIs. Live Shell UI and device connection checks require a desktop session. To uninstall:

```sh
gnome-extensions disable shelly-energy@local
gnome-extensions uninstall shelly-energy@local
```

Use Remove in Settings first if you also want to delete a saved device password.
