import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { locale, useT, type Translate } from '../i18n';
import { useLinkMode } from '../linkMode';
import { navigate, pagePath } from '../router';
import { usePermissions, useServices, useTree } from '../services';
import { useCurrentProject } from '../ui/project';
import { existingRelationsSession } from '../ui/relationsUi';
import { goToPlace } from './goToPlace';
import { DayHeader } from './DayHeader';
import { dayLive } from './dayLive';
import { useLiveOpen, type FoldKind } from './liveFold';
import { locationLive, sceneLive, type DayRef, type Excerpt, type LiveSource, type LocationLive, type OpenQuestion, type PageChip, type PhotoRef, type Place, type SceneLive, type SetRef } from './liveView';
import { dayGallery, locationGallery, sceneGallery, type Gallery } from './photoGallery';
import { PhotoSources } from './PhotoSources';
import { leftOutBy } from './register';
import './liveHeader.css';

// La cabecera viva de una escena, una locación o un día de rodaje (Docs/Doc_Relaciones.md, secciones 10 y 11; diseño S4
// «D»): entre el título y
// el documento, fuera del editor. Es interfaz: no se guarda en la página, no sube a la base y no sale en el PDF. Se
// redibuja con cada foto nueva del índice de relaciones (al escribir acá o en otra página, al sincronizar). Con un link
// público no aparece (el visitante no tiene tipos de página, D381).

type Stage = 'breakdown' | 'scouting' | 'shoot';

export function LiveHeader({ pageId }: { pageId: string }) {
  const link = useLinkMode();
  const services = useServices();
  const session = link ? null : existingRelationsSession(services);
  if (!session) return null;
  return <LiveHeaderFor pageId={pageId} session={session} />;
}

function LiveHeaderFor({ pageId, session }: { pageId: string; session: NonNullable<ReturnType<typeof existingRelationsSession>> }) {
  const projectId = useCurrentProject();
  const tree = useTree();
  const perms = usePermissions();
  const revision = useSyncExternalStore(session.relations.subscribe, session.relations.getRevision);
  const snap = session.relations.snapshot(projectId);
  const role = snap?.registration.roles.get(pageId);
  const entity = role && !role.excluded ? role.entity : null;
  const kind = entity?.kind === 'scene' || entity?.kind === 'location' || entity?.kind === 'day' ? entity.kind : null;
  const ref = kind ? entity!.ref : null;

  // Una escena, locación o día fuera de las relaciones (D541): en lugar de la cabecera, un renglón que lo dice.
  const outKind = role?.excluded && role.entity && (role.entity.kind === 'scene' || role.entity.kind === 'location' || role.entity.kind === 'day');
  const out = outKind ? leftOutBy(tree, pageId) : null;

  const view = useMemo(() => {
    if (!snap || !kind || !ref) return null;
    const src: LiveSource = { snap, title: (id) => tree.get(id)?.title, content: (id) => session.index.content(id) };
    // Las fotos por fuente salen de lo mismo que la cabecera (E8).
    if (kind === 'day') {
      const data = dayLive(src, pageId);
      return { kind, data, src, gallery: dayGallery(src, data) } as const;
    }
    if (kind === 'scene') {
      const data = sceneLive(src, ref);
      return { kind, data, gallery: sceneGallery(src, data) } as const;
    }
    const data = locationLive(src, ref);
    return { kind, data, gallery: locationGallery(src, data) } as const;
    // La foto cambia con cada revisión; el árbol (títulos) también se lee de la foto de esa revisión.
  }, [snap, kind, ref, pageId, revision, tree, session]); // eslint-disable-line react-hooks/exhaustive-deps

  if (out && snap) return <LeftOutLine by={out.own ? null : out.pageId} />;
  if (!view || !snap) return null;
  // Quien no ve el proyecto entero (un invitado a una rama) no puede saber qué falta: las ausencias se dicen «you can
  // see» (D401).
  const partial = perms.known && perms.role !== 'owner' && perms.role !== 'admin' && perms.projectLevel(projectId) === 0;
  const photos = { gallery: view.gallery, unread: snap.unread, here: pageId };
  if (view.kind === 'day') return <DayHeader v={view.data} src={view.src} pages={snap.pages.size} partial={partial} photos={photos} />;
  return view.kind === 'scene' ? (
    <SceneHeader v={view.data} pages={snap.pages.size} partial={partial} photos={photos} />
  ) : (
    <LocationHeader v={view.data} pages={snap.pages.size} partial={partial} photos={photos} />
  );
}

/**
 * Una escena, locación o día que quedó fuera de las relaciones (`graph: false` en ella o en una carpeta de arriba, D541):
 * un renglón donde iba la cabecera, con la carpeta que la deja afuera (un toque lleva ahí, donde se deshace).
 */
