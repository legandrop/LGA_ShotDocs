import { importAttemptFor, newImportReservation, type ImportRunOptions } from '../import/importCommit';
import { normalizeProjectName } from '../sync/tree';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/importCoda';
import { codaProblemText, countComments, findResumable, folderFromFiles, importCoda, importSize, metaJournal } from '../import/codaImport';
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
  const { tree, docs, media, db, dbName, comments, user } = useServices();
  // Se vuelve a dibujar con el estado de la sincronización: así se entera cuando el Drive queda conectado.
  useSyncStatus();
  const [state, job] = useImportJob(tree);
  const { folder, name, resumable, progress, result, error, running: busy } = state;
  const switchTo = useSwitchProject();
  const tr = useT();
  const input = useRef<HTMLInputElement>(null);
  const [free, setFree] = useState<number | null>(null);
  const [commentCount, setCommentCount] = useState(0);
  const folders = canPickFolders();
  const ready = media.enabled && folders;
  const journal = metaJournal(db);
  const attempt = useRef(importAttemptFor(job));

  const size = folder ? importSize(folder) : 0;
  useEffect(() => {
    if (!folder) return;
    let live = true;
    void freeSpace().then((bytes) => live && setFree(bytes));
    void countComments(folder).then((n) => live && setCommentCount(n));
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
      job.set({ folder: null, resumable: null, error: codaProblemText(err, 'job') });
    }
  };

  const start = (intent: ImportRunOptions['intent']) => {
    if (!folder || busy || attempt.current.running) return;
    const sourceKey = folder.manifest.doc.id;
    const projectName = normalizeProjectName(name);
    const pending = attempt.current;
    if (intent !== 'resume') {
      // El reintento de lo mismo sigue con su reserva (nunca crea otro proyecto). Otra carpeta, otro botón u otro
      // nombre es otra importación, con otra reserva.
      if (!pending.reservation || pending.sourceKey !== sourceKey || pending.intent !== intent || pending.reservation.projectName !== projectName) pending.reservation = newImportReservation(sourceKey, projectName);
      pending.sourceKey = sourceKey;
      pending.intent = intent;
    } else pending.intent = intent;
    const options = { projectName, intent, reservation: pending.reservation, generationId: pending.reservation?.generationId };
    pending.running = true;
    const deps = { tree, docs, media, journal, comments, userEmail: user.email || undefined };
    void job.run(async (onProgress) => {
      try {
        return await importCoda(folder, deps, { ...options, onProgress });
      } catch (err) {
        // Con un error, lo que quedó guardado decide qué se ofrece después: seguir e importar a un proyecto nuevo, o
        // Import otra vez. Así cambiar el nombre y reintentar nunca deja sin salida.
        const earlier = await findResumable(folder, { tree, journal }).catch(() => null);
        job.set({ resumable: earlier });
        throw new Error(codaProblemText(err, 'job'));
      }
    }, { beacon: dbName }).finally(() => {
      pending.running = false;
      if (!job.get().error) pending.reservation = undefined;
    });
  };

  const close = () => job.close();
  // Cada archivo una vez, aunque esté en varias páginas (se guarda y se sube una vez, como cuenta el final).
  const files = new Set(folder?.manifest.pages.flatMap((p) => p.media.map((m) => m.file)) ?? []).size;

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
                <p>
                  {tr('import.found', { pages: folder.manifest.pages.length, files, size: formatSize(size) })}
                  {commentCount > 0 && ` ${tr('import.foundComments', { count: commentCount })}`}
                </p>
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
            <p>
              {tr('import.done', { pages: result.pages, files: result.files })}
              {result.comments > 0 && ` ${tr('import.doneComments', { count: result.comments })}`}
            </p>
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
              <button className="primary" disabled={!ready} onClick={() => start('resume')}>
                {tr('import.resume')}
              </button>
              <button className="secondary" disabled={!ready || !name.trim()} onClick={() => start('new')}>
                {tr('import.startOver')}
              </button>
            </>
          ) : (
            <button className="primary" disabled={!ready || !folder || !name.trim() || busy} onClick={() => start('initial')}>
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
