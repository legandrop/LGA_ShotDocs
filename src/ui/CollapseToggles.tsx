import type { BlockNoteEditor } from '@blocknote/core';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/editor';
import { blockIdOf } from './carrete';
import { hiddenInDom } from './collapseDom';
import { COLLAPSE_SHORTCUT_LABEL, collapseState, onCollapseChange, toggleCollapsed } from './collapseEditor';

// El triángulo de cada título (P.11, Docs/Doc_Colapsar.md, sección 3). Una capa encima del editor, como el
// margen de comentarios: no entra al documento (no molesta al escribir) y anda igual en solo lectura. Con el
// mouse, aparece al pasar por el título; colapsado, se ve siempre. En pantallas táctiles se ve siempre, tenue.
// La zona del clic queda entera en el margen izquierdo, sin tapar el texto (corrección 14).

type AnyEditor = BlockNoteEditor<any, any, any>;

interface Toggle {
  id: string;
  top: number;
  left: number;
  size: number;
  color: string;
  collapsed: boolean;
  title: string;
}

/** El lado de la zona del triángulo (px): entra en el margen del teléfono (20 px). */
const BOX = 20;

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

  // Se vuelve a medir con cada cambio del documento, de lo colapsado o del tamaño, agrupado por cuadro.
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
    };
  }, [editor, host]);

  useLayoutEffect(() => {
    const root = host.current;
    const state = collapseState(editor.prosemirrorState);
    if (!root || !state) return;
    const base = root.getBoundingClientRect();
    const next: Toggle[] = [];
    for (const content of root.querySelectorAll<HTMLElement>('.bn-editor .bn-block-content[data-content-type="heading"]')) {
      if (hiddenInDom(content)) continue;
      const id = blockIdOf(content);
      if (!id) continue;
      const text = content.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? content;
      const r = text.getBoundingClientRect();
      const style = getComputedStyle(text);
      const fontSize = parseFloat(style.fontSize) || 16;
      const line = parseFloat(style.lineHeight) || fontSize * 1.3;
      next.push({
        id,
        top: r.top - base.top + Math.min(line, r.height || line) / 2 - BOX / 2,
        // Pegado al texto: entra entero en el margen del teléfono (20 px) sin taparlo.
        left: r.left - base.left - BOX,
        size: Math.max(8, Math.min(12, Math.round(fontSize * 0.42))),
        color: style.color,
        collapsed: state.analysis.collapsed.has(id),
        title: (text.textContent ?? '').trim(),
      });
    }
    setToggles((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [editor, host, tick]);

  // El título que se señala con el mouse (o el triángulo mismo).
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = e.target instanceof Element ? e.target : null;
      const toggle = el?.closest<HTMLElement>('.sd-collapse-toggle');
      if (toggle) return setHovered(toggle.dataset.id ?? null);
      const content = el?.closest('.bn-block-content[data-content-type="heading"]');
      setHovered(content ? blockIdOf(content) : null);
    };
    const onLeave = () => setHovered(null);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    return () => {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, [host]);

  const toggle = (id: string) => {
    const view = editor.prosemirrorView;
    if (view) toggleCollapsed(view, id);
  };

  return (
    <div className={`sd-collapse-toggles${touch ? ' sd-touch' : ''}`}>
      {toggles.map((t) => {
        const action = t.collapsed ? tr('collapse.expand') : tr('collapse.collapse');
        return (
          <button
            key={t.id}
            type="button"
            className={`sd-collapse-toggle${t.collapsed ? ' collapsed' : ''}${hovered === t.id ? ' shown' : ''}`}
            data-id={t.id}
            style={{ top: t.top, left: t.left, color: t.color, width: BOX, height: BOX }}
            aria-expanded={!t.collapsed}
            aria-label={tr('collapse.label', { action, title: t.title })}
            data-tip={`**${action}**\n${t.collapsed ? tr('collapse.collapsedForYou') : tr('collapse.onlyYou')}\n${COLLAPSE_SHORTCUT_LABEL}`}
            // Con el editor editable, Tab anida bloques: el triángulo no entra en el orden de Tab.
            tabIndex={editable ? -1 : 0}
            // No saca el foco del editor ni extiende la selección (Shift).
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
