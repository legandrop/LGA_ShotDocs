import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@tiptap/pm/view';
import { t as tTr, useT } from '../i18n';
import { navigate, pagePath } from '../router';
import { usePermissions, useServices, useTree } from '../services';
import { isPhoneLayout } from '../ui/commentsUi';
import { existingRelationsSession } from '../ui/relationsUi';
import { keyLabel, shortcut } from '../ui/shortcuts';
import { touchDevice } from '../ui/camera';
import { sceneTitleOf } from './dayLive';
import { Chip, DayChip, Ic, Thumb } from './LiveHeader';
import { locationLive, sceneLive, type LiveSource, type PhotoRef } from './liveView';
import { anchorOf, locateUnderline, makeLinkAt, type UnderlineAnchor } from './relLink';
import { CreateEntityButton, ScenePicker } from './EntityActions';
import { notify } from '../ui/notice';
import type { PeekEvents, PeekTarget } from './relUnderline';

// El adelanto de un subrayado o de una ficha del editor (Docs/Doc_Relaciones.md, sección 14; maqueta `c_dia.html`): una
// tarjeta chica con lo esencial de la escena o la locación (de la cabecera viva: dónde y cuándo se filmó, su desglose,
// unas fotos), *Open* y *Make it a link*. Con el mouse se abre al quedarse un momento encima; en una pantalla táctil, al
// tocar con el teclado cerrado o al mantener apretado (con el teclado abierto, tocar solo pone el cursor: C7, B3). Se
// cierra con Esc, al escribir, al tocar afuera o al desplazar. Nunca tapa la barra *Today* del teléfono. Es interfaz: no
// toca el documento salvo *Make it a link*.

/** La demora antes de abrirlo con el mouse, y antes de cerrarlo al salir (para llegar a la tarjeta). */
const HOVER_OPEN_MS = 320;
const HOVER_CLOSE_MS = 260;
const CARD_W = 360;

interface Open {
  target: PeekTarget;
  /** Dónde está el subrayado aunque otro escriba más arriba mientras está abierto (O8). */
  anchor: UnderlineAnchor | null;
  /** Abierto con el mouse: se cierra al salir. */
  hover: boolean;
}

