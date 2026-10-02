import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { t, useT } from '../i18n';
import '../i18n/lazy/templates';
import { navigate } from '../router';
import { usePermissions, useServices, useTree } from '../services';
import { notify } from '../ui/notice';
import { focusTitle } from '../ui/PageView';
import { insertTemplate, isEmptyPage, placeAtFirstDatum, placeAtSummary, type TemplateEditor } from './apply';
import { BUILTIN_IDS, BUILTIN_KINDS, BUILTIN_SLUGS, builtinBlocks, builtinTexts, type BuiltinKind } from './builtin';
import { reportTitle } from './dayReport';
import { markReportFolder, planDayReport, reportBlocks } from './dayReportCreate';
import { takeReportFocus } from './dayReportUi';
import { armTitleUndo, registerTemplateTarget, takeTemplatesRequest } from './templatesUi';
import './templates.css';

// Las plantillas en una página abierta (Docs/Doc_Plantillas.md, sección 4, entregas 0 y 1): la tira *Start from a
// template* debajo del título de una página vacía recién creada en este dispositivo, y la ventana *Templates* (la
// abren *More…* y *Apply template…* del menú de la página). Usar una plantilla agrega sus bloques antes del primer
// bloque de la página con el editor visible, así entra en su deshacer, y anota `template_id` en la página. Nada se
// borra, nada pasa por la red: la página y su contenido se guardan en el dispositivo y suben después.

interface Props {
  pageId: string;
  doc: Y.Doc;
  /** El editor de la página (null mientras se monta). */
  editor: unknown;
  /** El editor se puede escribir: la página está completa en el dispositivo y la persona la puede editar. */
  editable: boolean;
  /** El contenido de la página está entero en el dispositivo (si no, todavía se está bajando). */
  complete: boolean;
}

/** Lo que el editor de BlockNote hace además de agregar: llevar el foco, deshacer y rehacer. */
interface PageEditorLike extends TemplateEditor {
  focus?(): void;
  undo?(): void;
  redo?(): void;
}

/** Se vuelve a leer con cada cambio del documento: escribir en la página la saca de "vacía". */
function useEmpty(doc: Y.Doc): boolean {
  const [empty, setEmpty] = useState(() => isEmptyPage(doc));
  useEffect(() => {
    const check = () => setEmpty(isEmptyPage(doc));
    check();
    doc.on('update', check);
    return () => doc.off('update', check);
  }, [doc]);
  return empty;
}

