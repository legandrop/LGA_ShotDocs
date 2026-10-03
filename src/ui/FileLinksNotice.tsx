import { locale, useT } from '../i18n';
import '../i18n/lazy/exportPdf';
import type { FileLinkPlan } from '../export/exportLinks';

// El aviso de *Export* cuando los links a los archivos pueden usar un link público (P.30, Docs/Doc_Links_PDF.md, 3.3,
// LF18): nombra la página y el nivel de cada link (con *Can edit*, que deja editar), su vencimiento, que cambiar el
// nivel cambia lo que abren los PDF ya repartidos, y la casilla para usarlo o no.

export function FileLinksNotice({ plan, checked, onChange }: { plan: FileLinkPlan | null; checked: boolean; onChange: (checked: boolean) => void }) {
  const tr = useT();
  if (!plan || plan.links.length === 0) return null;
  return (
    <div className="export-file-links">
      {plan.links.map((l) => (
        <p key={l.pageId}>
          {tr(l.level === 'edit' ? 'exportDialog.fileLinksEdit' : 'exportDialog.fileLinksView', { title: l.title })}
          {l.expiresAt && ` ${tr('exportDialog.fileLinksExpires', { date: new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(new Date(l.expiresAt)) })}`}
        </p>
      ))}
      <p className="muted">{tr('exportDialog.fileLinksLevel')}</p>
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {tr('exportDialog.useFileLinks')}
      </label>
      {!checked && <p className="muted">{tr('exportDialog.fileLinksOff')}</p>}
    </div>
  );
}

/** La casilla viene tildada solo si todos los links son *Can view* (LF18). */
export function fileLinksTickedByDefault(plan: FileLinkPlan | null): boolean {
  return !!plan && plan.links.length > 0 && plan.links.every((l) => l.level === 'comment');
}
