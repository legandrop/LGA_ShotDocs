import { useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { t, useT } from '../i18n';
import { isPublicRoute, useRoute } from '../router';
import { markInviteArrival, setArrivalNotice, takeInviteHash } from '../invite';
import { buildWorkspace, createWorkspaceClient, WorkspaceContext, type ActiveWorkspace } from '../workspace';
import {
  activeWorkspace,
  addWorkspace,
  configOf,
  loadWorkspaces,
  resolveInvite,
  setActive,
  updateWorkspaces,
  type DeviceWorkspace,
} from '../workspaces';
import { LegalPage } from './Legal';
import { lazyPart, Part } from './lazyPart';
import { Login } from './Login';
import { TooltipLayer } from './Tooltip';
import { FinishPending, JoinConfirm, Welcome } from './Welcome';
import { Workspace } from './Workspace';

// La medición del espacio del dispositivo (P.10, sección 9.1): se baja solo si se abre.
const StorageTest = lazyPart(() => import('./StorageTest').then((m) => m.StorageTest));

export function App() {
  // La política de privacidad y las condiciones se ven antes de todo lo demás: sin sesión, sin workspace y sin
  // crear ningún cliente de Supabase ni leer el link de invitación (Google las revisa sin cuenta).
  const route = useRoute();
  return (
    <>
      {route.name === 'storageTest' ? (
        <Part>
          <StorageTest />
        </Part>
      ) : isPublicRoute(route) ? (
        <LegalPage page={route.name} />
      ) : (
        <Screen />
      )}
      <TooltipLayer />
    </>
  );
}

type Start =
  | { kind: 'open'; entry: DeviceWorkspace }
  /** No hay ningún workspace en el dispositivo. */
  | { kind: 'welcome' }
  /** Se llegó con un link de invitación de un workspace que el dispositivo no tiene: se pregunta antes. */
  | { kind: 'confirm'; entry: DeviceWorkspace; target: string | null; fallback: DeviceWorkspace | null };

let started: Start | null = null;

// Una sola vez por carga (el modo estricto de React llama dos veces al inicializador, y el link de la
// dirección se lee una sola vez).
function startup(): Start {
  started ??= computeStart();
  return started;
}

/**
 * Al abrir la app, antes de crear ningún cliente de Supabase: la lista de workspaces del dispositivo (con el
 * de la compilación adentro, con sus nombres de siempre) y el link de invitación, si se llegó con uno.
 */
function computeStart(): Start {
  const build = buildWorkspace();
  const list = loadWorkspaces(build ? { url: build.url, publishableKey: build.publishableKey } : null);
  const fallback = activeWorkspace(list);
  const { payload, broken } = takeInviteHash();
  if (broken) setArrivalNotice(t('invite.incomplete'));
  if (payload) {
    const invite = resolveInvite(list, payload);
    if (invite.kind === 'open') {
      // Ya está en el dispositivo: se abre ese, con la página del link después de entrar.
      updateWorkspaces((l) => setActive(l, invite.entry.id));
      markInviteArrival(invite.target, configOf(invite.entry).storage.inviteTarget);
      return { kind: 'open', entry: invite.entry };
    }
    if (invite.kind === 'confirm') return { kind: 'confirm', entry: invite.entry, target: invite.target, fallback };
    setArrivalNotice(invite.reason);
  }
  return fallback ? { kind: 'open', entry: fallback } : { kind: 'welcome' };
}

function Screen() {
  const [start, setStart] = useState<Start>(startup);

  /**
   * Agrega un workspace a la lista y lo abre. Todavía no hay ningún cliente creado: no hace falta recargar.
   * `invite`: se unió con un link (el login lo explica y la página se abre después de entrar).
   */
  const openNew = (entry: DeviceWorkspace, invite?: { target: string | null }) => {
    updateWorkspaces((l) => addWorkspace(l, entry));
    if (invite) markInviteArrival(invite.target, configOf(entry).storage.inviteTarget);
    setStart({ kind: 'open', entry });
  };

  if (start.kind === 'confirm') {
    return (
      <JoinConfirm
        entry={start.entry}
        onJoin={() => openNew(start.entry, { target: start.target })}
        onCancel={() => setStart(start.fallback ? { kind: 'open', entry: start.fallback } : { kind: 'welcome' })}
      />
    );
  }
  if (start.kind === 'welcome') return <Welcome onAdded={openNew} />;
  return <Opened entry={start.entry} />;
}

function Opened({ entry }: { entry: DeviceWorkspace }) {
  // Un solo cliente por workspace y por carga de la app: cambiar de workspace recarga la app.
  const active = useMemo<ActiveWorkspace>(() => {
    const config = configOf(entry);
    return { config, client: createWorkspaceClient(config) };
  }, [entry]);
  return (
    <WorkspaceContext.Provider value={active}>
      <Signed active={active} pending={!!entry.pending} />
    </WorkspaceContext.Provider>
  );
}

function Signed({ active, pending }: { active: ActiveWorkspace; pending: boolean }) {
  const auth = useAuth(active.config, active.client);
  const tr = useT();
  if (auth.status === 'loading') return <main className="center-screen muted">{tr('common.loading')}</main>;
  if (auth.status === 'signedOut') return <Login />;
  // Agregado con "Create" sin poder leer la clave local antes de entrar: se completa ahora.
  if (pending) return <FinishPending />;
  return <Workspace key={auth.user.id} user={auth.user} />;
}
