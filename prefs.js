/* prefs.js
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
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {formatPresetDetails, loadPresets, presetShortcutKeys} from './monitorConfig.js';

// Same interaction as the shortcut rows in GNOME Control Center:
// activate the row, press a key combination, Backspace clears it.
const ShortcutRow = GObject.registerClass(
class ShortcutRow extends Adw.ActionRow {
    _init(settings, key, title, subtitle = '', activatable = true) {
        super._init({
            title,
            subtitle,
            activatable,
        });

        this._settings = settings;
        this._key = key;
        this._label = new Gtk.ShortcutLabel({
            disabled_text: _('no shortcut'),
            valign: Gtk.Align.CENTER,
        });
        this.add_suffix(this._label);

        this._changedId = this._settings.connect(`changed::${key}`, () => this._sync());
        this.connect('activated', () => this._capture());
        this._sync();
    }

    cleanup() {
        this._settings.disconnect(this._changedId);
        this._changedId = 0;
    }

    _sync() {
        this._label.accelerator = this._settings.get_strv(this._key)[0] ?? '';
    }

    _capture() {
        const page = new Adw.StatusPage({
            title: _('New accelerator…'),
            description: _('Press the new shortcut, or Backspace to clear it'),
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        });
        const window = new Adw.Window({
            modal: true,
            transient_for: this.get_root(),
            width_request: 420,
            height_request: 260,
            content: page,
        });

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
            if (keyval === Gdk.KEY_Escape) {
                window.close();
                return Gdk.EVENT_STOP;
            }
            if (keyval === Gdk.KEY_BackSpace) {
                this._save('');
                window.close();
                return Gdk.EVENT_STOP;
            }

            const mask = (state & Gtk.accelerator_get_default_mod_mask()) &
                ~Gdk.ModifierType.LOCK_MASK;
            if (!mask || !Gtk.accelerator_valid(keyval, mask))
                return Gdk.EVENT_STOP;

            this._save(Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask));
            window.close();
            return Gdk.EVENT_STOP;
        });

        window.add_controller(controller);
        window.present();
    }

    _save(accelerator) {
        this._settings.set_strv(this._key, accelerator ? [accelerator] : []);
    }
});

export default class YaMonitorPresetsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        this._signalIds = [];

        const page = new Adw.PreferencesPage();
        page.add(this._buildGeneralGroup());
        page.add(this._buildHookGroup());
        page.add(this._buildShortcutsGroup());
        window.add(page);

        window.connect('close-request', () => {
            for (const id of this._signalIds)
                this._settings.disconnect(id);
            this._signalIds = [];
            this._settings = null;

            return false;
        });
    }

    _connect(signal, callback) {
        this._signalIds.push(this._settings.connect(signal, callback));
    }

    _bind(key, object, property) {
        this._settings.bind(key, object, property, Gio.SettingsBindFlags.DEFAULT);
    }

    _buildGeneralGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('General'),
        });

        const skipConfirmRow = new Adw.SwitchRow({
            title: _('Skip the display change confirmation'),
            subtitle: _('Keep display changes made by this extension immediately instead of asking whether to keep them.'),
        });
        this._bind('skip-display-change-confirm', skipConfirmRow, 'active');
        group.add(skipConfirmRow);

        const panelRow = new Adw.SwitchRow({
            title: _('Show in Panel'),
        });
        this._bind('show-panel', panelRow, 'active');
        group.add(panelRow);

        const quickSettingsRow = new Adw.SwitchRow({
            title: _('Show in Quick Settings'),
        });
        this._bind('show-quick-settings', quickSettingsRow, 'active');
        group.add(quickSettingsRow);

        return group;
    }

    _buildHookGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Hooks'),
        });

        const hookRow = new Adw.SwitchRow({
            title: _('RDP connection'),
            subtitle: _('Apply preset on RDP connection, and restore upon disconnection.'),
        });
        this._bind('rdp-hook-enabled', hookRow, 'active');
        group.add(hookRow);

        const presetRow = new Adw.ComboRow({
            title: _('Monitor preset for RDP'),
        });
        group.add(presetRow);

        const startCommandRow = new Adw.EntryRow({
            title: _('Command when an RDP session starts'),
            show_apply_button: false,
        });
        this._bind('rdp-start-command', startCommandRow, 'text');
        group.add(startCommandRow);

        const endCommandRow = new Adw.EntryRow({
            title: _('Command when an RDP session ends'),
            show_apply_button: false,
        });
        this._bind('rdp-end-command', endCommandRow, 'text');
        group.add(endCommandRow);

        let updating = false;

        const syncSelected = () => {
            const presets = loadPresets(this._settings);
            const presetId = this._settings.get_string('rdp-preset-id');
            const selected = presets.findIndex(p => p.id === presetId);
            const index = selected >= 0 ? selected + 1 : 0;

            if (presetRow.selected === index)
                return;

            updating = true;
            presetRow.selected = index;
            updating = false;
        };

        const updateModel = () => {
            const presets = loadPresets(this._settings);

            updating = true;
            presetRow.set_model(Gtk.StringList.new([
                _('no preset'),
                ...presets.map(p => p.label),
            ]));
            updating = false;
            syncSelected();

            const enabled = this._settings.get_boolean('rdp-hook-enabled');
            presetRow.sensitive = enabled && presets.length > 0;
            startCommandRow.sensitive = enabled;
            endCommandRow.sensitive = enabled;
        };

        presetRow.connect('notify::selected', () => {
            if (updating)
                return;

            const presets = loadPresets(this._settings);
            const selected = presetRow.selected - 1;
            const presetId = selected >= 0 ? presets[selected]?.id ?? '' : '';
            if (this._settings.get_string('rdp-preset-id') !== presetId)
                this._settings.set_string('rdp-preset-id', presetId);
        });

        updateModel();
        this._connect('changed::presets', updateModel);
        this._connect('changed::rdp-preset-id', syncSelected);
        this._connect('changed::rdp-hook-enabled', updateModel);

        return group;
    }

    _buildShortcutsGroup() {
        const group = new Adw.PreferencesGroup({title: _('Shortcuts')});

        group.add(new ShortcutRow(this._settings, 'shortcut-previous-preset', _('Previous preset')));
        group.add(new ShortcutRow(this._settings, 'shortcut-next-preset', _('Next preset')));

        const rows = [];
        const rebuild = () => {
            for (const row of rows) {
                row.cleanup();
                group.remove(row);
            }
            rows.length = 0;

            const presets = loadPresets(this._settings);
            for (const [index, key] of presetShortcutKeys(this._settings).entries()) {
                const preset = presets[index];
                const details = preset
                    ? formatPresetDetails(preset.blob) || _('Unknown configuration')
                    : '';
                const row = new ShortcutRow(
                    this._settings,
                    key,
                    _('Preset %d (%s)')
                        .replace('%d', index + 1)
                        .replace('%s', preset ? preset.label : _('no preset')),
                    details,
                    !!preset
                );
                group.add(row);
                rows.push(row);
            }
        };

        rebuild();
        this._connect('changed::presets', rebuild);

        return group;
    }
}
