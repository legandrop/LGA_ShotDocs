export interface PageRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  sort_key: string;
  /** Ajustes de la rama; en copias guardadas por versiones anteriores de la app puede faltar. */
  settings?: PageSettings;
  update_seq: number;
  /**
   * El `to_seq` de la base limpia vigente (0: ninguna; Docs/Doc_Privacidad_Borrado.md). Para quien no ve lo borrado y
   * con el interruptor prendido, "al día" es llegar hasta acá. Ausente con una base anterior a la versión 12 y en las
   * copias guardadas por versiones anteriores de la app.
   */
  clean_seq?: number;
  /**
   * El `up_to_seq` del snapshot vigente (0: ninguno; Docs/Doc_Compactar.md). Solo una pista: la base decide con el
   * snapshot vigente de verdad. Ausente con una base anterior a la versión 17 y en las copias de versiones anteriores.
   */
  snapshot_seq?: number;
  /**
   * La época de contenido de la página: sube cada vez que se invalida una cadena de snapshots. Si un dispositivo aplicó
   * un snapshot de la página y ve otra época, la vuelve a bajar (Docs/Doc_Compactar.md, sección 12). Ausente con una
   * base anterior a la versión 17.
   */
  content_epoch?: number;
  /**
   * De qué plantilla salió (Docs/Doc_Plantillas.md, sección 7): el uuid de una de fábrica o el id de la página
   * plantilla. Informativo, nunca da permisos. Ausente en las copias guardadas por versiones anteriores de la app.
   */
  template_id?: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Ajustes de una página que valen también para las de adentro, salvo que alguna defina los suyos. Cada
 * campo se hereda por separado: el que falta se busca en los ancestros.
 */
export interface PageSettings {
  /** Encabezado arriba del título con las páginas contenedoras. `levels: 0` lo oculta; `null`, todas. */
  header?: { levels: number | null; last?: number | null };
  /** Dividir por "|" los títulos de las páginas de adentro en la barra lateral. */
  split?: boolean;
  /** Tamaño de hoja: la página se ve (y más adelante se exporta) con ese tamaño. `free`: sin hoja. */
  format?: { size: string; landscape?: boolean };
  /**
   * La carpeta de reportes del día (Docs/Doc_Plantillas.md, 6.2). No se hereda: se lee solo en la página misma (nunca
   * con `resolveSetting`). Un objeto la marca (`template`: la plantilla propia del último reporte, entrega 3); `false`
   * dice que se dejó de usar a mano y gana sobre lo que se deduce de los reportes de adentro.
   */
  dayReports?: { template?: string } | false;
  /**
   * La página es una plantilla propia (Docs/Doc_Plantillas.md, 3 y 5): su descripción y si sirve para el reporte del
   * día. No se hereda. `false`: se dejó de usar a mano (gana sobre lo que se deduce de la carpeta *Templates*).
   */
  template?: { description?: string; dayReport?: true } | false;
  /** La carpeta *Templates* del proyecto (una página raíz). No se hereda. */
  templatesFolder?: true;
  /**
   * `false`: la página y todo lo de adentro quedan fuera de las relaciones en vivo (un archivo, un backup; D387,
   * Docs/Doc_Relaciones.md). No se hereda con `resolveSetting`: lo lee `registerProject` en la página y sus carpetas.
   */
  graph?: false;
  /**
   * Qué ES la página (Docs/Doc_Estructura_Proyecto.md, «Tipo de página»): una escena, una locación o un día de rodaje.
   * `code`, solo en una escena: su número canónico (`101_074`, con letra propia si la tiene: `101_069A`; siempre con
   * guion bajo). `false`: se dijo a mano que no es nada de eso (gana sobre la carpeta). No se hereda: se lee en la página
   * misma (nunca con `resolveSetting`), así la sabe también quien ve la página sin su carpeta. Lo lee
   * `src/relations/kind.ts`.
   */
  entity?: { kind: 'scene' | 'location' | 'day'; code?: string } | false;
  /**
   * La carpeta da el tipo a lo que se crea adentro: escenas, locaciones o días de rodaje. No se hereda. Los días usan la
   * carpeta de reportes (`dayReports`): marcar una carpeta como de días escribe `dayReports` y no esta clave; `'day'` acá
   * se lee igual (cuenta como carpeta de reportes salvo que `dayReports` sea `false`). Se lee con `holdsOf` de
   * `src/relations/kind.ts`, nunca suelta.
   */
  holds?: 'scene' | 'location' | 'day' | false;
}

export type PagePatch = Partial<Pick<PageRow, 'title' | 'icon' | 'parent_id' | 'sort_key' | 'deleted_at' | 'settings' | 'template_id'>>;

export interface NewPage {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  sort_key: string;
  /** La plantilla con que se crea (solo si se crea desde una; las versiones anteriores no lo mandan). */
  template_id?: string;
}

