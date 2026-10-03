# Neo-AI

Neo-AI is an Electron fork of Hugh Howey's NEO. The desktop targets are
Windows (x64 installer and portable EXE), macOS (Intel and Apple silicon DMG
and ZIP), and Linux (x64 and ARM64 AppImage).

## App settings and AI connections

Open **Settings** from the bookshelf, the bottom of the workspace navigation,
or **File → Settings** (`Ctrl+,` on Windows/Linux; **Neo-AI → Settings**, `Cmd+,`
on macOS). Settings opens in its own resizable window. General and AI Connections
are separate categories.

**General → Library folder → Browse…** opens an existing library or an empty
folder for a new library. The destination is validated before the saved path
changes. Pending book edits are saved before restarting; existing books stay
at their current location. Canceling or choosing an invalid folder keeps the
current library selected. Save or revert pending Settings edits before switching.

**General → Appearance** offers Dark, Light, and Follow system themes, six accent
swatches, a custom color picker, and Restore defaults. Changes apply immediately
to the workspace, Settings, and detached windows and are saved in the device's
settings.json. Accent text adapts for contrast. Manuscript paper remains separate
under **View → Page**. `npm run test:general` checks appearance synchronization,
persistence, failed saves, and library selection using an isolated library.

AI Connections supports named profiles for **LM Studio**, **Ollama**, **OpenAI**,
and other **OpenAI-compatible servers**. Local presets use localhost; edit the
base URL for a LAN server. Compatible servers can use Chat Completions or Responses;
the OpenAI preset uses Responses. Select a default connection for future chat.

1. Choose the type, name, and base URL. Add a key or token if the server needs one.
2. **Save connection**, then **Discover models**. An **Available models**
   drop-down appears with every model returned by the server. Select a model,
   then save. The choices stay available while editing and saving that connection.
   You can also type an exact model ID manually.
3. **Test connection** checks the models endpoint. **Test response** sends a fixed,
   short greeting to the selected model; hosted providers may charge for it.
   These tests never include book content. **Stop test** cancels a pending request.

Profiles are stored in `ai-connections.json` in the app's device-local data folder,
outside the library/NAS. Keys are encrypted with Electron safeStorage backed by the
OS key store; a key cannot be viewed after saving, but can be replaced or removed.
When protected storage is unavailable (including Linux `basic_text`), new keys stay
in memory only and must be entered again after restart. Existing encrypted keys
remain locked until the system key store is available. Changing a server address
requires replacing or removing its key, and redirects are never followed.
The original Cover Art key store also upgrades any legacy plaintext key on access.
Cover Art retains its separate configuration for now.

`npm run test:settings` exercises the real settings window against an isolated
local mock server. It never uses real credentials, external providers, or books.

## Document formatting

The native menu uses the current workspace: book commands become available when
a book is open, manuscript display settings when manuscript text is visible, and
paragraph alignment when the caret or selection is inside an editable document.
Workspace commands are disabled while a dialog or separate window has focus.
Standard Cut, Copy, Paste, and Undo continue to act on the focused text field.

**File → Settings…**, **File → Library and Backups…**, and **View → Appearance…**
open General settings. **Help → Keyboard Shortcuts…** lists the shortcuts,
including **Ctrl+,** for Settings, **Ctrl+Shift+F** for Search Book and **F11** for
fullscreen on Windows/Linux. On macOS, use Command in place of Ctrl and
Control+Command+F for fullscreen. **View → Manuscript Page** controls paper color
separately from the app theme. `npm run test:menus` checks real menus, selection,
Undo, separate windows, and shortcuts using an isolated library.

The document header has paragraph/heading styles, bold, italic, underline,
strikethrough, bulleted/numbered lists, and paragraph alignment. Click into a
document or select text to use these controls. Changes autosave as standard HTML
and support native undo/redo. The toolbar stays hidden in folder views and AI
chats, including chats moved into another navigation section.

`npm run test:formatting` checks selection handling, formatting, persistence,
undo/redo, narrow windows, and chat exclusion using an isolated library.

