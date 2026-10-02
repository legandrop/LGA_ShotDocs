import { useEffect, useRef, useState } from 'react';
import { t, useT } from '../i18n';
import '../i18n/lazy/templates';
import { navigate, pagePath } from '../router';
import { usePermissions, useServices, useTree } from '../services';
import { useFloating } from '../ui/menus';
import { notify } from '../ui/notice';
import { dayName, isValidDate, localDate } from './dayReport';
import { createDayReport, planDayReport, reportsOn, type DayReportPlan } from './dayReportCreate';
import { requestReportFocus } from './dayReportUi';

// El globito del reporte del día (Docs/Doc_Plantillas.md, 6.3): la fecha de hoy (hora del dispositivo), el día de
// rodaje siguiente y la locación del último reporte, ya puestos y editables; Enter crea. Si ya hay uno con esa fecha
// (PL8), Enter lo abre y *Create another* crea otro. Todo sale del dispositivo: anda sin red.

interface Props {
  /** La carpeta de reportes. */
  folderId: string;
  anchor: HTMLElement | null;
  onClose: () => void;
}

export function DayReportPopover({ folderId, anchor, onClose }: Props) {
  const { docs, engine } = useServices();
  const tree = useTree();
  const perms = usePermissions();
  const tr = useT();
  const ref = useRef<HTMLFormElement>(null);
  useFloating(ref, onClose, anchor);
  const [plan, setPlan] = useState<DayReportPlan | null>(null);
  const [date, setDate] = useState(() => localDate());
  const [day, setDay] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;

  // La propuesta: se lee una vez al abrir (lo que se escribe en los campos manda desde ahí).
  useEffect(() => {
    let cancelled = false;
    const folder = tree.get(folderId);
    if (!folder) return;
    void planDayReport({ tree, docs, engine }, { parentId: folderId, projectId: folder.workspace_id })
      .then((next) => {
        if (cancelled) return;
        setPlan(next);
        setDate(next.suggestion.date);
        setDay(String(next.suggestion.day));
        setLocation(next.suggestion.location);
      })
      .catch((err) => {
        console.error('Reporte del día: no se pudieron leer los reportes', err);
        if (!cancelled) {
          notify(t('dayReport.failed'));
          close.current();
        }
      });
    return () => {
      cancelled = true;
    };
    // Solo al abrir: el árbol cambia con cada sincronización y volver a leer pisaría lo que se está escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  const validDate = isValidDate(date);
  // Lo que ya está en la carpeta con esa fecha (en el árbol de ahora: uno borrado mientras tanto no cuenta).
  const existing = plan && validDate ? reportsOn(plan, date).filter((r) => tree.get(r.id) && !tree.isTrashed(r.id)) : [];
  const dayNumber = Number.parseInt(day, 10);
  const validDay = Number.isInteger(dayNumber) && dayNumber > 0 && dayNumber < 10000;

  const create = async () => {
    if (!plan || busy || !validDate || !validDay) return;
    setBusy(true);
    try {
      const id = await createDayReport(
        { tree, docs, engine },
        plan,
        { date, day: dayNumber, location: location.replace(/\s+/g, ' ').trim() },
        tr.lang,
        { canMark: perms.canEditPage(folderId) },
      );
      onClose();
      requestReportFocus(id);
      navigate(pagePath(id));
    } catch (err) {
      console.error('Reporte del día: no se pudo crear', err);
      notify(t('dayReport.failed'));
      setBusy(false);
    }
  };

  const openExisting = () => {
    const target = existing.at(-1);
    if (!target) return;
    onClose();
    navigate(pagePath(target.id));
  };

  const existsText =
    existing.length > 1
      ? tr('dayReport.several', { count: existing.length, date })
      : existing.length === 1
        ? tr('dayReport.exists', { name: existing[0].day ? `${dayName(existing[0].day, tr.lang)} · ${date}` : date })
        : null;

  return (
    <form
      ref={ref}
      className="day-report-popover"
      role="dialog"
      aria-label={tr('dayReport.new')}
      onSubmit={(e) => {
        e.preventDefault();
        if (existing.length) openExisting();
        else void create();
      }}
    >
      <h2>{tr('dayReport.new')}</h2>
      <div className="day-report-row">
        <label className="day-report-field">
          <span className="pref-label">{tr('dayReport.date')}</span>
          <input type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="day-report-field">
          <span className="pref-label">{tr('dayReport.day')}</span>
          <input type="number" inputMode="numeric" min={1} max={9999} value={day} required onChange={(e) => setDay(e.target.value)} />
        </label>
      </div>
      <label className="day-report-field">
        <span className="pref-label">{tr('dayReport.location')}</span>
        <input type="text" value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
      </label>
      {plan?.lastIncomplete && <p className="notice-line warn">{tr('dayReport.incomplete')}</p>}
      {existsText && (
        <p className="notice-line" role="status">
          {existsText}
        </p>
      )}
      {!plan && <p className="notice-line">{tr('dayReport.loading')}</p>}
      <div className="day-report-actions">
        {existing.length > 0 && (
          <button type="button" disabled={!plan || busy || !validDay} onClick={() => void create()}>
            {tr('dayReport.createAnother')}
          </button>
        )}
        <button type="submit" className="primary" disabled={!plan || busy || !validDate || (!existing.length && !validDay)}>
          {existing.length ? tr('dayReport.open') : tr('dayReport.create')}
        </button>
      </div>
    </form>
  );
}
