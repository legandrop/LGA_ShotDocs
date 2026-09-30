import { useEffect, useState, type FormEvent } from 'react';
import { clearInviteTarget, rememberInviteTarget } from '../invite';
import { useWorkspace } from '../workspace';
import {
  addWorkspace,
  adoptPending,
  configOf,
  checkWorkspace,
  displayName,
  forgetWorkspaceStorage,
  hasLocalData,
  hostOf,
  NEEDS_SETUP_COMMAND,
  pendingEntry,
  probeWorkspace,
  removeWorkspace,
  resolveInviteText,
  setActive,
  switchWorkspace,
  updateWorkspaces,
  useWorkspaceList,
  type DeviceWorkspace,
} from '../workspaces';
import { AppIcon, ArrowRightIcon, MailIcon, PlusIcon } from './icons';
import { LegalLinks } from './Legal';
import { monogram } from './project';

// La pantalla de bienvenida (la primera vez, sin ningún workspace en el dispositivo), unirse con un link de
// invitación, conectar un workspace creado con la guía, y el diálogo de workspaces del login y del selector
// de proyectos (paso 12 de Docs/Plan_Workspaces.md). Todo en modales o en la misma tarjeta, nunca en una
// página nueva.

/** La guía para crear un workspace, en el repo público. */
export const GUIDE_URL = 'https://github.com/legandrop/LGA_ShotDocs/blob/main/Docs/Guide_Create_Workspace.md';

/** `invite`: se unió con un link (la página del link se abre después de entrar). */
export type OnAdded = (entry: DeviceWorkspace, invite?: { target: string | null }) => void;

export function Welcome({ onAdded }: { onAdded: OnAdded }) {
  const [mode, setMode] = useState<'start' | 'join' | 'create'>('start');
  // Sin ningún workspace, "ya está en el dispositivo" no puede pasar; si pasara (otra pestaña), se abre.
  const open = (entry: DeviceWorkspace, invite?: { target: string | null }) => onAdded(entry, invite);
  return (
    <main className="center-screen">
      <div className="card welcome-card">
        <div className="brand-row">
          <AppIcon size={32} />
          <span>LGA Shot Docs</span>
        </div>
        {mode === 'start' && (
          <>
            <h1>Welcome</h1>
            <p className="muted">
              Notes for every shot: on set, offline, in sync. Everything lives in a workspace, which runs on its
              owner’s own accounts.
            </p>
            <WorkspaceChoices onJoin={() => setMode('join')} onCreate={() => setMode('create')} />
          </>
        )}
        {mode === 'join' && <JoinForm onJoined={open} onExisting={open} onBack={() => setMode('start')} />}
        {mode === 'create' && <CreateForm onAdded={(e) => open(e)} onExisting={(e) => open(e)} onBack={() => setMode('start')} />}
        <LegalLinks className="legal-links card-legal" />
      </div>
    </main>
  );
}

function WorkspaceChoices({ onJoin, onCreate }: { onJoin: () => void; onCreate: () => void }) {
  return (
    <div className="welcome-choices">
      <button className="welcome-choice" onClick={onJoin}>
        <MailIcon />
        <span>
          <strong>Join a workspace</strong>
          <span className="muted">Paste the invitation link you received.</span>
        </span>
      </button>
      <button className="welcome-choice" onClick={onCreate}>
        <PlusIcon />
        <span>
          <strong>Create my workspace</strong>
          <span className="muted">Set up your own, on free accounts of yours. It takes an afternoon.</span>
        </span>
      </button>
    </div>
  );
}

/**
 * El nombre que trae un link lo arma quien lo manda: sin comillas, saltos ni caracteres de control, y
 * recortado, para que no pueda hacerse pasar por el host.
 */
