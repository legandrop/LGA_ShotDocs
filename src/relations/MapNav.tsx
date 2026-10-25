import { useSyncExternalStore } from 'react';
import { useT } from '../i18n';
import { useLinkMode } from '../linkMode';
import { mapPath, navigate, useRoute } from '../router';
import { useServices, useTree } from '../services';
import { useCurrentProject } from '../ui/project';
import { existingRelationsSession } from '../ui/relationsUi';
import { mergeRows } from './merge';
import { pendingSummary } from './projectMap';
import { mapPathFrom } from './sceneMentions';
import { useSlashDraft } from './slashDraft';
import './mapNav.css';

// La fila *Map* de la barra lateral (Docs/Doc_Relaciones.md, sección 12): arriba del árbol, como en la maqueta, con la
// letra de los títulos de la barra (`nav-title`, igual que *Scenes* y *Pages*) y la selección de una página. Aparece
// solo en un proyecto con escenas, locaciones o días de rodaje (lo que dice el registro de lo que la persona ve), y suma
// cuántos pendientes hay si hay alguno (nunca un cero), con el mismo número que la pestaña *Pending*. Con un link público no hay mapa.

export function MapNav() {
  const link = useLinkMode();
  const services = useServices();
  const session = link ? null : existingRelationsSession(services);
  if (!session) return null;
  return <MapNavFor session={session} />;
}

function MapNavFor({ session }: { session: NonNullable<ReturnType<typeof existingRelationsSession>> }) {
  const tr = useT();
  const route = useRoute();
  const projectId = useCurrentProject();
  const tree = useTree();
  useSyncExternalStore(session.relations.subscribe, session.relations.getRevision);
  // Lo que se tipea en el menú `/` de escenas no cuenta mientras el menú está abierto (D568).
  useSlashDraft();
  const snap = session.relations.snapshot(projectId);
  if (!snap) return null;
  const typed =
    snap.registry.scenes.size > 0 ||
    snap.registry.locations.size > 0 ||
    [...snap.registration.roles.values()].some((r) => r.entity?.kind === 'day' && !r.excluded);
  if (!typed) return null;
  // El mismo número que la pestaña *Pending* (O4 de la auditoría): números que no existen, duplicadas y secciones sin número.
  // Y lo que llegó tarde a una página unida (E16).
  const pending = pendingSummary({ snap, title: (id) => tree.get(id)?.title }).total + mergeRows(tree, projectId).length;
  const on = route.name === 'map';
  return (
    <a
      className={`map-nav nav-title${on ? ' on' : ''}`}
      href={mapPath()}
      aria-current={on ? 'page' : undefined}
      data-tip={tr('sidebar.mapTip')}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        // En la vista de una escena (`/map/scenes?scene=…`) también vuelve al mapa (D746).
        if (!on || location.search) navigate(mapPathFrom(mapPath(), location));
      }}
    >
      <span className="nav-title-label">{tr('sidebar.map')}</span>
      {pending > 0 && <span className="map-nav-count">{tr('sidebar.mapPending', { count: pending })}</span>}
    </a>
  );
}