Right-click selected chat text for **Copy** and **Select All**. In documents and
text fields, the native menu also offers Undo, Redo, Cut, Paste, Paste and Match
Style, and Delete. This works in detached windows and Settings too. Existing
spelling and item-specific menus remain available. `npm run test:context-menu`
checks real right-click events and editing actions with an isolated library.

## AI Assistance chat

### Instruction library

Open **Settings → AI → Instruction library** to keep named instructions for
models, genres, and writing tasks. Create, rename, duplicate, edit, or delete
entries; each text box holds up to 200,000 characters. **Copy** copies the text
currently in the editor. **Import .txt** opens UTF-8 text as a new draft, and
**Export .txt** writes ordinary text with its original line breaks.

Save an entry to keep it on this device. Library entries are separate from active
assistant instructions: copy and paste the text where you want to use it. The
destination field's normal size limit still applies. Device storage uses standard
JSON in `instruction-library.json`; book backups exclude these device settings,
so export text files to keep independent copies. Unsaved changes are protected
when switching entries, closing Settings, or changing libraries.

`npm run test:instruction-library` checks these controls with temporary settings,
including persistence, plain-text round trips, and unchanged active instructions.

### Revise selected text

Select text in a manuscript scene, reference document, note, or outline, then
right-click → **AI revision** →
**Rewrite**, **Expand**, **Shorten**, or **Custom instruction**. Choose a saved
connection and model, optionally add direction, and click **Generate**. The
preview shows the original beside an editable proposal. **Accept replacement**
replaces only the selection and supports normal Undo/Redo. **Try again** generates
another proposal from the original selection; **Cancel** leaves the document
unchanged. **Stop** cancels generation. A proposal cannot be accepted if its
source passage changed while the preview was open.

Each request includes the selected text and up to 2,000 characters on either side
from that writing field. It uses the model's saved response settings. No other
documents or chat history are included. Edit the four **Text revision** action
instructions in **Settings → AI**. Revisions use the document's ordinary save
format. The actions also work in the detached Outline window. **Darlings and
AI Assistance chats are excluded**, including chat drafts and existing messages.
`npm run test:revision` exercises this workflow with a temporary library and a
mock provider.

### Chat conversations

Assistant replies render Markdown headings, bold/italic text, nested lists,
quotes, code blocks, and tables in both chat windows, including saved replies.
Copy places formatted HTML and readable plain text on the clipboard, so pasting
into a document preserves headings, emphasis and lists. Reference documents
support rich-text editing and autosave standard HTML in the book's JSON metadata;
manuscripts remain HTML files. Export chat retains the original transcript text.
Raw HTML in model responses is displayed literally;
images and link references do not load resources or navigate away from the app.

**Settings → AI** contains editable purpose-specific instructions for General /
Brainstorming, Characters, Locations & Settings, Worldbuilding, Plot & Outline,
and Revision. Choose a type from the **Assistant type** selector in each chat;
the choice follows that chat in either window. Existing chats default to General.
Instructions are saved on this device in `ai-assistants.json` and reread on each
new message, so a saved edit applies to all chats using that type. Use **Revert**
to discard edits or **Restore default**, then **Save instructions**, to reset a
type. Context choices remain explicit and unchanged; changing type does not
attach extra documents. Compaction uses shared summarization instructions to
preserve facts and decisions rather than generate new specialty advice.

Open a book and select **AI Assistance**. Each book has its own saved
conversations, listed as individual items under **AI Assistance** in the sidebar.
Click an item to reopen its history, draft, model and context selection. Existing
saved conversations are added to the sidebar when their book opens.
**New chat** starts a conversation; the conversation dropdown also switches chats.
**New document** in the AI Assistance section or a folder's menu creates a named
chat inside that location. Rename it using **Edit**, double-click its sidebar name,
or edit the adjacent name field. Chats can be dragged into folders and other
sections; they retain their chat interface and are excluded from manuscript prose
and exports. **Delete** removes the navigation item; undo restores it while the
book is open. Conversation data is retained in `ai-chats.json` for recovery.
Ordinary documents previously created under AI Assistance remain intact and
editable; moving a normal document there also keeps it a normal document. Choose a
saved connection and a model from the selector beside it. **Discover models**
refreshes that selector, and its list is remembered for each connection on this
device. **Enter model ID…** in the selector lets you specify a model manually.
Changing the model here applies to that conversation.

