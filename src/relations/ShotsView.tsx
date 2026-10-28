import { useMemo, useState, type MouseEvent } from 'react';
import { locale, useT } from '../i18n';
import '../i18n/lazy/map';
import { navigate, pagePath } from '../router';
import { useServices } from '../services';
import { copyText } from '../ui/commentsUi';
import { notify } from '../ui/notice';
import { fieldDate } from './fields';
import { goToPlace } from './goToPlace';
import type { LiveSource } from './liveView';
import { fold } from './reader';
import { byScene, shotsTable, shotsTsv, type ShotRow } from './shotsTable';
import './shots.css';

// *Overview › Shots* (D813, parte 3): la tabla de planos de todas las escenas, en lugar de `BD Main`. Solo lee: cada fila
// lleva al plano en su escena (la sección resaltada, o la ficha), y se escribe ahí. Un clic en el encabezado ordena por
// esa columna (otro, al revés); *Copy* copia lo que se ve como tabla para pegar en una planilla.

type Sort = { key: string; desc: boolean } | null;

/** Dos valores de una columna: fechas como fechas (`06/03/2026` después de `20/02/2026`), números como números. */
function compareValues(a: string, b: string): number {
  const da = fieldDate(a);
  const db = fieldDate(b);
  if (da && db) return da < db ? -1 : da > db ? 1 : 0;
  return a.localeCompare(b, locale(), { numeric: true, sensitivity: 'base' });
}

export function ShotsView({ src, fq, codes, complete }: { src: LiveSource | null; fq: string; codes: Set<string> | null; complete: boolean }) {
  const tr = useT();
  const services = useServices();
  const [sort, setSort] = useState<Sort>(null);
  const table = useMemo(() => (src ? shotsTable(src) : null), [src]);

  const shown = useMemo(() => {
    if (!table) return [];
    // Como en *Scenes* y *Shoot days*: si lo escrito nombra escenas (`5029`, «Escena 29»), las suyas; si no, el texto.
    const rows = !fq ? table.rows : table.rows.filter((r) => (codes ? codes.has(r.scene) : fold(`${r.scene} ${r.shot} ${[...r.values.values()].join(' ')}`).includes(fq)));
    if (!sort) return rows;
    const valueOf = (r: ShotRow) => (sort.key === ':scene' ? r.scene : sort.key === ':shot' ? r.shot : (r.values.get(sort.key) ?? ''));
    const cmp = (a: ShotRow, b: ShotRow) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      // Lo vacío va siempre al final.
      if (!va !== !vb) return va ? -1 : 1;
      const c = sort.key === ':scene' ? byScene(va, vb) : compareValues(va, vb);
      return (sort.desc ? -c : c) || byScene(a.scene, b.scene);
    };
    return [...rows].sort(cmp);
  }, [table, fq, codes, sort]);

  if (!table || !table.rows.length) return <p className="mp-empty">{complete ? tr('map.noShots') : tr('live.reading')}</p>;

  const headers = { scene: tr('map.colShotScene'), shot: tr('map.colShot') };
  const copy = async () => {
    const ok = await copyText(shotsTsv(table, shown, headers));
    notify(ok ? tr('map.shotsCopied', { count: shown.length }) : tr('map.copyFailed'));
  };
  const open = (e: MouseEvent, r: ShotRow) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    // Un plano adentro de la escena: su sección, resaltada; una ficha: su página.
    if (r.place.endBlockId !== undefined) goToPlace(services, r.place);
    else navigate(pagePath(r.place.pageId));
  };
  const head = (key: string, label: string) => (
    <th key={key} scope="col" aria-sort={sort?.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button type="button" onClick={() => setSort(sort?.key === key ? (sort.desc ? null : { key, desc: true }) : { key, desc: false })}>
        {label}
        {sort?.key === key && <span aria-hidden="true">{sort.desc ? ' ↓' : ' ↑'}</span>}
      </button>
    </th>
  );

  return (
    <div className="mp-shots">
      <div className="mp-shots-bar">
        <span>
          {tr('map.shotsCount', { count: table.rows.length })} · {tr('map.scenes', { count: table.scenes })}
          {/* Mientras el índice lee, una escena todavía sin leer no es una escena sin planos (D402). */}
          {complete && table.withoutShots > 0 && <span className="mp-none"> · {tr('map.shotsWithout', { count: table.withoutShots })}</span>}
          {/* La tabla a medio leer no es la cuenta final (auditoría final de D813). */}
          {!complete && <span className="mp-none"> · {tr('live.reading')}</span>}
          {fq && <span className="mp-none"> · {tr('map.shotsShown', { count: shown.length })}</span>}
        </span>
        <button className="mp-btn" onClick={() => void copy()} disabled={!shown.length}>
          {tr('map.shotsCopy')}
        </button>
      </div>
      {!shown.length ? (
        <p className="mp-empty">{tr('map.noMatch')}</p>
      ) : (
        <div className="mp-shots-scroll">
          <table aria-label={tr('map.tabShots')}>
            <thead>
              <tr>
                {head(':scene', headers.scene)}
                {head(':shot', headers.shot)}
                {table.columns.map((c) => head(c.key, c.label))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key}>
                  <td className="mono scene">{r.scene}</td>
                  <td className="mono">
                    <a className="mp-link" href={pagePath(r.place.pageId)} onClick={(e) => open(e, r)}>
                      {r.shot}
                    </a>
                  </td>
                  {table.columns.map((c) => (
                    <td key={c.key}>{r.values.get(c.key) ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
