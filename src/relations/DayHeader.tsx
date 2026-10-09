import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { language, useT, type Translate } from '../i18n';
import { navigate, pagePath } from '../router';
import { usePermissions, useServices, useTree } from '../services';
import { notify } from '../ui/notice';
import { dayShortLabel, headingStyleFor, linkTargetOf, sceneTitleOf, type DayLive, type DayPlan, type DayQuestion, type DayRow } from './dayLive';
import { goToPlace } from './goToPlace';
import { useLiveOpen } from './liveFold';
import { Badge, Chip, Ic, Line, LiveDot, useFoldFocus, useGo, type HeaderPhotos } from './LiveHeader';
import { PhotoSources } from './PhotoSources';
import { titleFragment, titleFragmentWhy } from './aliasAction';
import { withoutParens } from './aliases';
import { titlePlace } from './projectMap';
import { AssignButton, CreateEntityButton, ScenePicker } from './EntityActions';
import { LinkLocationButton } from './LinkLocation';
import type { DayRef, LiveSource } from './liveView';
import { addToPlan, adjustedPlan, movePlan, removeFromPlan, usePlanAdjust } from './tomorrowPlan';
import { wasRevivedHere } from './cededCopy';
import { createTomorrow, creatingKey, creatingSnapshot, isCreating, nextDayNumber, nextDayTitle, proposeTomorrow, subscribeCreating, twinsLeft, undoTomorrow, type TomorrowProposal } from './tomorrowNew';
import type { PreparedSection } from './prepareDay';

// La cabecera viva de un día de rodaje y su tarjeta *Tomorrow* (Docs/Doc_Relaciones.md, sección 11; maqueta S4 «D»,
// `c_dia.html`). Es interfaz, como la de escena y locación: no se guarda en la página ni sale impresa. Lo único que
// escribe en un documento es *Prepare tomorrow's report*, en el reporte de mañana, y solo agregando (`prepareDay.ts`,
// que se baja aparte con el editor).

/** «Thu 19 Feb 2026» / «jue 19 feb 2026», en el idioma de la app (D667: antes salía siempre en inglés). */
function longDate(date: string | null): string {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(language() === 'es' ? 'es-AR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(y, m - 1, d, 12))
      .replace(/[,.]/g, '');
  } catch {
    return date;
  }
}

/** El título entero de un día para el tooltip, solo si el rótulo corto no lo dice todo. */
function dayTitleTip(src: LiveSource, d: DayRef): string | undefined {
  const title = src.title(d.pageId) ?? '';
  const label = dayShortLabel(d);
  return title && !title.includes(label) ? title : undefined;
}

/** «20/02». */
const ddmm = (date: string | null) => (date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : '');
const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : text);

function SceneChip({ code, pageId, extra }: { code: string; pageId: string | null; extra?: string }) {
  if (!pageId) {
    return (
      <span className="lh-chip scene mono static out">
        <Ic name="scene" />
        <span className="lh-chip-t">{code}</span>
      </span>
    );
  }
  return (
    <Chip kind="scene" mono onClick={() => navigate(pagePath(pageId))}>
      {code}
      {extra && <span className="n"> {extra}</span>}
    </Chip>
  );
}

function LocChips({ day, src, tr }: { day: DayRef; src: LiveSource; tr: Translate }) {
  return (
    <>
      {day.locs.map((l) => {
        const pageId = src.snap.registry.locations.get(l)?.pageId ?? null;
        return (
          <Chip key={l} kind="loc" onClick={() => (pageId ? navigate(pagePath(pageId)) : undefined)} tip={tr('live.perDayTitle')}>
            {l}
          </Chip>
        );
      })}
    </>
  );
}

