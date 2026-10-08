import type { PageRow, PageSettings } from '../sync/types';
import type { KindTree } from './kind';

// Un árbol en memoria para las pruebas de `kind.ts` (solo pruebas).

type Spec = { id: string; parent?: string | null; title?: string; settings?: PageSettings; template_id?: string | null; deleted?: boolean };

/** Un árbol en memoria con lo que lee `kind.ts`. Sin una página, como un invitado que no la ve. */
export function fakeTree(specs: Spec[]): KindTree & { rows: Map<string, PageRow> } {
  const rows = new Map<string, PageRow>();
  for (const s of specs) {
    rows.set(s.id, {
      id: s.id,
      workspace_id: 'p',
      parent_id: s.parent ?? null,
      title: s.title ?? s.id,
      icon: null,
      sort_key: s.id,
      settings: s.settings ?? {},
      template_id: s.template_id ?? null,
      update_seq: 0,
      deleted_at: s.deleted ? '2026-10-01' : null,
      created_at: '',
      updated_at: '',
    });
  }
  return {
    rows,
    get: (id: string) => rows.get(id),
    children: (id: string | null) => [...rows.values()].filter((r) => r.parent_id === id && !r.deleted_at),
    isTrashed: (id: string) => {
      for (let r = rows.get(id); r; r = r.parent_id ? rows.get(r.parent_id) : undefined) if (r.deleted_at) return true;
      return false;
    },
  };
}

