import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { t, useT } from '../i18n';
import '../i18n/lazy/templates';
import type { CarryResult } from '../media/markupClipboard';
import { navigate, pagePath } from '../router';
import { usePermissions, useServices, useTree } from '../services';
import { notify } from '../ui/notice';
import { focusTitle } from '../ui/PageView';
import { insertTemplate, insertTemplateCopy, isEmptyPage, placeAtFirstDatum, placeAtSummary, type TemplateEditor } from './apply';
import { BUILTIN_IDS, BUILTIN_KINDS, BUILTIN_SLUGS, builtinBlocks, builtinTexts, type BuiltinKind } from './builtin';
import { reportTitle } from './dayReport';
import { markReportFolder, planDayReport, reportBlocks, reportsOn, type ReportTemplate } from './dayReportCreate';
import { createReportFolder, reportFolderOptions } from './dayReportRoot';
import { takeReportFocus } from './dayReportUi';
import { builtinOrigin, listTemplates, templateInfo, templatesFolderOf, type OwnTemplate } from './own';
import { customizeBuiltin, readFailureText, readOwnTemplate } from './ownCopy';
import { RootReportDialog, type RootReportChoice, type TodayReport } from './RootReportDialog';
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
  // *On-Set Report* en la raíz del proyecto (6.2, D82): la ventana que ofrece la carpeta de reportes. `template`: la propia
  // con *Use for day reports* que se eligió (ya leída), o `null`: la de fábrica.
  const [rootAsk, setRootAsk] = useState<{ template: ReportTemplate | null } | null>(null);
  // La carpeta que dejó un intento que falló al mover la página: el reintento la usa en vez de crear otra.
  const madeFolder = useRef<string | null>(null);
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
  // Con una plantilla propia con *Use for day reports* (entrega 3), lo mismo con sus bloques: la carpeta queda anotada
  // con esa plantilla, así el próximo *New day report* sale de ella.
  const applyDayReport = useCallback(
    async (template: ReportTemplate | null = null) => {
      const row = tree.get(pageId);
      if (!row?.parent_id) return;
      let blocks;
      let title: string;
      try {
        const plan = await planDayReport({ tree, docs, engine }, { parentId: row.parent_id, projectId: row.workspace_id }, { exclude: pageId });
        blocks = reportBlocks(plan, plan.suggestion, tr.lang, template);
        title = reportTitle(plan.suggestion.date, plan.suggestion.day, tr.lang);
      } catch (err) {
        console.error('Reporte del día: no se pudieron leer los reportes', err);
        blocks = template ? template.blocks : builtinBlocks('onset', tr.lang);
        title = '';
      }
      const { editable: canWrite, editor: current } = live.current;
      // Mientras se leía la carpeta pudo llegar algo (otro dispositivo) o se pudo escribir: se vuelve a mirar.
      if (!canWrite || !current || !isEmptyPage(doc)) return;
      const pageEditor = current as PageEditorLike;
      let carried: CarryResult | null = null;
      try {
        if (template) carried = insertTemplateCopy(pageEditor, doc, { blocks, collapsed: template.collapsed, markup: template.markup });
        else insertTemplate(pageEditor, blocks);
      } catch (err) {
        console.error('No se pudo agregar la plantilla', err);
        notify(t('templates.applyFailed'));
        return;
      }
      setDialog(false);
      const templateId = template?.id ?? BUILTIN_IDS.onset;
      const now = tree.get(pageId);
      const patch: { template_id?: string; title?: string } = {};
      if (now?.template_id !== templateId) patch.template_id = templateId;
      if (now && !now.title && title) patch.title = title;
      if (Object.keys(patch).length) void tree.setPatch(pageId, patch);
      void tree.dropFresh(pageId);
      if (perms.canEditPage(row.parent_id)) void markReportFolder(tree, row.parent_id, template ? template.id : undefined);
      if (template?.removed) notify(t('templates.mediaRemoved', { count: template.removed }));
      if (carried?.skipped.length) notify(t('templates.markupTooMany'));
      placeAtSummary(pageEditor);
      pageEditor.focus?.();
    },
    [tree, docs, engine, perms, pageId, doc, tr.lang],
  );

  // *On-Set Report* (o una propia con *Use for day reports*) en una página de la raíz del proyecto (6.2, D82): no hay
  // reporte sin carpeta. Si la persona puede poner la página en una carpeta de reportes del proyecto, o crear una en la
  // raíz, se le ofrece (`RootReportDialog`); si no, se le dice y no se escribe nada.
  const askRootFolder = useCallback(
    (template: ReportTemplate | null) => {
      const row = tree.get(pageId);
      if (!row) return;
      setDialog(false);
      const canCreate = perms.canManagePage(pageId) && perms.canCreateIn(null, row.workspace_id);
      if (!canCreate && reportFolderOptions(tree, perms, row.workspace_id, pageId).length === 0) {
        notify(t('dayReport.rootBlocked'));
        return;
      }
      setRootAsk({ template });
    },
    [tree, perms, pageId],
  );

  /**
   * Confirma la ventana de la raíz: crea la carpeta (marcada, donde está la página) o toma la elegida, mueve la página
   * adentro y la llena como un reporte del día (`applyDayReport`). Antes de tocar nada se vuelve a mirar que la página
   * siga vacía y en la raíz (otro dispositivo pudo cambiarla). La página es la misma: nada se duplica ni se borra; si algo
   * falla a medias queda una carpeta marcada y vacía, que la próxima vez se ofrece en vez de crear otra.
   */
  const confirmRootFolder = useCallback(
    async (choice: RootReportChoice): Promise<boolean> => {
      const ask = rootAsk;
      const row = tree.get(pageId);
      if (!ask || !row) return true;
      const { editable: canWrite, editor: current } = live.current;
      if (row.parent_id) {
        // Ya está adentro de algo (otro dispositivo la movió): sigue como un reporte de esa carpeta.
        setRootAsk(null);
        await applyDayReport(ask.template);
        return true;
      }
      if (!canWrite || !current || !isEmptyPage(doc)) {
        setRootAsk(null);
        notify(t('pageMenu.applyTemplateEmpty'));
        return true;
      }
      try {
        let folderId: string;
        if ('folder' in choice) {
          folderId = choice.folder;
          if (!reportFolderOptions(tree, perms, row.workspace_id, pageId).some((f) => f.id === folderId)) {
            throw new Error('The folder is not available.');
          }
        } else {
          if (!perms.canManagePage(pageId) || !perms.canCreateIn(null, row.workspace_id)) throw new Error('Needs permission to create pages here.');
          folderId = await createReportFolder(tree, choice.name, row.workspace_id, pageId, t('dayReport.folderName'), madeFolder.current);
          madeFolder.current = folderId;
        }
        await tree.move(pageId, folderId);
      } catch (err) {
        console.error('Reporte del día en la raíz: no se pudo preparar la carpeta', err);
        return false;
      }
      setRootAsk(null);
      madeFolder.current = null;
      await applyDayReport(ask.template);
      return true;
    },
    [rootAsk, tree, perms, pageId, doc, applyDayReport],
  );

  // El reporte de hoy que ya tiene la carpeta elegida en la ventana de la raíz (PL8): se avisa antes de crear otro del
  // mismo día. Sale de lo guardado en el dispositivo, sin leer la plantilla de la carpeta; uno en la papelera no cuenta
  // (la lectura recorre las páginas vivas de la carpeta).
  const todayInFolder = useCallback(
    async (folderId: string): Promise<TodayReport | null> => {
      const folder = tree.get(folderId);
      if (!folder) return null;
      const plan = await planDayReport(
        { tree, docs, engine },
        { parentId: folderId, projectId: folder.workspace_id },
        { exclude: pageId, skipTemplate: true },
      );
      const date = plan.suggestion.date;
      const found = reportsOn(plan, date);
      const last = found.at(-1);
      return last ? { id: last.id, date, day: last.day, count: found.length } : null;
    },
    [tree, docs, engine, pageId],
  );

  // Después de agregar una plantilla común (de fábrica o propia), el foco. Con título, a la página (el cursor ya quedó
  // en el primer dato); sin título, al título vacío (4.2, paso 5), y mientras no se escriba ahí, Ctrl/Cmd+Z en el título
  // saca la plantilla (y Ctrl/Cmd+Shift+Z la devuelve).
  const focusAfterInsert = useCallback(
    (pageEditor: PageEditorLike) => {
      if (tree.get(pageId)?.title) {
        pageEditor.focus?.();
        return;
      }
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
    [tree, pageId],
  );

  // Una plantilla propia que no terminó de bajar (4.2, paso 1; O2): nunca se copia a medias. *Wait* la usa sola al llegar.
  const [notReady, setNotReady] = useState<string | null>(null);
  const [waitFor, setWaitFor] = useState<string | null>(null);

  /** Usa una plantilla propia (4.2): una copia en memoria, sin las fotos de otro proyecto. `missing`: no terminó de bajar. */
  const applyOwn = useCallback(
    async (templateId: string, options: { wait?: number } = {}): Promise<'missing' | void> => {
      const row = tree.get(pageId);
      if (!row) return;
      const read = await readOwnTemplate({ tree, docs, engine }, templateId, row.workspace_id, options);
      if (read.status === 'missing') {
        setNotReady(templateId);
        return 'missing';
      }
      setNotReady(null);
      setWaitFor(null);
      if (read.status !== 'ok') {
        notify(readFailureText(read.status));
        return;
      }
      if (templateInfo(read.row).dayReport) {
        const template = { id: templateId, blocks: read.blocks, collapsed: read.collapsed, markup: read.markup, removed: read.removed };
        if (row.parent_id) await applyDayReport(template);
        else askRootFolder(template);
        return;
      }
      const { editable: canWrite, editor: current } = live.current;
      // Se vuelve a mirar en el momento: otro dispositivo pudo escribir mientras se leía la plantilla.
      if (!canWrite || !current || !isEmptyPage(doc)) return;
      const pageEditor = current as PageEditorLike;
      let carried: CarryResult | null = null;
      try {
        carried = insertTemplateCopy(pageEditor, doc, { blocks: read.blocks, collapsed: read.collapsed, markup: read.markup });
      } catch (err) {
        console.error('No se pudo agregar la plantilla', err);
        notify(t('templates.applyFailed'));
        return;
      }
      setDialog(false);
      if (tree.get(pageId)?.template_id !== templateId) void tree.setPatch(pageId, { template_id: templateId });
      void tree.dropFresh(pageId);
      if (read.removed) notify(t('templates.mediaRemoved', { count: read.removed }));
      if (carried?.skipped.length) notify(t('templates.markupTooMany'));
      focusAfterInsert(pageEditor);
    },
    [tree, docs, engine, pageId, doc, applyDayReport, askRootFolder, focusAfterInsert],
  );

  // *Wait*: se vuelve a intentar bajar la plantilla mientras la ventana siga abierta; al llegar, se usa.
  useEffect(() => {
    if (!waitFor || !dialog) return;
    let alive = true;
    void (async () => {
      while (alive) {
        const result = await applyOwn(waitFor, { wait: 5000 }).catch(() => 'missing' as const);
        if (result !== 'missing' || !alive) return;
        await new Promise((r) => setTimeout(r, 2000));
      }
    })();
    return () => {
      alive = false;
    };
  }, [waitFor, dialog, applyOwn]);
  useEffect(() => {
    if (dialog) return;
    setNotReady(null);
    setWaitFor(null);
  }, [dialog]);

  /** *Customize* (5.3): una copia de la de fábrica en *Templates*, que se abre para editarla. */
  const customize = useCallback(
    async (kind: BuiltinKind) => {
      const row = tree.get(pageId);
      if (!row) return;
      try {
        const id = await customizeBuiltin({ tree, docs, engine }, kind, row.workspace_id, tr.lang);
        setDialog(false);
        navigate(pagePath(id));
      } catch (err) {
        console.error('Personalizar plantilla: no se pudo', err);
        notify(t('templates.customizeFailed'));
      }
    },
    [tree, docs, engine, pageId, tr.lang],
  );

  const apply = useCallback(
    (kind: BuiltinKind) => {
      const { editable: canWrite, editor: current } = live.current;
      // Se vuelve a mirar en el momento: otro dispositivo pudo escribir mientras la ventana estaba abierta.
      if (!canWrite || !current || !isEmptyPage(doc)) return;
      const row = tree.get(pageId);
      if (kind === 'onset' && row) {
        if (row.parent_id) void applyDayReport();
        else askRootFolder(null);
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
      focusAfterInsert(pageEditor);
    },
    [doc, tree, pageId, tr.lang, applyDayReport, askRootFolder, focusAfterInsert],
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
      {rootAsk && (
        <RootReportDialog
          folders={rootFolders(tree, perms, pageId)}
          withSubpages={hasChildren}
          todayIn={todayInFolder}
          onOpen={(id) => {
            setRootAsk(null);
            navigate(pagePath(id));
          }}
          defaultName={tr('dayReport.folderName')}
          onConfirm={confirmRootFolder}
          onClose={() => setRootAsk(null)}
        />
      )}
      {dialog && (
        <TemplatesDialog
          pageId={pageId}
          blocked={blockedReason({ complete, editor: !!editor, editable, empty }, tr)}
          onUse={apply}
          onUseOwn={(id) => void applyOwn(id)}
          onCustomize={(kind) => void customize(kind)}
          notReady={notReady}
          waiting={!!waitFor}
          onWait={() => notReady && setWaitFor(notReady)}
          onClose={() => setDialog(false)}
        />
      )}
    </>
  );
}

/** Las carpetas de reportes que ofrece la ventana de la raíz: las del proyecto de la página adonde se la puede mover. */
function rootFolders(tree: ReturnType<typeof useTree>, perms: ReturnType<typeof usePermissions>, pageId: string) {
  const row = tree.get(pageId);
  return row ? reportFolderOptions(tree, perms, row.workspace_id, pageId) : [];
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

/**
 * La ventana *Templates* (sección 4.1): *Built-in* (con *Preview* y *Customize*), *This project* y *Other projects* (las
 * propias que la persona ve, con su descripción; *Open* para cambiarlas, que son páginas). Una de otro proyecto se usa sin
 * sus fotos y archivos (PL10). Si una propia no terminó de bajar, el aviso con *Wait* y, si salió de una de fábrica,
 * *Use built-in*.
 */
function TemplatesDialog({
  pageId,
  blocked,
  onUse,
  onUseOwn,
  onCustomize,
  notReady,
  waiting,
  onWait,
  onClose,
}: {
  pageId: string;
  blocked: string | null;
  onUse: (kind: BuiltinKind) => void;
  onUseOwn: (id: string) => void;
  onCustomize: (kind: BuiltinKind) => void;
  notReady: string | null;
  waiting: boolean;
  onWait: () => void;
  onClose: () => void;
}) {
  const tr = useT();
  const tree = useTree();
  const perms = usePermissions();
  const texts = builtinTexts(tr.lang);
  const projectId = tree.get(pageId)?.workspace_id ?? tree.workspaceId;
  const lists = listTemplates(tree, projectId, pageId);
  const folder = templatesFolderOf(tree, projectId);
  const canCustomize = folder ? perms.canCreateIn(folder.id, projectId) : perms.canCreateIn(null, projectId);
  const fallback = builtinOrigin(notReady ? tree.get(notReady) : undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const useButton = (onClick: () => void, autoFocus = false) => (
    <button
      className="primary"
      autoFocus={autoFocus && !blocked}
      aria-disabled={blocked ? true : undefined}
      data-tip={blocked ?? undefined}
      onClick={() => !blocked && onClick()}
    >
      {tr('templates.use')}
    </button>
  );

  const ownItem = ({ row, info }: OwnTemplate) => (
    <li key={row.id} data-template-page={row.id}>
      <div className="templates-item-text">
        <strong>{row.title || tr('common.untitled')}</strong>
        {info.description && <span className="muted">{info.description}</span>}
      </div>
      <div className="templates-item-actions">
        <button
          className="link"
          data-tip={tr('templates.openTip')}
          onClick={() => {
            onClose();
            navigate(pagePath(row.id));
          }}
        >
          {tr('templates.open')}
        </button>
        {useButton(() => onUseOwn(row.id))}
      </div>
    </li>
  );

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
                  className="link"
                  data-customize={kind}
                  aria-disabled={canCustomize ? undefined : true}
                  data-tip={canCustomize ? tr('templates.customizeTip') : tr('templates.createBlocked')}
                  onClick={() => canCustomize && onCustomize(kind)}
                >
                  {tr('templates.customize')}
                </button>
                {useButton(() => onUse(kind), i === 0)}
              </div>
            </li>
          ))}
        </ul>
        {lists.thisProject.length > 0 && (
          <>
            <p className="menu-label mono-label">{tr('templates.thisProject')}</p>
            <ul className="templates-list">{lists.thisProject.map(ownItem)}</ul>
          </>
        )}
        {lists.others.length > 0 && (
          <>
            <p className="menu-label mono-label">{tr('templates.otherProjects')}</p>
            {lists.others.map(({ project, templates }) => (
              <div key={project.id} className="templates-project" data-project={project.id}>
                <p className="templates-project-name">{project.name}</p>
                <ul className="templates-list">{templates.map(ownItem)}</ul>
              </div>
            ))}
          </>
        )}
        {notReady && (
          <div className="templates-waiting" role="status">
            <p>{waiting ? tr('templates.waiting') : tr('templates.notDownloaded')}</p>
            {!waiting && (
              <div className="templates-item-actions">
                <button onClick={onWait}>{tr('templates.wait')}</button>
                {fallback && (
                  <button className="primary" onClick={() => onUse(fallback)}>
                    {tr('templates.useBuiltIn')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {blocked && <p className="muted">{blocked}</p>}
        <p className="muted small">{tr('templates.copyNote')}</p>
        <div className="modal-actions">
          <button onClick={onClose}>{tr('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
