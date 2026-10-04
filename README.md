# LGA Shot Docs

Documentation for VFX work, in the spirit of Notion or Coda but much simpler. Write the VFX
pre-production notes for each scene, fill in the on-set reports during the shoot, and keep each show in
its own project: a tree of pages you own.

## Goals

- Copy one annotated JPEG/PNG or simple static WebP photo from the photo viewer as a full-size PNG: prepare it first, then tap Copy. Browser image-clipboard support is required; the unchanged original remains available. HEIC, large mobile images, folders and FrameRev export remain pending.
- On phones, the Download and Copy menus in the photo viewer stay within the screen, wrap the complete file name and show the dimensions. Scroll the menu when its remaining buttons are below.
- On editable workspace pages, an annotated Drive photo’s existing Download button also offers annotated Download and Copy, including photos in rows, inline and in table cells. Original stays available.

- **Projects.** Each show or job is a project with its own tree of pages. Switch between them from the
  top of the sidebar without leaving the page you are on.
- **Search.** Ctrl/⌘+F finds and replaces in the open page. Ctrl/⌘+K (or the magnifying glass next to
  "+" in the sidebar) searches the titles and text of every page in the project, on your device and
  offline, takes you to the exact spot (collapsed sections that hide a match open while you search and fold back when
  you close the bar), and lists matching projects to switch to. Its arrow opens **Replace
  across the project**: a preview of every change, replace one, a page or all of them (after a confirmation that
  says how many changes in how many pages), and *Undo* puts back everything nobody changed afterwards.
- **Pages and subpages.** A sidebar with a tree of pages, as deep as you need. Every page can hold
  content and other pages; a "folder" is just a page with no content.
- **Visual editor.** Headings, lists, checklists, tables and images. You never see Markdown; it is only
  used behind the scenes to import, export and back up your pages.
- **Undo in the order you edited.** Ctrl/⌘+Z undoes your last change in the project even if it was on another page:
  the app takes you there and undoes it in view (*Back* returns you). A replace across the project is one step, undone
  and redone in every page it changed. If a page was in the trash during undo, restore it before your next undo to
  undo its replacement first, then the earlier edits. Ctrl/⌘+Shift+Z redoes. It lasts until you reload the tab.
- **Script text.** Paste a screenplay and turn it into *Script*: it shows in a screenplay typeface, with
  INT/EXT, DAY, NIGHT and DAWN/DUSK marked in color.
- **Templates.** Reusable page layouts such as *Pre-production Notes*, *On-Set Report* or *Shot
  Breakdown*. Pick one when you create a page and start filling it in, or save any page as your own template.
- **Works everywhere.** macOS, Windows and iPhone, from the same app.
- **Real page sizes.** A page can be free-form or set to a paper size (A5, A4, A3, Letter), per page or
  for a whole branch. What you see while editing is exactly what the PDF export looks like.
- **Assistant with your own key.** Add your own API key from Anthropic, OpenAI, Google Gemini or an
  OpenAI-compatible service (OpenRouter, or a local model such as Ollama) and fix, improve, shorten, translate,
  rewrite or reshape what you select, summarize and translate a whole page, or suggest a caption for a photo. You see
  a preview first; applying it is a regular edit: synced, versioned and undoable. The workspace owner can turn it off or allow only local models.
- **Dictate to report.** Write or dictate (with the app's microphone or your keyboard's) an informal note on set, like “this shot
  was a 50 mm”, and the assistant places each piece where it goes in the report: the right row and column, the line
  after its label, the checkbox. You check every change before applying it, and nothing you said is lost.
- **Offline first, nothing lost.** Every change is saved on your device first and synced when you are
  back online. Edits made offline on two devices are merged, never overwritten.
- **Share a branch, never the tree.** Inside a workspace, people get a role and a permission on a
  project or a page (view, comment, edit, or edit and create pages). A permission covers everything under
  that page and nothing above it: parent pages and sibling branches stay private. Clients join as guests
  and sign in to see only the pages shared with them. A page can also be shared with *Anyone with the link*: they
  open it without an account, see that page and the ones inside, and comment with a name.