In **Settings → AI Connections → Response settings**, set the selected model's
maximum reply tokens (1–131,072; default 4,096) and optional temperature (0–2).
Leave temperature blank to use the provider default, including models that do not
support that parameter. Provider limits still apply. **Save connection** saves
these defaults per connection and model on this device. Switching models restores
their settings; **Restore response defaults** fills the fields and Save applies it.
Normal replies use these values. Manual compaction keeps a 4,096-token ceiling and
provider-default temperature so a short reply preference does not cut its summary.

Replies stream into the conversation. **Stop** keeps the partial reply.
**Copy** copies a message. `Enter` sends from the message box, and `Shift+Enter`
adds a new line. `Ctrl/Cmd+Enter` also sends.
**Retry response** starts a new chat using the prompt before that reply.
**Edit and resend** opens a prompt editor; **Send as new chat** submits the revision.
Both copy only the earlier history, preserve the original chat and its draft, and
use the current model, instructions and selected documents. New chats appear in
navigation with Retry or Revised in their names. A summary is carried forward
only if it ends before the retried or revised prompt. Cancel leaves the chat unchanged.
**Export chat**, beside **Compact conversation**, saves the complete original
conversation as a new document at the root of **Notes**. It includes your messages,
assistant replies, and stopped/failed reply markers. Rename or move that document
using its navigation menu. Repeated exports create separate snapshots with numbered
names; earlier snapshots and the saved conversation stay intact. Finish or stop a
reply before exporting. Unsent drafts are not included.
**Open in separate window** moves chat into an independent window that can be
placed on another monitor; **Return to workspace** docks it again. Drafts and
transcripts are saved in `ai-chats.json` inside the book folder. Closing the
workspace or changing books stops pending replies and saves received text.

**Compact conversation** summarizes older turns using the selected model,
leaving the most recent two exchanges in full. Review and edit the summary,
then choose **Use this summary**. Future requests include that summary and
recent messages. The complete original transcript remains readable and saved;
**Restore full history** includes all original messages in requests again.
The preview compares estimated input size before and after the edited summary.
Compaction remains manual; approaching a limit never starts a model request.

**Context details**, beside **Choose context**, contains the context meter,
which estimates the next message's input plus the saved reply-token allowance
(default 4,096). Changes saved in AI Connections update the estimate immediately.
The dialog breaks this down into assistant
instructions, selected documents and source labels, the active summary, recent
messages, your draft, and message overhead. It lists included document paths and
excluded/missing selections. Estimates refresh as drafts, sources, and instructions
change. They use roughly four characters per token plus template overhead; actual
tokenization varies by model and language. An over-budget warning does not block
Send or silently truncate text.

