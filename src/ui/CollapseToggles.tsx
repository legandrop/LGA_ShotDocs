import type { BlockNoteEditor } from '@blocknote/core';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/editor';
import { blockIdOf } from './carreteModel';
import { hiddenInDom } from './collapseDom';
import { COLLAPSE_SHORTCUT_LABEL, collapseState, onCollapseChange, toggleCollapsed } from './collapseEditor';
import { triangleBox } from './gutterLayout';

// El triángulo de cada título (P.11, Docs/Doc_Colapsar.md, sección 3). Una capa encima del editor, como el
// margen de comentarios: no entra al documento (no molesta al escribir) y anda igual en solo lectura. Con el
// mouse, aparece al pasar por el título o por su margen (la franja de la izquierda donde están el triángulo y
// los puntos, así se llega del título al triángulo sin que desaparezca); colapsado, se ve siempre. En pantallas
// táctiles se ve siempre, tenue. Gris; con el mouse encima, del color del título. La zona del clic queda entera en
// el margen izquierdo, sin tapar el texto (corrección 14); las medidas, en gutterLayout.ts.

type AnyEditor = BlockNoteEditor<any, any, any>;

interface Toggle {
  id: string;
  top: number;
  left: number;
  /** El lado del dibujo y el de la zona del clic (px). */
  size: number;
  box: number;
  color: string;
  collapsed: boolean;
  title: string;
}

