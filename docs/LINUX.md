# Linux AppImage testing

The first Linux test package targets x86-64 (Intel/AMD). Windows and macOS remain
in the same GitHub Actions build matrix. ARM64 remains a packaging option in
`package.json`, but this AppImage test workflow does not validate ARM64 hardware.

## Download and run

Download the `neo-ai-linux` artifact from the **Build Neo-AI Desktop** workflow.
Extract the artifact ZIP into a folder you own, then run:

```bash
sha256sum -c SHA256SUMS-linux-x64.txt
chmod +x Neo-AI-0.9.47-linux-x86_64.AppImage
./Neo-AI-0.9.47-linux-x86_64.AppImage
```

The AppImage includes Neo-AI, Electron, and the application fonts. Node.js is not
needed to use it. Run it as your normal user. Keep the file in a permanent place,
such as `~/Applications`, so it remains available when Neo-AI restarts.

If the runtime reports that FUSE is unavailable, use its extraction fallback:

```bash
APPIMAGE_EXTRACT_AND_RUN=1 ./Neo-AI-0.9.47-linux-x86_64.AppImage
```

Do not disable Chromium's sandbox to work around a startup failure. Record the
terminal error, distribution, desktop session (Wayland/X11), and package version
in a bug report. Sandboxing policies differ among Linux distributions.

## Libraries and settings

New users get first-time setup. Books are ordinary folders and readable files in
the chosen library. Device preferences stay in the Linux user configuration
directory; no Windows preferences or private books are included in the package.

Open an existing library through **Settings → General → Library folder**. A
Windows drive letter or UNC path is not a Linux mount path: mount the network
share on Linux first and choose that folder. Test with a copy of your library,
and avoid editing the same library from two computers at once.

API keys use the desktop's supported key store. If it is unavailable or locked,
Neo-AI reports session-only storage rather than saving keys as plain text.

## Desktop acceptance checks

Test on a normal Linux desktop as well as the automated virtual display:

- First run, quit/reopen, themes, and keyboard shortcut customization.
- Create and edit a book; confirm formatting and content after reopening.
- Open a copied library, including a mounted network share; switch libraries and
  confirm the AppImage restarts into the selected library.
- Import; export PDF, HTML, text, DOCX and EPUB; choose files through native dialogs.
- Create a backup, restore a separate copy, and open that copy.
- Search Book, Find & Replace, spellcheck, fullscreen, and detached windows.
- Connect to a local AI server; chat, revise selected text, and stop generation.
- Verify secure key persistence with an unlocked desktop key store.
- Open the chosen email service and attach the exported PDF manually.
- Check both Wayland and X11 on available Ubuntu/Mint and Fedora desktops.

## Build from source

Use Linux with Node.js 24, run `npm ci`, then `npm run package:appimage`. Build in a
Linux directory with its own `node_modules`; do not reuse Windows dependencies.
The resulting file is placed in `dist/`.

The workflow uses Ubuntu 22.04 for its x64 Linux job, installs desktop libraries,
runs unit and Electron integration tests, then builds and tests the actual
AppImage. The packaged test uses an isolated home and checks first run, formatted
writing, settings, backups, and persistence after reopening. It uses the runtime's
extraction fallback under Xvfb with Chromium's sandbox enabled.

Build jobs have read-only repository access. Actions are pinned to upstream
commit hashes, and PR builds do not receive signing secrets. Downloadable build
artifacts are separate from releases; only a version-tag push can run the
existing draft-release job. This development work does not publish a release.
