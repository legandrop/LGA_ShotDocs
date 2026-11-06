import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/teamDialogs';
import { sceneLabel } from '../relations/reader';
import { useAccessRequests, useServices, useSyncStatus, useTree } from '../services';
import { GRANT_LEVELS, LEVEL_LABELS, ROLE_LABELS, type GrantLevel } from '../sync/access';
import type { AccessRequest, SceneLevel } from '../sync/accessRequests';
import { AccessRequestRow, agoText, requestText } from './AccessRequestRow';
import { outsideReadersStore } from './outsideReaders';
import { MARKS_PENDING, markScenes, projectSceneItems, resolveProjectScene } from './projectScenes';
import { ShareGateNotes, UNSYNCED_BEFORE_SHARE, useShareGate } from './shareGate';
import { teamErrorText } from './teamText';

// Los pedidos de acceso a un archivo o a una página (P.30, entregas 2 y 3; Docs/Doc_Links_PDF.md, 5.3): lo que se decide, desde la campana
// (en una ventana) y en *Share* de la página. Se baja aparte; la fila de cada pedido está en AccessRequestRow.tsx. Dar
// acceso es un permiso de los de siempre sobre una página que usa el archivo (la primera donde se agregó, por defecto),
// *View* por defecto, con el mismo paso previo que *Share* para quien no ve lo borrado (useShareGate). Rechazar es un
// botón aparte (LF20). Decidir pide red.

/**
 * Decidir un pedido. `pageId`: la página donde se abrió (*Share*), elegida si el archivo está ahí. `onDone`: decidido
 * (o ya no estaba); `onCancel`: sin decidir.
 */
