# Yet Another Monitor Presets

A GNOME Shell extension that saves monitor configurations as presets and switches between them quickly. A preset stores which monitors are enabled, their resolution, refresh rate and scale (DPI).

Based on [cortex/monitor-presets](https://github.com/cortex/monitor-presets), with three additions:

- RDP hook
optionally apply a chosen reslution preset when a GNOME Remote Desktop RDP client connects.
Useful as a workaround for mixed sessions and clients that request a resolution GNOME Remote Desktop does not handle well.
Custom shell commands can also run when the RDP session starts and ends.
- Keyboard shortcuts
previous/next preset plus one shortcut per preset. Handy for getting back to a working resolution when a monitor cannot display the current one. The shortcuts also work while the display change confirmation dialog is open.
- Panel and Quick Settings
choose whether the preset menu appears in the top panel, in Quick Settings, or both. Both places expose the same preset menu.

## Usage

The panel menu and the Quick Settings item are the same menu rendered in two places:

- apply a preset by clicking it;
- save the current monitor configuration with **Save current**;
- rename a preset with the edit button;
- delete a preset with the delete button;
- open the extension settings with **Settings**.

Preset management lives only in that menu, so there is a single implementation to maintain. Presets are stored in GSettings (`org.gnome.shell.extensions.ya-monitor-presets`). The preferences window covers where the menu appears, which preset the RDP hook applies, and the keyboard shortcuts.

## Display change confirmation

By default Mutter asks **Keep these display settings?** after every configuration change and reverts it when the countdown runs out. Enable **Skip the display change confirmation** at the top of the **General** group to keep the changes made by this extension right away, without the dialog. Changes made from Settings or other extensions keep the dialog and its revert-on-timeout behaviour. The keyboard shortcuts keep working while that dialog is open either way.

## RDP hook

Enable **Apply preset on RDP connection** in the **Hooks** group and select the preset to use. The preset is applied shortly after a new RDP connection is detected on the current user session. When the RDP session ends, the monitor configuration that was active before the connection is restored automatically.

The hook listens to the `NewConnection` signal on `org.gnome.RemoteDesktop.Rdp.Server`, which GNOME Remote Desktop exposes since version 50. The end of the session is detected through Mutter's remote access handles. With older daemons the switch simply has no effect.

The same group also takes an optional shell command for the start and the end of an RDP session. Both run through `/bin/sh -c`, so pipes and `;` work:

```
gnome-extensions enable dash-to-panel@jderose9.github.com; gnome-extensions enable blur-my-shell@aunetx
```

The preset is optional: with only the commands filled in, they run without touching the monitor configuration.

## Translation

Translation source files live in the `po/` directory.

### Adding a New Translation

Below, `zh_CN` is used as an example.

1. Generate a PO file for your language from the template:

```bash
msginit --input=po/messages.pot --locale=zh_CN.UTF-8 --output=po/zh_CN.po
```

2. Edit `po/zh_CN.po` with a text editor or a tool like [Gtranslator](https://flathub.org/apps/org.gnome.Gtranslator) / [POEdit](https://flathub.org/apps/net.poedit.Poedit).

3. Compile and install:

```bash
bash ./scripts/install-develop.sh
```

### Updating the Template

After adding or changing translatable strings in the source code, regenerate the POT file:

```bash
xgettext --from-code=UTF-8 --output=po/messages.pot *.js
```

Then update existing PO files:

```bash
msgmerge --update po/zh_CN.po po/messages.pot
```

## Credits

- [cortex/monitor-presets](https://github.com/cortex/monitor-presets)

## License

GPL-3.0-or-later
