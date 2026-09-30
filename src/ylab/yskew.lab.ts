// @vitest-environment jsdom
// Two app versions (schemas) on the same page: the published schema lacks the `rowWidth` image prop.
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/y';
import { afterEach, it } from 'vitest';
import * as Y from '@y/y';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { schema } from '../ui/editorSchema';
import { schema as mainSchema } from '../ui/fixtures/editorSchemaMain';
import { ROW_WIDTH_PROP } from '../ui/imageRowsEditor';
import { editors, net, seeded, tick, yXml } from './yh';
afterEach(() => { for (const e of editors.splice(0)) e.unmount(); document.body.replaceChildren(); });
function mountWith(doc: Y.Doc, s: unknown): BlockNoteEditor {
  const e = BlockNoteEditor.create(withCollaboration({ schema: s as typeof schema, collaboration: { fragment: doc.get(CONTENT_FRAGMENT), user: { name: 'u', color: '#000' } } })) as unknown as BlockNoteEditor;
  const el = document.createElement('div'); document.body.appendChild(el); e.mount(el); editors.push(e); return e;
}
it('version skew over the network', async () => {
  const a = seeded(), b = seeded();
  const nw = net(a, b, 'async');
  const NEW = mountWith(a, schema);
  NEW.replaceBlocks(NEW.document, [{ type: 'image', props: { url: 'https://example.com/1.jpg', previewWidth: 300, [ROW_WIDTH_PROP]: 0.5 } } as never]);
  nw.flush(); await tick();
  const step = () => { for (const [to, u] of nw.n.queue.splice(0)) Y.applyUpdate(to, u, 'remote'); };
  const before = { a: nw.n.sentA, b: nw.n.sentB };
  const OLD = mountWith(b, mainSchema);
  await tick();
  console.log('old editor opened: writes by old =', nw.n.sentB - before.b, '| Y (old side):', yXml(b).replace(/ (backgroundColor|textColor|textAlignment|caption|name|showPreview|url)="[^"]*"/g, ''));
  let rounds = 0;
  for (; rounds < 50 && nw.n.queue.length; rounds++) { step(); await tick(1); }
  console.log(`after ${rounds} flush rounds: writes A(new)=${nw.n.sentA - before.a} B(old)=${nw.n.sentB - before.b}, queue left ${nw.n.queue.length}`);
  console.log('Y (new side):', yXml(a).replace(/ (backgroundColor|textColor|textAlignment|caption|name|showPreview|url)="[^"]*"/g, ''));
  void OLD;
});
