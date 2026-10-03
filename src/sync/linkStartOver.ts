import type { LocalMark } from './docs';
import type { RemoteUpdate } from './types';

// Volver a la página como la ve el equipo (Docs/Doc_Link_Publico.md, entrega 2c, LE12): un visitante con algo apartado
// en una página sigue escribiendo con el mismo autor de Yjs, y todo lo que escriba ahí cuelga de lo apartado y también se
// aparta (D235, "en cadena"). La salida es cambiar lo guardado de esa página por la base limpia del servidor: la página
// se reabre con otro autor y lo nuevo entra. Va siempre **después de bajar lo suyo**, y solo si nada cambió en el medio:
//
// 1. se mira cómo está guardada la página (`localMark`);
// 2. se baja la copia (lo sin mandar y lo mandado que no entró, la página entera); si falla, no se toca nada;
// 3. se pide la base del servidor; sin red (o sin base todavía), no se toca nada;
// 4. se cambia lo guardado, solo si sigue igual que en 1 (si se escribió algo, `LOCAL_CHANGED` y no se toca nada); lo de
//    antes queda guardado aparte en el navegador y sale en las próximas copias;
// 5. el aviso de lo apartado deja de mostrarse para lo que ya había (vuelve si se aparta algo más), y las otras pestañas
//    del mismo link vuelven a armar la página desde lo guardado.

/** La página todavía no tiene una base del equipo que el link pueda bajar (no se toca nada). */
export const TEAM_VERSION_NOT_READY = 'team_version_not_ready';

export interface StartOverDocs {
  localMark(pageId: string): Promise<LocalMark>;
  replaceWithServer(pageId: string, updates: RemoteUpdate[], mark: LocalMark): Promise<void>;
}

export interface StartOverRemote {
  pullContent(pageId: string, afterSeq: number): Promise<RemoteUpdate[]>;
  refreshEdits(force?: boolean): Promise<void>;
  acknowledgeAside(pageId: string): void;
}

export interface StartOverDeps {
  docs: StartOverDocs;
  remote: StartOverRemote;
  /** Baja la copia de la página (lo de este navegador). Si tira, no se sigue. */
  download: (pageId: string) => Promise<void>;
  /** Si la página tiene contenido en el servidor según el árbol (`update_seq > 0`): sin base, no se sigue. */
  hasContent: (pageId: string) => boolean;
  /** Avisa a las otras pestañas del mismo link. */
  broadcast?: (pageId: string) => void;
}

export async function startOverFromTeam(deps: StartOverDeps, pageId: string): Promise<void> {
  const mark = await deps.docs.localMark(pageId);
  await deps.download(pageId);
  const updates: RemoteUpdate[] = [];
  // Como la bajada de siempre: de a lotes hasta que no llega nada (para un link es una sola base).
  for (let after = 0; ; ) {
    const batch = await deps.remote.pullContent(pageId, after);
    if (batch.length === 0) break;
    updates.push(...batch);
    const last = Math.max(...batch.map((u) => u.seq));
    if (last <= after) break;
    after = last;
  }
  if (updates.length === 0 && deps.hasContent(pageId)) throw new Error(TEAM_VERSION_NOT_READY);
  // Lo último de lo mandado (lo que espera de la sesión de antes también se va a apartar): sus errores no frenan nada.
  await deps.remote.refreshEdits(true).catch(() => undefined);
  await deps.docs.replaceWithServer(pageId, updates, mark);
  deps.remote.acknowledgeAside(pageId);
  deps.broadcast?.(pageId);
}

/** El canal entre las pestañas de un mismo link (con `BroadcastChannel`; sin él, solo esta pestaña). */
export function startOverChannel(linkEntryId: string): BroadcastChannel | null {
  return typeof BroadcastChannel === 'function' ? new BroadcastChannel(`shotdocs-link-start-over:${linkEntryId}`) : null;
}
