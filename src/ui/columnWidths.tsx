import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { useT } from '../i18n';
import { tipRows } from './tipRows';

// Las columnas de las tablas que arma la app (la de Escenas y la de Locaciones de su carpeta, las vistas del Overview), con el
// ancho en porcentaje del ancho de la tabla (D821): siguen al ancho de la página. Sirve para una `<table>` (con `colgroup`)
// y para una grilla con `role="row"` (con `template` en `grid-template-columns`). Se cambian arrastrando el borde derecho
// del encabezado (lo que gana una columna lo pierden las de su derecha) o con ←/→ en ese borde; doble clic ajusta la columna a
// lo más largo que tiene escrito. Se recuerda por tabla en este dispositivo.

export interface ColumnSpec {
  /** Estable entre dibujos y versiones: con él se guarda el ancho. */
  id: string;
  /** El ancho de fábrica, en porcentaje (se normaliza a que todas sumen 100). */
  width: number;
}

/** Lo más angosta que queda una columna, en píxeles. */
const MIN_PX = 56;
const PREFIX = 'shotdocs.cols.';

function load(key: string): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFIX + key) ?? 'null');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function save(key: string, value: Record<string, number>) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento (ventana privada): el ancho dura lo que la pantalla.
  }
}

/** Los anchos de las columnas: lo guardado si existe, si no el de fábrica; siempre sumando 100. */
export function columnWidths(cols: readonly ColumnSpec[], stored: Record<string, number>): number[] {
  const raw = cols.map((c) => (Number.isFinite(stored[c.id]) && stored[c.id] > 0 ? stored[c.id] : c.width));
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((w) => (w / total) * 100);
}

/**
 * Mueve el borde derecho de la columna `i` `delta` puntos de porcentaje, sin bajar de `min` ninguna. Lo que gana la columna
 * lo pierden las de su derecha, de la más cercana en adelante (así la foto crece aunque la de al lado sea angosta); lo que
 * pierde lo gana la de al lado.
 */
export function moveBorder(widths: readonly number[], i: number, delta: number, min: number): number[] {
  const out = [...widths];
  if (delta < 0) {
    // Una columna que ya está por debajo del mínimo (una ventana angosta) no crece al achicarla.
    const give = Math.min(0, Math.max(delta, min - out[i]));
    out[i] += give;
    out[i + 1] -= give;
    return out;
  }
  let need = delta;
  for (let j = i + 1; j < out.length && need > 0; j++) {
    const take = Math.min(need, out[j] - min);
    if (take <= 0) continue;
    out[j] -= take;
    out[i] += take;
    need -= take;
  }
  return out;
}

/** Las filas de datos de la tabla o la grilla, cada una con sus celdas en orden. */
function bodyRows(el: HTMLElement): HTMLElement[][] {
  if (el instanceof HTMLTableElement) return [...el.tBodies].flatMap((b) => [...b.rows]).map((r) => [...r.cells]);
  return [...el.querySelectorAll<HTMLElement>('[role="row"]')]
    .filter((r) => !r.classList.contains('head') && r.querySelector(':scope > [role="cell"] + [role="cell"]'))
    .map((r) => [...r.children].filter((c): c is HTMLElement => c instanceof HTMLElement));
}

/** Lo que mide el contenido de una celda escrito sin cortar renglones: una copia invisible al lado, en la misma fila. */
function naturalWidth(cell: HTMLElement): number {
  const probe = cell.cloneNode(true) as HTMLElement;
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;width:max-content;max-width:none;left:0;top:0';
  cell.parentElement!.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return w;
}

/**
 * Como `moveBorder`, pero lo que gana la columna `i` lo ponen todas las de su derecha, cada una en proporción a lo que le
 * sobra sobre `min`: ajustar una columna a su contenido no deja a la de al lado en el mínimo.
 */
