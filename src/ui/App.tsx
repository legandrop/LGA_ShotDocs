import { useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { t, useT } from '../i18n';
import { isPublicRoute, parseRoute, useRoute, type Route } from '../router';
import { filePath, takeWorkspaceHash } from '../fileLink';
import { markInviteArrival, setArrivalNotice, takeInviteHash } from '../invite';
import { buildWorkspace, createWorkspaceClient, WorkspaceContext, type ActiveWorkspace } from '../workspace';
import {
  activeWorkspace,
  addWorkspace,
  configOf,
  displayName,
  loadWorkspaces,
  resolveInvite,
  sameOrigin,
  setActive,
  type WorkspaceList,
  updateWorkspaces,
  type DeviceWorkspace,
} from '../workspaces';
import { activeLink, rememberLink, readLinks, setTabLink, tabLink, takeLinkHash, linkDomain, type LinkEntry, type LinkPayload } from '../linkMode';
import { LegalPage } from './Legal';
import { LinkApp, LinkConfirm } from './LinkApp';
import { lazyPart, Part } from './lazyPart';
import { Login } from './Login';
import { TooltipLayer } from './Tooltip';
import { FinishPending, JoinConfirm, Welcome } from './Welcome';
import { Workspace } from './Workspace';

// La medición del espacio del dispositivo (P.10, sección 9.1): se baja solo si se abre.
const StorageTest = lazyPart(() => import('./StorageTest').then((m) => m.StorageTest));
// La pantalla de permiso de un asistente (MCP, Doc_Asistente.md, 9.2): se baja solo si se llega a esa dirección.
const OAuthConsent = lazyPart(() => import('./OAuthConsent').then((m) => m.OAuthConsent));

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
      ) : route.name === 'oauthConsent' ? (
        // Sin el arranque de la app (links de invitación o públicos, lista de workspaces): el ref de la dirección
        // elige el workspace y la pantalla pide entrar si hace falta.
        <Part>
          <OAuthConsent projectRef={route.projectRef} />
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
  /** Un link público (Docs/Doc_Link_Publico.md): sin cuenta, con su propio cliente sin sesión. */
  | { kind: 'link'; link: LinkEntry }
  /** Un link público de un servidor que el dispositivo no conoce: se pregunta antes, con el dominio. */
  | { kind: 'linkConfirm'; payload: LinkPayload; fallback: Start }
  /** No hay ningún workspace en el dispositivo. */
  | { kind: 'welcome' }
  /** Se llegó con un link de invitación de un workspace que el dispositivo no tiene: se pregunta antes. */
  | { kind: 'confirm'; entry: DeviceWorkspace; target: string | null; fallback: DeviceWorkspace | null; file?: boolean };

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
  // Un link público (P1): se lee y se borra de la barra antes que nada. Abre siempre el modo link, sin usar ninguna
  // sesión (P14, simplificado: ver el informe de la entrega 1).
  const link = takeLinkHash();
  if (link.broken) setArrivalNotice(t('link.broken'));
  if (link.payload) {
    const payload = link.payload;
    const known =
      list.workspaces.some((w) => sameOrigin(w.url, payload.u)) || readLinks().links.some((l) => sameOrigin(l.url, payload.u));
    const otherwise: Start = fallback ? { kind: 'open', entry: fallback } : { kind: 'welcome' };
    if (!known) return { kind: 'linkConfirm', payload, fallback: otherwise };
    return { kind: 'link', link: openLinkInTab(payload) };
  }
  // La dirección fija de un archivo (P.30, Docs/Doc_Links_PDF.md, 2.2): antes que el link de la pestaña y el último link
  // abierto (si no, un dispositivo que alguna vez abrió un link ignoraría el `#ws=`).
  const route = typeof location === 'undefined' ? null : parseRoute(location.pathname);
  if (route?.name === 'file') return fileStart(list, route, fallback);
  // Recargar la página de un link (el `#` ya no está en la barra): sigue en el link, aunque el dispositivo tenga un
  // workspace. Una pestaña nueva abre la app de siempre.
  const inTab = tabLink();
  if (inTab) return { kind: 'link', link: inTab };
  // Sin workspaces en el dispositivo, el último link abierto (quien solo entra con links vuelve a lo suyo).
  const lastLink = activeLink();
  if (!fallback && lastLink) return { kind: 'link', link: lastLink };
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

/**
 * A qué workspace va la dirección de un archivo (`/f/<clave local>/<id>#ws=…`). La configuración del dispositivo manda:
 * un `#ws=` nunca cambia a qué servidor va un workspace que ya está (LF2); uno nuevo se confirma antes, como una
 * invitación. Lo que no cierra (roto, otra clave, choque) vuelve al inicio con un aviso, nunca abre otra isla.
 */
export function fileStart(list: WorkspaceList, route: Extract<Route, { name: 'file' }>, fallback: DeviceWorkspace | null): Start {
  const { payload, broken } = takeWorkspaceHash();
  const otherwise: Start = fallback ? { kind: 'open', entry: fallback } : { kind: 'welcome' };
  const leave = (notice: string): Start => {
    setArrivalNotice(notice);
    history.replaceState(null, '', '/');
    return otherwise;
  };
  if (broken) return leave(t('file.incomplete'));
  // Recargar una pestaña del modo link en la dirección de un archivo: sigue en el link.
  if (!payload) {
    const inTab = tabLink();
    if (inTab && inTab.localKey === route.localKey) return { kind: 'link', link: inTab };
  }
  const own = list.workspaces.find((w) => !w.pending && configOf(w).localKey === route.localKey);
  if (own) {
    // La misma clave con otra dirección: el error de una invitación que choca (no se abre el del dispositivo en silencio).
    if (payload && !sameOrigin(payload.u, own.url)) return leave(t('wsError.localKeyClash', { name: displayName(own) }));
    updateWorkspaces((l) => setActive(l, own.id));
    return { kind: 'open', entry: own };
  }
  if (!payload || payload.l !== route.localKey) return leave(t('file.incomplete'));
  const invite = resolveInvite(list, { u: payload.u, k: payload.k, l: payload.l });
  if (invite.kind === 'invalid') return leave(invite.reason);
  if (invite.kind === 'open') {
    // El dispositivo ya tiene ese Supabase con otra clave local: se abre ese, y la dirección pasa a decir su clave.
    updateWorkspaces((l) => setActive(l, invite.entry.id));
    history.replaceState(null, '', filePath(configOf(invite.entry).localKey, route.id));
    return { kind: 'open', entry: invite.entry };
  }
  return { kind: 'confirm', entry: invite.entry, target: null, fallback, file: true };
}

/** Guarda el link y lo deja como el de esta pestaña (para que recargar siga en el link). */
function openLinkInTab(payload: LinkPayload): LinkEntry {
  const entry = rememberLink(payload);
  setTabLink(entry.id);
  return entry;
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
        onJoin={() => (start.file ? openNew(start.entry) : openNew(start.entry, { target: start.target }))}
        onCancel={() => {
          // No abrir la dirección de un archivo en otro workspace.
          if (start.file) history.replaceState(null, '', '/');
          setStart(start.fallback ? { kind: 'open', entry: start.fallback } : { kind: 'welcome' });
        }}
      />
    );
  }
  if (start.kind === 'linkConfirm') {
    return (
      <LinkConfirm
        domain={linkDomain({ url: start.payload.u })}
        onOpen={() => setStart({ kind: 'link', link: openLinkInTab(start.payload) })}
        onCancel={() => setStart(start.fallback)}
      />
    );
  }
  if (start.kind === 'link') return <LinkApp entry={start.link} />;
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
