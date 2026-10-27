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
        const [x, y, scale, transform, isPrimary, connectedMonitors, properties] = logicalMonitor;
        const monitorsForApply = connectedMonitors.map(([connector]) => [
            connector,
            activeModes.get(connector) ?? 'preferred',
            {},
        ]);
        return [x, y, scale, transform, isPrimary, monitorsForApply, properties ?? {}];
    });
}

export async function applyMonitorConfig(logicalMonitors, properties = {}) {
    const [serial] = (await callDisplayConfig('GetCurrentState')).recursiveUnpack();
    const params = new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
        serial,
        2,
        logicalMonitors,
        properties,
    ]);

    await callDisplayConfig('ApplyMonitorsConfig', params);
}

export const MAX_PRESET_SHORTCUTS = 9;

export function loadPresets(settings) {
    try {
        const presets = JSON.parse(settings.get_string('presets'));
        if (!Array.isArray(presets))
            return [];

        return presets.filter(preset =>
            preset &&
            typeof preset.id === 'string' &&
            typeof preset.label === 'string' &&
            Array.isArray(preset.blob)
        );
    } catch (e) {
        logError(e, 'Failed to parse monitor presets');
        return [];
    }
}

export function savePresets(settings, presets) {
    settings.set_string('presets', JSON.stringify(presets));
}

export function formatPresetDetails(blob) {
    if (!Array.isArray(blob))
        return '';

    return blob.map(logicalMonitor => {
        const scale = logicalMonitor?.[2];
        const monitors = logicalMonitor?.[5];
        const monitorLabels = Array.isArray(monitors)
            ? monitors.map(([connector, modeId]) => `${connector} ${modeId}`)
            : [];

        let label = monitorLabels.join(' + ');
        if (typeof scale === 'number' && scale !== 1)
            label += ` · ${scale}×`;
        return label;
    }).filter(Boolean).join(' · ');
}
