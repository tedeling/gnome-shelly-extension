UUID := shelly-energy@local
BUNDLE := dist/$(UUID).shell-extension.zip

.PHONY: all check pack install dev clean

all: pack

check:
	glib-compile-schemas --strict --dry-run schemas
	node --test tests/*.test.js
	@for file in extension.js prefs.js lib/*.js; do node --check "$$file" || exit 1; done
	gjs -m tests/client.js
	gjs -m tests/historyStore.js
	gjs -m tests/chartDrawing.js

pack:
	@mkdir -p dist
	gnome-extensions pack --force --out-dir=dist --extra-source=lib .

install: pack
	gnome-extensions install --force $(BUNDLE)
	@printf '\nInstalled. Log out and back in if GNOME has not discovered it yet, then run:\n  gnome-extensions enable $(UUID)\n  gnome-extensions prefs $(UUID)\n'

dev: pack
	bash scripts/dev.sh

clean:
	rm -rf dist
