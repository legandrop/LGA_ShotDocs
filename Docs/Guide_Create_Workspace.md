# Create your own workspace

This guide sets up a workspace of your own for LGA Shot Docs, step by step. You do not need to know how to
program: you copy a few values between websites and run one command. Plan on an afternoon.

A workspace is yours and runs on your own accounts, all of them free:

| Service | What it does for your workspace |
|---|---|
| **Supabase** | Sign-in, the text of your pages, people and permissions. |
| **Resend** | Sends the email with the sign-in code, from your own domain. |
| **Google Drive** (with Google Cloud) | Keeps the original photos and videos, in your Drive. |
| **Cloudflare** | Runs your *file gateway*: the small server that passes files between the app and your Drive. |
| **GitHub** | Makes an encrypted backup of your database four times a day. |

Nothing from your workspace goes through anyone else's servers. You do **not** publish your own copy of the
app: everyone uses the same app at `https://shotdocs.lega.com.ar` and connects it to your workspace.

Button and menu names below are the ones each website uses today; they sometimes move a little. Keep a
password manager open: you will collect several values, and some are shown only once.

## What you need before starting

- **A domain of your own for email** (for example `yourstudio.com`), and access to its DNS settings (where
  you bought it, or Cloudflare if it is there). This is required: the sign-in code is sent from an address on
  that domain. Without a domain you cannot create a workspace. Adding the records below does not change the
  email you already receive on that domain.
