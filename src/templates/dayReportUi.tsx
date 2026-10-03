import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { navigate, pagePath } from '../router';
import { usePermissions, useTree } from '../services';
import { DayReportIcon } from '../ui/icons';
import { lazyPart, Part } from '../ui/lazyPart';
import { asAction, tipRows } from '../ui/tipRows';
import { dayReportFolderOf, isDayReportShortcut } from './dayReport';
import './dayReport.css';

// El botón *New day report* (Docs/Doc_Plantillas.md, 6.1): arriba a la derecha del título, en la carpeta de reportes y
// en cada reporte de adentro, solo para quien puede crear páginas en la carpeta. Va en la primera carga (es chico); el
// globito, que lee los reportes y escribe el nuevo con el editor, se baja aparte. El atajo (Ctrl/⌘+Alt+Shift+N) vale con
// una de esas páginas abierta, y el menú de la página lo pide por `requestDayReport`.

const DayReportPopover = lazyPart(() => import('./DayReportPopover').then((m) => m.DayReportPopover));

/** El botón de cada página abierta: el menú lo abre por acá. */
const openers = new Map<string, () => void>();
/** *New day report* desde el menú de una página que no estaba abierta: se abre el globito cuando la página está. */
let pending: { pageId: string; at: number } | null = null;
const PENDING_MS = 15_000;

/** *New day report* del menú de la página: con la página abierta, el globito; si no, se abre la página y después. */
export function requestDayReport(pageId: string): void {
  const open = openers.get(pageId);
  if (open) {
    open();
    return;
  }
  pending = { pageId, at: Date.now() };
  navigate(pagePath(pageId));
}

function takeDayReportRequest(pageId: string): boolean {
  if (!pending || pending.pageId !== pageId) return false;
  const fresh = Date.now() - pending.at < PENDING_MS;
  pending = null;
  return fresh;
}

/** El reporte recién creado se abre con el cursor en *Summary* (6.5): lo toma la página al tener el editor. */
const focusRequests = new Set<string>();

export function requestReportFocus(pageId: string): void {
  focusRequests.add(pageId);
}

export function takeReportFocus(pageId: string): boolean {
  return focusRequests.delete(pageId);
}

/** La carpeta donde crearía el reporte esta página, si la persona puede crear ahí (si no, `null`: no hay botón). */
export function useDayReportFolder(pageId: string): string | null {
  const tree = useTree();
  const perms = usePermissions();
  const folder = dayReportFolderOf(tree, pageId);
  if (!folder) return null;
  const row = tree.get(folder);
  return row && perms.canCreateIn(folder, row.workspace_id) ? folder : null;
}

export function DayReportButton({ pageId }: { pageId: string }) {
  const folder = useDayReportFolder(pageId);
  if (!folder) return null;
  return <DayReportControl pageId={pageId} folderId={folder} />;
}

function DayReportControl({ pageId, folderId }: { pageId: string; folderId: string }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  // El globito se baja ya: sin red tiene que estar (la app lo guarda con el resto al instalarse).
  useEffect(() => DayReportPopover.preload(), []);

  useEffect(() => {
    const show = () => setOpen(true);
    openers.set(pageId, show);
    if (takeDayReportRequest(pageId)) show();
    return () => {
      if (openers.get(pageId) === show) openers.delete(pageId);
    };
  }, [pageId]);

  // Ctrl+Alt+Shift+N (⌘⌥⇧N en la Mac) con esta página abierta; otra vez, lo cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || !isDayReportShortcut(e)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <span className="day-report">
      <button
        ref={button}
        type="button"
        className="day-report-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tip={tipRows([{ shortcut: 'newDayReport', action: asAction(tr('dayReport.new')) }])}
        onClick={() => setOpen(!open)}
      >
        <DayReportIcon size={16} />
        <span className="day-report-label">{tr('dayReport.new')}</span>
      </button>
      {open && (
        <Part onClose={() => setOpen(false)}>
          <DayReportPopover folderId={folderId} anchor={button.current} onClose={() => setOpen(false)} />
        </Part>
      )}
    </span>
  );
}