export function TemplateHost({ pageId, doc, editor, editable, complete }: Props) {
  const tree = useTree();
  const { docs, engine } = useServices();
  const perms = usePermissions();
  const tr = useT();
  const empty = useEmpty(doc);
  const [dialog, setDialog] = useState(false);
  const fresh = tree.isFresh(pageId);
  const hasChildren = tree.children(pageId).length > 0;
  const live = useRef({ editable, editor });
  live.current = { editable, editor };
  // *Apply template…* desde la barra lateral sobre una página que no estaba abierta: se decide cuando terminó de cargar.
  const [requested, setRequested] = useState(false);
  // Ctrl/⌘+Z en el título justo después de elegir (templatesUi.ts): se suelta al salir de la página.
  const titleUndo = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      titleUndo.current?.();
      titleUndo.current = null;
    },
    [pageId],
  );

  // Una página recién creada que ya tiene contenido deja de ofrecer plantillas (también si se escribió en otra
  // pestaña o llegó algo de otro dispositivo).
  useEffect(() => {
    if (fresh && !empty) void tree.dropFresh(pageId);
  }, [fresh, empty, tree, pageId]);

  // *Apply template…* desde el menú de la página (con la página abierta, o recién abierta desde la barra lateral).
  useEffect(
    () =>
      registerTemplateTarget(pageId, {
        empty: () => isEmptyPage(doc),
        open: () => setDialog(true),
      }),
    [pageId, doc],
  );
  useEffect(() => {
    if (takeTemplatesRequest(pageId)) setRequested(true);
  }, [pageId]);
  // Sin la página abierta el menú no sabía si estaba vacía. Ya cargada: vacía, la ventana; con contenido, el aviso de
  // por qué no (en vez de una ventana con los *Use* apagados).
  useEffect(() => {
    if (!requested || !complete || (editable && !editor)) return;
    setRequested(false);
    if (editable && !isEmptyPage(doc)) notify(t('pageMenu.applyTemplateEmpty'));
    else setDialog(true);
  }, [requested, complete, editor, editable, doc]);

  // El reporte del día recién creado (*New day report*) se abre con el cursor en *Summary* (6.5).
  useEffect(() => {
    if (!editor || !editable || !takeReportFocus(pageId)) return;
    const pageEditor = editor as PageEditorLike;
    placeAtSummary(pageEditor);
    pageEditor.focus?.();
  }, [editor, editable, pageId]);

  // *On-Set Report* en una página vacía adentro de otra (6.2): es un reporte del día. Se llena con la fecha, el día y lo
  // del reporte anterior de la carpeta, toma el título `2026-10-02 | Day 01` si no tenía, y la carpeta queda marcada (si
  // la persona la puede editar; si no, se deduce por el reporte de adentro).
  const applyDayReport = useCallback(async () => {
    const row = tree.get(pageId);
    if (!row?.parent_id) return;
    let blocks;
    let title: string;
    try {
      const plan = await planDayReport({ tree, docs, engine }, { parentId: row.parent_id, projectId: row.workspace_id }, { exclude: pageId });
      blocks = reportBlocks(plan, plan.suggestion, tr.lang);
      title = reportTitle(plan.suggestion.date, plan.suggestion.day, tr.lang);
    } catch (err) {
      console.error('Reporte del día: no se pudieron leer los reportes', err);
      blocks = builtinBlocks('onset', tr.lang);
      title = '';
    }
    const { editable: canWrite, editor: current } = live.current;
    // Mientras se leía la carpeta pudo llegar algo (otro dispositivo) o se pudo escribir: se vuelve a mirar.
    if (!canWrite || !current || !isEmptyPage(doc)) return;
    const pageEditor = current as PageEditorLike;
    try {
      insertTemplate(pageEditor, blocks);
    } catch (err) {
      console.error('No se pudo agregar la plantilla', err);
      notify(t('templates.applyFailed'));
      return;
    }
    setDialog(false);
    const now = tree.get(pageId);
    const patch: { template_id?: string; title?: string } = {};
    if (now?.template_id !== BUILTIN_IDS.onset) patch.template_id = BUILTIN_IDS.onset;
    if (now && !now.title && title) patch.title = title;
    if (Object.keys(patch).length) void tree.setPatch(pageId, patch);
    void tree.dropFresh(pageId);
    if (perms.canEditPage(row.parent_id)) void markReportFolder(tree, row.parent_id);
    placeAtSummary(pageEditor);
    pageEditor.focus?.();
  }, [tree, docs, engine, perms, pageId, doc, tr.lang]);

  const apply = useCallback(
    (kind: BuiltinKind) => {
      const { editable: canWrite, editor: current } = live.current;
      // Se vuelve a mirar en el momento: otro dispositivo pudo escribir mientras la ventana estaba abierta.
      if (!canWrite || !current || !isEmptyPage(doc)) return;
      const row = tree.get(pageId);
      if (kind === 'onset' && row?.parent_id) {
        void applyDayReport();
        return;
      }
      const pageEditor = current as PageEditorLike;
      try {
        insertTemplate(pageEditor, builtinBlocks(kind, tr.lang));
      } catch (err) {
        console.error('No se pudo agregar la plantilla', err);
        notify(t('templates.applyFailed'));
        return;
      }
      setDialog(false);
      if (row && row.template_id !== BUILTIN_IDS[kind]) void tree.setPatch(pageId, { template_id: BUILTIN_IDS[kind] });
      void tree.dropFresh(pageId);
      // En la raíz del proyecto no hay carpeta de reportes (6.2): la página queda como una plantilla común.
      if (kind === 'onset') notify(t('dayReport.atRoot'));
      if (row?.title) {
        // Con título, el foco va a la página: el cursor ya quedó en el primer dato de la ficha (insertTemplate).
        pageEditor.focus?.();
        return;
      }
      // El título, vacío y con el foco (sección 4.2, paso 5): lo que falta es nombrar la página. Mientras no se
      // escriba ahí, Ctrl/⌘+Z en el título saca la plantilla (y Ctrl/⌘+Shift+Z la devuelve).
      titleUndo.current?.();
      titleUndo.current = armTitleUndo(pageId, (redo) => {
        if (!redo) {
          pageEditor.undo?.();
          return;
        }
        pageEditor.redo?.();
        // Rehacer devuelve la selección que guardó el deshacer (el pie, o el rótulo de la ficha tras dos vueltas):
        // Enter en el título tiene que seguir llevando al primer dato.
        placeAtFirstDatum(pageEditor);
      });
      focusTitle();
    },
    [doc, tree, pageId, tr.lang, applyDayReport],
  );

  const strip = fresh && empty && editable && !!editor && !hasChildren;
  const names = builtinTexts(tr.lang).names;
  return (
    <>
      {strip && (
        <div className="template-strip" role="group" aria-label={tr('templates.start')}>
          <span className="template-strip-label mono-label">{tr('templates.start')}</span>
          <div className="template-strip-items">
            {BUILTIN_KINDS.map((kind) => (
              <button key={kind} className="template-chip" data-template={kind} onClick={() => apply(kind)}>
                {names[kind]}
              </button>
            ))}
            <button className="template-chip more" onClick={() => setDialog(true)}>
              {tr('templates.more')}
            </button>
          </div>
        </div>
      )}
      {dialog && (
        <TemplatesDialog
          blocked={blockedReason({ complete, editor: !!editor, editable, empty }, tr)}
          onUse={apply}
          onClose={() => setDialog(false)}
        />
      )}
    </>
  );
}