- **A computer** (Mac, Windows or Linux) to run one command. You install **Node.js** once: go to
  [nodejs.org](https://nodejs.org), download the **LTS** version (22 or later) and install it with the
  default options.
- An email address that will be the **owner** of the workspace (it can be on any domain).

Values you will write down (keep them private unless the guide says otherwise):

| Value | Where it comes from | Secret? |
|---|---|---|
| Project ref, Project URL, Publishable key | Supabase | No (the app uses them) |
| Database password | Supabase | **Yes** |
| Personal access token (`sbp_…`) | Supabase | **Yes** |
| Resend API key (`re_…`) | Resend | **Yes** |
| File gateway address (`https://shotdocs-portero.….workers.dev`) | Cloudflare | No |
| Client ID | Google Cloud | No |
| Client secret, Picker API key | Google Cloud | **Yes** |
| Backup passphrase | You make it up | **Yes** |

## 1. GitHub: your copy of the app's code

The file gateway is published from a copy of the app's code, and the setup command is in it too.

1. Create an account at [github.com](https://github.com) if you do not have one (**Sign up**).
2. Open [github.com/legandrop/LGA_ShotDocs](https://github.com/legandrop/LGA_ShotDocs) and click **Fork** →
   **Create fork**. You now have `github.com/<you>/LGA_ShotDocs`.
3. On your fork, click **Code** → **Download ZIP**, and unzip it somewhere easy to find (for example your
   Desktop). You will run the command from that folder.

When the app gets updates, open your fork and click **Sync fork** → **Update branch**: that also updates your
file gateway (step 5), which must stay in step with the app.

## 2. Supabase: create the project

1. Go to [supabase.com](https://supabase.com) → **Start your project** and sign up (with GitHub or email).
2. Click **New project**. Choose your organization (Supabase creates one for you), then:
   - **Project name**: for example `shotdocs`.
   - **Database password**: click **Generate a password** and save it in your password manager. The backups
     (step 7) need it. Letters and numbers only are easiest.
   - **Region**: the one closest to where you work.
   - In the security options: keep **Data API** on, turn **off** the option that automatically exposes new
     tables, and keep **automatic Row Level Security (RLS)** on.
   - Click **Create new project** and wait a couple of minutes until it is ready. The free plan is enough.
3. Write down the **project ref**: **Project Settings** (gear icon, bottom left) → **General** → **Project
   ID**. It is 20 lowercase letters and numbers. Your **Project URL** is `https://<project ref>.supabase.co`.
4. Create a **personal access token**: click your avatar (top right) → **Account preferences** → **Access
   Tokens** (or open [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens))
   → **Generate new token**. Name it `shotdocs setup`, pick an expiry of a few days, and copy the token
   (`sbp_…`): it is shown only once. It gives full access to your Supabase account, so never share it; you
   can delete it when you are done.

Do not run the command yet: it needs the email settings from step 3.

## 3. Resend: send email from your domain

1. Go to [resend.com](https://resend.com) → **Get started** and create an account. The free plan includes
   1 domain, 3,000 emails a month and 100 a day.
2. **Domains** → **Add domain**. Type your domain (for example `yourstudio.com`), choose the region closest to
   you, and click **Add**.
3. Resend shows a list of **DNS records** (a TXT record for DKIM, named `resend._domainkey`, and an MX record
   and a TXT record for SPF, named `send`). Add each one where your domain's DNS is managed, copying the
   **Type**, **Name**, **Value** and, for MX, the **Priority** exactly. If your domain is in Cloudflare,
   Resend can add them for you with its **Sign in to Cloudflare** button.
4. Back in Resend, click **Verify DNS records**. It can take from a few minutes to a few hours; wait until the
   domain shows **Verified**.
5. On the domain's page, open **Configuration** and turn **off** **Click tracking** and **Open tracking**.
   Click tracking rewrites the links in the email and breaks the sign-in link.
6. **API Keys** → **Create API key**. Name: `shotdocs`. **Permission: Sending access**. **Domain**: your
   domain. Click **Add** and copy the key (`re_…`): it is shown only once. This key is the password of your
   email server.

Choose the **sender address** now, on that domain: for example `shotdocs@yourstudio.com`. It does not need
to be a real mailbox.

## 4. Supabase: run the setup command

The command prepares your Supabase project in one go: the database tables and permissions, the check that
only invited people can join, sign-in with an 8-digit code valid for 1 hour, the email templates with the
code, your Resend server, sending limits, the app's address, closed sign-up, the workspace name, and you as
the owner. It only changes what is missing, so you can run it again at any time.

1. Open a terminal in the folder you unzipped in step 1:
   - **Mac**: open the folder in Finder, then right-click it → **New Terminal at Folder** (or open
     **Terminal** and type `cd ` followed by dragging the folder onto the window, then Enter).
   - **Windows**: open the folder in File Explorer, click the address bar, type `powershell` and press Enter.
2. Give the command your token (replace `sbp_…` with yours). This stays only in this terminal window:
   - Mac or Linux: `export SUPABASE_ACCESS_TOKEN=sbp_…`
   - Windows (PowerShell): `$env:SUPABASE_ACCESS_TOKEN="sbp_…"`
3. First, see what it would do, **without changing anything** (`--dry-run`). Put your own values on one line:

   ```sh
   node scripts/setup-workspace.mjs --ref <project ref> --owner-email you@yourstudio.com --app-url https://shotdocs.lega.com.ar --smtp-from shotdocs@yourstudio.com --name "Your Studio" --dry-run
   ```

   - `--name`: the workspace name people see in the app.
   - `--app-url`: the app's address. Use `https://shotdocs.lega.com.ar` unless you publish your own copy of the
     app.
   - Optional: `--smtp-sender-name "Your Studio Docs"` changes the sender name (default `LGA Shot Docs`).

   It lists the database changes to apply, each sign-in setting with its current and new value, whether your
   account exists or will be invited, and the workspace settings. Nothing is written.
4. Run the same line **without `--dry-run`**. When it asks for the **SMTP password**, paste the Resend API key
   (`re_…`) and press Enter: nothing appears on screen while you paste, on purpose. It is never printed.
   (Instead of typing it, you can set it first as `SMTP_PASSWORD`, like the token.)
5. At the end it prints your **Project URL** and **Publishable key** (`sb_publishable_…`): write them down.
   The publishable key is not secret; the app and the file gateway use it.
6. If you had no account yet, you get an email *"You are invited to LGA Shot Docs"*. It proves that your
   email works. You do not need its button: you sign in with a code in step 8.

If something fails, the command says what and stops; fix it and run it again. It refuses to write to a
project that already has another owner, so it cannot overwrite someone else's workspace.

## 5. Cloudflare: publish your file gateway

1. Create an account at [cloudflare.com](https://dash.cloudflare.com/sign-up) (the free plan is enough).
2. In the dashboard: **Compute (Workers)** → **Workers & Pages** → **Create** → **Import a repository**.
   Connect your GitHub account when asked and choose your fork `LGA_ShotDocs`.
3. **Project name**: `shotdocs-portero` (exactly this). Open the advanced settings:
   - **Root directory** (Path): `portero`
   - **Build watch paths**: `portero/*`
   - **Build command**: leave empty. **Deploy command**: `npx wrangler deploy`.
4. Click **Deploy**. When it finishes, write down its address:
   `https://shotdocs-portero.<your-subdomain>.workers.dev`.
5. Open the Worker → **Settings** → **Variables and Secrets** → **+ Add**, and add (these are the Worker's
   variables, not the build's):
   - `SUPABASE_URL` (Type **Text**): your Project URL.
   - `SUPABASE_PUBLISHABLE_KEY` (**Text**): your publishable key.
   - `APP_ORIGINS` (**Text**): the app's address without a slash at the end: `https://shotdocs.lega.com.ar`
     (several addresses go separated by commas).
   - Click **Deploy** (or **Save**). You add the Google values in step 6.

## 6. Google Cloud: access to your Drive

Use the Google account whose Drive will keep the workspace's photos and videos.

**The project and the APIs**

1. Go to [console.cloud.google.com](https://console.cloud.google.com), accept the terms, and create a
   project: project picker (top left) → **New project** → name `LGA Shot Docs` → **Create**. Make sure it is
   selected in the project picker.
2. **APIs & Services** → **Library** → search **Google Drive API** → open it → **Enable**.
3. Back in **Library**, search **Google Picker API** → open it → **Enable**.

**The consent screen, in production**

4. **Google Auth Platform** (called "OAuth consent screen" in some menus) → **Get started**: app name
   `LGA Shot Docs`, your support email, audience **External**, your contact email → **Create**.
5. **Data Access** → **Add or remove scopes**: check `openid`, `.../auth/userinfo.email` and
   `https://www.googleapis.com/auth/drive.file` (if it is not in the list, paste it under **Manually add
   scopes**) → **Update** → **Save**. `drive.file` only lets the app see the files it creates itself.
6. **Audience** → **Publish app** → **Confirm**, so it says **In production**. In "Testing", the connection
   with Drive stops working every 7 days.

**The web client**

7. **Clients** → **Create client** → Application type **Web application**, name `shotdocs-portero`. Under
   **Authorized redirect URIs** → **+ Add URI**:
   `https://shotdocs-portero.<your-subdomain>.workers.dev/drive/callback` → **Create**.
8. Copy the **Client ID** and the **Client secret** right away (or click **Download JSON**): Google shows the
   secret only once. If you lose it, add a new secret to the same client.
9. In Cloudflare, the Worker → **Settings** → **Variables and Secrets** → **+ Add**:
   `GOOGLE_CLIENT_ID` (**Text**) and `GOOGLE_CLIENT_SECRET` (Type **Secret**).

**The folder picker key**

10. In Google Cloud: **APIs & Services** → **Credentials** → **+ Create credentials** → **API key**. Copy it.
11. Click the new key's name to restrict it:
    - **Name**: `LGA Shot Docs picker`.
    - **Application restrictions**: **Websites**, and under **Website restrictions** add
      `https://shotdocs.lega.com.ar/*`.
    - **API restrictions**: **Restrict key**, and check only **Google Picker API**.
    - **Save**. Restrictions take up to 5 minutes to apply.
12. In Cloudflare, the Worker → **Variables and Secrets** → **+ Add**: `GOOGLE_API_KEY`, Type **Secret**, the
    key → **Deploy**. Without it, the app's folder goes to the root of your Drive.

**Tell your workspace where the gateway is**

13. In the terminal of step 4, run the setup line again (without `--dry-run`) adding
    `--media-url https://shotdocs-portero.<your-subdomain>.workers.dev`. It only changes that; everything
    else is already in place.

## 7. GitHub: backups

Supabase's free plan does not back up your database. A private GitHub repository does it for you, four
times a day, encrypted with a passphrase only you know.

1. **Get the backup repository.** It is a separate repository from the app. Ask Lega for access to the
   backup template, then open it on GitHub and click **Use this template** → **Create a new repository**:
   - **Owner**: you. **Repository name**: for example `shotdocs_backup`.
   - **Private** (never public: the backups are your whole database, even if encrypted).
   - Leave **Include all branches** unchecked: you only need the main branch, with the scripts.
   - **Create repository**.

   Its instructions are in the **README.md** of that repository (the page you see when you open it; in
   Spanish): section **Configurar** to set it up and **Restaurar** to restore a backup.
2. In **your** new repository: **Settings** → **Secrets and variables** → **Actions** → **New repository
   secret**, and create two:
   - `SUPABASE_DB_URL`: in Supabase, your project → **Connect** (top) → **Session pooler** → copy the
     address, and replace `[YOUR-PASSWORD]` with the database password from step 2. It must be the **Session
     pooler** one (port 5432). If the password has symbols such as `@`, `#`, `/` or `:`, reset it to one with
     letters and numbers only (**Project Settings** → **Database** → **Reset database password**); the app
     does not use it.
   - `BACKUP_PASSPHRASE`: a long phrase you make up (for example five random words). **Save it in your
     password manager**: without it, the backups cannot be opened, and nobody else has it.
3. Test it: **Actions** tab → **Copia de seguridad** → **Run workflow** → **Run workflow**. It must finish
   green, and a file appears in the `copias` branch. From then on it runs by itself, and GitHub emails you if
   a backup fails.

## 8. Connect the app

1. Open `https://shotdocs.lega.com.ar` (on iPhone, you can also add it to the Home Screen: **Share** → **Add
   to Home Screen**).
2. On the welcome screen, choose **Create my workspace** and paste your **Project URL** and **Publishable
   key**. (If you already use the app with another workspace, it is in the workspace menu at the top of the
   sidebar.)
3. Type the owner's email → **Continue with email**. Type the 8-digit code from the email → **Sign in**.
4. On **No projects yet**, click **New project**.
5. Account menu (bottom of the sidebar) → **Google Drive** → **Connect Google Drive**. Choose the Google
   account from step 6 and allow access (keep the Drive permission checked). If Google warns that the app is
   not verified: **Advanced** → **Go to …**: it is your own app. Back in the app it says *Google Drive
   connected.* Doing this from a computer is best; it works for every device afterwards.
6. Optional: **Choose folder…** picks the folder of your Drive where the app's `LGA_ShotDocs` folder goes.

## 9. Test it

- **Sign in with a code**: sign out (account menu → **Sign out**) and sign in again with a new code. The
  email arrives from your sender address, and its subject shows the code.
- **Upload a file**: open a page and drag a photo or a short video onto it. It shows a thumbnail, and after
  the upload it appears in your Drive under `LGA_ShotDocs / <project> / <date>`.
- **Make a backup**: run the backup by hand as in step 7.3 and check that it finishes green.
- **Invite someone**: account menu → **Members** → invite an email of yours, and open the link it copies.

## 10. Let invited people create their account

Until now, only accounts that already exist can sign in. To let the people you invite create their own
account (and nobody else), run this separate step, from the same terminal:

```sh
node scripts/setup-workspace.mjs --ref <project ref> --owner-email you@yourstudio.com --open-invite-signup --dry-run
node scripts/setup-workspace.mjs --ref <project ref> --owner-email you@yourstudio.com --open-invite-signup
```

It first connects and checks the rule that rejects any email without an invitation, and only then opens
sign-up; if the check fails, sign-up stays closed. Then test it: sign in with an email that was **not**
invited (it must say to ask for an invitation) and with one you invited (the code arrives and it gets in).

When you are done with all the steps, delete the Supabase access token (step 2.4) if you will not use the
command again for a while.

## What the backups do not cover

The backup has the whole database: pages, projects, people, permissions and accounts. It does **not** have:

- **The sign-in settings** (email server, templates, closed sign-up, addresses). The setup command puts them
  back: run it again with the same options.
- **The file gateway's secrets and the Drive connection.** Add the variables again in Cloudflare (step 5 and
  6) and connect Drive again (step 8.5).
- **The images pasted into pages** (they are stored in Supabase Storage, not in the database). Only the
  devices that opened those pages have them.
- **The thumbnails** of photos and videos. The originals are safe in your Drive, but nothing regenerates the
  thumbnails yet.

Restoring a backup has its own steps (README of the backup repository, **Restaurar**). It is safest to do it
with help, testing first on a separate project.

## Good to know

- **Private projects.** In the app, you as the owner do not see the private projects of other people in your
  workspace. They are still stored in your Supabase, your Drive and your backups, so technically you have
  them. Tell your team.
- **Sending limits.** 30 emails an hour for the whole workspace (Resend's free plan allows 100 a day), and
  one email a minute to the same address: asking for another code sooner shows an error.
- **Staying up to date.** When the app changes, **Sync fork** on GitHub (step 1) and run the setup command
  again: it applies the new database changes and leaves the rest as it is.
