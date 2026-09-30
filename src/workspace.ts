import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';

/**
 * La versión de la base (`workspace_settings.schema_version`) que necesita esta versión de la app. Sube con
 * las migraciones que agregan algo que la app usa; si la del workspace es menor, la app avisa.
 */
export const DB_SCHEMA_VERSION = 4;

/**
 * Un workspace: el Supabase de su dueño (dirección y clave publicable), su nombre y la clave local, que
 * dice cómo se llama lo guardado en el dispositivo. De acá sale el cliente de Supabase: nada usa uno
 * global. Ver Docs/Plan_Workspaces.md (secciones 1 y 11, paso 5).
 */
export interface WorkspaceConfig {
  url: string;
  publishableKey: string;
  /** Vacío si todavía no se leyó de la base. */
  name: string;
  localKey: string;
  storage: StorageNames;
}

/** Nombres de lo que el workspace guarda en el dispositivo. */
export interface StorageNames {
  /** La sesión de Supabase. */
  auth: string;
  lastUser: string;
  project: string;
  lastPages: string;
  /** La base local (IndexedDB) de cada usuario. */
  db: (userId: string) => string;
}

/**
 * La clave local de Wanka, fija como texto: es el ref de su proyecto de Supabase, y ya no se saca de la
 * dirección para que una copia restaurada en otro proyecto no le cambie el nombre a la base local de los
 * dispositivos. NUNCA se cambia. Otra publicación de la app vive en otra dirección (otro origen del
 * navegador, con su propio almacenamiento), así que este nombre fijo no choca con el de nadie.
 */
export const WANKA_LOCAL_KEY = 'znlvpuddswymxpffgvbz';

/** Nombre de la base local de un usuario. Para Wanka, el de siempre: `shotdocs:<ref>:<usuario>`. */
export function localDbName(localKey: string, userId: string): string {
  return `shotdocs:${localKey}:${userId}`;
}

/**
 * Los nombres de hoy, los de Wanka. Renombrarlos desloguearía a Lega en todos sus dispositivos y, sin red,
 * lo dejaría sin su base: NUNCA se cambian.
 */
export function legacyStorageNames(localKey: string): StorageNames {
  return {
    auth: 'shotdocs-auth',
    lastUser: 'shotdocs-last-user',
    project: 'shotdocs-project',
    lastPages: 'shotdocs-last-pages',
    db: (userId) => localDbName(localKey, userId),
  };
}

/** Los nombres de un workspace nuevo (paso 12): llevan la clave local. */
export function storageNamesFor(localKey: string): StorageNames {
  return {
    auth: `shotdocs-auth:${localKey}`,
    lastUser: `shotdocs-last-user:${localKey}`,
    project: `shotdocs-project:${localKey}`,
    lastPages: `shotdocs-last-pages:${localKey}`,
    db: (userId) => localDbName(localKey, userId),
  };
}

/**
 * El workspace con el que se compiló la app (`SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`): en la dirección
 * pública de Lega, Wanka, con los nombres de siempre. Hasta que exista la lista de workspaces del
 * dispositivo (paso 12) es el único. `null` si falta la configuración al compilar.
 */
export function buildWorkspace(): WorkspaceConfig | null {
  const url = __SUPABASE_URL__;
  const publishableKey = __SUPABASE_PUBLISHABLE_KEY__;
  if (!url || !publishableKey) return null;
  return {
    url,
    publishableKey,
    // El nombre de verdad está en `workspace_settings.name` (Wanka, en la base de Lega); la lista de
    // workspaces del paso 12 lo guarda. Vacío: todavía no se sabe.
    name: '',
    localKey: WANKA_LOCAL_KEY,
    storage: legacyStorageNames(WANKA_LOCAL_KEY),
  };
}

// Un solo cliente por workspace en toda la app: dos con la misma sesión se pisarían al renovarla.
const clients = new Map<string, SupabaseClient>();

export function createWorkspaceClient(ws: WorkspaceConfig): SupabaseClient {
  const known = clients.get(ws.localKey);
  if (known) return known;
  const client = createClient(ws.url, ws.publishableKey, {
    auth: {
      storageKey: ws.storage.auth,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
    },
  });
  clients.set(ws.localKey, client);
  return client;
}

/** El workspace abierto y su cliente. */
export interface ActiveWorkspace {
  config: WorkspaceConfig;
  client: SupabaseClient;
}

export const WorkspaceContext = createContext<ActiveWorkspace | null>(null);

export function useWorkspace(): ActiveWorkspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace fuera de WorkspaceContext');
  return ws;
}
