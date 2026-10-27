/* rdpHook.js
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

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {getDisplayState, loadPresets, subscribeMonitorsChanged} from './monitorConfig.js';

const SERVER_INTERFACE = 'org.gnome.RemoteDesktop.Rdp.Server';
const SERVER_OBJECT_PATH = '/org/gnome/RemoteDesktop/Rdp/Server';
const APPLY_DELAY_MS = 1000;

export class RdpHook {
    constructor(settings, applier) {
        this._settings = settings;
        this._applier = applier;
        this._baseline = null;
        this._handles = new Set();
        this._session = null;
        this._disposers = null;
    }

    start() {
        if (this._disposers)
            return;

        const controller = global.backend.get_remote_access_controller?.() ?? null;
        controller?.connectObject(
            'new-handle',
            (_controller, handle) => this._onNewHandle(handle),
            this
        );

        const monitorsId = subscribeMonitorsChanged(() => this._updateBaseline());
        const connectionId = Gio.DBus.session.signal_subscribe(
            null,
            SERVER_INTERFACE,
            'NewConnection',
            SERVER_OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            () => this._onNewConnection()
        );

        this._disposers = [
            () => controller?.disconnectObject(this),
            () => Gio.DBus.session.signal_unsubscribe(monitorsId),
            () => Gio.DBus.session.signal_unsubscribe(connectionId),
        ];

        this._updateBaseline();
    }

    stop() {
        for (const dispose of this._disposers ?? [])
            dispose();
        this._disposers = null;

        if (this._session?.timeoutId)
            GLib.source_remove(this._session.timeoutId);
        this._session = null;
        this._baseline = null;
        this._handles.clear();
    }

    _updateBaseline() {
        if (this._session)
            return;

        getDisplayState()
            .then(config => {
                if (!this._session)
                    this._baseline = config;
            })
            .catch(() => {});
    }

    _onNewConnection() {
        const preset = this._preset();
        if (!preset &&
            !this._settings.get_string('rdp-start-command').trim() &&
            !this._settings.get_string('rdp-end-command').trim())
            return;

        const session = this._session ??= {
            restore: preset ? this._baseline : null,
            timeoutId: 0,
        };
        if (session.timeoutId)
            GLib.source_remove(session.timeoutId);

        session.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, APPLY_DELAY_MS, () => {
            session.timeoutId = 0;
            this._runCommand('rdp-start-command');
            if (preset)
                this._applier.apply(preset);
            return GLib.SOURCE_REMOVE;
        });
    }

    _onNewHandle(handle) {
        if (handle.is_recording)
            return;

        this._handles.add(handle);
        handle.connect('stopped', () => {
            this._handles.delete(handle);
            if (this._session && this._handles.size === 0)
                this._endSession();
        });
    }

    _endSession() {
        const session = this._session;
        this._session = null;

        if (session.timeoutId) {
            GLib.source_remove(session.timeoutId);
            return;
        }

        this._runCommand('rdp-end-command');
        if (session.restore)
            this._applier.restore(session.restore);
    }

    _preset() {
        const presetId = this._settings.get_string('rdp-preset-id');
        if (!presetId)
            return null;

        const preset = loadPresets(this._settings).find(p => p.id === presetId);
        if (!preset)
            console.warn(`[ya-monitor-presets] RDP preset ${presetId} not found`);

        return preset ?? null;
    }

    _runCommand(key) {
        const command = this._settings.get_string(key).trim();
        if (!command)
            return;

        try {
            Gio.Subprocess.new(['/bin/sh', '-c', command], Gio.SubprocessFlags.NONE);
        } catch (e) {
            Main.notifyError(_('Running RDP command failed'), e.message ?? String(e));
        }
    }
}
