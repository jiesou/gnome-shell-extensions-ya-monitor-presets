/* monitorConfig.js
 *
 * Copyright (c) 2026 jiesou
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DISPLAY_CONFIG_BUS_NAME = 'org.gnome.Mutter.DisplayConfig';
const DISPLAY_CONFIG_OBJECT_PATH = '/org/gnome/Mutter/DisplayConfig';

const LOGICAL_MONITORS_TYPE = 'a(iiduba(ssa{sv}))';
const APPLY_TYPE = `(uu${LOGICAL_MONITORS_TYPE}a{sv})`;
const PRESETS_TYPE = `a(ss${LOGICAL_MONITORS_TYPE})`;

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

function callDisplayConfig(method, parameters = null) {
    return Gio.DBus.session.call(
        DISPLAY_CONFIG_BUS_NAME,
        DISPLAY_CONFIG_OBJECT_PATH,
        DISPLAY_CONFIG_BUS_NAME,
        method,
        parameters,
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null
    );
}

export function subscribeMonitorsChanged(callback) {
    return Gio.DBus.session.signal_subscribe(
        null,
        DISPLAY_CONFIG_BUS_NAME,
        'MonitorsChanged',
        DISPLAY_CONFIG_OBJECT_PATH,
        null,
        Gio.DBusSignalFlags.NONE,
        callback
    );
}

export async function getDisplayState() {
    const [, monitors, logicalMonitors] =
        (await callDisplayConfig('GetCurrentState')).recursiveUnpack();

    const activeModes = new Map();
    for (const [spec, modes] of monitors) {
        const connector = spec[0];
        for (const mode of modes) {
            const [modeId, , , , , , properties] = mode;
            if (properties?.['is-current']) {
                activeModes.set(connector, modeId);
                break;
            }
        }
    }

    return logicalMonitors.map(logicalMonitor => {
        const [x, y, scale, transform, isPrimary, connectedMonitors] = logicalMonitor;
        const monitorsForApply = connectedMonitors.map(([connector]) => [
            connector,
            activeModes.get(connector) ?? 'preferred',
            {},
        ]);
        return [x, y, scale, transform, isPrimary, monitorsForApply];
    });
}

export async function applyMonitorConfig(logicalMonitors) {
    const [serial] = (await callDisplayConfig('GetCurrentState')).recursiveUnpack();
    const params = new GLib.Variant(APPLY_TYPE, [serial, 2, logicalMonitors, {}]);

    await callDisplayConfig('ApplyMonitorsConfig', params);
}

export function presetShortcutKeys(settings) {
    const prefix = 'shortcut-preset-';
    return settings.list_keys()
        .filter(key => key.startsWith(prefix))
        .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)));
}

export function loadPresets(settings) {
    return settings.get_value('presets').recursiveUnpack()
        .map(([id, label, blob]) => ({id, label, blob}));
}

export function updatePresets(settings, update) {
    const presets = update(loadPresets(settings));
    settings.set_value(
        'presets',
        new GLib.Variant(PRESETS_TYPE, presets.map(({id, label, blob}) => [id, label, blob]))
    );
}

export function formatPresetDetails(blob) {
    return blob.map(logicalMonitor => {
        const scale = logicalMonitor[2];
        const monitorLabels = logicalMonitor[5]
            .map(([connector, modeId]) => `${connector} ${modeId}`);

        let label = monitorLabels.join(' + ');
        if (typeof scale === 'number' && scale !== 1)
            label += ` · ${scale}×`;
        return label;
    }).filter(Boolean).join(' · ');
}
