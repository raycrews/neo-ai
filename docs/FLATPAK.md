# Linux Flatpak testing

This x86-64 (Intel/AMD) package is a downloadable development bundle. It is not
published on Flathub. Flathub supplies the shared Freedesktop runtime; Neo-AI is
installed from the downloaded file. FUSE and an AppImage manager are not needed.

## Install and open

Download and extract the `neo-ai-flatpak` artifact from the **Build Neo-AI
Desktop** GitHub Actions workflow. In that folder, run:

```bash
sha256sum -c SHA256SUMS-flatpak-x64.txt
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.freedesktop.Platform//25.08
flatpak install --user ./Neo-AI-0.9.50-linux-x86_64.flatpak
flatpak run io.github.raycrews.neoai
```

Neo-AI also appears in the desktop application menu. The first runtime download
can be large; it is shared with other Flatpak applications.

Neo-AI uses native Wayland when its display socket is available inside the
sandbox, and X11 otherwise. Both desktop session types are supported without
extra launch flags. Version 0.9.48 could select Wayland without permission to
access its socket; its temporary workaround is
`flatpak run io.github.raycrews.neoai --ozone-platform=x11`.

Install a later Neo-AI bundle with the same `flatpak install --user ./…flatpak`
command. Preferences are retained. `flatpak update` updates the shared runtime,
but does not obtain new Neo-AI bundles from GitHub. There is no automatic app
update source yet. The built-in AppImage updater is disabled inside Flatpak.

## Settings and writing

Flatpak keeps preferences under `~/.var/app/io.github.raycrews.neoai/config/`.
It starts with its own clean device settings; it does not copy AppImage or
Windows settings. Books stay in the ordinary library folder you choose.

Use **Settings → General → Library folder → Browse** to open a library. Close
the AppImage before opening the same library in Flatpak. Test initially with a
copy. Mount NAS shares in the desktop file manager or through Linux first;
Windows drive letters and UNC paths are not Linux paths.

Configure LM Studio or other providers in Settings. A Tailscale IP address can
be used in the base URL. In chats saved on another device, explicitly select
this device's connection in the provider dropdown, even if both connections
have the same display name.

## Sandbox permissions

- Wayland and fallback X11, shared memory, and graphics acceleration display the
  editor. Flatpak exposes X11 when a Wayland display is unavailable.
- Network access allows local, LAN, Tailscale, and online AI connections.
- Home-folder access supports the default Documents library, imports, and
  exports. `/mnt`, `/media`, `/run/media`, and the desktop's GVfs mount directory
  support mounted NAS shares and removable drives. These locations are writable.
- Secret Service access allows API keys to use the desktop key store. If it is
  unavailable, Neo-AI uses its existing session-only key behavior.

There is no blanket host-filesystem permission or unrestricted session-bus
access. For a library mounted elsewhere, grant that specific mount, then reopen:

```bash
flatpak override --user --filesystem=/your/library/mount io.github.raycrews.neoai
```

Do not grant a literal Windows path or an `smb://` URL. To troubleshoot a graphics
driver issue on a Wayland desktop, temporarily use Xwayland:

```bash
flatpak run --nosocket=wayland --socket=x11 io.github.raycrews.neoai --ozone-platform=x11
```

The optional system-bus and VSync diagnostics printed by Electron do not by
themselves mean startup or saving failed. Report visible rendering problems,
crashes, or a feature that fails along with its terminal output.

## Build and verify

Use Linux, Node.js 24, `flatpak`, and `flatpak-builder` 1.4 or newer (for example,
Ubuntu 24.04). The display tests also require Weston, Xvfb and D-Bus. Add
Flathub as above, then:

```bash
flatpak install --user flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08 org.electronjs.Electron2.BaseApp//25.08
npm ci
npm run package:flatpak
flatpak install --user ./dist/Neo-AI-0.9.50-linux-x86_64.flatpak
bash scripts/test-flatpak-displays.sh
```

The packaged tests use temporary settings and writing. They run on X11, native
Wayland without X11, and X11 with stale Wayland session variables. Display
selection is left to the installed application, catching the 0.9.48 startup
regression. They check first launch,
formatted content, backups, appearance, shortcuts, and persistence. Zypak provides
Electron sandbox integration; no `--no-sandbox` workaround is used.

On Pop!_OS, additionally check the native folder picker, NAS library switching
and automatic restart, exports, desktop key storage, Tailscale AI chat, and
external browser/email opening. Automated virtual-display tests do not replace
these desktop checks.

The Flatpak job runs alongside the Windows, macOS, and AppImage jobs with pinned
GitHub Actions and read-only build permissions. A bundle artifact is not a
release; only the existing version-tag workflow creates a draft release.

Packaging follows the [Flatpak Electron guide](https://docs.flatpak.org/en/latest/electron.html)
and [sandbox permission guidance](https://docs.flatpak.org/en/latest/sandbox-permissions.html).