export function spreadBorder(widths: readonly number[], i: number, delta: number, min: number): number[] {
  if (delta <= 0) return moveBorder(widths, i, delta, min);
  const out = [...widths];
  const spare = out.slice(i + 1).reduce((n, w) => n + Math.max(0, w - min), 0);
  if (spare <= 0) return out;
  const take = Math.min(delta, spare);
  for (let j = i + 1; j < out.length; j++) out[j] -= (Math.max(0, out[j] - min) / spare) * take;
  out[i] += take;
  return out;
}

export function useColumnWidths(key: string, cols: readonly ColumnSpec[], table: RefObject<HTMLElement | null>) {
  const tr = useT();
  const [stored, setStored] = useState(() => load(key));
  // Otra tabla en el mismo lugar (otro proyecto): sus anchos guardados.
  const [loaded, setLoaded] = useState(key);
  if (loaded !== key) {
    setLoaded(key);
    setStored(load(key));
  }
  const widths = columnWidths(cols, stored);
  const drag = useRef<{ x: number; start: number[]; i: number; px: number } | null>(null);

  const commit = useCallback(
    (next: number[], persist: boolean) => {
      const value = Object.fromEntries(cols.map((c, j) => [c.id, Math.round(next[j] * 100) / 100]));
      setStored(value);
      if (persist) save(key, value);
    },
    [cols, key],
  );

  const minPct = () => (MIN_PX / Math.max(table.current?.getBoundingClientRect().width ?? 1, 1)) * 100;

  /** Lo más largo escrito en la columna (sin cortar), como porcentaje de la tabla; `null` si no tiene texto. */
  const fitOf = (i: number): number | null => {
    const el = table.current;
    if (!el) return null;
    let max = 0;
    // Solo las filas: el encabezado de la foto tiene un rótulo invisible que no es contenido.
    for (const row of bodyRows(el)) {
      const cell = row[i];
      if (!cell?.textContent?.trim()) continue;
      max = Math.max(max, naturalWidth(cell) + 8);
    }
    // Nunca más de la mitad de la tabla: una descripción larga no se come las demás columnas.
    return max ? Math.min(50, (max / el.getBoundingClientRect().width) * 100) : null;
  };

  const colgroup = (
    <colgroup>
      {widths.map((w, i) => (
        <col key={cols[i].id} style={{ width: `${w}%` }} />
      ))}
    </colgroup>
  );

  /** El borde derecho del encabezado de la columna `i` (la última no tiene: no hay con quién repartir). */
  const handle = (i: number, label: string): ReactNode =>
    i < cols.length - 1 ? (
      <span
        className="col-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={Math.round(widths[i])}
        data-tip={tipRows([
          { gesture: 'drag', action: tr('cols.dragTip'), touch: true },
          { gesture: 'doubleClick', action: tr('cols.fitTip') },
        ])}
        tabIndex={0}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          // La columna se ajusta a lo más largo que tiene escrito; una sin texto (la de la foto) vuelve la tabla entera a
          // los anchos de fábrica.
          const fit = fitOf(i);
          commit(fit === null ? columnWidths(cols, {}) : spreadBorder(widths, i, fit - widths[i], minPct()), true);
        }}
        onPointerDown={(e: PointerEvent<HTMLSpanElement>) => {
          if (e.button !== 0) return;
          // Sin `preventDefault` acá: si no, el navegador no manda el doble clic. La selección de texto la frena `onMouseDown`.
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, start: widths, i, px: table.current?.getBoundingClientRect().width ?? 1 };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          commit(moveBorder(d.start, d.i, ((e.clientX - d.x) / d.px) * 100, minPct()), false);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d) return;
          drag.current = null;
          commit(moveBorder(d.start, d.i, ((e.clientX - d.x) / d.px) * 100, minPct()), true);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLSpanElement>) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          e.stopPropagation();
          commit(moveBorder(widths, i, e.key === 'ArrowLeft' ? -2 : 2, minPct()), true);
        }}
      />
    ) : null;

  /** Para una grilla: las columnas en proporción, que así descuentan el espacio entre columnas. */
  const template = widths.map((w) => `minmax(0, ${w.toFixed(3)}fr)`).join(' ');

  return { widths, colgroup, handle, template };
}
