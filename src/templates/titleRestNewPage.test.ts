// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { FakeServer, makeDevice, type Device } from '../sync/testing';
import { watchTitleRests } from '../sync/titleRest';
import { writeNewPage } from './dayReportCreate';

// Una página nueva con título largo (asistente *Create translated subpage*, copia propia, reporte del día) y su contenido
// escrito por `writeNewPage`: lo que sobra del título puede llegar antes o después, y el contenido se escribe igual
// (antes, si llegaba antes, `writeNewPage` veía la página con algo y no escribía nada).

const devices: Device[] = [];
const stops: (() => void)[] = [];
afterEach(async () => {
  for (const s of stops.splice(0)) s();
  for (const d of devices.splice(0)) {
    await d.engine.stop();
    d.db.close();
    d.mediaDb.close();
    d.commentsDb.close();
  }
});

function texts(doc: Y.Doc): string[] {
  const out: string[] = [];
  const walk = (n: Y.XmlElement | Y.XmlFragment) => {
    for (const c of n.toArray()) {
      if (c instanceof Y.XmlText) out.push(c.toString());
      else if (c instanceof Y.XmlElement) walk(c);
    }
  };
  walk(doc.getXmlFragment(CONTENT_FRAGMENT));
  return out.filter(Boolean);
}

describe('lo que sobra del título y el contenido de una página nueva', () => {
  for (const [wait, started] of [[0, false], [1, false], [50, false], [0, true]] as [number, boolean][]) {
    it(`subpágina traducida con título de ~510 (espera ${wait} ms, motor ${started})`, async () => {
      const server = new FakeServer();
      const d = await makeDevice(server);
      devices.push(d);
      if (started) d.engine.start();
      stops.push(watchTitleRests(d.tree, d.docs));
      const parentTitle = `${'Notas de producción '.repeat(25)}`.trim().slice(0, 495);
      const name = `${parentTitle} (Spanish)`;
      const id = await d.tree.create(null, name);
      if (wait) await new Promise((r) => setTimeout(r, wait));
      await writeNewPage(d.docs, id, [
        { type: 'heading', content: 'Traducción' },
        { type: 'paragraph', content: 'Contenido traducido por el asistente' },
      ] as never);
      for (let i = 0; i < 100 && d.tree.titleRests().length; i++) await new Promise((r) => setTimeout(r, 10));
      const doc = await d.docs.open(id);
      const tx = texts(doc);
      d.docs.close(id);
      expect(tx).toContain('Contenido traducido por el asistente');
      expect(tx).toContain('Traducción');
      expect(tx).toContain('(Spanish)');
      // Lo que sobra del título, una sola vez y arriba de todo.
      expect(tx.filter((t) => t === '(Spanish)')).toHaveLength(1);
      expect(tx[0]).toBe('(Spanish)');
    });
  }
});
