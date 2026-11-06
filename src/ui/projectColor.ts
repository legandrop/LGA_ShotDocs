import { useSyncExternalStore } from 'react';
import { normalizeHex } from '../lib/hexColor';
import type { ProjectRow } from '../sync/types';

// El color de cada proyecto (Docs/Doc_Navegacion.md, «Color del proyecto»): el punto que reemplazó al recuadro amarillo
// con dos letras, en el selector de proyectos, arriba de la barra lateral y en cada tab.
//
// - Lo elige quien puede renombrar el proyecto (`workspaces.color`, versión 27 de la base).
// - Sin elegir: uno de la paleta según el id del proyecto, siempre el mismo en todos los dispositivos.
// - Mientras el picker está abierto, el color que se prueba se ve en todos los puntos de ese proyecto (`previewColor`);
//   *Cancel* lo saca.

/** La paleta de fábrica del picker de las apps de escritorio de LGA (LgaColorPickerDialog): ocho tonos sin el violeta. */
export const PROJECT_PRESETS = ['#2e5a8e', '#443a91', '#774dcb', '#2e8e7a', '#4a7a2e', '#8e7a2e', '#8e4a2e', '#8e2e5a'];

/** El color de un proyecto sin elegir: siempre el mismo para el mismo id. */
export function defaultProjectColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PROJECT_PRESETS[h % PROJECT_PRESETS.length];
}

/** El color con el que se pinta un proyecto: el elegido o el de fábrica. */
export function projectColor(project: Pick<ProjectRow, 'id' | 'color'>): string {
  return (project.color && normalizeHex(project.color)) || defaultProjectColor(project.id);
}

// --- vista previa mientras el picker está abierto ----------------------------------------------------

let preview: { id: string; color: string } | null = null;
const listeners = new Set<() => void>();

/** Muestra `color` en todos los puntos del proyecto `id` (o, con `null`, vuelve a su color guardado). */
export function previewColor(id: string, color: string | null): void {
  const next = color ? { id, color } : null;
  if (preview?.id === next?.id && preview?.color === next?.color) return;
  if (!next && preview && preview.id !== id) return;
  preview = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** El color que se ve del proyecto: el de la vista previa, si se está eligiendo uno; si no, el suyo. */
export function useProjectColor(project: Pick<ProjectRow, 'id' | 'color'> | undefined | null): string | null {
  const draft = useSyncExternalStore(subscribe, () => preview, () => preview);
  if (!project) return null;
  return draft && draft.id === project.id ? draft.color : projectColor(project);
}

// --- recientes del picker (en el dispositivo, como en las apps de escritorio) ----------------------------

const RECENTS_KEY = 'shotdocs.colorRecents';

export function loadRecentColors(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((v) => (typeof v === 'string' && normalizeHex(v) ? [normalizeHex(v)!] : [])).slice(0, 8);
  } catch {
    return [];
  }
}

/** El elegido pasa al frente, sin repetidos, y quedan 8. */
export function rememberRecentColor(color: string): void {
  const hex = normalizeHex(color);
  if (!hex) return;
  const next = [hex, ...loadRecentColors().filter((c) => c !== hex)].slice(0, 8);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Sin almacenamiento (modo privado): los recientes no se recuerdan.
  }
}
