import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { t, useT } from '../i18n';
import '../i18n/lazy/templates';
import { navigate } from '../router';
import { useTree } from '../services';
import { notify } from '../ui/notice';
import { focusTitle } from '../ui/PageView';
import { insertTemplate, isEmptyPage, type TemplateEditor } from './apply';
import { BUILTIN_IDS, BUILTIN_KINDS, BUILTIN_SLUGS, builtinBlocks, builtinTexts, type BuiltinKind } from './builtin';
import { registerTemplateTarget, takeTemplatesRequest } from './templatesUi';
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

export function TemplateHost({ pageId, doc, editor, editable }: Props) {
  const tree = useTree();
  const tr = useT();
  const empty = useEmpty(doc);
  const [dialog, setDialog] = useState(false);
  const fresh = tree.isFresh(pageId);
  const hasChildren = tree.children(pageId).length > 0;
  const live = useRef({ editable, editor });
  live.current = { editable, editor };

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
    if (takeTemplatesRequest(pageId)) setDialog(true);
  }, [pageId]);

  const apply = useCallback(
    (kind: BuiltinKind) => {
      const { editable: canWrite, editor: current } = live.current;
      // Se vuelve a mirar en el momento: otro dispositivo pudo escribir mientras la ventana estaba abierta.
      if (!canWrite || !current || !isEmptyPage(doc)) return;
      try {
        insertTemplate(current as TemplateEditor, builtinBlocks(kind, tr.lang));
      } catch (err) {
        console.error('No se pudo agregar la plantilla', err);
        notify(t('templates.applyFailed'));
        return;
      }
      setDialog(false);
      const row = tree.get(pageId);
      if (row && row.template_id !== BUILTIN_IDS[kind]) void tree.setPatch(pageId, { template_id: BUILTIN_IDS[kind] });
      void tree.dropFresh(pageId);
      // El título, vacío y con el foco (sección 4.2, paso 5): lo que falta es nombrar la página.
      if (!row?.title) focusTitle();
    },
    [doc, tree, pageId, tr.lang],
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
      {dialog && <TemplatesDialog editable={editable && !!editor} empty={empty} onUse={apply} onClose={() => setDialog(false)} />}
    </>
  );
}

/** La ventana *Templates* (sección 4.1): por ahora, las de fábrica (las propias llegan con la entrega 3). */
function TemplatesDialog({
  editable,
  empty,
  onUse,
  onClose,
}: {
  editable: boolean;
  empty: boolean;
  onUse: (kind: BuiltinKind) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const texts = builtinTexts(tr.lang);
  const blocked = !editable ? tr('templates.readOnly') : !empty ? tr('pageMenu.applyTemplateEmpty') : null;

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