export function safeWorkspaceName(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/["'“”‘’«»`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > 40 ? `${clean.slice(0, 39).trimEnd()}…` : clean;
}

/**
 * "Join <nombre>?" con el host aparte y destacado: el host dice de verdad a qué servidor va lo que se
 * escriba; el nombre sale del link.
 */
export function JoinQuestion(props: {
  entry: DeviceWorkspace;
  onJoin: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  modal?: boolean;
}) {
  const host = hostOf(props.entry.url);
  const name = safeWorkspaceName(props.entry.name);
  const Heading = props.modal ? 'h2' : 'h1';
  return (
    <>
      <Heading>{name ? `Join ${name}?` : 'Join a workspace?'}</Heading>
      <div className="join-host">
        <span className="mono-label">Server</span>
        <strong>{host}</strong>
      </div>
      <p className="muted">
        This workspace runs on that server. What you write there goes to it and stays apart from your other
        workspaces. The name comes from the link; check the server, and join only if you trust the person who
        invited you.
      </p>
      <div className="welcome-actions">
        <button className="primary" autoFocus onClick={props.onJoin}>
          Join
        </button>
        <button className="link" onClick={props.onCancel}>
          {props.cancelLabel ?? 'Back'}
        </button>
      </div>
    </>
  );
}

/** Se llegó con un link de invitación de un workspace que este dispositivo no tiene. */
export function JoinConfirm({ entry, onJoin, onCancel }: { entry: DeviceWorkspace; onJoin: () => void; onCancel: () => void }) {
  return (
    <main className="center-screen">
      <div className="card welcome-card">
        <div className="brand-row">
          <AppIcon size={32} />
          <span>LGA Shot Docs</span>
        </div>
        <JoinQuestion entry={entry} onJoin={onJoin} onCancel={onCancel} cancelLabel="Not now" />
      </div>
    </main>
  );
}

/** Pegar el link de invitación y confirmar. */
export function JoinForm(props: {
  onJoined: (entry: DeviceWorkspace, invite: { target: string | null }) => void;
  /** El link es de un workspace que ya está en el dispositivo. */
  onExisting: (entry: DeviceWorkspace, invite: { target: string | null }) => void;
  onBack: () => void;
  modal?: boolean;
}) {
  const list = useWorkspaceList();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ entry: DeviceWorkspace; target: string | null } | null>(null);
  const Heading = props.modal ? 'h2' : 'h1';

  if (asking) {
    return (
      <JoinQuestion
        modal={props.modal}
        entry={asking.entry}
        onJoin={() => props.onJoined(asking.entry, { target: asking.target })}
        onCancel={() => setAsking(null)}
      />
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const result = resolveInviteText(list, text);
    if (result.kind === 'invalid') setError(result.reason);
    else if (result.kind === 'open') props.onExisting(result.entry, { target: result.target });
    else setAsking({ entry: result.entry, target: result.target });
  }

  return (
    <form className="welcome-form" onSubmit={submit}>
      <Heading>Join a workspace</Heading>
      <p className="muted">
        Paste the invitation link you received. Opening the link on this device works too.
      </p>
      <div className="field">
        <label htmlFor="invite-link">Invitation link</label>
        <input
          id="invite-link"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder="https://shotdocs.lega.com.ar/#invite=…"
        />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="welcome-actions">
        <button className="primary" disabled={!text.trim()}>
          Continue <ArrowRightIcon />
        </button>
        <button type="button" className="link" onClick={props.onBack}>
          Back
        </button>
      </div>
    </form>
  );
}

/** Conectar un workspace creado con la guía: la dirección y la clave publicable que imprime el comando. */
export function CreateForm(props: {
  onAdded: (entry: DeviceWorkspace) => void;
  onExisting: (entry: DeviceWorkspace) => void;
  onBack: () => void;
  modal?: boolean;
}) {
  const list = useWorkspaceList();
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<DeviceWorkspace | null>(null);
  const Heading = props.modal ? 'h2' : 'h1';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setExisting(null);
    const check = checkWorkspace(list, { url, publishableKey: key });
    if (check.kind === 'invalid') return setError(check.reason);
    if (check.kind === 'existing') return setExisting(check.entry);
    setBusy(true);
    const probe = await probeWorkspace(check.url, key.trim());
    setBusy(false);
    switch (probe.kind) {
      case 'ready': {
        const withKey = checkWorkspace(list, { url: check.url, publishableKey: key, localKey: probe.localKey });
        if (withKey.kind === 'invalid') return setError(withKey.reason);
        if (withKey.kind === 'existing') return setExisting(withKey.entry);
        return props.onAdded({
          id: probe.localKey,
          url: check.url,
          publishableKey: key.trim(),
          localKey: probe.localKey,
          name: probe.name.trim().slice(0, 200),
        });
      }
      case 'signInFirst':
        // La base no deja leer sus ajustes sin sesión: se leen después de que el dueño entra.
        return props.onAdded(pendingEntry(check.url, key));
      case 'noLocalKey':
      case 'notSetUp':
        return setError(NEEDS_SETUP_COMMAND);
      case 'badKey':
        return setError('This publishable key does not belong to that address. Copy both again from the end of the setup command.');
      case 'unreachable':
        return setError(`Could not reach ${hostOf(check.url)} (${probe.message}). Check the address and your internet connection.`);
    }
  }

  return (
    <form className="welcome-form" onSubmit={(e) => void submit(e)}>
      <Heading>Create my workspace</Heading>
      <p className="muted">
        A workspace of your own runs on free accounts of yours: Supabase, Resend, Google Drive, Cloudflare and
        GitHub. The guide takes you through it step by step.
      </p>
      <a className="welcome-guide" href={GUIDE_URL} target="_blank" rel="noopener noreferrer">
        Open the guide: Create your own workspace <ArrowRightIcon size={16} />
      </a>
      <p className="muted">When the setup command has finished (step 4 of the guide), paste what it printed at the end:</p>
      <div className="field">
        <label htmlFor="ws-url">Project URL</label>
        <input
          id="ws-url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://abcdefghijklmnopqrst.supabase.co"
        />
      </div>
      <div className="field">
        <label htmlFor="ws-key">Publishable key</label>
        <input
          id="ws-key"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sb_publishable_…"
        />
      </div>
      {error && <p className="error">{error}</p>}
      {existing && (
        <p className="muted">
          “{displayName(existing)}” is already on this device.{' '}
          <button type="button" className="link" onClick={() => props.onExisting(existing)}>
            Open it
          </button>
        </p>
      )}
      <div className="welcome-actions">
        <button className="primary" disabled={busy || !url.trim() || !key.trim()}>
          {busy ? 'Checking…' : 'Connect'}
        </button>
        <button type="button" className="link" onClick={props.onBack}>
          Back
        </button>
      </div>
    </form>
  );
}