/**
 * Por qué los *Use* de la ventana están apagados (null: se pueden usar). Mientras la página se baja, o el editor de
 * quien puede editar se monta, es eso y no "no podés editar".
 */
export function blockedReason(
  state: { complete: boolean; editor: boolean; editable: boolean; empty: boolean },
  tr: (key: 'templates.loading' | 'templates.readOnly' | 'pageMenu.applyTemplateEmpty') => string,
): string | null {
  if (!state.complete || (state.editable && !state.editor)) return tr('templates.loading');
  if (!state.editable) return tr('templates.readOnly');
  if (!state.empty) return tr('pageMenu.applyTemplateEmpty');
  return null;
}

/** La ventana *Templates* (sección 4.1): por ahora, las de fábrica (las propias llegan con la entrega 3). */
function TemplatesDialog({
  blocked,
  onUse,
  onClose,
}: {
  blocked: string | null;
  onUse: (kind: BuiltinKind) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const texts = builtinTexts(tr.lang);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal templates-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tr('templates.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{tr('templates.title')}</h2>
        <p className="menu-label mono-label">{tr('templates.builtIn')}</p>
        <ul className="templates-list">
          {BUILTIN_KINDS.map((kind, i) => (
            <li key={kind} data-template={kind}>
              <div className="templates-item-text">
                <strong>{texts.names[kind]}</strong>
                <span className="muted">{texts.descriptions[kind]}</span>
              </div>
              <div className="templates-item-actions">
                <button
                  className="link"
                  data-tip={tr('templates.previewTip')}
                  onClick={() => {
                    onClose();
                    navigate(`/practice?template=${BUILTIN_SLUGS[kind]}`);
                  }}
                >
                  {tr('templates.preview')}
                </button>
                <button
                  className="primary"
                  autoFocus={i === 0 && !blocked}
                  aria-disabled={blocked ? true : undefined}
                  data-tip={blocked ?? undefined}
                  onClick={() => !blocked && onUse(kind)}
                >
                  {tr('templates.use')}
                </button>
              </div>
            </li>
          ))}
        </ul>
        {blocked && <p className="muted">{blocked}</p>}
        <p className="muted small">{tr('templates.copyNote')}</p>
        <div className="modal-actions">
          <button onClick={onClose}>{tr('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
