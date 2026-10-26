import { fieldDate, fieldValues } from './fields';
import { scoutLocations, type LiveSource } from './liveView';
import { fold } from './reader';

// *Overview › Scouting* (Docs/Plan_Estructura_Etapas.md, parte 2): los scoutings y las pruebas por fecha, con sus
// locaciones, estén donde estén, como la página «Scouting» de Coda. Lo de antes también cuenta: una página con fecha
// adentro de una locación (ES2) es un scouting de ella.

export interface ScoutRow {
  pageId: string;
  title: string;
  /** Una prueba o un scouting (lo de adentro de una locación sin marca, scouting). */
  doc: 'scouting' | 'test';
  /** `2026-01-29`, o `null` si ni su campo *Fecha* ni su título la dicen entera. */
  date: string | null;
  locs: string[];
}

/** Una fecha que existe (no el 31 de febrero). */
const valid = (y: number, m: number, d: number) => {
  if (y < 1990 || m < 1 || m > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * La fecha entera de un scouting: su campo *Fecha*; si no, la del principio del título, como las escribe Lega
 * (`2026-01-29`, `2026_01_29`, `26.01.29`, `260129`, `26_01_29`, `26 01 29`: año, mes y día). Sin año, `null`: no se
 * inventa.
 */
export function scoutIso(src: LiveSource, pageId: string, title: string): string | null {
  for (const f of fieldValues(src.snap.fields.get(pageId), ['date', 'fecha', 'fecha scouting', 'scout date'])) {
    const d = fieldDate(f.text);
    if (d) return d;
  }
  const t = title.trim();
  const full = /^(\d{4})[-._ ](\d{2})[-._ ](\d{2})(?!\d)/.exec(t);
  if (full && valid(+full[1], +full[2], +full[3])) return iso(+full[1], +full[2], +full[3]);
  const short = /^(\d{2})[._ ]?(\d{2})[._ ]?(\d{2})(?![\d.])/.exec(t);
  if (short && valid(2000 + +short[1], +short[2], +short[3])) return iso(2000 + +short[1], +short[2], +short[3]);
  return null;
}

/**
 * Los scoutings y pruebas del proyecto, por fecha (los sin fecha, al final, por título). Un documento adentro de otro es
 * parte de él (sus fotos, un anexo) y no se lista; una página sin fecha que agrupa documentos (`Enero`, `Semana 03`)
 * tampoco.
 */
export function scoutList(src: LiveSource): ScoutRow[] {
  const roles = src.snap.registration.roles;
  const children = new Map<string, string[]>();
  for (const [id, r] of roles) {
    if (!r.parent) continue;
    const list = children.get(r.parent);
    if (list) list.push(id);
    else children.set(r.parent, [id]);
  }

  const dates = new Map<string, string | null>();
  const dateOf = (id: string) => {
    if (!dates.has(id)) dates.set(id, scoutIso(src, id, src.title(id) ?? ''));
    return dates.get(id)!;
  };
  /** Es un scouting o una prueba: por su marca o su carpeta, o una página con fecha adentro de una locación. */
  const docOf = (id: string): ScoutRow['doc'] | null => {
    const r = roles.get(id);
    if (!r || r.excluded || src.title(id) === undefined) return null;
    if (r.doc === 'scouting' || r.doc === 'test') return r.doc;
    // Lo de antes: una página con fecha adentro de su locación (no sus «Contactos» ni sus «Fotos»).
    if (!r.doc && r.partOf?.kind === 'location' && r.parent === r.partOf.pageId && dateOf(id)) return 'scouting';
    return null;
  };
  const listed = new Map<string, boolean>();
  const isListed = (id: string): boolean => {
    if (listed.has(id)) return listed.get(id)!;
    listed.set(id, false);
    const r = roles.get(id);
    const parent = r?.parent ?? null;
    // Un grupo: sin fecha, sin nada escrito y con documentos adentro (`Enero`); una prueba sin fecha con sus fotos
    // adentro se lista ella.
    const rel = src.snap.pages.get(id);
    const empty = !rel || (rel.blocks === 0 && rel.media.length === 0);
    const group = !dateOf(id) && empty && (children.get(id) ?? []).some((c) => docOf(c));
    const value = !!docOf(id) && !(parent && isListed(parent)) && !group;
    listed.set(id, value);
    return value;
  };

  const out: ScoutRow[] = [];
  for (const id of roles.keys()) {
    if (!isListed(id)) continue;
    out.push({ pageId: id, title: src.title(id) ?? '', doc: docOf(id)!, date: dateOf(id), locs: scoutLocations(src, id) });
  }
  return out.sort((a, b) => {
    if (a.date !== b.date) return a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? -1 : 1;
    const x = fold(a.title);
    const y = fold(b.title);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}
