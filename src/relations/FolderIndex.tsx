import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent } from 'react';
import { useT } from '../i18n';
import { useLinkMode } from '../linkMode';
import { navigate, nextFromTable, pagePath } from '../router';
import { usePermissions, useServices, useTree } from '../services';
import { notify } from '../ui/notice';
import { useCurrentProject } from '../ui/project';
import { existingRelationsSession } from '../ui/relationsUi';
import { lazyPart, Part } from '../ui/lazyPart';
import type { CarreteEntry } from '../ui/carreteModel';
import { createEnv, reasonText } from './EntityActions';
import type { CreateWant } from './createEntity';
import { holdsOf } from './kind';
import { Thumb } from './LiveHeader';
import { locationLive, rowPhoto, sceneLive, type LiveSource, type PhotoRef } from './liveView';
import type { Registry } from './reader';
import { sceneTitleName } from '../ui/sceneTitle';
import { useColumnWidths, type ColumnSpec } from '../ui/columnWidths';
import './folderIndex.css';

// La página de una carpeta de escenas o de locaciones (D818, Docs/Plan_Proyecto_Desde_Cero.md, sección 3): arriba, el
// botón para crear una y una tabla armada sola con lo que dicen las páginas (foto, número, locación, decorado). Es
// interfaz, como la cabecera viva: no se guarda en la página, no sube y no sale en el PDF.

/** El primer número de escena libre (`060`; en una serie, el siguiente del último episodio, `105_028`). */
export function nextSceneCodes(registry: Pick<Registry, 'scenes' | 'eps' | 'flat'>, count = 20): string[] {
  const series = !registry.flat && registry.eps.size > 0;
  const ep = series ? [...registry.eps].sort().at(-1)! : '';
  let max = 0;
  for (const s of registry.scenes.values()) if (s.ep === ep) max = Math.max(max, parseInt(s.n, 10) || 0);
  const out: string[] = [];
  for (let n = max + 1; out.length < count && n < 1000; n++) out.push(`${ep ? `${ep}_` : ''}${String(n).padStart(3, '0')}`);
  return out;
}

// El carrete de las fotos de la fila (D824): se baja aparte, como el de la cabecera viva.
const GalleryCarrete = lazyPart(() => import('./GalleryCarrete').then((m) => m.GalleryCarrete));

/** La miniatura recién cuando la fila se acerca a la vista: una carpeta de 140 escenas no pide 140 fotos de golpe. */
function LazyThumb({ id, onOpen, label }: { id: string | null; onOpen?: () => void; label?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near || !id) return;
    if (typeof IntersectionObserver === 'undefined') return setNear(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [id, near]);
  const img = id && near ? <Thumb id={id} /> : <span className="lh-ph" aria-hidden="true" />;
  // Con fotos, un clic abre el carrete de la fila (D824), no la página.
  if (id && onOpen)
    return (
      <button
        ref={ref as unknown as React.Ref<HTMLButtonElement>}
        className="fi-thumb fi-thumb-btn"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        {img}
      </button>
    );
  return (
    <span ref={ref} className="fi-thumb">
      {img}
    </span>
  );
}

export function FolderIndex({ pageId }: { pageId: string }) {
  const link = useLinkMode();
  const services = useServices();
  const tree = useTree();
  const session = link ? null : existingRelationsSession(services);
  const holds = holdsOf(tree, pageId);
  // Solo la carpeta misma (su marca), no lo de adentro.
  const own = tree.get(pageId)?.settings?.holds === holds;
  if (!session || !own || (holds !== 'scene' && holds !== 'location')) return null;
  return <FolderIndexFor pageId={pageId} kind={holds} session={session} />;
}

const NARROW = '(max-width: 760px)';
const isNarrow = () => typeof matchMedia === 'function' && matchMedia(NARROW).matches;
function subscribeNarrow(change: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const mq = matchMedia(NARROW);
  mq.addEventListener('change', change);
  return () => mq.removeEventListener('change', change);
}

