import { codePointLength, DB_LIMITS } from '../lib/dbLimits';
import { RemoteError } from './types';

// Los `check` de largo de `pages` y `workspaces` como los aplica la base, para el servidor falso de las pruebas
// (testing.ts): el mismo mensaje y el mismo código (23514), rechazo permanente. Docs/Doc_Sincronizacion.md, "Topes de largo".

function violation(table: string, constraint: string): RemoteError {
  return new RemoteError(`new row for relation "${table}" violates check constraint "${constraint}"`, true, '23514');
}

/** Lo que mide `length(x::text)` de un `jsonb` en Postgres (con `", "` y `": "`, como lo escribe la base). */
export function jsonbTextLength(value: unknown): number {
  if (value === null || typeof value !== 'object') return codePointLength(JSON.stringify(value) ?? 'null');
  if (Array.isArray(value)) {
    if (value.length === 0) return 2;
    return 2 + value.reduce<number>((n, v) => n + jsonbTextLength(v), 0) + 2 * (value.length - 1);
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return 2;
  return 2 + entries.reduce((n, [k, v]) => n + codePointLength(JSON.stringify(k)) + 2 + jsonbTextLength(v), 0) + 2 * (entries.length - 1);
}

/** La fila de `pages` (nueva o con el cambio aplicado) pasa los `check` de largo, o sale el error de la base. */
export function checkPageLengths(row: { title?: string; icon?: string | null; sort_key?: string; settings?: unknown }): void {
  if (row.title !== undefined && codePointLength(row.title) > DB_LIMITS.pageTitle) throw violation('pages', 'pages_title_check');
  if (row.icon && codePointLength(row.icon) > DB_LIMITS.pageIcon) throw violation('pages', 'pages_icon_check');
  if (row.sort_key !== undefined && codePointLength(row.sort_key) > DB_LIMITS.pageSortKey) {
    throw violation('pages', 'pages_sort_key_length');
  }
  if (row.settings !== undefined && jsonbTextLength(row.settings) > DB_LIMITS.pageSettings) throw violation('pages', 'pages_settings_shape');
}

/** El nombre de un proyecto (`workspaces.name`) pasa su `check` de largo, o sale el error de la base. */
export function checkProjectName(name: string): void {
  if (codePointLength(name) > DB_LIMITS.projectName) throw violation('workspaces', 'workspaces_name_length');
}
