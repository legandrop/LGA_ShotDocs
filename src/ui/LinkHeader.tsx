import { useT } from '../i18n';
import { useLinkMode } from '../linkMode';
import { useTree } from '../services';

// Arriba de la barra lateral con un link público (Docs/Doc_Link_Publico.md, 3.5): el título de la página compartida y
// de dónde viene. Nunca el nombre del workspace ni el del proyecto (P10), ni el selector de workspaces.
export function LinkHeader() {
  const link = useLinkMode();
  const tree = useTree();
  const tr = useT();
  if (!link) return null;
  const title = tree.get(link.pageId)?.title || link.entry.title || tr('common.untitled');
  return (
    <div className="link-header">
      <strong className="link-header-title">{title}</strong>
      <span className="mono-label link-header-from">{tr('link.shared', { domain: link.domain })}</span>
    </div>
  );
}
