import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { locale, localize, useT, type Key } from '../i18n';
import '../i18n/lazy/filesBySize';
import { formatSize } from '../media/fileTrash';
import { FilesBySize, isUnused, pagesOf, sizedKind, type FilePage, type SizedFile, type SizedKind } from '../media/filesBySize';
import { navigate, pagePath } from '../router';
import { usePermissions, useProjectSizes, useServices, useSyncStatus, useTree } from '../services';
import { FileThumb } from './TrashView';

// "Files by size" (P.8, Docs/Doc_Peso_Proyectos.md, "Cómo quedó: la lista por peso"), adentro del selector de
// proyectos: las fotos, los videos y los archivos de un proyecto que ocupan lugar en el Drive, del más pesado al más
// liviano, cada uno con el link a las páginas que lo usan. Arriba se elige el proyecto, entre los que muestran un
// peso (el más pesado primero). Solo lectura y solo con red. La ve quien ve el peso del proyecto (quien ve su
// papelera de archivos), y de la lista, lo que la base le deja leer.

const KINDS: Record<SizedKind, Key> = {
  photo: 'filesBySize.kindPhoto',
  video: 'filesBySize.kindVideo',
  folder: 'filesBySize.kindFolder',
  file: 'filesBySize.kindFile',
};

/** Cuántas páginas se muestran de un archivo antes de "+N more pages". */
const PAGES_SHOWN = 3;

/** `projectId`: el proyecto con el que se abre; `onClose` cierra el selector (al abrir una página). */
export function FilesBySizePanel(props: { projectId: string; onClose: () => void }) {
  const tree = useTree();
  const perms = usePermissions();
  const { remote, sizes: sizeStore } = useServices();
  const { online } = useSyncStatus();
  const sizes = useProjectSizes();
  const tr = useT();
  const [projectId, setProjectId] = useState(props.projectId);
  const list = useMemo(() => new FilesBySize(remote, projectId), [remote, projectId]);
  const view = useSyncExternalStore(list.subscribe, list.getSnapshot);
  const allowed = perms.canSeeFileTrash(projectId);

  // El primer tramo al abrir; sin red no se pide, y al volver la red se pide lo que faltaba.
  useEffect(() => {
    if (allowed && online && list.getSnapshot().files.length === 0) void list.loadMore();
  }, [list, allowed, online]);

  // El peso, siempre al abrir (como el diálogo de Google Drive): el guardado puede tener hasta 5 minutos, y lo que
  // se mandó a la papelera de Drive en el medio haría decir que hay archivos que no se ven.
  useEffect(() => {
    if (allowed && online) void sizeStore.refresh();
  }, [sizeStore, allowed, online]);

  if (!allowed) {
    return (
      <div className="trash-panel files-by-size">
        <p className="muted">{tr('filesBySize.notAllowed')}</p>
      </div>
    );
  }

  const count = (n: number) => new Intl.NumberFormat(locale(tr.lang)).format(n);
  const total = sizes.rows?.find((r) => r.project_id === projectId);
  const nameOf = (id: string) => tree.project(id)?.name ?? tr('project.thisProject');
  // Los proyectos entre los que se elige: los que muestran un peso (el mismo permiso del selector), del más pesado
  // al más liviano, y el elegido aunque no pese.
  const weightOf = (id: string) => (perms.canSeeFileTrash(id) ? (sizes.rows?.find((r) => r.project_id === id)?.drive_bytes ?? 0) : 0);
  const choices = tree
    .projects()
    .map((p) => p.id)
    .filter((id) => id === projectId || weightOf(id) > 0)
    .sort((a, b) => weightOf(b) - weightOf(a));
  // Lo que el número del proyecto tiene de más que la lista entera: archivos que la sesión no puede leer (los sacados
  // de páginas que solo puede ver). Solo con la lista completa y un peso que no se está pidiendo ni falló al
  // pedirlo: comparar contra un peso viejo le diría al dueño que le falta algo que ya no está.
  const listed = view.files.reduce((sum, f) => sum + f.size, 0);
  const settled = !sizes.loading && !sizes.failed;
  const hidden = view.done && settled && total && total.drive_bytes > listed ? total.drive_bytes - listed : 0;

  return (
    <div className="trash-panel files-by-size">
      {/* De qué proyecto: queda a la vista al bajar por la lista. */}
      <div className="files-by-size-top">
        {choices.length > 1 ? (
          <select aria-label={tr('filesBySize.project')} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {choices.map((id) => (
              <option key={id} value={id}>
                {weightOf(id) > 0 ? `${nameOf(id)} · ${formatSize(weightOf(id), tr.lang)}` : nameOf(id)}
              </option>
            ))}
          </select>
        ) : (
          <strong className="files-by-size-head">{nameOf(projectId)}</strong>
        )}
      </div>
      {total && total.drive_files > 0 && (
        <p className="muted small trash-hint">
          {tr('filesBySize.total', { size: formatSize(total.drive_bytes, tr.lang), count: total.drive_files, files: count(total.drive_files) })}
        </p>
      )}
      <p className="muted small trash-hint">{tr('filesBySize.intro')}</p>
      {view.files.length > 0 && (
        <ul className="trash-list trash-items" aria-label={tr('project.filesBySize')}>
          {view.files.map((f) => (
            <FileRow key={f.id} file={f} projectId={projectId} onClose={props.onClose} />
          ))}
        </ul>
      )}
      {hidden > 0 && <p className="muted small">{tr('filesBySize.hidden', { size: formatSize(hidden, tr.lang) })}</p>}
      {view.done && view.files.length === 0 && hidden === 0 && <p className="muted">{tr('filesBySize.empty')}</p>}
      {!online ? (
        // Sin red no se pide nada: lo que ya había llegado queda a la vista.
        !view.done && <p className="muted small" role="status">{tr('filesBySize.offline')}</p>
      ) : view.failed ? (
        <p className="muted small" role="alert">
          {view.failed === 'offline' ? tr('filesBySize.offline') : tr('filesBySize.failed', { reason: localize(view.error ?? '') })}{' '}
          <button className="link" onClick={() => void list.loadMore()}>
            {tr('common.retry')}
          </button>
        </p>
      ) : view.loading ? (
        <p className="muted small" role="status">{tr('common.loading')}</p>
      ) : (
        !view.done &&
        view.files.length > 0 && (
          <button className="link files-by-size-more" onClick={() => void list.loadMore()}>
            {tr('filesBySize.more')}
          </button>
        )
      )}
    </div>
  );
}