function StatusPill({ row, tr }: { row: Extract<DayRow, { kind: 'scene' }>; tr: Translate }) {
  if (row.status === 'prepared') {
    return (
      <span className="lh-st" data-tip={tr('day.preparedTip')}>
        {tr('day.prepared')}
      </span>
    );
  }
  if (row.status === 'notInPlan') {
    return (
      <span className="lh-st warn" data-tip={tr('day.notInPlanTip')}>
        {tr('day.notInPlan')}
      </span>
    );
  }
  return <span className="lh-st shot">{tr('day.shot')}</span>;
}

function Rows({ v, src, tr, partial }: { v: DayLive; src: LiveSource; tr: Translate; partial: boolean }) {
  const go = useGo();
  const perms = usePermissions();
  // *Create* y *Assign* (E7, D519, D521, D522): Assign escribe en este reporte (con permiso de editarlo); Create, con sus
  // guardas (un invitado ve el rótulo con el motivo).
  const canEdit = perms.canEditPage(v.day.pageId);
  const near = v.rows.flatMap((r) => (r.kind === 'scene' || r.kind === 'planned' ? [r.code] : []));
  if (!v.rows.length) {
    return <span className="lh-none">{v.complete ? tr(partial ? 'day.noSectionsSeen' : 'day.noSections') : tr('live.reading')}</span>;
  }
  return (
    <div className="lh-mrows">
      {v.rows.map((r, i) => {
        if (r.kind === 'scene') {
          return (
            <div className="lh-mrow" key={i}>
              <SceneChip code={r.code} pageId={r.scenePageId} extra={r.part || undefined} />
              <button className="tt" onClick={() => go(r.place)} data-tip={tr('live.goTip')}>
                {r.sceneTitle || r.heading}
                {r.photos > 0 && <span className="lh-via"> · {tr('live.photoCount', { count: r.photos })}</span>}
              </button>
              <span className="meta">
                <StatusPill row={r} tr={tr} />
              </span>
            </div>
          );
        }
        if (r.kind === 'planned') {
          return (
            <div className="lh-mrow" key={i}>
              <SceneChip code={r.code} pageId={r.scenePageId} />
              <span className="tt">{r.sceneTitle}</span>
              <span className="meta">
                <span className="lh-st plan" data-tip={tr('day.plannedNoSectionTip')}>
                  {tr('day.plannedNoSection')}
                </span>
              </span>
            </div>
          );
        }
        if (r.kind === 'pending') {
          return (
            <div className="lh-mrow" key={i}>
              <span className="lh-chip scene mono static out">
                <Ic name="scene" />
                <span className="lh-chip-t">{r.code}</span>
              </span>
              <button className="tt" onClick={() => go(r.place)}>
                «{r.heading}» <span className="lh-via">· {tr(partial ? 'day.notSeen' : 'day.doesntExist')}</span>
              </button>
              <span className="meta rel-acts">
                <CreateEntityButton want={{ kind: 'scene', code: r.code + r.part }} projectId={src.snap.projectId} className="lh-tbtn" />
                {canEdit && (
                  <AssignButton
                    src={src}
                    pageId={v.day.pageId}
                    target={{ kind: 'mention', blockId: r.place.blockId, pending: r.code, ep: src.snap.registration.roles.get(v.day.pageId)?.ep ?? null }}
                    near={near}
                    // Sin plan ni secciones de escena, primero las del episodio del número escrito (como el adelanto, D570).
                    ep={r.code.includes('_') ? r.code.slice(0, 3) : null}
                  />
                )}
              </span>
            </div>
          );
        }
        return (
          <div className="lh-mrow" key={i}>
            <span className="lh-st warn icon" data-tip={tr('live.noSceneNumberTip')}>
              <Ic name="warn" small />
            </span>
            <button className="tt" onClick={() => go(r.place)} data-tip={tr('day.unnumberedTip')}>
              «{r.heading}» <span className="lh-via">· {tr('day.noSceneNumber')} · {tr('live.photoCount', { count: r.photos })}</span>
            </button>
            <span className="meta rel-acts">
              {canEdit && <AssignButton src={src} pageId={v.day.pageId} target={{ kind: 'heading', blockId: r.place.blockId, text: r.heading }} near={near} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Questions({ list, scenePage, tr }: { list: DayQuestion[]; scenePage: (code: string) => string | null; tr: Translate }) {
  const go = useGo();
  const shown = list.slice(0, 3);
  return (
    <div className="lh-qs">
      {shown.map((q, i) => (
        <div className="lh-dq" key={i}>
          {q.codes.map((c) => (
            <SceneChip key={c} code={c} pageId={scenePage(c)} />
          ))}
          <button className="lh-q" onClick={() => go(q.place)} data-tip={tr('live.questionTip')}>
            <span className="lh-qt">{short(q.text, 110)}</span>{' '}
            {(q.shot || q.cat) && <span className="lh-via">· {[q.shot, q.cat].filter(Boolean).join(' · ')}</span>}
          </button>
        </div>
      ))}
      {list.length > shown.length && <span className="lh-via">{tr('day.moreQuestions', { count: list.length - shown.length })}</span>}
    </div>
  );
}

function PlanText({ plan, date, reading, partial, tr }: { plan: DayPlan; date: string | null; reading: boolean; partial: boolean; tr: Translate }) {
  if (plan.source === 'plan') {
    return (
      <span className="lh-via">
        {tr('day.fromPlan', { count: plan.codes.length })}{' '}
        {plan.pages.map((p, i) => (
          <span key={p.pageId}>
            {i > 0 && ', '}
            <button className="lh-sec" onClick={() => navigate(pagePath(p.pageId))}>
              «{p.title}»
            </button>
          </span>
        ))}
      </span>
    );
  }
  if (plan.source === 'breakdown') return <span className="lh-via">{tr('day.fromBreakdown', { count: plan.codes.length, label: plan.label, date: ddmm(date) })}</span>;
  if (!reading && plan.empty?.length) {
    return (
      <span className="lh-via">
        {tr('day.planNoScenes')}{' '}
        {plan.empty.map((p, i) => (
          <span key={p.pageId}>
            {i > 0 && ', '}
            <button className="lh-sec" onClick={() => navigate(pagePath(p.pageId))}>
              «{p.title}»
            </button>
          </span>
        ))}
      </span>
    );
  }
  return <span className="lh-none">{reading ? tr('live.reading') : tr(partial ? 'day.noPlanSeen' : 'day.noPlan')}</span>;
}

// --- La tarjeta «Tomorrow» -------------------------------------------------------------------------------------

function Tomorrow({ v, src, tr }: { v: DayLive; src: LiveSource; tr: Translate }) {
  const services = useServices();
  const perms = usePermissions();
  const t = v.tomorrow!;
  const adj = usePlanAdjust(t.day.pageId);
  const codes = adjustedPlan(t.plan.codes, adj);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  // Esperando una página que está llegando de otro dispositivo (D629): se dice en vez del texto de ayuda.
  const [waiting, setWaiting] = useState(false);
  const canEdit = perms.canEditPage(t.day.pageId);
  // Este dispositivo lo está creando desde la tarjeta del día sin día siguiente (la fila ya subió y el contenido se está
  // escribiendo): se dice y no se ofrece *Prepare* hasta que termine (D629).
  useSyncExternalStore(subscribeCreating, creatingSnapshot);
  const dayRow = services.tree.get(t.day.pageId);
  const creating = !!t.day.date && !!dayRow && isCreating(creatingKey(src.snap.projectId, dayRow.parent_id, t.day.date));
  const scenePage = (code: string) => {
    const id = src.snap.registry.scenes.get(code)?.pageId ?? null;
    return id && src.title(id) !== undefined ? id : null;
  };
  const titleOf = (code: string) => {
    const id = scenePage(code);
    return id ? sceneTitleOf(src.title(id)) : '';
  };
  // El título entero del día de mañana, solo si el rótulo lo acorta (B2 de la auditoría).
  const tomorrowTip = dayTitleTip(src, t.day);
  const source =
    t.plan.source === 'plan'
      ? tr('day.srcPlan')
      : t.plan.source === 'breakdown'
        ? tr('day.srcBreakdown', { label: t.plan.label, date: ddmm(t.day.date) })
        : tr('day.srcNone');

  const prepare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const scenes = codes.flatMap((code) => {
        const pageId = scenePage(code);
        return pageId ? [{ code, pageId }] : [];
      });
      // Las que no tienen una página que la persona ve no se pueden enlazar: se dicen en el aviso (O8 de la auditoría).
      const noPage = codes.filter((code) => !scenePage(code));
      const linkTarget = linkTargetOf(src);
      const style = headingStyleFor(src, v.day.pageId, tr.lang);
      const { prepareReport, undoPrepared } = await import('./prepareDay');
      // Con el árbol: un reporte recién creado en otro dispositivo cuyo contenido todavía no llegó no se prepara (D579).
      const deps = { docs: services.docs, engine: services.engine, tree: services.tree, onWait: () => setWaiting(true) };
      const res = await prepareReport(deps, t.day.pageId, { scenes, registry: src.snap.registry, linkTarget, word: style.word, level: style.level });
      setWaiting(false);
      if (res.status !== 'ok') {
        notify(tr(res.status === 'missing' ? 'day.prepareMissing' : res.status === 'busy' ? 'day.prepareBusy' : 'day.prepareUnknown', { day: dayShortLabel(t.day) }));
        return;
      }
      const parts = [res.added.length ? tr('day.added', { count: res.added.length }) : tr('day.nothingToAdd')];
      if (res.skipped.length) parts.push(tr('day.alreadyHad', { codes: res.skipped.join(', '), count: res.skipped.length }));
      if (noPage.length) parts.push(tr('day.noPage', { codes: noPage.join(', '), count: noPage.length }));
      if (res.merged) parts.push(tr('day.merged', { count: res.merged }));
      const added: PreparedSection[] = res.added;
      const prepared = { added, origin: res.origin };
      notify(
        `${dayShortLabel(t.day)} · ${parts.join(' · ')}`,
        added.length
          ? {
              label: tr('day.undo'),
              run: () => {
                void undoPrepared(deps, t.day.pageId, prepared, linkTarget).then((u) => {
                  if (!u) return;
                  // El reporte cambió de forma (un título movido adentro de otro bloque): no se sacó nada.
                  if (u.unexpected && !u.removed) {
                    notify(tr('day.undoUnexpected'));
                    return;
                  }
                  const text = !u.kept
                    ? tr('day.undone', { count: u.removed })
                    : u.removed
                      ? `${tr('day.undoneShort', { count: u.removed })} · ${tr('day.undoKept', { count: u.kept })}`
                      : tr('day.undoNothing', { count: u.kept });
                  // Ya había salido del dispositivo: quedan los renglones vacíos (D437).
                  notify(u.titleOnly && u.removed ? `${text} · ${tr('day.undoLinesStay')}` : text);
                });
              },
            }
          : undefined,
      );
      // Al reporte de mañana, con lo agregado resaltado (va al final de la página).
      if (added.length) goToPlace(services, { pageId: t.day.pageId, blockId: added[0].headingId, endBlockId: null });
    } catch (err) {
      console.warn('[relaciones] no se pudo preparar el reporte de mañana', err);
      notify(tr('day.prepareFailed'));
    } finally {
      setWaiting(false);
      setBusy(false);
    }
  };

  return (
    <div className="lh-tomorrow">
      <div className="th">
        <Ic name="day" small />
        <span>
          {tr.rich('day.tomorrow', { day: <b data-tip={tomorrowTip}>{dayShortLabel(t.day)}</b> })}
          {t.day.date && dayShortLabel(t.day) === t.day.label && <> · {longDate(t.day.date).split(' ').slice(0, 3).join(' ')}</>}
        </span>
        <LocChips day={t.day} src={src} tr={tr} />
      </div>
      <div className="lh-via sub">
        {tr('live.scenes', { count: codes.length })} · {source}
      </div>
      <div className="chips">
        {codes.map((code) => {
          const title = titleOf(code);
          const pageId = scenePage(code);
          return (
            <span key={code} className={`lh-chip scene tchip${pageId ? '' : ' out'}`}>
              <Ic name="scene" />
              <span className="lh-chip-t">
                <span className="k">{code}</span>
                {title && <span className="tl"> {short(title, 24)}</span>}
              </span>
              <button className="x" onClick={() => removeFromPlan(t.day.pageId, code)} aria-label={tr('day.removeScene', { code })}>
                <Ic name="x" small />
              </button>
            </span>
          );
        })}
        <span className="lh-addwrap">
          <button className="lh-tbtn add" onClick={() => setPicking(!picking)} aria-expanded={picking}>
            <Ic name="plus" small />
            {tr('day.addScene')}
          </button>
          {picking && (
            <ScenePicker
              src={src}
              have={codes}
              near={t.plan.codes}
              label={tr('day.addScene')}
              onClose={() => setPicking(false)}
              onPick={({ code }) => {
                addToPlan(t.day.pageId, code);
                setPicking(false);
              }}
            />
          )}
        </span>
      </div>
      {t.repeated.length > 0 && <div className="lh-via rep">{tr('day.repeated', { codes: t.repeated.join(', ') })}</div>}
      <div className="row2">
        {canEdit ? (
          <>
            <button className="primary lh-prepare" onClick={() => void prepare()} disabled={busy || creating || (!codes.length && !t.repeated.length)}>
              <Ic name="wand" small />
              {tr('day.prepare')}
            </button>
            {creating ? <span role="status">{tr('day.newCreating', { title: dayRow?.title ?? '' })}</span> : waiting ? <span role="status">{tr('day.prepareWaiting', { day: dayShortLabel(t.day) })}</span> : <span>{tr('day.prepareHint')}</span>}
          </>
        ) : (
          <span>{tr('day.cantEdit', { day: dayShortLabel(t.day) })}</span>
        )}
      </div>
    </div>
  );
}

// --- La tarjeta «Tomorrow» de un día sin día siguiente (D573–D577) --------------------------------------------------

function TomorrowNew({ v, src, tr, proposal }: { v: DayLive; src: LiveSource; tr: Translate; proposal: TomorrowProposal }) {
  const services = useServices();
  const perms = usePermissions();
  const tree = useTree();
  // Lo ajustado a mano antes de que exista el reporte: por el día de hoy y la fecha; al crearlo pasa al reporte nuevo.
  const key = `new:${v.day.pageId}:${proposal.date}`;
  const adj = usePlanAdjust(key);
  const codes = adjustedPlan(proposal.plan.codes, adj);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = tree.get(v.day.pageId);
  const projectId = src.snap.projectId;
  const parentId = today?.parent_id ?? null;
  const folder = parentId ? (tree.get(parentId)?.title ?? '') : tr('day.newRoot');
  const canCreate = () => perms.canCreateIn(parentId, projectId);
  const scenePage = (code: string) => {
    const id = src.snap.registry.scenes.get(code)?.pageId ?? null;
    return id && src.title(id) !== undefined ? id : null;
  };
  // El título que va a tener (sin número de día en el de hoy, el número lo decide al crear, como New day report: la fecha).
  const n = nextDayNumber(today?.title ?? '', 0);
  const title = n ? nextDayTitle(today?.title ?? '', proposal.date, n, tr.lang, proposal.place) : proposal.date;
  const source = proposal.plan.source === 'breakdown' ? tr('day.srcBreakdown', { label: proposal.plan.label, date: ddmm(proposal.date) }) : tr('day.srcNone');

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const scenes = codes.flatMap((code) => {
        const pageId = scenePage(code);
        return pageId ? [{ code, pageId }] : [];
      });
      const noPage = codes.filter((code) => !scenePage(code));
      const linkTarget = linkTargetOf(src);
      const style = headingStyleFor(src, v.day.pageId, tr.lang);
      const deps = { tree: services.tree, docs: services.docs, engine: services.engine };
      const res = await createTomorrow(
        deps,
        { projectId, parentId, todayTitle: today?.title ?? '', place: proposal.place, date: proposal.date, lang: tr.lang, prepare: { scenes, registry: src.snap.registry, linkTarget, word: style.word, level: style.level } },
        canCreate,
      );
      if (res.status === 'yielded') {
        // Otro dispositivo creó el mismo día a la vez: queda el suyo; la copia vacía de acá fue a la papelera (D580).
        notify(tr('day.newYielded', { title: res.title }));
        navigate(pagePath(res.pageId));
        return;
      }
      if (res.status === 'elsewhere') {
        // Otro dispositivo lo acaba de crear y lo prepara él: no se toca (D579). Se va a verlo.
        notify(tr('day.newElsewhere', { title: res.title }));
        navigate(pagePath(res.pageId));
        return;
      }
      if (res.status !== 'ok') return notify(res.status === 'offline' ? tr('day.newOffline') : tr('day.newCantCreate', { folder }));
      movePlan(key, res.pageId);
      const p = res.prepared;
      const parts = [tr(res.created ? 'day.newCreated' : 'day.newExisted', { title: res.title })];
      if (p.status === 'ok') {
        parts.push(p.added.length ? tr('day.added', { count: p.added.length }) : tr('day.nothingToAdd'));
        if (p.skipped.length) parts.push(tr('day.alreadyHad', { codes: p.skipped.join(', '), count: p.skipped.length }));
        if (p.merged) parts.push(tr('day.merged', { count: p.merged }));
      } else parts.push(tr(p.status === 'missing' ? 'day.prepareMissing' : p.status === 'busy' ? 'day.prepareBusy' : 'day.prepareUnknown', { day: res.title }));
      if (noPage.length) parts.push(tr('day.noPage', { codes: noPage.join(', '), count: noPage.length }));
      const canUndo = res.created || (p.status === 'ok' && p.added.length > 0);
      notify(
        parts.join(' · '),
        canUndo
          ? {
              label: tr('day.undo'),
              run: () => {
                void undoTomorrow(deps, res, parentId, linkTarget).then(
                  (u) => {
                    if (u.kind === 'trashed') notify(tr('create.undone', { title: res.title }));
                    else if (u.kind === 'offline') notify(tr('create.undoOffline', { title: res.title }));
                    else if (u.kind === 'changed') notify(tr(res.created && !res.joined ? 'create.undoChanged' : 'day.undoUnexpected', { title: res.title }));
                    else if (u.kind === 'prepared') notify(u.kept ? `${tr('day.undoneShort', { count: u.removed })} · ${tr('day.undoKept', { count: u.kept })}` : tr('day.undone', { count: u.removed }));
                  },
                  (err) => console.warn('[relaciones] no se pudo deshacer el reporte de mañana', err),
                );
              },
            }
          : undefined,
      );
      // Al reporte de mañana, con lo agregado resaltado (o al reporte, si no se agregó nada).
      if (p.status === 'ok' && p.added.length) goToPlace(services, { pageId: res.pageId, blockId: p.added[0].headingId, endBlockId: null });
      else navigate(pagePath(res.pageId));
      // Otro dispositivo creó el mismo día a la vez: el de id mayor cede solo en unos segundos. El aviso de «quedaron los
      // dos» sale solo si de verdad quedaron (D627; antes salía siempre).
      if (res.created && res.twins.length) {
        void twinsLeft(deps, res.pageId, res.twins).then(
          (left) => {
            // Si una de esas la sacó de la papelera este mismo dispositivo, ya avisó lo mismo (D633).
            if (left.length && !left.some(wasRevivedHere)) notify(tr('day.newTwins', { title: res.title }));
          },
          () => undefined,
        );
      }
    } catch (err) {
      console.warn('[relaciones] no se pudo crear el reporte de mañana', err);
      notify(tr('day.newFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lh-tomorrow new">
      <div className="th">
        <Ic name="day" small />
        <span>
          {tr.rich('day.newTitle', { date: <b>{longDate(proposal.date).split(' ').slice(0, 3).join(' ')}</b> })}
          <span className="lh-via"> · {tr('day.newNoReport')}</span>
        </span>
      </div>
      <div className="lh-via sub">
        {tr('live.scenes', { count: codes.length })} · {source}
      </div>
      <div className="chips">
        {codes.map((code) => {
          const pageId = scenePage(code);
          const t = pageId ? sceneTitleOf(src.title(pageId)) : '';
          return (
            <span key={code} className={`lh-chip scene tchip${pageId ? '' : ' out'}`}>
              <Ic name="scene" />
              <span className="lh-chip-t">
                <span className="k">{code}</span>
                {t && <span className="tl"> {short(t, 24)}</span>}
              </span>
              <button className="x" onClick={() => removeFromPlan(key, code)} aria-label={tr('day.removeScene', { code })}>
                <Ic name="x" small />
              </button>
            </span>
          );
        })}
        <span className="lh-addwrap">
          <button className="lh-tbtn add" onClick={() => setPicking(!picking)} aria-expanded={picking}>
            <Ic name="plus" small />
            {tr('day.addScene')}
          </button>
          {picking && (
            <ScenePicker
              src={src}
              have={codes}
              near={[...proposal.plan.codes, ...v.rows.flatMap((r) => (r.kind === 'scene' || r.kind === 'planned' ? [r.code] : []))]}
              label={tr('day.addScene')}
              onClose={() => setPicking(false)}
              onPick={({ code }) => {
                addToPlan(key, code);
                setPicking(false);
              }}
            />
          )}
        </span>
      </div>
      <div className="row2">
        {canCreate() ? (
          <>
            <button className="primary lh-prepare" onClick={() => void create()} disabled={busy}>
              <Ic name="wand" small />
              {tr('day.newCreate')}
            </button>
            {busy ? <span role="status">{tr('day.newCreating', { title })}</span> : <span>{tr('day.newHint', { title, folder })}</span>}
          </>
        ) : (
          <span>{tr('day.newCantCreate', { folder })}</span>
        )}
      </div>
    </div>
  );
}

// --- La cabecera del día ---------------------------------------------------------------------------------------

export function DayHeader({ v, src, pages, partial, photos }: { v: DayLive; src: LiveSource; pages: number; partial: boolean; photos: HeaderPhotos }) {
  const tr = useT();
  const [open, setOpenRaw] = useLiveOpen('day');
  const focus = useFoldFocus(open);
  const setOpen = (next: boolean) => {
    focus.mark();
    setOpenRaw(next);
  };
  const reading = !v.complete;
  // Sin día siguiente: la tarjeta que crea el reporte de mañana (D573). Solo con el índice completo (si no, mañana puede
  // existir y todavía no estar leído) y si quien mira ve el proyecto entero (si no, mañana puede estar donde no ve).
  const newTomorrow = !v.tomorrow && !v.next && v.complete && !partial ? proposeTomorrow(src, v.day) : null;
  const titleDay = { title: src.title(v.day.pageId) ?? '', label: v.day.label, date: v.day.date };
  const fragment = titleFragment(titleDay);
  // Si lo que dice el título no puede ser UN nombre (varios lugares, demasiado largo), no hay botón: se dice por qué (D711).
  const why = fragment ? null : titleFragmentWhy(titleDay);
  const scenePage = (code: string) => {
    const id = src.snap.registry.scenes.get(code)?.pageId ?? null;
    return id && src.title(id) !== undefined ? id : null;
  };

  if (!open) {
    // Mientras lee, solo lo que ya encontró: nada de ceros (D402).
    const parts: ReactNode[] = [
      v.day.locs.length ? v.day.locs.join(' + ') : null,
      !reading || v.scenes ? tr('live.scenes', { count: v.scenes }) : null,
      !reading || v.photos.length ? tr('live.photoCount', { count: v.photos.length }) : null,
      v.questions.length ? tr('day.openQuestions', { count: v.questions.length }) : null,
    ].filter(Boolean);
    return (
      <Line kind="day" onOpen={() => setOpen(true)} complete={v.complete} lineRef={focus.ref}>
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && ' · '}
            {p}
          </span>
        ))}
      </Line>
    );
  }

  // Rótulo corto («Día 58» o la fecha) y el título entero en el tooltip solo si se acortó (B2 y O10 de la auditoría).
  const nav = (d: DayRef | null, dir: -1 | 1) =>
    d ? (
      <button className="lh-tbtn nav" onClick={() => navigate(pagePath(d.pageId))} data-tip={dayTitleTip(src, d)} aria-label={src.title(d.pageId) || dayShortLabel(d)}>
        {dir < 0 && <Ic name="left" small />}
        <span className="lbl">{dayShortLabel(d)}</span>
        {dir > 0 && <Ic name="right" small />}
      </button>
    ) : null;

  return (
    <section className="lh lh-dayh" aria-label={tr('live.aria')}>
      <div className="lh-id">
        <Badge kind="day" />
        {/* Como la maqueta: la fecha en su renglón propio en el teléfono; la locación sigue al lado del tipo. */}
        <span className="lh-meta day">{v.day.date && longDate(v.day.date)}</span>
        <LocChips day={v.day} src={src} tr={tr} />
        {v.day.locs.length > 0 && <span className="lh-via">{tr('day.perTitle')}</span>}
        {/* Sin locación por el título: lo que dice el título, apagado, y escribirlo en una locación (D539). */}
        {v.day.locs.length === 0 && (fragment || why) && (
          <>
            <span className="lh-via" data-tip={tr(why === 'several' ? 'linkLoc.severalTip' : why === 'unusable' ? 'linkLoc.unusableTip' : 'linkLoc.unrecognizedTip')}>
              {fragment || withoutParens(titlePlace(titleDay))}
            </span>
            {fragment && <LinkLocationButton R={src.snap.registry} fragment={fragment} />}
          </>
        )}
        <span className="lh-tools">
          {nav(v.prev, -1)}
          {nav(v.next, 1)}
          <LiveDot complete={v.complete} />
          <button ref={focus.ref} className="lh-tbtn" aria-expanded={true} onClick={() => setOpen(false)} data-tip={tr('live.foldDayTip')}>
            <Ic name="up" small />
            {tr('live.collapse')}
          </button>
        </span>
      </div>
      <dl className="lh-facts">
        <dt>{tr('day.scenesOfDay')}</dt>
        <dd>
          <Rows v={v} src={src} tr={tr} partial={partial} />
        </dd>
        {v.questions.length > 0 && (
          <>
            <dt>{tr('day.openQuestionsLabel')}</dt>
            <dd>
              <Questions list={v.questions} scenePage={scenePage} tr={tr} />
            </dd>
          </>
        )}
        {v.named.length > 0 && (
          <>
            <dt>{tr('live.namedInText')}</dt>
            <dd className="chips">
              {v.named.map((m) => (
                <SceneChip key={m.code} code={m.code} pageId={m.scenePageId} />
              ))}
            </dd>
          </>
        )}
        <dt>{tr('live.plan')}</dt>
        <dd>
          <PlanText plan={v.plan} date={v.day.date} reading={reading} partial={partial} tr={tr} />
        </dd>
      </dl>
      {v.tomorrow && <Tomorrow v={v} src={src} tr={tr} />}
      {!v.tomorrow && newTomorrow && <TomorrowNew v={v} src={src} tr={tr} proposal={newTomorrow} />}
      <PhotoSources gallery={photos.gallery} complete={v.complete} unread={photos.unread} here={photos.here} tr={tr} />
      <div className="lh-foot">{tr('live.foot', { count: pages })}</div>
    </section>
  );
}
