import { useEffect, useState } from 'react';
import type { ExportTarget } from './ExportDialog';
import { ExportDialog } from './lazyDialogs';
import { Part } from './lazyPart';

// Exportar (P.22, Docs/Doc_Exportar.md): lo que está siempre montado. La ventana se abre desde cualquier menú con
// `openExport` (el de la página, el de un proyecto) o con `openExportPages` (las páginas que hablan de una escena, en el
// mapa) y se baja aparte la primera vez (lazyDialogs.ts).

const OPEN = 'shotdocs:export';

/** Abre la ventana *Export* de una página (con sus subpáginas) o de un proyecto. */
export function openExport(kind: 'page' | 'project', id: string): void {
  window.dispatchEvent(new CustomEvent<ExportTarget>(OPEN, { detail: { kind, id } }));
}

/**
 * Abre la ventana *Export* de un grupo de páginas sueltas, cada una sin las de adentro (las que hablan de una escena).
 * `key` distingue el grupo (`scene:115`); `title` nombra el PDF y el zip.
 */
export function openExportPages(key: string, title: string, ids: string[]): void {
  window.dispatchEvent(new CustomEvent<ExportTarget>(OPEN, { detail: { kind: 'pages', id: key, title, ids } }));
}

export function ExportHost() {
  const [open, setOpen] = useState<ExportTarget | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setOpen((e as CustomEvent<ExportTarget>).detail);
    window.addEventListener(OPEN, onOpen);
    return () => window.removeEventListener(OPEN, onOpen);
  }, []);
  if (!open) return null;
  return (
    <Part onClose={() => setOpen(null)}>
      {/* Una ventana nueva por pedido (la `key`): lo armado de la anterior se suelta al cerrarla. */}
      <ExportDialog key={`${open.kind}:${open.id}`} target={open} onClose={() => setOpen(null)} />
    </Part>
  );
}
