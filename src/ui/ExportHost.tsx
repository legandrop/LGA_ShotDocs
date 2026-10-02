import { useEffect, useState } from 'react';
import { ExportDialog } from './lazyDialogs';
import { Part } from './lazyPart';

// Exportar (P.22, Docs/Doc_Exportar.md): lo que está siempre montado. La ventana se abre desde cualquier menú con
// `openExport` (el de la página, el de un proyecto) y se baja aparte la primera vez (lazyDialogs.ts).

const OPEN = 'shotdocs:export';

type Request = { kind: 'page' | 'project'; id: string };

/** Abre la ventana *Export* de una página (con sus subpáginas) o de un proyecto. */
export function openExport(kind: 'page' | 'project', id: string): void {
  window.dispatchEvent(new CustomEvent<Request>(OPEN, { detail: { kind, id } }));
}

export function ExportHost() {
  const [open, setOpen] = useState<Request | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setOpen((e as CustomEvent<Request>).detail);
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
