import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t, useT } from '../i18n';
import '../i18n/lazy/templates';
import { navigate, pagePath } from '../router';
import { usePermissions, useServices, useTree } from '../services';
import { useFloating } from '../ui/menus';
import { notify } from '../ui/notice';
import { builtinTexts } from './builtin';
import { dayName, isValidDate, localDate } from './dayReport';
import {
  createDayPlan,
  createDayReport,
  DayReportWriteError,
  planDayReport,
  plansOn,
  reportsOn,
  resolveReportTemplate,
  suggestedDay,
  suggestedPlanDate,
  suggestedPlanDay,
  planProposal,
  type DayReportPlan,
  type ReportTemplate,
  type ReportTemplateNotice,
} from './dayReportCreate';
import { dayReportTemplates } from './own';
import { requestReportFocus } from './dayReportUi';

// El globito del reporte del día (Docs/Doc_Plantillas.md, 6.3): la fecha de hoy (hora del dispositivo), el día de
// rodaje siguiente y la locación del último reporte, ya puestos y editables; Enter crea. Si ya hay uno con esa fecha
// (PL8), Enter lo abre y *Create another* crea otro. Todo sale del dispositivo: anda sin red.
// Arriba, *Day report* o *Day plan* (D813): el plan de jornada va en la misma carpeta, justo arriba del reporte de su
// fecha, con el mismo nombre y « | Plan»; propone hoy si todavía no tiene reporte y si no mañana, sin locación (la de
// ayer no sirve para mañana) y sin copiar nada.

export type DayPageKind = 'report' | 'plan';

interface Props {
  /** La carpeta de reportes. */
  folderId: string;
  anchor: HTMLElement | null;
  onClose: () => void;
  /** Con qué se abre: el reporte (botón y atajo) o el plan (*New day plan* del menú). */
  initialKind?: DayPageKind;
  /** La página desde la que se abre: si es un plan, el reporte propone su fecha, su día y su lugar (`planProposal`). */
  fromId?: string;
}

