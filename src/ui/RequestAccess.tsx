import { useState } from 'react';
import { locale, useT } from '../i18n';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  askedAt,
  askedScope,
  rememberAsked,
  requestAccess,
  requestPageAccess,
  requestSceneAccess,
  SCENE_REQUESTS_SCHEMA_VERSION,
  sceneAskedId,
  sceneTarget,
  type AccessTarget,
} from '../sync/accessRequests';
import { errorMessage, isNetworkError } from '../sync/types';
import { useWorkspaceList } from '../workspaces';
import { useLinkMode } from '../linkMode';
import { useSearchParam } from '../router';
import { useServices, useSyncStatus } from '../services';

// *Request access* (P.30; Docs/Doc_Links_PDF.md, 5.2): en la pantalla sin acceso de un archivo (`/f/`, entrega 2) y de una
// página (`/p/<id>`, entrega 3). Antes de mandar dice quién va a ver el pedido (LF19). La respuesta de la base es la misma
// exista o no lo pedido, así que la pantalla nunca dice nada de él; el dispositivo anota cuándo se pidió (la base no deja
// listar los pedidos propios).

export function RequestAccess({
  client,
  userId,
  localKey,
  target,
  onHasAccess,
}: {
  /** El cliente del workspace con la sesión de quien pide (con o sin la sincronización abierta: O2, sin proyectos). */
  client: SupabaseClient;
  userId: string;
  localKey: string;
  target: AccessTarget;
  /** La base dice que ya lo ve: la pantalla vuelve a preguntar (el archivo) o sincroniza el árbol (la página). */
  onHasAccess: () => void;
}) {
  const tr = useT();
  const scope = askedScope(localKey, userId);
  const [asked, setAsked] = useState(() => askedAt(scope, target));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const page = target.kind === 'page';

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = page ? await requestPageAccess(client, target.id) : await requestAccess(client, target.id);
      if (res === 'has_access') return onHasAccess();
      rememberAsked(scope, target);
      setAsked(askedAt(scope, target) ?? new Date().toISOString());
      setSent(true);
      setConfirming(false);
    } catch (err) {
      setError(
        isNetworkError(err)
          ? tr('file.requestOffline')
          : errorMessage(err) === 'rate_limited'
            ? tr('file.requestLimited')
            : tr('file.requestFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  const day = asked ? new Intl.DateTimeFormat(locale(tr.lang), { month: 'short', day: 'numeric' }).format(Date.parse(asked)) : null;
  return (
    <div className="file-request">
      {sent ? (
        <p>{tr(page ? 'page.requestSent' : 'file.requestSent')}</p>
      ) : day ? (
        <p className="muted">{tr('file.requestedOn', { date: day })}</p>
      ) : null}
      {!sent && !day && <p className="muted">{tr(page ? 'page.requestHint' : 'file.requestHint')}</p>}
      {confirming ? (
        <>
          <p className="muted small">{tr(page ? 'page.requestNote' : 'file.requestNote')}</p>
          <div className="file-request-actions">
            <button className="primary" disabled={busy} onClick={() => void send()}>
              {tr('file.request')}
            </button>
            <button disabled={busy} onClick={() => setConfirming(false)}>
              {tr('common.cancel')}
            </button>
          </div>
        </>
      ) : (
        !sent && (
          <button className="primary" onClick={() => setConfirming(true)}>
            {day ? tr('file.requestAgain') : tr('file.request')}
          </button>
        )
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * Pedir una escena desde su link (`/map/scenes?project=…&scene=…`; Docs/Doc_Compartir_Escenas.md, B-2). Hay NDA: la
 * pantalla es la misma exista o no el proyecto o la escena, y no muestra nada de ellos (ni lo que dice el link): solo
 * «You don't have access to this. Request access?» y el botón; después, «Request sent». La base responde siempre lo mismo
 * (`sent`). `canRequest`: con cuenta, red y la base en la 29; si no, solo la primera frase.
 */
export function SceneRequestAccess({
  client,
  userId,
  localKey,
  project,
  scene,
  canRequest,
}: {
  client: SupabaseClient;
  userId: string;
  localKey: string;
  /** El `project=` del link: un id o un nombre. */
  project: string;
  /** El `scene=` del link, en cualquier forma. */
  scene: string;
  canRequest: boolean;
}) {
  const tr = useT();
  const target = sceneTarget(project, scene);
  const scope = askedScope(localKey, userId);
  const key: AccessTarget | null = target ? { kind: 'scene', id: sceneAskedId(target) } : null;
  const [asked, setAsked] = useState(() => (key ? askedAt(scope, key) : null));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!target || !key) return;
    setBusy(true);
    setError(null);
    try {
      await requestSceneAccess(client, target);
      rememberAsked(scope, key);
      setAsked(askedAt(scope, key) ?? new Date().toISOString());
      setSent(true);
    } catch (err) {
      setError(
        isNetworkError(err)
          ? tr('file.requestOffline')
          : errorMessage(err) === 'rate_limited'
            ? tr('file.requestLimited')
            : tr('file.requestFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  const offer = canRequest && !!target;
  const day = asked ? new Intl.DateTimeFormat(locale(tr.lang), { month: 'short', day: 'numeric' }).format(Date.parse(asked)) : null;
  if (sent) {
    return (
      <div className="file-request scene-request" role="status">
        <p>{tr('page.sceneRequestSent')}</p>
      </div>
    );
  }
  return (
    <div className="file-request scene-request">
      <p>{offer && !day ? `${tr('page.sceneNoAccess')} ${tr('page.sceneRequestAsk')}` : tr('page.sceneNoAccess')}</p>
      {offer && day && <p className="muted">{tr('file.requestedOn', { date: day })}</p>}
      {offer && (
        <div className="file-request-actions">
          <button className="primary" disabled={busy} onClick={() => void send()}>
            {day ? tr('file.requestAgain') : tr('file.request')}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * Si se sabe de qué workspace es una dirección de página (`/p/<id>`, sección 19 de Doc_Links_PDF.md, O1): la dirección
 * no lo dice, así que solo se sabe con un solo workspace en el dispositivo. Con más de uno, *Request access* de una página
 * no se ofrece (el pedido iría a la base del que está abierto). La dirección de un archivo (`/f/<clave local>/<id>`) sí
 * lo dice y no pasa por acá.
 */
export function usePageWorkspaceKnown(): boolean {
  return useWorkspaceList().workspaces.length <= 1;
}

/** El `w=` de una dirección: con él, el arranque ya eligió el workspace del link (Doc_Link_Escena.md). */
export const WORKSPACE_PARAM = 'w';

/**
 * La pantalla sin acceso del link de una escena, con la sincronización abierta (el Panorama): el proyecto del link no está
 * entre los que ve la persona, o lo ve en parte y la escena no está en lo que ve (D401). `project`: el id del proyecto
 * (si se resolvió) o lo que dice el link. Se ofrece pedir con cuenta, red, la base en la 29 y el workspace del link
 * conocido (con `w=`, o uno solo en el dispositivo: sin eso, el pedido iría a la base de otro workspace).
 */
export function SceneNoAccess({ project }: { project: string }) {
  const { client, user, workspace } = useServices();
  const { online, schemaVersion } = useSyncStatus();
  const link = useLinkMode();
  const scene = useSearchParam('scene') ?? '';
  const single = usePageWorkspaceKnown();
  const named = useSearchParam(WORKSPACE_PARAM) !== null;
  const known = single || named;
  const tr = useT();
  const canRequest = !link && online && known && (schemaVersion ?? 0) >= SCENE_REQUESTS_SCHEMA_VERSION;
  return (
    <>
      <SceneRequestAccess
        key={`${project}|${scene}`}
        client={client}
        userId={user.id}
        localKey={workspace.config.localKey}
        project={project}
        scene={scene}
        canRequest={canRequest}
      />
      {!link && !known && <p className="muted">{tr('page.otherWorkspace')}</p>}
    </>
  );
}
