# LGA Shot Docs

Documentation for VFX work, in the spirit of Notion or Coda but much simpler. Write the VFX
pre-production notes for each scene, fill in the on-set reports during the shoot, and keep each show in
its own project: a tree of pages you own.

## Goals

- **Projects.** Each show or job is a project with its own tree of pages. Switch between them from the
  top of the sidebar (or with Ctrl+K) without leaving the page you are on.
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
- **Share a branch, never the tree.** Share a whole project or any page with a public link or with
  specific people. Sharing a page shares everything under it and nothing above it: parent pages and
  sibling branches stay private.
- **Your look, everywhere.** Light or dark theme, a default or an editorial typeface, text size and page
  width, saved in your account and applied on every device. Scene titles like `064 | Name | Place` show
  as a short code and a name in the sidebar, and each page can show the pages that contain it above its
  title.
- **Self-hosted.** Each supervisor runs their own copy with their own database. Nothing is shared between
  installations.

## Status

Phase 1 (MVP) works: email sign-in, the page tree, the block editor with autosave and pasted images,
light and dark themes and per-account appearance settings.
Every edit is saved on the device first and synced when a connection is available; edits made offline on
several devices are merged. The app can be installed (PWA). You sign in with an 8-digit code sent by email, which
works inside the installed iPhone app (a sign-in link would open Safari instead); this needs your own mail
server (SMTP) in Supabase, and sign-ups are invite-only. Next: sharing, templates, real page sizes with PDF export, and the assistant. The plan, the decisions and the roadmap are in
[`Docs/`](Docs/index.md) (in Spanish).

## Development

```sh
npm install
cp .env.example .env.local   # your Supabase project URL and publishable key
npm run dev                  # http://localhost:5173
npm test                     # sync tests
npm run build                # production build in dist/
```

The database migrations are in `supabase/migrations/`. See [`Docs/Doc_Supabase.md`](Docs/Doc_Supabase.md)
to apply them and run the permission tests. Apply new migrations before deploying a new version of the
app.

## Stack

- React web app installable as a PWA (desktop and iPhone), with native wrappers later if needed.
- [Supabase](https://supabase.com) for the database, sign-in, file storage and access rules.
- [Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/) for hosting the web app
  (`wrangler.jsonc`).
- A [Yjs](https://yjs.dev) document per page for conflict-free offline editing, and a
  [BlockNote](https://www.blocknotejs.org) block editor.

## License

MIT, see [LICENSE](LICENSE).

Lega Pugliese · [github.com/legandrop](https://github.com/legandrop)
