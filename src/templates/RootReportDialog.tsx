import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/templates';
import type { ReportFolderOption } from './dayReportRoot';
import './templates.css';

// La ventana de *On-Set Report* en la raíz del proyecto (Docs/Doc_Plantillas.md, 6.2, D82): el reporte del día no se crea
// sin carpeta. Con una carpeta de reportes ya hecha, esa es la propuesta; si no, una nueva con nombre editable. Enter
// confirma y el foco ya está donde hace falta (el botón, o el nombre de la carpeta nueva).

/** Lo que se eligió: una carpeta que ya está, o una nueva con ese nombre. */
export type RootReportChoice = { folder: string } | { name: string };

interface Props {
  folders: ReportFolderOption[];
  /** El nombre que se propone para la carpeta nueva. */
  defaultName: string;
  /** Crea (o elige) la carpeta, mueve la página y arma el reporte: `false` si no se pudo (la ventana sigue abierta). */
  onConfirm: (choice: RootReportChoice) => Promise<boolean>;
  onClose: () => void;
}

const NEW = '';

export function RootReportDialog({ folders, defaultName, onConfirm, onClose }: Props) {
  const tr = useT();
  const [folder, setFolder] = useState(folders[0]?.id ?? NEW);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
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
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await onConfirm(creating ? { name } : { folder });
    if (!ok) {
      setBusy(false);
      setFailed(true);
    }
  };

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
        <p className="muted">{tr('dayReport.rootText')}</p>
        {folders.length > 0 && (
          <label className="root-report-field">
            <span className="pref-label">{tr('dayReport.rootFolder')}</span>
            <select value={folder} disabled={busy} onChange={(e) => setFolder(e.target.value)} data-root-report="folder">
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
        {failed && (
          <p className="error" role="alert">
            {tr('dayReport.failed')}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            {tr('common.cancel')}
          </button>
          <button type="submit" className="button primary" autoFocus={!creating} disabled={busy} data-root-report="confirm">
            {creating ? tr('dayReport.rootCreate') : tr('dayReport.rootUse')}
          </button>
        </div>
      </form>
    </div>
  );
}
