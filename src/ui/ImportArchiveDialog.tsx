import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/importArchive';
import { openZip, folderSource, ZipReadError } from '../export/zipReader';
import { useImportJob } from '../import/importJob';
import {
  ArchiveError,
  archiveJournal,
  archiveWeight,
  COMMENTS_PATH,
  findArchiveResumable,
  importArchive,
  MAX_COMMENTS_BYTES,
  openArchive,
  parseArchiveComments,
  type ShotDocsArchive,
} from '../import/shotdocsImport';
import { formatSize } from '../media/fileTrash';
import { useServices, useSyncStatus } from '../services';
import { canPickFolders } from './ImportCodaDialog';
import { detectPlatform, isMobilePlatform } from './install';
import { useSwitchProject } from './project';

// Volver a Shot Docs desde un zip exportado (P.22, entrega 3; Docs/Doc_Exportar.md, sección 3). Se elige el zip con un
// selector de archivo común (anda también en el iPhone) o, en una computadora, la carpeta descomprimida. Todo entra a
// un proyecto NUEVO; las fotos y los archivos quedan en el dispositivo y la sincronización los sube al Drive de este
// workspace. El estado vive en `importJob.ts` (el mismo de la importación de Coda: una a la vez, con sus guardas) y el
// diálogo lo dibuja el Shell (`ImportArchiveHost`). Solo para quien crea proyectos (dueño y admins).

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

/** Pasado esto, en un teléfono o una tableta se recomienda importar desde una computadora (sección 3). */
const PHONE_BIG = 1024 ** 3;

/** Cuántos comentarios vivos trae el archivo (0 si no tiene o no se pueden leer). */
async function countArchiveComments(archive: ShotDocsArchive): Promise<number> {
  if (!archive.source.has(COMMENTS_PATH)) return 0;
  try {
    const threads = parseArchiveComments(JSON.parse(await archive.source.text(COMMENTS_PATH, MAX_COMMENTS_BYTES)));
    const pages = new Set(archive.manifest.pages.map((p) => p.id));
    let n = 0;
    for (const [page, list] of threads) if (pages.has(page)) for (const th of list) n += th.comments.filter((c) => !c.deleted).length;
    return n;
  } catch {
    return 0;
  }
}