- **Your look, everywhere.** Light or dark theme, a default or an editorial typeface, text contrast
  (headings, bold and body text in three shades, also in the PDF), text size and page width, saved in
  your account and applied on every device. Scene titles like `064 | Name | Place` show
  as a short code and a name in the sidebar, and each page can show the pages that contain it above its
  title.
- **One app, many workspaces.** The same app connects to several workspaces. Each workspace is an island
  that runs on its owner's own Supabase, Google Drive and file gateway: nothing from one workspace goes
  through anyone else's servers, and nobody needs to publish their own copy of the app.

## Status

In development. What works today:

- Email sign-in with an 8-digit code, which works inside the installed iPhone app (a sign-in link would
  open Safari instead). It needs your own mail server (SMTP) in Supabase, and sign-ups are invite-only.
- The page tree, the block editor with autosave and pasted images, light and dark themes and
  per-account appearance settings. The app can be installed (PWA): *Install app* in the account menu (and a
  dismissible banner on phones) shows the exact steps for iPhone, Android and desktop, with a direct *Install*
  button where the browser offers one. On iPhone the installed app keeps its own storage, which Safari does not
  clear.
- Offline first: every edit is saved on the device first and synced when a connection is available;
  edits made offline on several devices are merged.
- Projects, each with its own page tree (v0.013).
- Script text, a resizable sidebar and paper sizes per branch (v0.015).
- Hosting on Cloudflare, and encrypted database backups four times a day.
- A guard against content the running version does not know (the page does not open and nothing is
  deleted), a minimum app version per workspace, and a database generation so devices re-upload their
  work after a backup is restored (v0.021).
- The file gateway with Google Drive: resumable uploads and streaming, tested on desktop and iPhone
  (v0.022 to v0.028).
- Photos and videos in pages go to the owner's Google Drive: saved on the device first, uploaded in parts
  that resume after closing the app or losing the connection, with a small thumbnail on the page that is
  swapped for a sharp version (up to 2048 px, made on the device) when the photo is shown large. The
  owner chooses where the folder goes (account menu → *Google Drive*).
- The media carousel: tap a photo or video on a page to see all of the page's photos and videos full
  screen, in order, with swipe, pinch and wheel zoom, video playback, download of the original and the
  thumbnail when offline or when the browser can't play a file.
- The team: the owner and admins manage people from the account menu (*Members*: invite with a link to
  send, change roles, remove), and projects and pages are shared from their menu (*Share…*) with view,
  comment, edit, or edit and create pages. What you cannot change shows read-only, also offline.
- Comments and questions: comment on any block (or the whole page) from a side panel, or a bottom sheet
  on the phone, with replies, resolve and edit, also offline; a *Question* paragraph is answered in its
  comment thread, so a guest with *Comment* can answer without editing the page.
- Several workspaces: a welcome screen to join one with an invitation link or connect one you created with
  the guide, and a workspace list in the project menu to switch, join, create or remove one from the device.
- A file trash per project: photos and videos no page uses anymore show in the *Files* tab of the trash, and
  the owner and admins can send them to the Google Drive trash (recoverable there for 30 days).
- How much each project takes in the owner's Drive: in the project menu, in the *Google Drive* dialog (owner
  only, with the Drive trash and what is still uploading) and at the top of the file trash (v0.050; it shows
  once the workspace database is on version 7). After *Delete forever*, files that never reached Drive no longer
  count toward the project size; files in the Drive trash keep counting there for 30 days.
- In *Share*, the team sees the exact number of files added through all links to the page, including earlier
  links, even beyond 500 files; the list shows the newest 20.