export function AccessRequestForm({
  request,
  pageId,
  onDone,
  onCancel,
}: {
  request: AccessRequest;
  pageId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const { accessRequests } = useServices();
  const status = useSyncStatus();
  const gate = useShareGate();
  const first = request.pages.some((p) => p.pageId === pageId) ? pageId! : request.pages[0].pageId;
  const [page, setPage] = useState(first);
  const [level, setLevel] = useState<GrantLevel>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const give = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    give.current?.focus({ preventScroll: true });
  }, []);

  /** Quien recibe Ver o Comentar, o es invitado, no ve lo borrado: lo pendiente de la página sube antes. */
  const reader = level === 'view' || level === 'comment' || request.role === 'guest';

  // *Retry* y *Share anyway* mandan el formulario de ese momento, y cambiar la página o el nivel borra el aviso: era
  // del pedido de antes (compartir con la persona equivocada; auditoría de Doc_Compartir_Escenas.md).
  const latestDecide = useRef<(accept: boolean, anyway?: boolean) => Promise<void>>(async () => undefined);
  useEffect(() => {
    gate.clearBlocked();
  }, [page, level]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(accept: boolean, anyway = false) {
    if (!accessRequests || busy) return;
    setBusy(true);
    setError(null);
    if (anyway) gate.clearBlocked();
    const scope = { pageId: page };
    try {
      if (accept && !anyway && !(await gate.ready(scope, reader, () => void latestDecide.current(true), () => void latestDecide.current(true, true)))) return;
      await accessRequests.decide(request.id, accept, accept ? page : null, level);
      if (accept) gate.after(scope, reader, request.email);
      onDone();
    } catch (err) {
      // Ya decidido por otro o sin red: queda la ventana con el motivo (la lista ya lo sacó si no estaba).
      setError(teamErrorText(err));
    } finally {
      setBusy(false);
    }
  }
  latestDecide.current = decide;

  const offline = !status.online;
  return (
    <div className="access-request-form" role="group" aria-label={tr('requests.title')}>
      <p>
        <strong>{requestText(request, tr)}</strong>
      </p>
      <p className="muted small">
        {tr(ROLE_LABELS[request.role])} · {agoText(request.askedAt, tr.lang)}
      </p>
      <div className="access-request-fields">
        {request.pages.length > 1 ? (
          <label>
            <span className="pref-label">{tr('requests.page')}</span>
            <select value={page} disabled={busy} onChange={(e) => setPage(e.target.value)}>
              {request.pages.map((p) => (
                <option key={p.pageId} value={p.pageId}>
                  {p.title || tr('common.untitled')}
                </option>
              ))}
            </select>
          </label>
        ) : (
          // Una sola página: el mismo renglón de rótulo y valor que el nivel, así quedan alineados (O5).
          <div className="access-request-field">
            <span className="pref-label">{tr('requests.page')}</span>
            <span className="access-request-page">{request.pages[0].title || tr('common.untitled')}</span>
          </div>
        )}
        <label>
          <span className="pref-label">{tr('requests.level')}</span>
          <select value={level} disabled={busy} onChange={(e) => setLevel(e.target.value as GrantLevel)}>
            {GRANT_LEVELS.map((l) => (
              <option key={l} value={l}>
                {tr(LEVEL_LABELS[l])}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">{tr('requests.scope')}</p>
      <ShareGateNotes gate={gate} reader={reader} />
      {offline && <p className="muted small">{tr('requests.offline')}</p>}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          {tr('common.cancel')}
        </button>
        <button type="button" className="danger" disabled={busy || offline} onClick={() => void decide(false)}>
          {tr('requests.decline')}
        </button>
        <button ref={give} type="button" className="primary" disabled={busy || offline} onClick={() => void decide(true)}>
          {tr('requests.give')}
        </button>
      </div>
    </div>
  );
}

/**
 * En *Share* de una página: los pedidos de esa página y de sus archivos que la persona puede decidir, arriba (LF12). *Review*
 * abre la decisión ahí mismo, con esta página elegida. `onDecided`: para volver a leer quién tiene acceso.
 */
export function ShareRequests({ pageId, onDecided }: { pageId: string; onDecided: () => void }) {
  const tr = useT();
  const { accessRequests } = useServices();
  const requests = useAccessRequests();
  const [reviewing, setReviewing] = useState<AccessRequest | null>(null);
  useEffect(() => {
    void accessRequests?.poll();
  }, [accessRequests]);
  const here = requests.ready ? requests.items.filter((r) => r.pages.some((p) => p.pageId === pageId)) : [];
  if (!reviewing && here.length === 0) return null;
  return (
    <section className="share-requests" aria-label={tr('requests.onPage')}>
      {reviewing ? (
        <AccessRequestForm
          request={reviewing}
          pageId={pageId}
          onDone={() => {
            setReviewing(null);
            onDecided();
          }}
          onCancel={() => setReviewing(null)}
        />
      ) : (
        <>
          <span className="pref-label">{tr('requests.onPage')}</span>
          <ul className="access-requests">
            {here.map((r) => (
              <AccessRequestRow key={r.id} request={r} onReview={() => setReviewing(r)} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Decidir el pedido de una escena desde su link (Docs/Doc_Compartir_Escenas.md, B-2). La escena del link se busca entre las
 * del proyecto con el lector del Panorama y, si aparece y el proyecto salió por el id o por el nombre entero, la lista queda
 * fija en ella. Si no aparece, o el proyecto salió solo por la primera palabra del nombre (el link decía «mor» y el
 * proyecto se llama «MOR 2»: puede ser otro), se elige a mano, y *Give access* pide confirmar «the link asked for X,
 * you're giving Y» (o se rechaza). Antes de *Give access* dice
 * qué es la página y cuántas lleva adentro (M6), y una escena con otra entidad adentro no se puede dar (como en *Share
 * scenes*). Dar acceso es lo de *Share scenes* para una escena: Ver o Comentar, la marca de escena escrita y subida antes,
 * la compuerta sin *Share anyway*, y la base vuelve a controlar todo (`set_page_shares`).
 */
export function SceneRequestForm({ request, onDone, onCancel }: { request: AccessRequest; onDone: () => void; onCancel: () => void }) {
  const tr = useT();
  const services = useServices();
  const { accessRequests, engine } = services;
  const tree = useTree();
  const status = useSyncStatus();
  const gate = useShareGate();
  const projectId = request.scene!.projectId;
  const asked = request.scene!.text;
  const linkText = request.scene!.linkText;
  const byWord = !request.scene!.exact;
  const projectName = tree.project(projectId)?.name;
  const revision = tree.getRevision();
  const scenes = useMemo(() => projectSceneItems(tree, engine, projectId), [tree, revision, projectId, engine]); // eslint-disable-line react-hooks/exhaustive-deps
  const resolved = useMemo(() => resolveProjectScene(tree, projectId, asked), [tree, revision, projectId, asked]); // eslint-disable-line react-hooks/exhaustive-deps
  // La escena que el link nombra sin dudas: con ella la lista queda fija. Por la primera palabra, nunca sola.
  const fixed = byWord ? null : resolved;
  const [page, setPage] = useState<string>(() => fixed ?? '');
  const [level, setLevel] = useState<SceneLevel>('view');
  // Elegida a mano: el primer *Give access* muestra qué pedía el link y qué se da; el segundo da.
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El proyecto puede estar terminando de bajar: la escena del link, apenas aparece (si no se eligió otra).
  useEffect(() => {
    if (fixed && page !== fixed) setPage(fixed);
  }, [fixed]); // eslint-disable-line react-hooks/exhaustive-deps
  // Otra escena u otro nivel: el aviso de lo pendiente (y su *Retry*) era del pedido de antes, y la confirmación también.
  useEffect(() => {
    gate.clearBlocked();
    setConfirming(false);
  }, [page, level]); // eslint-disable-line react-hooks/exhaustive-deps

  const item = scenes.find((s) => s.pageId === page) ?? null;
  const latestDecide = useRef<(accept: boolean) => Promise<void>>(async () => undefined);

  async function decide(accept: boolean) {
    if (!accessRequests || busy) return;
    if (accept && !fixed && !confirming) {
      setConfirming(true);
      return;
    }
    const target = page;
    const lvl = level;
    setBusy(true);
    setError(null);
    gate.clearBlocked();
    const scope = { pageIds: [target] };
    try {
      if (accept) {
        await markScenes(tree, engine, [target]);
        // Sin *Share anyway* (M4); *Retry* manda el formulario de ese momento.
        if (!(await gate.ready(scope, true, () => void latestDecide.current(true), null))) throw UNSYNCED_BEFORE_SHARE;
      }
      await accessRequests.decideScene(request.id, accept, projectId, accept ? target : null, lvl);
      if (accept) {
        gate.after(scope, true, request.email);
        void outsideReadersStore(services)?.invalidate(projectId);
      }
      onDone();
    } catch (err) {
      if (err === UNSYNCED_BEFORE_SHARE) return;
      const code = err instanceof Error ? err.message : String(err);
      setError(
        err === MARKS_PENDING
          ? tr('scenes.share.marksPending')
          : code === 'clean_off'
            ? tr('scenes.share.cleanOff')
            : code === 'page_invalid'
              ? tr('scenes.share.pageInvalid')
              : code === 'scene_contains_entities'
                ? tr('scenes.share.containsEntities')
                : code === 'invitation_exists'
                  ? tr('scenes.share.memberInvitation')
                  : teamErrorText(err),
      );
    } finally {
      setBusy(false);
    }
  }
  latestDecide.current = decide;

  const offline = !status.online;
  const canGive = !busy && !offline && status.cleanOn && !!item && !item.blocked;
  return (
    <div className="access-request-form scene-request-form" role="group" aria-label={tr('requests.title')}>
      <p>
        <strong>{requestText(request, tr, projectName)}</strong>
      </p>
      <p className="muted small">
        {tr(ROLE_LABELS[request.role])} · {agoText(request.askedAt, tr.lang)}
      </p>
      {!status.cleanOn && <p className="muted small">{tr('scenes.share.cleanOff')}</p>}
      {/* Lo que decía el link del proyecto (lo escribió quien pide: no dice nada que no sepa). */}
      {linkText !== null && (
        <p className="muted small scene-request-link">
          {byWord ? tr('requests.sceneByWord', { project: linkText }) : tr('requests.sceneLinkSaid', { project: linkText })}
        </p>
      )}
      {scenes.length === 0 ? (
        <p className="muted small">{tr('requests.sceneNoScenes')}</p>
      ) : (
        <>
          {!resolved && <p className="muted small">{tr('requests.sceneAsked', { scene: asked })}</p>}
          <div className="access-request-fields">
            <label>
              <span className="pref-label">{tr('requests.scene')}</span>
              <select value={page} disabled={busy || !!fixed} onChange={(e) => setPage(e.target.value)}>
                {!page && <option value="">{tr('requests.scenePick')}</option>}
                {scenes.filter((s) => !fixed || s.pageId === fixed).map((s) => (
                  <option key={s.pageId} value={s.pageId} disabled={s.blocked}>
                    {s.title ? `${sceneLabel(s.code)} · ${s.title}` : sceneLabel(s.code)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="pref-label">{tr('requests.level')}</span>
              <select value={level} disabled={busy} onChange={(e) => setLevel(e.target.value as SceneLevel)}>
                {(['view', 'comment'] as const).map((l) => (
                  <option key={l} value={l}>
                    {tr(LEVEL_LABELS[l])}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {item && (
            // Qué se da, antes de darlo (M6): el tipo de la página y cuántas lleva adentro.
            <p className="small scene-request-info" data-scene={item.pageId}>
              {tr('requests.sceneInfo', { count: item.inside })}
            </p>
          )}
          {item?.blocked && <p className="error small">{tr('scenes.share.blocked')}</p>}
          {confirming && item && (
            <p className="small scene-request-confirm" role="alert">
              {tr('requests.sceneConfirm', { asked, given: item.title ? `${sceneLabel(item.code)} · ${item.title}` : sceneLabel(item.code) })}
            </p>
          )}
        </>
      )}
      <p className="muted small">{tr('requests.sceneScope')}</p>
      <ShareGateNotes gate={gate} reader />
      {offline && <p className="muted small">{tr('requests.offline')}</p>}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          {tr('common.cancel')}
        </button>
        <button type="button" className="danger" disabled={busy || offline} onClick={() => void decide(false)}>
          {tr('requests.decline')}
        </button>
        <button type="button" className="primary" disabled={!canGive} onClick={() => void decide(true)}>
          {confirming ? tr('requests.giveConfirm') : tr('requests.give')}
        </button>
      </div>
    </div>
  );
}

/** La ventana de decidir, desde la campana. Esc o tocar afuera cierran sin decidir. */
export function AccessRequestDialog({ request, onClose }: { request: AccessRequest; onClose: () => void }) {
  const tr = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal team-dialog" role="dialog" aria-label={tr('requests.title')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('requests.title')}</h2>
        {request.scene ? (
          <SceneRequestForm request={request} onDone={onClose} onCancel={onClose} />
        ) : (
          <AccessRequestForm request={request} onDone={onClose} onCancel={onClose} />
        )}
      </div>
    </div>
  );
}
