import { createExtension } from '@blocknote/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { t } from '../i18n';
import { linkedPageId } from '../search/extract';
import { openQuestions, sceneTitleOf } from './dayLive';
import { goToPlace } from './goToPlace';
import type { LiveSource, Place } from './liveView';

// En el editor de un reporte del día (Docs/Doc_Relaciones.md, sección 11; maqueta `d_escribir.html`): debajo de un título
// de escena con link («Escena 105_029», el que deja *Prepare*), la pregunta abierta de su desglose (el título de la escena
// en vivo, al final del título, lo pone `relUnderline.ts`). Son decoraciones de ProseMirror: no están en el documento, no
// se sincronizan, no se copian ni se imprimen. Así un invitado del día no lee el desglose en el reporte.

export interface DayDecoScene {
  title: string;
  question: { text: string; shot: string; cat: string; place: Place } | null;
}

export interface DayDecoInfo {
  /** Lo que se muestra para el link a una página de escena (o `null` si no es una escena que la persona ve). */
  scene(pageId: string): DayDecoScene | null;
  go(place: Place): void;
}

const key = new PluginKey<DecorationSet>('shotdocs-day-decorations');
const REFRESH = 'shotdocs-day-decorations-refresh';
const QUESTION_CHARS = 160;
const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : text);

const HELP_ICON =
  '<svg class="lh-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14M12 17h.01"/></svg>';

function questionWidget(q: NonNullable<DayDecoScene['question']>, go: (place: Place) => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'lh-qcall';
  el.contentEditable = 'false';
  el.dataset.tip = t('day.questionCallTip');
  el.setAttribute('role', 'button');
  el.tabIndex = -1;
  el.innerHTML = HELP_ICON;
  const body = document.createElement('div');
  const head = document.createElement('b');
  head.textContent = t('day.questionFrom');
  body.append(head);
  const where = [q.shot, q.cat].filter(Boolean).join(' · ');
  if (where) body.append(` · ${where}`);
  body.append(document.createElement('br'), short(q.text, QUESTION_CHARS));
  el.append(body);
  // Antes que el editor: tocarla no mueve el cursor, lleva a la ficha.
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    go(q.place);
  });
  return el;
}

function build(doc: PMNode, info: DayDecoInfo | null): DecorationSet {
  if (!info) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'blockGroup' || node.type.name === 'doc') return true;
    if (node.type.name !== 'blockContainer') return false;
    const content = node.firstChild;
    if (!content || content.type.name !== 'heading') return true;
    const start = pos + 1;
    const kids: { node: PMNode; offset: number }[] = [];
    content.forEach((child, offset) => kids.push({ node: child, offset }));
    const hrefOf = (n: PMNode): unknown => n.marks.find((m) => m.type.name === 'link')?.attrs.href;
    for (let i = 0; i < kids.length; i++) {
      const href = hrefOf(kids[i].node);
      const id = href ? linkedPageId(href) : null;
      const scene = id ? info.scene(id) : null;
      if (!scene) continue;
      // El título de la escena en vivo lo dibuja el subrayado (relUnderline.ts), en cualquier página y al final del
      // título: lo escrito después del link se lee antes que él (O4 de la auditoría de E5).
      const q = scene.question;
      if (q) {
        decos.push(
          Decoration.widget(start + content.nodeSize, () => questionWidget(q, info.go), {
            side: -1,
            ignoreSelection: true,
            key: `lq:${id}:${q.text}:${q.shot}:${q.cat}`,
          }),
        );
      }
      break;
    }
    return true;
  });
  return DecorationSet.create(doc, decos);
}

/** Lo que muestra el editor de un reporte, armado con la foto del índice de relaciones (o `null` si no es un día). */
export function dayDecoInfo(src: LiveSource | null, pageId: string, go: (place: Place) => void): DayDecoInfo | null {
  if (!src) return null;
  const role = src.snap.registration.roles.get(pageId);
  if (!role || role.excluded || role.entity?.kind !== 'day') return null;
  const byPage = new Map<string, string>();
  for (const e of src.snap.registry.scenes.values()) if (e.pageId) byPage.set(e.pageId, e.code);
  const memo = new Map<string, DayDecoScene | null>();
  return {
    scene(id) {
      if (memo.has(id)) return memo.get(id)!;
      const code = byPage.get(id);
      const title = src.title(id);
      let out: DayDecoScene | null = null;
      if (code && title !== undefined) {
        const q = openQuestions(src, [code])[0];
        out = { title: sceneTitleOf(title), question: q ? { text: q.text, shot: q.shot, cat: q.cat, place: q.place } : null };
      }
      memo.set(id, out);
      return out;
    },
    go,
  };
}

/** La extensión del editor. `get` devuelve lo de la foto más nueva; `refreshDayDecorations` la vuelve a leer. */
export function dayDecorationsExtension(get: () => DayDecoInfo | null) {
  const plugin = new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state: EditorState) => build(state.doc, get()),
      apply: (tr, set, _old, state) => (tr.getMeta(REFRESH) || tr.docChanged ? build(state.doc, get()) : set),
    },
    props: { decorations: (state) => key.getState(state) },
  });
  return createExtension({ key: 'shotdocs-day-decorations', prosemirrorPlugins: [plugin] });
}

export function refreshDayDecorations(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(REFRESH, true).setMeta('addToHistory', false));
}

/** Para ir a la ficha desde la pregunta (lo usa `PageEditor`). */
export const goFrom = (services: Parameters<typeof goToPlace>[0]) => (place: Place) => goToPlace(services, place);