- Google Drive links: paste one and keep it as a link, as plain text, or as a card with the Drive player.
- Links to other pages: a link to a page of the app opens it in the same tab (Ctrl/⌘+click, in a new one).
- Photos in the line of text (v0.078): pasted, dropped or picked photos and videos go into the line, where the
  text cursor is (or where you drop them), like characters: text can sit next to them, they flow to the next line
  when they don't fit, and you select several with Shift+click, Shift+arrows or by dragging. A single one comes
  in at its own size, several at a third of the line each. They do everything the older block photos do: resize
  handles that snap to 1/1, 1/2, 1/3 and 1/4, and the same toolbar for both, in groups: view and download | sizes
  (for every selected photo) and *Arrange in rows* for the selected ones | align | comment | replace, rename and
  delete. There is no caption button anymore (existing captions still show). Other files still come in as a card
  below. The PDF splits a paragraph of photos between sheets only between rows.
- Photos in table cells: with the cursor in a cell, pasted, dropped or picked photos go into that cell as
  thumbnails as tall as a row, side by side. Their toolbar has *Thumbnail* and *Full cell width* (handles resize them inside the cell);
  they open full screen like any photo and print the same. Photos in a cell of a Coda table stay in their cell.
- On phones, *Take photo* and *Record video* in the slash menu and page menu open the phone's camera and add
  the result at the cursor. Videos need the workspace's Drive. Computers and tablets can add existing photos and
  videos. If Request Desktop Site hides a phone's identity, switch back to the mobile site for the camera actions.
- Photos in rows: the first click selects a photo (handles and its toolbar), the second opens it; quick sizes
  (full, 1/2, 1/3, 1/4 of the page) put photos and videos side by side, *Arrange in rows* lays out a run of
  photos in rows of equal height, and on the phone each account chooses rows or stacked. The PDF keeps the
  rows and breaks sheets where the page shows them. Photos added before v0.078 keep working this way.
- Replacing a photo block or a photo in a row keeps your latest file choice when saves finish out of order,
  even after selecting text and returning to the photo. If that choice fails, the current photo stays with an error;
  an older pending choice does not replace it. A changed source or a closed or read-only page stays untouched.
- Replace one annotated Drive photo on an editable page: **Keep annotations?** offers **Yes** when the new image has exactly the same proportions after orientation. **Yes** copies all its drawings, **No** replaces without copying, and **Cancel** or Escape keeps the current photo. This works for blocks, rows, inline photos and table cells, also offline. The original stays intact, replacing and copying share one undo step, and a newer choice never revives an older pending replacement. If dimensions or annotation data cannot be checked, replacement without annotations remains an explicit choice.
- Annotate photos on a computer: *Annotate* in a photo's toolbar (or A in the full-screen viewer) draws arrows,
  ellipses, rectangles, lines, pencil and marker strokes, text and numbered markers on top, with the tools, letters,
  colors and thickness of LGA FrameRev. The original never changes; annotations show on the page, in table cells, in
  the viewer and in the PDF, are saved as you draw (also offline) and appear live for everyone editing the page. Only
  people who can edit the page annotate.
- Annotate photos on a phone or an iPad: the tools sit in a strip at the bottom and the color dot opens the colors and
  thickness; one finger draws, two fingers zoom and move the photo without drawing, and text is typed in a regular box
  with the phone keyboard. Once you use a pencil (Apple Pencil on the iPad), only the pencil draws and your finger moves
  the photo, like in Notes.
- In the full-screen viewer, **Download → With annotations** prepares a local JPEG/PNG copy with the page’s drawings at full original dimensions. The original stays untouched, and it works offline with a full local original. Simple static WebP (one VP8 or VP8L chunk) is exported as PNG with its filename and full dimensions shown before saving. Animated WebP and WebP with metadata are rejected without flattening; Original keeps the unchanged bytes. HEIC and other formats, public links, and photos too large for the device (including 48 MP on phones) are not supported yet; Original remains available, with no automatic reduction.
- Copy or cut an annotated photo and paste it on another page of the same project: its annotations come with it (also
  into another window of the app), pasting twice doesn't repeat them, and undo right after pasting removes the photo
  with them. On a page of another project it arrives without them, and nothing of the annotations goes to the
  clipboard.
