import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/templates';
import { dayName } from './dayReport';
import type { ReportFolderOption } from './dayReportRoot';
import './templates.css';

// La ventana de *On-Set Report* en la raíz del proyecto (Docs/Doc_Plantillas.md, 6.2, D82): el reporte del día no se crea
// sin carpeta. Con una carpeta de reportes ya hecha, esa es la propuesta; si no, una nueva con nombre editable. Enter
// confirma y el foco ya está donde hace falta (el botón, o el nombre de la carpeta nueva). Si la carpeta elegida ya tiene
// el reporte de hoy (PL8), lo dice como el globito: Enter lo abre y *Create another* crea otro a propósito.

/** Lo que se eligió: una carpeta que ya está, o una nueva con ese nombre. */
export type RootReportChoice = { folder: string } | { name: string };

/** El reporte de hoy que ya tiene una carpeta: el último de esa fecha y cuántos hay. */
export interface TodayReport {
  id: string;
  date: string;
  day: number | null;
  count: number;
}

interface Props {
  folders: ReportFolderOption[];
  /** La página tiene subpáginas: se mueven con ella adentro de la carpeta. */
  withSubpages?: boolean;
  /** El reporte de hoy de esa carpeta, o `null` si no hay (lee lo guardado en el dispositivo). */
  todayIn?: (folderId: string) => Promise<TodayReport | null>;
  /** Abre el reporte de hoy que ya estaba, sin tocar esta página. */
  onOpen?: (pageId: string) => void;
  /** El nombre que se propone para la carpeta nueva. */
  defaultName: string;
  /** Crea (o elige) la carpeta, mueve la página y arma el reporte: `false` si no se pudo (la ventana sigue abierta). */
  onConfirm: (choice: RootReportChoice) => Promise<boolean>;
  onClose: () => void;
}

const NEW = '';

export function RootReportDialog({ folders, withSubpages, todayIn, onOpen, defaultName, onConfirm, onClose }: Props) {
  const tr = useT();
  const [folder, setFolder] = useState(folders[0]?.id ?? NEW);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Lo que se leyó de la carpeta elegida: mientras no llega, Enter se recuerda y se hace al terminar (como el globito).
  const [today, setToday] = useState<{ folder: string; found: TodayReport | null } | null>(null);
  const [queued, setQueued] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  // Con la carpeta nueva, el cursor en el nombre y el nombre elegido: Enter la crea como está, o se escribe encima.
  useEffect(() => {
    if (folder === NEW) input.current?.select();
  }, [folder]);

  const creating = folder === NEW;
  useEffect(() => {
    if (folder === NEW || !todayIn) return;
    let alive = true;
    todayIn(folder).then(
      (found) => alive && setToday({ folder, found }),
      (err: unknown) => {
        console.error('Reporte del día en la raíz: no se pudo leer la carpeta', err);
        if (alive) setToday({ folder, found: null });
      },
    );
    return () => {
      alive = false;
    };
  }, [folder, todayIn]);
  const checking = !creating && !!todayIn && today?.folder !== folder;
  const existing = !creating && today?.folder === folder ? today.found : null;

  const submit = async (another = false) => {
    if (busy) return;
    if (checking) {
      setQueued(true);
      return;
    }
    if (existing && !another) {
      onOpen?.(existing.id);
      return;
    }
    setBusy(true);
    setFailed(false);
    const ok = await onConfirm(creating ? { name } : { folder });
    if (!ok) {
      setBusy(false);
      setFailed(true);
    }
  };
  useEffect(() => {
    if (!queued || checking) return;
    setQueued(false);
    void submit();
    // `submit` es el de este dibujo, con lo leído de la carpeta ya puesto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, checking]);
  const existsText = !existing
    ? null
    : existing.count > 1
      ? tr('dayReport.several', { count: existing.count, date: existing.date })
      : tr('dayReport.exists', { name: existing.day ? `${dayName(existing.day, tr.lang)} · ${existing.date}` : existing.date });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal root-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tr('dayReport.rootTitle')}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>{tr('dayReport.rootTitle')}</h2>
        <p className="muted">
          {tr('dayReport.rootText')}
          {withSubpages && ` ${tr('dayReport.rootSubpages')}`}
        </p>
        {folders.length > 0 && (
          <label className="root-report-field">
            <span className="pref-label">{tr('dayReport.rootFolder')}</span>
            <select
              value={folder}
              disabled={busy}
              onChange={(e) => {
                // Un Enter recordado era para la carpeta de antes.
                setQueued(false);
                setFolder(e.target.value);
              }}
              data-root-report="folder"
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.parents ? `${f.parents} / ${f.title}` : f.title || tr('common.untitled')}
                </option>
              ))}
              <option value={NEW}>{tr('dayReport.rootNew')}</option>
            </select>
          </label>
        )}
        {creating && (
          <label className="root-report-field">
            <span className="pref-label">{tr('dayReport.rootName')}</span>
            <input
              ref={input}
              type="text"
              value={name}
              maxLength={200}
              autoFocus
              disabled={busy}
              data-root-report="name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {existsText && (
          <p role="status" data-root-report="exists">
            {existsText}
          </p>
        )}
        {failed && (
          <p className="error" role="alert">
            {tr('dayReport.failed')}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            {tr('common.cancel')}
          </button>
          {existing && (
            <button type="button" className="button" disabled={busy} data-root-report="another" onClick={() => void submit(true)}>
              {tr('dayReport.createAnother')}
            </button>
          )}
          <button type="submit" className="button primary" autoFocus={!creating} disabled={busy} data-root-report="confirm">
            {creating ? tr('dayReport.rootCreate') : existing ? tr('dayReport.open') : tr('dayReport.rootUse')}
          </button>
        </div>
      </form>
    </div>
  );
}
