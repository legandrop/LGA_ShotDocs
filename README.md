# LGA Shot Docs

Documentation for VFX work, in the spirit of Notion or Coda but much simpler. Write the VFX
pre-production notes for each scene, fill in the on-set reports during the shoot, and keep each show in
its own project: a tree of pages you own.

## Goals

- **Projects.** Each show or job is a project with its own tree of pages. Switch between them from the
  top of the sidebar without leaving the page you are on.
- **Search.** Ctrl/⌘+F finds and replaces in the open page. Ctrl/⌘+K (or the magnifying glass next to
  "+" in the sidebar) searches the titles and text of every page in the project, on your device and
  offline, takes you to the exact spot, and lists matching projects to switch to.
- **Pages and subpages.** A sidebar with a tree of pages, as deep as you need. Every page can hold
  content and other pages; a "folder" is just a page with no content.
- **Visual editor.** Headings, lists, checklists, tables and images. You never see Markdown; it is only
  used behind the scenes to import, export and back up your pages.
- **Script text.** Paste a screenplay and turn it into *Script*: it shows in a screenplay typeface, with
  INT/EXT, DAY, NIGHT and DAWN/DUSK marked in color.
- **Templates.** Reusable page layouts such as *Pre-production Notes*, *On-Set Report* or *Shot
  Breakdown*. Pick one when you create a page and start filling it in.
- **Works everywhere.** macOS, Windows and iPhone, from the same app.
- **Real page sizes.** A page can be free-form or set to a paper size (A5, A4, A3, Letter), per page or
  for a whole branch. What you see while editing is exactly what the PDF export looks like.
- **Assistant with your own key.** Add the API key of your preferred AI model and let it review and fix
  text, format pages and resize images. Its edits are regular edits: synced, versioned and undoable.
- **Offline first, nothing lost.** Every change is saved on your device first and synced when you are
  back online. Edits made offline on two devices are merged, never overwritten.
- **Share a branch, never the tree.** Inside a workspace, people get a role and a permission on a
  project or a page (view, comment, edit, or edit and create pages). A permission covers everything under
  that page and nothing above it: parent pages and sibling branches stay private. Clients join as guests
  and sign in to see only the pages shared with them. A public link without sign-in comes later.
- **Your look, everywhere.** Light or dark theme, a default or an editorial typeface, text size and page
  width, saved in your account and applied on every device. Scene titles like `064 | Name | Place` show
  as a short code and a name in the sidebar, and each page can show the pages that contain it above its
  title.
- **One app, many workspaces.** The same app connects to several workspaces. Each workspace is an island
  that runs on its owner's own Supabase, Google Drive and file gateway: nothing from one workspace goes
  through anyone else's servers, and nobody needs to publish their own copy of the app.

## Status

In production (v0.049). What works today:

- Email sign-in with an 8-digit code, which works inside the installed iPhone app (a sign-in link would
  open Safari instead). It needs your own mail server (SMTP) in Supabase, and sign-ups are invite-only.
- The page tree, the block editor with autosave and pasted images, light and dark themes and
  per-account appearance settings. The app can be installed (PWA).
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
  once the workspace database is on version 7).
- Google Drive links: paste one and keep it as a link, as plain text, or as a card with the Drive player.
- Links to other pages: a link to a page of the app opens it in the same tab (Ctrl/⌘+click, in a new one).
- Photos in rows: the first click selects a photo (handles and its toolbar), the second opens it; quick sizes
  (full, 1/2, 1/3, 1/4 of the page) put photos and videos side by side, *Arrange in rows* lays out a run of
  photos in rows of equal height, and on the phone each account chooses rows or stacked. The PDF keeps the
  rows and breaks sheets where the page shows them.
- Attach any file (PDF, zip, anything): drop or paste it, it goes to the owner's Drive and shows as a card;
  a PDF opens in a new tab and everything else downloads with its name.
- Collapse sections by their headings: a triangle next to any heading hides everything up to the next heading
  of its level (just for you, saved on the device; Ctrl/⌘+Alt+Enter, and *Collapse all* in the page menu).
  Deleting a collapsed heading deletes its whole section; sheet marks still count everything and the PDF
  prints it all open.
- Page breaks and PDF: pages with a paper size show where each sheet starts, and *Export PDF / Print* in the page menu prints exactly those sheets.
- English and Spanish: the whole interface in both languages, chosen in the account menu and saved in your account (Script is *Guion* in Spanish).
- Public [privacy policy](https://shotdocs.lega.com.ar/privacy) and [terms](https://shotdocs.lega.com.ar/terms) pages, readable without signing in.

Templates and the assistant come later. The plan, the decisions and the roadmap are in
[`Docs/`](Docs/index.md) (in Spanish).

## Development

```sh
npm install
cp .env.example .env.local   # your Supabase project URL and publishable key
npm run dev                  # http://localhost:5173
npm test                     # all 1190 tests: sync, editor, UI, file gateway client and Worker
npm run typecheck            # app types
npx tsc -p portero --noEmit  # file gateway types (not covered by typecheck)
npm run build                # production build in dist/
```

`npm install` also applies two small fixes to y-prosemirror (`patches/`, via `patch-package`); the build and
the tests refuse to run without them. Why and how to redo them on an upgrade: `Docs/Doc_Colaboracion.md`.

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

Lega Pugliese · [github.com/legandrop](https://github.com/legandrop)
