import { SideMenuExtension, type BlockNoteEditor } from '@blocknote/core';
import {
  BlockColorsItem,
  DragHandleMenu,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtensionState,
  type BlockTypeSelectItem,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useServices } from '../services';
import { blockIdOf } from './carrete';
import {
  answerQuestion,
  blocksChanged,
  clearBlockSource,
  COMMENT_SHORTCUT_LABEL,
  commentOnBlock,
  isCommentShortcut,
  QUESTION_SHORTCUT_LABEL,
  setBlockSource,
  type BlockSource,
} from './commentsUi';
import { paragraphProps, QUESTION_PROP } from './editorSchema';
import { CommentIcon, QuestionIcon } from './icons';

// Lo que el editor suma para los comentarios y las preguntas (paso 10): el ítem "Question" del menú "/" y
// del selector de tipo, el botón "Comment" de la barra de formato y del menú del bloque, y el margen con la
// cantidad de comentarios abiertos de cada bloque y el botón "Answer" de las preguntas. El margen se dibuja
// afuera del documento (encima), así anda también en solo lectura: con el permiso Comentar se comenta y se
// contesta sin poder editar la página.

type AnyEditor = BlockNoteEditor<any, any, any>;

interface BlockLike {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BlockLike[];
}

function flatten(blocks: BlockLike[]): BlockLike[] {
  return blocks.flatMap((b) => [b, ...flatten(b.children ?? [])]);
}

function isQuestion(b: BlockLike): boolean {
  return b.type === 'paragraph' && b.props?.[QUESTION_PROP] === true;
}

function plainText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((c: { type?: string; text?: string; content?: unknown }) =>
      typeof c.text === 'string' ? c.text : c.type === 'link' ? plainText(c.content) : '',
    )
    .join('');
}

// --- Tipos de párrafo --------------------------------------------------------------------------------

/** El ítem "Question" del selector de tipo de la barra de formato. */
export const questionTypeItem: BlockTypeSelectItem = {
  name: 'Question',
  type: 'paragraph',
  props: paragraphProps('question'),
  icon: QuestionIcon as unknown as BlockTypeSelectItem['icon'],
};

/** Los ítems del selector con Script y Question: cada variante del párrafo pide sus dos propiedades. */
export function paragraphVariantItems(items: BlockTypeSelectItem[], script: BlockTypeSelectItem): BlockTypeSelectItem[] {
  return [
    ...items.map((item) => (item.type === 'paragraph' ? { ...item, props: { ...item.props, ...paragraphProps('paragraph') } } : item)),
    { ...script, props: { ...script.props, ...paragraphProps('script') } },
    questionTypeItem,
  ];
}

/** El ítem "Question" del menú "/". */
export function questionSlashItem(editor: AnyEditor): DefaultReactSuggestionItem {
  return {
    title: 'Question',
    subtext: 'A question for the team or the client, answered in comments',
    aliases: ['pregunta', 'duda', 'dudas', 'question', 'ask', 'q'],
    group: 'Basic blocks',
    badge: QUESTION_SHORTCUT_LABEL,
    icon: <QuestionIcon size={18} />,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'paragraph', props: paragraphProps('question') } as never),
  };
}

/** "/Script" y "/Paragraph" sacan la marca de pregunta (y al revés). */
export function withParagraphVariants(item: DefaultReactSuggestionItem, editor: AnyEditor, kind: 'paragraph' | 'script'): DefaultReactSuggestionItem {
  return {
    ...item,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'paragraph', props: paragraphProps(kind) } as never),
  };
}

// --- Botones "Comment" -------------------------------------------------------------------------------

/** El bloque donde está el cursor (o el primero elegido). */
function currentBlockId(editor: AnyEditor): string | null {
  try {
    return editor.getSelection()?.blocks[0]?.id ?? editor.getTextCursorPosition().block.id;
  } catch {
    return null;
  }
}

/** El botón "Comment" de la barra de formato. */
export function CommentToolbarButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label="Comment"
      mainTooltip="Comment"
      secondaryTooltip={COMMENT_SHORTCUT_LABEL}
      icon={<CommentIcon size={18} />}
      onClick={() => commentOnBlock(currentBlockId(editor as AnyEditor))}
    />
  );
}

function CommentMenuItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (s) => s?.block });
  if (!block) return null;
  return (
    <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => commentOnBlock(block.id)}>
      Comment
    </Components.Generic.Menu.Item>
  );
}

