# LGA Shot Docs

Documentation for VFX work, in the spirit of Notion or Coda but much simpler. Write the VFX
pre-production notes for each scene, fill in the on-set reports during the shoot, and keep everything in
one tree of pages you own.

## Goals

- **Pages and subpages.** A sidebar with a tree of pages, as deep as you need. Every page can hold
  content and other pages; a "folder" is just a page with no content.
- **Visual editor.** Headings, lists, checklists, tables and images. You never see Markdown; it is only
  used behind the scenes to import, export and back up your pages.
- **Templates.** Reusable page layouts such as *Pre-production Notes*, *On-Set Report* or *Shot
  Breakdown*. Pick one when you create a page and start filling it in.
- **Works everywhere.** macOS, Windows and iPhone, from the same app.
- **Real page sizes.** A page can be free-form or set to a paper size (A5, A4, A3, Letter), per page or
  for a whole branch. What you see while editing is exactly what the PDF export looks like.
- **Assistant with your own key.** Add the API key of your preferred AI model and let it review and fix
  text, format pages and resize images. Its edits are regular edits: synced, versioned and undoable.
- **Offline first, nothing lost.** Every change is saved on your device first and synced when you are
  back online. Edits made offline on two devices are merged, never overwritten.
- **Share a branch, never the tree.** Share any page with a public link or with specific people. Sharing
  a page shares everything under it and nothing above it: parent pages and sibling branches stay
  private.
- **Self-hosted.** Each supervisor runs their own copy with their own database. Nothing is shared between
  installations.

## Status

Planning. Nothing to install yet. The plan, the decisions and the roadmap are in [`Docs/`](Docs/index.md)
(in Spanish).

## Planned stack

- Web app installable as a PWA (desktop and iPhone), with native wrappers later if needed.
- [Supabase](https://supabase.com) for the database, sign-in, file storage and access rules.
- [Vercel](https://vercel.com) for hosting the web app.
- A CRDT per page for conflict-free offline editing.

## License

MIT, see [LICENSE](LICENSE).

Lega Pugliese · [github.com/legandrop](https://github.com/legandrop)
