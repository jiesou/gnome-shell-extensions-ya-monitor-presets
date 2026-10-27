/* presetApplier.js
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

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {applyMonitorConfig} from './monitorConfig.js';

export class PresetApplier {
    constructor(settings) {
        this._settings = settings;
        this._chain = null;
        this._pending = 0;
        this._activeId = null;
    }

    start() {
        global.window_manager.connectObject(
            'confirm-display-change',
            () => this._confirm(),
            this
        );
    }

    stop() {
        global.window_manager.disconnectObject(this);
        this._chain = null;
        this._activeId = null;
    }

    get activeId() {
        return this._activeId;
    }

    apply(preset) {
        this._activeId = preset.id;
        this._enqueue(preset.blob);
    }

    restore(config) {
        this._enqueue(config);
    }

    _enqueue(config) {
        this._chain = (this._chain ?? Promise.resolve())
            .then(() => this._apply(config));
    }

    async _apply(config) {
        this._pending++;
        try {
            await applyMonitorConfig(config);
        } catch (e) {
            if (e instanceof Gio.DBusError)
                Gio.DBusError.strip_remote_error(e);
            Main.notifyError(_('Applying monitor preset failed'), e.message ?? String(e));
        } finally {
            this._pending--;
        }
    }

    _confirm() {
        if (this._pending === 0 ||
            !this._settings.get_boolean('skip-display-change-confirm'))
            return;

        global.window_manager.complete_display_change(true);

        for (const dialog of Main.layoutManager.modalDialogGroup.get_children()) {
            if (dialog.constructor?.name === 'DisplayChangeDialog')
                dialog.close();
        }
    }
}