export function ImportArchiveDialog() {
  const { tree, docs, media, db, dbName, comments, user } = useServices();
  const status = useSyncStatus();
  const [state, job] = useImportJob(tree);
  const { archive, name, archiveResumable: resumable, progress, archiveResult: result, error, running: busy } = state;
  const switchTo = useSwitchProject();
  const tr = useT();
  const zipInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [free, setFree] = useState<number | null>(null);
  const [commentCount, setCommentCount] = useState(0);
  const folders = canPickFolders();
  const phone = useMemo(() => isMobilePlatform(detectPlatform()), []);
  const journal = archiveJournal(db);
  const weight = archive ? archiveWeight(archive) : null;
  const needsDrive = !!weight && weight.files > 0 && !media.enabled;

  useEffect(() => {
    if (!archive) return;
    let live = true;
    void freeSpace().then((bytes) => live && setFree(bytes));
    void countArchiveComments(archive).then((n) => live && setCommentCount(n));
    return () => {
      live = false;
    };
  }, [archive]);

  const choose = async (open: () => Promise<ShotDocsArchive>) => {
    job.set({ error: null, archive: null, archiveResumable: null });
    setReading(true);
    try {
      const picked = await open();
      const earlier = await findArchiveResumable(picked, { tree, journal });
      job.set({ archive: picked, name: picked.manifest.projectName || picked.manifest.title, archiveResumable: earlier });
    } catch (err) {
      const message =
        err instanceof ArchiveError
          ? err.message
          : err instanceof ZipReadError
            ? new ArchiveError(err.code === 'notZip' ? 'notZip' : err.code === 'tooBig' || err.code === 'tooMany' ? 'tooBig' : 'damaged').message
            : err instanceof Error
              ? err.message
              : String(err);
      job.set({ archive: null, archiveResumable: null, error: message });
    } finally {
      setReading(false);
    }
  };

  const pickZip = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void choose(async () => openArchive(await openZip(file)));
  };
  const pickFolder = (files: FileList | null) => {
    if (files?.length) void choose(() => openArchive(folderSource(Array.from(files))));
  };

  const noRoom = !!weight && free !== null && weight.bytes > free;
  const ready = !!archive && !busy && !reading && !needsDrive && !noRoom;

  const start = (resume: boolean) => {
    if (!archive || busy) return;
    const deps = { tree, docs, media, journal, comments, userEmail: user.email || undefined, schemaVersion: status.schemaVersion ?? null };
    void job.runArchive((onProgress) => importArchive(archive, deps, { projectName: name.trim(), resume, onProgress }), { beacon: dbName });
  };

  const close = () => job.close();
  const summary = archive && weight;

  return (
    <div className="modal-backdrop" onClick={() => !busy && close()}>
      <div className="modal workspaces-dialog" role="dialog" aria-label={tr('importArchive.title')} onClick={(e) => e.stopPropagation()}>
        <h2>{tr('importArchive.title')}</h2>
        {!result && (
          <>
            <p className="muted">{tr('importArchive.text')}</p>
            <input ref={zipInput} type="file" hidden accept=".zip,application/zip,application/x-zip-compressed" onChange={(e) => pickZip(e.target.files)} />
            <input
              ref={dirInput}
              type="file"
              hidden
              // La carpeta descomprimida (los navegadores de computadora).
              {...{ webkitdirectory: '', directory: '' }}
              onChange={(e) => pickFolder(e.target.files)}
            />
            <div className="welcome-actions">
              <button className="secondary" disabled={busy || reading} onClick={() => zipInput.current?.click()}>
                {tr('importArchive.chooseZip')}
              </button>
              {folders && (
                <button className="link" disabled={busy || reading} onClick={() => dirInput.current?.click()}>
                  {tr('importArchive.chooseFolder')}
                </button>
              )}
            </div>
            {reading && (
              <p className="muted" aria-live="polite">
                {tr('importArchive.reading')}
              </p>
            )}
            {summary && (
              <>
                <p>
                  {tr('importArchive.found', { title: archive.manifest.title || archive.manifest.projectName || '—', pages: archive.manifest.pages.length, files: weight.files, size: formatSize(weight.bytes) })}
                  {commentCount > 0 && ` ${tr('importArchive.foundComments', { count: commentCount })}`}
                </p>
                {weight.previews > 0 && <p className="muted">{tr('importArchive.foundPreviews', { count: weight.previews })}</p>}
                {weight.missing > 0 && <p className="muted">{tr('importArchive.foundMissing', { count: weight.missing })}</p>}
                {weight.tooBig > 0 && <p className="error">{tr('importArchive.foundTooBig', { count: weight.tooBig })}</p>}
                {needsDrive && <p className="error">{tr('importArchive.needsDrive')}</p>}
                {free !== null &&
                  (noRoom ? (
                    <p className="error">{tr('importArchive.noRoom', { size: formatSize(weight.bytes), free: formatSize(free) })}</p>
                  ) : (
                    weight.files > 0 && <p className="muted">{tr('importArchive.room', { free: formatSize(free) })}</p>
                  ))}
                {phone && weight.bytes > PHONE_BIG && <p className="error">{tr('importArchive.phoneBig')}</p>}
                {resumable && !busy && (
                  <p>{tr('importArchive.resumeText', { name: resumable.projectName, done: resumable.done, total: resumable.total })}</p>
                )}
                <label className="pref-label" htmlFor="import-archive-name">
                  {tr('importArchive.name')}
                </label>
                <input id="import-archive-name" value={name} maxLength={200} disabled={busy} onChange={(e) => job.set({ name: e.target.value })} />
              </>
            )}
            {progress && busy && (
              <>
                <p className="muted" aria-live="polite">
                  {tr('importArchive.progress', { current: Math.min(progress.done + 1, progress.total), total: progress.total })} {progress.page}
                </p>
                <p className="muted">{tr('importArchive.keepOpen')}</p>
              </>
            )}
          </>
        )}
        {result && (
          <>
            <p>
              {tr('importArchive.done', { pages: result.pages, files: result.files })}
              {result.comments > 0 && ` ${tr('importArchive.doneComments', { count: result.comments })}`}
            </p>
            {result.files > 0 && <p className="muted">{tr('importArchive.uploading')}</p>}
            {result.resumable && <p>{tr('importArchive.canResume')}</p>}
            {result.problems.length > 0 && (
              <>
                <p className="error">{tr('importArchive.problems', { count: result.problems.length })}</p>
                <ul className="muted import-problems">
                  {result.problems.map((p, i) => (
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
              {tr('importArchive.open')}
            </button>
          ) : resumable && !busy ? (
            <>
              <button className="primary" disabled={!ready} onClick={() => start(true)}>
                {tr('importArchive.resume')}
              </button>
              <button className="secondary" disabled={!ready || !name.trim()} onClick={() => start(false)}>
                {tr('importArchive.startOver')}
              </button>
            </>
          ) : (
            <button className="primary" disabled={!ready || !name.trim()} onClick={() => start(false)}>
              {busy ? tr('importArchive.importing') : tr('importArchive.start')}
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
