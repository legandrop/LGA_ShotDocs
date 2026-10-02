import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { usePermissions, useTree } from '../services';
import { TemplateIcon } from '../ui/icons';
import { lazyPart, Part } from '../ui/lazyPart';
import { isTemplatePage, isTemplatesFolder, stopUsingAsTemplate, templateInfo, templateMark, templatesFolderOf } from './own';
import './own.css';

// Las plantillas propias en la primera carga (Docs/Doc_Plantillas.md, 5.1 y 5.2): la franja arriba del título de una
// plantilla (*Template settings…* y *Stop using as template*), lo que el menú de la página necesita saber para ofrecer
// *Save as template…*, y el lugar siempre montado que abre las dos ventanas (se bajan aparte, con el editor: guardar
// copia contenido).

const TemplateDialogs = lazyPart(() => import('./TemplateDialogs').then((m) => m.TemplateDialogs));

const OPEN = 'shotdocs:own-templates';

export type OwnTemplatesRequest = { kind: 'save' | 'settings'; pageId: string };

/** *Save as template…* del menú de la página. */
export function openSaveTemplate(pageId: string): void {
  window.dispatchEvent(new CustomEvent<OwnTemplatesRequest>(OPEN, { detail: { kind: 'save', pageId } }));
}

/** *Template settings…* de la franja. */
export function openTemplateSettings(pageId: string): void {
  window.dispatchEvent(new CustomEvent<OwnTemplatesRequest>(OPEN, { detail: { kind: 'settings', pageId } }));
}

/** Las dos ventanas, montadas una vez en el workspace. */
export function OwnTemplatesHost() {
  const [open, setOpen] = useState<OwnTemplatesRequest | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setOpen((e as CustomEvent<OwnTemplatesRequest>).detail);
    window.addEventListener(OPEN, onOpen);
    return () => window.removeEventListener(OPEN, onOpen);
  }, []);
  if (!open) return null;
  return (
    <Part onClose={() => setOpen(null)}>
      <TemplateDialogs request={open} onClose={() => setOpen(null)} />
    </Part>
  );
}

/**
 * Lo que el menú de la página ofrece (5.1): *Save as template…* en una página que no es plantilla ni la carpeta
 * *Templates* (apagado si no se puede crear en *Templates*, o en la raíz del proyecto si hay que crearla), y *Use as
 * template* en una que se dejó de usar.
 */
export function useSaveTemplateOffer(pageId: string): { save: boolean; blocked: boolean; reuse: boolean } {
  const tree = useTree();
  const perms = usePermissions();
  const row = tree.get(pageId);
  if (!row || tree.isTrashed(pageId) || isTemplatesFolder(row) || isTemplatePage(tree, pageId)) {
    return { save: false, blocked: false, reuse: false };
  }
  const folder = templatesFolderOf(tree, row.workspace_id);
  const canCreate = folder ? perms.canCreateIn(folder.id, row.workspace_id) : perms.canCreateIn(null, row.workspace_id);
  return { save: true, blocked: !canCreate, reuse: templateMark(row) === 'off' && perms.canEditPage(pageId) };
}

/**
 * La franja arriba del título de una plantilla (5.2): que es una plantilla y que cambiarla no toca lo ya creado, su
 * descripción, y para quien la puede editar *Template settings…* y *Stop using as template*.
 */
export function TemplateBanner({ pageId }: { pageId: string }) {
  const tree = useTree();
  const perms = usePermissions();
  const tr = useT();
  if (!isTemplatePage(tree, pageId)) return null;
  const info = templateInfo(tree.get(pageId));
  const canEdit = perms.canEditPage(pageId);
  return (
    <div className="banner template-banner" role="note">
      <TemplateIcon />
      <span className="template-banner-text">
        {tr('templateBanner.text')}
        {info.description && <span className="template-banner-description">{info.description}</span>}
      </span>
      {info.dayReport && <span className="template-banner-tag mono-label">{tr('templateBanner.dayReport')}</span>}
      {canEdit && (
        <span className="template-banner-actions">
          <button className="link" onClick={() => openTemplateSettings(pageId)}>
            {tr('templateBanner.settings')}
          </button>
          <button className="link" onClick={() => void stopUsingAsTemplate(tree, pageId)}>
            {tr('templateBanner.stop')}
          </button>
        </span>
      )}
    </div>
  );
}
