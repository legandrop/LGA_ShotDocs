import { useRef, useState } from 'react';
import { useT } from '../i18n';
import { folderFromFiles, importCoda, type CodaFolder, type ImportProgress, type ImportResult } from '../import/codaImport';
import { useServices } from '../services';
import { useSwitchProject } from './project';

// Importar un doc de Coda (Docs/Doc_Importar_Coda.md): se elige la carpeta que arma
// `scripts/coda-export.mjs` y todo entra a un proyecto nuevo. Las fotos quedan en el dispositivo y la
// sincronización las sube al Drive como cualquier otra.

export function ImportCodaDialog({ onClose }: { onClose: () => void }) {
  const { tree, docs, media } = useServices();
  const switchTo = useSwitchProject();
  const tr = useT();
  const input = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState<CodaFolder | null>(null);
  const [name, setName] = useState('');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null && result === null && error === null;

  const choose = async (files: FileList | null) => {
    setError(null);
    if (!files?.length) return;
    try {
      const picked = await folderFromFiles(files);
      setFolder(picked);
      setName(picked.manifest.doc.name);
    } catch (err) {
      setFolder(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const start = async () => {
    if (!folder || busy) return;
    setError(null);
    setProgress({ done: 0, total: folder.manifest.pages.length, page: '' });
    try {
      setResult(await importCoda(folder, { tree, docs, media }, { projectName: name.trim(), onProgress: setProgress }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const files = folder?.manifest.pages.reduce((n, p) => n + p.media.length, 0) ?? 0;

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal workspaces-dialog" role="dialog" aria-label={tr('import.title')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('import.title')}</h2>
        {!result && (
          <>
            <p className="muted">{tr('import.text')}</p>
            <input
              ref={input}
              type="file"
              hidden
              // Elegir una carpeta entera (todos los navegadores de escritorio lo entienden).
              {...{ webkitdirectory: '', directory: '' }}
              onChange={(e) => void choose(e.target.files)}
            />
            <button className="secondary" disabled={busy} onClick={() => input.current?.click()}>
              {folder ? tr('import.chooseOther') : tr('import.choose')}
            </button>
            {folder && (
              <>
                <p>{tr('import.found', { pages: folder.manifest.pages.length, files })}</p>
                <label className="pref-label" htmlFor="import-name">
                  {tr('project.newName')}
                </label>
                <input id="import-name" value={name} maxLength={200} disabled={busy} onChange={(e) => setName(e.target.value)} />
              </>
            )}
            {progress && !error && (
              <p className="muted" aria-live="polite">
                {tr('import.progress', { done: progress.done, total: progress.total })} {progress.page}
              </p>
            )}
          </>
        )}
        {result && (
          <>
            <p>{tr('import.done', { pages: result.pages, files: result.files })}</p>
            <p className="muted">{tr('import.uploading')}</p>
            {result.problems.length > 0 && (
              <>
                <p className="error">{tr('import.problems', { count: result.problems.length })}</p>
                <ul className="muted">
                  {result.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="welcome-actions">
          {result ? (
            <button
              className="primary"
              onClick={() => {
                onClose();
                switchTo(result.projectId);
              }}
            >
              {tr('import.open')}
            </button>
          ) : (
            <button className="primary" disabled={!folder || !name.trim() || busy} onClick={() => void start()}>
              {busy ? tr('import.importing') : tr('import.start')}
            </button>
          )}
          {!result && (
            <button className="link" disabled={busy} onClick={onClose}>
              {tr('common.cancel')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