function FileRow({ file, projectId, onClose }: { file: SizedFile; projectId: string; onClose: () => void }) {
  const tree = useTree();
  const tr = useT();
  const [all, setAll] = useState(false);
  const pages = pagesOf(file.uses, tree);
  const unused = isUnused(file);
  const shown = all ? pages : pages.slice(0, PAGES_SHOWN);

  const label = (p: FilePage) => {
    const title = p.title || tr('common.untitled');
    const named = p.projectId === projectId ? title : tr('filesBySize.pageElsewhere', { page: title, project: tree.project(p.projectId)?.name ?? tr('project.thisProject') });
    return p.inTrash ? tr('filesBySize.pageInTrash', { page: named }) : named;
  };

  return (
    <li className="trash-item" data-kind="file" data-unused={unused ? 'true' : undefined}>
      {/* Sin miniatura en la base no se pide ninguna (un zip, un PDF sin vista previa). */}
      <FileThumb id={file.id} name={file.name} has={file.thumb_at !== null} />
      <div className="trash-file">
        <span className="trash-kind">{tr(KINDS[sizedKind(file)])}</span>
        {/* El nombre entero solo si está cortado (los de cámara difieren al final). */}
        <span className="title" data-tip={file.name} data-tip-plain="" data-tip-overflow="">
          {file.name}
        </span>
        {unused && <span className="small files-by-size-unused">{tr('filesBySize.unused')}</span>}
        {!unused && pages.length === 0 && <span className="muted small">{tr('filesBySize.noPage')}</span>}
        {pages.length > 0 && (
          <span className="files-by-size-pages">
            {shown.map((p) => (
              <button
                key={p.id}
                className="link"
                data-tip={label(p)}
                data-tip-plain=""
                data-tip-overflow=""
                onClick={() => {
                  onClose();
                  navigate(pagePath(p.id));
                }}
              >
                {label(p)}
              </button>
            ))}
            {!all && pages.length > shown.length && (
              <button className="link muted" onClick={() => setAll(true)}>
                {tr('filesBySize.morePages', { count: pages.length - shown.length })}
              </button>
            )}
          </span>
        )}
      </div>
      <span className="files-by-size-weight">{formatSize(file.size, tr.lang)}</span>
    </li>
  );
}
