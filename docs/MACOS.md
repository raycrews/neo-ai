# Neo-AI for Apple silicon — test build

This initial Mac build targets Apple silicon (ARM64). It does not run on Intel
Macs. The Electron 43 build requires macOS 12 Monterey or later; automated tests
run on an Apple silicon macOS 15 GitHub runner. Other supported macOS versions
and everyday use on a physical Mac still need volunteer testing.

## Install

1. Download the `neo-ai-mac` artifact from the **Build Neo-AI Desktop** workflow
   and extract its ZIP. The file ending in `mac-arm64.dmg` is the installer.
2. Optionally verify the files in Terminal from the extracted folder:
   `shasum -a 256 -c SHA256SUMS-mac-arm64.txt`.
3. Open the DMG and drag **Neo-AI** into **Applications**. Eject the disk image,
   then launch Neo-AI from Applications.

Development builds are not Developer ID signed or Apple-notarized. macOS may
block first launch. For a build you trust, attempt to open it, then use
**System Settings → Privacy & Security → Open Anyway**, if offered. Do not
disable Gatekeeper globally. If macOS reports damage or malware, stop and report
the exact message rather than bypassing that warning.

The included application ZIP is an alternative package, not a second installer
that must also be installed. Signing and notarization for public distribution
require Apple developer credentials; a successful CI build does not verify the
downloaded application's Gatekeeper experience.

## First run and shared libraries

No author name, books, chats, connections, API keys, or personal preferences are
included. A new installation opens first-time setup. Preferences for an existing
Neo-AI installation are retained when replacing the app.

Choose an existing library through **Settings → General → Library folder**.
Mount a NAS share in Finder first, then select its folder. Windows drive letters
and Linux mount paths do not transfer to macOS. Test using a copy of your library
and close Neo-AI on other computers before writing to the same library.

AI connections are device-specific. Configure LM Studio using the address of the
computer hosting it; `localhost` refers to the Mac itself. Running the language
model on the Mac is optional.

## Checks for a Mac tester

- Install from the downloaded DMG, launch from Applications, quit, and reopen.
- Check title-bar buttons, window dragging, the macOS menu bar, and Command-key
  shortcuts. Check detached AI Assistance and Settings windows.
- Create a book; type, format, copy/paste, undo, search, and reopen saved writing.
- Select a copied local or NAS library and confirm automatic restart opens it.
- Test native file pickers, backups and restore, and PDF/EPUB/HTML/text exports.
- Connect to an AI provider, send a chat, stop a reply, and revise selected text.
- Check appearance, text scaling, fullscreen, and multiple-monitor behavior.
- If using an API key, check persistence after quitting with the keychain unlocked.

Report the Neo-AI version, Mac chip, macOS version, and exact error or screenshot.

## Build and automated checks

On an Apple silicon Mac with Node.js 24, run `npm ci`, `npm test`, and the Electron
integration tests listed in `.github/workflows/build.yml`. To create an unsigned
development package:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac -- --config.mac.notarize=false --publish never
npm run test:packaged-mac
```

The packaged test verifies and mounts the DMG, copies the app to a temporary
Applications folder, verifies ARM64 architecture, and runs it with temporary
settings and writing. It checks onboarding, Mac title-bar spacing, saving, an AI
reply from a local test server, backups, and persistence after restarting. No
personal library or real provider is used. GitHub builds remain test artifacts;
this workflow does not publish a release on a branch or pull request.
