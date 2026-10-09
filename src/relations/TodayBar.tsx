import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@tiptap/pm/view';
import { useT } from '../i18n';
import { useServices, useTree } from '../services';
import { isPhoneLayout } from '../ui/commentsUi';
import { CameraIcon, MicIcon } from '../ui/icons';
import { existingRelationsSession } from '../ui/relationsUi';
import { openDictation } from '../dictation/dictationUi';
import { useDictateOffer } from '../dictation/DictationHost';
import { dayLive } from './dayLive';
import { Ic } from './LiveHeader';
import type { LiveSource } from './liveView';

// La barra *Today* sobre el teclado del teléfono (Docs/Doc_Relaciones.md, sección 14; maqueta `d_escribir.html` y
// `c_dia.html`): escribiendo en el reporte de un día de rodaje, una fila con las escenas de hoy (tocar una la escribe donde
// está el cursor), la locación del día, la cámara y el dictado. Aparece solo en el teléfono, con el editor enfocado (el
// teclado abierto) y si la página se puede editar. Va pegada arriba del teclado (`visualViewport`): los avisos y el
// adelanto van por encima de ella (`--rel-today-space`), y el botón redondo de dictar se esconde mientras está (su
// micrófono queda en la barra). No escribe nada por su cuenta: solo lo que se toca.

const ROOT_VAR = '--rel-today-space';

export function TodayBar({ view, pageId, editable, camera }: { view: () => EditorView | null; pageId: string; editable: boolean; camera: (() => void) | null }) {
  const services = useServices();
  const tree = useTree();
  const tr = useT();
  const session = existingRelationsSession(services);
  const revision = useSyncExternalStore(session?.relations.subscribe ?? noSubscribe, session?.relations.getRevision ?? zero);
  const projectId = tree.get(pageId)?.workspace_id;
  const snap = session && projectId ? session.relations.snapshot(projectId) : null;
  const role = snap?.registration.roles.get(pageId);
  const isDay = !!role && !role.excluded && role.entity?.kind === 'day';
  const dictate = useDictateOffer(pageId);
  const [focused, setFocused] = useState(false);
  const [phone, setPhone] = useState(isPhoneLayout);
  const bar = useRef<HTMLDivElement>(null);

  // El editor con el foco (en el teléfono, el teclado abierto). Al tocar la barra el foco no se va (`mousedown`).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setFocused(!!view()?.hasFocus()), 120);
    };
    const resize = () => setPhone(isPhoneLayout());
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    window.addEventListener('resize', resize);
    check();
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
      window.removeEventListener('resize', resize);
    };
  }, [view]);

  const visible = editable && isDay && phone && focused;

  const items = useMemo(() => {
    if (!visible || !snap || !session) return null;
    const src: LiveSource = { snap, title: (id) => tree.get(id)?.title, content: (id) => session.index.content(id) };
    const d = dayLive(src, pageId);
    // Las del plan del día; si no hay plan, las que ya tienen sección en el reporte.
    const codes = d.plan.codes.length ? d.plan.codes : [...new Set(d.rows.flatMap((r) => (r.kind === 'scene' ? [r.code] : [])))];
    return { codes, loc: d.day.loc };
  }, [visible, snap, revision, pageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arriba del teclado: en el teléfono el teclado no achica la página, achica `visualViewport`.
  useEffect(() => {
    const root = document.documentElement;
    if (!visible) {
      root.style.removeProperty(ROOT_VAR);
      return;
    }
    const vv = window.visualViewport;
    const place = () => {
      const inset = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      if (bar.current) bar.current.style.bottom = `${inset}px`;
      root.style.setProperty(ROOT_VAR, `${inset + (bar.current?.offsetHeight ?? 0)}px`);
    };
    place();
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    return () => {
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
      root.style.removeProperty(ROOT_VAR);
    };
  }, [visible, items]);

  if (!visible || !items) return null;
  /** Escribe donde está el cursor, con un espacio antes si hace falta y uno después, sin sacarle el foco al editor. */
  const insert = (text: string) => {
    const v = view();
    if (!v) return;
    const { state } = v;
    const { from } = state.selection;
    const before = from > 0 ? state.doc.textBetween(from - 1, from, '\n', '\n') : '';
    const pre = before && !/\s/.test(before) ? ' ' : '';
    v.dispatch(state.tr.insertText(`${pre}${text} `).scrollIntoView());
    v.focus();
  };
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  return createPortal(
    <div ref={bar} className="rel-today" role="toolbar" aria-label={tr('today.aria')} onMouseDown={keep} onPointerDown={keep}>
      <span className="lab">{tr('today.label')}</span>
      {items.codes.map((code) => (
        <button key={code} className="pill" aria-label={tr('today.insert', { text: code })} onClick={() => insert(code)}>
          <span className="k">{code}</span>
        </button>
      ))}
      {items.loc && (
        <button className="pill ic" aria-label={tr('today.insert', { text: items.loc })} onClick={() => insert(items.loc!)}>
          <Ic name="loc" small />
        </button>
      )}
      {camera && (
        <button className="pill ic" aria-label={tr('camera.takePhoto')} onClick={camera}>
          <CameraIcon size={18} />
        </button>
      )}
      {dictate && (
        <button className="pill ic" aria-label={tr('shell.dictate')} onClick={() => openDictation()}>
          <MicIcon size={18} />
        </button>
      )}
    </div>,
    document.body,
  );
}

const noSubscribe = () => () => undefined;
const zero = () => 0;
