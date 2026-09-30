import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/importCoda';
import { findResumable, folderFromFiles, importCoda, importSize, metaJournal } from '../import/codaImport';
import { useImportJob } from '../import/importJob';
import { formatSize } from '../media/fileTrash';
import { useServices, useSyncStatus } from '../services';
import { useSwitchProject } from './project';

// Importar un doc de Coda (Docs/Doc_Importar_Coda.md): se elige la carpeta que arma
// `scripts/coda-export.mjs` y todo entra a un proyecto nuevo. Las fotos quedan en el dispositivo y la
// sincronización las sube al Drive como cualquier otra. El estado vive en `importJob.ts` y el diálogo lo
// dibuja el Shell (`ImportCodaHost`), así nada se pierde si se desmonta el selector de proyectos.

/** Elegir una carpeta entera: los navegadores de escritorio sí; Safari del iPad y del iPhone, no. */
export function canPickFolders(): boolean {
  if (typeof document === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return !ios && 'webkitdirectory' in document.createElement('input');
}

/** Lo que el navegador deja guardar todavía a la app, en bytes (`null` si no lo dice). */
async function freeSpace(): Promise<number | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.quota) return null;
    return Math.max(0, estimate.quota - (estimate.usage ?? 0));
  } catch {
    return null;
  }
}

export function ImportCodaDialog() {
  const { tree, docs, media, db, dbName } = useServices();
  // Se vuelve a dibujar con el estado de la sincronización: así se entera cuando el Drive queda conectado.
  useSyncStatus();
  const [state, job] = useImportJob(tree);
  const { folder, name, resumable, progress, result, error, running: busy } = state;
  const switchTo = useSwitchProject();
  const tr = useT();
  const input = useRef<HTMLInputElement>(null);
  const [free, setFree] = useState<number | null>(null);
  const folders = canPickFolders();
  const ready = media.enabled && folders;
  const journal = metaJournal(db);

  const size = folder ? importSize(folder) : 0;
  useEffect(() => {
    if (!folder) return;
    let live = true;
    void freeSpace().then((bytes) => live && setFree(bytes));
    return () => {
      live = false;
    };
  }, [folder]);

  const choose = async (files: FileList | null) => {
    job.set({ error: null });
    if (!files?.length) return;
    try {
      const picked = await folderFromFiles(files);
      const earlier = await findResumable(picked, { tree, journal });
      job.set({ folder: picked, name: picked.manifest.doc.name, resumable: earlier });
    } catch (err) {
      job.set({ folder: null, resumable: null, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const start = (resume: boolean) => {
    if (!folder || busy) return;
    void job.run((onProgress) => importCoda(folder, { tree, docs, media, journal }, { projectName: name.trim(), resume, onProgress }), {
      beacon: dbName,
    });
  };

  const close = () => job.close();
  const files = folder?.manifest.pages.reduce((n, p) => n + p.media.length, 0) ?? 0;

  return (
    <div className="modal-backdrop" onClick={() => !busy && close()}>
      <div className="modal workspaces-dialog" role="dialog" aria-label={tr('import.title')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('import.title')}</h2>
        {!result && (
          <>
            <p className="muted">{tr('import.text')}</p>
            {!media.enabled ? (
              <p className="error">{tr('import.needsDrive')}</p>
            ) : (
              !folders && <p className="error">{tr('import.noFolders')}</p>
            )}
            <input
              ref={input}
              type="file"
              hidden
              // Elegir una carpeta entera (todos los navegadores de escritorio lo entienden).
              {...{ webkitdirectory: '', directory: '' }}
              onChange={(e) => void choose(e.target.files)}
            />
            <button className="secondary" disabled={busy || !ready} onClick={() => input.current?.click()}>
              {folder ? tr('import.chooseOther') : tr('import.choose')}
            </button>
            {folder && (
              <>
                <p>{tr('import.found', { pages: folder.manifest.pages.length, files, size: formatSize(size) })}</p>
                {free !== null &&
                  (size > free ? (
                    <p className="error">{tr('import.noRoom', { size: formatSize(size), free: formatSize(free) })}</p>
                  ) : (
                    <p className="muted">{tr('import.room', { free: formatSize(free) })}</p>
                  ))}
                {resumable && !busy && (
                  <p>{tr('import.resumeText', { name: resumable.projectName, done: resumable.done, total: resumable.total })}</p>
                )}
                <label className="pref-label" htmlFor="import-name">
                  {tr('project.newName')}
                </label>
                <input id="import-name" value={name} maxLength={200} disabled={busy} onChange={(e) => job.set({ name: e.target.value })} />
              </>
            )}
            {progress && busy && (
              <>
                <p className="muted" aria-live="polite">
                  {tr('import.progress', { current: Math.min(progress.done + 1, progress.total), total: progress.total })} {progress.page}
                </p>
                <p className="muted">{tr('import.keepOpen')}</p>
              </>
            )}
          </>
        )}
        {result && (
          <>
            <p>{tr('import.done', { pages: result.pages, files: result.files })}</p>
            <p className="muted">{tr('import.uploading')}</p>
            {result.resumable && <p>{tr('import.canResume')}</p>}
            {result.problems.length > 0 && (
              <>
                <p className="error">{tr('import.problems', { count: result.problems.length })}</p>
                <ul className="muted">
                  {result.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </>
            )}
            {result.exportProblems.length > 0 && (
              <>
                <p>{tr('import.exportProblems', { count: result.exportProblems.length })}</p>
                <ul className="muted">
                  {result.exportProblems.map((p, i) => (
                    <li key={i}>{p}</li>
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
                close();
                switchTo(result.projectId);
              }}
            >
              {tr('import.open')}
            </button>
          ) : resumable && !busy ? (
            <>
              <button className="primary" disabled={!ready} onClick={() => start(true)}>
                {tr('import.resume')}
              </button>
              <button className="secondary" disabled={!ready || !name.trim()} onClick={() => start(false)}>
                {tr('import.startOver')}
              </button>
            </>
          ) : (
            <button className="primary" disabled={!ready || !folder || !name.trim() || busy} onClick={() => start(false)}>
              {busy ? tr('import.importing') : tr('import.start')}
            </button>
          )}
          {!result && (
            <button className="link" disabled={busy} onClick={close}>
              {tr('common.cancel')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
