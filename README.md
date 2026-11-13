# LGA Shot Docs

Documentation for VFX work, in the spirit of Notion or Coda but much simpler. Write the pre-production notes
for each scene, fill in the on-set reports during the shoot, and keep each show in its own project. It works
on macOS, Windows, iPhone, iPad and Android, online and offline, and never loses what you write.

The app runs at **[shotdocs.lega.com.ar](https://shotdocs.lega.com.ar)**. Each team connects it to its own
*workspace*.

## Contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Set up a new workspace](#set-up-a-new-workspace)
- [Run your own copy of the app (optional)](#run-your-own-copy-of-the-app-optional)
- [Development](#development)
- [Status and docs](#status-and-docs)
- [License](#license)

## What it does

**Projects and pages**
- Each show is a project with a tree of pages as deep as you need; a "folder" is just a page with no content.
  Favorite projects (synced to your account), project colors, archive, delete and restore.
- A new project starts with its stage folders: *Preproduction* (*Scenes*, *Locations*), *Scouting reports*,
  *Tests and previs*, *Shoot*, *References* and *Archive*.
- See how much each project takes in Drive, and its files from heaviest to lightest.
- Back and forward, tabs in the installed app, and full keyboard navigation of the page tree.

**Editor**
- A visual block editor: headings, lists, checklists, quotes, tables, page links and a `/` menu.
- *Script* paragraphs for pasted screenplays, with INT/EXT, DAY and NIGHT marked in color.
- Collapsible sections by heading (just for you, or for everyone), and undo in the order you edited, across pages.
- Real paper sizes (A5, A4, A3, Letter) per page or per branch, with page breaks: what you see is what prints.

**Photos, videos and files**
- Photos and videos go to the workspace owner's Google Drive, uploaded in resumable parts, with a thumbnail on
  the page. iPhone HEIC photos are converted on the device.
- Photos in the line of text, in rows, and inside table cells; a full-screen viewer with zoom and video playback.
- Annotate photos (arrows, shapes, text, numbered markers) on a computer, phone or iPad with a pencil; the
  original never changes. Download or copy a photo with its annotations.
- Attach any file, drop a whole folder (browse it and download it as a zip), or paste a Drive link as a card.
- Take a photo or record a video straight from the phone's camera.

**Scenes, locations and shoot days**
- Scenes, locations, sets and shoot days are pages the app recognizes; the *Scenes* and *Locations* folders show
  a live table of their pages.
- A scene's page shows where everything about it is, stage by stage; *Copy link* opens that scene on any device.
- *Overview* gathers the whole project for post: every scene and where each stage talks about it, locations,
  shoot days, every shot in one sortable table, and what is still pending.
- Scene numbers and location names are recognized as you write; link them with `/e 027` or `/l name`. A
  location can have other names, and *Leave out of relations* keeps archives and old copies out.
- *Merge…* joins two pages of the same scene or shoot day without losing anything.
- Templates (*Pre-production Notes*, *On-Set Report*, *Shot Breakdown*, scene, location and scout pages, or your
  own), and *New day report* / *New day plan* filled in from the day's plan.

**Search and comments**
- Find and replace in the page, and search titles and text across the project (offline too), with replace
  across the whole project and an undo for it. One switch moves a search between the page and the project, and the
  field at the top of the project switcher searches the whole project.
- Comments on any block or page, with replies, mentions and resolve; *Question* paragraphs answered in their
  thread, so a guest who can only comment can still answer.

**Sharing and people**
- The owner and admins invite people from *Members* with a link; one device can join several workspaces.
- Roles (owner, admin, member, guest) and four permissions (view, comment, edit, edit and create pages) on a
  project or a page. A permission covers everything below and nothing above.
- *Share scenes* with vendors: each project has its vendors (name, code, color, view or comment, one or more
  emails), you assign them scenes before they have an email, and each email sees only its vendor's scenes and the
  pages inside them, never the locations, shoot days or other scenes. *Can share scenes* lets a producer do it too.
  An eye in the page tree marks what people outside the team can see.
- A vendor's team adds people who see all its scenes and splits them among its artists, each seeing only theirs;
  the project sees and can remove everything set up under each vendor.
- Import the vendor of each scene from a breakdown in Excel or CSV (the scene comes from the shot name), with a
  review of what changes before anything is saved.
- *Anyone with the link* for a page and the pages inside: *Can view* (also comments, with a name) or *Can edit*
  once the workspace turns it on; no account needed.
- Access requests from a file link, a page link or a scene link.

**Never lose anything**
- Every edit is saved on the device first and synced when online; edits made offline on several devices
  merge, never overwrite. The app always shows how many changes are waiting to upload.
- Version history per page with restore, a trash for projects, pages and Drive files, and pages kept
  available offline with a storage limit you choose.
- People who only view or comment get a clean copy of each page, without what was deleted (once the workspace
  turns it on).

**Assistant and dictation** (with your own API key from one of the supported providers, any compatible
service, or a local model)
- Fix, improve, shorten, translate or reformat a selection; summarize or translate a page; suggest a photo
  caption. Always a preview first, and applying it is a normal edit you can undo.
- *Dictate to report*: write or dictate an informal note on set and the assistant places each piece in the
  right row and field of the report, for you to check before applying. Voice notes recorded offline are
  transcribed when you are back online; on iPhone you can start dictating from a shortcut.
- The key can sync across your devices, encrypted with a passphrase. The owner and admins can turn the
  assistant off or allow only local models. Connecting outside chat apps through MCP is being tested.

**Export and import**
- PDF of a page, a branch or a whole project, with a contents page, annotated photos and links to files.
- A zip archive (web pages, Markdown, photos and files) that imports back as a new project (owner and admins;
  export from a computer).

**Everywhere**
- Installable app (PWA); light and dark themes, typefaces, text contrast and size saved in your account;
  English and Spanish; built-in help with guided tours on a practice page.

## How it works

- **One app, many workspaces.** Each workspace is an island: its owner's Supabase, Google Drive and file
  gateway. Nothing goes through anyone else's servers.
- **Supabase** (database, sign-in with an emailed 8-digit code, and permissions enforced in the database
  with Row Level Security). Sign-up is invite-only.
- **Google Drive** keeps original photos, videos and files, in the owner's Drive.
- **The file gateway** is a small Cloudflare Worker (`portero/`) that keeps the connection to the owner's Drive
  and checks each request against the workspace's permissions. It holds no database keys.
- **Pages** are [Yjs](https://yjs.dev) documents edited with [BlockNote](https://www.blocknotejs.org), stored
  on the device (IndexedDB) and in an append-only table on the server.
- **The web app** is React, hosted on Cloudflare Workers (`wrangler.jsonc`).

## Set up a new workspace

You do **not** need your own copy of the app: you create the accounts and connect them to
[shotdocs.lega.com.ar](https://shotdocs.lega.com.ar). No programming is needed; plan on an afternoon.

**What you need** (the services all have free plans):

| | What for |
|---|---|
| A domain of your own, with access to its DNS | The sign-in code is emailed from an address on it |
| A computer with [Node.js](https://nodejs.org) 22 or later | To run the setup command |
| [GitHub](https://github.com) | A fork of this repo, and a private repo for encrypted database backups |
| [Supabase](https://supabase.com) | Database, sign-in and permissions |
| [Resend](https://resend.com) | Sends the sign-in email from your domain |
| [Google Cloud](https://console.cloud.google.com) and Google Drive | Access to your Drive, where photos and videos go |
| [Cloudflare](https://cloudflare.com) | Runs your file gateway |

**Steps**, in short:

1. Fork this repo and download it.
2. Create a Supabase project.
3. Verify your domain in Resend.
4. Run `node scripts/setup-workspace.mjs` with your Supabase token: it creates the tables and permissions,
   code sign-in, the email templates, your mail server and you as the owner. It only changes what is missing.
5. Publish the file gateway on Cloudflare from your fork.
6. Create the Google Cloud project (Drive and Picker access) for the gateway, then run the setup command again
   with `--media-url`.
7. Create the private backup repository from its template (ask Lega for access) and add its two secrets.
8. Open the app, choose *Create my workspace*, paste your Supabase address and key, sign in and connect
   Google Drive.
9. Test sign-in, an upload and a backup.
10. Open sign-up for invited people only.

**Keep it up to date:** when the app changes, *Sync fork*, download it again and rerun the setup command
(database changes and gateway).

The full guide, button by button: [`Docs/Guide_Create_Workspace.md`](Docs/Guide_Create_Workspace.md).

## Run your own copy of the app (optional)

Only if you want to host the web app yourself instead of using shotdocs.lega.com.ar:

1. In Cloudflare, create a Worker named `shotdocs` from your fork (build `npm run build`, deploy
   `npx wrangler deploy`). The optional build variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (the
   public one) open that workspace by default.
2. Run the setup command again with `--redirect-url <your address>`, and add the address to the gateway's
   `APP_ORIGINS` and to the Picker API key's website restrictions.
3. Apply new database migrations (`npm run db:migrate`) before publishing a new version of the app.

## Development

```sh
npm install                  # also applies the patches in patches/ (y-prosemirror and yjs)
cp .env.example .env.local   # your Supabase project URL and publishable key
npm run dev                  # http://localhost:5173
npm test                     # every test: sync, editor, UI, gateway client and Worker
npm run typecheck            # app types
npx tsc -p portero --noEmit  # file gateway types
npm run build                # production build in dist/
```

- The build and the tests refuse to run without the patches; why they exist: `Docs/Doc_Colaboracion.md`.
- Database migrations are in `supabase/migrations/` and the permission tests in `supabase/tests/`; how to
  apply and run them: [`Docs/Doc_Supabase.md`](Docs/Doc_Supabase.md).

## Status and docs

In development, used by its author on real shows. What is pending and the design decisions are in
[`Docs/`](Docs/index.md) (in Spanish): the roadmap, the decisions and one document per feature.

## License

MIT, see [LICENSE](LICENSE). Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The app
uses libheif ([`libheif-js`](https://www.npmjs.com/package/libheif-js), LGPL-3.0), loaded on demand to convert
HEIC photos; the BlockNote editor (MPL-2.0); and fonts under the SIL Open Font License.

Lega Pugliese · [github.com/legandrop](https://github.com/legandrop)