export function RelPeek({ eventsRef, view, pageId, editable }: { eventsRef: MutableRefObject<PeekEvents | null>; view: () => EditorView | null; pageId: string; editable: boolean }) {
  const [open, setOpenState] = useState<Open | null>(null);
  const openRef = useRef<Open | null>(null);
  const timers = useRef<{ open?: ReturnType<typeof setTimeout>; close?: ReturnType<typeof setTimeout> }>({});
  // La vista más nueva para los relojes (el efecto de abajo se arma una sola vez).
  const viewRef = useRef(view);
  viewRef.current = view;
  const setOpen = (next: Open | null) => {
    openRef.current = next;
    setOpenState(next);
  };
  const clear = (which: 'open' | 'close') => {
    if (timers.current[which]) clearTimeout(timers.current[which]);
    timers.current[which] = undefined;
  };
  const anchorFor = (target: PeekTarget): UnderlineAnchor | null => {
    const v = viewRef.current();
    return v && target.via === 'underline' ? anchorOf(v.state, target.from, target.ref) : null;
  };
  const close = () => {
    clear('open');
    clear('close');
    if (openRef.current) setOpen(null);
  };

  useEffect(() => {
    eventsRef.current = {
      hover: (target) => {
        clear('open');
        const cur = openRef.current;
        if (target) {
          clear('close');
          if (cur && cur.target.from === target.from) return;
          timers.current.open = setTimeout(() => {
            // Con texto elegido no: ahí está la barra de formato (O4 de la auditoría de E6).
            if (viewRef.current()?.state.selection.empty === false) return;
            setOpen({ target, hover: true, anchor: anchorFor(target) });
          }, HOVER_OPEN_MS);
        } else if (cur?.hover) {
          clear('close');
          timers.current.close = setTimeout(close, HOVER_CLOSE_MS);
        }
      },
      open: (target) => {
        clear('open');
        clear('close');
        setOpen({ target, hover: false, anchor: anchorFor(target) });
      },
      isOpen: (from) => !!openRef.current && (from === undefined || openRef.current.target.from === from),
      close,
      select: () => {
        clear('open');
        if (openRef.current?.hover) close();
      },
    };
    return () => {
      eventsRef.current = null;
      clear('open');
      clear('close');
    };
  }, [eventsRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // Otra página: se cierra.
  useEffect(close, [pageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tocar afuera, desplazar o Esc (con el foco fuera del editor) lo cierran.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.('.rel-peek, .rel-u, .rel-chip')) return;
      close();
    };
    const onScroll = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('.rel-peek')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // El subrayado bajo el adelanto queda marcado mientras está abierto.
  useEffect(() => {
    const v = view();
    if (!open || !v) return;
    const marked: Element[] = [];
    try {
      const { node } = v.domAtPos(open.target.from + 1);
      const el = (node.nodeType === 3 ? node.parentElement : (node as Element))?.closest('.rel-u, .rel-chip');
      if (el) {
        el.classList.add('hot');
        marked.push(el);
      }
    } catch {
      // El lugar ya no está.
    }
    return () => marked.forEach((el) => el.classList.remove('hot'));
  }, [open, view]);

  if (!open) return null;
  return createPortal(
    <PeekCard
      key={`${open.target.from}:${open.target.ref}`}
      target={open.target}
      pageId={pageId}
      canLink={editable && open.target.via === 'underline' && open.target.kind !== 'pending' && !!open.target.pageId}
      onEnter={() => clear('close')}
      onLeave={() => {
        if (!openRef.current?.hover) return;
        clear('close');
        timers.current.close = setTimeout(close, HOVER_CLOSE_MS);
      }}
      onLink={() => {
        const v = view();
        // Donde está ahora (otro pudo escribir más arriba mientras la tarjeta estaba abierta: O8).
        const at = v && open.anchor ? locateUnderline(v.state, open.anchor) : open.target.from;
        if (v && at !== null && makeLinkAt(v, at, open.target.ref)) v.focus();
        close();
      }}
      onGo={(id) => {
        close();
        navigate(pagePath(id));
      }}
      editable={editable}
      onAssign={(scene) => {
        // *Assign* de un pendiente (D522): la marca a la escena elegida sobre lo escrito, por el editor (un paso de ⌘Z),
        // donde está ahora el subrayado (O8: el ancla, no `target.from`).
        const v = view();
        const at = v && open.anchor ? locateUnderline(v.state, open.anchor) : null;
        const ok = !!v && at !== null && makeLinkAt(v, at, open.target.ref, { pageId: scene.pageId });
        close();
        if (ok) v!.focus();
        notify(ok ? tTr('assign.doneMention', { pending: open.target.ref, code: scene.code }) : tTr('assign.changedMention'));
      }}
      onClose={close}
    />,
    document.body,
  );
}

function PeekCard({
  target,
  pageId,
  canLink,
  editable,
  onEnter,
  onLeave,
  onLink,
  onGo,
  onAssign,
  onClose,
}: {
  target: PeekTarget;
  pageId: string;
  canLink: boolean;
  editable: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onLink: () => void;
  onGo: (pageId: string) => void;
  onAssign: (scene: { code: string; pageId: string }) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const services = useServices();
  const tree = useTree();
  const session = existingRelationsSession(services);
  const card = useRef<HTMLDivElement>(null);
  const phone = isPhoneLayout();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [assigning, setAssigning] = useState(false);
  const revision = useSyncExternalStore(session?.relations.subscribe ?? noSubscribe, session?.relations.getRevision ?? zero);
  const projectId = tree.get(pageId)?.workspace_id;
  // Quien ve una parte del proyecto no lee «no existe» (D401): puede existir en una página que no ve.
  const perms = usePermissions();
  const partial = !!projectId && perms.known && perms.role !== 'owner' && perms.role !== 'admin' && perms.projectLevel(projectId) === 0;
  const snap = session && projectId ? session.relations.snapshot(projectId) : null;

  const data = useMemo(() => {
    if (!snap || !session || target.kind === 'pending') return null;
    const src: LiveSource = { snap, title: (id) => tree.get(id)?.title, content: (id) => session.index.content(id) };
    return target.kind === 'scene' ? ({ kind: 'scene', v: sceneLive(src, target.ref) } as const) : ({ kind: 'loc', v: locationLive(src, target.ref) } as const);
  }, [snap, revision, target.kind, target.ref]); // eslint-disable-line react-hooks/exhaustive-deps

  // En la computadora, debajo del subrayado (o arriba si no entra). En el teléfono, una hoja abajo, sobre la barra Today.
  useLayoutEffect(() => {
    if (phone || !card.current) return;
    const h = card.current.offsetHeight;
    const r = target.rect;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - CARD_W - 8));
    const top = r.bottom + 8 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : r.bottom + 8;
    setPos({ left, top });
  }, [phone, target, data, assigning]);

  const linkKey = touchDevice() ? null : keyLabel(shortcut('relLink').keys[0]);
  const reading = !!data && !data.v.complete;
  const title = target.pageId ? tree.get(target.pageId)?.title : undefined;
  const photos: PhotoRef[] = data ? data.v.photos : [];

  let rows: ReactNode = null;
  if (target.kind === 'pending') {
    // Eligiendo la escena de *Assign*: el selector en el lugar de la nota, dentro de la tarjeta (B1 de la auditoría de E7).
    rows =
      assigning && snap ? (
        <ScenePicker
          inline
          src={{ snap, title: (id) => tree.get(id)?.title }}
          // Sin filtro, primero las escenas que nombra la página y las del episodio del número escrito (105_120 → 105).
          near={[...new Set((snap.pages.get(pageId)?.mentions ?? []).filter((m) => m.kind === 'scene').map((m) => m.ref))]}
          ep={target.ref.includes('_') ? target.ref.slice(0, 3) : null}
          label={tr('assign.button')}
          onClose={() => setAssigning(false)}
          onPick={onAssign}
        />
      ) : (
        <div className="rp-note">{tr(partial ? 'peek.pendingNoteSeen' : 'peek.pendingNote')}</div>
      );
  } else if (data?.kind === 'scene') {
    const v = data.v;
    const shotDays = v.days.filter((d) => d.sections.length);
    const locs = [...new Set(shotDays.flatMap((d) => d.day.locs))];
    const planned = v.plannedDays.map((d) => d.day.label);
    rows = (
      <>
        <div className="rp-r">
          <span>{tr('peek.shotAt')}</span>
          <div className="v">
            {locs.length ? (
              locs.map((l) => {
                const id = snap?.registry.locations.get(l)?.pageId;
                return (
                  <Chip key={l} kind="loc" onClick={() => id && onGo(id)}>
                    {l}
                  </Chip>
                );
              })
            ) : (
              <>
                <span className="lh-none">{reading ? tr('live.reading') : tr('live.noReport')}</span>
                {!reading && v.noVfx && (
                  <span className="lh-st" data-tip={tr('live.noVfxTip')}>
                    {tr('peek.noVfx')}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="rp-r">
          <span>{tr('peek.days')}</span>
          <div className="v">{shotDays.length ? shotDays.map((d) => <DayChip key={d.day.pageId} day={d.day} />) : planned.length ? tr('peek.planned', { days: planned.join(', ') }) : <span className="lh-none">{reading ? tr('live.reading') : '—'}</span>}</div>
        </div>
        <div className="rp-r">
          <span>{tr('live.breakdown')}</span>
          <div className="v">
            {tr('live.cards', { count: v.cards.length })}
            {v.questions.length > 0 && ` · ${tr('live.questions', { count: v.questions.length })}`}
          </div>
        </div>
      </>
    );
  } else if (data?.kind === 'loc') {
    const v = data.v;
    const scenes = [...new Set(v.days.flatMap((d) => d.scenes.map((s) => s.code)))];
    rows = (
      <>
        <div className="rp-r">
          <span>{tr('peek.shootDays')}</span>
          <div className="v">{v.days.length ? v.days.map((d) => <DayChip key={d.day.pageId} day={d.day} />) : <span className="lh-none">{reading ? tr('live.reading') : '—'}</span>}</div>
        </div>
        <div className="rp-r">
          <span>{tr('peek.scenesShot')}</span>
          <div className="v mono">{scenes.length ? scenes.join(' · ') : <span className="lh-none">{reading ? tr('live.reading') : '—'}</span>}</div>
        </div>
        {v.scouts.length > 0 && (
          <div className="rp-r">
            <span>{tr('live.scouting')}</span>
            <div className="v">{v.scouts.map((s) => s.title).join(', ')}</div>
          </div>
        )}
      </>
    );
  }

  const label = target.kind === 'loc' ? target.ref : `${target.ref}${target.part ? target.part.toLowerCase() : ''}`;
  const head = (
    <>
      {photos[0] && <Thumb id={photos[0].id} className="rp-img" />}
      <span className="rp-ht">
        <span className={`rp-k ${target.kind}`}>
          {target.kind === 'loc' ? tr('live.location') : label}
          <small> · {target.kind === 'pending' ? tr('peek.pending') : target.via === 'link' ? tr('peek.link') : tr('peek.recognized')}</small>
        </span>
        <span className="rp-tt">{target.kind === 'pending' ? tr(partial ? 'peek.pendingTitleSeen' : 'peek.pendingTitle') : target.kind === 'loc' ? target.ref : title !== undefined ? sceneTitleOf(title) : tr('peek.notVisible')}</span>
      </span>
    </>
  );
  return (
    <div
      ref={card}
      className={`lh rel-peek${phone ? ' phone' : ''}`}
      role="dialog"
      aria-label={tr('peek.aria')}
      style={phone ? undefined : { left: pos?.left ?? -9999, top: pos?.top ?? 0, width: CARD_W }}
      onPointerEnter={(e) => e.pointerType === 'mouse' && onEnter()}
      onPointerLeave={(e) => e.pointerType === 'mouse' && onLeave()}
      // Tocar la tarjeta no le saca el foco al editor (el teclado sigue como estaba).
      onMouseDown={(e) => e.preventDefault()}
    >
      {target.pageId ? (
        <button className="rp-h" onClick={() => onGo(target.pageId!)}>
          {head}
        </button>
      ) : (
        <div className="rp-h">{head}</div>
      )}
      {rows}
      {photos.length > 0 && (
        <div className="rp-r">
          <span>{tr('live.photos')}</span>
          <div className="v rp-thumbs">
            {photos.slice(0, 3).map((p) => (
              <Thumb key={p.id} id={p.id} />
            ))}
            {photos.length > 3 && <span className="lh-more">+{photos.length - 3}</span>}
          </div>
        </div>
      )}
      {target.kind === 'pending' && projectId && snap && (
        // Un número que no existe (E7, D519, D522): crearlo con las guardas, o decir a qué escena se refiere.
        <div className="rp-f">
          <CreateEntityButton want={{ kind: 'scene', code: target.ref + target.part }} projectId={projectId} className="rp-open" onDone={(res) => res.ok && onClose()} />
          <span className="sp" />
          {editable && (
            <button className="rp-link rel-assign" aria-expanded={assigning} data-tip={tr('assign.pendingTip')} onClick={() => setAssigning(!assigning)}>
              {tr('assign.button')}
            </button>
          )}
        </div>
      )}
      {(target.pageId || canLink) && (
        <div className="rp-f">
          {target.pageId && (
            <button className="rp-open" onClick={() => onGo(target.pageId!)}>
              {tr('peek.open', { ref: target.kind === 'loc' ? target.ref : label })}
              <Ic name="go" small />
            </button>
          )}
          <span className="sp" />
          {canLink && (
            <button className="rp-link" onClick={onLink}>
              {tr('peek.makeLink')}
              {linkKey && <kbd>{linkKey}</kbd>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const noSubscribe = () => () => undefined;
const zero = () => 0;
