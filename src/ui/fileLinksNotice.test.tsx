// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import type { FileLinkChoice, FileLinkPlan } from '../export/exportLinks';
import { FileLinksNotice, fileLinksTickedByDefault } from './FileLinksNotice';

// El aviso de *Export* con un link público (P.30, Docs/Doc_Links_PDF.md, LF18): página y nivel, *Can edit* destildado.

const view: FileLinkChoice = { pageId: 'A', title: 'Reporte Día 1', level: 'comment', expiresAt: null, token: 'x' };
const edit: FileLinkChoice = { pageId: 'B', title: 'Desglose', level: 'edit', expiresAt: '2026-11-01T12:00:00Z', token: 'y' };
const plan = (...links: FileLinkChoice[]): FileLinkPlan => ({ byPage: new Map(links.map((l) => [l.pageId, l])), links });

async function render(p: FileLinkPlan | null, checked: boolean, onChange = vi.fn()) {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(<FileLinksNotice plan={p} checked={checked} onChange={onChange} />));
  return { host, root, onChange };
}

describe('FileLinksNotice', () => {
  it('Can view: nombra la página, dice que cambiar el nivel cambia lo repartido, tildada', async () => {
    expect(fileLinksTickedByDefault(plan(view))).toBe(true);
    const { host } = await render(plan(view), true);
    expect(host.textContent).toContain(t('exportDialog.fileLinksView', { title: 'Reporte Día 1' }));
    expect(host.textContent).toContain(t('exportDialog.fileLinksLevel'));
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  });

  it('Can edit: lo dice (y editarlas), con su vencimiento, y destildada por defecto', async () => {
    expect(fileLinksTickedByDefault(plan(view, edit))).toBe(false);
    expect(fileLinksTickedByDefault(plan(edit))).toBe(false);
    const { host, onChange } = await render(plan(edit), false);
    expect(host.textContent).toContain(t('exportDialog.fileLinksEdit', { title: 'Desglose' }));
    expect(host.textContent).toContain(t('exportDialog.fileLinksOff'));
    expect(host.textContent).toMatch(/2026/);
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('sin links, nada', async () => {
    expect(fileLinksTickedByDefault(null)).toBe(false);
    const { host } = await render(plan(), true);
    expect(host.innerHTML).toBe('');
  });
});