- iPhone photos (HEIC) are converted to JPEG on your device when you add them to a page, so every browser
  shows them; the converter is downloaded only the first time it is needed.
  Older HEIC photos still queued on this device are also prepared as JPEG before their upload starts. Registration is checked before the original is replaced; an already registered HEIC keeps its original format, and uncertain results keep the original protected.
- Attach any file (PDF, zip, anything): drop or paste it, it goes to the owner's Drive and shows as a card;
  a PDF shows its first page as a preview (also offline once seen), opens in a new tab, and everything else
  downloads with its name. In the full-screen viewer, files appear large among the photos, with Open and Download.
- Drop a whole folder, subfolders included: a window shows what goes up, it uploads to the owner's Drive and
  stays in the page as a folder card. Opening it shows what is in that Drive folder right now, with thumbnails,
  the photo viewer and downloads; whoever sees the page sees the folder, and nothing above it.
  Choose List or Grid to browse the same folder; Grid shows full thumbnails, and this device remembers your view.
  *Download all*
  saves the whole folder as a .zip (in Chrome and Edge on a computer, written as it arrives and with no size limit,
  or straight into a folder; elsewhere, built in memory up to 1 GB, 500 MB on a phone). Cancel also stops a download
  whose server error response stalls; it discards the unfinished zip or keeps completed files in the chosen folder.
- Collapse sections by their headings: a triangle next to any heading hides everything up to the next heading
  of its level (just for you, saved on the device; Ctrl/⌘+Alt+Enter, and *Collapse all* in the page menu).
  Shift+click collapses or expands it for everyone who views the page (if you can edit it); the tooltip says
  which. Dragging a collapsed heading, or Ctrl/⌘+Shift+↑/↓, moves its whole section.
  Deleting a collapsed heading deletes its whole section; sheet marks still count everything and the PDF
  prints it all open (or as shown, with *Print as shown* in the page menu).
- Archive and delete projects: icons next to each project in the project menu (a "⋯" on the phone). Archiving keeps
  the project as it is, out of the everyday list; deleting asks you to type *delete* and moves it to *Deleted
  projects*, from where it can be restored exactly as it was. Nothing is erased, and its files stay in Google Drive
  unless the owner or an admin ticks *Also send its files to the Google Drive trash*: then its whole folder goes to
  the Drive trash, and restoring the project within Google's 30 days brings it back.
- Keyboard in the page tree: ↑ and ↓ open the previous or next page, → and ← expand and collapse (← on a page with nothing to collapse goes to its parent page).
- Page breaks and PDF: pages with a paper size show where each sheet starts, and *Export PDF / Print* in the page menu prints exactly those sheets. A manual page break (*Page break* in the / menu, or Ctrl+Enter, ⌘↩ on a Mac) makes what follows start on a new sheet, on screen and in the PDF.
- Export a branch or a whole project as PDF: *Export…* in the page menu (the page and the pages inside) or *Export project…* in the project list. It starts with a contents page that links to each page and says on which PDF page it starts, every page keeps its own paper size (in Chrome or Edge on a computer), photos keep their annotations and go as they were taken, at full resolution (tick *Smaller file* for a lighter PDF with photos scaled to their printed size), and comments can be included with names but never email addresses. If it is too much for one PDF on the device, it comes out in parts (*Part 1*, *Part 2*…), split between pages, and at the end any page that could not be exported is listed with a link and *Export again*. Pages in the trash are never included, and a guest exports only what they can see.
- Original photo downloads for a PDF can take as long as needed while data keeps arriving. If a download receives
  no data for 30 seconds, the PDF uses the available lower-resolution copy and lists the page with *Export again*.
