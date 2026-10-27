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
    applyMonitorConfig,
    formatPresetDetails,
    getDisplayState,
    loadPresets,
    MAX_PRESET_SHORTCUTS,
    savePresets,
    subscribeMonitorsChanged,
} from './monitorConfig.js';

const RDP_SERVER_INTERFACE = 'org.gnome.RemoteDesktop.Rdp.Server';
const RDP_SERVER_OBJECT_PATH = '/org/gnome/RemoteDesktop/Rdp/Server';
const RDP_APPLY_DELAY_MS = 1000;

const PresetMenuItem = GObject.registerClass(
class PresetMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(preset, callbacks) {
        super._init();

        this._preset = preset;
        this._callbacks = callbacks;

        this._textBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'preset-text-box',
        });

        this._label = new St.Label({
            text: preset.label,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._textBox.add_child(this._label);

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
        this._textBox.add_child(this._entry);

        this._description = new St.Label({
            text: formatPresetDetails(preset.blob) || _('Unknown configuration'),
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'dimmed preset-description',
        });
        this._textBox.add_child(this._description);
        this.add_child(this._textBox);

        this._buttonBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'preset-button-box',
        });

        const editButton = new St.Button({
            child: new St.Icon({
                icon_name: 'document-edit-symbolic',
                style_class: 'popup-menu-icon',
            }),
            style_class: 'icon-button',
            can_focus: true,
        });
        editButton.connect('clicked', () => this._startEdit());
        this._buttonBox.add_child(editButton);

        const deleteButton = new St.Button({
            child: new St.Icon({
                icon_name: 'edit-delete-symbolic',
                style_class: 'popup-menu-icon',
            }),
            style_class: 'icon-button',
            can_focus: true,
        });
        deleteButton.connect('clicked', () => this._callbacks.onDelete(this._preset));
        this._buttonBox.add_child(deleteButton);
        this.add_child(this._buttonBox);

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
            'changed',
            (_settings, key) => this._onSettingsChanged(key),
            this
        );
        global.window_manager.connectObject(
            'confirm-display-change',
            () => this._onConfirmDisplayChange(),
            this
        );

        this._panelIndicator = new PanelMenu.Button(0.0, _('Monitor Presets'));
        this._panelIndicator.add_child(new St.Icon({
            icon_name: 'preferences-desktop-display-symbolic',
            style_class: 'system-status-icon',
        }));
        Main.panel.addToStatusArea(this.uuid, this._panelIndicator);

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

        this._menus = [this._panelIndicator.menu, this._qsToggle.menu];
        for (const menu of this._menus) {
            menu.connectObject('open-state-changed', (_menu, open) => {
                if (!open)
                    this._finishAllEdits(menu);
            }, this);
        }
        this._rebuildMenus();

        this._syncVisibility();
        this._addKeybindings();
        this._updateRdpHook();
    }

    disable() {
        this._settings.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        this._stopRdpHook();
        this._removeKeybindings();

        for (const menu of this._menus ?? [])
            menu.disconnectObject(this);
        this._panelIndicator.destroy();
        this._qsToggle.menu.destroy();
        this._qsToggle.destroy();
        this._qsIndicator.destroy();

        this._lastPresetId = this._pendingPreset = this._newPresetId = null;
        this._applyInProgress = false;
        this._pendingApplies = 0;
        this._keybindings = [];
        this._menus = this._settings = null;
        this._panelIndicator = this._qsToggle = this._qsIndicator = null;
    }

    _onSettingsChanged(key) {
        switch (key) {
        case 'presets':
            this._rebuildMenus();
            break;
        case 'show-panel':
        case 'show-quick-settings':
            this._syncVisibility();
            break;
        case 'rdp-hook-enabled':
            this._updateRdpHook();
            break;
        }
    }

    _syncVisibility() {
        this._panelIndicator.visible = this._settings.get_boolean('show-panel');
        this._qsToggle.visible = this._settings.get_boolean('show-quick-settings');
    }

    _rebuildMenus() {
        for (const menu of this._menus)
            this._rebuildMenu(menu);
    }

    _rebuildMenu(menu) {
        delete menu._settingsActions[this.uuid];
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
                    onActivate: p => this._applyPreset(p),
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
        const saveButton = new St.Button({
            child: new St.Icon({
                icon_name: 'list-add-symbolic',
                style_class: 'popup-menu-icon',
            }),
            style_class: 'icon-button',
            can_focus: true,
        });
        saveButton.connect('clicked', () => this._addCurrentPreset());
        saveRow.add_child(saveButton);
        menu.addMenuItem(saveRow);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = menu.addAction(_('Settings'), () => this.openPreferences());
        settingsItem.visible = Main.sessionMode.allowSettings;
        menu._settingsActions[this.uuid] = settingsItem;
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
                savePresets(this._settings, [...loadPresets(this._settings), preset]);
            })
            .catch(e => this._notifyError(_('Saving monitor preset failed'), e));
    }

    _saveEditedPreset(preset) {
        if (!this._settings)
            return;

        const presets = loadPresets(this._settings);
        const index = presets.findIndex(p => p.id === preset.id);
        if (index === -1)
            return;

        presets[index] = preset;
        savePresets(this._settings, presets);
    }

    _deletePreset(preset) {
        const presets = loadPresets(this._settings).filter(p => p.id !== preset.id);
        savePresets(this._settings, presets);

        if (this._settings.get_string('rdp-preset-id') === preset.id)
            this._settings.set_string('rdp-preset-id', '');
        if (this._lastPresetId === preset.id)
            this._lastPresetId = null;
    }

    _applyPreset(preset) {
        this._lastPresetId = preset.id;
        this._pendingPreset = preset;

        if (this._applyInProgress)
            return;

        this._applyInProgress = true;
        this._applyPendingPresets()
            .finally(() => {
                this._applyInProgress = false;
            });
    }

    async _applyPendingPresets() {
        while (this._pendingPreset) {
            const preset = this._pendingPreset;
            this._pendingPreset = null;

            try {
                await this._applyConfig(preset.blob);
            } catch (e) {
                this._notifyError(_('Applying monitor preset failed'), e);
            }
        }
    }

    async _applyConfig(logicalMonitors) {
        this._pendingApplies++;
        try {
            await applyMonitorConfig(logicalMonitors);
        } finally {
            this._pendingApplies--;
        }
    }

    _onConfirmDisplayChange() {
        if (this._pendingApplies === 0 ||
            !this._settings.get_boolean('skip-display-change-confirm'))
            return;

        global.window_manager.complete_display_change(true);

        for (const dialog of Main.layoutManager.modalDialogGroup.get_children()) {
            if (dialog.constructor?.name === 'DisplayChangeDialog')
                dialog.close();
        }
    }

    _applyPresetSlot(slot) {
        const preset = loadPresets(this._settings)[slot - 1];
        if (preset)
            this._applyPreset(preset);
    }

    _applyRelative(offset) {
        const presets = loadPresets(this._settings);
        if (presets.length === 0)
            return;

        let index = presets.findIndex(p => p.id === this._lastPresetId);
        if (index === -1)
            index = offset > 0 ? -1 : 0;

        this._applyPreset(presets[(index + offset + presets.length) % presets.length]);
    }

    _notifyError(title, error) {
        if (error instanceof Gio.DBusError)
            Gio.DBusError.strip_remote_error(error);
        Main.notifyError(title, error?.message ?? String(error));
    }

    _addKeybindings() {
        const modes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW |
            Shell.ActionMode.SYSTEM_MODAL;
        this._keybindings = [];
        const add = (name, handler) => {
            Main.wm.addKeybinding(name, this._settings, Meta.KeyBindingFlags.NONE, modes, handler);
            this._keybindings.push(name);
        };

        add('shortcut-previous-preset', () => this._applyRelative(-1));
        add('shortcut-next-preset', () => this._applyRelative(1));
        for (let slot = 1; slot <= MAX_PRESET_SHORTCUTS; slot++)
            add(`shortcut-preset-${slot}`, () => this._applyPresetSlot(slot));
    }

    _removeKeybindings() {
        for (const key of this._keybindings ?? [])
            Main.wm.removeKeybinding(key);
    }

    _updateRdpHook() {
        if (this._settings.get_boolean('rdp-hook-enabled'))
            this._startRdpHook();
        else
            this._stopRdpHook();
    }

    _startRdpHook() {
        if (this._rdp)
            return;

        const rdp = this._rdp = {
            baseline: null,
            session: null,
            applyId: 0,
            handles: new Set(),
            controller: global.backend.get_remote_access_controller?.() ?? null,
            baselineSubscriptionId: subscribeMonitorsChanged(() => this._updateBaseline()),
            connectionSubscriptionId: Gio.DBus.session.signal_subscribe(
                null,
                RDP_SERVER_INTERFACE,
                'NewConnection',
                RDP_SERVER_OBJECT_PATH,
                null,
                Gio.DBusSignalFlags.NONE,
                () => this._onRdpNewConnection()
            ),
        };

        rdp.controller?.connectObject(
            'new-handle',
            (_controller, handle) => this._onNewRemoteAccessHandle(handle),
            this
        );

        this._updateBaseline();
    }

    _stopRdpHook() {
        const rdp = this._rdp;
        if (!rdp)
            return;

        this._rdp = null;
        rdp.session = null;
        if (rdp.applyId)
            GLib.source_remove(rdp.applyId);
        rdp.controller?.disconnectObject(this);
        Gio.DBus.session.signal_unsubscribe(rdp.baselineSubscriptionId);
        Gio.DBus.session.signal_unsubscribe(rdp.connectionSubscriptionId);
    }

    _updateBaseline() {
        const rdp = this._rdp;
        if (!rdp || rdp.session || rdp.applyId)
            return;

        getDisplayState()
            .then(config => {
                if (!rdp.session && !rdp.applyId)
                    rdp.baseline = config;
            })
            .catch(() => {});
    }

    _onRdpNewConnection() {
        const rdp = this._rdp;
        if (!rdp || !this._settings.get_boolean('rdp-hook-enabled'))
            return;

        const preset = this._rdpPreset();
        if (!preset &&
            !this._settings.get_string('rdp-start-command').trim() &&
            !this._settings.get_string('rdp-end-command').trim())
            return;

        if (rdp.applyId)
            GLib.source_remove(rdp.applyId);
        rdp.applyId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            RDP_APPLY_DELAY_MS,
            () => {
                this._applyRdpPreset(preset);
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _rdpPreset() {
        const presetId = this._settings.get_string('rdp-preset-id');
        if (!presetId)
            return null;

        const preset = loadPresets(this._settings).find(p => p.id === presetId);
        if (!preset)
            console.warn(`[ya-monitor-presets] RDP preset ${presetId} not found`);

        return preset ?? null;
    }

    _runRdpCommand(key) {
        const command = this._settings.get_string(key).trim();
        if (!command)
            return;

        try {
            Gio.Subprocess.new(['/bin/sh', '-c', command], Gio.SubprocessFlags.NONE);
        } catch (e) {
            this._notifyError(_('Running RDP command failed'), e);
        }
    }

    _applyRdpPreset(preset) {
        const rdp = this._rdp;
        rdp.applyId = 0;

        if (!rdp.session) {
            rdp.session = {
                restore: preset ? {config: rdp.baseline, presetId: this._lastPresetId} : null,
                handles: new Set(rdp.handles),
            };
            this._runRdpCommand('rdp-start-command');
        }

        if (preset)
            this._applyPreset(preset);
    }

    _onNewRemoteAccessHandle(handle) {
        if (handle.is_recording)
            return;

        const rdp = this._rdp;
        rdp.handles.add(handle);
        handle.connect('stopped', () => {
            rdp.handles.delete(handle);
            if (rdp.session?.handles.delete(handle) && rdp.session.handles.size === 0)
                this._restoreAfterRdp();
        });

        if (rdp.session && rdp.session.handles.size === 0)
            rdp.session.handles.add(handle);
    }

    _restoreAfterRdp() {
        const restore = this._rdp.session.restore;
        this._rdp.session = null;
        this._runRdpCommand('rdp-end-command');

        if (!restore?.config)
            return;

        this._applyConfig(restore.config)
            .then(() => {
                if (restore.presetId)
                    this._lastPresetId = restore.presetId;
            })
            .catch(e => this._notifyError(_('Restoring monitor configuration failed'), e));
    }
}
