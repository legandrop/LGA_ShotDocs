import * as Y from 'yjs';
import { PageHistory, type HistoryOrphan, type HistoryRow, type HistorySession } from './history';
import { versionChanges, type VersionChanges } from './historyDiff';
import { observeLineRecovery, type LineRecovery } from './historyMapWitness';
import { PHOTO_MARKUP_MAP, parseMarkupKey } from '../media/markup';

export interface HistoryCut { generation: string; revision: number; snapshot: Uint8Array }
export interface RecoveryReply { cut: HistoryCut; scope: string; intent: number; candidates: LineRecovery[]; partial: boolean }

// Lo que arma el historial de una página, con mensajes (Docs/Doc_Historial.md, sección 8): lo mismo corre en un Web
// Worker (history.worker.ts) o, si el navegador no lo deja, en la página (historyClient.ts). La pantalla manda las
// filas y recibe la lista de versiones; al elegir una, recibe su documento (y la unión con las marcas) como updates de
// Yjs, que arma en un momento. Lo pesado (aplicar miles de filas, los snapshots, las diferencias) queda afuera del hilo
// de la pantalla.

/** Lo que necesita la lista. */
export interface HistorySummary {
  cut?: HistoryCut;
  sessions: HistorySession[];
  /** Todas las personas, en orden de aparición (para los colores). */
  people: (string | null)[];
  /** Cuántas filas no se pudieron leer. */
  unreadable: number;
  rows: number;
}

/** Una versión: su documento (en memoria; nunca se guarda ni se sube) y el texto huérfano que llegó en ella. */
export interface VersionPayload {
  cut?: HistoryCut;
  update: Uint8Array;
  orphans: HistoryOrphan[];
}

export type HistoryRequest =
  | { op: 'load'; rows: HistoryRow[]; pageId: string }
  | { op: 'append'; rows: HistoryRow[] }
  /** Los cortes de las versiones con nombre y de las restauraciones (`versionBreaks` en history.ts). */
  | { op: 'breaks'; after: number[]; before: number[] }
  | { op: 'version'; seq: number }
  | { op: 'changes'; seq: number }
  | { op: 'recover-line'; cut: HistoryCut; scope: string; intent: number; liveUpdate: Uint8Array };

export type HistoryReply = HistorySummary | VersionPayload | VersionChanges | RecoveryReply;

export class HistoryCore {
  private history: PageHistory | null = null;
  private cut(): HistoryCut {
    const h = this.history!;
    return { generation: h.generation, revision: h.revision, snapshot: Y.encodeSnapshot(Y.snapshot(h.doc)) };
  }

  private summary(): HistorySummary {
    const h = this.history!;
    return { sessions: h.sessions, people: h.people(), unreadable: h.unreadable.length, rows: h.rows.length, cut: this.cut() };
  }

  /** La sesión por el `seq` de su última fila (los índices cambian al sumar filas; el `seq` no). */
  private index(seq: number): number {
    const i = this.history?.sessions.findIndex((s) => s.seq === seq) ?? -1;
    if (i < 0) throw new Error('version_gone');
    return i;
  }

  handle(req: HistoryRequest): HistoryReply {
    switch (req.op) {
      case 'load':
        this.history?.destroy();
        this.history = new PageHistory(req.rows, undefined, req.pageId);
        return this.summary();
      case 'append':
        if (!this.history) throw new Error('not_loaded');
        this.history.append(req.rows);
        return this.summary();
      case 'breaks':
        if (!this.history) throw new Error('not_loaded');
        this.history.setBreaks(req.after, req.before);
        return this.summary();
      case 'version': {
        const i = this.index(req.seq);
        const doc = this.history!.version(i);
        const update = Y.encodeStateAsUpdate(doc);
        doc.destroy();
        return { update, orphans: this.history!.orphansOf(i), cut: this.cut() };
      }
      case 'changes':
        return versionChanges(this.history!, this.index(req.seq), 'changed');
      case 'recover-line': {
        const h = this.history, live = new Y.Doc(), candidates: LineRecovery[] = [];
        if (!h || req.cut.generation !== h.generation || req.cut.revision !== h.revision || !Y.equalSnapshots(Y.decodeSnapshot(req.cut.snapshot), Y.snapshot(h.doc))) throw new Error('selection_changed');
        let partial = h.unreadable.length > 0;
        try {
          Y.applyUpdate(live, req.liveUpdate);
          if (!partial) for (const key of live.getMap(PHOTO_MARKUP_MAP).keys()) if (parseMarkupKey(key)?.shapeId) {
            try { const dto = observeLineRecovery(h.doc, h.rows, req.liveUpdate, key); if (dto) candidates.push(dto); }
            catch { partial = true; }
          }
          if (h.revision !== req.cut.revision) throw new Error('selection_changed');
          return { cut: this.cut(), scope: req.scope, intent: req.intent, candidates, partial };
        } finally { live.destroy(); }
      }
    }
  }

  destroy(): void {
    this.history?.destroy();
    this.history = null;
  }
}

/** Lo que se transfiere de una respuesta (los bytes de los documentos, sin copiarlos). */
export function transferables(reply: HistoryReply): ArrayBuffer[] {
  return 'update' in reply ? [reply.update.buffer as ArrayBuffer] : [];
}
