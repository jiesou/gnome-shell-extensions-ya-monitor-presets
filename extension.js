/* extension.js
 *
 * Based on monitor-presets by Joakim Lundborg:
 * https://github.com/cortex/monitor-presets
 *
 * Copyright (c) 2026 Joakim Lundborg
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
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {
    formatPresetDetails,
    getDisplayState,
    loadPresets,
    presetShortcutKeys,
    updatePresets,
} from './monitorConfig.js';
import {PresetApplier} from './presetApplier.js';
import {RdpHook} from './rdpHook.js';

function iconButton(iconName, onClick) {
    const button = new St.Button({
        child: new St.Icon({
            icon_name: iconName,
            style_class: 'popup-menu-icon',
        }),
        style_class: 'icon-button',
        can_focus: true,
    });
    button.connect('clicked', onClick);
    return button;
}

const PresetMenuItem = GObject.registerClass(
class PresetMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(preset, callbacks) {
        super._init();

        this._preset = preset;
        this._callbacks = callbacks;

        const textBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'preset-text-box',
        });

        this._label = new St.Label({
            text: preset.label,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        textBox.add_child(this._label);

        this._entry = new St.Entry({
            text: preset.label,
            x_expand: true,
            can_focus: true,
            visible: false,
        });
        this._entry.clutter_text.connectObject(
            'activate', () => this._finishEdit(),
            'key-focus-out', () => this._finishEdit(),
            this
        );
        textBox.add_child(this._entry);

        textBox.add_child(new St.Label({
            text: formatPresetDetails(preset.blob) || _('Unknown configuration'),
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'preset-description',
        }));
        this.add_child(textBox);

        const buttonBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'preset-button-box',
        });
        buttonBox.add_child(iconButton('document-edit-symbolic', () => this._startEdit()));
        buttonBox.add_child(iconButton('edit-delete-symbolic',
            () => this._callbacks.onDelete(this._preset)));
        this.add_child(buttonBox);

        this.connect('activate', () => this._callbacks.onActivate(this._preset));
    }

    scheduleEdit() {
        if (this._startEditId)
            return;

        this._startEditId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._startEditId = 0;
            this._startEdit();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._startEditId) {
            GLib.source_remove(this._startEditId);
            this._startEditId = 0;
        }
        if (this._finishEditIdleId) {
            GLib.source_remove(this._finishEditIdleId);
            this._finishEditIdleId = 0;
        }
        this._entry.clutter_text.disconnectObject(this);
        super.destroy();
    }

    _startEdit() {
        this.reactive = false;
        this._entry.visible = true;
        this._label.visible = false;
        this._entry.grab_key_focus();
        this._entry.clutter_text.set_selection(0, -1);
    }

    _finishEdit() {
        this.reactive = true;
        const newLabel = this._entry.get_text().trim();
        let changed = false;

        if (newLabel && newLabel !== this._preset.label) {
            this._preset.label = newLabel;
            changed = true;
        }

        this._label.text = this._preset.label;
        this._entry.visible = false;
        this._label.visible = true;

        if (changed) {
            const preset = this._preset;
            this._finishEditIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._finishEditIdleId = 0;
                this._callbacks.onEdit(preset);
                return GLib.SOURCE_REMOVE;
            });
        }
    }
});

export default class YaMonitorPresetsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settings.connectObject(
            'changed::presets', () => this._rebuildMenus(),
            'changed::rdp-hook-enabled', () => this._updateRdpHook(),
            this
        );
        this._applier = new PresetApplier(this._settings);
        this._applier.start();
        this._rdp = new RdpHook(this._settings, this._applier);

        this._panelIndicator = new PanelMenu.Button(0.0, _('Monitor Presets'));
        this._panelIndicator.add_child(new St.Icon({
            icon_name: 'preferences-desktop-display-symbolic',
            style_class: 'system-status-icon',
        }));
        Main.panel.addToStatusArea(this.uuid, this._panelIndicator);
        this._settings.bind(
            'show-panel', this._panelIndicator, 'visible', Gio.SettingsBindFlags.GET);

        this._qsIndicator = new QuickSettings.SystemIndicator();
        this._qsToggle = new QuickSettings.QuickMenuToggle({
            title: _('Monitor Presets'),
            icon_name: 'preferences-desktop-display-symbolic',
            toggleMode: false,
        });
        this._qsToggle.menu.setHeader('preferences-desktop-display-symbolic', _('Monitor Presets'));
        this._qsToggle.connect('clicked', () => this._qsToggle.menu.toggle());
        this._qsIndicator.quickSettingsItems.push(this._qsToggle);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._qsIndicator);
        this._settings.bind(
            'show-quick-settings', this._qsToggle, 'visible', Gio.SettingsBindFlags.GET);

        this._menus = [this._panelIndicator.menu, this._qsToggle.menu];
        for (const menu of this._menus) {
            menu.connectObject('open-state-changed', (_menu, open) => {
                if (!open)
                    this._finishAllEdits(menu);
            }, this);
        }
        Main.sessionMode.connectObject('updated', () => this._rebuildMenus(), this);
        this._rebuildMenus();
        this._addKeybindings();
        this._updateRdpHook();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._applier.stop();
        this._rdp.stop();

        Main.sessionMode.disconnectObject(this);
        for (const menu of this._menus ?? [])
            menu.disconnectObject(this);
        this._removeKeybindings();

        Gio.Settings.unbind(this._panelIndicator, 'visible');
        Gio.Settings.unbind(this._qsToggle, 'visible');
        this._panelIndicator.destroy();
        this._qsToggle.menu.destroy();
        this._qsToggle.destroy();
        this._qsIndicator.destroy();

        this._newPresetId = null;
        this._menus = this._settings = null;
        this._applier = this._rdp = null;
        this._panelIndicator = this._qsToggle = this._qsIndicator = null;
    }

    _rebuildMenus() {
        for (const menu of this._menus)
            this._rebuildMenu(menu);
    }

    _rebuildMenu(menu) {
        menu.removeAll();

        const presets = loadPresets(this._settings);
        if (presets.length === 0) {
            menu.addMenuItem(new PopupMenu.PopupMenuItem(_('No presets yet'), {
                reactive: false,
                can_focus: false,
            }));
        } else {
            for (const preset of presets) {
                const item = new PresetMenuItem(preset, {
                    onActivate: p => this._applier.apply(p),
                    onEdit: p => this._saveEditedPreset(p),
                    onDelete: p => this._deletePreset(p),
                });
                menu.addMenuItem(item);
                if (preset.id === this._newPresetId && menu.isOpen) {
                    this._newPresetId = null;
                    item.scheduleEdit();
                }
            }
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Inert row: activating a normal item would close the menu before the new preset renames.
        const saveRow = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        saveRow.add_child(new St.Icon({
            icon_name: 'bookmark-new-symbolic',
            style_class: 'popup-menu-icon',
        }));
        saveRow.add_child(new St.Label({
            text: _('Save current'),
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        saveRow.add_child(iconButton('list-add-symbolic', () => this._addCurrentPreset()));
        menu.addMenuItem(saveRow);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = menu.addAction(_('Settings'), () => this.openPreferences());
        settingsItem.visible = Main.sessionMode.allowSettings;
    }

    _finishAllEdits(menu) {
        for (const item of menu._getMenuItems()) {
            if (item instanceof PresetMenuItem && item._entry.visible)
                item._finishEdit();
        }
    }

    _addCurrentPreset() {
        getDisplayState()
            .then(blob => {
                if (!this._settings)
                    return;

                const preset = {
                    id: GLib.uuid_string_random(),
                    label: _('New preset'),
                    blob,
                };
                this._newPresetId = preset.id;
                updatePresets(this._settings, presets => [...presets, preset]);
            })
            .catch(e => Main.notifyError(
                _('Saving monitor preset failed'), e.message ?? String(e)));
    }

    _saveEditedPreset(preset) {
        if (!this._settings)
            return;

        updatePresets(this._settings,
            presets => presets.map(p => p.id === preset.id ? preset : p));
    }

    _deletePreset(preset) {
        updatePresets(this._settings, presets => presets.filter(p => p.id !== preset.id));

        if (this._settings.get_string('rdp-preset-id') === preset.id)
            this._settings.set_string('rdp-preset-id', '');
    }

    _applyPresetSlot(slot) {
        const preset = loadPresets(this._settings)[slot - 1];
        if (preset)
            this._applier.apply(preset);
    }

    _applyRelative(offset) {
        const presets = loadPresets(this._settings);
        if (presets.length === 0)
            return;

        let index = presets.findIndex(p => p.id === this._applier.activeId);
        if (index === -1)
            index = offset > 0 ? -1 : 0;

        this._applier.apply(presets[(index + offset + presets.length) % presets.length]);
    }

    _shortcuts() {
        const shortcuts = new Map([
            ['shortcut-previous-preset', () => this._applyRelative(-1)],
            ['shortcut-next-preset', () => this._applyRelative(1)],
        ]);
        for (const [index, key] of presetShortcutKeys(this._settings).entries())
            shortcuts.set(key, () => this._applyPresetSlot(index + 1));
        return shortcuts;
    }

    _addKeybindings() {
        const modes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW |
            Shell.ActionMode.SYSTEM_MODAL;
        for (const [key, handler] of this._shortcuts())
            Main.wm.addKeybinding(key, this._settings, Meta.KeyBindingFlags.NONE, modes, handler);
    }

    _removeKeybindings() {
        for (const key of this._shortcuts().keys())
            Main.wm.removeKeybinding(key);
    }

    _updateRdpHook() {
        if (this._settings.get_boolean('rdp-hook-enabled'))
            this._rdp.start();
        else
            this._rdp.stop();
    }
}
