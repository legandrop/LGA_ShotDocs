import { AdmissionTester, type AdmitVerdict } from './admit';
import { ADMIT_PAGES_PER_ROUND, ADMIT_PAUSE_MS, type AdmitDecision, type AdmitWorkRow, type LinkAdmitRemote } from './linkAdmitApi';
import { RemoteError } from './types';

export * from './linkAdmitApi';

// La admisión de lo que escribe un link público con *Can edit* (Docs/Doc_Link_Publico.md, E2.3, LE1 y LE2): lo hace el
// dispositivo de quien ya arma las bases limpias (ve lo borrado, con la versión de los dos interruptores), en el mismo
// paso del ciclo que las bases y antes de armarlas. En dos pasos (B2 de la auditoría): primero qué páginas tienen algo
// para decidir (sin bytes); después los bytes solo de las que el dispositivo tiene listas (al día, sin nada propio sin
// subir y sin edición reciente). Prueba página por página (`AdmissionTester`) y le dice a la base qué entra
// (`link_admit`); la base mueve los bytes, vuelve a comprobar los archivos y corta si decide distinto.

/** Lo que la admisión necesita del dispositivo: el árbol, lo guardado y qué está escribiendo el editor. */
export interface AdmitDevice {
  /** El `update_seq` del servidor según el último árbol, o `null` si el dispositivo no ve la página. */
  serverSeq(pageId: string): number | null;
  /** El cursor guardado y si tiene algo sin subir o rechazado. */
  ready(pageId: string): Promise<boolean>;
  /** Las filas guardadas (las del servidor hasta `seq`), o por qué no. */
  savedRows(pageId: string, seq: number): Promise<{ rows: Uint8Array[] } | { skip: string }>;
  /** La última edición local guardada de la página (ms), si hubo en esta sesión. */
  lastLocalEdit(pageId: string): number | undefined;
}

export interface AdmitRoundResult {
  /** Filas que la base movió a las páginas. */
  admitted: number;
  /** Filas apartadas en esta vuelta (por esta prueba o por la base). */
  aside: number;
  /** Páginas que se probaron. */
  pages: string[];
}

/**
 * La admisión de un dispositivo: una vuelta por ciclo. Recuerda, por página, las decisiones que probó y no pudo mandar
 * (se cortó la red): la vuelta siguiente las manda sin volver a bajar los bytes (E2.3, paso 5).
 */
export class LinkAdmission {
  private readonly unsent = new Map<string, AdmitDecision[]>();

  constructor(
    private readonly remote: LinkAdmitRemote,
    private readonly device: AdmitDevice,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Una vuelta: qué páginas, cuáles están listas, sus bytes, la prueba y la decisión. Los errores de red tiran. */
  async round(): Promise<AdmitRoundResult> {
    const out: AdmitRoundResult = { admitted: 0, aside: 0, pages: [] };
    const listed = await this.remote.admitPages();
    if (listed.length === 0) {
      this.unsent.clear();
      return out;
    }
    const wanted = new Set(listed.map((p) => p.page_id));
    for (const id of this.unsent.keys()) if (!wanted.has(id)) this.unsent.delete(id);
    // Primero lo que ya se probó y no llegó a la base: sin volver a bajar nada.
    for (const [pageId, decisions] of [...this.unsent]) {
      await this.send(pageId, decisions, out);
      this.unsent.delete(pageId);
      wanted.delete(pageId);
    }
    const ready: string[] = [];
    for (const p of listed) {
      if (!wanted.has(p.page_id)) continue;
      const seq = this.device.serverSeq(p.page_id);
      if (seq === null) continue;
      const edited = this.device.lastLocalEdit(p.page_id);
      if (edited !== undefined && this.now() - edited < ADMIT_PAUSE_MS) continue;
      if (!(await this.device.ready(p.page_id))) continue;
      ready.push(p.page_id);
      if (ready.length >= ADMIT_PAGES_PER_ROUND) break;
    }
    if (ready.length === 0) return out;
    const work = await this.remote.admitWork(ready);
    const byPage = new Map<string, AdmitWorkRow[]>();
    for (const w of work) {
      const list = byPage.get(w.page_id) ?? [];
      list.push(w);
      byPage.set(w.page_id, list);
    }
    for (const [pageId, rows] of byPage) {
      const seq = this.device.serverSeq(pageId);
      if (seq === null) continue;
      const saved = await this.device.savedRows(pageId, seq);
      if ('skip' in saved) continue;
      const decisions = this.decide(pageId, saved.rows, rows);
      out.pages.push(pageId);
      try {
        await this.send(pageId, decisions, out);
      } catch (err) {
        if (err instanceof RemoteError && err.network) this.unsent.set(pageId, decisions);
        throw err;
      }
    }
    return out;
  }

  /** La prueba de las filas de una página, en el orden de la base (por link y llegada). */
  private decide(pageId: string, saved: Uint8Array[], rows: AdmitWorkRow[]): AdmitDecision[] {
    const tester = new AdmissionTester(saved);
    try {
      return rows.map((r) => {
        const verdict: AdmitVerdict = tester.test(r.data);
        if (verdict.ok) return { id: r.id, ok: true, media: verdict.media };
        console.warn(`Página ${pageId}: un cambio de un link queda apartado (${verdict.reason}${verdict.detail ? `: ${verdict.detail}` : ''}).`);
        return { id: r.id, ok: false, reason: verdict.reason };
      });
    } finally {
      tester.destroy();
    }
  }

  /**
   * Manda las decisiones de una página. La base decide en orden y **corta** en la primera fila que decide distinto de lo
   * pedido (otro editor la decidió distinto, un archivo no vale, el link dejó de editar ahí): lo que sigue se probó sobre
   * una página que no es la real y queda sin decidir, así que la vuelta siguiente lo baja y lo vuelve a probar. Acá solo
   * se cuenta lo que la base decidió.
   */
  private async send(pageId: string, decisions: AdmitDecision[], out: AdmitRoundResult): Promise<void> {
    if (decisions.length === 0) return;
    const results = await this.remote.admit(pageId, decisions);
    for (const r of results) {
      if (r.decision === 'admitted') out.admitted++;
      else if (r.decision === 'aside') out.aside++;
    }
  }
}