export function DayReportPopover({ folderId, anchor, onClose, initialKind = 'report', fromId }: Props) {
  const { docs, engine } = useServices();
  const tree = useTree();
  const perms = usePermissions();
  const tr = useT();
  const ref = useRef<HTMLFormElement>(null);
  // El foco va a la fecha, no a las pestañas *Day report* / *Day plan* de arriba.
  useFloating(ref, onClose, anchor, false, false);
  useLayoutEffect(() => ref.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }), []);
  const [plan, setPlan] = useState<DayReportPlan | null>(null);
  const [date, setDate] = useState(() => localDate());
  const [day, setDay] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  // Lo que la persona ya tocó mientras se leía la carpeta no se pisa con la propuesta.
  const touched = useRef({ date: false, day: false, location: false });
  const dateNow = useRef(date);
  dateNow.current = date;
  // Enter antes de que termine de leer la carpeta (O3): se recuerda y se hace apenas llega la propuesta.
  const [queued, setQueued] = useState(false);
  // La página que dejó un intento que no pudo escribir el contenido (O4): el reintento la usa en vez de crear otra.
  const failedPage = useRef<string | undefined>(undefined);
  const failedPlan = useRef<string | undefined>(undefined);
  // La plantilla (entrega 3): la de la carpeta, o la que se elija si hay más de una a mano. `null`: la de fábrica.
  const [choice, setChoice] = useState<{ id: string | null; template: ReportTemplate | null; notice: ReportTemplateNotice | null } | null>(null);
  const [reading, setReading] = useState(false);
  const [kind, setKind] = useState<DayPageKind>(initialKind);
  const kindNow = useRef(kind);
  kindNow.current = kind;

  // La propuesta: se lee una vez al abrir (lo que se escribe en los campos manda desde ahí).
  useEffect(() => {
    let cancelled = false;
    const folder = tree.get(folderId);
    if (!folder) return;
    void planDayReport({ tree, docs, engine }, { parentId: folderId, projectId: folder.workspace_id })
      .then((next) => {
        if (cancelled) return;
        setPlan(next);
        setChoice({ id: next.template?.id ?? null, template: next.template, notice: next.templateNotice });
        propose(next, kindNow.current);
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

  /** La propuesta para el reporte o el plan, sin pisar lo que la persona ya tocó. */
  function propose(next: DayReportPlan, as: DayPageKind) {
    const t = touched.current;
    // Abierto desde un plan cuya fecha todavía no tiene reporte: el reporte de ese plan (simulación de D813).
    const fromPlan = as === 'report' && fromId ? planProposal(tree, fromId, next) : null;
    const own = fromPlan ? fromPlan.date : as === 'plan' ? suggestedPlanDate(next, next.suggestion.date) : next.suggestion.date;
    const chosen = t.date && isValidDate(dateNow.current) ? dateNow.current : own;
    if (!t.date) setDate(chosen);
    const planDay = fromPlan && chosen === fromPlan.date ? fromPlan.day : null;
    if (!t.day) setDay(String(planDay ?? (as === 'plan' ? suggestedPlanDay(next, chosen) : suggestedDay(next, chosen))));
    if (!t.location) setLocation(as === 'plan' ? '' : fromPlan && chosen === fromPlan.date && fromPlan.location ? fromPlan.location : next.suggestion.location);
  }

  const switchKind = (next: DayPageKind) => {
    if (next === kind) return;
    setKind(next);
    if (plan) propose(plan, next);
  };

  const validDate = isValidDate(date);
  // Lo que ya está en la carpeta con esa fecha (en el árbol de ahora: uno borrado mientras tanto no cuenta).
  const existing =
    plan && validDate ? (kind === 'plan' ? plansOn(plan, date) : reportsOn(plan, date)).filter((r) => tree.get(r.id) && !tree.isTrashed(r.id)) : [];
  const dayNumber = Number.parseInt(day, 10);
  const validDay = Number.isInteger(dayNumber) && dayNumber > 0 && dayNumber < 10000;

  const create = async () => {
    if (!plan || busy || reading || !validDate || !validDay) return;
    setBusy(true);
    if (kind === 'plan') {
      try {
        const id = await createDayPlan({ tree, docs, engine }, plan, { date, day: dayNumber, location: location.replace(/\s+/g, ' ').trim() }, tr.lang, {
          reuse: failedPlan.current,
        });
        onClose();
        navigate(pagePath(id));
      } catch (err) {
        console.error('Plan del día: no se pudo crear', err);
        if (err instanceof DayReportWriteError) failedPlan.current = err.pageId;
        notify(t('dayReport.planFailed'));
        setBusy(false);
      }
      return;
    }
    try {
      const id = await createDayReport(
        { tree, docs, engine },
        plan,
        { date, day: dayNumber, location: location.replace(/\s+/g, ' ').trim() },
        tr.lang,
        {
          canMark: perms.canEditPage(folderId),
          reuse: failedPage.current,
          placeTyped: touched.current.location,
          template: choice?.template ?? null,
          // La de la carpeta que no se pudo usar (O4) no se pisa: se anota solo una que se usó o la que se eligió.
          markTemplate: choice?.notice ? undefined : (choice?.template?.id ?? null),
          // Como al usar una plantilla en una página abierta: se dice en pantalla, no solo en la consola.
          onMarkupSkipped: () => notify(t('templates.markupTooMany')),
        },
      );
      if (choice?.template?.removed) notify(t('templates.mediaRemoved', { count: choice.template.removed }));
      onClose();
      requestReportFocus(id);
      navigate(pagePath(id));
    } catch (err) {
      console.error('Reporte del día: no se pudo crear', err);
      if (err instanceof DayReportWriteError) failedPage.current = err.pageId;
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

  const submit = () => {
    if (!plan) {
      setQueued(true);
      return;
    }
    if (existing.length) openExisting();
    else void create();
  };
  useEffect(() => {
    if (!plan || !queued) return;
    setQueued(false);
    submit();
    // `submit` es el de este dibujo, con la propuesta ya puesta en los campos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, queued]);

  // Las plantillas de reporte a mano: la de fábrica y las propias con *Use for day reports* que la persona ve (6.3: el
  // selector sale solo si hay más de una).
  const projectId = tree.get(folderId)?.workspace_id ?? tree.workspaceId;
  const onsetName = builtinTexts(tr.lang).names.onset;
  const options = [
    { id: '', name: onsetName },
    ...dayReportTemplates(tree, projectId).map((o) => {
      const project = o.row.workspace_id !== projectId ? tree.project(o.row.workspace_id)?.name : undefined;
      return { id: o.row.id, name: `${o.row.title || tr('common.untitled')}${project ? ` · ${project}` : ''}` };
    }),
  ];
  // La de la carpeta, aunque se le haya sacado *Use for day reports* después: sigue siendo la elegida.
  if (choice?.id && !options.some((o) => o.id === choice.id)) {
    options.push({ id: choice.id, name: tree.get(choice.id)?.title || tr('common.untitled') });
  }
  const choose = async (id: string) => {
    if (!id) {
      setChoice({ id: null, template: null, notice: null });
      return;
    }
    setReading(true);
    try {
      const next = await resolveReportTemplate({ tree, docs, engine }, id, projectId);
      setChoice({ id, ...next });
    } finally {
      setReading(false);
    }
  };
  const noticeText: Record<ReportTemplateNotice, string> = {
    notShared: tr('dayReport.templateNotShared', { name: onsetName }),
    gone: tr('dayReport.templateGone', { name: onsetName }),
    missing: tr('dayReport.templateMissing', { name: onsetName }),
    newer: tr('dayReport.templateNewer', { name: onsetName }),
  };

  const existsName = existing.length === 1 ? (existing[0].day ? `${dayName(existing[0].day, tr.lang)} · ${date}` : date) : '';
  const existsText =
    existing.length > 1
      ? tr(kind === 'plan' ? 'dayReport.planSeveral' : 'dayReport.several', { count: existing.length, date })
      : existing.length === 1
        ? tr(kind === 'plan' ? 'dayReport.planExists' : 'dayReport.exists', { name: existsName })
        : null;
  const heading = tr(kind === 'plan' ? 'dayReport.newPlan' : 'dayReport.new');

  return (
    <form
      ref={ref}
      className="day-report-popover"
      role="dialog"
      aria-label={heading}
      // Los campos se validan acá (la fecha y el día): mientras se lee la carpeta el día está vacío y Enter se recuerda.
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div
        className="day-report-kinds"
        role="tablist"
        // ←/→ cambian de pestaña, como en cualquier lista de pestañas.
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const next = kind === 'report' ? 'plan' : 'report';
          switchKind(next);
          e.currentTarget.querySelector<HTMLElement>(`[data-kind="${next}"]`)?.focus();
        }}
      >
        {(['report', 'plan'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            data-kind={k}
            aria-selected={kind === k}
            tabIndex={kind === k ? 0 : -1}
            className={kind === k ? 'on' : undefined}
            disabled={busy}
            onClick={() => switchKind(k)}
          >
            {tr(k === 'plan' ? 'dayReport.newPlan' : 'dayReport.new')}
          </button>
        ))}
      </div>
      <div className="day-report-row">
        <label className="day-report-field">
          <span className="pref-label">{tr('dayReport.date')}</span>
          <input
            type="date"
            value={date}
            required
            onChange={(e) => {
              touched.current.date = true;
              setDate(e.target.value);
              // El día que va con esa fecha (O1): el del reporte (o el plan) que ya la tiene, o el siguiente al último.
              if (plan && !touched.current.day && isValidDate(e.target.value))
                setDay(String(kind === 'plan' ? suggestedPlanDay(plan, e.target.value) : suggestedDay(plan, e.target.value)));
            }}
          />
        </label>
        <label className="day-report-field">
          <span className="pref-label">{tr('dayReport.day')}</span>
          <input type="number" inputMode="numeric" min={1} max={9999} value={day} required onChange={(e) => {
              touched.current.day = true;
              setDay(e.target.value);
            }}
          />
        </label>
      </div>
      <label className="day-report-field">
        <span className="pref-label">{tr('dayReport.location')}</span>
        <input type="text" value={location} maxLength={200} onChange={(e) => {
            touched.current.location = true;
            setLocation(e.target.value);
          }}
        />
      </label>
      {plan && kind === 'report' && options.length > 1 && (
        <label className="day-report-field">
          <span className="pref-label">{tr('dayReport.template')}</span>
          <select value={choice?.id ?? ''} disabled={reading || busy} onChange={(e) => void choose(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'report' && choice?.notice && <p className="notice-line warn">{noticeText[choice.notice]}</p>}
      {kind === 'report' && plan?.lastIncomplete && <p className="notice-line warn">{tr('dayReport.incomplete')}</p>}
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
        <button
          type="submit"
          className="primary"
          // Mientras se lee la carpeta queda habilitado: Enter se recuerda y se hace al terminar (O3).
          disabled={busy || (!!plan && (!validDate || (!existing.length && !validDay)))}
        >
          {existing.length ? tr('dayReport.open') : tr('dayReport.create')}
        </button>
      </div>
    </form>
  );
}