/** El menú del bloque (el tirador de la izquierda) de siempre, con "Comment" al final. */
function CommentDragHandleMenu() {
  const dict = useDictionary();
  return (
    <DragHandleMenu>
      <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
      <BlockColorsItem>{dict.drag_handle.colors_menuitem}</BlockColorsItem>
      <TableRowHeaderItem>{dict.drag_handle.header_row_menuitem}</TableRowHeaderItem>
      <TableColumnHeaderItem>{dict.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
      <CommentMenuItem />
    </DragHandleMenu>
  );
}

/** El menú lateral del editor con "Comment" en el menú del bloque. */
export function CommentSideMenuController() {
  return <SideMenuController sideMenu={(props) => <SideMenu {...props} dragHandleMenu={CommentDragHandleMenu} />} />;
}

// --- Los bloques para el panel -------------------------------------------------------------------------

/** El editor le cuenta al panel qué dice cada bloque y en qué orden están. */
export function useBlockSourceRegistration(editor: AnyEditor, pageId: string): void {
  useEffect(() => {
    const src: BlockSource = {
      pageId,
      describe: (id) => {
        let block: BlockLike | undefined;
        try {
          block = editor.getBlock(id) as BlockLike | undefined;
        } catch {
          block = undefined;
        }
        if (!block) return null;
        const text = plainText(block.content) || (block.type === 'image' ? String(block.props?.name || block.props?.caption || 'Image') : '');
        return { text: text || block.type, question: isQuestion(block) };
      },
      order: () => new Map(flatten(editor.document as BlockLike[]).map((b, i) => [b.id, i])),
    };
    setBlockSource(src);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = editor.onChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(blocksChanged, 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      off?.();
      clearBlockSource(src);
    };
  }, [editor, pageId]);
}

// --- El margen -----------------------------------------------------------------------------------------

interface Mark {
  id: string;
  top: number;
  /** Solo las preguntas: dónde va el botón "Answer" (abajo del texto). */
  answer?: { top: number; left: number; count: number; resolved: boolean };
  count: number;
}

/**
 * El margen derecho del editor: la cantidad de comentarios abiertos de cada bloque, el botón "Answer" de
 * las preguntas y, en el bloque que se señala (o se tocó, en el teléfono), un botón para comentarlo.
 * `host` es el contenedor del editor (con `position: relative`).
 */
export function CommentMargin({
  editor,
  pageId,
  canComment,
  host,
}: {
  editor: AnyEditor;
  pageId: string;
  canComment: boolean;
  host: RefObject<HTMLDivElement | null>;
}) {
  const { comments } = useServices();
  const revision = useSyncExternalStore(comments.subscribe, comments.getRevision);
  useEffect(() => comments.watch(pageId), [comments, pageId]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [active, setActive] = useState<{ id: string; top: number } | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const activeRef = useRef<string | null>(null);

  // Se vuelve a medir con cada cambio del documento, de los comentarios o del tamaño.
  useEffect(() => {
    const bump = () => setLayoutTick((n) => n + 1);
    const off = editor.onChange(bump);
    const el = host.current;
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(bump) : null;
    if (el) resize?.observe(el);
    window.addEventListener('resize', bump);
    document.fonts?.addEventListener?.('loadingdone', bump);
    return () => {
      off?.();
      resize?.disconnect();
      window.removeEventListener('resize', bump);
      document.fonts?.removeEventListener?.('loadingdone', bump);
    };
  }, [editor, host]);

  useLayoutEffect(() => {
    const root = host.current;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const threads = comments.threads(pageId);
    const counts = comments.openCounts(pageId);
    const answers = new Map<string, { count: number; resolved: boolean }>();
    for (const t of threads) {
      if (!t.blockId) continue;
      const prev = answers.get(t.blockId) ?? { count: 0, resolved: true };
      answers.set(t.blockId, { count: prev.count + t.count, resolved: prev.resolved && t.resolved });
    }
    const questions = new Set(flatten(editor.document as BlockLike[]).filter(isQuestion).map((b) => b.id));
    const ids = new Set([...counts.keys(), ...questions]);
    const next: Mark[] = [];
    for (const id of ids) {
      const content = root.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${cssId(id)}"] > .bn-block-content`);
      if (!content) continue;
      const r = content.getBoundingClientRect();
      const mark: Mark = { id, top: r.top - base.top, count: counts.get(id) ?? 0 };
      if (questions.has(id)) {
        const p = content.querySelector<HTMLElement>('p.question-line') ?? content;
        const pr = p.getBoundingClientRect();
        const a = answers.get(id);
        mark.answer = { top: pr.bottom - base.top - 30, left: pr.left - base.left + 32, count: a?.count ?? 0, resolved: !!a && a.count > 0 && a.resolved };
      }
      next.push(mark);
    }
    setMarks((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    // `revision`: cambiaron los comentarios; `layoutTick`: el documento o el tamaño.
  }, [comments, pageId, editor, host, revision, layoutTick]);

  // El bloque que se señala con el mouse, o que se tocó con el dedo: ahí aparece el botón para comentar.
  useEffect(() => {
    const root = host.current;
    if (!root || !canComment) return;
    const pick = (target: EventTarget | null) => {
      const el = target instanceof Element ? target : null;
      if (!el || el.closest('.comment-margin-button')) return;
      const id = blockIdOf(el);
      const container = id ? root.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${cssId(id)}"] > .bn-block-content`) : null;
      if (!id || !container) return;
      activeRef.current = id;
      setActive({ id, top: container.getBoundingClientRect().top - root.getBoundingClientRect().top });
    };
    const onMove = (e: PointerEvent) => pick(e.target);
    // Con el dedo, `pointerleave` llega apenas se levanta: el botón queda en el último bloque tocado.
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      activeRef.current = null;
      setActive(null);
    };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerdown', onMove);
    root.addEventListener('pointerleave', onLeave);
    // Ctrl/⌘+Alt+M: el bloque del cursor, o el que se señaló (en solo lectura no hay cursor).
    const onKey = (e: KeyboardEvent) => {
      if (!isCommentShortcut(e)) return;
      const focused = document.activeElement;
      const inEditor = root.contains(focused);
      // Escribiendo en otro lado (el panel, el título), el atajo no es para el editor.
      if (!inEditor && focused && (focused.tagName === 'TEXTAREA' || focused.tagName === 'INPUT')) return;
      if (!inEditor && !activeRef.current) return;
      e.preventDefault();
      commentOnBlock((inEditor ? currentBlockId(editor) : null) ?? activeRef.current);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerdown', onMove);
      root.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('keydown', onKey);
    };
  }, [host, canComment, editor]);

  const badged = new Set(marks.filter((m) => m.count > 0 && !m.answer).map((m) => m.id));
  return (
    <div className="comment-margin" aria-label="Comments in the margin">
      {marks.map((m) => (
        <span key={m.id} style={{ display: 'contents' }}>
          {m.count > 0 && !m.answer && (
            <button
              className="comment-margin-button comment-count"
              style={{ top: m.top }}
              aria-label={`${m.count} open ${m.count === 1 ? 'comment' : 'comments'} on this block`}
              onClick={() => commentOnBlock(m.id)}
            >
              <CommentIcon size={14} />
              <span>{m.count}</span>
            </button>
          )}
          {m.answer && (canComment || m.answer.count > 0) && (
            <button
              className={`comment-margin-button question-answer${m.answer.count > 0 ? ' answered' : ''}${m.answer.resolved ? ' resolved' : ''}`}
              style={{ top: m.answer.top, left: m.answer.left }}
              onClick={() => answerQuestion(m.id)}
            >
              <CommentIcon size={14} />
              {m.answer.count === 0 ? 'Answer' : `${m.answer.count} ${m.answer.count === 1 ? 'answer' : 'answers'}`}
              {m.answer.resolved && ' · resolved'}
            </button>
          )}
        </span>
      ))}
      {canComment && active && !badged.has(active.id) && !marks.some((m) => m.id === active.id && m.answer) && (
        <button
          className="comment-margin-button comment-add"
          style={{ top: active.top }}
          aria-label="Comment on this block"
          data-tip={`Comment\n${COMMENT_SHORTCUT_LABEL}`}
          onClick={() => commentOnBlock(active.id)}
        >
          <CommentIcon size={15} />
        </button>
      )}
    </div>
  );
}

// Ids de BlockNote: uuid o `initialBlockId`; nada que escapar, pero por las dudas no se arma un selector raro.
function cssId(id: string): string {
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : '__invalid__';
}