- Links to files in a PDF: in an exported or printed PDF, every attachment, folder and video links to the file, with its name below (photos don't). Whoever opens the link signs in and sees the file only if they can see a page where it is; if not, they just see that they don't have access. *Export…* can use the page's public link instead, after saying which page and level it opens. Offline, it warns about file links only when the PDF contains attachments, folders or videos, and about lower-resolution photos only when their originals are missing from this device.
- Request access: whoever opens a file link or a page link without access can ask for it, even with nothing shared yet; the people who can share that page (or a page with that file) see the request in the bell and in *Share*, and give access to that page (never less than the person already has) or decline it.
- Export a branch or a whole project as a zip to archive it: a folder for each page with the page as a web page that opens in any browser without a connection, its text as Markdown, a JPEG of every photo (also iPhone HEIC photos), the original photos, attachments and videos from Drive if you tick them, and the comments with names but never email addresses. It also keeps the blocks and the page tree for importing it back later. On Chrome and Edge on a computer it is written as it is made (or into a folder); in other browsers it is built in memory. Only the workspace owner and admins can export a zip, and only from a computer.
- Import a Shot Docs archive: *Import Shot Docs archive…* in the project list brings an exported zip (or its unzipped folder) back as a new project, never on top of an existing one, with its pages in order, sheet sizes, blocks, collapsed headings, photo annotations, template marks, comments with their names and dates, and photos and files, which upload to the workspace's Drive. A photo whose original was left out comes back from its preview; a video or file that is not in the zip keeps its name in its place. If it stops, choosing the same zip again resumes without repeating anything. Only the workspace owner and admins can import.
- English and Spanish: the whole interface in both languages, chosen in the account menu and saved in your account (Script is *Guion* in Spanish).
- Available offline: mark a page (with its subpages) or a whole project from its menu, choose what to keep (large
  photos, original photos, attachments, videos) with the size of each, and it downloads everything needed to use it
  without a connection and keeps it up to date. *Storage on this device* (account menu) shows what the app keeps,
  with a limit you choose (2 GB by default): past it, the app asks before removing copies of files already in Drive.
  Without a connection the app says *Offline* with what is waiting to upload.
- Help and a guided tour: the "?" at the bottom of the sidebar (or *Help and shortcuts* in the account menu)
  explains every feature and lists every keyboard shortcut, with a search box. The first time someone signs in,
  a two-minute tour with Next walks through the app on a practice page that is never saved or synced; it can be
  replayed, and the practice page reopened, from the help. *Show me* on an entry opens the practice page at just
  that step and brings you back; a dot on the "?" means there is something new, listed under *What's new*.
- Assistant (account menu → *Assistant…*): choose Anthropic, OpenAI, Google Gemini or an OpenAI-compatible service,
  paste your API key and pick a model from your provider's list. The key is stored encrypted on that device and sent
  only to that provider. *Sync across my devices* encrypts it on the device with a six-word passphrase the app proposes
  and stores only that encrypted copy in the workspace, so another device unlocks it with the passphrase (on a borrowed
  computer, only for that tab); *Change passphrase…* re-encrypts it, the voice key travels in the same copy, and *Sign
  out other devices* in the account menu is there for a lost device. Select text and press Ctrl+Alt+J (⌘⌥J on a Mac), or use *Assistant* in the toolbar or the
  page menu: *Fix spelling & grammar*, *Improve writing*, *Make shorter*, *Translate to…* or *Ask…*. The preview marks
  what changes word by word; *Apply* replaces it as one edit you undo with Ctrl+Z, and nothing is applied if the text
  changed while the assistant was working. Photos and links inside the selection stay. *Format as…* turns the selected
  lines into a bulleted list, a checklist, a table or headings. *Summarize page* adds a summary at the top or below the
  cursor, and *Translate page* replaces the text of every block in place or creates a translated subpage. *Suggest
  caption*, in a photo's toolbar or in the assistant with the photo selected, first asks before sending the photo to
  your provider (a copy of up to 1,024 pixels without its location data, never the original, and nothing else from the
  page), then shows the suggested caption in a field you can edit; *Apply* adds it as a normal line under the photo
  (in a table, in the same cell). The owner
  and the admins choose, in *Assistant…*, whether the workspace allows the assistant, only local models, or none.
- Dictate to report (the microphone in the page bar, the round button on the phone, the page menu or Ctrl+Alt+Shift+D,
  ⌘⌥⇧D on a Mac): write the note or dictate it with your keyboard's microphone and choose *Place*. The open page goes to
  your provider as a map of its tables, rows, labeled lines and checkboxes; the answer is checked against that map and
  shown change by change, each with its checkbox and its place (*Setups & takes › 12 · 010 · 3 › Lens*). *Apply* applies
  the checked ones as one edit you undo with *Undo* or Ctrl+Z, and nothing is applied if those places changed meanwhile.
  If it is not clear which shot, it asks with a button per row. What it could not place, and what you unchecked, stays
  under *Couldn't place* on that device until you add it to *Summary*, copy it or discard it. Without internet,
  *Save for later* keeps the note on the device: *N voice notes to place*, under the sync status, lists them, and each
  one is placed in its page with its preview, inserted as text at the end of the page, or discarded after asking.
  The big microphone button records a voice note on the device (tap to start, tap to stop, up to 2 minutes) and your
  provider turns it into text (OpenAI, Gemini or a compatible service, with the assistant's key or a second one in
  *Voice*); then it is placed like a written note, or written where the cursor was with *Insert at cursor*. Without
  internet the recording is saved and transcribed when you are back online.
- Templates: a new empty page offers the three built-in ones, and *More…* lists them with your project's own templates
  and the ones from other projects you can see. *Save as template…* in the page menu copies a page to the project's
  *Templates* folder (optionally clearing the filled-in values); a template is a page you edit like any other, and new
  pages get a copy. *New day report* creates the day's on-set report with today's date, the next shoot day and
  yesterday's location and camera package, offline too, from the report folder's template.
- Public [privacy policy](https://shotdocs.lega.com.ar/privacy) and [terms](https://shotdocs.lega.com.ar/terms) pages, readable without signing in.

Connecting other AI apps (MCP) comes later. The plan, the decisions and the roadmap are in
[`Docs/`](Docs/index.md) (in Spanish).

## Development

```sh
npm install
cp .env.example .env.local   # your Supabase project URL and publishable key
npm run dev                  # http://localhost:5173
npm test                     # all 1410 tests: sync, editor, UI, file gateway client and Worker
npm run typecheck            # app types
npx tsc -p portero --noEmit  # file gateway types (not covered by typecheck)
npm run build                # production build in dist/
```

`npm install` also applies the app's fixes to y-prosemirror (`patches/`, via `patch-package`): two small ones
for editing at the same time, and how a line with inline photos is stored; the build and the tests refuse to
run without them. Why and how to redo them on an upgrade: `Docs/Doc_Colaboracion.md`.

The database migrations are in `supabase/migrations/`. See [`Docs/Doc_Supabase.md`](Docs/Doc_Supabase.md)
to apply them and run the permission tests. Apply new migrations before deploying a new version of the
app.

To create your own workspace (your own Supabase, Resend, Google Drive, file gateway and backups), follow
[`Docs/Guide_Create_Workspace.md`](Docs/Guide_Create_Workspace.md), in English.

## Stack

- React web app installable as a PWA (desktop and iPhone), with native wrappers later if needed.
- [Supabase](https://supabase.com) for the database, sign-in and access rules. Its file storage only
  holds the images pasted into pages so far.
- [Google Drive](https://developers.google.com/drive) for original photos, videos and documents, in the
  workspace owner's Drive.
- [Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/) for hosting the web app
  (`wrangler.jsonc`) and for the file gateway (`portero/`, with its own `wrangler.jsonc`), which keeps the
  connection to the owner's Drive and passes files to and from it.
- A [Yjs](https://yjs.dev) document per page for conflict-free offline editing, and a
  [BlockNote](https://www.blocknotejs.org) block editor.

## License

MIT, see [LICENSE](LICENSE).

Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The app uses libheif
([`libheif-js`](https://www.npmjs.com/package/libheif-js), LGPL-3.0), loaded on demand as a separate file to
convert HEIC photos; the BlockNote editor (MPL-2.0); and fonts under the SIL Open Font License.

Lega Pugliese · [github.com/legandrop](https://github.com/legandrop)