/** Un proyecto (`workspaces` en la base): tiene su propio árbol de páginas. */
export interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
  /**
   * Quien creó el proyecto (`workspaces.owner_id`): tiene 4 sobre él mientras sea miembro activo. Falta en
   * un proyecto creado en el dispositivo que todavía no volvió del servidor (lo creó esta persona) y en
   * las copias guardadas por versiones anteriores de la app.
   */
  owner_id?: string | null;
  /**
   * Cuándo se archivó (`workspaces.archived_at`, versión 9 de la base, P.14); `null` o ausente: no está
   * archivado. Archivar es solo orden: sale de la lista de todos los días, con los mismos permisos.
   */
  archived_at?: string | null;
  /**
   * La carpeta del proyecto en la papelera de Drive (versión 10 de la base, P.14 entrega 2): cuándo se pidió
   * mandarla y, si se restauró sin ella porque Drive ya no la tenía, cuándo. Con `drive_missing_at`, el dueño o
   * un admin que lo maneja puede buscarla de nuevo (*Look for its files again*). Ausentes con una base anterior.
   */
  drive_trash_requested_at?: string | null;
  drive_missing_at?: string | null;
}

/** Una fila de `trashed_projects` (P.14): un proyecto en la papelera de proyectos que la sesión veía. */
export interface TrashedProjectRow {
  id: string;
  name: string;
  archived_at: string | null;
  deleted_at: string;
  /** Quién lo borró: solo a quien lo maneja y al dueño y los admins (si no, `null`). */
  deleted_by: string | null;
  deleted_by_email: string | null;
  /** Días que faltan para los 30 (30 el día que entra, 0 después; se sigue pudiendo restaurar). */
  days_left: number;
  /** La sesión lo puede restaurar (`private.can_manage_project`). */
  can_restore: boolean;
  /** Solo a quien lo maneja; si no, `null`. */
  pages: number | null;
  files: number | null;
  /**
   * La carpeta en la papelera de Drive (versión 10, solo a quien lo maneja): pedida, confirmada por el portero, o
   * restaurado antes sin ella. `null` con una base anterior o sin pedido.
   */
  drive_trash_requested_at: string | null;
  drive_trashed_at: string | null;
  drive_missing_at: string | null;
  /** La sesión puede mandar o traer su carpeta (dueño o admin que lo maneja, `private.can_purge_project`). */
  can_purge: boolean;
}

/** Lo que muestra la ventana de borrar (`project_delete_info`, P.14). */
export interface ProjectDeleteInfo {
  /** Páginas fuera de la papelera de páginas y en ella. */
  pages: number;
  trashed_pages: number;
  /** Archivos subidos fuera de la papelera de Drive, y su peso. */
  files: number;
  drive_bytes: number;
  /** Archivos todavía sin subir que usa alguna página. */
  pending_files: number;
  /** Archivos del proyecto que usan páginas vivas de otros proyectos: dejan de verse ahí mientras esté borrado. */
  used_elsewhere: number;
  /** Archivos de otros proyectos que solo usa este: quedan en la papelera de su proyecto mientras esté borrado. */
  foreign_only_here: number;
  /** Con cuántas personas activas está compartido (sin contar a quien pregunta). */
  shared_with: number;
}

export interface NewProject {
  id: string;
  name: string;
}

/**
 * Un cambio del árbol hecho en el dispositivo, en la cola de salida hasta que el servidor lo confirma.
 * Los proyectos van en la misma cola: uno nuevo sube antes que sus páginas.
 */
export type TreeOp =
  | { kind: 'create'; page: NewPage }
  | {
      kind: 'update';
      id: string;
      patch: PagePatch;
      /**
       * Las claves de `patch.settings` que este cambio puso o sacó (`PageTree.setSetting`). Con ellas el servidor
       * fusiona esas claves con lo que tenga (`patch_page_settings`) en vez de reemplazar el objeto entero, y el cambio de
       * otra clave que llegó desde otro dispositivo no se pisa. Sin el campo (un cambio guardado por una versión anterior,
       * o uno que rehace la fila entera): `patch.settings` reemplaza todo, como siempre. `patch.settings` va siempre
       * completo, para una base que todavía no tiene la función.
       */
      settingsKeys?: string[];
    }
  | { kind: 'createProject'; project: NewProject }
  | { kind: 'renameProject'; id: string; name: string };

export interface QueuedOp {
  seq?: number;
  opId: string;
  op: TreeOp;
  createdAt: number;
}

