#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
bundle="$project_dir/dist/shelly-energy@local.shell-extension.zip"
uuid='shelly-energy@local'

for tool in gnome-shell dbus-run-session unzip glib-compile-schemas; do
    if ! command -v "$tool" >/dev/null; then
        printf 'Missing development tool: %s\n' "$tool" >&2
        exit 1
    fi
done

shell_version="$(gnome-shell --version)"
if [[ ! "$shell_version" =~ ([0-9]+)\. ]]; then
    printf 'Could not determine the GNOME Shell version: %s\n' "$shell_version" >&2
    exit 1
fi
shell_major="${BASH_REMATCH[1]}"
if (( shell_major >= 49 )); then
    backend='--devkit'
    if [[ ! -x /usr/libexec/mutter-devkit ]] && ! command -v mutter-devkit >/dev/null; then
        printf 'GNOME %s needs the Mutter development kit. On Ubuntu, install it once:\n  sudo apt install mutter-dev-bin\n' "$shell_major" >&2
        exit 1
    fi
else
    backend='--nested'
fi

dev_root="$(mktemp -d "${TMPDIR:-/tmp}/shelly-energy-dev.XXXXXX")"
trap 'rm -rf -- "$dev_root"' EXIT

# Keep the preview's installed files and settings separate from the main desktop.
export XDG_DATA_HOME="$dev_root/data"
export XDG_CONFIG_HOME="$dev_root/config"
export XDG_CACHE_HOME="$dev_root/cache"
export XDG_STATE_HOME="$project_dir/.dev-state"
export GSETTINGS_BACKEND=keyfile
export GNOME_SHELL_SESSION_MODE=user

extension_dir="$XDG_DATA_HOME/gnome-shell/extensions/$uuid"
mkdir -p -- "$extension_dir" "$XDG_CONFIG_HOME/glib-2.0/settings" "$XDG_CACHE_HOME"
mkdir -m 700 -p -- "$XDG_STATE_HOME"
unzip -q "$bundle" -d "$extension_dir"
glib-compile-schemas --strict "$extension_dir/schemas"
cat > "$XDG_CONFIG_HOME/glib-2.0/settings/keyfile" <<'EOF'
[org/gnome/shell]
enabled-extensions=['shelly-energy@local']
disable-user-extensions=false
EOF

printf 'Opening a GNOME preview window with Shelly Energy enabled.\n'
printf 'Click the watt indicator at the top right to see its chart.\n'
printf 'After an edit, close the preview and run make dev again.\n'
dbus-run-session -- gnome-shell "$backend" --wayland --mode=user \
    --wayland-display="shelly-dev-$BASHPID"