/** La franja de un título donde el mouse lo señala: del borde izquierdo del editor al final del título. */
interface Band {
  id: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function coarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export function CollapseToggles({ editor, host, editable }: { editor: AnyEditor; host: RefObject<HTMLDivElement | null>; editable: boolean }) {
  const tr = useT();
  const [toggles, setToggles] = useState<Toggle[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [touch] = useState(coarsePointer);
  const frame = useRef<number | null>(null);
  const bands = useRef<Band[]>([]);
  const layer = useRef<HTMLDivElement>(null);

  // Para BlockNote, la capa es parte del editor: pasar el mouse por el triángulo no esconde los puntos del título.
  useEffect(() => {
    const el = layer.current;
    if (!el || typeof editor.registerPortalElement !== 'function') return;
    editor.registerPortalElement(el);
    return () => editor.unregisterPortalElement(el);
  }, [editor]);

  // Se vuelve a medir con cada cambio del documento, de lo colapsado, del tamaño o del tema, agrupado por cuadro.
  useEffect(() => {
    const view = editor.prosemirrorView;
    const bump = () => {
      if (frame.current !== null) return;
      const run = () => {
        frame.current = null;
        setTick((n) => n + 1);
      };
      frame.current = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : (setTimeout(run, 16) as unknown as number);
    };
    const offDoc = editor.onChange(bump);
    const offCollapse = view ? onCollapseChange(view, bump) : undefined;
    const el = host.current;
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(bump) : null;
    if (el) resize?.observe(el);
    window.addEventListener('resize', bump);
    document.fonts?.addEventListener?.('loadingdone', bump);
    // El tema, la letra o el tamaño del texto cambian el color y las medidas del título sin tocar el documento
    // (prefs.ts los pone en `<html>`): el color del triángulo con el mouse encima no queda el del tema de antes.
    const prefsObserver = typeof MutationObserver === 'function' ? new MutationObserver(bump) : null;
    prefsObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-font', 'data-text-size', 'data-page-width'] });
    bump();
    return () => {
      if (frame.current !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
        else clearTimeout(frame.current);
        frame.current = null;
      }
      offDoc?.();
      offCollapse?.();
      resize?.disconnect();
      window.removeEventListener('resize', bump);
      document.fonts?.removeEventListener?.('loadingdone', bump);
      prefsObserver?.disconnect();
    };
  }, [editor, host]);

  useLayoutEffect(() => {
    const root = host.current;
    const state = collapseState(editor.prosemirrorState);
    if (!root || !state) return;
    const base = root.getBoundingClientRect();
    const editorEl = root.querySelector('.bn-editor');
    const editorLeft = editorEl ? editorEl.getBoundingClientRect().left : base.left;
    const next: Toggle[] = [];
    const nextBands: Band[] = [];
    for (const content of root.querySelectorAll<HTMLElement>('.bn-editor .bn-block-content[data-content-type="heading"]')) {
      if (hiddenInDom(content)) continue;
      const id = blockIdOf(content);
      if (!id) continue;
      const text = content.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? content;
      const r = content.getBoundingClientRect();
      const g = triangleBox(text, editorLeft);
      next.push({
        id,
        top: g.top - base.top,
        left: g.left - base.left,
        size: g.size,
        box: g.box,
        color: getComputedStyle(text).color,
        collapsed: state.analysis.collapsed.has(id),
        title: (text.textContent ?? '').trim(),
      });
      nextBands.push({ id, top: r.top - base.top, bottom: r.bottom - base.top, left: editorLeft - base.left, right: r.right - base.left });
    }
    bands.current = nextBands;
    setToggles((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [editor, host, tick]);

  // El título que se señala con el mouse: el triángulo mismo, el título o su franja a la izquierda (el margen,
  // con los puntos), así el triángulo sigue a la vista mientras se va del texto hacia él.
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = e.target instanceof Element ? e.target : null;
      const toggle = el?.closest<HTMLElement>('.sd-collapse-toggle');
      if (toggle) return setHovered(toggle.dataset.id ?? null);
      const content = el?.closest('.bn-block-content[data-content-type="heading"]');
      if (content) return setHovered(blockIdOf(content));
      const base = root.getBoundingClientRect();
      const x = e.clientX - base.left;
      const y = e.clientY - base.top;
      const band = bands.current.find((b) => y >= b.top && y < b.bottom && x >= b.left - 8 && x <= b.right);
      setHovered(band ? band.id : null);
    };
    const onLeave = () => setHovered(null);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    return () => {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, [host]);

  // Al llegar al triángulo, los puntos pasan a su título. Para BlockNote la capa es parte del editor y no mueve
  // el menú lateral con el mouse encima (se quedaba en el bloque de antes si se llegaba al triángulo sin pasar por
  // el título): se le avisa un movimiento sobre el principio del título.
  const handleFollows = (id: string) => {
    const block = host.current?.querySelector(`.bn-editor [data-node-type="blockContainer"][data-id="${CSS.escape(id)}"]`);
    const text = block?.querySelector(':scope > .bn-block-content :is(h1, h2, h3, h4, h5, h6)');
    if (!text) return;
    const r = text.getBoundingClientRect();
    text.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 1, clientY: r.top + Math.min(r.height, 24) / 2 }));
  };

  const toggle = (id: string) => {
    const view = editor.prosemirrorView;
    if (view) toggleCollapsed(view, id);
  };

  return (
    <div ref={layer} className={`sd-collapse-toggles${touch ? ' sd-touch' : ''}`}>
      {toggles.map((t) => {
        const action = t.collapsed ? tr('collapse.expand') : tr('collapse.collapse');
        return (
          <button
            key={t.id}
            type="button"
            className={`sd-collapse-toggle${t.collapsed ? ' collapsed' : ''}${hovered === t.id ? ' shown' : ''}`}
            data-id={t.id}
            style={{ top: t.top, left: t.left, width: t.box, height: t.box, ['--sd-heading-color' as string]: t.color }}
            aria-expanded={!t.collapsed}
            aria-label={tr('collapse.label', { action, title: t.title })}
            data-tip={`**${action}**\n${t.collapsed ? tr('collapse.collapsedForYou') : tr('collapse.onlyYou')}\n${COLLAPSE_SHORTCUT_LABEL}`}
            // Con el editor editable, Tab anida bloques: el triángulo no entra en el orden de Tab.
            tabIndex={editable ? -1 : 0}
            // No saca el foco del editor ni extiende la selección (Shift).
            onPointerEnter={() => handleFollows(t.id)}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle(t.id)}
          >
            <svg viewBox="0 0 10 10" width={t.size} height={t.size} aria-hidden="true">
              <path d="M2 1 L8.5 5 L2 9 Z" fill="currentColor" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
