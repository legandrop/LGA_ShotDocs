import * as Y from 'yjs';
import type { Node } from '@tiptap/pm/model';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { PHOTO_MARKUP_MAP } from '../media/markup';
import { PAGE_BASE_CAP, PAGE_MARKUP_CAP, PHOTO_MARKUP_CAP, pageBaseBytes, pageMarkupBytes, photoMarkupBytes } from '../media/markupLimits';
import { writeReplacementMarkup, type ReplacementMarkup } from '../media/markupClipboard';
import { CONTENT_FRAGMENT } from '../sync/structure';
import type { Transaction } from '@tiptap/pm/state';
import { orientedImageSize } from '../media/probe';
import { replacementAspect, replacementMarkup } from '../media/markupClipboard';
import { mediaIdOf, normalizeMime } from '../media/queue';
import { fileKind } from '../media/attachments';
import type { ReplaceIntent } from './photoReplaceIntent';
import type { PhotoReplacement } from './PhotoReplaceSheet';

/** Medir el resultado real fuera del documento vivo: ni ref ni mapa si no entra entero. */
export function replacementFits(doc: Y.Doc, content: Node, fileId: string, plan: ReplacementMarkup): boolean {
  const preview = new Y.Doc();
  try {
    Y.applyUpdate(preview, Y.encodeStateAsUpdate(doc));
    prosemirrorToYXmlFragment(content, preview.getXmlFragment(CONTENT_FRAGMENT));
    const map = preview.getMap<unknown>(PHOTO_MARKUP_MAP);
    writeReplacementMarkup(map, fileId, plan);
    return photoMarkupBytes(map, fileId) <= PHOTO_MARKUP_CAP && pageMarkupBytes(map) <= PAGE_MARKUP_CAP && pageBaseBytes(preview) <= PAGE_BASE_CAP;
  } finally { preview.destroy(); }
}

interface ReplacementRequest {
  file: File; intent: ReplaceIntent; trigger: HTMLElement | null;
  doc: Y.Doc; oldId: string; map: Y.Map<unknown>;
  isCurrent: () => boolean;
  dimensions: () => Promise<{ width: number; height: number } | null>;
  store: (file: File) => Promise<string>;
  prepare: (url: string, name: string) => Transaction | null;
  inContent: (id: string) => boolean;
  isPhoto: (id: string) => boolean;
  commit: (transaction: Transaction, id: string, plan: ReplacementMarkup | null) => boolean;
  watch: (check: () => void, cancel: () => void) => () => void;
  show: (state: PhotoReplacement | null) => void;
  cleanup: () => void;
  canReturnFocus: () => boolean;
}
/** Una decisión explícita pertenece al File que recibió el token; nunca revive tras un resultado tardío. */
export function startPhotoReplacement(request: ReplacementRequest): void {
  const abort = new AbortController();
  let active = true, unwatch = () => {}, ready = false, canKeep = false;
  let oldSize: { width: number; height: number } | null = null, newSize: { width: number; height: number } | null = null;
  const current = () => active && request.intent.isCurrent() && request.isCurrent();
  const cancel = () => {
    if (!active) return;
    active = false; abort.abort(); unwatch(); request.cleanup(); request.intent.release(); request.show(null);
  };
  const show = (phase: PhotoReplacement['phase']) => { if (current()) request.show({ phase, canKeep, trigger: request.trigger, choose, cancel, canReturnFocus: request.canReturnFocus }); else cancel(); };
  const choose = (keep: boolean) => {
    if (!ready || !current() || (keep && !canKeep)) { if (!current()) cancel(); return; }
    ready = false; show('saving');
    void (async () => {
      try {
        if (!current()) { cancel(); return; }
        const url = await request.store(request.file);
        if (!current()) { cancel(); return; }
        const id = mediaIdOf(url);
        const plan = keep ? replacementMarkup(request.map, request.oldId) : null;
        const transaction = request.prepare(url, request.file.name || 'image');
        if (!id || id === request.oldId || request.inContent(id) || [...request.map.keys()].some((key) => key === id || key.startsWith(`${id}/`)) || !transaction || (keep && (!request.isPhoto(id) || !plan || !replacementAspect(plan, oldSize, newSize) || !replacementFits(request.doc, transaction.doc, id, plan)))) { show('failed'); return; }
        // Ningún await entre el snapshot fresco, la guarda final y la transacción única.
        if (!current()) { cancel(); return; }
        if (!request.commit(transaction, id, plan)) { show('failed'); return; }
        cancel();
      } catch { if (current()) show('failed'); else cancel(); }
    })();
  };
  request.intent.onRetire(cancel);
  if (!current()) { cancel(); return; }
  unwatch = request.watch(() => { if (!current()) cancel(); }, cancel);
  show('measuring');
  void (async () => {
    if (fileKind(normalizeMime(request.file.type, request.file.name), request.file.name) !== 'image') { ready = true; show('ready'); return; }
    try {
      [oldSize, newSize] = await Promise.all([request.dimensions(), orientedImageSize(request.file, abort.signal)]);
    } catch { abort.abort(); /* Sin autoridad de medidas no hay Yes; No sigue siendo una decisión explícita. */ }
    if (!current()) { cancel(); return; }
    const plan = replacementMarkup(request.map, request.oldId);
    canKeep = !!plan && replacementAspect(plan, oldSize, newSize);
    ready = true; show('ready');
  })();
}
