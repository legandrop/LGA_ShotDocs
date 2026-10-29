import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { locale, useT } from '../i18n';
import '../i18n/lazy/map';
import { navigate, nextFromTable, pagePath } from '../router';
import { useServices } from '../services';
import { copyText } from '../ui/commentsUi';
import { notify } from '../ui/notice';
import { fieldDate, fieldName } from './fields';
import { goToPlace } from './goToPlace';
import type { LiveSource } from './liveView';
import { fold } from './reader';
import { byScene, shotsTable, shotsTsv, type ShotRow } from './shotsTable';
import { useColumnWidths, type ColumnSpec } from '../ui/columnWidths';
import { useCurrentProject } from '../ui/project';
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

/** La clase de color de una columna de lugar: `loc` para la locación, `set` para el decorado (D823). */
export function placeClass(label: string): 'loc' | 'set' | undefined {
  const name = fieldName(label);
  return name === 'location' ? 'loc' : name === 'set' ? 'set' : undefined;
}

export function ShotsView({ src, fq, codes, complete }: { src: LiveSource | null; fq: string; codes: Set<string> | null; complete: boolean }) {
  const tr = useT();
  const services = useServices();
  const [sort, setSort] = useState<Sort>(null);
  const table = useMemo(() => (src ? shotsTable(src) : null), [src]);
  // El ancho de fábrica de cada columna sigue a lo que tiene escrito (lo largo de la mayoría de sus filas, entre 6 y 48
  // letras), en porcentaje (D821); lo que la persona cambia se guarda por columna.
  const specs = useMemo<ColumnSpec[]>(() => {
    if (!table) return [];
    const typical = (values: string[]) => {
      const lens = values.filter(Boolean).map((v) => v.length).sort((x, y) => x - y);
      return Math.min(48, Math.max(6, lens[Math.floor(lens.length * 0.8)] ?? 6));
    };
    return [
      { id: ':scene', width: 7 },
      { id: ':shot', width: typical(table.rows.map((r) => r.shot)) },
      ...table.columns.map((c) => ({ id: c.key, width: typical(table.rows.map((r) => r.values.get(c.key) ?? '')) })),
    ];
  }, [table]);
  /** Con muchas columnas no se aprietan de más: la tabla mide al menos lo de fábrica (unas 7 px por letra). */
  const minTable = specs.reduce((n, c) => n + c.width * 7 + 20, 0);
  const tableRef = useRef<HTMLTableElement>(null);
  // Una clave por proyecto: cada uno tiene sus columnas (las de sus fichas).
  const cols = useColumnWidths(`shots.${useCurrentProject()}`, specs, tableRef);
  // La columna del plano queda fija a la izquierda corrida lo que mide la de la escena, que se puede agrandar.
  const sceneWidth = cols.widths[0];
  useLayoutEffect(() => {
    const t = tableRef.current;
    const th = t?.tHead?.rows[0]?.cells[0];
    if (!t || !th) return;
    const set = () => t.style.setProperty('--scene-w', `${th.getBoundingClientRect().width}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(th);
    return () => ro.disconnect();
  }, [sceneWidth, table]);

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
    // Esc, en la página abierta, vuelve a la tabla (D822).
    nextFromTable();
    // Un plano adentro de la escena: su sección, resaltada; una ficha: su página.
    if (r.place.endBlockId !== undefined) goToPlace(services, r.place);
    else navigate(pagePath(r.place.pageId));
  };
  const head = (key: string, label: string, i: number) => (
    <th key={key} scope="col" aria-sort={sort?.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button type="button" onClick={() => setSort(sort?.key === key ? (sort.desc ? null : { key, desc: true }) : { key, desc: false })}>
        {label}
        {sort?.key === key && <span aria-hidden="true">{sort.desc ? ' ↓' : ' ↑'}</span>}
      </button>
      {cols.handle(i, tr('folder.resize', { column: label }))}
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
          {/* Con muchas columnas no se aprietan de más: la tabla se desplaza de costado adentro de su caja. */}
          <table ref={tableRef} aria-label={tr('map.tabShots')} style={{ minWidth: `${minTable}px` }}>
            {cols.colgroup}
            <thead>
              <tr>
                {head(':scene', headers.scene, 0)}
                {head(':shot', headers.shot, 1)}
                {table.columns.map((c, i) => head(c.key, c.label, i + 2))}
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
                    // La locación en su azul y el decorado en su violeta (D823), con cualquiera de sus rótulos
                    // («Locación real», «Decorado», «Locación guion»…).
                    <td key={c.key} className={placeClass(c.key)}>
                      {r.values.get(c.key) ?? ''}
                    </td>
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
