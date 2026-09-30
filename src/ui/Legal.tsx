import { useEffect, type ReactNode } from 'react';
import { useT } from '../i18n';
import { PRIVACY_PATH, TERMS_PATH, type PublicRoute } from '../router';
import { AppIcon } from './icons';

// La política de privacidad y las condiciones de uso (`/privacy` y `/terms`), en inglés porque son para
// usuarios. Se ven sin sesión y sin workspace: App las muestra antes que todo lo demás (Google las pide para
// la pantalla de consentimiento, ver Docs/Doc_Roadmap.md, puntos 6 y 13). El texto describe la app como es
// hoy: si cambia qué datos se usan o dónde van, se cambia acá también, con la fecha. Quedan en inglés
// también con la app en castellano (es el texto que revisa Google y el que vale); en castellano se ve una
// nota arriba que lo explica, y los links del resto de la app sí se traducen.

/** La fecha de la última versión de los dos textos. */
export const LEGAL_UPDATED = 'September 30, 2026';
export const CONTACT_EMAIL = 'info@lega.com.ar';
const REPO_URL = 'https://github.com/legandrop/LGA_ShotDocs';
const USER_DATA_POLICY = 'https://developers.google.com/terms/api-services-user-data-policy';
const GOOGLE_CONNECTIONS = 'https://myaccount.google.com/connections';

const TITLES: Record<PublicRoute['name'], string> = {
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
};

/** "Privacy · Terms": en el login, la bienvenida y el menú de la cuenta. Abre en otra pestaña para no perder lo que se estaba haciendo. */
export function LegalLinks({ className = 'legal-links' }: { className?: string }) {
  const tr = useT();
  return (
    <nav className={className} aria-label={tr('legal.label')}>
      <a href={PRIVACY_PATH} target="_blank" rel="noopener">
        {tr('legal.privacy')}
      </a>
      <span aria-hidden="true">·</span>
      <a href={TERMS_PATH} target="_blank" rel="noopener">
        {tr('legal.terms')}
      </a>
    </nav>
  );
}

