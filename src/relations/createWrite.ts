import * as Y from 'yjs';
import { unitsFromYDoc } from '../search/extract';
import { builtinBlocks } from '../templates/builtin';
import { writeNewPage } from '../templates/dayReportCreate';
import { listTemplates } from '../templates/own';
import { readOwnTemplate, type OwnTemplateDeps } from '../templates/ownCopy';
import { templateEntity } from './entitySync';

// El contenido de una escena o una locación creada desde el texto (E7, D517): la plantilla propia del proyecto que salió
// de *Scene* o *Location* si hay exactamente una (y se puede leer entera), si no la de fábrica. Se escribe sin pantalla y
// solo agregando (`writeNewPage`), primero en el dispositivo. Va aparte de `createEntity.ts` porque arrastra el esquema
// del editor: se baja recién al crear.

/** Escribe la plantilla del tipo en la página nueva. */
export async function writeEntityTemplate(deps: OwnTemplateDeps, pageId: string, kind: 'scene' | 'location', lang: string): Promise<void> {
  const row = deps.tree.get(pageId);
  if (!row) return;
  const own = listTemplates(deps.tree, row.workspace_id).thisProject.filter((t) => templateEntity(deps.tree, t.row.id) === kind);
  if (own.length === 1) {
    const read = await readOwnTemplate(deps, own[0].row.id, row.workspace_id, { wait: 3000 }).catch(() => null);
    if (read?.status === 'ok') {
      if (deps.tree.get(pageId)?.template_id !== own[0].row.id) await deps.tree.setPatch(pageId, { template_id: own[0].row.id });
      await writeNewPage(deps.docs, pageId, read.blocks, read.collapsed, read.markup);
      return;
    }
  }
  await writeNewPage(deps.docs, pageId, builtinBlocks(kind, lang));
}

/** Lo que dice la página (para *Undo*: solo se deshace si nadie escribió nada después de crearla). */
export function contentSignature(doc: Y.Doc): string {
  return JSON.stringify(unitsFromYDoc(doc).map((u) => [u.field, u.text]));
}

/** La firma del contenido de una página, abriéndola y cerrándola. */
export async function pageSignature(docs: OwnTemplateDeps['docs'], pageId: string): Promise<string> {
  const doc = await docs.open(pageId);
  try {
    return contentSignature(doc);
  } finally {
    docs.close(pageId);
  }
}
