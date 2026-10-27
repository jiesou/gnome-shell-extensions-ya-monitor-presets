#!/bin/bash

gnome-extensions pack --podir=po --gettext-domain=ya-monitor-presets@jiesou.github.io --extra-source=monitorConfig.js --extra-source=presetApplier.js --extra-source=rdpHook.js -f
gnome-extensions install ya-monitor-presets@jiesou.github.io.shell-extension.zip -f
echo "Extension installed!"
