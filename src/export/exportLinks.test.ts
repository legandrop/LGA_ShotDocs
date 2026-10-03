import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chooseFileLinks, loadFileLinks, type FileLinkChoice } from './exportLinks';

// Qué link público usan los archivos de cada página de un PDF exportado (P.30, Docs/Doc_Links_PDF.md, 3.3, LF18).

// Árbol: R > A > B > C, y R > D.
const PARENT: Record<string, string | null> = { R: null, A: 'R', B: 'A', C: 'B', D: 'R' };
const parentOf = (id: string) => PARENT[id] ?? null;
const link = (pageId: string, level: 'comment' | 'edit'): FileLinkChoice => ({ pageId, title: pageId, level, expiresAt: null, token: `tok-${pageId}` });

describe('chooseFileLinks', () => {
  it('el más cercano Can view; uno Can edit solo si no hay ninguno Can view arriba', () => {
    const links = new Map([
      ['A', link('A', 'comment')],
      ['B', link('B', 'edit')],
    ]);
    const plan = chooseFileLinks(['R', 'A', 'B', 'C', 'D'], parentOf, links);
    expect(plan.byPage.get('R')).toBeUndefined();
    expect(plan.byPage.get('A')?.pageId).toBe('A');
    // B tiene un Can edit propio, pero arriba hay uno Can view: gana el que da menos.
    expect(plan.byPage.get('B')?.pageId).toBe('A');
    expect(plan.byPage.get('C')?.pageId).toBe('A');
    expect(plan.byPage.get('D')).toBeUndefined();
    expect(plan.links.map((l) => l.pageId)).toEqual(['A']);
  });

  it('solo Can edit: se usa (y la ventana lo destilda)', () => {
    const plan = chooseFileLinks(['B', 'C'], parentOf, new Map([['B', link('B', 'edit')]]));
    expect(plan.byPage.get('C')?.level).toBe('edit');
    expect(plan.links).toHaveLength(1);
  });

  it('dos Can view en el camino: el más cercano', () => {
    const plan = chooseFileLinks(['C'], parentOf, new Map([['A', link('A', 'comment')], ['B', link('B', 'comment')]]));
    expect(plan.byPage.get('C')?.pageId).toBe('B');
  });
});

describe('loadFileLinks', () => {
  function client(pages: string[], infos: Record<string, unknown>, failPages = false): SupabaseClient {
    const rpc = vi.fn(async (fn: string, args: { p_page?: string }) => {
      if (fn === 'public_link_pages') return failPages ? { data: null, error: { message: 'x', code: '42883' }, status: 404 } : { data: pages.map((page_id) => ({ page_id })), error: null, status: 200 };
      if (fn === 'get_public_link') return { data: infos[args.p_page!] ?? null, error: null, status: 200 };
      throw new Error(fn);
    });
    return { rpc } as unknown as SupabaseClient;
  }
  const info = (level: string, token: string | null, alive = true) => ({ clean_on: true, link: { level, token, alive, expires_at: null }, above: null });

  it('pregunta solo por los links del camino, y solo usa los que tienen token y andan', async () => {
    const c = client(['A', 'B', 'D'], { A: info('comment', 'tok-A', false), B: info('edit', 'tok-B'), D: info('comment', 'tok-D') });
    const plan = await loadFileLinks(c, ['B', 'C'], parentOf, (id) => `t-${id}`);
    // A: Can view pero vencido o apagado (no anda); B: Can edit, el único que anda; D: fuera de la rama, ni se pregunta.
    expect(plan?.byPage.get('C')?.token).toBe('tok-B');
    expect(plan?.links.map((l) => l.title)).toEqual(['t-B']);
    const asked = (c.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((call) => call[0] === 'get_public_link').map((call) => call[1].p_page);
    expect(asked.sort()).toEqual(['A', 'B']);
  });

  it('sin links o sin poder preguntar: nada (el PDF va con la dirección de siempre)', async () => {
    expect((await loadFileLinks(client([], {}), ['C'], parentOf, String))?.links).toEqual([]);
    expect(await loadFileLinks(client([], {}, true), ['C'], parentOf, String)).toBeNull();
  });
});