**Discover models** reads reported context limits where available. LM Studio's
optional [native model endpoint](https://lmstudio.ai/docs/developer/rest/list)
provides the loaded instance's context size; a model's theoretical maximum alone
is not used. Compatible model lists such as
[OpenRouter's model catalog](https://openrouter.ai/docs/api/api-reference/models/get-models)
can report context limits too. Unsupported endpoints leave the capacity unknown.
Discovery never loads or unloads a model. Rediscover after changing server load
settings. The display identifies when a reported size was discovered.

In **Context details**, enter a **Context limit override (tokens)** and choose
**Save limit** to use a manual capacity. Leave it blank and save to return to
discovery. Overrides and cached capacities are device-local JSON in the connection
settings, keyed by connection and exact model ID; they survive restart and are
cleared when the connection's endpoint or API changes. They do not change the
server's loaded context size. Original chat text stays in the standard JSON
transcript, including after compaction.

**Choose context** opens a searchable list of navigation documents with their
section and folder paths. Select documents and expand their text previews, then
choose **Use selected context**. Selection is saved per conversation; new chats
start with no documents selected. Folder/document **Use as AI context** exclusions
apply on every send, and Darlings is always excluded. Excluded documents show a
reason; deleted or excluded selections are skipped without discarding your choices.
Stable IDs keep choices attached to documents when they are renamed or moved.

Each request uses the latest live text, including edits awaiting autosave. The
message lists the source paths used. Source text is attached separately from chat
history and is not copied into the saved transcript or fed into compaction as an
extra document. Earlier replies and summaries may still discuss previous sources;
start a new chat when you need a conversation without that material. **Clear
selection** returns future requests to chat history only. Selection and previewing
make no model request. The context meter resolves the latest selected text from
the workspace. No text is silently truncated.
Book instructions, approved memory, and writing tools are planned next.
`npm run test:chat` tests both streaming API formats, compaction, saving,
cancellation, window detachment, context selection/exclusions, live edits and book
isolation against a local mock server.

## Workspace navigation

The desktop workspace has a left sidebar for writing, story references,
notebook sections, and AI Assistance. Expand Manuscript directly to navigate
its folders and documents. Its menu creates folders and documents.
Every section supports folder/document organization, including
Outline, Research, Notes, Darlings, and AI Assistance. Select a section heading
to use its existing tools; select a child to open that folder, document or chat.
New documents created from AI Assistance menus are chats.

Every folder has a menu with **New folder**, **New document**, **Edit**,
**Use as AI context**, and **Delete**. Document menus contain **Edit**,
**Use as AI context**, and **Delete**. Edit renames the
item; double-clicking its sidebar name also opens the rename dialog. New items
are always children of the section or folder whose menu was used. Section
headings remain fixed and have New folder / New document menus.

The AI context checkbox defaults to on. Turning a folder off excludes all
descendants, including new items added later. Individual exclusions remain
when a parent is turned back on. A disabled checkbox explains which parent
excludes an item. Darlings are always excluded. Choices are saved with the book
and travel with items when moved. The existing AI cover feature honors these
exclusions; AI Assistance uses the same eligibility rule for chosen documents.

Deleting a folder also deletes its contents, with confirmation. Deleted
manuscript text is kept in Darlings. Ctrl/Cmd+Z with focus in the navigation
can undo a deletion while the book stays open, including reference documents.

Select a folder to browse its contents. Drag a folder or document by its name
or the dotted grip beside its menu.
The middle of a folder row moves the item inside it; the upper and lower edges
place it before or after that folder. Document rows accept drops before or
after themselves. Drop onto the section heading to move to the end of the root.
A line marks reordering, a highlighted row marks nesting, and a caption names
the destination. The sidebar scrolls near its edges during a drag; Escape
cancels. Folders and documents can move between all navigation sections;
folders retain their descendants. Dropping onto Darlings keeps the whole item
there, and it can be dragged back to any section. Moves cannot create folder cycles.
Ctrl/Cmd+Z from navigation undoes a move while preserving later document edits.

Manuscript moves update the document order used by the outline and exports.
Moving text out of Manuscript removes it from manuscript word counts and exports.
Moving it back restores its content and formatting. Existing Notes pages and
saved Darling passages remain available below their section's folder browser.
Folder and document names appear in navigation and the toolbar path, without
adding numbered chapter or scene headings to manuscript pages or exports.
Headings written by the author remain part of the text. Document word counts
appear in the bottom bar instead of beside sidebar items.
Existing chapters retain their IDs and text files.
Folder structure and reference text are saved with the book in book.json.

The sidebar edge can be dragged to resize it (or focused
and resized with the arrow keys). The toolbar button hides or shows navigation.
Width and collapsed state are remembered on this device. Word counts, goals,
and zoom remain on the bottom bar.
Click the Document or Manuscript progress bar to set its word target, or leave
the target blank to remove it. Counts update while writing, and the document
target follows that document when renamed or moved. Without a target the track
stays empty and shows the word count. The daily count still opens goals and sprints.

The arrow beside Outline opens its separate window. When detached, selecting
Outline brings that window forward. Notes & Comments in the toolbar toggles
the existing manuscript comments pane. Research has a section preview page;
AI Assistance opens the chat described above. Its folders and documents remain
accessible through the navigation tree.

## Detached outline window

Open a book, then choose **View → Open Outline in Separate Window**
(`Ctrl+Shift+U` on Windows/Linux, `Cmd+Shift+U` on macOS), or use the button
in the Outline tab. Move the window to another monitor if desired. It
follows the open book, shows chapter word counts and the current chapter,
and supports editing chapter summaries and section notes, adding chapters
and sections, and opening a chapter in the manuscript. **Return to workspace**
closes the separate window and opens the Outline tab.

Outline and AI Assistance are detachable. Other panes are not detachable yet.
The main process manages window placement and routes commands to the existing
manuscript session, which remains the single writer and owner of editing
history. The outline receives live snapshots; it does not independently
read or overwrite book files. Conflicting note edits keep a recoverable
draft and require an explicit choice before overwriting the latest text.
Pending edits are flushed before changing books or closing the workspace.

Each pane remembers its window bounds and is moved back onto an available
screen when reopened. Linux Wayland compositors may control placement
instead of honoring the saved position.

## Developing and building this fork

Use Node.js 24, then `npm ci` and `npm start`. Run `npm test` for the window
placement tests and `npm run test:panes` for the Electron integration tests.
The integration tests use a temporary library and hidden windows; on a
headless Linux machine run them with `xvfb-run -a npm run test:panes`.

Build on the corresponding operating system with `npm run package:win`,
`npm run package:mac`, or `npm run package:linux`. Linux uses AppImage;
Flatpak is not configured. The desktop GitHub Actions workflow tests and
builds on all three operating systems. Manual runs upload build artifacts;
version tags also collect them into a draft release in this fork.

macOS distribution signing/notarization uses repository secrets `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
`APPLE_TEAM_ID`. Without them, CI creates unsigned development artifacts.
Windows builds are currently unsigned as well.

This fork has its own application identity and defaults to
`Documents/Neo-AI Library`. Existing NEO books stay in their original
location. To use an existing library, select **File → Library Folder…**;
use a copy when testing changes. Updates point to `raycrews/neo-ai`.
Changing the library folder restarts the app. Windows portable builds restart
through the portable launcher and use a separate temporary directory per
launch, so cleanup of the old instance cannot remove the new instance.
If a saved library cannot be read, startup offers Retry, Choose Library Folder,
or Quit instead of silently opening an empty local library. For a NAS, use its
direct network path when a mapped drive is unavailable in some launch contexts.
Error logs are stored in the app's user-data folder so NAS failures can be logged.

The original project's documentation follows; references to NEO's default
library and releases below describe the upstream application.

---

# Original NEO documentation

**A distraction-free word processor for authors, by a wannabe author.**

NEO understands from the moment you install it that you are writing *books* and nothing else. No bloat, no distractions, with manuscripts that look like books as you write them.

NEO runs locally. WIPs are saved in plain files on your disk. No accounts or subscriptions. And it's free!

## Download

Get the latest installer from the **[Releases page](../../releases)**:

- **macOS** — download the `.dmg` for older Intel machines or the arm64 file for Mac silicon. Open it and drag NEO to Applications.
- **Windows** — download the `.exe` and run it. Or get the setup installer and run that.
- **Linux** — download the `.AppImage`, make it executable, and run it:

  ```
  chmod +x NEO-*.AppImage
  ./NEO-*.AppImage
  ```

  If it complains about a sandbox (common on Ubuntu 24.04 and newer), run it as `./NEO-*.AppImage --no-sandbox`. Your library lives in `~/Documents/NEO Library`; File → Library Folder… moves it anywhere you like.

## Why NEO?

**The bookshelf** 

Your library looks like a bookshelf, not a file list. Labeled shelves you organize however you like — by series, by status, by pen name. Progress bars on the covers show how far you are from your word goals. You can drag-and-drop books anywhere. You can also drag shelves around and put cover art on your titles.

**Just a blank page** 

There's a white page by default or a dark mode (which I now prefer!). Controls fade until you mouse over them. Chapters number and renumber themselves automatically. Drop caps mark chapter openings, because I'm a sucker for drop-caps. Em dashes, true ellipses, and curly quotes sort themselves out as you type. Spellcheck exists only when you invoke it — no more red squiggles mid-sentence triggering your imposter syndrome.

**Enter, Enter, Enter** 

One Enter: new paragraph. Two: a `***` section break. Three: a new chapter. The goal is to KEEP WRITING.

**Darlings** 

The writing advice is "kill your darlings" — but I say: *keep the bodies*. Drag any beautiful-but-in-the-way passage onto the Darlings tab. It leaves your manuscript but isn't lost. Darlings restore to the exact spot it came from. More like zombies than darlings.

**Placeholders** 

Mid-flow and need a name, a fact, a date? ⌘⇧X drops a mark and a sticky note. The left panel shows a red dot on every chapter that you need to get back to. The right panel will list all these to-do items.

**Outlining for plotters** 

Outline chapters and sections in the Outline tab; section notes appear in the manuscript as gray ghost paragraphs, ready to be overwritten. Pantsers can ignore all of it or learn to draw a freakin' map for the first time. Try it. You might like it!

**Cover Art** 

Every book gets a cover! New books are dressed in a seeded abstract (six art styles, six type templates, typefaces bundled with NEO) so no two stories on the shelf look alike. Once a story passes 1,000 words, NEO can read it and paint an abstract cover from the text. This is a bit more work but totally worth it. Get an OpenAI API key from their website and paste it into **File → Cover Art…**. The art is generated in the background for about a penny a picture. (These are not meant for publication, just writing inspiration!) The API key is stored encrypted in NEO's own settings, never in your library folder. The title and author are always set in real type on top, so the lettering is never left to a gen-AI model. The ↻ on any book re-rolls its type and colors, or paints it again. And you can always switch back and forth from the seeded modern look to the painted variety.

**Goals and momentum** 

Daily word goals, word sprints, and a NaNoWriMo-style progress chart. Needs more testing, but I think it works okay!

**Exports** 

Choose a format under **File → Export**, then select the documents to include.
Manuscript documents are selected by default; reference documents can be added.
Export follows sidebar order. By default, top-level manuscript folders become
chapters and their documents become scenes, separated by `***`. Choose document
titles or no headings instead, and review the export order before saving.
HTML, PDF, Word and EPUB preserve headings, emphasis, underline, strikethrough,
lists, alignment and line breaks. Markdown preserves supported text formatting;
plain text retains the words, list markers and scene breaks. AI chats keep their
separate **Export chat** action.

For PDF and Word, enable **Page numbers** in the export dialog to add centered
footer numbers. Numbering starts at 1 on the first exported chapter; the cover
and title page remain unnumbered. Leave the checkbox off for an unnumbered copy.

**Chapter numbering** offers **As named**, **Arabic (1, 2, 3)** and **Roman
(I, II, III)** for every export format. Arabic and Roman numbering follow the
selected manuscript chapters from 1, replacing existing “Chapter 2” or “Chapter
II” prefixes while preserving subtitles. Reference document titles and saved
workspace names stay unchanged. **No headings** disables chapter numbering.

EPUB 3 with a proper table of contents built to KDP's guidelines, Word .docx, PDF, HTML, markdown, and plain text. Email a timestamped PDF snapshot to yourself with a SHA-256 fingerprint of the text in the body. Might come in handy someday.

**Import** 

Bring in existing .docx, .txt, and .md manuscripts; chapters and scene breaks are detected automatically. This is still a bit rough and might require you to tweak things. It will try to grab your title and remove that from the body, and it seems to be working okay.

**Search book**

Use **Search book** in the workspace toolbar, or **Ctrl+Shift+F** (**Cmd+Shift+F** on Mac), to find a word or phrase across the current book. Results show the document path and matching text, with a section filter. Search includes manuscript and reference documents, Notes, outline notes, Darlings and original AI chat messages, including messages retained after compaction. AI context exclusions do not affect search. Select a result to open its document or jump to its chat message; detached chats stay in their own window. Search runs locally and sends no content to an AI provider. Reopen search to refresh it after edits. **Ctrl/Cmd+F** keeps the existing manuscript Find & Replace.

**Backups** 

Neo-AI autosaves your work and creates a daily ZIP of the library at startup, retaining the last 14 daily archives. In **Settings → General → Backups**, use **Back up now** to save open documents and chats and create a manual snapshot. This stops any AI reply in progress, keeping its partial text. Manual snapshots remain until you remove them. The panel shows the latest backup and its folder, with an **Open backup folder** button.

**Restore backup…** validates a library ZIP and previews its books before asking where to create a separate recovered library folder. **Open recovered library** saves your current work and restarts there; your original library remains intact. You can switch back using **Library folder → Browse…**. Restored documents and chats use the same ordinary HTML and JSON files as the original library.

Backups exclude the Backups and Exports folders and device settings/API keys. They support libraries up to 1 GB and 50,000 files. Copy important ZIPs to another drive for protection against drive failure. You can also email copies of your WIP to yourself with a keystroke: ⌘E.

## Your files

Everything lives in `~/Documents/NEO Library` — one folder per book, chapters as readable HTML, metadata as JSON. Open them in your favorite text editor.

## Languages

NEO speaks English, French, Spanish, Portuguese, German, Italian, Dutch and Polish. Pick one under **View → Language**; on first launch NEO follows your system language when it has it. Adding a language is a single file, no programming needed: see [TRANSLATING.md](TRANSLATING.md).

## Building from source (for the eggheads):

Requires [Node.js](https://nodejs.org).

```
git clone https://github.com/raycrews/neo-ai.git
cd neo-ai
npm install
npm start
```

**Help → Keyboard Shortcuts…** opens the shortcut reference. You can also press `Cmd+/` on macOS or `Ctrl+/` on Windows and Linux.

To build installers: `npm install electron-builder --save-dev`, then `npm run package` (macOS), `npm run package:win` (Windows), or `npm run package:all`. Output lands in `dist/`.

Windows builds include `Neo-AI-<version>-win-x64-Setup.exe` for installation and
`Neo-AI-<version>-win-x64.exe` for portable use. Both use the same device settings
and reopen the chosen library; they do not require Node.js on the user's computer.
The installer offers **Keep existing settings** or **Start fresh**. Fresh setup
creates an empty library and a separate device profile; previous books and
preferences remain on disk. Settings → General → Library folder reopens an
existing library. No personal settings or books are bundled in the installer.

**File → Email Settings** lets each user choose the default email app, Gmail,
Outlook.com, or Apple Mail on macOS. Email draft creates a PDF and opens a compose
request. For the default app and browser services, attach the PDF from the opened
folder and send it yourself. Neo-AI does not send email automatically.

**Settings → Keyboard Shortcuts** remaps app menu commands, checks for conflicts,
and restores defaults. Standard text editing keys and writing gestures stay fixed.
The Help shortcut reference reflects custom menu bindings.

The app is very simple: an Electron shell (`main.js`), a preload bridge (`preload.js`), and a renderer (`app.js` + `styles.css` + `index.html`). If you know JavaScript, you can change NEO. Have at it.

## Roadmap (things I'm dreaming up but may never get to):

Chapter version history · manuscript format for agent submissions (Times New Roman, double-spaced, address block, just to make Kristin Nelson happy) · global end matter that updates every book at once (same for copyright pages, bios, etc).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Fair warning: NEO is opinionated by design, and bloat killed every writing app I've ever tried. If you want complex, try Scrivener. It really is a great application beloved by many! There are so many wonderful writing apps out there! Nobody needs to use this but me.

## License

[MIT](LICENSE) — free to use, free to modify, free to share.

## Philosophy

If you didn't know, I opened up the Silo universe to fan fiction years ago. And not just to put on fan fiction sites, but you can charge money for the things you write and keep every penny of the income! Lots of incredible Silo Stories out there. But readers are forever looking for more.
