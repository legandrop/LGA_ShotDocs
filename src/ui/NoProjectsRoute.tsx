import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { navigate, type Route } from '../router';
import { ACCESS_REQUESTS_PAGES_SCHEMA_VERSION, ACCESS_REQUESTS_SCHEMA_VERSION } from '../sync/accessRequests';
import { SupabaseRemote } from '../sync/remote';
import { useWorkspace } from '../workspace';
import { RequestAccess, usePageWorkspaceKnown } from './RequestAccess';

// Quien no ve ningún proyecto y abre la dirección de una página (`/p/<id>`) o de un archivo (`/f/<clave local>/<id>`)
// (P.30, Docs/Doc_Links_PDF.md, sección 19, O2): en vez de «No projects yet», la pantalla sin acceso de siempre con
// *Request access*. Es justo quien más lo necesita (un miembro nuevo al que le pasan un link). Sin ningún proyecto no ve
// ninguna página ni ningún archivo, así que no hace falta preguntarle a la base por lo pedido: la pantalla es la misma
// exista o no, sin nada de él (LF4). *Go to Shot Docs* lleva al inicio, que muestra «No projects yet».
// Cuando le dan acceso, el proyecto llega con la próxima pregunta (cada 60 s sin la sincronización abierta, cada 10 s con
// ella) y la app abre la dirección.

export type AccessRoute = Extract<Route, { name: 'page' | 'file' }>;

/** La dirección es de una página o de un archivo: lo que la pantalla sin proyectos cambia por la pantalla sin acceso. */
export function isAccessRoute(route: Route): route is AccessRoute {
  return route.name === 'page' || route.name === 'file';
}

export function NoProjectsAccess({
  route,
  client,
  userId,
  localKey,
  schemaVersion,
  online,
  onHasAccess,
}: {
  route: AccessRoute;
  client: SupabaseClient;
  userId: string;
  /** La clave local del workspace abierto. */
  localKey: string;
  /** La versión de la base del workspace (`null` si no se sabe: sin *Request access*). */
  schemaVersion: number | null;
  online: boolean;
  /** La base dice que ya lo ve (el proyecto llegó recién): volver a buscar los proyectos. */
  onHasAccess: () => void;
}) {
  const tr = useT();
  const pageKnown = usePageWorkspaceKnown();
  const file = route.name === 'file';
  // La dirección de un archivo de otro workspace (no debería pasar: el arranque elige el workspace por la clave del camino).
  const otherWorkspace = file && route.localKey !== localKey;
  const needed = file ? ACCESS_REQUESTS_SCHEMA_VERSION : ACCESS_REQUESTS_PAGES_SCHEMA_VERSION;
  const canRequest = online && (schemaVersion ?? 0) >= needed && !otherWorkspace && (file || pageKnown);
  return (
    <main className="center-screen file-screen">
      <div className="card">
        {file ? <h1>{tr('file.noAccess.title')}</h1> : <p>{tr('page.notFound')}</p>}
        {otherWorkspace ? (
          <p className="muted">{tr('file.incomplete')}</p>
        ) : canRequest ? (
          <RequestAccess key={route.id} client={client} userId={userId} localKey={localKey} target={{ kind: file ? 'file' : 'page', id: route.id }} onHasAccess={onHasAccess} />
        ) : !file && !pageKnown ? (
          <p className="muted">{tr('page.otherWorkspace')}</p>
        ) : file ? (
          <p className="muted">{tr('file.noAccess.text')}</p>
        ) : null}
        <button className="link" onClick={() => navigate('/')}>
          {tr('file.home')}
        </button>
      </div>
    </main>
  );
}

/**
 * Sin la sincronización abierta (el arranque no encontró ningún proyecto): pregunta si es miembro vivo y la versión de la
 * base. Alguien sin membresía (o sacado) sigue viendo «No projects yet», como hasta ahora: la base no lo deja pedir.
 * `null` mientras pregunta.
 */
export function useNoProjectsAccess(userId: string, enabled: boolean): { member: boolean; schemaVersion: number | null } | null {
  const { client } = useWorkspace();
  const remote = useMemo(() => new SupabaseRemote(client), [client]);
  const [state, setState] = useState<{ member: boolean; schemaVersion: number | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const member = client
      .from('members')
      .select('role, removed_at')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw error;
        const row = data as { role: string; removed_at: string | null } | null;
        return !!row && !row.removed_at;
      });
    Promise.all([member, remote.fetchWorkspaceSettings()]).then(
      ([isMember, settings]) => live && setState({ member: isMember, schemaVersion: settings?.schemaVersion ?? null }),
      (err: unknown) => {
        console.warn('[sin proyectos] no se pudo preguntar la membresía o la versión de la base', err);
        if (live) setState({ member: false, schemaVersion: null });
      },
    );
    return () => {
      live = false;
    };
  }, [client, remote, userId, enabled]);
  return state;
}
