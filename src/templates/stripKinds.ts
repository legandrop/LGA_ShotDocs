import { pageKind, type KindTree } from '../relations/kind';
import type { BuiltinKind } from './builtin';

// Qué plantillas de fábrica ofrece la tira *Start from a template* de una página vacía (Docs/Doc_Plantillas.md, 4.1): las
// que tocan donde está la página (Docs/Doc_Estructura_Proyecto.md, «Tipo de página»). La ventana *Templates* (*More…*)
// sigue ofreciendo todas.

/** Las de siempre, fuera de una carpeta con tipo. */
export const DEFAULT_STRIP: BuiltinKind[] = ['prepro', 'onset', 'shot'];

export function stripKinds(tree: KindTree, pageId: string): BuiltinKind[] {
  const kind = pageKind(tree, pageId);
  if (kind.kind === 'scene') return ['scene', 'prepro', 'shot'];
  if (kind.kind === 'location') return ['location'];
  if (kind.kind === 'day') return ['onset'];
  if (kind.kind === 'part' && kind.ofKind === 'location') return ['techScout', 'creativeScout'];
  if (kind.kind === 'part' && kind.ofKind === 'scene') return ['shot', 'prepro'];
  return DEFAULT_STRIP;
}