function LeftOutLine({ by }: { by: string | null }) {
  const tr = useT();
  const tree = useTree();
  const title = by ? tree.get(by)?.title || tr('common.untitled') : '';
  return (
    <section className="lh closed lh-out" aria-label={tr('live.aria')}>
      <div className="lh-out-line" data-tip={tr(by ? 'live.leftOutByTip' : 'live.leftOutTip')}>
        <span className="lh-out-t">{tr('live.leftOut')}</span>
        {by && (
          <>
            {' · '}
            <button className="lh-out-by" onClick={() => navigate(pagePath(by))}>
              {tr('live.leftOutBy', { title })}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Los nombres escritos que no cuentan (D534): un renglón apagado por nombre, con un toque a la otra locación. Solo si hay.
 */
function AliasNotes({ notes, tr }: { notes: LocationLive['aliasNotes']; tr: Translate }) {
  if (!notes.length) return null;
  return (
    <div className="lh-anotes">
      {notes.map((n) => (
        <div key={`${n.kind}:${n.alias}`} className="lh-anote" data-tip={tr('live.aliasNoteTip')}>
          <Ic name="warn" small />
          <span>
            {n.kind === 'name' ? tr('live.aliasIsName', { alias: n.alias }) : tr('live.aliasShared', { alias: n.alias })}{' '}
            {n.others.map((o, i) => (
              <span key={o.name}>
                {i > 0 && ', '}
                {o.pageId ? (
                  <button className="lh-anote-go" onClick={() => navigate(pagePath(o.pageId!))}>
                    {o.name}
                  </button>
                ) : (
                  o.name
                )}
              </span>
            ))}
            {' — '}
            {tr(n.kind === 'name' ? 'live.aliasNotHere' : 'live.aliasNotEither')}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- Piezas -----------------------------------------------------------------------------------------------------

export const PATHS = {
  scene: 'M3 7h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l3-4h4l-3 4M10 7l3-4h4l-3 4',
  loc: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  day: 'M5.5 5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3.5 10h17M8 3v4M16 3v4',
  scout: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  page: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  card: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 9h10M7 13h6',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  go: 'M7 17 17 7M8 7h9v9',
  photo: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM9 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM21 16l-5-5-9 8',
  set: 'M4 21V4a1 1 0 0 1 1-1h10l4 4v14M2 21h20M14 12h.01',
  left: 'm15 6-6 6 6 6',
  right: 'm9 6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  wand: 'm15 4 5 5L9 20H4v-5zM13 6l5 5',
  warn: 'M21.7 18l-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3M12 9v4M12 17h.01',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14M12 17h.01',
} as const;

export function Ic({ name, small }: { name: keyof typeof PATHS; small?: boolean }) {
  return (
    <svg className={`lh-i${small ? ' s' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export const shortDate = (date: string | null): string => {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(locale() === 'es' ? 'es' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d, 12)).replace('.', '');
  } catch {
    return date;
  }
};

export function useGo() {
  const services = useServices();
  return (place: Place) => goToPlace(services, place);
}

/**
 * La miniatura de una foto: la misma dirección con que la muestra la página (`resolve`, con la marca de *play* en un
 * video). Se pide una vez por sesión (salvo si falló): la cola de archivos ya la guarda en el dispositivo.
 */
const thumbs = new Map<string, Promise<string | null>>();

export function Thumb({ id, className }: { id: string; className?: string }) {
  const { media } = useServices();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let p = thumbs.get(id);
    if (!p) thumbs.set(id, (p = media.resolve(`sdmedia://${id}`).catch(() => null)));
    void p.then((u) => {
      // Lo que no se pudo resolver (sin red) no queda guardado: se vuelve a pedir la próxima vez que se dibuje.
      if (!u && thumbs.get(id) === p) thumbs.delete(id);
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [id, media]);
  return url ? <img className={className} src={url} alt="" draggable={false} /> : <span className={`lh-ph ${className ?? ''}`} aria-hidden="true" />;
}

export function Thumbs({ photos, max = 3, onMore }: { photos: PhotoRef[]; max?: number; onMore: () => void }) {
  const go = useGo();
  if (!photos.length) return null;
  return (
    <span className="lh-thumbs">
      {photos.slice(0, max).map((p) => (
        <button key={p.id} className="lh-thumb" onClick={() => go(p.place)}>
          <Thumb id={p.id} />
        </button>
      ))}
      {photos.length > max && (
        <button className="lh-more" onClick={onMore}>
          +{photos.length - max}
        </button>
      )}
    </span>
  );
}

export function Chip({ kind, children, onClick, tip, mono }: { kind: 'scene' | 'loc' | 'day' | 'scout' | 'page'; children: ReactNode; onClick: () => void; tip?: string; mono?: boolean }) {
  return (
    <button className={`lh-chip ${kind === 'page' ? 'pg' : kind}${mono ? ' mono' : ''}`} onClick={onClick} data-tip={tip}>
      <Ic name={kind === 'page' ? 'page' : kind} />
      <span className="lh-chip-t">{children}</span>
    </button>
  );
}

/** Un decorado: lleva a su página si la persona la ve; si no (solo el texto del campo), no lleva a ningún lado. */
function SetChip({ set }: { set: SetRef }) {
  if (!set.pageId) {
    return (
      <span className="lh-chip set static">
        <Ic name="set" />
        <span className="lh-chip-t">{set.title}</span>
      </span>
    );
  }
  const id = set.pageId;
  return (
    <button className="lh-chip set" onClick={() => navigate(pagePath(id))}>
      <Ic name="set" />
      <span className="lh-chip-t">{set.title}</span>
    </button>
  );
}

const QUESTION_CHARS = 120;
const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : text);

/**
 * La pregunta abierta del desglose (la primera), como la maqueta: su primer renglón, de qué ficha es («· ERSO_105_027_010»
 * o «· in 2 cards») y cuántas más hay («· +1»). Lleva a la ficha, con la pregunta resaltada.
 */
function QuestionRow({ questions, tr }: { questions: OpenQuestion[]; tr: Translate }) {
  const go = useGo();
  const q = questions[0];
  const where = q.cards.length > 1 ? tr('live.inCards', { count: q.cards.length }) : q.cards.length ? q.cards[0].shot : tr('live.questionOnScene');
  return (
    <div className="lh-kv">
      <span>{tr('live.openQuestion')}</span>
      {/* Un solo botón (un párrafo): un botón dentro del renglón no deja que «· in 2 cards» siga en la misma línea. */}
      <button className="lh-q" onClick={() => go(q.place)} data-tip={tr(questions.length > 1 ? 'live.questionMoreTip' : 'live.questionTip')}>
        <span className="lh-qt">{short(q.text.split('\n')[0], QUESTION_CHARS)}</span>{' '}
        <span className="lh-via">
          · {where}
          {questions.length > 1 && <> · +{questions.length - 1}</>}
        </span>
      </button>
    </div>
  );
}

export function DayChip({ day }: { day: DayRef }) {
  const date = shortDate(day.date);
  return (
    <Chip kind="day" onClick={() => navigate(pagePath(day.pageId))}>
      {day.label}
      {date && <span className="n"> · {date}</span>}
    </Chip>
  );
}

export function LiveDot({ complete }: { complete: boolean }) {
  const tr = useT();
  return complete ? (
    <span className="lh-livedot" data-tip={tr('live.liveTip')}>
      <i />
      {tr('live.live')}
    </span>
  ) : (
    <span className="lh-livedot reading" data-tip={tr('live.readingTip')}>
      <i />
      {tr('live.reading')}
    </span>
  );
}

/**
 * Al plegar o desplegar, el botón que se tocó desaparece: el foco pasa al control nuevo (el renglón o *Collapse*), así
 * con el teclado no cae al principio de la página.
 */
export function useFoldFocus(open: boolean) {
  const target = useRef<HTMLButtonElement | null>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    target.current?.focus({ preventScroll: true });
  }, [open]);
  return { ref: target, mark: () => (moved.current = true) };
}

export function Tools({ kind, complete, onFold, foldRef }: { kind: FoldKind; complete: boolean; onFold: () => void; foldRef: RefObject<HTMLButtonElement | null> }) {
  const tr = useT();
  return (
    <span className="lh-tools">
      <LiveDot complete={complete} />
      <button ref={foldRef} className="lh-tbtn" aria-expanded={true} onClick={onFold} data-tip={tr(kind === 'scene' ? 'live.foldSceneTip' : kind === 'day' ? 'live.foldDayTip' : 'live.foldLocationTip')}>
        <Ic name="up" small />
        {tr('live.collapse')}
      </button>
    </span>
  );
}

export function Badge({ kind }: { kind: FoldKind }) {
  const tr = useT();
  return (
    <span className={`lh-badge ${kind === 'scene' ? 'scene' : kind === 'day' ? 'day' : 'loc'}`} data-tip={tr(kind === 'scene' ? 'live.sceneTip' : kind === 'day' ? 'live.dayTip' : 'live.locationTip')}>
      <Ic name={kind === 'scene' ? 'scene' : kind === 'day' ? 'day' : 'loc'} small />
      {tr(kind === 'scene' ? 'live.scene' : kind === 'day' ? 'live.day' : 'live.location')}
    </span>
  );
}

/**
 * Plegada: un solo renglón. Sin `aria-label`: un lector de pantalla lee el resumen y que se puede desplegar. Mientras el
 * índice lee, el punto «Reading…» también acá (el teléfono arranca plegado).
 */
export function Line({ kind, children, onOpen, complete, lineRef }: { kind: FoldKind; children: ReactNode; onOpen: () => void; complete: boolean; lineRef: RefObject<HTMLButtonElement | null> }) {
  const tr = useT();
  return (
    <section className="lh closed" aria-label={tr('live.aria')}>
      <button ref={lineRef} className="lh-line" onClick={onOpen} aria-expanded={false}>
        <Badge kind={kind} />
        <span className="lh-ll">{children}</span>
        {!complete && <LiveDot complete={false} />}
        <span className="lh-exp">
          <Ic name="down" small />
        </span>
      </button>
    </section>
  );
}

function Stages({ defs, open, onToggle }: { defs: { key: Stage; name: string; has: boolean; sum: string }[]; open: Stage | null; onToggle: (k: Stage) => void }) {
  return (
    <div className="lh-stages">
      {defs.map((d) => (
        <button key={d.key} className={`lh-stage${d.has ? ' has' : ' none'}${open === d.key ? ' on' : ''}`} aria-expanded={open === d.key} onClick={() => onToggle(d.key)}>
          <span className="sn">
            <span className="dot" />
            {d.name}
          </span>
          <span className="sv">{d.sum}</span>
          <span className="chev">
            <Ic name={open === d.key ? 'up' : 'down'} small />
          </span>
        </button>
      ))}
    </div>
  );
}

function ExcerptCard({ ex, tag, tr, code }: { ex: Excerpt; tag: string; tr: Translate; code?: string }) {
  const go = useGo();
  const title = ex.heading || ex.pageTitle;
  // Una ficha: el origen dice de qué escena es y el título va una sola vez (como la maqueta).
  const from = ex.kind === 'card' && code ? tr('live.fromBreakdown', { code }) : ex.day ? ex.day.label : ex.pageTitle;
  return (
    <button className={`lh-ex${ex.question ? ' has-q' : ''}`} onClick={() => go(ex.place)} data-tip={tr('live.goTip')}>
      <span className="src">
        <span className={`tag ${tag}`}>{ex.kind === 'card' ? tr('live.breakdown') : tag === 'scout' ? tr('live.scouting') : tag === 'shoot' ? tr('live.shoot') : tag === 'plan' ? tr('live.plan') : tr('live.breakdown')}</span>
        <span>{from}</span>
        {ex.day && ex.day.locs.length > 0 && <span>· {ex.day.locs.join(' + ')}</span>}
        {ex.day?.date && <span>· {shortDate(ex.day.date)}</span>}
        {ex.kind === 'mention' && <span>· {tr('live.namedInText')}</span>}
      </span>
      <span className="tt">
        <span className="tt-t">{title}</span>
        {ex.part && <span className="lh-st">{tr('live.part', { part: ex.part })}</span>}
        {ex.shared.length > 0 && <span className="lh-st">+ {ex.shared.join(', ')}</span>}
        <span className="go">
          <Ic name="go" small />
        </span>
      </span>
      {ex.text && <span className="tx">{ex.text}</span>}
      {ex.question && (
        <span className="qq">
          <b>{tr('live.openQuestionLine')}</b> {ex.question}
        </span>
      )}
      {ex.photos.length > 0 && (
        <span className="lh-thumbs ex-thumbs">
          {ex.photos.slice(0, 3).map((p) => (
            <Thumb key={p.id} id={p.id} />
          ))}
          {ex.photos.length > 3 && <span className="lh-more">+{ex.photos.length - 3}</span>}
        </span>
      )}
    </button>
  );
}

export function Panel({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="lh-panel">
      <div className="lh-panel-h">{head}</div>
      {children}
    </div>
  );
}

export function Empty({ icon, children }: { icon: keyof typeof PATHS; children: ReactNode }) {
  return (
    <div className="lh-empty">
      <Ic name={icon} />
      <span>{children}</span>
    </div>
  );
}

/** Las fotos por fuente de una cabecera (`PhotoSources`) y cuántas páginas faltan leer. */
export interface HeaderPhotos {
  gallery: Gallery;
  unread: number;
  /** La página de la cabecera (sus fuentes no repiten su título en el tooltip). */
  here: string;
}

function AlsoRow({ also, index, tr }: { also: PageChip[]; index: PageChip[]; tr: Translate }) {
  const go = useGo();
  const [openIndex, setOpenIndex] = useState(false);
  if (!also.length && !index.length) return null;
  const chip = (c: PageChip) => (
    <Chip key={c.pageId} kind="page" onClick={() => (c.blockId ? go({ pageId: c.pageId, blockId: c.blockId }) : navigate(pagePath(c.pageId)))}>
      {c.title || tr('common.untitled')}
    </Chip>
  );
  return (
    <div className="lh-also">
      <span>{tr('live.alsoIn')}</span>
      {also.map(chip)}
      {index.length > 0 && (
        <button className="lh-tbtn lh-index" aria-expanded={openIndex} onClick={() => setOpenIndex(!openIndex)} data-tip={tr('live.indexPagesTip')}>
          {tr('live.indexPages', { count: index.length })}
          <Ic name={openIndex ? 'up' : 'down'} small />
        </button>
      )}
      {openIndex && index.map(chip)}
    </div>
  );
}

// --- Escena -----------------------------------------------------------------------------------------------------

function SceneHeader({ v, pages, partial, photos }: { v: SceneLive; pages: number; partial: boolean; photos: HeaderPhotos }) {
  const tr = useT();
  const go = useGo();
  const [open, setOpenRaw] = useLiveOpen('scene');
  const focus = useFoldFocus(open);
  const setOpen = (next: boolean) => {
    focus.mark();
    setOpenRaw(next);
  };
  const [stage, setStage] = useState<Stage | null>(null);
  const reading = !v.complete;
  const absent = (text: string) => (reading ? tr('live.reading') : text);
  const shotDays = v.days.filter((d) => d.sections.length);
  const shotLocs = [...new Set(shotDays.flatMap((d) => d.day.locs))];
  const sections = shotDays.reduce((n, d) => n + d.sections.length, 0);

  const noReportText = partial ? tr('live.noReportSeen') : tr('live.noReport');
  if (!open) {
    // Mientras lee, solo lo que ya encontró (nada de ceros ni de ausencias): el punto «Reading…» dice el resto.
    const count = (n: number, text: string) => (reading && n === 0 ? null : text);
    const parts = [
      shotLocs.length ? tr.rich('live.shotAt', { locs: <b>{shotLocs.join(', ')}</b> }) : shotDays.length ? tr('live.days', { count: shotDays.length }) : reading ? null : noReportText,
      shotLocs.length ? tr('live.days', { count: shotDays.length }) : null,
      count(v.cards.length, tr('live.cards', { count: v.cards.length })),
      count(v.photos.length, tr('live.photoCount', { count: v.photos.length })),
    ].filter(Boolean);
    return (
      <Line kind="scene" onOpen={() => setOpen(true)} complete={v.complete} lineRef={focus.ref}>
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && ' · '}
            {p}
          </span>
        ))}
      </Line>
    );
  }

  const noReport = (
    <span className="lh-noreport">
      <span className="lh-none" data-tip={reading ? undefined : tr(partial ? 'live.noReportSeenTip' : 'live.noReportTip')}>
        {absent(noReportText)}
      </span>
      {v.noVfx ? (
        <span className="lh-st" data-tip={tr('live.noVfxTip')}>
          {tr('live.noVfx')}
        </span>
      ) : (
        v.noVfxCards.no > 0 && (
          <span className="lh-st" data-tip={tr('live.noVfxSomeTip')}>
            {tr('live.noVfxSome', { count: v.noVfxCards.no, of: v.noVfxCards.of })}
          </span>
        )
      )}
    </span>
  );
  const scoutSum = v.scoutPages.length
    ? tr('live.sectionsNameIt', { count: Math.max(v.scouting.length, 1) })
    : v.scoutsVia.length
      ? tr('live.via', { locs: [...new Set(v.scoutsVia.map((s) => s.loc))].join(', ') })
      : absent(tr('live.none'));
  const shootSum = shotDays.length
    ? `${tr('live.days', { count: shotDays.length })} · ${tr('live.sections', { count: sections })}`
    : v.shoot.length
      ? tr('live.mentions', { count: v.shoot.length })
      : absent(tr('live.noReport'));
  const bdExtra = v.breakdown.filter((e) => e.kind !== 'card').length;
  const defs = [
    {
      key: 'breakdown' as const,
      name: tr('live.breakdown'),
      has: v.breakdown.length > 0,
      sum:
        (v.cards.length ? tr('live.cards', { count: v.cards.length }) + (bdExtra ? ` · ${tr('live.mentions', { count: bdExtra })}` : '') : bdExtra ? tr('live.mentions', { count: bdExtra }) : absent(tr('live.noCards'))) +
        (v.questions.length ? ` · ${tr('live.questions', { count: v.questions.length })}` : ''),
    },
    { key: 'scouting' as const, name: tr('live.scouting'), has: v.scouting.length > 0, sum: scoutSum },
    { key: 'shoot' as const, name: tr('live.shoot'), has: v.shoot.length > 0 || v.plannedDays.length > 0, sum: shootSum },
  ];

  let panel: ReactNode = null;
  if (stage === 'breakdown') {
    panel = (
      <Panel head={<><b>{tr('live.breakdown')}</b> · {tr('live.panel.breakdown')}</>}>
        {v.breakdown.length ? v.breakdown.map((ex, i) => <ExcerptCard key={i} ex={ex} tag="bd" tr={tr} code={v.code} />) : <Empty icon="card">{absent(tr('live.empty.breakdown'))}</Empty>}
      </Panel>
    );
  } else if (stage === 'scouting') {
    panel = (
      <Panel head={<><b>{tr('live.scouting')}</b> · {v.scouting.length || !v.scoutsVia.length ? tr('live.panel.scouting') : tr('live.panel.scoutsVia')}</>}>
        {v.scouting.length ? (
          v.scouting.map((ex, i) => <ExcerptCard key={i} ex={ex} tag="scout" tr={tr} />)
        ) : v.scoutsVia.length ? (
          v.scoutsVia.map((s) => (
            <button key={s.pageId} className="lh-ex" onClick={() => navigate(pagePath(s.pageId))}>
              <span className="src">
                <span className="tag scout">{tr('live.scouting')}</span>
                <span>{tr('live.ofLoc', { loc: s.loc })}</span>
              </span>
              <span className="tt">
                <span className="tt-t">{s.title}</span>
                <span className="go">
                  <Ic name="go" small />
                </span>
              </span>
            </button>
          ))
        ) : (
          <Empty icon="scout">{absent(tr('live.empty.scouting'))}</Empty>
        )}
      </Panel>
    );
  } else if (stage === 'shoot') {
    panel = (
      <Panel head={<><b>{tr('live.shoot')}</b> · {tr('live.panel.shoot')}</>}>
        {v.shoot.length || v.plannedDays.length ? (
          <>
            {v.shoot.map((ex, i) => <ExcerptCard key={i} ex={ex} tag="shoot" tr={tr} />)}
            {v.plannedDays.flatMap((d) => d.items).map((ex, i) => <ExcerptCard key={`p${i}`} ex={ex} tag="plan" tr={tr} />)}
          </>
        ) : (
          <Empty icon="day">
            {absent(tr(partial ? 'live.empty.shootSeen' : 'live.empty.shoot'))}
            {!reading && v.noVfx && <> · {tr('live.noVfxTip')}</>}
          </Empty>
        )}
      </Panel>
    );
  }

  return (
    <section className="lh" aria-label={tr('live.aria')}>
      <div className="lh-id">
        <Badge kind="scene" />
        <span className="lh-meta">
          {v.intExt.length > 0 && (
            <>
              <span data-tip={tr('live.intExtTip')}>{v.intExt.slice(0, 3).join(', ')}</span>
              {(v.episode || v.aliases.length > 0) && ' · '}
            </>
          )}
          {v.episode && tr('live.episode', { ep: v.episode })}
          {v.aliases.length > 0 && (
            <>
              {v.episode && ' · '}
              {tr('live.alsoWritten')} <span className="mono">{v.aliases.join(' · ')}</span>
            </>
          )}
        </span>
        <Tools kind="scene" complete={v.complete} onFold={() => setOpen(false)} foldRef={focus.ref} />
      </div>
      <div className="lh-sum2">
        <div className="lh-col">
          <div className="lh-col-h">{tr('live.preproduction')}</div>
          <div className="lh-kv">
            <span>{tr('live.plannedAt')}</span>
            <div>
              {v.plannedAt.length ? (
                <>
                  {v.plannedAt.map((l) => (
                    <Chip key={l.title} kind="loc" onClick={() => (l.pageId ? navigate(pagePath(l.pageId)) : undefined)}>
                      {l.title}
                    </Chip>
                  ))}
                  <span className="lh-via">{tr('live.plannedVia')}</span>
                </>
              ) : (
                <span className="lh-none">{absent('—')}</span>
              )}
            </div>
          </div>
          <div className="lh-kv">
            <span>{tr('live.breakdown')}</span>
            <div>
              {v.cards.length ? (
                <button className="lh-lnk" onClick={() => setStage('breakdown')}>
                  {tr('live.cards', { count: v.cards.length })}
                </button>
              ) : (
                <span className="lh-none">{absent(tr('live.noCards'))}</span>
              )}
              {v.sets.length > 0 && (
                <>
                  <span className="lh-sep">·</span>
                  {v.sets.map((s) => (
                    <SetChip key={s.pageId ?? s.title} set={s} />
                  ))}
                </>
              )}
            </div>
          </div>
          {v.questions.length > 0 && <QuestionRow questions={v.questions} tr={tr} />}
          <div className="lh-kv">
            <span>{tr('live.scouting')}</span>
            <div>
              {v.scoutPages.length ? (
                v.scoutPages.map((s) => (
                  <Chip key={s.pageId} kind="scout" onClick={() => (s.blockId ? go({ pageId: s.pageId, blockId: s.blockId }) : navigate(pagePath(s.pageId)))}>
                    {s.title} <span className="n">· {tr('live.namesIt')}</span>
                  </Chip>
                ))
              ) : v.scoutsVia.length ? (
                v.scoutsVia.map((s) => (
                  <Chip key={s.pageId} kind="scout" onClick={() => navigate(pagePath(s.pageId))}>
                    {s.title} <span className="n">· {tr('live.ofLoc', { loc: s.loc })}</span>
                  </Chip>
                ))
              ) : (
                <span className="lh-none">{absent(tr('live.none'))}</span>
              )}
            </div>
          </div>
        </div>
        <div className="lh-col">
          <div className="lh-col-h">{tr('live.shoot')}</div>
          {shotDays.length
            ? shotDays.map((d) => (
                <div className="lh-dayline" key={d.day.pageId}>
                  <span className="dl-main">
                    <DayChip day={d.day} />
                    {d.day.locs.length > 0 && (
                      <span className="lh-via" data-tip={tr('live.perDayTitle')}>
                        {d.day.locs.join(' + ')}
                      </span>
                    )}
                    {d.sections.map((s) => (
                      <button key={s.place.blockId} className="lh-sec" onClick={() => go(s.place)} data-tip={tr('live.goTip')}>
                        § {s.heading}
                      </button>
                    ))}
                  </span>
                  <Thumbs photos={d.photos} onMore={() => go(d.sections[0].place)} />
                </div>
              ))
            : !v.days.length && !v.plannedDays.length && <div className="lh-dayline">{noReport}</div>}
          {v.days
            .filter((d) => d.mentions.length)
            .map((d) => (
              <div className="lh-dayline" key={`m-${d.day.pageId}`}>
                <span className="dl-main">
                  <DayChip day={d.day} />
                  <button className="lh-sec" onClick={() => go(d.mentions[0].place)}>
                    {tr('live.namedInText')}
                  </button>
                </span>
              </div>
            ))}
          {v.plannedDays.map((d) => (
            <div className="lh-dayline" key={`p-${d.day.pageId}`}>
              <span className="dl-main">
                <DayChip day={d.day} />
                <button className="lh-sec plan" onClick={() => go(d.items[0].place)} data-tip={tr('live.plannedForTip')}>
                  {tr('live.plannedFor', { page: d.items[0].pageTitle })}
                </button>
              </span>
            </div>
          ))}
          {!shotDays.length && (v.days.length > 0 || v.plannedDays.length > 0) && <div className="lh-dayline">{noReport}</div>}
        </div>
      </div>
      <AlsoRow also={v.also} index={v.indexPages} tr={tr} />
      <Stages defs={defs} open={stage} onToggle={(k) => setStage(stage === k ? null : k)} />
      {panel}
      <PhotoSources gallery={photos.gallery} complete={v.complete} unread={photos.unread} here={photos.here} tr={tr} />
      <div className="lh-foot">{tr('live.foot', { count: pages })}</div>
    </section>
  );
}

// --- Locación ---------------------------------------------------------------------------------------------------

function LocationHeader({ v, pages, partial, photos }: { v: LocationLive; pages: number; partial: boolean; photos: HeaderPhotos }) {
  const tr = useT();
  const go = useGo();
  const [open, setOpenRaw] = useLiveOpen('location');
  const focus = useFoldFocus(open);
  const setOpen = (next: boolean) => {
    focus.mark();
    setOpenRaw(next);
  };
  const [stage, setStage] = useState<Stage | null>(null);
  const reading = !v.complete;
  const absent = (text: string) => (reading ? tr('live.reading') : text);
  const shotScenes = new Set(v.days.flatMap((d) => d.scenes.map((s) => s.code)));
  const sceneChip = (code: string, pageId: string | null) => (
    <Chip key={code} kind="scene" mono onClick={() => (pageId ? navigate(pagePath(pageId)) : undefined)}>
      {code}
    </Chip>
  );

  if (!open) {
    return (
      <Line kind="location" onOpen={() => setOpen(true)} complete={v.complete} lineRef={focus.ref}>
        {[
          [v.days.length, tr('live.shootDays', { count: v.days.length })],
          [shotScenes.size, tr('live.withReport', { count: shotScenes.size })],
          [v.planned.length, tr('live.plannedCount', { count: v.planned.length })],
          [v.scouts.length, tr('live.scoutings', { count: v.scouts.length })],
        ]
          // Mientras lee, solo lo que ya encontró: nada de ceros (B2 de la auditoría).
          .filter(([n]) => !reading || (n as number) > 0)
          .map(([, text]) => text)
          .join(' · ')}
      </Line>
    );
  }

  const defs = [
    { key: 'breakdown' as const, name: tr('live.breakdown'), has: v.planned.length > 0, sum: v.planned.length ? tr('live.scenesPlanned', { count: v.planned.length }) : absent(tr('live.none')) },
    { key: 'scouting' as const, name: tr('live.scouting'), has: v.scouts.length > 0, sum: v.scouts.length ? v.scouts.map((s) => s.title).join(' · ') : absent(tr('live.none')) },
    { key: 'shoot' as const, name: tr('live.shoot'), has: v.days.length > 0, sum: v.days.length ? `${tr('live.days', { count: v.days.length })} · ${tr('live.scenes', { count: shotScenes.size })}` : absent(tr('live.none')) },
  ];

  let panel: ReactNode = null;
  if (stage === 'breakdown') {
    panel = (
      <Panel head={<><b>{tr('live.breakdown')}</b> · {tr('live.panel.locBreakdown')}</>}>
        {v.planned.length ? (
          <div className="lh-rows">
            {v.planned.map((s) => (
              <button key={s.code} className="lh-row" onClick={() => (s.pageId ? navigate(pagePath(s.pageId)) : undefined)}>
                <span className="lh-chip scene mono static">
                  <Ic name="scene" />
                  <span className="lh-chip-t">{s.code}</span>
                </span>
                <span className="tt">{s.title}</span>
                <span className={`lh-st${s.days.length ? ' shot' : ''}`}>{s.days.length ? tr('live.reportOn', { days: s.days.map((d) => d.label).join(', ') }) : absent(tr('live.noReport'))}</span>
              </button>
            ))}
          </div>
        ) : (
          <Empty icon="card">{absent(tr('live.empty.locBreakdown'))}</Empty>
        )}
      </Panel>
    );
  } else if (stage === 'scouting') {
    panel = (
      <Panel head={<><b>{tr('live.scouting')}</b> · {tr('live.panel.locScouting')}</>}>
        {v.scouting.length ? v.scouting.map((ex, i) => <ExcerptCard key={i} ex={ex} tag="scout" tr={tr} />) : <Empty icon="scout">{absent(tr('live.empty.locScouting'))}</Empty>}
      </Panel>
    );
  } else if (stage === 'shoot') {
    const items = v.days.flatMap((d) => d.sections);
    panel = (
      <Panel head={<><b>{tr('live.shoot')}</b> · {tr('live.panel.locShoot')}</>}>
        {items.length ? items.map((ex, i) => <ExcerptCard key={i} ex={ex} tag="shoot" tr={tr} />) : <Empty icon="day">{absent(tr('live.empty.locShoot'))}</Empty>}
      </Panel>
    );
  }

  return (
    <section className="lh" aria-label={tr('live.aria')}>
      <div className="lh-id">
        <Badge kind="location" />
        <span className="lh-meta">
          {v.aliases.length > 0 && (
            <>
              {tr('live.alsoWritten')} {v.aliases.join(' · ')}
            </>
          )}
        </span>
        <Tools kind="location" complete={v.complete} onFold={() => setOpen(false)} foldRef={focus.ref} />
      </div>
      <AliasNotes notes={v.aliasNotes} tr={tr} />
      <div className="lh-sum2">
        <div className="lh-col">
          <div className="lh-col-h">{tr('live.preproduction')}</div>
          <div className="lh-kv">
            <span>{tr('live.plannedHere')}</span>
            <div>
              {v.planned.length ? (
                <>
                  {v.planned.map((s) => sceneChip(s.code, s.pageId))}
                  <span className="lh-via">{tr('live.plannedHereVia')}</span>
                </>
              ) : (
                <span className="lh-none">{absent('—')}</span>
              )}
            </div>
          </div>
          {v.sets.length > 0 && (
            <div className="lh-kv">
              <span>{tr('live.sets')}</span>
              <div>
                {v.sets.map((s) => (
                  <SetChip key={s.pageId ?? s.title} set={s} />
                ))}
              </div>
            </div>
          )}
          <div className="lh-kv">
            <span>{tr('live.scouting')}</span>
            <div>
              {v.scouts.length ? (
                v.scouts.map((s) => (
                  <Chip key={s.pageId} kind="scout" onClick={() => navigate(pagePath(s.pageId))}>
                    {s.title} <span className="n">· {tr('live.photoCount', { count: s.photos })}</span>
                  </Chip>
                ))
              ) : (
                <span className="lh-none">{absent(tr('live.none'))}</span>
              )}
            </div>
          </div>
          {v.where && (
            <div className="lh-kv">
              <span>{tr('live.where')}</span>
              <div>
                <button className="lh-where mono" onClick={() => go(v.where!.place)} data-tip={tr('live.whereTip', { page: v.where.pageTitle })}>
                  {v.where.text}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="lh-col">
          <div className="lh-col-h">{tr('live.shoot')}</div>
          {v.days.length ? (
            v.days.map((d) => (
              <div className="lh-dayline" key={d.day.pageId}>
                <span className="dl-main">
                  <DayChip day={d.day} />
                  {d.scenes.map((s) => sceneChip(s.code, s.pageId))}
                  {d.unresolved.map((u) => (
                    <button key={u.place.blockId} className="lh-sec warn" onClick={() => go(u.place)} data-tip={tr('live.noSceneNumberTip')}>
                      § {u.heading}
                    </button>
                  ))}
                </span>
                <Thumbs photos={d.photos} onMore={() => navigate(pagePath(d.day.pageId))} />
              </div>
            ))
          ) : (
            <div className="lh-dayline">
              <span className="lh-none">{absent(tr('live.noShootDays'))}</span>
            </div>
          )}
          {v.noReport.length > 0 && !reading && <div className="lh-via lh-noreport-yet">{tr(partial ? 'live.noReportYetSeen' : 'live.noReportYet', { codes: v.noReport.join(', ') })}</div>}
        </div>
      </div>
      <AlsoRow also={v.also} index={v.indexPages} tr={tr} />
      <Stages defs={defs} open={stage} onToggle={(k) => setStage(stage === k ? null : k)} />
      {panel}
      <PhotoSources gallery={photos.gallery} complete={v.complete} unread={photos.unread} here={photos.here} tr={tr} />
      <div className="lh-foot">{tr('live.foot', { count: pages })}</div>
    </section>
  );
}