export function LegalPage({ page }: { page: PublicRoute['name'] }) {
  const title = TITLES[page];
  const tr = useT();
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · LGA Shot Docs`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  return (
    <div className="legal-screen">
      <header className="legal-header">
        {/* Links comunes (recargan la página): la app arranca de cero al volver, sin estado a medias. */}
        <a className="brand-row legal-brand" href="/">
          <AppIcon size={28} />
          <span>LGA Shot Docs</span>
        </a>
        {/* La navegación sigue el idioma de la app; el texto legal queda en inglés (`lang="en"`). */}
        <nav className="legal-nav" aria-label={tr('legal.label')}>
          <a href={PRIVACY_PATH} aria-current={page === 'privacy' ? 'page' : undefined}>
            {tr('legal.privacy')}
          </a>
          <a href={TERMS_PATH} aria-current={page === 'terms' ? 'page' : undefined}>
            {tr('legal.terms')}
          </a>
          <a className="legal-open" href="/">
            {tr('legal.openApp')}
          </a>
        </nav>
      </header>
      <main className="legal-doc" lang="en">
        <h1>{title}</h1>
        <p className="legal-updated mono-label">Last updated: {LEGAL_UPDATED}</p>
        {tr.lang !== 'en' && (
          <p className="legal-note" lang={tr.lang}>
            {tr('legal.englishOnly')}
          </p>
        )}
        {page === 'privacy' ? <Privacy /> : <Terms />}
      </main>
      <footer className="legal-footer" lang="en">
        <span>Questions: <Mail /></span>
        <span>
          {page === 'privacy' ? <a href={TERMS_PATH}>Terms of Service</a> : <a href={PRIVACY_PATH}>Privacy Policy</a>}
        </span>
      </footer>
    </div>
  );
}

function Mail() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
}

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Privacy() {
  return (
    <>
      <p>
        LGA Shot Docs is a web app for VFX documentation: pre-production notes, on-set reports, and the photos and
        videos that go with them. This policy explains what data the app handles, where it is stored and who
        controls it. “We” and “us” mean the publisher of LGA Shot Docs, who publishes the app at{' '}
        <strong>shotdocs.lega.com.ar</strong>. You can reach us at <Mail />.
      </p>

      <div className="legal-summary">
        <h2>The short version</h2>
        <ul>
          <li>
            Everything you write lives in a <strong>workspace</strong>, and every workspace runs on its owner’s own
            accounts: their database (Supabase), their Google Drive, their file gateway (on Cloudflare) and their
            email sender. The app talks to those accounts directly from your browser.
          </li>
          <li>
            There is no central server. We do not receive, and cannot see, what is stored in workspaces we do not
            run. The only exception is the workspace we run for our own studio: for its members, we are the
            workspace owner.
          </li>
          <li>No ads, no analytics, no tracking cookies. We never sell data.</li>
          <li>
            Google Drive access is limited to the files the app itself creates (the <code>drive.file</code>{' '}
            permission), and is used only to store those files and show them in the app.
          </li>
        </ul>
      </div>

      <h2>Who controls your data</h2>
      <p>
        The owner of a workspace controls it. The owner invites people, decides what each person can see and edit,
        and keeps the database, the Drive files and the backups in their own accounts. The owner is responsible for
        that data and is the person to ask about it (see “Deleting your data”).
      </p>
      <p>
        We publish the app’s code: your browser loads it from us and then connects to the workspace you open. We
        have no role in a workspace we do not run. Since the code comes from us, you rely on it doing what this
        policy says; it is open source, and anyone can read it at <Out href={REPO_URL}>github.com/legandrop/LGA_ShotDocs</Out>.
      </p>

      <h2>What the app handles, and where it goes</h2>
      <ul>
        <li>
          <strong>Your account.</strong> Your email address, used to sign in and to show who wrote a comment or who
          has access to a page. It is stored in the workspace’s database.
        </li>
        <li>
          <strong>Your work.</strong> Projects, pages, comments and questions, sharing permissions, invitations, and
          your appearance preferences (theme, typeface, text size and page width). Stored in the workspace’s
          database.
        </li>
        <li>
          <strong>Photos, videos and documents</strong> added to pages. The original goes to the workspace owner’s
          Google Drive, through the owner’s file gateway. The file’s name, type and size and a small thumbnail are
          stored in the workspace’s database. Images pasted into a page are stored in the database’s file storage.
        </li>
        <li>
          <strong>The Google Drive connection</strong> (only for the owner who connects Drive). The file gateway, a
          small program on the owner’s Cloudflare account, keeps the connection with Google, the connected Google
          account’s email address and the IDs of the app’s folders. To start videos faster, it also keeps a copy of
          the first and last few hundred kilobytes of recently viewed files. Other members never receive the
          owner’s Google credentials: files pass through the gateway, which checks each person’s permission.
        </li>
        <li>
          <strong>Sign-in emails.</strong> To sign in, the workspace emails you a one-time code through the owner’s
          email provider. These are the only emails the app sends: no newsletters and no marketing.
        </li>
        <li>
          <strong>Backups.</strong> Workspaces set up with our guide copy their database, encrypted, to a private
          GitHub repository of the owner, who decides how long copies are kept. In our workspace, copies are made
          four times a day and we keep the last 30 days plus one copy per month.
        </li>
      </ul>
      <p>
        These providers handle the data under their own terms, on the owner’s accounts, and may process it in other
        countries (the owner chooses the region of the database).
      </p>
      <p>
        When a page shows a Google Drive link as a card, or the owner opens Google’s folder picker, your browser
        loads that content directly from Google, under Google’s privacy policy. The app’s files are served by
        Cloudflare on our account; like any web host, it handles technical data such as your IP address to deliver
        the files and to protect against abuse. We do not use it to track anyone.
      </p>

      <h2>Google user data</h2>
      <p>
        Only the owner of a workspace connects Google Drive, with a Google Cloud client they create in their own
        Google Cloud project (our setup guide explains how). In the workspace we run, we are that owner. The app asks
        Google for:
      </p>
      <ul>
        <li>
          <code>drive.file</code>: to create files and folders in the owner’s Drive and open only those (and the
          folder the owner picks in Google’s folder picker). The app cannot see or open any other file in the
          Drive.
        </li>
        <li>
          The email address of the Google account (<code>openid</code> and <code>userinfo.email</code>): to show the
          owner which Google account is connected.
        </li>
      </ul>
      <p>What the app does with this access, and nothing else:</p>
      <ul>
        <li>
          Creates an <code>LGA_ShotDocs</code> folder where the owner chooses, with a folder for each project and
          for each day, and uploads there the photos, videos and documents that members add to pages.
        </li>
        <li>Reads those files back to show them in the app, only to people allowed to see the page they are on.</li>
        <li>Renames or moves the app’s folders when the owner renames a project or chooses another location.</li>
        <li>
          Moves a file to the Google Drive trash when the owner or an admin sends it there from the app’s file
          trash. The app never permanently deletes anything in Drive.
        </li>
      </ul>
      <p>
        The connection is stored only in the owner’s file gateway. While the owner uses Google’s folder picker,
        their browser receives a short-lived access token (one hour) with the same <code>drive.file</code>{' '}
        permission.
      </p>
      <h3>Limited Use</h3>
      <p>
        LGA Shot Docs’ use and transfer to any other app of information received from Google APIs will adhere to
        the <Out href={USER_DATA_POLICY}>Google API Services User Data Policy</Out>, including the Limited Use
        requirements. In particular, data received from Google APIs:
      </p>
      <ul>
        <li>is used only to provide the features described above, which are visible in the app;</li>
        <li>
          is not transferred to anyone, except to show files to the workspace members allowed to see them, when
          needed for security (for example, to investigate abuse), or to comply with the law;
        </li>
        <li>is never sold, and never used for advertising, including retargeting and personalized or interest-based ads;</li>
        <li>is not used to develop, improve or train generalized artificial intelligence or machine-learning models;</li>
        <li>is not used to determine creditworthiness or for lending;</li>
        <li>
          is not read by people at the publisher, except with the owner’s explicit permission, when needed for
          security, or to comply with the law. The workspace owner and the people they share pages with do see the
          files: that is what the app is for.
        </li>
      </ul>
      <h3>Revoking access</h3>
      <p>
        The owner can disconnect the app from Google at any time: Google Account → Security → Your connections to
        third-party apps &amp; services (<Out href={GOOGLE_CONNECTIONS}>myaccount.google.com/connections</Out>),
        choose the app and remove its access. After that, the app can no longer upload or show files from that
        Drive. Files already uploaded stay in the owner’s Drive, where the owner can delete them. Deleting the file
        gateway from the owner’s Cloudflare account erases what it stored.
      </p>

      <h2>Data stored on your device</h2>
      <p>
        To work without a connection, the app keeps on your device the pages and changes of the workspaces you
        open, and the photos and videos waiting to upload (in the browser’s IndexedDB); your sign-in session for
        each workspace, the list of workspaces, and small conveniences such as your preferences, the last page you
        opened and the width of the sidebar (in localStorage). A service worker keeps the app’s own files so it
        opens offline.
      </p>
      <p>
        The app does not set cookies and uses no analytics, advertising or third-party trackers.
      </p>
      <p>
        Signing out keeps changes that are not uploaded yet, so they upload the next time you sign in. “Remove from
        this device”, in the list of workspaces, deletes what the app stored on the device for that workspace.
        Clearing the site’s data in your browser deletes all of it, including changes not uploaded yet.
      </p>

      <h2>Deleting your data</h2>
      <ul>
        <li>
          Your account and your content in a workspace are controlled by its owner. Ask the owner: they can remove
          you from the workspace and delete your account and content from its database and Drive. Copies in
          encrypted backups disappear as those backups expire.
        </li>
        <li>
          If you are in our workspace, write to <Mail /> and we will delete your account and content, and confirm
          by email. We have no access to other workspaces and cannot delete anything in them.
        </li>
        <li>
          An owner deletes a whole workspace by deleting its Supabase project, the <code>LGA_ShotDocs</code> folder
          in Drive, the file gateway on Cloudflare and the backup repository on GitHub.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        All connections use HTTPS. The database only lets each person read and change what they have access to,
        the Drive connection never leaves the owner’s file gateway, and backups are encrypted. No system is
        perfectly secure: if you find a problem, please tell us at <Mail />.
      </p>

      <h2>Children</h2>
      <p>
        The app is a work tool and is not meant for children under 13, or under the minimum age to consent in their
        country. Workspaces are invite-only.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If this policy changes, we will publish the new version on this page with a new date. Before the app uses
        data in a new way (for example, a planned assistant that would use each user’s own AI provider key, which
        does not exist yet), this page will be updated to say so.
      </p>

      <h2>Contact</h2>
      <p>
        The publisher of LGA Shot Docs: <Mail />.
      </p>
    </>
  );
}

function Terms() {
  return (
    <>
      <p>
        These terms apply to your use of LGA Shot Docs, the web app published at <strong>shotdocs.lega.com.ar</strong>{' '}
        by its publisher (“we”, “us”). By using the app, you agree to them. If you use it on behalf of a company,
        you agree on its behalf. How the app handles data is explained in the{' '}
        <a href={PRIVACY_PATH}>Privacy Policy</a>.
      </p>

      <h2>1. How the app works</h2>
      <p>
        The app connects to workspaces. Each workspace runs on its owner’s own accounts (a Supabase database, Google
        Drive, a file gateway on Cloudflare, an email provider and, for backups, GitHub). We do not charge for the
        app. Those services belong to the owner and are used under their providers’ terms and prices, which the
        owner is responsible for.
      </p>

      <h2>2. Access</h2>
      <p>
        Workspaces are invite-only. The owner and the admins of a workspace decide who can join and what each
        person can see and edit, and they can remove access at any time. Keep access to your email account safe:
        anyone who can read it can sign in as you.
      </p>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the app to break the law or to infringe anyone’s rights, including privacy and intellectual property;</li>
        <li>upload content you have no right to share, or malicious files;</li>
        <li>try to reach workspaces, pages or files you were not given access to, or to get around permissions;</li>
        <li>overload, disrupt or attack the app, a file gateway or the services a workspace uses;</li>
        <li>use the app to harass or harm others.</li>
      </ul>

      <h2>4. Your content</h2>
      <p>
        What you write and upload belongs to you, or to whoever it belongs to under your agreements (for example,
        your employer, your studio or your client). We claim no ownership of it. By adding content to a workspace,
        you allow it to be stored, synced and shown in that workspace to the people it is shared with, as the app’s
        features require. The workspace owner decides what is kept in their workspace and can delete it.
      </p>

      <h2>5. Workspace owners</h2>
      <p>
        If you own a workspace, you are responsible for your accounts and their costs, for the people you invite,
        for following the laws that apply to the data you keep (including your members’ personal data) and for the
        terms of the services you use, including Google’s API terms when you connect your own Google Cloud client.
      </p>

      <h2>6. Open source</h2>
      <p>
        The app’s code is open source under the MIT license (<a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          github.com/legandrop/LGA_ShotDocs
        </a>
        ). These terms cover the app we publish; a copy published by someone else is that person’s responsibility.
      </p>

      <h2>7. Changes to the app</h2>
      <p>
        The app may change, gain or lose features, or stop being published at any time. Your data stays in your
        workspace’s own accounts if that happens.
      </p>

      <h2>8. No warranty</h2>
      <p>
        The app is provided “as is” and “as available”, without warranties of any kind, express or implied,
        including fitness for a particular purpose and uninterrupted or error-free operation. It is designed not to
        lose work, even offline, but software has bugs: keep backups of anything important.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the extent permitted by law, we are not liable for indirect, incidental, special or consequential
        damages, or for lost data, profits or business, arising from the use of the app or the inability to use it.
        Our total liability for any claim is limited to the greater of what you paid us for the app in the twelve
        months before the claim, or USD 50. Nothing in these terms limits rights that the law does not allow to be
        waived, including consumer rights.
      </p>

      <h2>10. Ending your use</h2>
      <p>
        You can stop using the app at any time. The owner of a workspace can remove you from it, and we can remove
        anyone who breaks these terms from the workspace we run.
      </p>

      <h2>11. Governing law</h2>
      <p>These terms are governed by the laws of the Argentine Republic.</p>

      <h2>12. Changes to these terms</h2>
      <p>
        If these terms change, we will publish the new version on this page with a new date. Using the app after
        that means you accept the new version.
      </p>

      <h2>13. Contact</h2>
      <p>
        The publisher of LGA Shot Docs: <Mail />.
      </p>
    </>
  );
}