/**
 * Uno agregado con "Create" cuya clave local no se pudo leer antes de entrar: después de entrar se lee
 * `workspace_settings`, la sesión pasa a los nombres de su clave local y la app recarga.
 */
export function FinishPending() {
  const { client, config } = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    void (async () => {
      const { data, error } = await client.from('workspace_settings').select('*').maybeSingle();
      if (!live) return;
      if (error) {
        setError(`Could not read the workspace settings (${error.message}). Check your connection and try again.`);
        return;
      }
      const row = data as { name?: string | null; local_key?: string | null } | null;
      if (!row?.local_key) {
        setError(NEEDS_SETUP_COMMAND);
        return;
      }
      // Que la sesión no se renueve mientras pasa a su nombre nuevo: la copia quedaría vieja.
      await client.auth.stopAutoRefresh();
      const result = adoptPending(config.localKey, { name: row.name ?? null, localKey: row.local_key });
      if (!result.ok) {
        void client.auth.startAutoRefresh();
        if (live) setError(result.reason);
        return;
      }
      location.replace('/');
    })();
    return () => {
      live = false;
    };
  }, [client, config.localKey, attempt]);

  async function cancel() {
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    forgetPending(config.localKey);
    location.replace('/');
  }

  return (
    <main className="center-screen">
      <div className="card">
        <h1>{error ? 'The workspace could not be added' : 'Adding your workspace…'}</h1>
        <p className="muted">{error ?? `Reading the settings of ${hostOf(config.url)}.`}</p>
        {error && (
          <>
            <button className="primary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
            <button className="link" onClick={() => void cancel()}>
              Remove it from this device
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function forgetPending(id: string): void {
  let removed: DeviceWorkspace | undefined;
  updateWorkspaces((l) => {
    removed = l.workspaces.find((w) => w.id === id);
    return removeWorkspace(l, id);
  });
  if (removed) forgetWorkspaceStorage(removed);
}

/** Agregar o abrir un workspace desde la app ya abierta: se guarda en la lista y la app recarga en él. */
export function openAndReload(entry: DeviceWorkspace, invite?: { target: string | null }, isNew = true): void {
  updateWorkspaces((l) => (isNew ? addWorkspace(l, entry) : setActive(l, entry.id)));
  // La página de un link se abre después de entrar (cada workspace la guarda con su nombre).
  const key = configOf(entry).storage.inviteTarget;
  if (invite?.target) rememberInviteTarget(key, invite.target);
  else if (!isNew) clearInviteTarget(key);
  location.replace('/');
}

export type WorkspacesMode = 'start' | 'list' | 'join' | 'create';

/**
 * El diálogo de workspaces: la lista para cambiar (desde el login), unirse o crear. `beforeLeave` pregunta
 * antes de dejar el workspace abierto (cambios sin subir); `false` cancela.
 */
export function WorkspacesDialog(props: {
  initial: WorkspacesMode;
  currentId: string;
  onClose: () => void;
  beforeLeave?: () => boolean;
}) {
  const list = useWorkspaceList();
  const [mode, setMode] = useState<WorkspacesMode>(props.initial);
  const [removable, setRemovable] = useState(false);
  const current = list.workspaces.find((w) => w.id === props.currentId) ?? null;
  const back = () => (props.initial === mode ? props.onClose() : setMode(props.initial));

  // Desde el login (sin sesión) se ofrece quitar el workspace abierto solo si no tiene nada guardado en el
  // dispositivo: con una base local, se quita desde adentro, después de ver si tiene cambios sin subir.
  useEffect(() => {
    let live = true;
    if (props.initial !== 'list' || !current || current.legacy) return;
    void hasLocalData(current).then((has) => live && setRemovable(has === false));
    return () => {
      live = false;
    };
  }, [props.initial, current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  const leave = (fn: () => void) => {
    if (props.beforeLeave && !props.beforeLeave()) return;
    fn();
  };

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal workspaces-dialog"
        role="dialog"
        aria-label="Workspaces"
        onClick={(e) => e.stopPropagation()}
      >
        {(mode === 'start' || mode === 'list') && (
          <>
            <h2>Workspaces</h2>
            {mode === 'list' && (
              <div className="workspace-list">
                {list.workspaces.map((w) => (
                  <button
                    key={w.id}
                    className="workspace-row"
                    aria-current={w.id === props.currentId ? 'true' : undefined}
                    onClick={() => (w.id === props.currentId ? props.onClose() : leave(() => switchWorkspace(w.id)))}
                  >
                    <span className="monogram" aria-hidden="true">
                      {monogram(displayName(w))}
                    </span>
                    <span className="project-label">
                      <strong>{displayName(w)}</strong>
                      <span>{w.pending ? `${hostOf(w.url)} · sign in to finish` : hostOf(w.url)}</span>
                    </span>
                    {w.id === props.currentId && <span className="current-mark">Open</span>}
                  </button>
                ))}
              </div>
            )}
            {mode === 'start' && (
              <p className="muted">
                Each workspace has its own server and its own sign-in. This device keeps them apart.
              </p>
            )}
            <WorkspaceChoices onJoin={() => setMode('join')} onCreate={() => setMode('create')} />
            {removable && current && (
              <button
                className="link danger"
                onClick={() => {
                  if (!confirm(`Remove “${displayName(current)}” from this device? Nothing of it is stored here.`)) return;
                  forgetPending(current.id);
                  location.replace('/');
                }}
              >
                Remove “{displayName(current)}” from this device
              </button>
            )}
            <div className="modal-actions">
              <button className="link" onClick={props.onClose}>
                Close
              </button>
            </div>
          </>
        )}
        {mode === 'join' && (
          <JoinForm
            modal
            onBack={back}
            onJoined={(entry, invite) => leave(() => openAndReload(entry, invite))}
            onExisting={(entry, invite) =>
              entry.id === props.currentId ? props.onClose() : leave(() => openAndReload(entry, invite, false))
            }
          />
        )}
        {mode === 'create' && (
          <CreateForm
            modal
            onBack={back}
            onAdded={(entry) => leave(() => openAndReload(entry))}
            onExisting={(entry) => (entry.id === props.currentId ? props.onClose() : leave(() => openAndReload(entry, undefined, false)))}
          />
        )}
      </div>
    </div>
  );
}

/**
 * En el login: en qué workspace se entra y cómo cambiar. Con Wanka sola (lo de siempre en la dirección de
 * Lega) no se muestra nada.
 */
export function LoginWorkspaceBar() {
  const { config } = useWorkspace();
  const list = useWorkspaceList();
  const [open, setOpen] = useState(false);
  const current = list.workspaces.find((w) => w.id === config.localKey);
  if (!current || (current.legacy && list.workspaces.length === 1)) return null;
  return (
    <>
      <div className="login-workspace">
        <span className="muted">Workspace</span>
        <strong data-tip={hostOf(current.url)} data-tip-plain>
          {displayName(current)}
        </strong>
        <button type="button" className="link" onClick={() => setOpen(true)}>
          Change
        </button>
      </div>
      {current.pending && (
        <p className="login-invite">
          Sign in with the owner’s email to finish adding the workspace at {hostOf(current.url)}.
        </p>
      )}
      {open && <WorkspacesDialog initial="list" currentId={current.id} onClose={() => setOpen(false)} />}
    </>
  );
}

