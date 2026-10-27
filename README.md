# Yet Another Monitor Presets

Save monitor configurations as presets and switch between them quickly. Specially designed as a workaround for GNOME Remote Desktop RDP resolution issues. A preset stores which monitors are enabled, along with their resolution, refresh rate, and scale (DPI).


<img width="471" alt="image" src="https://github.com/user-attachments/assets/04f9e06f-ee30-42c2-bb9d-e4ca726310b4" />

<img width="400" alt="image" src="https://github.com/user-attachments/assets/0ec24f14-9c68-4955-9632-009880f086e0" />

Originally based on [cortex/monitor-presets](https://github.com/cortex/monitor-presets), with the following additions:

- Panel and Quick Settings integration
- RDP hook
- Keyboard shortcuts

## RDP Hook

Currently, the `mirror-primary` mode in GNOME Remote Desktop does not respect the resolution requested by the RDP client.

This extension's **RDP hook** feature works around this issue by automatically applying a preset when an RDP session connects and restoring the previous configuration upon disconnection.

You can also configure custom shell commands to run when an RDP session starts or ends.

Only compatible with GNOME 50 and newer.

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
