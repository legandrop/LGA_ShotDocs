import { mediaIdsInDoc } from '../media/usage';
import type { ArchiveMedia } from './exportZip';
import type { ExportPlanPage, ExportSource } from './exportPages';

// Qué archivos llevan las páginas que se van a exportar, leído de lo guardado en el dispositivo y sin red: la ventana
// *Export* lo usa para avisar de «sin conexión» solo cuando el aviso es verdad (Doc_Links_PDF.md, 3.3; Doc_Exportar.md).
// Un PDF sin ningún archivo no tiene links a archivos que arreglar ni fotos que bajar de resolución.

export interface PlanFiles {
  /** Adjuntos, videos y carpetas distintos que usan las páginas (sin borrados ni fotos): llevan link en el PDF. */
  files: number;
  /** Fotos cuyo original no está en este dispositivo: sin red salen en menor resolución. */
  photosWithoutOriginal: number;
  /** Una página no se pudo leer: puede llevar archivos que no se vieron. */
  unknown: boolean;
}

/** Los archivos de esas páginas, sin bajar nada. Una página que no se puede leer deja `unknown` (el aviso sale, por las dudas). */
export async function planFiles(
  plan: readonly Pick<ExportPlanPage, 'id'>[],
  source: Pick<ExportSource, 'snapshot'>,
  media: ArchiveMedia | null,
  signal?: AbortSignal,
): Promise<PlanFiles> {
  const ids = new Set<string>();
  const out: PlanFiles = { files: 0, photosWithoutOriginal: 0, unknown: false };
  for (const page of plan) {
    if (signal?.aborted) return out;
    try {
      const snap = await source.snapshot(page.id);
      try {
        if (!snap.supported || snap.state.unreadable) out.unknown = true;
        for (const id of mediaIdsInDoc(snap.doc)) ids.add(id);
      } finally {
        snap.doc.destroy();
      }
    } catch {
      out.unknown = true;
    }
  }
  if (!media) {
    out.files = ids.size;
    return out;
  }
  // `learn` puede preguntar a la base si falta un registro local. `meta` ya lee lo guardado:
  // el conteo sin conexión nunca necesita aprender nada de la red.
  for (const id of ids) {
    if (signal?.aborted) return out;
    const meta = await media.meta(id).catch(() => null);
    if (meta?.deleted) continue;
    // Las fotos se imprimen sin link; los adjuntos, los videos y las carpetas sí lo llevan.
    if (!meta || meta.kind !== 'image' || meta.folder) out.files++;
    if (meta && meta.kind === 'image' && !meta.folder && !(await media.hasOriginal(id).catch(() => false))) out.photosWithoutOriginal++;
  }
  return out;
}