export interface FailedOp {
  seq?: number;
  /** Posición que tenía en la cola: al reintentar vuelve a ese lugar. */
  opSeq?: number;
  op: TreeOp;
  error: string;
  /** Cuándo falló, con el reloj del dispositivo: solo para mostrarlo. Nunca decide nada contra el reloj del servidor. */
  failedAt: number;
  /**
   * El `updated_at` que tenía la página en la copia del dispositivo al fallar (reloj del servidor, salvo que el
   * dispositivo la haya tocado al confirmar un cambio suyo). `null`: la página no estaba en la copia. Sin el campo: lo
   * guardó una versión anterior a 0.153. Dice si la fila cambió después del rechazo (`PageTree.titleChangedAfter`).
   */
  rowUpdatedAt?: string | null;
}

/** Los ajustes del workspace (`workspace_settings`): una sola fila que la app lee en cada sincronización. */
export interface WorkspaceSettings {
  /** Sube cuando se restaura una copia de seguridad: cada dispositivo vuelve a subir todo lo suyo. */
  generation: number;
  /** Versión mínima de la app que puede subir contenido (como en el changelog: 0.021). */
  minAppVersion: number | null;
  schemaVersion: number;
  /** Dirección del portero de archivos del workspace (ver portero/); `null` si todavía no hay. */
  mediaUrl: string | null;
  /** El dueño del workspace (el único que conecta su Drive); `null` si la base todavía no lo tiene. */
  ownerId?: string | null;
  /** Nombre del workspace (`name`); `null` si la base todavía no lo tiene. */
  name?: string | null;
  /** Clave local del workspace (`local_key`), la que viaja en los links de invitación. */
  localKey?: string | null;
  /**
   * El borrado automático de la papelera de archivos a los 30 días (`auto_purge_files`, paso 11). Apagado
   * hasta que Lega lo confirme; `false` también si la base todavía no tiene la columna.
   */
  autoPurgeFiles?: boolean;
  /**
   * El interruptor de la privacidad de lo borrado (`clean_min_version`, versión 12 de la base): `null`, apagado (todos
   * bajan las filas); con un número, quien no ve lo borrado baja solo bases, y las arman las versiones desde esa.
   */
  cleanMinVersion?: number | null;
  /**
   * El interruptor de los snapshots de compactar (`snapshot_min_version`, versión 17 de la base): `null`, apagados (todos
   * bajan con `pull_page_updates`, como siempre); con un número, se baja con `pull_page_content`.
   */
  snapshotMinVersion?: number | null;
  /**
   * El interruptor de *Can edit* por un link público (`link_edit_min_version`, versión 19 de la base): `null`, apagado
   * (los links editan como *Can view* y nadie admite); con un número, las versiones desde esa escriben por un link y,
   * las que arman bases, admiten lo que espera en la sala (Docs/Doc_Link_Publico.md, entrega 2).
   */
  linkEditMinVersion?: number | null;
}

/** Un archivo nuevo para `register_file` (el proyecto sale de la página). */
export interface NewMediaFile {
  id: string;
  pageId: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
}

/** Lo que la app lee de `files`. */
export interface MediaFileRow {
  id: string;
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumb_at: string | null;
  drive_id: string | null;
  /** El peso en bytes (`files.size`). Opcional: lo que se guardó antes no lo tiene. */
  size?: number | null;
  /**
   * La papelera de archivos (versión 6 de la base; en una anterior faltan): desde cuándo ninguna página lo
   * usa, cuándo un dueño o admin pidió mandarlo a la papelera de Drive y cuándo el portero lo confirmó.
   */
  trashed_at?: string | null;
  purged_at?: string | null;
  drive_trashed_at?: string | null;
  /** El proyecto del archivo. */
  project_id?: string | null;
}

/**
 * Un uso de un archivo que el servidor ya tiene (una fila de `page_files` que la sesión ve). `removed_at` e
 * `is_foreign` son de la versión 6 de la base; en una anterior faltan (todo uso está activo y es propio).
 */
export interface PageUseRow {
  page_id: string;
  file_id: string;
  removed_at?: string | null;
  is_foreign?: boolean;
}

/**
 * Un archivo de la lista por peso (P.8, Docs/Doc_Peso_Proyectos.md): una fila de `files` que la sesión ve y que
 * ocupa lugar en el Drive (subida y fuera de la papelera de Drive).
 */
export interface SizedFileRow {
  id: string;
  name: string;
  mime: string;
  size: number;
  thumb_at: string | null;
  /** Desde cuándo ninguna página viva lo usa (está en la papelera de archivos); `null` si alguna lo usa. */
  trashed_at: string | null;
}

