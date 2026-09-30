import type { BlockNoteEditor } from '@blocknote/core';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT, type Key } from '../i18n';
import '../i18n/lazy/editor';
import './drive.css';
import { isTargetValid, type DrivePaste, type DrivePasteChoice } from './drivePaste';

// El menú chico que aparece junto al cursor al pegar un link de Drive (la lógica está en drivePaste.ts).
// No se lleva el foco: el cursor sigue en el editor, así seguir escribiendo lo cierra y el texto entra
// donde estaba. Con las flechas se recorre, Enter elige y Escape lo cierra (queda el link).

type AnyEditor = BlockNoteEditor<any, any, any>;

const svg = (d: string) => (
  <svg width={16} height={16} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const OPTIONS: { choice: DrivePasteChoice; label: Key; icon: ReactNode; tip?: Key }[] = [
  { choice: 'link', label: 'drivePaste.link', icon: svg('M8.5 11.5a3 3 0 0 0 4.24 0l2.5-2.5a3 3 0 0 0-4.24-4.24l-.75.75M11.5 8.5a3 3 0 0 0-4.24 0l-2.5 2.5a3 3 0 0 0 4.24 4.24l.75-.75') },
  { choice: 'text', label: 'drivePaste.text', icon: svg('M4.5 5h11M10 5v10.5M7.5 15.5h5') },
  {
    choice: 'card',
    label: 'drivePaste.card',
    icon: svg('M3.5 4.5h13v11h-13zM8.5 7.75v4.5l3.75-2.25z'),
    tip: 'drivePaste.cardTip',
  },
];

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn']);

export function DrivePasteMenu({ paste, editor }: { paste: DrivePaste; editor: AnyEditor }) {
  const target = useSyncExternalStore(paste.subscribe, paste.get, paste.get);
  const tr = useT();
  const [active, setActive] = useState(0);
  const [, relayout] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => setActive(0), [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (MODIFIERS.has(e.key)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        paste.close();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : OPTIONS.length - 1)) % OPTIONS.length);
      } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        paste.choose(editor, OPTIONS[activeRef.current].choice);
      } else {
        // Cualquier otra tecla: se sigue escribiendo y queda el link.
        paste.close();
      }
    };
    const onPointer = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) paste.close();
    };
    // En el teléfono se escribe sin eventos de teclado: cualquier texto que entra cierra el menú.
    const onInput = () => paste.close();
    const onMove = () => relayout((n) => n + 1);
    const dom = editor.domElement;
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    dom?.addEventListener('beforeinput', onInput);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    // Si otro cambia la página y mueve o toca lo pegado, el menú se cierra.
    const offChange = editor.onChange(() => {
      if (!isTargetValid(editor, target)) paste.close();
      else relayout((n) => n + 1);
    });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      dom?.removeEventListener('beforeinput', onInput);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      offChange();
    };
  }, [target, paste, editor]);

  // Debajo del final de lo pegado; si no entra, arriba. Nunca afuera de la pantalla.
  useLayoutEffect(() => {
    const el = ref.current;
    const view = editor.prosemirrorView;
    if (!el || !target || !view) return;
    let coords: { left: number; top: number; bottom: number };
    try {
      coords = view.coordsAtPos(target.to);
    } catch {
      return;
    }
    const r = el.getBoundingClientRect();
    const below = coords.bottom + 6;
    const top = below + r.height > window.innerHeight - 8 ? Math.max(8, coords.top - 6 - r.height) : below;
    const left = Math.max(8, Math.min(coords.left - 12, window.innerWidth - 8 - r.width));
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  });

  if (!target) return null;
  return createPortal(
    <div
      ref={ref}
      className="menu drive-paste-menu"
      role="menu"
      aria-label={tr('drivePaste.caption')}
      // El foco se queda en el editor.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="drive-paste-caption">{tr('drivePaste.caption')}</div>
      {OPTIONS.map((o, i) => (
        <button
          key={o.choice}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={i === active ? 'is-active' : undefined}
          data-tip={o.tip ? tr(o.tip) : undefined}
          onMouseEnter={() => setActive(i)}
          onClick={() => paste.choose(editor, o.choice)}
        >
          {o.icon}
          {tr(o.label)}
        </button>
      ))}
    </div>,
    document.body,
  );
}