const SCENE_COLS: ColumnSpec[] = [
  { id: 'photo', width: 12 },
  { id: 'code', width: 8 },
  { id: 'name', width: 36 },
  { id: 'location', width: 22 },
  { id: 'set', width: 22 },
];
const LOCATION_COLS: ColumnSpec[] = [
  { id: 'photo', width: 12 },
  { id: 'name', width: 30 },
  { id: 'sets', width: 30 },
  { id: 'scenes', width: 28 },
];

interface Row {
  pageId: string;
  code: string | null;
  name: string;
  photo: string | null;
  /** Las fotos de la fila, las que muestra su carrete (D824). */
  photos: PhotoRef[];
  /** Locación (escenas) o decorados (locaciones). */
  first: { title: string; pageId: string | null }[];
  /** Decorado (escenas) o escenas (locaciones). */
  second: { title: string; pageId: string | null }[];
}

function FolderIndexFor({
  pageId,
  kind,
  session,
}: {
  pageId: string;
  kind: 'scene' | 'location';
  session: NonNullable<ReturnType<typeof existingRelationsSession>>;
}) {
  const tr = useT();
  const services = useServices();
  const tree = useTree();
  const perms = usePermissions();
  const projectId = useCurrentProject();
  const revision = useSyncExternalStore(session.relations.subscribe, session.relations.getRevision);
  const treeRevision = tree.getRevision();
  const snap = session.relations.snapshot(projectId);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const tableRef = useRef<HTMLTableElement>(null);
  // El carrete de las fotos de una fila (D824): qué fila, y desde qué foto.
  const [viewing, setViewing] = useState<string | null>(null);
  // En una pantalla angosta, sin la columna de la foto (sacarla de las columnas, no esconderla: si no, el resto queda con
  // los anchos de una tabla de cinco).
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const specs = useMemo(() => (kind === 'scene' ? SCENE_COLS : LOCATION_COLS).filter((c) => !narrow || c.id !== 'photo'), [kind, narrow]);
  const cols = useColumnWidths(kind === 'scene' ? 'folder-scenes' : 'folder-locations', specs, tableRef);

  const rows = useMemo<Row[] | null>(() => {
    if (!snap) return null;
    const src: LiveSource = { snap, title: (id) => tree.get(id)?.title, content: (id) => session.index.content(id) };
    const inside = (id: string | null): id is string => !!id && !tree.isTrashed(id) && tree.isDescendant(id, pageId);
    const out: Row[] = [];
    if (kind === 'scene') {
      for (const s of snap.registry.scenes.values()) {
        if (!inside(s.pageId)) continue;
        const v = sceneLive(src, s.code);
        const title = tree.get(s.pageId)?.title ?? '';
        const photos = v.photos.filter((p) => p.sourceKind === 'breakdown');
        out.push({
          pageId: s.pageId,
          code: s.code,
          name: (sceneTitleName(title, s.code) ?? title).trim(),
          photo: rowPhoto(photos, s.pageId, tree.get(s.pageId)?.settings?.thumb),
          photos,
          first: v.plannedAt.map((l) => ({ title: l.title, pageId: l.pageId })),
          second: v.sets.map((x) => ({ title: x.title, pageId: x.pageId })),
        });
      }
      out.sort((a, b) => a.code!.localeCompare(b.code!, undefined, { numeric: true }));
    } else {
      for (const l of snap.registry.locations.values()) {
        if (!inside(l.pageId)) continue;
        const v = locationLive(src, l.name);
        out.push({
          pageId: l.pageId,
          code: null,
          name: tree.get(l.pageId)?.title || l.name,
          photo: rowPhoto(v.photos, l.pageId, tree.get(l.pageId)?.settings?.thumb),
          photos: v.photos,
          first: v.sets.map((x) => ({ title: x.title, pageId: x.pageId })),
          second: v.planned.map((s) => ({ title: s.code, pageId: s.pageId })),
        });
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
    }
    return out;
    // La foto del índice cambia con cada revisión; el árbol (títulos, papelera, la miniatura elegida) también.
  }, [snap, revision, kind, pageId, tree, session, treeRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  // El carrete de la fila abierta (D824): sus fotos (sin carpetas, que tienen su visor), desde la miniatura. La lista es
  // la misma mientras no cambien sus fotos (si no, el carrete se rearmaría en cada revisión).
  const viewedRow = viewing ? rows?.find((r) => r.pageId === viewing) : undefined;
  const viewedPhotos = viewedRow ? viewedRow.photos.filter((p) => !services.media.isFolder(p.id)) : [];
  const viewedKey = viewedPhotos.map((p) => `${p.id}|${p.place.pageId}|${p.place.blockId}`).join(' ');
  const viewedEntries = useMemo<CarreteEntry[]>(
    () =>
      viewedPhotos.map((p) => {
        const title = tree.get(p.place.pageId)?.title || tr('common.untitled');
        return { mediaId: p.id, origin: { pageId: p.place.pageId, pageTitle: title, label: title, blockId: p.place.blockId } };
      }),
    [viewedKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const viewed =
    viewedRow && viewedEntries.length > 0
      ? { row: viewedRow, entries: viewedEntries, start: Math.max(0, viewedEntries.findIndex((e) => e.mediaId === viewedRow.photo)) }
      : null;
  // Si a la fila abierta no le queda nada que mostrar (se borraron sus fotos), el carrete se cierra y la fila deja de
  // estar abierta: si después llega una foto, no se abre solo.
  useEffect(() => {
    if (viewing && !viewed) setViewing(null);
  }, [viewing, viewed]);
  // Las fotos que el carrete puede mostrar (sin carpetas de Drive): sin ninguna, la foto de la fila no es un botón.
  const viewable = (r: Row) => r.photos.filter((p) => !services.media.isFolder(p.id)).length;

  const canCreate = perms.canCreateIn(pageId, projectId);
  const env = () => createEnv(services, projectId, tr.lang);

  const created = (id: string) => {
    navigate(pagePath(id));
    // El foco en el nombre (en una escena, el campo del nombre al lado del número gris): el título lo toma al montarse.
    setTimeout(() => window.dispatchEvent(new Event('shotdocs:focus-title')), 60);
  };

  const create = async (want: CreateWant) => {
    setBusy(true);
    try {
      const res = await env().create(want);
      if (res.ok) created(res.pageId);
      else notify(reasonText(tr, res, want, (id) => tree.get(id)?.title));
      return res.ok;
    } catch (err) {
      console.warn('[carpeta] no se pudo crear', want, err);
      notify(tr('create.failed'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const newScene = () => {
    if (!snap) return;
    // El primer número libre que se puede crear (uno en la papelera o archivado no se repite).
    const e = env();
    // En una serie la escena va a la carpeta de su episodio (la elige `createEntity`), no suelta en Escenas.
    const series = !snap.registry.flat && snap.registry.eps.size > 0;
    const where = series ? {} : { in: pageId };
    const code = nextSceneCodes(snap.registry).find((c) => e.guard({ kind: 'scene', code: c, ...where }).ok);
    const want: CreateWant = { kind: 'scene', code: code ?? nextSceneCodes(snap.registry, 1)[0], ...where };
    void create(want);
  };

  const submitLocation = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    if (await create({ kind: 'location', name: name.trim(), in: pageId })) {
      setName('');
      setNaming(false);
    }
  };

  const open = (e: MouseEvent, id: string | null) => {
    e.stopPropagation();
    if (!id) return;
    // Esc, en la página abierta, vuelve a esta tabla (D822).
    nextFromTable();
    navigate(pagePath(id));
  };
  const chips = (list: Row['first']) =>
    list.length ? (
      list.map((x, i) => (
        <span key={`${x.title}-${i}`}>
          {i > 0 && ', '}
          {x.pageId ? (
            <a href={pagePath(x.pageId)} onClick={(e) => (e.preventDefault(), open(e, x.pageId))}>
              {x.title}
            </a>
          ) : (
            x.title
          )}
        </span>
      ))
    ) : (
      <span className="fi-none">—</span>
    );

  const scenes = kind === 'scene';
  return (
    <section className="fi" aria-label={tr(scenes ? 'folder.scenesAria' : 'folder.locationsAria')}>
      <div className="fi-head">
        <span className="fi-count">{rows ? tr(scenes ? 'folder.scenesCount' : 'folder.locationsCount', { count: rows.length }) : tr('folder.reading')}</span>
        {canCreate &&
          (scenes ? (
            <button className="secondary fi-new" data-tour="scenes-new" disabled={busy || !snap?.complete} onClick={newScene}>
              + {tr('folder.newScene')}
            </button>
          ) : naming ? (
            <form className="fi-name" onSubmit={(e) => void submitLocation(e)}>
              <input
                autoFocus
                value={name}
                placeholder={tr('folder.locationName')}
                aria-label={tr('folder.locationName')}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setNaming(false), setName(''))}
              />
              <button className="secondary" type="submit" disabled={busy || !name.trim()}>
                {tr('common.create')}
              </button>
            </form>
          ) : (
            <button className="secondary fi-new" data-tour="locations-new" disabled={!snap?.complete} onClick={() => setNaming(true)}>
              + {tr('folder.newLocation')}
            </button>
          ))}
      </div>
      {rows && rows.length > 0 && (
        <table ref={tableRef} className="fi-table" data-tour={scenes ? 'scenes-table' : 'locations-table'}>
          {cols.colgroup}
          <thead>
            <tr>
              {(scenes
                ? [tr('folder.colPhoto'), '#', tr('folder.colScene'), tr('folder.colLocation'), tr('folder.colSet')]
                : [tr('folder.colPhoto'), tr('folder.colLocation'), tr('folder.colSets'), tr('folder.colScenes')]
              )
                .slice(narrow ? 1 : 0)
                .map((label, i) => (
                  <th key={label} className={scenes && label === '#' ? 'fi-code' : undefined}>
                    {/* La de la foto sin rótulo a la vista: se entiende sola. */}
                    {!narrow && i === 0 ? <span className="sr-only">{label}</span> : label}
                    {cols.handle(i, tr('folder.resize', { column: label }))}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pageId} onClick={(e) => open(e, r.pageId)}>
                {!narrow && (
                  <td>
                    <LazyThumb
                      id={r.photo}
                      onOpen={viewable(r) > 0 ? () => setViewing(r.pageId) : undefined}
                      label={tr('folder.photos', { count: viewable(r) })}
                    />
                  </td>
                )}
                {scenes && <td className="fi-code">{r.code}</td>}
                <td className={scenes ? 'fi-name-cell' : 'fi-name-cell loc'}>
                  <a href={pagePath(r.pageId)} onClick={(e) => (e.preventDefault(), open(e, r.pageId))}>
                    {r.name || (scenes ? '' : tr('common.untitled'))}
                  </a>
                </td>
                {/* Escenas: locación (azul) y decorado (violeta); Locaciones: decorados (violeta) y escenas (D823). */}
                <td className={scenes ? 'fi-loc' : 'fi-set'}>{chips(r.first)}</td>
                <td className={scenes ? 'fi-set' : 'fi-scenes'}>{chips(r.second)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows && rows.length === 0 && <p className="fi-empty">{tr(scenes ? 'folder.emptyScenes' : 'folder.emptyLocations')}</p>}
      {viewed && (
        <Part onClose={() => setViewing(null)}>
          <GalleryCarrete
            entries={viewed.entries}
            start={viewed.start}
            onClose={() => setViewing(null)}
            thumbnail={{
              current: viewed.row.photo,
              // Elegir la miniatura cambia los ajustes de la página de la fila: quien puede editarla (D824). Sin aviso al
              // elegir (la estrella pasa a esa foto, y un aviso quedaría debajo del carrete): solo si no se pudo guardar.
              onChoose: perms.canEditRow(viewed.row.pageId)
                ? (id) => {
                    const name = viewed.row.code ?? viewed.row.name;
                    tree.setSetting(viewed.row.pageId, 'thumb', id).catch(() => notify(tr('folder.thumbFailed', { name })));
                  }
                : undefined,
            }}
          />
        </Part>
      )}
    </section>
  );
}