/** Una fila de `trashed_files`: un archivo en la papelera que todavía no llegó a la papelera de Drive. */
export interface TrashedFileRow {
  id: string;
  name: string;
  mime: string;
  size: number;
  thumb_at: string | null;
  /** Cuándo entró a la papelera. */
  trashed_at: string;
  /** Cuántos días faltan para los 30 (30 el día que entra, 0 si ya pasaron). */
  days_left: number;
  /** Ya se pidió mandarlo a la papelera de Drive y el portero todavía no lo confirmó (se puede repetir). */
  purged_at: string | null;
  /**
   * Lo usa una página que está en la papelera de páginas (ella o una de arriba): restaurarla lo vuelve a
   * usar, salvo que ya se haya mandado a la papelera de Drive. Falta en una base sin esa columna.
   */
  in_trashed_page?: boolean;
  /** El título de esa página. */
  trashed_page_title?: string | null;
  /**
   * Lo usa una página de un proyecto borrado (versión 9, P.14): no se puede mandar a la papelera de Drive
   * hasta que ese proyecto se restaure (`purge_file` da `file_in_deleted_project`). Falta en una base anterior.
   */
  in_deleted_project?: boolean;
}

/**
 * Una fila de `project_sizes` (versión 7 de la base, P.7): cuánto ocupa un proyecto en el Drive, en bytes y
 * archivos. Cada archivo cuenta en un solo lugar. `drive_*` es el número principal: lo que la app tiene en
 * Drive fuera de la papelera de Drive (en uso más la papelera de la app, que también viene sola en
 * `trash_*`). `drive_trash_*`: en la papelera de Drive hace menos de 30 días (ocupa hasta que Google la
 * vacía). `pending_*`: registrado y todavía sin subir. Con `project_id` nulo (solo al dueño), el total de los
 * proyectos que no ve.
 */
export interface ProjectSizeRow {
  project_id: string | null;
  drive_bytes: number;
  drive_files: number;
  trash_bytes: number;
  trash_files: number;
  drive_trash_bytes: number;
  drive_trash_files: number;
  pending_bytes: number;
  pending_files: number;
}

/** Una fila de `files_due_for_purge`. */
export interface DueFileRow {
  id: string;
  name: string;
  trashed_at: string;
}

export interface RemoteUpdate {
  seq: number;
  data: Uint8Array;
  /**
   * Si esta fila es un snapshot (`pull_page_content`): su id. Junta las filas `1..seq` del servidor; para el dispositivo es
   * un update más, salvo que si no se puede leer no se guarda nada del lote (Docs/Doc_Compactar.md, sección 5).
   */
  snapshotId?: string;
  /** La época de contenido de la página, leída en la misma consulta (`pull_page_content`). */
  contentEpoch?: number;
  /**
   * La huella SHA-256 (hex) que la base guardó de este snapshot (`pull_page_content` con la versión, entrega 3, O-D): el
   * dispositivo la comprueba antes de aplicarlo. Sin ella (una base sin la migración), no se comprueba.
   */
  snapshotSha256?: string;
}

/** `permanent`: reintentar no va a cambiar el resultado (permisos, ciclo, datos inválidos). */
export class RemoteError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    readonly code?: string,
    /** No hubo respuesta del servidor: no hay red. */
    readonly network = false,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

/** Un link público sin el nombre del visitante: lo escrito o comentado espera en el dispositivo hasta que lo escriba. */
export const AUTHOR_MISSING = 'author_missing';

export function isPermanent(err: unknown): boolean {
  return err instanceof RemoteError && err.permanent;
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof RemoteError && err.network;
}

/** La consulta venció su tope de tiempo (ver `timed` en remote.ts). Cuenta como sin red: se reintenta. */
export const REQUEST_TIMEOUT = 'request_timeout';

/**
 * Cuántos archivos distintos seguidos tienen que trabarse (vencer su tope sin avanzar) para que una pasada deje de
 * subir: con el servidor colgado para todos, cada uno esperaría su tope entero (un minuto o más). Uno solo no
 * alcanza: puede estar colgado solo ese, y cortar haría que la pasada siguiente empezara otra vez por él.
 */
export const STALLS_TO_CLOSE_ROUND = 2;

/** Lo más que se espera para volver a probar un servidor colgado para todos. */
export const MAX_STALL_WAIT_MS = 10 * 60_000;

/**
 * Cuánto se espera para volver a probar después de cerrar la pasada `count` veces seguidas por un servidor colgado
 * para todos: 10 s, 20 s, 40 s… hasta 10 minutos. La misma escala que la cola de archivos (`stallPause` en
 * src/media/queue.ts); la usan las carpetas y las imágenes de `page-files`.
 */
export function stallWait(count: number): number {
  return Math.min(10_000 * 2 ** Math.max(0, count - 1), MAX_STALL_WAIT_MS);
}

/** Una consulta que venció su tope (o se cortó): la red anda, pero muy lenta para lo que se pidió. */
export function isTimeout(err: unknown): boolean {
  return err instanceof RemoteError && (err.code === REQUEST_TIMEOUT || /^(AbortError|TimeoutError)\b/.test(err.message));
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
