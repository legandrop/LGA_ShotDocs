// El portero de archivos de un workspace: un Worker de Cloudflare en la cuenta del dueño. Guarda la
// conexión con el Drive del dueño (nadie más la recibe), sube los archivos a su Drive y los devuelve en
// streaming, con pedidos por partes (Range), para que un video se reproduzca sin bajarlo entero.
//
// Quién pide algo lo decide el Supabase del workspace: el portero le pregunta con la sesión de la persona
// (`media_whoami`, `media_file`, `set_file_drive`, `purge_file`, `media_purged`), así que no necesita
// ninguna clave de la base. Para los videos, que el navegador pide sin sesión, el portero entrega un pase
// firmado que vence.
//
// Permisos: conectar Drive, elegir la carpeta y lo de la prueba de media (`/upload` sin `file`, `/pass`
// con `fileId`) solo el dueño. Subir y ver un archivo de la app (`file`) depende del nivel de la persona
// sobre ese archivo, según las páginas que lo usan (`media_file`): subir pide 3 (editar), ver pide 1.
// Mandar un archivo de la papelera de la app a la papelera de Drive (`/trash`) lo decide la base
// (`purge_file`): solo el dueño y los admins. Nunca se borra nada en Drive: solo se manda a su papelera.

import { handleMcp, isMcpPath, tokenClientId } from './mcp';

export interface Env {
  /** Dirección y clave publicable del Supabase del workspace (las dos son públicas). */
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  /** Direcciones de la app que pueden hablar con el portero, separadas por comas. */
  APP_ORIGINS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Clave de API de Google para el selector de carpetas (Picker). Sin ella, la carpeta va a la raíz. */
  GOOGLE_API_KEY?: string;
  /**
   * `1` prende los modos de prueba de `/project/trash` y `/project/untrash` (solo el dueño), para la prueba técnica de
   * P.14 (Doc_Portero.md). Apagado (sin la variable) en el día a día.
   */
  TEST_MODES?: string;
  /**
   * `1` prende el servidor MCP de la prueba técnica M0 (`/mcp` y su metadata, mcp.ts; Doc_Asistente.md, "Cómo quedó
   * M0"). Apagado (sin la variable) el portero hace exactamente lo de antes con esas rutas.
   */
  MCP_M0?: string;
  /** Hasta cuántos KB de página lee el MCP (de fábrica 16, el plan gratis de Workers; mcp.ts). */
  MCP_MAX_PAGE_KB?: string;
}

/** Lo que el portero guarda (la conexión con Drive, las subidas en curso). Ver index.ts. */
export interface Store {
  /**
   * La llave de lo que se recuerda en la memoria de la instancia (P.9): la misma en todos los pedidos aunque cada
   * uno tenga su `Store` (index.ts). Sin ella, el propio `Store`.
   */
  memoryKey?: object;
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

// Lo guardado, por clave. Las de antes (`google`, `accessToken`, `passSecret`, `upload:*`, `state:*`) se
// leen igual que siempre; lo nuevo va en claves nuevas o en campos opcionales.

/** `google`: la conexión con el Drive del dueño y las carpetas de la app. */
interface Google {
  refreshToken: string;
  email?: string;
  rootFolder?: string;
  testFolder?: string;
  /** La conexión dejó de andar (el dueño la revocó o venció): hay que volver a conectar. */
  broken?: string;
}

/** `drivePlace`: la carpeta que eligió el dueño para `LGA_ShotDocs`. Sin la clave: la raíz de su Drive. */
interface Place {
  id: string;
  name: string;
}

/** `upload:<id>`: una subida en curso (o terminada, por si la app perdió la respuesta). */
interface Upload {
  session: string;
  user: string;
  size: number;
  createdAt: number;
  /** Ya terminó: si la app perdió la respuesta de la última parte y pregunta, se le contesta esto. */
  done?: DriveFile;
  /** El archivo de la app (`files.id`) que se sube; sin él, es de la prueba de media. */
  file?: string;
  /** `set_file_drive` ya respondió bien (o la base ya tenía el archivo subido). */
  linked?: boolean;
  /** Un archivo de una carpeta (P.9, cifrado en el id): la fila de la carpeta, para volver a mirar el permiso. */
  folder?: string;
}

/** `file:<uuid>`: lo que el portero sabe de un archivo de la app. */
interface FileRecord {
  /** Lo que subió el portero (aunque la base todavía no lo sepa). */
  drive?: DriveFile;
  /** `set_file_drive` ya respondió bien. */
  linked?: boolean;
  /** El id de Drive cuyo `appProperties.sdFile` ya se comprobó que es este archivo. */
  verified?: string;
  /** El id de Drive que el portero ya mandó a la papelera de Drive (`/trash` o al terminar una subida). */
  trashed?: string;
  /**
   * Una carpeta (P.9): quién la creó en Drive. Solo esa persona sube adentro: el nivel de `media_file` es el más
   * alto entre las páginas que usan la carpeta, y pegar su bloque en una página propia lo subiría.
   */
  creator?: string;
}

/** `project:<project_id>`: la carpeta del proyecto y el nombre que le puso la app. */
interface ProjectFolder {
  id: string;
  name: string;
}
// `day:<project_id>:<AAAA-MM-DD>`: el id de la carpeta del día (texto).

/**
 * `projectTrash:<project_id>`: la carpeta de un proyecto borrado que el portero mandó (o intentó mandar) a la
 * papelera de Drive (P.14, entrega 2; Docs/Doc_Proyectos_Borrar.md, sección 3.8). Se escribe ANTES de cada `PATCH`
 * (la intención, no el resultado) y se acumula: cada intento suma sus ids, nunca reemplaza. Así, aunque Drive
 * cumpla un `PATCH` y la respuesta se pierda, la carpeta queda anotada y `/project/untrash` la trae.
 */
interface ProjectTrash {
  /** La cuenta de Google conectada al mandar: traer o decir `missing` con otra cuenta no vale. */
  email: string | null;
  /** `workspaces.drive_trash_requested_at` del pedido al que pertenece este registro. */
  requestedAt: string;
  folders: string[];
  /** Lo que respondió el envío que terminó (`none`: el proyecto nunca tuvo carpeta). */
  result?: 'trashed' | 'missing' | 'none';
}

/** Lo que devuelve `media_project` (migración 10): `null` si la sesión no puede mandar ni traer su carpeta. */
interface MediaProject {
  id: string;
  name: string;
  deleted_at: string | null;
  drive_trash_requested_at: string | null;
  drive_trashed_at: string | null;
  drive_missing_at: string | null;
}

/** Una carpeta de Drive como la devuelven `files.get` y `files.list` con los campos que pide el portero. */
interface DriveFolder {
  id: string;
  name?: string;
  trashed?: boolean;
  /** Cuándo fue a la papelera. Google lo documenta solo para unidades compartidas: puede no venir. */
  trashedTime?: string;
  /** Cuándo se creó: una carpeta viva creada después del pedido es otra (la de una subida nueva), no la del pedido. */
  createdTime?: string;
  appProperties?: Record<string, string>;
}

/** La respuesta de `/project/trash` y `/project/untrash`. */
export interface ProjectDriveResult {
  status: 'done';
  project: string;
  drive: 'trashed' | 'untrashed' | 'missing' | 'none';
  /** Cuántas carpetas del proyecto quedaron en la papelera (`trash`) o volvieron (`untrash`). */
  folders: number;
}

/**
 * Caché del arranque del video, por id de Drive. Cada punta tiene su descripción, que se escribe una sola
 * vez y entera (nunca se lee, se cambia y se vuelve a guardar): `cache:<id>:head` (desde el byte 0) y
 * `cache:<id>:tail` (los últimos `length` bytes). Sus trozos van en `cache:<id>:<size>:h<n>` y
 * `cache:<id>:<size>:t<n>`: la clave dice de qué archivo, de qué peso y de qué lugar son los bytes, así
 * que dos pedidos que se pisan nunca pueden hacer servir bytes de otro lado.
 *
 * `cacheSlot:<n>` dice qué archivo ocupa cada uno de los `CACHE_FILES` lugares (el lugar sale del id).
 * Solo se sirve desde la caché el archivo que ocupa su lugar: lo que quedó de uno desplazado no se usa
 * nunca, y se reescribe si ese archivo vuelve a ocupar su lugar.
 *
 * `cache:<id>` (sin más): el peso aprendido de un archivo de la prueba de media, cuyo pase no lo trae.
 */
interface CacheZone {
  size: number;
  length: number;
  type?: string;
  etag?: string;
  modified?: string;
}

/** Lo que devuelve `media_file` del Supabase del workspace (`null` si la persona no lo puede ver). */
interface MediaFile {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  mime: string;
  size: number;
  drive_id: string | null;
  created_at: string;
  level: number;
  /** Papelera de archivos (desde la migración del paso 11; antes no vienen). */
  trashed_at?: string | null;
  purged_at?: string | null;
  drive_trashed_at?: string | null;
  /** Quién agregó el archivo (`files.created_by`; desde la migración de carpetas, P.9; antes no viene). */
  created_by?: string | null;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

interface Who {
  userId: string;
  isOwner: boolean;
  /** El encabezado `Authorization` de la persona, para preguntarle a la base con su sesión. */
  auth: string;
  /**
   * Un visitante con un link público (Docs/Doc_Link_Publico.md, 3.9): el token del header `x-shotdocs-link`. La base lo
   * valida en cada pregunta (`plink_media_file`); `auth` es entonces la clave publicable, nunca una sesión.
   */
  link?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
/** Nombres de carpeta sin espacios: guiones bajos, y el de la app igual al del repo. */
const ROOT_FOLDER = 'LGA_ShotDocs';
const TEST_FOLDER = 'Media_Test';
/** Los nombres con espacios de v0.022–v0.026: una carpeta que todavía se llame así se renombra sola. */
const OLD_NAMES: Record<string, string> = { [ROOT_FOLDER]: 'LGA Shot Docs', [TEST_FOLDER]: 'Media test' };
/** Un pase de reproducción dura esto: si vence en medio de un video, la reproducción se corta. */
const PASS_MS = 8 * 60 * 60 * 1000;
/** Los pases de un link público duran menos (P17): revocar el link corta antes lo ya abierto. */
const LINK_PASS_MS = 2 * 60 * 60 * 1000;
/** El token de un link público: `sdl_` y 43 caracteres base64url. */
const LINK_TOKEN = /^sdl_[A-Za-z0-9_-]{43}$/;
/** Lo único que un link público (Can view) le pide al portero: pases, comprobar archivos, listar carpetas y el estado. */
const LINK_ROUTES = new Set(['POST /pass', 'POST /verify', 'POST /folder/list', 'GET /drive/status']);
/** Una parte de subida no puede pasar esto (el plan gratis de Workers acepta hasta 100 MB por pedido). */
const MAX_CHUNK = 64 * 1024 * 1024;
/** Tope del nombre de un archivo en un pase, en caracteres (el de casi todos los sistemas). */
const NAME_MAX = 255;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[\w-]{10,200}$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MIME = /^[\w.+-]+\/[\w.+-]+$/;

/**
 * Caché del arranque del video. Cada valor del almacenamiento del portero puede pesar hasta 128 KiB: los
 * trozos son de 127 KiB para que, con lo que agrega el almacenamiento al guardarlos, no lleguen al tope.
 * Por archivo se guardan 2 trozos del principio (~254 KiB: el encabezado del video) y 4 del final
 * (~508 KiB: el índice, que los videos del iPhone llevan al final). Un archivo que entra entero en esos
 * ~762 KiB se guarda entero. Como mucho `CACHE_FILES` archivos (~190 MiB en total): cada archivo tiene
 * un lugar fijo (sale de su id) y el que llega desplaza al que estaba en ese lugar.
 */
export const CACHE_PIECE = 127 * 1024;
export const CACHE_HEAD_PIECES = 2;
export const CACHE_TAIL_PIECES = 4;
export const CACHE_FILES = 256;

/** Carpetas que se están buscando o creando en este momento: dos subidas a la vez no crean dos iguales. */
const pending = new Map<string, Promise<string>>();

/** Lo que responde `/verify` por cada archivo: lo que dice Drive, o el error con su `code`. */
type VerifyResult =
  | { driveId: string; size: number; trashed: boolean; marked: boolean; md5: string | null }
  | { error: string; code: string };

/**
 * Lo que este portero sabe hacer además de lo de siempre (`/drive/status`, `features`): `verify`, `known`, `offline`
 * y `codes` (Doc_Copias_Locales.md) y `folders` (P.9: la app no ofrece soltar carpetas a uno anterior).
 */
export const FEATURES = ['verify', 'known', 'offline', 'codes', 'folders'] as const;
/** Cuántos archivos por `POST /verify`: dos pedidos cada uno (base y Drive) más la sesión y el token, en 50. */
export const VERIFY_MAX = 15;

// --- carpetas (P.9, Docs/Doc_Carpetas.md) -------------------------------------------------------------

/** El tipo de la fila de `files` de una carpeta de la app. Lo de adentro es de Drive y no tiene filas. */
export const APP_FOLDER_MIME = 'inode/directory';
/** Adentro de la carpeta del proyecto, donde van las carpetas que se sueltan en las páginas. */
const FOLDERS_DIR = 'Carpetas';
/**
 * Lo más que se crea o se abre en un pedido: el plan gratis de Workers deja 50 llamados afuera por pedido y cada
 * pedido ya usa unos pocos (la sesión, la base, el token, el árbol).
 */
export const FOLDER_BATCH = 30;
/**
 * Lo más que un pedido de carpetas le pide a Drive: con la sesión, la base, el token y el almacenamiento queda
 * debajo de los 50 llamados afuera del plan gratis. Lo que no entra vuelve como `later` (o sin crear) y la app lo
 * pide en el pedido siguiente; cada pedido avanza al menos una cosa.
 */
export const DRIVE_CALL_BUDGET = 36;
/** Una subcarpeta comprobada adentro del árbol se vuelve a comprobar pasado esto (el dueño puede moverla afuera). */
export const TREE_TTL_MS = 10 * 60_000;
/**
 * Cuántas subcarpetas lista de una vez `POST /folder/list` con `dirs` (el recorrido de *Download all*): una sola
 * consulta a Drive con `'a' in parents or 'b' in parents`. Cada una se comprueba por separado (un llamado a Drive
 * cada una, dentro de `DRIVE_CALL_BUDGET`), así que las que no entran vuelven como `later`.
 */
export const LIST_DIRS_MAX = 40;
/**
 * En un listado de varias subcarpetas, la que Drive mostró adentro de su carpeta de arriba hace menos que esto (en su
 * metadata o en el listado de esa) no se vuelve a mirar en Drive, en la primera página y en las siguientes: el
 * listado de una sola subcarpeta (`dir`) la mira siempre.
 * Sin esto, 40 subcarpetas serían 40 llamados a Drive antes de listar nada y casi siempre quedarían algunas para
 * después.
 */
export const LIST_TRUST_MS = 60_000;
/**
 * Los motivos de un 403 de Drive que piden ir más despacio (no dicen nada del permiso): el límite por usuario o por
 * proyecto (`userRateLimitExceeded`, `rateLimitExceeded`) y el del día (`dailyLimitExceeded`, `quotaExceeded`).
 */
const DRIVE_SLOW_DOWN = /rateLimitExceeded|dailyLimitExceeded|^quotaExceeded$/i;
/** Lo más hondo que se sube por los `parents` buscando la carpeta de la app. */
const TREE_DEPTH = 30;
/** Una dirección de subida de Drive vale una semana: se deja de usar un día antes. */
const SESSION_MAX_MS = 6 * 24 * 60 * 60_000;
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
/**
 * Los campos y el tamaño de cada página de `/folder/list`. 100 por pedido: cada archivo lleva su pase firmado y el
 * plan gratis da 10 ms de CPU por pedido (300 se midieron en ~9,5 ms en una computadora; falta medirlo en Cloudflare).
 */
const LIST_FIELDS = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,hasThumbnail,parents)';
const LIST_PAGE = '100';
interface DriveListed {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  hasThumbnail?: boolean;
  parents?: string[];
}
interface DriveListPage {
  nextPageToken?: string;
  files?: DriveListed[];
}
/** El lado de las miniaturas que sirve `/t/` (Drive las hace del tamaño que se le pide). */
const THUMB_SIDE = 320;

/**
 * Lo que el portero recuerda en la memoria de la instancia (no en el almacenamiento): por carpeta de la app, las
 * subcarpetas ya comprobadas adentro de su árbol y cuándo. Va por `Store.memoryKey` (la misma en todos los pedidos
 * de la instancia, index.ts) o, sin ella, por el `Store`, para que dos porteros distintos (las pruebas) no se mezclen.
 *   - `at`: hasta cuándo vale la comprobación (`TREE_TTL_MS`), con la fecha de la más vieja del camino hasta la
 *     carpeta: lo de abajo no dura más que lo de arriba.
 *   - `seen`: cuándo Drive mostró por última vez a esa subcarpeta adentro de su carpeta de arriba (su metadata, o en
 *     el listado de la de arriba). De esto sale la confianza corta del listado de varias (`LIST_TRUST_MS`): con `at`,
 *     una subcarpeta honda se volvía a mirar en cada pedido (heredaba la fecha vieja de las de arriba) y, en las
 *     páginas siguientes de un listado, no se podía pedir lo mismo sin pasarse del tope de llamados.
 */
interface TreeMemory {
  at: Map<string, number>;
  seen: Map<string, number>;
}
const memory = new WeakMap<object, Map<string, TreeMemory>>();
/** Lo más que se recuerda por carpeta (pasado esto se empieza de nuevo: solo cuesta volver a comprobar). */
const TREE_MEMORY_MAX = 20_000;

/**
 * El nombre en el Drive del dueño de una carpeta que soltó el usuario y de sus subcarpetas: sin espacios, nunca
 * (D3 → B, 2026-10-02, como todas las carpetas que crea la app): cada tramo de espacios pasa a un `_`, así que
 * `Día 2 - Puerto` queda `Día_2_-_Puerto`. Lo demás es el nombre del usuario: tildes, eñes y emojis se conservan, y
 * los guiones bajos que ya traía no se tocan (ni se juntan). Se saca lo que saca `cleanFileName`, igual que la app:
 * controles, marcas de dirección y los de ancho cero (también U+200C; el U+200D solo se queda entre dos emojis, así
 * que el de una familia sigue siendo uno); las barras van como `_`. Se corta en 200 caracteres sin partir un grafema
 * (`cutText`) y se le sacan los espacios de los bordes antes de pasarlos a `_` (nunca queda un `_` de más al
 * principio ni al final). Vacío, `Folder`. Las subidas hechas entre v0.089 y esta versión quedaron con espacios
 * (`Día 2 - Puerto`) y no se renombran: cada carpeta se encuentra por su marca (`sdFile`, `sdPath`), nunca por el nombre.
 */
export function driveFolderName(name: string): string {
  return cutText(cleanFileName(name), 200).trim().replace(/\s+/g, '_') || 'Folder';
}

/**
 * Una ruta relativa de una subcarpeta (`Fotos/Dia_2`): partes no vacías, sin `.` ni `..`, sin barra al principio,
 * hasta `TREE_DEPTH` niveles. Una barra invertida es parte del nombre (en Mac y Linux es válida): en Drive va `_`.
 * La marca de cada subcarpeta (`pathMark`) sale de esta ruta, con los nombres como los manda la app.
 * La app aplica las mismas reglas antes de mandar nada (src/media/folderRead.ts, `folderPathOk`).
 */
export function validFolderPath(path: unknown): path is string {
  if (typeof path !== 'string' || !path || path.length > 2000) return false;
  const parts = path.split('/');
  return parts.length <= TREE_DEPTH && parts.every((p) => p !== '' && p !== '.' && p !== '..' && !/[\u0000-\u001f]/.test(p));
}

function parentPath(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

/** La ruta resumida (cabe en los 124 bytes de una `appProperties` de Drive). */
async function markOf(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return b64url(hash).slice(0, 22);
}

/**
 * Lo que marca a una subcarpeta creada por la app (`appProperties.sdPath`): la ruta en NFC, resumida. La Mac da los
 * acentos en dos partes (`i` y el acento: NFD) y Windows en una (`í`, NFC): sin normalizar, la misma carpeta soltada
 * desde el otro sistema tenía otra marca y se creaba otra vez al lado, con el mismo nombre.
 */
function pathMark(path: string): Promise<string> {
  return markOf(path.normalize('NFC'));
}

/**
 * Las marcas con las que se busca una subcarpeta que ya existe: la de ahora (NFC) y las que pudo dejar un portero
 * anterior, que resumía la ruta tal cual llegaba (NFD desde la Mac, NFC desde Windows). Las subcarpetas ya creadas
 * conservan su marca: nada se renombra ni se vuelve a marcar en el Drive del dueño.
 */
async function pathMarks(path: string): Promise<string[]> {
  const forms = new Set([path.normalize('NFC'), path, path.normalize('NFD')]);
  return [...new Set(await Promise.all([...forms].map(markOf)))];
}

/** Cuántas marcas van en una consulta a Drive (cada una suma unos 60 caracteres a la dirección). */
const MARKS_PER_QUERY = 40;

/** Una consulta de Drive con un valor adentro de comillas simples. */
function quoted(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

/**
 * El reloj de Google y el de la base pueden no coincidir: una carpeta que fue a la papelera hasta este tiempo antes
 * del pedido (`drive_trash_requested_at`) igual cuenta como mandada por ese pedido.
 */
export const CLOCK_MARGIN_MS = 5 * 60_000;

/** Lo que se está haciendo con la carpeta de cada proyecto: mandar y traer, de a uno por proyecto. */
const projectWork = new Map<string, Promise<unknown>>();

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Un código fijo para que la app decida sin leer el texto (los de `/trash`, `abusive`, `drive_full`). */
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * El Drive del dueño está lleno (`storageQuotaExceeded`): un código fijo para que la app no siga
 * reintentando sola hasta que el dueño libere espacio.
 */
function driveFull(): HttpError {
  return new HttpError(507, 'The Google Drive of the workspace owner is full: free up space in it and try again.', 'drive_full');
}

// --- utilidades -------------------------------------------------------------------------------------

/** La misma cuenta de Google (sin distinguir mayúsculas; sin correo de los dos lados, también). */
function sameAccount(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

/** Drive está conectado a otra cuenta que la que se usó para mandar la carpeta: no se toca nada. */
function otherAccount(): HttpError {
  return new HttpError(
    409,
    'Google Drive is connected to another account: connect the one this project used to restore its files.',
    'drive_other_account',
  );
}

/** Un error de `/project/trash` o `/project/untrash` sin código (Drive que no contesta, la red) sale con uno. */
function withProjectCode(err: unknown): never {
  if (err instanceof HttpError && err.code) throw err;
  if (err instanceof HttpError) {
    throw new HttpError(err.status, err.message, err.status === 401 ? 'session_expired' : 'drive_failed');
  }
  throw new HttpError(502, `Google Drive did not answer (${err instanceof Error ? err.message : String(err)}).`, 'drive_failed');
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function randomId(bytes = 24): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** La clave de los pases ya importada (un listado de una carpeta firma cientos): por clave, en la instancia. */
const hmacKeys = new Map<string, Promise<CryptoKey>>();

async function hmac(secret: string, data: string): Promise<string> {
  let key = hmacKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', fromB64url(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(secret, key);
  }
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await key, new TextEncoder().encode(data))));
}

/**
 * La clave con la que el portero cifra las direcciones de subida de los archivos de una carpeta (sale de la de
 * los pases y nunca sale del portero): así no guarda nada por archivo y el navegador no ve la dirección de Google.
 */
async function sealKey(secret: string): Promise<CryptoKey> {
  const material = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`folder-upload:${secret}`)));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function seal(secret: string, data: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const box = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(secret), plain));
  return `f.${b64url(iv)}.${b64url(box)}`;
}

/** Lo cifrado con `seal`, o `null` si no es de este portero (o lo tocaron). */
async function unseal<T>(secret: string, text: string): Promise<T | null> {
  const [tag, iv, box] = text.split('.');
  if (tag !== 'f' || !iv || !box) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await sealKey(secret), fromB64url(box));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function origins(env: Env): string[] {
  return (env.APP_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean);
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  if (!origins(env).includes(origin.toLowerCase())) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Range, Range, x-shotdocs-link, x-shotdocs-device',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/**
 * Lo que se sirve con un pase (`/m/…`), leíble desde la app: la app lo baja con `fetch` para la imagen nítida
 * de la página (v0.059, src/ui/sharpImages.ts). Solo para los orígenes de `APP_ORIGINS`; `Vary: Origin` siempre,
 * así la caché del navegador no le da a `fetch` la respuesta sin CORS que pidió un `<img>` (sin `Origin`, como
 * el carrete y las versiones anteriores, que siguen igual).
 */
function withMediaCors(res: Response, req: Request, env: Env): Response {
  const vary = res.headers.get('Vary');
  if (!vary?.split(/,\s*/).includes('Origin')) res.headers.set('Vary', vary ? `${vary}, Origin` : 'Origin');
  const origin = req.headers.get('Origin') ?? '';
  if (origin && origins(env).includes(origin.toLowerCase())) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type, Content-Disposition, ETag');
  }
  return res;
}

function json(req: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req, env) },
  });
}

/** El cuerpo JSON del pedido; `{}` si no trae o no se puede leer (las versiones viejas mandan `{}`). */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * El nombre de la carpeta de un proyecto en Drive: sin espacios (guiones bajos) y sin caracteres raros
 * (barras, dos puntos, comodines, emojis). Conserva letras con acento, números y `- . , ( ) & + '`.
 */
export function folderName(name: string): string {
  const clean = Array.from(
    name
      .normalize('NFC')
      .replace(/[^\p{L}\p{M}\p{N}\s_\-.,()&+']/gu, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[_.]+|[_.]+$/g, ''),
  )
    .slice(0, 100)
    .join('');
  return clean || 'Project';
}

/** El día de hoy (UTC) como `AAAA-MM-DD`, si la app no manda uno. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- el portero -------------------------------------------------------------------------------------

export class Portero {
  private accessToken: { token: string; until: number } | null = null;
  private passSecret: string | null = null;
  /** Llamados a Drive en este pedido (cada pedido crea un Portero nuevo): ver `DRIVE_CALL_BUDGET`. */
  private driveCalls = 0;

  constructor(
    private readonly env: Env,
    private readonly store: Store,
    // `fetch` guardado suelto y llamado como método pierde su `this`, y Workers lo corta ("Illegal
    // invocation"): se llama siempre como la función global.
    private readonly http: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req, this.env) });
      const path = url.pathname;
      if (path === '/health') return json(req, this.env, { ok: true });
      if (path === '/drive/callback' && req.method === 'GET') return await this.callback(url);
      const pass = /^\/m\/([^/]+)$/.exec(path)?.[1];
      if (pass && (req.method === 'GET' || req.method === 'HEAD')) return withMediaCors(await this.media(req, pass), req, this.env);
      // La miniatura de un archivo de una carpeta (P.9), con el mismo pase que el archivo.
      const thumb = /^\/t\/([^/]+)$/.exec(path)?.[1];
      if (thumb && (req.method === 'GET' || req.method === 'HEAD')) return withMediaCors(await this.thumbnail(req, thumb), req, this.env);
      // El servidor MCP (prueba técnica M0), solo con su interruptor prendido: valida su propio token (mcp.ts).
      if (this.env.MCP_M0 === '1' && isMcpPath(path)) {
        return await handleMcp(req, this.env, { http: this.http, stateSecret: () => this.mcpStateSecret() });
      }

      const who = await this.whoami(req);
      // Con un link público, solo lo de ver (nunca lo del dueño, subir ni la papelera).
      if (who.link && !LINK_ROUTES.has(`${req.method} ${path}`)) {
        throw new HttpError(403, 'This is not available through a link.', 'link_denied');
      }
      if (path === '/drive/status' && req.method === 'GET') return json(req, this.env, await this.status(who));
      // Subir y ver: con `file`, según el nivel de la persona sobre el archivo; sin él, solo el dueño.
      if (path === '/upload' && req.method === 'POST') return json(req, this.env, await this.startUpload(req, who));
      const upload = /^\/upload\/([^/]+)$/.exec(path)?.[1];
      if (upload && req.method === 'PUT') return json(req, this.env, await this.uploadChunk(req, upload, who));
      if (path === '/pass' && req.method === 'POST') return json(req, this.env, await this.makePass(req, who));
      // Antes de liberar la copia de un dispositivo: qué dice Drive hoy de cada archivo (Doc_Copias_Locales.md).
      if (path === '/verify' && req.method === 'POST') return json(req, this.env, await this.verify(req, who));
      // A la papelera de Drive: lo decide la base con la sesión de la persona (dueño y admins).
      if (path === '/trash' && req.method === 'POST') return json(req, this.env, await this.trashFile(req, who));
      // Carpetas (P.9, Docs/Doc_Carpetas.md): crear el árbol y abrir las subidas (nivel 3), listar (nivel 1).
      if (path === '/folder/prepare' && req.method === 'POST') return json(req, this.env, await this.folderPrepare(req, who));
      if (path === '/folder/sessions' && req.method === 'POST') return json(req, this.env, await this.folderSessions(req, who));
      if (path === '/folder/list' && req.method === 'POST') return json(req, this.env, await this.folderList(req, who));
      // La carpeta entera de un proyecto borrado (P.14, entrega 2): lo decide la base (dueño y admins que lo manejan).
      if (path === '/project/trash' && req.method === 'POST') return json(req, this.env, await this.trashProject(req, who));
      if (path === '/project/untrash' && req.method === 'POST') return json(req, this.env, await this.untrashProject(req, who));

      if (!who.isOwner) throw new HttpError(403, 'Only the owner of the workspace can do this for now.');
      // Solo mirar (la prueba técnica de P.14, Doc_Proyectos_Borrar.md, sección 3.9): la carpeta de un proyecto en Drive.
      if (path === '/project/inspect' && req.method === 'GET') return json(req, this.env, await this.inspectProject(url));
      if (path === '/drive/connect' && req.method === 'POST') return json(req, this.env, await this.connect(req));
      if (path === '/drive/picker' && req.method === 'POST') return json(req, this.env, await this.picker());
      if (path === '/drive/folder' && req.method === 'POST') return json(req, this.env, await this.chooseFolder(req));
      throw new HttpError(404, 'Not found');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof HttpError ? err.code : undefined;
      return json(req, this.env, code ? { error: message, code } : { error: message }, status);
    }
  }

  // --- la base del workspace, con la sesión de la persona ------------------------------------------

  private rpc(auth: string, fn: string, args: unknown, link?: string): Promise<Response> {
    return this.http(`${this.env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: this.env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: auth,
        'Content-Type': 'application/json',
        ...(link ? { 'x-shotdocs-link': link } : {}),
      },
      body: JSON.stringify(args),
    });
  }

  /** Lo que dura un pase para esta persona (o este link). */
  private passMs(who: Who): number {
    return who.link ? LINK_PASS_MS : PASS_MS;
  }

  // Quién es: la sesión de Supabase de la persona, validada por el propio Supabase.
  private async whoami(req: Request): Promise<Who> {
    // Un link público: con el header del link nunca se usa (ni se reenvía) un `Authorization` que venga en el pedido.
    const link = req.headers.get('x-shotdocs-link');
    if (link !== null) {
      if (!LINK_TOKEN.test(link)) throw new HttpError(401, 'This link does not work anymore.', 'link_not_found');
      return { userId: 'plink', isOwner: false, auth: `Bearer ${this.env.SUPABASE_PUBLISHABLE_KEY}`, link };
    }
    const auth = req.headers.get('Authorization') ?? '';
    if (!/^Bearer \S+$/.test(auth)) throw new HttpError(401, 'Sign in to the app first.');
    // El token de un asistente conectado por MCP (lo tiene un tercero) solo sirve en `/mcp`: nunca para pases,
    // subidas, carpetas ni la papelera. Las sesiones de la app no traen `client_id`. Vale con el MCP prendido o no
    // (Doc_Asistente.md, 9.2, plan B, punto 3).
    if (tokenClientId(auth) !== null) throw new HttpError(403, 'This sign-in is for an assistant connection and only works with it.', 'assistant_token');
    const res = await this.rpc(auth, 'media_whoami', {});
    if (res.status === 401 || res.status === 403) throw new HttpError(401, 'Your session expired: sign in again.');
    if (!res.ok) throw new HttpError(502, `The workspace did not answer (${res.status}).`);
    const who = (await res.json()) as { user_id: string | null; is_owner: boolean };
    if (!who.user_id) throw new HttpError(401, 'Sign in to the app first.');
    return { userId: who.user_id, isOwner: who.is_owner === true, auth };
  }

  /** El archivo de la app y el nivel de la persona sobre él; `null` si no existe o no lo puede ver. */
  private async mediaFile(who: Who, file: string): Promise<MediaFile | null> {
    const res = who.link
      ? await this.rpc(who.auth, 'plink_media_file', { p_file: file }, who.link)
      : await this.rpc(who.auth, 'media_file', { p_file_id: file });
    if (who.link && !res.ok) {
      // La base contesta `link_not_found` (revocado, vencido, reseteado: P0002, que PostgREST da como 404) o
      // `link_rate_limited` (un tope del día); una base sin la migración, PGRST202.
      const error = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
      if (error?.code === 'PGRST202') throw new HttpError(502, 'The workspace database is not up to date for links yet.');
      if (error?.message === 'link_rate_limited') throw new HttpError(429, 'This link has been used a lot today.', 'link_rate_limited');
      if (res.status >= 500 && error?.message !== 'link_not_found') throw new HttpError(502, `The workspace did not answer (${res.status}).`);
      throw new HttpError(401, 'This link does not work anymore.', 'link_not_found');
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(401, 'Your session expired: sign in again.');
    if (res.status === 404) throw new HttpError(502, 'The workspace database is not up to date for files yet.');
    if (!res.ok) throw new HttpError(502, `The workspace did not answer (${res.status}).`);
    const media = (await res.json()) as MediaFile | null;
    return media && typeof media === 'object' && media.id ? media : null;
  }

  /**
   * Le dice a la base en qué archivo de Drive quedó (`set_file_drive`), con la sesión de la persona. Si
   * falla por la red o la base, queda anotado y se intenta de nuevo la próxima vez que se pregunte por ese
   * archivo (subida o pase). Devuelve si quedó hecho.
   */
  private async linkFile(who: Who, file: string, drive: DriveFile): Promise<boolean> {
    let linked = false;
    try {
      const res = await this.rpc(who.auth, 'set_file_drive', { p_file_id: file, p_drive_id: drive.id });
      if (res.ok) linked = true;
      else {
        const error = (await res.json().catch(() => null)) as { message?: string } | null;
        // Otro dispositivo ya lo subió y quedó ese: lo de acá es una copia de más; no hay nada que hacer.
        if (error?.message?.includes('file_already_uploaded')) linked = true;
      }
    } catch {
      linked = false;
    }
    const rec = (await this.store.get<FileRecord>(`file:${file}`)) ?? {};
    await this.store.put(`file:${file}`, { ...rec, drive, linked, verified: rec.verified ?? drive.id } satisfies FileRecord);
    if (linked) await this.trashIfPurged(who, file, drive);
    return linked;
  }

  /**
   * Si un dueño o admin mandó el archivo a la papelera mientras su subida seguía en curso (`/trash` respondió
   * `drive: 'none'`), lo que acaba de subir el portero va derecho a la papelera de Drive (nunca se borra) y
   * se confirma con `media_purged`, con la sesión de quien subió (la base lo deja a quien edita el archivo).
   * Si algo falla no corta la subida: queda pendiente y se termina pidiendo `/trash` de nuevo.
   */
  private async trashIfPurged(who: Who, file: string, drive: DriveFile): Promise<void> {
    try {
      const media = await this.mediaFile(who, file);
      if (!media?.purged_at) return;
      const res = await this.driveTrash(drive.id);
      if (res === 'failed') return;
      await this.rememberTrashed(file, drive.id);
      await this.rpc(who.auth, 'media_purged', { p_file: file });
    } catch {
      // queda pendiente: `/trash` lo termina
    }
  }

  private async status(who: Who): Promise<unknown> {
    const google = await this.store.get<Google>('google');
    const place = who.isOwner ? await this.store.get<Place>('drivePlace') : undefined;
    return {
      connected: !!google && !google.broken,
      broken: google?.broken ?? null,
      email: who.isOwner ? (google?.email ?? null) : null,
      isOwner: who.isOwner,
      folder: place ? { id: place.id, name: place.name } : null,
      picker: !!this.env.GOOGLE_API_KEY,
      // Lo que entiende este portero, para que la app no le pida lo que no sabe hacer (Doc_Copias_Locales.md):
      // `verify` (POST /verify), `known` (`only: 'known'` en /upload), `offline` (`?offline=1` en /m/), `codes`
      // (los errores de /pass, /m/ y /verify traen un `code` fijo) y `folders` (P.9: soltar carpetas).
      features: [...FEATURES],
    };
  }

  // --- conectar el Drive del dueño -----------------------------------------------------------------

  private async connect(req: Request): Promise<{ url: string }> {
    const origin = req.headers.get('Origin') ?? '';
    if (!origins(this.env).includes(origin.toLowerCase())) throw new HttpError(403, 'This app address is not allowed.');
    const body = await readBody(req);
    // A qué ruta de la app vuelve Google: solo una ruta de la misma app (`/…`), nunca otra dirección.
    const ret = typeof body.return === 'string' ? body.return : '';
    const back = /^\/(?![/\\])[^\s\\]{0,300}$/.test(ret) ? ret : '/media-test';
    // Google vuelve a esta dirección del portero, que tiene que estar cargada en el cliente de Google.
    const redirect = `${new URL(req.url).origin}/drive/callback`;
    const state = randomId();
    await this.store.put(`state:${state}`, { origin, redirect, until: Date.now() + 15 * 60_000, back });
    const params = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirect,
      response_type: 'code',
      scope: `openid email ${SCOPE}`,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  }

  private async callback(url: URL): Promise<Response> {
    const stateId = url.searchParams.get('state') ?? '';
    const state = stateId
      ? await this.store.get<{ origin: string; redirect: string; until: number; back?: string }>(`state:${stateId}`)
      : undefined;
    if (!state || state.until < Date.now()) {
      return new Response('This link expired. Go back to the app and connect Google Drive again.', { status: 400 });
    }
    await this.store.delete(`state:${stateId}`);
    const back = (result: string) => {
      let target = new URL('/media-test', state.origin);
      try {
        const chosen = new URL(state.back ?? '/media-test', state.origin);
        if (chosen.origin === new URL(state.origin).origin) target = chosen;
      } catch {
        // una ruta que no se puede leer: vuelve a la de siempre
      }
      target.searchParams.set('drive', result);
      return Response.redirect(target.href, 302);
    };
    const code = url.searchParams.get('code');
    if (!code) return back(url.searchParams.get('error') ?? 'cancelled');

    const res = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.env.GOOGLE_CLIENT_ID,
        client_secret: this.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: state.redirect,
        grant_type: 'authorization_code',
      }),
    });
    const token = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
      scope?: string;
      error?: string;
    };
    if (!res.ok || !token.refresh_token || !token.access_token) return back(token.error ?? 'no-refresh-token');
    // Google deja destildar cada permiso en la pantalla de consentimiento: sin Drive no hay conexión.
    if (!(token.scope ?? '').split(' ').includes(SCOPE)) return back('drive-permission-missing');

    const email = token.id_token ? readEmail(token.id_token) : undefined;
    const previous = await this.store.get<Google>('google');
    await this.store.put('google', { refreshToken: token.refresh_token, email, rootFolder: previous?.rootFolder, testFolder: previous?.testFolder });
    // Otra cuenta de Google: la carpeta elegida era del Drive de la anterior.
    if (previous?.email && email && previous.email !== email) await this.store.delete('drivePlace');
    await this.keepAccessToken(token.access_token, token.expires_in);
    return back('connected');
  }

  /** Pide a Google un token de acceso con la conexión guardada (`scope`: uno más chico, opcional). */
  private async refresh(scope?: string): Promise<{ token: string; expiresIn?: number }> {
    const google = await this.store.get<Google>('google');
    if (!google || google.broken) throw new HttpError(409, 'Google Drive is not connected.', 'drive_not_connected');
    const res = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.GOOGLE_CLIENT_ID,
        client_secret: this.env.GOOGLE_CLIENT_SECRET,
        refresh_token: google.refreshToken,
        grant_type: 'refresh_token',
        ...(scope ? { scope } : {}),
      }),
    });
    const token = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (res.status === 400 && token.error === 'invalid_grant') {
      await this.store.put('google', { ...google, broken: 'The connection with Google Drive stopped working: connect it again.' });
      throw new HttpError(409, 'The connection with Google Drive stopped working: connect it again.', 'drive_not_connected');
    }
    if (!res.ok || !token.access_token) throw new HttpError(502, `Google did not answer (${token.error ?? res.status}).`);
    return { token: token.access_token, expiresIn: token.expires_in };
  }

  /** Un token de acceso de Google vigente, renovado con la conexión guardada si hace falta. */
  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.until > Date.now()) return this.accessToken.token;
    // Cada pedido crea un Portero nuevo (index.ts): el token vigente se guarda para no pedirle uno nuevo a
    // Google en cada parte de un video.
    const saved = await this.store.get<{ token: string; until: number }>('accessToken');
    if (saved && saved.until > Date.now()) {
      this.accessToken = saved;
      return saved.token;
    }
    const fresh = await this.refresh();
    await this.keepAccessToken(fresh.token, fresh.expiresIn);
    return fresh.token;
  }

  private async keepAccessToken(token: string, expiresIn = 3600): Promise<void> {
    this.accessToken = { token, until: Date.now() + (expiresIn - 120) * 1000 };
    await this.store.put('accessToken', this.accessToken);
  }

  private async drive(path: string, init: RequestInit = {}): Promise<Response> {
    this.driveCalls++;
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await this.token()}`);
    return this.http(path.startsWith('https://') ? path : `${DRIVE}${path}`, { ...init, headers });
  }

  // --- elegir dónde va la carpeta de la app (solo el dueño) -----------------------------------------

  /**
   * Lo que necesita el selector de carpetas de Google en el navegador del dueño. El token es uno nuevo,
   * de una hora y solo con `drive.file`; el dueño ya es dueño de ese Drive.
   */
  private async picker(): Promise<{ apiKey: string; appId: string; token: string }> {
    const apiKey = this.env.GOOGLE_API_KEY;
    if (!apiKey) throw new HttpError(404, 'The Google folder picker is not set up in the media server (GOOGLE_API_KEY).');
    let token: string;
    try {
      token = (await this.refresh(SCOPE)).token;
    } catch (err) {
      // Si Google no da un token más chico, el de siempre (tiene los mismos permisos sobre Drive).
      if (err instanceof HttpError && err.status === 409) throw err;
      token = await this.token();
    }
    return { apiKey, appId: this.env.GOOGLE_CLIENT_ID.split('-')[0] ?? '', token };
  }

  /** Guarda dónde va `LGA_ShotDocs` (`null`: la raíz) y, si la carpeta ya existe, la mueve ahí. */
  private async chooseFolder(req: Request): Promise<{ folder: Place | null }> {
    const body = await readBody(req);
    const parentId = body.parentId;
    if (parentId !== null && (typeof parentId !== 'string' || !DRIVE_ID.test(parentId))) {
      throw new HttpError(400, 'Missing the folder.');
    }
    let place: Place | null = null;
    if (parentId) {
      const res = await this.drive(`/files/${encodeURIComponent(parentId)}?fields=id,name,mimeType,trashed`);
      if (res.status === 404 || res.status === 403) {
        throw new HttpError(400, 'Could not open that folder: choose it again with the Google picker.');
      }
      if (!res.ok) throw new HttpError(502, `Could not check that folder in Google Drive (${res.status}).`);
      const found = (await res.json()) as { name?: string; mimeType?: string; trashed?: boolean };
      if (found.mimeType !== FOLDER_MIME || found.trashed) throw new HttpError(400, 'Choose a folder that is not in the trash.');
      place = { id: parentId, name: found.name ?? '' };
    }
    const previous = (await this.store.get<Place>('drivePlace')) ?? null;
    const google = await this.store.get<Google>('google');
    if (!google || google.broken) throw new HttpError(409, 'Google Drive is not connected.', 'drive_not_connected');
    if (google.rootFolder && (previous?.id ?? null) !== (place?.id ?? null)) await this.moveRoot(google.rootFolder, place);
    if (place) await this.store.put('drivePlace', place);
    else await this.store.delete('drivePlace');
    return { folder: place };
  }

  /** Mueve la carpeta de la app adentro de la elegida. Si ya no existe, no hay nada que mover. */
  private async moveRoot(root: string, place: Place | null): Promise<void> {
    const res = await this.drive(`/files/${encodeURIComponent(root)}?fields=id,parents,trashed`);
    if (res.status === 404) return;
    if (!res.ok) throw new HttpError(502, `Could not check the folder "${ROOT_FOLDER}" in Google Drive (${res.status}).`);
    const found = (await res.json()) as { parents?: string[]; trashed?: boolean };
    if (found.trashed) return;
    const parents = found.parents ?? [];
    if (place && parents.includes(place.id)) return;
    const params = new URLSearchParams({ addParents: place?.id ?? 'root', fields: 'id,parents' });
    if (parents.length) params.set('removeParents', parents.join(','));
    const moved = await this.drive(`/files/${encodeURIComponent(root)}?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!moved.ok) throw new HttpError(502, `Could not move the folder "${ROOT_FOLDER}" in Google Drive (${moved.status}).`);
  }

  // --- carpetas ------------------------------------------------------------------------------------

  /** Una sola búsqueda o creación a la vez por carpeta (dos subidas juntas no crean dos iguales). */
  private once(key: string, work: () => Promise<string>): Promise<string> {
    const running = pending.get(key);
    if (running) return running;
    const started = work().finally(() => pending.delete(key));
    pending.set(key, started);
    return started;
  }

  /** La carpeta de la app (`LGA_ShotDocs`), en la carpeta que eligió el dueño o en la raíz. La crea si falta. */
  private rootFolder(): Promise<string> {
    return this.once('root', async () => {
      const google = await this.store.get<Google>('google');
      if (!google || google.broken) throw new HttpError(409, 'Google Drive is not connected.', 'drive_not_connected');
      const place = await this.store.get<Place>('drivePlace');
      const root = await this.folder(google.rootFolder, ROOT_FOLDER, place?.id ?? null);
      if (root !== google.rootFolder) {
        const latest = (await this.store.get<Google>('google')) ?? google;
        await this.store.put('google', { ...latest, rootFolder: root });
      }
      return root;
    });
  }

  /** La carpeta de pruebas, adentro de la carpeta de la app en el Drive del dueño. La crea si falta. */
  private async testFolder(): Promise<string> {
    const root = await this.rootFolder();
    return this.once('test', async () => {
      const google = (await this.store.get<Google>('google'))!;
      const test = await this.folder(google.testFolder, TEST_FOLDER, root);
      if (test !== google.testFolder) await this.store.put('google', { ...google, testFolder: test });
      return test;
    });
  }

  /**
   * `LGA_ShotDocs / <Proyecto> / <AAAA-MM-DD>`. Si el proyecto cambió de nombre, su carpeta se renombra,
   * pero solo si todavía tiene el nombre que le puso la app (si el dueño la renombró a mano, se respeta).
   */
  private async dayFolder(media: MediaFile, day: string): Promise<string> {
    const project = await this.projectFolder(media);
    return this.once(`day:${media.project_id}:${day}`, async () => {
      const key = `day:${media.project_id}:${day}`;
      const saved = await this.store.get<string>(key);
      if (saved) {
        const found = await this.look(saved, day);
        if (found && !found.trashed) return saved;
      }
      const id = await this.create(day, project);
      await this.store.put(key, id);
      return id;
    });
  }

  /** `LGA_ShotDocs / <Proyecto>`, renombrada si el proyecto cambió de nombre (ver `dayFolder`). */
  private async projectFolder(media: MediaFile): Promise<string> {
    const root = await this.rootFolder();
    return this.once(`project:${media.project_id}`, async () => {
      const key = `project:${media.project_id}`;
      const want = folderName(media.project_name ?? '');
      const saved = await this.store.get<ProjectFolder>(key);
      if (saved) {
        const found = await this.look(saved.id, want);
        if (found && !found.trashed) {
          if (found.name === saved.name && saved.name !== want) {
            const res = await this.drive(`/files/${encodeURIComponent(saved.id)}?fields=id`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: want }),
            });
            // Si falla, se intenta de nuevo en la próxima subida.
            if (res.ok) await this.store.put(key, { id: saved.id, name: want } satisfies ProjectFolder);
          }
          return saved.id;
        }
      }
      const id = await this.create(want, root, { sdProject: media.project_id });
      await this.store.put(key, { id, name: want } satisfies ProjectFolder);
      return id;
    });
  }

  /** Cómo está una carpeta que ya conocemos; `null` si ya no existe. Un error pasajero no es "no existe". */
  private async look(id: string, name: string): Promise<{ name?: string; trashed?: boolean } | null> {
    const res = await this.drive(`/files/${encodeURIComponent(id)}?fields=id,name,trashed`);
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpError(502, `Could not check the folder "${name}" in Google Drive (${res.status}).`);
    return (await res.json()) as { name?: string; trashed?: boolean };
  }

  private async create(name: string, parent: string | null, appProperties?: Record<string, string>): Promise<string> {
    const res = await this.drive('/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}), ...(appProperties ? { appProperties } : {}) }),
    });
    if (res.status === 404 && parent) {
      throw new HttpError(409, `The folder where "${name}" goes is not available anymore: choose another one.`);
    }
    if (!res.ok) throw new HttpError(502, `Could not create the folder "${name}" in Google Drive (${res.status}).`);
    return ((await res.json()) as { id: string }).id;
  }

  private async folder(known: string | undefined, name: string, parent: string | null): Promise<string> {
    if (known) {
      const found = await this.look(known, name);
      if (found && !found.trashed) {
        // Solo si conserva el nombre viejo: si el dueño la renombró a mano, se respeta. Si falla, se
        // intenta de nuevo en la próxima subida.
        if (OLD_NAMES[name] !== undefined && found.name === OLD_NAMES[name]) {
          await this.drive(`/files/${known}?fields=id`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          });
        }
        return known;
      }
    }
    return this.create(name, parent);
  }

  // --- subir (por partes, se puede retomar) ---------------------------------------------------------

  private async startUpload(req: Request, who: Who): Promise<unknown> {
    const body = await readBody(req);
    if (body.file !== undefined) return this.startFileUpload(body, who);
    // Sin `file`: la prueba de media, solo el dueño, a `Media_Test`.
    if (!who.isOwner) throw new HttpError(403, 'Only the owner of the workspace can do this for now.');
    const size = Number(body.size);
    if (typeof body.name !== 'string' || !body.name || !Number.isSafeInteger(size) || size <= 0) {
      throw new HttpError(400, 'Missing the file name or size.');
    }
    const folder = await this.testFolder();
    const mime = typeof body.mime === 'string' && body.mime ? body.mime : 'application/octet-stream';
    return { uploadId: await this.openUpload(who, { name: body.name.slice(0, 250), parents: [folder] }, mime, size) };
  }

  /** Un archivo de la app: hace falta poder editar alguna página que lo usa (`level >= 3`). */
  private async startFileUpload(body: Record<string, unknown>, who: Who): Promise<unknown> {
    const file = typeof body.file === 'string' ? body.file.toLowerCase() : '';
    if (!UUID.test(file)) throw new HttpError(400, 'Missing the file.');
    const day = body.day === undefined ? today() : body.day;
    if (typeof day !== 'string' || !DAY.test(day)) throw new HttpError(400, 'The day must look like 2026-09-30.');
    const media = await this.mediaFile(who, file);
    if (!media) throw new HttpError(404, 'This file does not exist or you cannot see it.', 'not_found');
    // Una carpeta (P.9) no se sube como un archivo: su Drive lo crea `/folder/prepare`.
    if (media.mime === APP_FOLDER_MIME) throw new HttpError(409, 'This is a folder: drop it again to upload its files.', 'is_folder');
    if (media.level < 3) throw new HttpError(403, 'You cannot add files to this page.');
    const size = Number(media.size);
    if (body.size !== undefined && Number(body.size) !== size) throw new HttpError(400, 'The size does not match the file.');

    const rec = (await this.store.get<FileRecord>(`file:${file}`)) ?? {};
    if (media.drive_id) {
      // La base ya lo tiene en Drive: se comprueba (una vez) que ese archivo de Drive sea de verdad este.
      const mark = await this.checkMark(file, media.drive_id, rec);
      if (mark === 'missing') throw new HttpError(409, 'The Drive file for this upload is gone: ask the workspace owner.');
      if (mark === 'other') throw new HttpError(409, 'This file is registered with a different Drive file: ask the workspace owner.');
      return { status: 'done', file: { id: media.drive_id, name: media.name, mimeType: media.mime, size }, linked: true };
    }
    // Ya se subió pero la base no se enteró (se cortó la red al avisarle): se le avisa ahora.
    if (rec.drive) {
      const linked = await this.linkFile(who, file, rec.drive);
      return { status: 'done', file: rec.drive, linked };
    }
    // El portero no lo recuerda (perdió `file:<id>`, o lo subió otra instancia), pero puede estar en Drive con la
    // marca de este archivo (Doc_Copias_Locales.md, sección 10, entrega 2): se busca por la marca antes de abrir una
    // subida (no queda dos veces en Drive) y antes de responder `unknown` (una copia liberada en el dispositivo, después
    // de restaurar la base, se vuelve a enlazar sin mandar bytes).
    const marked = await this.findMarked(file, size);
    if (marked && marked !== 'failed') {
      const linked = await this.linkFile(who, file, marked);
      return { status: 'done', file: marked, linked };
    }
    // La app solo pregunta si el portero recuerda la subida (la copia del dispositivo se liberó): sin bytes que
    // mandar, no se crea la carpeta del día ni se abre una sesión de Drive que quedaría abandonada. Si la búsqueda
    // falló no se sabe: 502 (la app vuelve a preguntar), nunca `unknown`.
    if (body.only === 'known') {
      if (marked === 'failed') throw new HttpError(502, 'Could not look for the file in Google Drive.', 'drive_failed');
      return { status: 'unknown' };
    }
    // Una subida con bytes sigue como antes de la búsqueda aunque Drive no la haya contestado (o la rechace): la
    // búsqueda solo evita un duplicado, y una subida cortada por ella sería peor.

    const folder = await this.dayFolder(media, day);
    const name = (typeof body.name === 'string' && body.name ? body.name : media.name || 'file').slice(0, 250);
    const mime = media.mime || (typeof body.mime === 'string' && body.mime) || 'application/octet-stream';
    const meta = { name, parents: [folder], appProperties: { sdFile: file } };
    return { uploadId: await this.openUpload(who, meta, mime, size, file) };
  }

  /**
   * El archivo de Drive que lleva la marca de este archivo de la app (`appProperties.sdFile`), fuera de la papelera
   * y con el mismo peso, o `null`. Con `drive.file`, Drive solo devuelve lo que creó la app. Un pedido. `failed` si
   * Drive no contestó bien o rechazó la búsqueda (quien llama decide: una subida sigue igual).
   */
  private async findMarked(file: string, size: number): Promise<DriveFile | null | 'failed'> {
    const q = `appProperties has { key='sdFile' and value=${quoted(file)} } and trashed = false and mimeType != ${quoted(FOLDER_MIME)}`;
    let found: { id?: unknown; name?: unknown; mimeType?: unknown; size?: unknown }[];
    try {
      const res = await this.drive(`/files?${new URLSearchParams({ q, fields: 'files(id,name,mimeType,size)', pageSize: '10' })}`);
      if (!res.ok) return 'failed';
      found = ((await res.json()) as { files?: typeof found }).files ?? [];
    } catch {
      return 'failed';
    }
    // Del mismo peso: una subida de Drive recién crea el archivo al terminar, así que uno marcado está entero.
    const twin = found.find((f) => typeof f.id === 'string' && Number(f.size) === size);
    if (!twin) return null;
    return {
      id: twin.id as string,
      name: typeof twin.name === 'string' ? twin.name : '',
      mimeType: typeof twin.mimeType === 'string' ? twin.mimeType : '',
      size,
    };
  }

  private async openUpload(who: Who, meta: object, mime: string, size: number, file?: string): Promise<string> {
    const res = await this.drive(`${UPLOAD}/files?uploadType=resumable&fields=id,name,mimeType,size`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify(meta),
    });
    const session = res.headers.get('Location');
    if (res.status === 403 && (await driveReasons(res)).includes('storageQuotaExceeded')) throw driveFull();
    if (!res.ok || !session) throw new HttpError(502, `Google Drive did not start the upload (${res.status}).`);
    const uploadId = randomId();
    const upload: Upload = { session, user: who.userId, size, createdAt: Date.now(), ...(file ? { file } : {}) };
    await this.store.put(`upload:${uploadId}`, upload);
    return uploadId;
  }

  /**
   * Pasa una parte a Drive. `Content-Range: bytes 0-8388607/123456789` con la parte, o
   * `bytes *\/123456789` sin cuerpo para preguntar cuánto llegó (para retomar).
   */
  private async uploadChunk(req: Request, uploadId: string, who: Who): Promise<unknown> {
    // Un archivo de una carpeta (P.9): la subida viene cifrada en el id y no hay nada guardado.
    const sealed = uploadId.startsWith('f.');
    const upload = sealed ? await this.folderUpload(uploadId) : await this.store.get<Upload>(`upload:${uploadId}`);
    if (!upload || upload.user !== who.userId) throw new HttpError(404, 'This upload does not exist anymore: start it again.');
    if (sealed && Date.now() - upload.createdAt > SESSION_MAX_MS) throw new HttpError(410, 'This upload expired: start it again.');
    if (!sealed && !upload.file && !who.isOwner) throw new HttpError(403, 'Only the owner of the workspace can do this for now.');
    if (upload.done) return this.finish(uploadId, upload, upload.done, who);
    const range = req.headers.get('Content-Range') ?? '';
    const part = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    const ask = /^bytes \*\/(\d+)$/.exec(range);
    if (!part && !ask) throw new HttpError(400, 'Missing Content-Range.');
    if (ask && Number(ask[1]) !== upload.size) throw new HttpError(400, 'The size does not match the upload.');
    const body = part ? await req.arrayBuffer() : new ArrayBuffer(0);
    if (part) {
      const [start, end, total] = part.slice(1).map(Number);
      if (total !== upload.size || end < start || body.byteLength !== end - start + 1 || body.byteLength > MAX_CHUNK) {
        throw new HttpError(400, 'The part does not match the upload.');
      }
      // La última parte de un archivo de una carpeta crea el archivo en Drive: antes se vuelve a mirar que la persona
      // todavía pueda subir ahí (sacada de la página o del workspace, la subida queda sin terminar).
      if (sealed && upload.folder && end + 1 === total) await this.appFolder(who, upload.folder, 3);
    }
    const res = await this.http(upload.session, {
      method: 'PUT',
      headers: { 'Content-Range': range, 'Content-Length': String(body.byteLength) },
      body,
    });
    if (res.status === 308) {
      const got = /bytes=0-(\d+)/.exec(res.headers.get('Range') ?? '');
      return { status: 'incomplete', received: got ? Number(got[1]) + 1 : 0 };
    }
    if (res.status === 200 || res.status === 201) {
      const file = (await res.json()) as { id: string; name: string; mimeType: string; size?: string };
      const done = { id: file.id, name: file.name, mimeType: file.mimeType, size: Number(file.size ?? upload.size) };
      // Lo de una carpeta no tiene fila en la base ni nada guardado: si la respuesta se pierde, Drive contesta lo
      // mismo a la pregunta de cuánto llegó.
      if (sealed) return { status: 'done', file: done };
      // Se recuerda: si la respuesta no llega, la app pregunta y no vuelve a subir todo.
      await this.store.put(`upload:${uploadId}`, { ...upload, done } satisfies Upload);
      return this.finish(uploadId, { ...upload, done }, done, who);
    }
    if (res.status === 404 || res.status === 410) {
      if (!sealed) await this.store.delete(`upload:${uploadId}`);
      throw new HttpError(410, 'Google Drive dropped this upload: start it again.');
    }
    // Drive pide ir más despacio: la app espera y sigue (los archivos de una carpeta pueden ser miles).
    if (res.status === 429) throw new HttpError(503, 'Google Drive asked to slow down: trying again shortly.', 'rate');
    // La subida queda guardada: cuando el dueño libere espacio, la app la retoma desde lo que llegó.
    if (res.status === 403 && (await driveReasons(res)).includes('storageQuotaExceeded')) throw driveFull();
    throw new HttpError(502, `Google Drive answered ${res.status} to a part of the upload.`);
  }

  /** La subida terminó. Si es un archivo de la app, se le dice a la base dónde quedó (una vez). */
  private async finish(uploadId: string, upload: Upload, done: DriveFile, who: Who): Promise<unknown> {
    if (!upload.file) return { status: 'done', file: done };
    if (upload.linked) return { status: 'done', file: done, linked: true };
    const linked = await this.linkFile(who, upload.file, done);
    if (linked) await this.store.put(`upload:${uploadId}`, { ...upload, done, linked } satisfies Upload);
    return { status: 'done', file: done, linked };
  }

  // --- mandar a la papelera de Drive (papelera de archivos, paso 11) ---------------------------------

  /**
   * Manda un archivo de la papelera de la app a la papelera de Drive (nunca lo borra: Drive lo guarda 30
   * días). Con la sesión de la persona y en este orden:
   *   1. `media_file`: que exista y la persona lo vea; si la base ya tiene la confirmación, listo.
   *   2. Drive conectado (un token vigente) y, si el archivo está en Drive, que lleve la marca de este
   *      (`appProperties.sdFile`). Si algo de esto falla no se pide nada a la base: el archivo queda en la
   *      papelera de la app como estaba.
   *   3. `purge_file`: la base decide si puede (solo dueño y admins) y si está en la papelera, y lo marca.
   *   4. `media_file` de nuevo: tiene que decir que está en la papelera y pedido.
   *   5. Drive: `trashed: true`. 6. `media_purged`.
   * Pedirlo de nuevo no hace nada de más. Los errores llevan un `code` fijo (Doc_Portero.md).
   */
  private async trashFile(req: Request, who: Who): Promise<{ status: 'done'; file: string; drive: 'trashed' | 'missing' | 'none' }> {
    const body = await readBody(req);
    const file = typeof body.file === 'string' ? body.file.toLowerCase() : '';
    if (!UUID.test(file)) throw new HttpError(400, 'Missing the file.', 'bad_request');

    let media = await this.trashStep('db_error', () => this.mediaFile(who, file));
    if (!media) throw new HttpError(404, 'This file does not exist or you cannot see it.', 'not_found');
    const rec = (await this.store.get<FileRecord>(`file:${file}`)) ?? {};
    // Si la base todavía no sabe su id de Drive pero el portero lo subió, se usa el que subió.
    const drive = media.drive_id ?? rec.drive?.id ?? null;
    // Ya confirmado y, si hay archivo en Drive, ya mandado por el portero: listo, sin ir a Drive. (Si se
    // confirmó sin archivo y la subida terminó después sin poder mandarlo, se manda ahora.)
    if (media.drive_trashed_at && (!drive || rec.trashed === drive)) return { status: 'done', file, drive: drive ? 'trashed' : 'none' };

    await this.driveReady();
    let mark: 'ok' | 'missing' | 'other' | null = null;
    if (drive) {
      // Solo el archivo de Drive que lleva la marca de este: nunca otro archivo del Drive del dueño.
      mark = await this.trashStep('drive_failed', () => this.checkMark(file, drive, rec));
      if (mark === 'other') {
        throw new HttpError(403, 'This file in Google Drive does not belong to this file of the app.', 'drive_mismatch');
      }
    }

    await this.trashRpc(who, 'purge_file', file);
    media = await this.trashStep('db_error', () => this.mediaFile(who, file));
    if (!media?.trashed_at || !media.purged_at) {
      throw new HttpError(502, 'The workspace did not mark this file for the trash.', 'db_error');
    }

    let result: 'trashed' | 'missing' | 'none' | 'failed' = 'none';
    if (drive) {
      result = mark === 'ok' ? await this.driveTrash(drive) : 'missing';
      if (result === 'failed') throw new HttpError(502, 'Could not send the file to the Google Drive trash.', 'drive_failed');
      await this.rememberTrashed(file, drive);
    }
    await this.trashRpc(who, 'media_purged', file);
    return { status: 'done', file, drive: result as 'trashed' | 'missing' | 'none' };
  }

  private async rememberTrashed(file: string, drive: string): Promise<void> {
    const rec = (await this.store.get<FileRecord>(`file:${file}`)) ?? {};
    await this.store.put(`file:${file}`, { ...rec, trashed: drive } satisfies FileRecord);
  }

  /** Hay conexión con Drive y un token vigente; si no, `503 drive_not_connected`. */
  private async driveReady(): Promise<void> {
    const google = await this.store.get<Google>('google');
    const notConnected = () =>
      new HttpError(503, 'Google Drive is not connected: the workspace owner has to connect it.', 'drive_not_connected');
    if (!google || google.broken) throw notConnected();
    try {
      await this.token();
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) throw notConnected();
      throw new HttpError(502, err instanceof Error ? err.message : String(err), 'drive_failed');
    }
  }

  /** Manda un archivo a la papelera de Drive. `missing` si en Drive ya no está; `failed` si Drive falló. */
  private async driveTrash(id: string): Promise<'trashed' | 'missing' | 'failed'> {
    const res = await this.drive(`/files/${encodeURIComponent(id)}?fields=id,trashed`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    if (res.ok) return 'trashed';
    return res.status === 404 ? 'missing' : 'failed';
  }

  /** Un paso de `/trash`: un error sin código (Drive o la base que no contesta) sale con `code`. */
  private async trashStep<T>(code: 'db_error' | 'drive_failed', work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof HttpError && !err.code) {
        const fixed = err.status === 401 ? 'session_expired' : err.message.includes('not up to date') ? 'db_outdated' : code;
        throw new HttpError(err.status, err.message, fixed);
      }
      throw err;
    }
  }

  /** `purge_file` o `media_purged` con la sesión de la persona; sus errores, como respuestas claras. */
  private async trashRpc(who: Who, fn: 'purge_file' | 'media_purged', file: string): Promise<void> {
    const res = await this.rpc(who.auth, fn, { p_file: file });
    if (res.ok) return;
    const error = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    const message = error?.message ?? '';
    if (message === 'not_allowed') {
      throw new HttpError(403, 'Only the owner or an admin of the workspace can send files to the Google Drive trash.', 'not_allowed');
    }
    if (message === 'file_not_found') throw new HttpError(404, 'This file does not exist or you cannot see it.', 'not_found');
    // El único 409: una página lo volvió a usar (ya no está en la papelera).
    if (message === 'file_not_trashed') throw new HttpError(409, 'A page uses this file again: it is not in the trash.', 'in_use');
    // Lo usa una página de un proyecto borrado (P.14): vuelve si se restaura ese proyecto. La app nueva no ofrece
    // el botón; la publicada antes sí, y así recibe un motivo claro en vez de "la base no contestó".
    if (message === 'file_in_deleted_project') {
      throw new HttpError(409, 'A page of a deleted project uses this file: it comes back if that project is restored.', 'in_deleted_project');
    }
    if (res.status === 401) throw new HttpError(401, 'Your session expired: sign in again.', 'session_expired');
    // La función no existe todavía (PostgREST: PGRST202, 404): la base no tiene la papelera de archivos.
    if (res.status === 404 || error?.code === 'PGRST202') {
      throw new HttpError(502, 'The workspace database is not up to date for the file trash yet.', 'db_outdated');
    }
    throw new HttpError(502, `The workspace did not answer (${res.status}).`, 'db_error');
  }

  // --- carpetas (P.9, Docs/Doc_Carpetas.md) ---------------------------------------------------------
  //
  // Una carpeta soltada en una página es UNA fila de `files` (`mime = 'inode/directory'`) que apunta a una
  // carpeta de Drive, `LGA_ShotDocs/<Proyecto>/Carpetas/<nombre>`, con la marca `sdFile` como cualquier archivo.
  // Lo de adentro es de Drive y no tiene filas: se lista en vivo. Quien ve la página ve y baja lo de adentro;
  // nunca lo de arriba ni lo de al lado: todo id de Drive que llega de la app (una subcarpeta para listar o para
  // subir) tiene que estar adentro del árbol de la carpeta, comprobado subiendo por sus `parents` (`inTree`).

  /** La fila de la carpeta y lo que el portero sabe de ella; el nivel de la persona tiene que alcanzar `min`. */
  private async appFolder(who: Who, value: unknown, min: number): Promise<{ file: string; media: MediaFile; rec: FileRecord }> {
    const file = typeof value === 'string' ? value.toLowerCase() : '';
    if (!UUID.test(file)) throw new HttpError(400, 'Missing the folder.', 'bad_request');
    const media = await this.mediaFile(who, file);
    if (!media || !(media.level >= 1)) throw new HttpError(404, 'This folder does not exist or you cannot see it.', 'not_found');
    if (media.mime !== APP_FOLDER_MIME) throw new HttpError(400, 'This file is not a folder.', 'not_folder');
    if (media.level < min) throw new HttpError(403, 'You cannot add files to this page.', 'not_allowed');
    const rec = (await this.store.get<FileRecord>(`file:${file}`)) ?? {};
    // Crear y subir: solo quien agregó la carpeta. Lo dice la base (`created_by`, desde la migración de carpetas);
    // con una base anterior, quien la creó en Drive (`FileRecord.creator`), y una carpeta ya creada sin ese dato no
    // acepta subidas de nadie.
    if (min >= 3 && !isCreator(who, media, rec)) {
      throw new HttpError(403, 'Only the person who added this folder can upload into it.', 'not_creator');
    }
    return { file, media, rec };
  }

  /**
   * La carpeta de Drive de una carpeta de la app que ya existe (la base la tiene, o la creó el portero y la base
   * todavía no se enteró), con la marca comprobada. `null` si todavía no se creó.
   */
  private async existingRoot(who: Who, file: string, media: MediaFile, rec: FileRecord): Promise<string | null> {
    let drive = media.drive_id;
    if (!drive && rec.drive) {
      drive = rec.drive.id;
      if (!rec.linked && media.level >= 3) await this.linkFile(who, file, rec.drive);
    }
    if (!drive) return null;
    const mark = await this.checkMark(file, drive, rec);
    if (mark === 'missing') throw new HttpError(404, 'This folder is not in Google Drive anymore.', 'folder_gone');
    if (mark === 'other') throw new HttpError(403, 'This folder in Google Drive does not belong to this folder of the app.', 'drive_mismatch');
    return drive;
  }

  /** `LGA_ShotDocs/<Proyecto>/Carpetas`. La crea si falta (una que el dueño mandó a la papelera se vuelve a crear). */
  private async foldersDir(media: MediaFile): Promise<string> {
    const project = await this.projectFolder(media);
    return this.once(`carpetas:${media.project_id}`, async () => {
      const key = `carpetas:${media.project_id}`;
      const saved = await this.store.get<string>(key);
      if (saved) {
        const found = await this.look(saved, FOLDERS_DIR);
        if (found && !found.trashed) return saved;
      }
      const id = await this.create(FOLDERS_DIR, project);
      await this.store.put(key, id);
      return id;
    });
  }

  /** Un nombre que no esté usado en `parent` (lo que ve la app): `Fotos`, si no `Fotos_2`, `Fotos_3`… */
  private async freeName(parent: string, want: string): Promise<string> {
    const q = `${quoted(parent)} in parents and mimeType = ${quoted(FOLDER_MIME)} and trashed = false`;
    const taken = new Set<string>();
    let pageToken = '';
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({ q, fields: 'nextPageToken,files(name)', pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
      const res = await this.drive(`/files?${params}`);
      if (!res.ok) throw new HttpError(502, `Could not look inside the folder "${FOLDERS_DIR}" in Google Drive (${res.status}).`, 'drive_failed');
      const body = (await res.json()) as { nextPageToken?: string; files?: { name?: string }[] };
      for (const f of body.files ?? []) if (f.name) taken.add(f.name.toLowerCase());
      if (!body.nextPageToken) break;
      pageToken = body.nextPageToken;
    }
    if (!taken.has(want.toLowerCase())) return want;
    for (let n = 2; ; n++) {
      const name = `${want}_${n}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
  }

  /**
   * Las subcarpetas comprobadas de una carpeta de la app (en la memoria de la instancia; ver `memory`). `root` es
   * el id de Drive de la carpeta de la app.
   */
  private known(root: string): Map<string, number> {
    return this.tree(root).at;
  }

  /** Lo que se recuerda de una carpeta de la app (ver `memory`). */
  private tree(root: string): TreeMemory {
    const key = this.store.memoryKey ?? this.store;
    let byRoot = memory.get(key);
    if (!byRoot) {
      byRoot = new Map();
      memory.set(key, byRoot);
    }
    let tree = byRoot.get(root);
    if (!tree || tree.at.size > TREE_MEMORY_MAX || tree.seen.size > TREE_MEMORY_MAX) {
      tree = { at: new Map(), seen: new Map() };
      byRoot.set(root, tree);
    }
    return tree;
  }

  /** Drive mostró a la subcarpeta `id` adentro de su carpeta de arriba (ya comprobada) ahora. */
  private sawLink(root: string, id: string, now = Date.now()): void {
    this.tree(root).seen.set(id, now);
  }

  /**
   * Para el listado de varias: si a `dir` hay que volver a mirarla en Drive (Drive no la mostró adentro de su carpeta
   * de arriba en los últimos `LIST_TRUST_MS`). Si hay que mirarla, se olvida su comprobación (`inTree` la hace).
   */
  private forgetIfStale(root: string, dir: string): void {
    if (dir === root) return;
    const tree = this.tree(root);
    const seen = tree.seen.get(dir);
    if (seen === undefined || Date.now() - seen >= LIST_TRUST_MS) tree.at.delete(dir);
  }

  /**
   * Si la carpeta de Drive `id` está adentro del árbol de `root` (o es `root`). Sube por sus `parents` hasta
   * encontrar `root` (sí) o una subcarpeta ya comprobada hace menos de `TREE_TTL_MS` (sí), o hasta la raíz del
   * Drive, un ciclo, algo que no es una carpeta, algo en la papelera o `TREE_DEPTH` niveles (no). Nunca sigue un
   * acceso directo (no es una carpeta). Lo comprobado queda anotado por `TREE_TTL_MS`.
   */
  private async inTree(root: string, id: string, budgeted = false): Promise<boolean | null> {
    if (id === root) return true;
    const known = this.known(root);
    const now = Date.now();
    const fresh = (x: string) => {
      const at = known.get(x);
      return at !== undefined && now - at < TREE_TTL_MS;
    };
    if (fresh(id)) return true;
    const seen: string[] = [];
    let current = id;
    for (let depth = 0; depth < TREE_DEPTH; depth++) {
      // Con `budgeted`, si ya no entra en este pedido: `null` (no se sabe; se pregunta en el siguiente).
      if (budgeted && this.driveCalls >= DRIVE_CALL_BUDGET) return null;
      const res = await this.drive(`/files/${encodeURIComponent(current)}?fields=id,mimeType,parents,trashed`);
      if (res.status === 404) return false;
      if (res.status === 429 || res.status === 403) {
        // Un 403 de Drive es "no tenés acceso a eso" (fuera del árbol) o "andá más despacio" (el límite de pedidos):
        // lo segundo no dice nada del árbol, y tomarlo como "afuera" dejaba la subcarpeta como faltante hasta
        // *Retry missing*. Sale como `rate` (la app espera y vuelve a pedir). Un 403 sin motivo legible, afuera.
        const reasons = res.status === 403 ? await driveReasons(res) : [];
        if (res.status === 429 || reasons.some((r) => DRIVE_SLOW_DOWN.test(r))) {
          throw new HttpError(503, 'Google Drive asked to slow down: trying again shortly.', 'rate');
        }
        return false;
      }
      if (!res.ok) throw new HttpError(502, `Google Drive answered ${res.status}.`, 'drive_failed');
      const meta = (await res.json()) as { mimeType?: string; parents?: string[]; trashed?: boolean };
      if (meta.mimeType !== FOLDER_MIME || meta.trashed) return false;
      seen.push(current);
      // Drive acaba de decir cuál es su carpeta de arriba (si resulta adentro del árbol, `sawLink` abajo).
      const parents = meta.parents ?? [];
      // Drive deja un solo padre; uno con varios (de antes de 2020) no se acepta: no se sabe por dónde sube.
      if (parents.length !== 1) return false;
      const parent = parents[0]!;
      if (parent === root || fresh(parent)) {
        // Con la fecha de la comprobación más vieja del camino: lo de abajo no dura más que lo de arriba.
        const at = parent === root ? now : known.get(parent)!;
        for (const x of seen) {
          known.set(x, at);
          this.sawLink(root, x, now);
        }
        return true;
      }
      if (seen.includes(parent)) return false;
      current = parent;
    }
    return false;
  }

  /**
   * `POST /folder/prepare` (nivel 3): `{ file, name, dirs?: string[], parents?: { <ruta>: <id> } }`. La primera
   * vez crea la carpeta en `<Proyecto>/Carpetas` (con la marca `sdFile`) y le dice a la base dónde quedó
   * (`set_file_drive`). Después crea las subcarpetas de `dirs` (rutas relativas, primero las de arriba, hasta
   * `FOLDER_BATCH` por pedido); `parents` trae los ids de las carpetas de arriba que se crearon en pedidos
   * anteriores, y cada uno tiene que estar adentro del árbol. Se puede repetir: una subcarpeta que un pedido
   * anterior ya creó (la respuesta se perdió) se encuentra por su marca (`sdFolder` + `sdPath`) y no se crea dos
   * veces. Devuelve `{ root: { id, name }, dirs: { <ruta>: <id> } }`.
   */
  private async folderPrepare(req: Request, who: Who): Promise<unknown> {
    const body = await readBody(req);
    const { file, media, rec } = await this.appFolder(who, body.file, 3);
    const dirs = body.dirs === undefined ? [] : body.dirs;
    if (!Array.isArray(dirs) || dirs.length > FOLDER_BATCH || !dirs.every(validFolderPath)) {
      throw new HttpError(400, `Send up to ${FOLDER_BATCH} folder paths at a time.`, 'bad_request');
    }
    const given = body.parents && typeof body.parents === 'object' && !Array.isArray(body.parents) ? (body.parents as Record<string, unknown>) : {};

    let root = await this.existingRoot(who, file, media, rec);
    let rootName = rec.drive?.id === root ? rec.drive.name : media.name;
    if (!root) {
      const want = driveFolderName(typeof body.name === 'string' && body.name ? body.name : media.name);
      root = await this.once(`folder:${file}`, async () => {
        const again = (await this.store.get<FileRecord>(`file:${file}`)) ?? {};
        if (again.drive) {
          if (!isCreator(who, media, again)) throw new HttpError(403, 'Only the person who added this folder can upload into it.', 'not_creator');
          return again.drive.id;
        }
        // Otra instancia del portero puede haberla creado recién (dos pedidos a la vez): se busca por su marca.
        const q = `mimeType = ${quoted(FOLDER_MIME)} and trashed = false and appProperties has { key='sdFile' and value=${quoted(file)} }`;
        const found = await this.drive(`/files?${new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '10' })}`);
        if (!found.ok) throw new HttpError(502, `Could not look for the folder in Google Drive (${found.status}).`, 'drive_failed');
        const twin = ((await found.json()) as { files?: { id: string; name?: string }[] }).files?.[0];
        let id: string;
        let name: string;
        if (twin) {
          [id, name] = [twin.id, twin.name ?? want];
        } else {
          const parent = await this.foldersDir(media);
          name = await this.freeName(parent, want);
          id = await this.create(name, parent, { sdFile: file });
        }
        rootName = name;
        // Quién la creó (solo esa persona sube adentro), y queda anotada antes de avisarle a la base: si eso falla,
        // el próximo pedido usa esta y no crea otra.
        await this.store.put(`file:${file}`, { ...again, creator: who.userId } satisfies FileRecord);
        await this.linkFile(who, file, { id, name, mimeType: FOLDER_MIME, size: 0 });
        return id;
      });
    }

    const out: Record<string, string> = {};
    if (dirs.length > 0) {
      const inBatch = new Set(dirs);
      // Las de arriba que no van en este pedido: tienen que estar adentro del árbol.
      const outside = new Map<string, string>();
      for (const path of dirs) {
        const up = parentPath(path);
        if (up === '' || inBatch.has(up) || outside.has(up)) continue;
        const id = given[up];
        if (typeof id !== 'string' || !DRIVE_ID.test(id)) throw new HttpError(400, `Missing the folder "${up}".`, 'bad_request');
        const inside = await this.inTree(root, id, outside.size > 0);
        // No entra en este pedido: estas subcarpetas se crean en el siguiente.
        if (inside === null) break;
        if (!inside) throw new HttpError(403, 'That folder is not inside this folder.', 'outside');
        outside.set(up, id);
      }
      // Las que un pedido anterior ya creó (si la respuesta se perdió, o si se soltó la carpeta desde el otro
      // sistema), por su marca: la de ahora o la que dejó un portero anterior (`pathMarks`). Dos rutas que solo
      // difieren en la forma de los acentos tienen la misma marca y quedan en la misma subcarpeta.
      const marks = new Map<string, string[]>();
      for (const path of dirs) {
        for (const m of await pathMarks(path)) marks.set(m, [...(marks.get(m) ?? []), path]);
      }
      const existing = new Map<string, { id: string; parent: string }[]>();
      const all = [...marks.keys()];
      for (let from = 0; from < all.length; from += MARKS_PER_QUERY) {
        const q =
          `mimeType = ${quoted(FOLDER_MIME)} and trashed = false and appProperties has { key='sdFolder' and value=${quoted(file)} } and (` +
          all.slice(from, from + MARKS_PER_QUERY).map((m) => `appProperties has { key='sdPath' and value=${quoted(m)} }`).join(' or ') +
          ')';
        const params = new URLSearchParams({ q, fields: 'files(id,parents,appProperties)', pageSize: '1000' });
        const found = await this.drive(`/files?${params}`);
        if (!found.ok) throw new HttpError(502, `Could not look inside the folder in Google Drive (${found.status}).`, 'drive_failed');
        for (const f of ((await found.json()) as { files?: { id: string; parents?: string[]; appProperties?: Record<string, string> }[] }).files ?? []) {
          if (f.parents?.length !== 1) continue;
          for (const path of marks.get(f.appProperties?.sdPath ?? '') ?? []) {
            existing.set(path, [...(existing.get(path) ?? []), { id: f.id, parent: f.parents[0]! }]);
          }
        }
      }
      const known = this.known(root);
      // Las creadas en este pedido, por su carpeta de arriba y su marca: dos rutas del mismo pedido que solo difieren
      // en la forma de los acentos (en Windows pueden ser dos carpetas) van a la misma subcarpeta, no a dos iguales.
      const made = new Map<string, string>();
      for (const path of dirs) {
        const up = parentPath(path);
        const parent = up === '' ? root : (out[up] ?? outside.get(up));
        if (!parent) {
          // La de arriba quedó para el pedido siguiente (el tope de llamados): esta también.
          if (inBatch.has(up) || typeof given[up] === 'string') continue;
          throw new HttpError(400, `The folder "${up}" has to come before "${path}".`, 'bad_request');
        }
        // La que está en su lugar (la carpeta de arriba que corresponde). Si hay más de una, la primera que dio Drive.
        const was = existing.get(path)?.find((e) => e.parent === parent);
        const mark = await pathMark(path);
        let id: string;
        if (was) id = was.id;
        else if (made.has(`${parent}/${mark}`)) id = made.get(`${parent}/${mark}`)!;
        else {
          // Lo que no entra en este pedido queda para el siguiente (la app pide las que faltan).
          if (this.driveCalls >= DRIVE_CALL_BUDGET && Object.keys(out).length > 0) break;
          const name = driveFolderName(path.slice(up ? up.length + 1 : 0));
          id = await this.createChecked(name, parent, { sdFolder: file, sdPath: mark });
          made.set(`${parent}/${mark}`, id);
        }
        out[path] = id;
        known.set(id, Date.now());
        this.sawLink(root, id);
      }
    }
    return { root: { id: root, name: rootName }, dirs: out };
  }

  /** Como `create`, pero un Drive que pide ir más despacio o que está lleno sale con su código. */
  private async createChecked(name: string, parent: string, appProperties: Record<string, string>): Promise<string> {
    const res = await this.drive('/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent], appProperties }),
    });
    if (res.ok) return ((await res.json()) as { id: string }).id;
    const reasons = await driveReasons(res);
    if (res.status === 429 || reasons.some((r) => /rateLimitExceeded/i.test(r))) {
      throw new HttpError(503, 'Google Drive asked to slow down: trying again shortly.', 'rate');
    }
    if (reasons.includes('storageQuotaExceeded')) throw driveFull();
    throw new HttpError(502, `Could not create the folder "${name}" in Google Drive (${res.status}).`, 'drive_failed');
  }

  /**
   * `POST /folder/sessions` (nivel 3): `{ file, items: [{ dir, name, mime, size }] }`, hasta `FOLDER_BATCH`. `dir`:
   * el id de Drive de la subcarpeta (adentro del árbol) o `null` para la carpeta misma. Por cada archivo abre una
   * subida reanudable en Drive con el nombre, la carpeta y el peso fijados (Drive rechaza otro peso) y devuelve su
   * `uploadId`: la dirección de Google cifrada por el portero, que la app usa con `PUT /upload/<id>` como cualquier
   * subida. Un archivo vacío se crea directamente (`done`). No se guarda nada por archivo, ni acá ni en la base.
   * Si Drive pide ir más despacio, los que faltan vuelven con `error: 'rate'` para pedirlos de nuevo después.
   */
  private async folderSessions(req: Request, who: Who): Promise<unknown> {
    const body = await readBody(req);
    const { file, media, rec } = await this.appFolder(who, body.file, 3);
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > FOLDER_BATCH) {
      throw new HttpError(400, `Send between 1 and ${FOLDER_BATCH} files at a time.`, 'bad_request');
    }
    const root = await this.existingRoot(who, file, media, rec);
    if (!root) throw new HttpError(409, 'This folder is not in Google Drive yet.', 'not_ready');
    const wanted = items.map((raw) => {
      const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const size = Number(item.size);
      const dir = item.dir === null || item.dir === undefined || item.dir === '' ? root : item.dir;
      if (typeof dir !== 'string' || !DRIVE_ID.test(dir) || !Number.isSafeInteger(size) || size < 0 || typeof item.name !== 'string') {
        throw new HttpError(400, 'Each file needs its folder, name and size.', 'bad_request');
      }
      const name = cleanFileName(item.name) || 'file';
      const asked = typeof item.mime === 'string' && MIME.test(item.mime) ? item.mime.toLowerCase() : '';
      // Un tipo de Google (carpeta, documento) crearía eso en vez de un archivo: va como bytes sin tipo.
      const mime = asked && !asked.startsWith('application/vnd.google-apps.') ? asked : 'application/octet-stream';
      return { dir, name, mime, size };
    });
    // Cada subcarpeta, adentro del árbol. Las que no se llegan a comprobar en este pedido (el tope de llamados)
    // vuelven como `later`; una de afuera corta todo el pedido.
    const checked = new Set<string>();
    for (const dir of new Set(wanted.map((w) => w.dir))) {
      const inside = await this.inTree(root, dir, checked.size > 0);
      if (inside === null) break;
      if (!inside) throw new HttpError(403, 'That folder is not inside this folder.', 'outside');
      checked.add(dir);
    }
    const secret = await this.secret();
    const out: unknown[] = [];
    let slowDown = false;
    let opened = 0;
    for (const w of wanted) {
      if (slowDown) {
        out.push({ error: 'rate' });
        continue;
      }
      if (!checked.has(w.dir) || (opened > 0 && this.driveCalls >= DRIVE_CALL_BUDGET)) {
        out.push({ error: 'later' });
        continue;
      }
      opened++;
      const meta = { name: w.name, parents: [w.dir], appProperties: { sdFolder: file } };
      const res =
        w.size === 0
          ? await this.drive('/files?fields=id,name,mimeType,size', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...meta, mimeType: w.mime }),
            })
          : await this.drive(`${UPLOAD}/files?uploadType=resumable&fields=id,name,mimeType,size`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': w.mime,
                'X-Upload-Content-Length': String(w.size),
              },
              body: JSON.stringify(meta),
            });
      if (res.ok && w.size === 0) {
        const f = (await res.json()) as { id: string; name: string; mimeType: string };
        out.push({ done: { id: f.id, name: f.name, mimeType: f.mimeType, size: 0 } });
        continue;
      }
      const session = res.headers.get('Location');
      if (res.ok && session) {
        out.push({ uploadId: await seal(secret, { s: session, u: who.userId, z: w.size, c: Date.now(), f: file }) });
        continue;
      }
      const reasons = await driveReasons(res);
      if (res.status === 429 || reasons.some((r) => /rateLimitExceeded/i.test(r))) {
        slowDown = true;
        out.push({ error: 'rate' });
        continue;
      }
      if (reasons.includes('storageQuotaExceeded')) throw driveFull();
      out.push({ error: res.status === 404 ? 'gone' : 'drive_failed' });
    }
    return { items: out };
  }

  /** Una subida de un archivo de una carpeta, de su id cifrado (`folderSessions`); `null` si no es de este portero. */
  private async folderUpload(uploadId: string): Promise<Upload | null> {
    const data = await unseal<{ s: string; u: string; z: number; c: number; f?: string }>(await this.secret(), uploadId);
    if (!data || typeof data.s !== 'string' || !data.s.startsWith('https://')) return null;
    return { session: data.s, user: data.u, size: data.z, createdAt: data.c, ...(data.f ? { folder: data.f } : {}) };
  }

  /**
   * `POST /folder/list` (nivel 1): `{ file, dir?, pageToken? }`. Lo que hay ahora en la carpeta (o en la
   * subcarpeta `dir`, que tiene que estar adentro del árbol), sin la papelera de Drive, hasta 100 cosas por
   * pedido (`nextPageToken` para seguir). Cada archivo sale con su pase (`url`, el mismo de las fotos, 8 horas) y,
   * si Drive tiene miniatura, la dirección de la miniatura (`thumb`). Las subcarpetas traen su id (para abrirlas);
   * los accesos directos y los documentos de Google, solo el nombre: nunca se siguen ni se bajan. Con `dirs` en vez
   * de `dir` (hasta `LIST_DIRS_MAX` subcarpetas) las lista de una vez: ver `folderListMany`.
   */
  private async folderList(req: Request, who: Who): Promise<unknown> {
    const body = await readBody(req);
    const { file, media, rec } = await this.appFolder(who, body.file, 1);
    const root = await this.existingRoot(who, file, media, rec);
    if (!root) throw new HttpError(409, 'This folder is still being created: try again in a moment.', 'not_ready');
    if (body.dirs !== undefined) return this.folderListMany(req, who, root, body);
    const dir = body.dir === undefined || body.dir === null || body.dir === '' ? root : body.dir;
    if (typeof dir !== 'string' || !DRIVE_ID.test(dir)) throw new HttpError(400, 'Missing the folder.', 'bad_request');
    // La subcarpeta pedida se vuelve a mirar en Drive siempre (una en la papelera o movida afuera deja de verse en el
    // acto); lo de arriba se toma de lo ya comprobado. Lo de afuera del árbol no existe: el mismo 404.
    if (dir !== root) {
      this.known(root).delete(dir);
      this.tree(root).seen.delete(dir);
    }
    if (!(await this.inTree(root, dir))) throw new HttpError(404, 'This folder does not exist or you cannot see it.', 'not_found');
    const pageToken = typeof body.pageToken === 'string' && /^[\w.~-]{1,2000}$/.test(body.pageToken) ? body.pageToken : '';
    const params = new URLSearchParams({
      q: `${quoted(dir)} in parents and trashed = false`,
      fields: LIST_FIELDS,
      pageSize: LIST_PAGE,
      orderBy: 'folder,name_natural',
      ...(pageToken ? { pageToken } : {}),
    });
    const listed = await this.driveListPage(params);
    const known = this.known(root);
    const now = Date.now();
    const until = now + this.passMs(who);
    // Las subcarpetas de esta valen lo mismo que ella: si se comprobó hace 8 minutos, ellas también.
    const dirAt = dir === root ? now : (known.get(dir) ?? now);
    const entries: unknown[] = [];
    for (const f of listed.files ?? []) {
      const entry = await this.listEntry(req, f, until, known, dirAt, this.tree(root).seen);
      if (entry) entries.push(entry);
    }
    return { entries, nextPageToken: listed.nextPageToken ?? null };
  }

  /**
   * `POST /folder/list` con `{ file, dirs, pageToken? }` (nivel 1): lo de varias subcarpetas en un solo pedido (el
   * recorrido de *Download all* pasa de una subcarpeta por pedido a hasta `LIST_DIRS_MAX`). Una sola consulta a
   * Drive (`('a' in parents or 'b' in parents …) and trashed = false`, con `parents` entre los campos para agrupar
   * lo que vuelve), con el mismo tope por pedido que el listado de una (100 cosas, que son otros tantos pases
   * firmados: el tope de CPU del plan gratis). Devuelve `{ lists, failed, later, nextPageToken }`:
   *   - `lists`: por cada subcarpeta aceptada, lo suyo en esta página (puede ser `[]`);
   *   - `failed`: por cada una que no se puede listar, el código (`not_found`: no existe, está en la papelera o no es
   *     del árbol, igual que el 404 del listado de una);
   *   - `later`: las que no entraron en el tope de llamados a Drive de este pedido (se piden de nuevo);
   *   - `nextPageToken`: para seguir con el mismo `dirs` (solo las de `lists`: la consulta no puede cambiar).
   * Cada subcarpeta se comprueba (`inTree`) como en el listado de una, salvo la que se comprobó hace menos de
   * `LIST_TRUST_MS`. Con `pageToken` el conjunto ya no puede cambiar (Drive ata el token a la consulta): una que ya
   * no se puede comprobar corta el pedido con `409 changed` y la app vuelve a empezar. Con `partial: true` (una app
   * que lo entiende, desde v0.0XX) no corta: la consulta sigue con todas, pero lo de las que no entraron en el tope
   * de llamados vuelve en `later` y lo de las que ya no son del árbol en `failed`, sin nada de ellas en `lists`; la
   * app descarta lo que ya tenía de esas y las lista de nuevo, y sigue con las demás (antes, una espera de más de un
   * minuto entre páginas con 36 subcarpetas o más daba `409` y la app caía a listar de a una). Cada pedido avanza
   * al menos una subcarpeta.
   */
  private async folderListMany(req: Request, who: Who, root: string, body: Record<string, unknown>): Promise<unknown> {
    if (body.dir !== undefined && body.dir !== null && body.dir !== '') throw new HttpError(400, 'Send either dir or dirs, not both.', 'bad_request');
    const given = body.dirs;
    if (!Array.isArray(given) || given.length === 0 || given.length > LIST_DIRS_MAX || !given.every((d) => typeof d === 'string' && DRIVE_ID.test(d))) {
      throw new HttpError(400, `Send between 1 and ${LIST_DIRS_MAX} folders at a time.`, 'bad_request');
    }
    // Sin repetidas y en orden: la consulta tiene que ser la misma en cada página (Drive ata el `pageToken` a ella).
    const dirs = [...new Set(given as string[])].sort();
    const pageToken = typeof body.pageToken === 'string' && /^[\w.~-]{1,2000}$/.test(body.pageToken) ? body.pageToken : '';
    // La app sabe dejar subcarpetas para después también en las páginas siguientes (ver arriba).
    const partial = body.partial === true;
    const known = this.known(root);
    const accepted: string[] = [];
    const failed: Record<string, string> = {};
    const later: string[] = [];
    if (pageToken && !partial) {
      for (const dir of dirs) {
        // La misma confianza corta que en la primera página: sin esto, en las siguientes valía la de `inTree`
        // (10 minutos) y una subcarpeta movida a otro proyecto se seguía listando hasta terminar las páginas.
        this.forgetIfStale(root, dir);
        if ((await this.inTree(root, dir, accepted.length > 0)) !== true) {
          throw new HttpError(409, 'A folder changed while it was being listed: start again.', 'changed');
        }
        accepted.push(dir);
      }
    } else {
      let checked = 0;
      for (const dir of dirs) {
        if (checked > 0 && this.driveCalls >= DRIVE_CALL_BUDGET) {
          later.push(dir);
          continue;
        }
        this.forgetIfStale(root, dir);
        const inside = await this.inTree(root, dir, checked > 0);
        checked++;
        if (inside === null) later.push(dir);
        else if (inside) accepted.push(dir);
        else failed[dir] = 'not_found';
      }
    }
    const lists: Record<string, unknown[]> = {};
    for (const dir of accepted) lists[dir] = [];
    if (accepted.length === 0) return { lists, failed, later, nextPageToken: null };

    // Con `pageToken`, la consulta de la primera página (todas las pedidas), aunque alguna haya quedado afuera de esta:
    // de las que no se comprobaron no sale nada (`wanted`, abajo).
    const asked = pageToken ? dirs : accepted;
    const params = new URLSearchParams({
      q: `(${asked.map((d) => `${quoted(d)} in parents`).join(' or ')}) and trashed = false`,
      fields: LIST_FIELDS,
      pageSize: LIST_PAGE,
      orderBy: 'folder,name_natural',
      ...(pageToken ? { pageToken } : {}),
    });
    const listed = await this.driveListPage(params);
    const now = Date.now();
    const until = now + this.passMs(who);
    const wanted = new Set(accepted);
    for (const f of listed.files ?? []) {
      // Una cosa con dos padres (de antes de 2020) sale en cada subcarpeta pedida que la tiene; sin ninguna, no sale.
      const parents = (f.parents ?? []).filter((p) => wanted.has(p));
      if (parents.length === 0) continue;
      const entry = await this.listEntry(req, f, until, known, known.get(parents[0]!) ?? now, this.tree(root).seen);
      if (!entry) continue;
      for (const p of parents) lists[p]!.push(entry);
    }
    return { lists, failed, later, nextPageToken: listed.nextPageToken ?? null };
  }

  /** Una página de `files.list` de una carpeta; Drive pide ir más despacio (`rate`) o falla (`drive_failed`). */
  private async driveListPage(params: URLSearchParams): Promise<DriveListPage> {
    const res = await this.drive(`/files?${params}`);
    if (res.status === 429) throw new HttpError(503, 'Google Drive asked to slow down: trying again shortly.', 'rate');
    if (!res.ok) throw new HttpError(502, `Could not list the folder in Google Drive (${res.status}).`, 'drive_failed');
    return (await res.json()) as DriveListPage;
  }

  /**
   * Lo que sale en la lista por cada cosa de Drive: la subcarpeta (se anota como del árbol, con la fecha `at` de su
   * carpeta), el acceso directo o el documento de Google (solo el nombre) o el archivo con su pase; `null` si el id
   * no es un id de Drive.
   */
  private async listEntry(
    req: Request,
    f: DriveListed,
    until: number,
    known: Map<string, number>,
    at: number,
    seen?: Map<string, number>,
  ): Promise<unknown | null> {
    if (!f.id || !DRIVE_ID.test(f.id)) return null;
    const name = cleanFileName(f.name ?? '') || 'file';
    const mime = (f.mimeType ?? '').toLowerCase();
    const modified = typeof f.modifiedTime === 'string' ? f.modifiedTime : null;
    if (mime === FOLDER_MIME) {
      // Una carpeta que Drive lista adentro de una comprobada está adentro del árbol.
      known.set(f.id, at);
      seen?.set(f.id, Date.now());
      return { type: 'folder', id: f.id, name, modified };
    }
    if (mime === SHORTCUT_MIME) return { type: 'shortcut', name, modified };
    if (mime.startsWith('application/vnd.google-apps.')) return { type: 'google', name, mime, modified };
    const size = Number(f.size ?? 0);
    const type = MIME.test(mime) ? mime : '';
    const pass: Pass = { f: f.id, t: type, u: until, s: Number.isSafeInteger(size) ? size : 0, n: keepExtension(name, NAME_MAX), ...(modified ? { m: modified } : {}) };
    const url = await this.passUrl(req, pass);
    return { type: 'file', id: f.id, name, mime: type, size: pass.s, modified, url, thumb: f.hasThumbnail ? url.replace('/m/', '/t/') : null };
  }

  /**
   * `GET /t/<pase>`: la miniatura que hace Drive de ese archivo, del lado `THUMB_SIDE`. El pase es el del archivo
   * (quien puede verlo puede ver su miniatura). Drive no deja usar sus miniaturas desde una página (piden la
   * conexión del dueño): pasan por acá, y quedan en la caché de Cloudflare por archivo y fecha de cambio.
   */
  private async thumbnail(req: Request, pass: string): Promise<Response> {
    const data = await this.readPass(pass);
    const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
    const cacheKey = data.m ? new Request(`https://portero.cache/t/${encodeURIComponent(data.f)}/${encodeURIComponent(data.m)}`) : null;
    if (cache && cacheKey) {
      const hit = await cache.match(cacheKey).catch(() => undefined);
      if (hit) return new Response(req.method === 'HEAD' ? null : hit.body, { status: 200, headers: thumbHeaders(hit.headers.get('Content-Type') ?? 'image/jpeg') });
    }
    const meta = await this.drive(`/files/${encodeURIComponent(data.f)}?fields=thumbnailLink`);
    if (!meta.ok) throw new HttpError(meta.status === 404 ? 404 : 502, `Google Drive answered ${meta.status}.`);
    const link = ((await meta.json()) as { thumbnailLink?: string }).thumbnailLink;
    if (!link || !/^https:\/\/[\w.-]+\.(googleusercontent|google)\.com\//.test(link)) throw new HttpError(404, 'This file has no thumbnail.');
    const sized = link.replace(/=s\d+$/, `=s${THUMB_SIDE}`);
    const res = await this.http(sized, { headers: { Authorization: `Bearer ${await this.token()}` } });
    const type = (res.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!res.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) {
      await res.body?.cancel();
      throw new HttpError(404, 'This file has no thumbnail.');
    }
    const bytes = await res.arrayBuffer();
    if (cache && cacheKey) {
      await cache.put(cacheKey, new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' } })).catch(() => undefined);
    }
    return new Response(req.method === 'HEAD' ? null : bytes, { status: 200, headers: thumbHeaders(type) });
  }

  // --- la carpeta de un proyecto borrado a la papelera de Drive, y de vuelta (P.14, entrega 2) --------

  /**
   * Manda a la papelera de Drive la carpeta entera de un proyecto borrado (`LGA_ShotDocs/<Proyecto>`, la que lleva
   * `appProperties.sdProject`), con todo lo que tiene adentro. Nunca borra nada: Google la guarda 30 días. En este
   * orden (Docs/Doc_Proyectos_Borrar.md, sección 3.8):
   *   1. `media_project`: que la sesión pueda (dueño o admin que maneja el proyecto) y que esté borrado; si la base
   *      ya tiene la confirmación, listo sin ir a Drive.
   *   2. Drive conectado y, si este pedido ya tiene registro, con la misma cuenta de Google.
   *   3. `request_project_drive_trash`: la base anota el pedido (su fecha es el corte de las carpetas "ya mandadas").
   *   4. Las carpetas del proyecto: la que recuerda el portero y las que Drive encuentra con la marca. Cada una se
   *      anota en el registro ANTES de su `PATCH`; las que ya están en la papelera desde el pedido cuentan como
   *      mandadas (un intento anterior cuya respuesta se perdió).
   *   5. `project_drive_trashed`.
   * Repetirlo no hace nada de más; si Drive falla en el medio, repetirlo termina sin perder ninguna.
   */
  private async trashProject(req: Request, who: Who): Promise<ProjectDriveResult> {
    const body = await readBody(req);
    const project = this.projectId(body);
    // Para la prueba técnica (sección 3.9), solo el dueño: dejar el estado exacto de una respuesta perdida (Drive la
    // mandó, la base no se enteró) o de un registro perdido. Nunca hace nada que un corte de red no pudiera hacer.
    const test = body.test === undefined ? null : body.test;
    if (test !== null && (!this.testModes(who) || (test !== 'lost_response' && test !== 'lost_registry'))) {
      throw new HttpError(400, 'Unknown test mode.', 'bad_request');
    }
    return this.oneAtATime(project, () =>
      this.sendProjectFolder(project, who, test as 'lost_response' | 'lost_registry' | null).catch(withProjectCode),
    );
  }

  /**
   * Trae de la papelera de Drive la carpeta de un proyecto: para restaurarlo (la base exige este paso antes), o para
   * *Look for its files again* en uno restaurado sin ella. Trae la unión del registro y de las carpetas con la marca
   * que están en la papelera desde el pedido. Si alguna existe, `project_drive_untrashed` (la base borra sus marcas):
   * `untrashed`. Si no existe ninguna, con Drive conectado a la misma cuenta: `missing`, sin tocar la base (la app
   * pregunta si restaurar sin los archivos).
   */
  private async untrashProject(req: Request, who: Who): Promise<ProjectDriveResult> {
    const body = await readBody(req);
    const project = this.projectId(body);
    // Prueba técnica (solo el dueño): traer sin mirar el registro ni la carpeta recordada, solo con la búsqueda.
    const test = body.test === undefined ? null : body.test;
    if (test !== null && (!this.testModes(who) || test !== 'lost_registry')) throw new HttpError(400, 'Unknown test mode.', 'bad_request');
    return this.oneAtATime(project, () => this.bringProjectFolder(project, who, test === 'lost_registry').catch(withProjectCode));
  }

  /** Los modos de prueba: solo el dueño, y solo con `TEST_MODES=1` en el Worker. */
  private testModes(who: Who): boolean {
    return who.isOwner && (this.env.TEST_MODES ?? '').trim() === '1';
  }

  private projectId(body: Record<string, unknown>): string {
    const project = typeof body.project === 'string' ? body.project.toLowerCase() : '';
    if (!UUID.test(project)) throw new HttpError(400, 'Missing the project.', 'bad_request');
    return project;
  }

  /** Mandar y traer la carpeta de un mismo proyecto no se pisan (en este Worker): van de a uno. */
  private oneAtATime<T>(project: string, work: () => Promise<T>): Promise<T> {
    const key = `projectDrive:${project}`;
    const before = projectWork.get(key) ?? Promise.resolve();
    const run = before.catch(() => undefined).then(work);
    const settled = run.catch(() => undefined);
    projectWork.set(key, settled);
    void settled.then(() => {
      if (projectWork.get(key) === settled) projectWork.delete(key);
    });
    return run;
  }

  private async sendProjectFolder(
    project: string,
    who: Who,
    test: 'lost_response' | 'lost_registry' | null = null,
  ): Promise<ProjectDriveResult> {
    let media = await this.mediaProject(who, project);
    if (!media) throw new HttpError(404, 'This project does not exist or you cannot send its files to the Google Drive trash.', 'not_found');
    if (!media.deleted_at) throw new HttpError(409, 'Only the folder of a deleted project goes to the Google Drive trash.', 'project_not_deleted');
    const saved = await this.store.get<ProjectTrash>(`projectTrash:${project}`);
    // Ya confirmado (y no es un pedido nuevo después de restaurarlo sin la carpeta): nada que hacer.
    if (media.drive_trashed_at && !media.drive_missing_at) {
      const current = saved && saved.requestedAt === media.drive_trash_requested_at ? saved : null;
      const folders = current?.folders.length ?? 0;
      return { status: 'done', project, drive: current?.result ?? (folders ? 'trashed' : 'none'), folders };
    }

    await this.driveReady();
    const email = await this.driveEmail();
    // El registro de este mismo pedido (no el de uno anterior que se cerró al restaurar sin la carpeta).
    const sameRequest = (r: ProjectTrash | undefined, m: MediaProject) =>
      !!r && !!m.drive_trash_requested_at && !m.drive_missing_at && r.requestedAt === m.drive_trash_requested_at;
    let current = saved && sameRequest(saved, media) ? saved : null;
    if (current && !sameAccount(current.email, email)) throw otherAccount();
    if (test === 'lost_registry') {
      // Como si el portero hubiera perdido su registro (y no recordara la carpeta): queda la búsqueda por la marca. La
      // carpeta recordada no se olvida (la usan las subidas): solo no se mira en este pedido.
      await this.store.delete(`projectTrash:${project}`);
      current = null;
    }
    // Las carpetas, antes de pedirle nada a la base: si la recordada no lleva la marca (`drive_mismatch`), el
    // proyecto queda como estaba y se puede restaurar sin traer nada.
    const { remembered, folders } = await this.projectFolders(project, current?.folders ?? [], true, test === 'lost_registry');

    await this.projectRpc(who, 'request_project_drive_trash', project);
    media = await this.mediaProject(who, project);
    if (!media?.deleted_at || !media.drive_trash_requested_at) {
      throw new HttpError(409, 'The project was restored meanwhile: its folder stays in Google Drive.', 'project_restored');
    }
    const requestedAt = media.drive_trash_requested_at;
    let reg: ProjectTrash = current && current.requestedAt === requestedAt ? current : { email, requestedAt, folders: [] };
    // La cuenta queda anotada antes de tocar Drive.
    if (reg !== saved) await this.store.put(`projectTrash:${project}`, reg);

    const cutoff = Date.parse(requestedAt) - CLOCK_MARGIN_MS;
    const toSend = folders.filter((f) => !f.trashed);
    // Ya en la papelera por este pedido: anotada antes, o mandada desde el pedido. Sin `trashedTime` (Drive puede
    // no darlo fuera de las unidades compartidas) también: traerla de más nunca pierde nada.
    const sentBefore = folders.filter(
      (f) => f.trashed && (reg.folders.includes(f.id) || !f.trashedTime || Date.parse(f.trashedTime) >= cutoff),
    );
    const add = async (id: string) => {
      if (reg.folders.includes(id)) return;
      reg = { ...reg, folders: [...reg.folders, id] };
      await this.store.put(`projectTrash:${project}`, reg);
    };
    for (const f of sentBefore) await add(f.id);

    const sentNow: string[] = [];
    for (const f of toSend) {
      // Primero el registro (la intención), después Drive.
      await add(f.id);
      const res = await this.drive(`/files/${encodeURIComponent(f.id)}?fields=id,trashed`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
      if (res.status === 404) continue;
      if (!res.ok) throw new HttpError(502, `Could not send the project folder to the Google Drive trash (${res.status}).`, 'drive_failed');
      sentNow.push(f.id);
      // Prueba técnica: Drive cumplió y "la respuesta no llegó" (ni a la base).
      if (test === 'lost_response') throw new HttpError(502, 'Test: the answer from Google Drive was lost.', 'drive_failed');
    }

    const result: 'trashed' | 'missing' | 'none' = folders.length > 0 ? 'trashed' : remembered ? 'missing' : 'none';
    reg = { ...reg, result };
    await this.store.put(`projectTrash:${project}`, reg);
    try {
      await this.projectRpc(who, 'project_drive_trashed', project);
    } catch (err) {
      // Lo restauraron mientras tanto (trajeron la carpeta y borraron el pedido): lo que se mandó recién vuelve.
      if (err instanceof HttpError && err.code === 'project_drive_not_requested') {
        for (const id of sentNow) await this.untrashFolder(id).catch(() => undefined);
        throw new HttpError(409, 'The project was restored meanwhile: its folder stays in Google Drive.', 'project_restored');
      }
      throw err;
    }
    return { status: 'done', project, drive: result, folders: folders.filter((f) => f.trashed || sentNow.includes(f.id)).length };
  }

  private async bringProjectFolder(project: string, who: Who, onlySearch = false): Promise<ProjectDriveResult> {
    const media = await this.mediaProject(who, project);
    if (!media) throw new HttpError(404, 'This project does not exist or you cannot bring its files back.', 'not_found');
    const requestedAt = media.drive_trash_requested_at;
    if (!requestedAt) throw new HttpError(409, 'The folder of this project was never sent to the Google Drive trash.', 'nothing_to_untrash');

    await this.driveReady();
    const email = await this.driveEmail();
    const saved = await this.store.get<ProjectTrash>(`projectTrash:${project}`);
    const reg = saved && saved.requestedAt === requestedAt ? saved : null;
    if (reg && !sameAccount(reg.email, email)) throw otherAccount();

    const { folders } = onlySearch
      ? await this.projectFolders(project, [], false, true)
      : await this.projectFolders(project, reg?.folders ?? [], false);
    const cutoff = Date.parse(requestedAt) - CLOCK_MARGIN_MS;
    // La unión: las del registro y las que fueron a la papelera desde el pedido (no una vieja que ya estaba ahí).
    const toBring = folders.filter(
      (f) =>
        f.trashed && ((!onlySearch && reg?.folders.includes(f.id)) || !f.trashedTime || Date.parse(f.trashedTime) >= cutoff),
    );
    // Las que son de este pedido: las del registro (en cualquier estado: alguien pudo sacarla a mano de la papelera),
    // las que se traen y una viva creada antes del pedido. Una viva creada después (la carpeta nueva que arma el
    // portero en la primera subida después de restaurar sin la carpeta) es otra: no cuenta, así *Look for its files
    // again* no dice "volvieron" ni borra la marca de la base sin que vuelva nada.
    const ours = folders.filter(
      (f) =>
        (!onlySearch && reg?.folders.includes(f.id)) ||
        toBring.includes(f) ||
        (!f.trashed && !!f.createdTime && Date.parse(f.createdTime) < Date.parse(requestedAt)),
    );
    let brought = 0;
    for (const f of toBring) {
      if (await this.untrashFolder(f.id)) brought++;
    }

    if (ours.length === 0 && !(reg?.result === 'none' && reg.folders.length === 0)) {
      // Drive no tiene ninguna, con la misma cuenta: la app pregunta antes de restaurar sin los archivos.
      return { status: 'done', project, drive: 'missing', folders: 0 };
    }
    await this.projectRpc(who, 'project_drive_untrashed', project);
    // Volvió todo: el registro de este pedido ya no hace falta (la base no tiene más el pedido).
    await this.store.delete(`projectTrash:${project}`);
    return { status: 'done', project, drive: ours.length ? 'untrashed' : 'none', folders: brought };
  }

  /**
   * Las carpetas del proyecto en Drive: la que recuerda el portero (`project:<id>`), las del registro y las que
   * Drive encuentra con `appProperties.sdProject` (con `drive.file` Drive solo devuelve lo que creó la app). Cada
   * una solo si lleva la marca de este proyecto; si la recordada (o una del registro) no la lleva: con `strict`,
   * `403 drive_mismatch` antes de tocar nada; sin él, se la deja afuera. `remembered`: el portero tenía una carpeta
   * anotada.
   */
  private async projectFolders(
    project: string,
    known: string[],
    strict: boolean,
    ignoreRemembered = false,
  ): Promise<{ remembered: boolean; folders: DriveFolder[] }> {
    const saved = ignoreRemembered ? undefined : await this.store.get<ProjectFolder>(`project:${project}`);
    const byId = new Map<string, DriveFolder>();
    for (const id of new Set([...(saved ? [saved.id] : []), ...known])) {
      const found = await this.lookFolder(id);
      if (!found) continue;
      if (found.appProperties?.sdProject !== project) {
        // Mandar: no se toca nada. Traer: esa carpeta no es del proyecto y se deja como está (nunca otra carpeta del
        // Drive del dueño), sin trabar la restauración.
        if (strict) throw new HttpError(403, 'This folder in Google Drive does not belong to this project.', 'drive_mismatch');
        continue;
      }
      byId.set(id, found);
    }
    for (const f of await this.searchFolders(project)) {
      if (f.appProperties?.sdProject === project && !byId.has(f.id)) byId.set(f.id, f);
    }
    return { remembered: !!saved, folders: [...byId.values()] };
  }

  /**
   * Solo mirar, solo el dueño (la prueba técnica, Doc_Proyectos_Borrar.md, sección 3.9): las carpetas del proyecto en
   * Drive (la recordada, las del registro y las que encuentra la búsqueda por la marca) con su estado en la papelera,
   * y lo que hay adentro (las carpetas del día y sus archivos, con `parents`, `explicitlyTrashed` y la marca
   * `sdFile`). No cambia nada: ni en Drive ni en lo guardado.
   */
  private async inspectProject(url: URL): Promise<unknown> {
    const project = (url.searchParams.get('project') ?? '').toLowerCase();
    if (!UUID.test(project)) throw new HttpError(400, 'Missing the project.', 'bad_request');
    const saved = await this.store.get<ProjectFolder>(`project:${project}`);
    const registry = (await this.store.get<ProjectTrash>(`projectTrash:${project}`)) ?? null;
    const folders = new Map<string, DriveFolder & { explicitlyTrashed?: boolean; parents?: string[] }>();
    const fields = 'id,name,mimeType,trashed,explicitlyTrashed,trashedTime,parents,appProperties';
    for (const id of new Set([...(saved ? [saved.id] : []), ...(registry?.folders ?? [])])) {
      const res = await this.drive(`/files/${encodeURIComponent(id)}?fields=${fields}`);
      if (res.status === 404) continue;
      if (!res.ok) throw new HttpError(502, `Google Drive answered ${res.status}.`, 'drive_failed');
      folders.set(id, (await res.json()) as DriveFolder);
    }
    for (const f of await this.searchFolders(project)) if (!folders.has(f.id)) folders.set(f.id, f);
    // Lo de adentro, dos niveles (`<Proyecto>/<día>/<archivo>`), con un tope para no pasar el límite del Worker.
    const children = async (parent: string) => {
      const out: Record<string, unknown>[] = [];
      let pageToken = '';
      for (let page = 0; page < 20; page++) {
        const params = new URLSearchParams({ q: `'${parent}' in parents`, fields: `nextPageToken,files(${fields})`, pageSize: '1000', spaces: 'drive' });
        if (pageToken) params.set('pageToken', pageToken);
        const res = await this.drive(`/files?${params}`);
        if (!res.ok) throw new HttpError(502, `Google Drive answered ${res.status}.`, 'drive_failed');
        const body = (await res.json()) as { files?: Record<string, unknown>[]; nextPageToken?: string };
        out.push(...(body.files ?? []));
        if (!body.nextPageToken) break;
        pageToken = body.nextPageToken;
      }
      return out;
    };
    const tree = [];
    for (const folder of folders.values()) {
      const days = await children(folder.id);
      const inside = [];
      for (const day of days) {
        inside.push({ ...day, files: day.mimeType === FOLDER_MIME ? await children(String(day.id)) : [] });
      }
      tree.push({ ...folder, remembered: saved?.id === folder.id, inRegistry: !!registry?.folders.includes(folder.id), children: inside });
    }
    return { project, remembered: saved?.id ?? null, registry, folders: tree };
  }

  /** Una carpeta por su id, con lo que hace falta para decidir; `null` si ya no existe. */
  private async lookFolder(id: string): Promise<DriveFolder | null> {
    const res = await this.drive(`/files/${encodeURIComponent(id)}?fields=id,name,trashed,trashedTime,createdTime,appProperties`);
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpError(502, `Could not check the project folder in Google Drive (${res.status}).`, 'drive_failed');
    return (await res.json()) as DriveFolder;
  }

  /** Las carpetas con la marca del proyecto, en la papelera o no (Drive las lista a las dos si no se le pide otra cosa). */
  private async searchFolders(project: string): Promise<DriveFolder[]> {
    const out: DriveFolder[] = [];
    let pageToken = '';
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({
        q: `mimeType = '${FOLDER_MIME}' and appProperties has { key='sdProject' and value='${project}' }`,
        fields: 'nextPageToken,files(id,name,trashed,trashedTime,createdTime,appProperties)',
        pageSize: '100',
        spaces: 'drive',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.drive(`/files?${params}`);
      if (!res.ok) throw new HttpError(502, `Could not search the project folder in Google Drive (${res.status}).`, 'drive_failed');
      const body = (await res.json()) as { files?: DriveFolder[]; nextPageToken?: string };
      out.push(...(body.files ?? []));
      if (!body.nextPageToken) break;
      pageToken = body.nextPageToken;
    }
    return out;
  }

  /** Saca una carpeta de la papelera de Drive. `false` si ya no existe. */
  private async untrashFolder(id: string): Promise<boolean> {
    const res = await this.drive(`/files/${encodeURIComponent(id)}?fields=id,trashed`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: false }),
    });
    if (res.status === 404) return false;
    if (!res.ok) throw new HttpError(502, `Could not bring the project folder back from the Google Drive trash (${res.status}).`, 'drive_failed');
    return true;
  }

  /** La cuenta de Google conectada ahora (la que dio Google al conectar). */
  private async driveEmail(): Promise<string | null> {
    return (await this.store.get<Google>('google'))?.email ?? null;
  }

  /** `media_project` con la sesión de la persona: el proyecto y su estado de Drive, o `null` si no puede. */
  private async mediaProject(who: Who, project: string): Promise<MediaProject | null> {
    let res: Response;
    try {
      res = await this.rpc(who.auth, 'media_project', { p_project: project });
    } catch (err) {
      throw new HttpError(502, `The workspace did not answer (${err instanceof Error ? err.message : String(err)}).`, 'db_error');
    }
    if (res.status === 401) throw new HttpError(401, 'Your session expired: sign in again.', 'session_expired');
    const error = res.ok ? null : ((await res.json().catch(() => null)) as { code?: string } | null);
    if (res.status === 404 || error?.code === 'PGRST202') {
      throw new HttpError(502, 'The workspace database is not up to date for deleted projects yet.', 'db_outdated');
    }
    if (!res.ok) throw new HttpError(502, `The workspace did not answer (${res.status}).`, 'db_error');
    const media = (await res.json().catch(() => null)) as MediaProject | null;
    return media && typeof media === 'object' && media.id ? media : null;
  }

  /** Las funciones de la base para la carpeta de un proyecto, con la sesión de la persona; sus errores, claros. */
  private async projectRpc(
    who: Who,
    fn: 'request_project_drive_trash' | 'project_drive_trashed' | 'project_drive_untrashed',
    project: string,
  ): Promise<void> {
    let res: Response;
    try {
      res = await this.rpc(who.auth, fn, { p_project: project });
    } catch (err) {
      throw new HttpError(502, `The workspace did not answer (${err instanceof Error ? err.message : String(err)}).`, 'db_error');
    }
    if (res.ok) return;
    const error = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    const message = error?.message ?? '';
    if (message === 'not_allowed') {
      throw new HttpError(403, 'Only an owner or admin of the workspace who manages the project can do this.', 'not_allowed');
    }
    if (message === 'project_not_deleted') {
      throw new HttpError(409, 'Only the folder of a deleted project goes to the Google Drive trash.', 'project_not_deleted');
    }
    if (message === 'project_drive_not_requested') {
      throw new HttpError(409, 'Nobody asked to send the folder of this project to the Google Drive trash.', 'project_drive_not_requested');
    }
    if (res.status === 401) throw new HttpError(401, 'Your session expired: sign in again.', 'session_expired');
    if (res.status === 404 || error?.code === 'PGRST202') {
      throw new HttpError(502, 'The workspace database is not up to date for deleted projects yet.', 'db_outdated');
    }
    throw new HttpError(502, `The workspace did not answer (${res.status}).`, 'db_error');
  }

  // --- ver (con un pase firmado, por partes) --------------------------------------------------------

  /** El secreto de las confirmaciones del MCP (`requestState`, mcp.ts): aparte del de los pases. */
  private async mcpStateSecret(): Promise<string> {
    let secret = await this.store.get<string>('mcpStateSecret');
    if (!secret) {
      secret = randomId(32);
      await this.store.put('mcpStateSecret', secret);
    }
    return secret;
  }

  private async secret(): Promise<string> {
    // Una vez por pedido: un listado de una carpeta firma un pase por archivo.
    if (this.passSecret) return this.passSecret;
    let secret = await this.store.get<string>('passSecret');
    if (!secret) {
      secret = randomId(32);
      await this.store.put('passSecret', secret);
    }
    this.passSecret = secret;
    return secret;
  }

  /**
   * `named: true` le dice a la app que este portero pone el nombre del archivo al servir (y entiende
   * `?download=1`): con un portero anterior, la respuesta trae solo `url`.
   */
  private async makePass(req: Request, who: Who): Promise<{ url: string; named: true }> {
    const body = await readBody(req);
    if (body.file !== undefined) {
      // El tipo y el nombre son siempre los de `files`: lo que mande la app no cuenta.
      const { drive, type, size, name } = await this.filePass(body.file, who);
      const pass: Pass = { f: drive, t: type, u: Date.now() + this.passMs(who), s: size, ...(name ? { n: name } : {}) };
      return { url: await this.passUrl(req, pass), named: true };
    }
    const asked = typeof body.type === 'string' && MIME.test(body.type) ? body.type : '';
    // Con el id de Drive (la prueba de media): solo el dueño.
    if (!who.isOwner) throw new HttpError(403, 'Only the owner of the workspace can do this for now.');
    const fileId = body.fileId;
    if (typeof fileId !== 'string' || !DRIVE_ID.test(fileId)) throw new HttpError(400, 'Missing the file.');
    return { url: await this.passUrl(req, { f: fileId, t: asked, u: Date.now() + PASS_MS }), named: true };
  }

  /**
   * Un archivo de la app: hace falta verlo (`level >= 1`) y que ya esté en Drive. El archivo de Drive tiene
   * que llevar `appProperties.sdFile` con este mismo id (se comprueba una vez y queda anotado): así nadie
   * puede apuntar un archivo de la base a otro archivo del Drive del dueño.
   */
  private async filePass(value: unknown, who: Who): Promise<{ drive: string; type: string; size: number; name: string }> {
    const file = typeof value === 'string' ? value.toLowerCase() : '';
    if (!UUID.test(file)) throw new HttpError(400, 'Missing the file.');
    const media = await this.mediaFile(who, file);
    if (!media || !(media.level >= 1)) throw new HttpError(404, 'This file does not exist or you cannot see it.', 'not_found');
    // Una carpeta no se baja con un pase: lo de adentro se lista (`/folder/list`) y cada archivo trae el suyo.
    if (media.mime === APP_FOLDER_MIME) throw new HttpError(409, 'This is a folder: open it in the app to see its files.', 'is_folder');
    let rec = (await this.store.get<FileRecord>(`file:${file}`)) ?? {};
    let drive = media.drive_id;
    if (!drive && rec.drive) {
      // Lo subió el portero y la base no se enteró: se intenta avisarle (si esta persona puede) y se sirve.
      drive = rec.drive.id;
      if (!rec.linked && media.level >= 3) {
        await this.linkFile(who, file, rec.drive);
        rec = (await this.store.get<FileRecord>(`file:${file}`)) ?? rec;
      }
    }
    if (!drive) throw new HttpError(409, 'This file has not finished uploading yet.', 'not_uploaded');
    const mark = await this.checkMark(file, drive, rec);
    if (mark === 'missing') throw new HttpError(404, 'This file is not in Google Drive anymore.', 'drive_missing');
    if (mark === 'other') throw new HttpError(403, 'This file in Google Drive does not belong to this file of the app.', 'drive_mismatch');
    // El nombre va tal cual (con un tope, para que el pase no crezca de más): se limpia al servir.
    const name = typeof media.name === 'string' ? keepExtension(media.name, NAME_MAX) : '';
    return { drive, type: MIME.test(media.mime ?? '') ? media.mime : '', size: Number(media.size) || 0, name };
  }

  /**
   * Si el archivo de Drive lleva la marca de este archivo de la app (`appProperties.sdFile`). Se le
   * pregunta a Drive una sola vez por id: lo comprobado queda anotado en `file:<uuid>`.
   */
  private async checkMark(file: string, drive: string, rec: FileRecord): Promise<'ok' | 'missing' | 'other'> {
    if (rec.verified === drive) return 'ok';
    const res = await this.drive(`/files/${encodeURIComponent(drive)}?fields=id,appProperties`);
    if (res.status === 404) return 'missing';
    if (!res.ok) throw new HttpError(502, `Google Drive answered ${res.status}.`);
    const found = (await res.json()) as { appProperties?: Record<string, string> };
    if (found.appProperties?.sdFile !== file) return 'other';
    const latest = (await this.store.get<FileRecord>(`file:${file}`)) ?? rec;
    await this.store.put(`file:${file}`, { ...latest, verified: drive } satisfies FileRecord);
    return 'ok';
  }

  /**
   * `POST /verify` con `{ files: [id…] }` (hasta `VERIFY_MAX`): para cada archivo de la app que la persona puede
   * ver, lo que dice Drive **hoy**, sin usar lo anotado en `rec.verified`: el id de Drive que se miró, el peso, si
   * está en la papelera de Drive, si lleva la marca `appProperties.sdFile` de este archivo y su MD5. La app libera
   * la copia de un dispositivo solo si todo coincide (Doc_Copias_Locales.md, sección 5.3). Lo que falla de un
   * archivo va en su lugar con un `code` fijo y no corta a los demás.
   */
  private async verify(req: Request, who: Who): Promise<{ results: Record<string, VerifyResult> }> {
    const body = await readBody(req);
    const asked = Array.isArray(body.files) ? body.files : null;
    if (!asked || asked.length === 0) throw new HttpError(400, 'Missing the files.');
    if (asked.length > VERIFY_MAX) throw new HttpError(400, `At most ${VERIFY_MAX} files at a time.`, 'too_many');
    const ids = [...new Set(asked.map((v) => (typeof v === 'string' ? v.toLowerCase() : '')))];
    if (ids.some((id) => !UUID.test(id))) throw new HttpError(400, 'Missing the file.');
    await this.driveReady();
    const results: Record<string, VerifyResult> = {};
    for (const id of ids) {
      try {
        results[id] = await this.verifyOne(id, who);
      } catch (err) {
        const code = err instanceof HttpError ? (err.code ?? 'failed') : 'failed';
        results[id] = { error: err instanceof Error ? err.message : String(err), code };
      }
    }
    return { results };
  }

  private async verifyOne(file: string, who: Who): Promise<VerifyResult> {
    const media = await this.mediaFile(who, file);
    if (!media || !(media.level >= 1)) return { error: 'This file does not exist or you cannot see it.', code: 'not_found' };
    const drive = media.drive_id;
    if (!drive) return { error: 'This file has not finished uploading yet.', code: 'not_uploaded' };
    const fields = encodeURIComponent('id,size,trashed,appProperties,md5Checksum');
    const res = await this.drive(`/files/${encodeURIComponent(drive)}?fields=${fields}`);
    if (res.status === 404) return { error: 'This file is not in Google Drive anymore.', code: 'drive_missing' };
    if (!res.ok) return { error: `Google Drive answered ${res.status}.`, code: 'drive_failed' };
    const found = (await res.json()) as {
      id?: string;
      size?: string | number;
      trashed?: boolean;
      appProperties?: Record<string, string>;
      md5Checksum?: string;
    };
    return {
      driveId: typeof found.id === 'string' ? found.id : drive,
      size: found.size === undefined ? -1 : Number(found.size),
      trashed: found.trashed === true,
      marked: found.appProperties?.sdFile === file,
      md5: typeof found.md5Checksum === 'string' ? found.md5Checksum.toLowerCase() : null,
    };
  }

  private async passUrl(req: Request, data: Pass): Promise<string> {
    const payload = b64url(new TextEncoder().encode(JSON.stringify(data)));
    const pass = `${payload}.${await hmac(await this.secret(), payload)}`;
    return `${new URL(req.url).origin}/m/${pass}`;
  }

  /** Lo que lleva un pase, con la firma comprobada y sin vencer; si no, `403`. */
  private async readPass(pass: string): Promise<Pass> {
    const [payload, signature] = pass.split('.');
    if (!payload || !signature || !sameText(signature, await hmac(await this.secret(), payload))) {
      throw new HttpError(403, 'Invalid link.', 'pass_invalid');
    }
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Pass;
    if (data.u < Date.now()) throw new HttpError(403, 'This link expired: open the file again from the app.', 'pass_expired');
    return data;
  }

  private async media(req: Request, pass: string): Promise<Response> {
    const data = await this.readPass(pass);
    const params = new URL(req.url).searchParams;
    // `?download=1` no va firmado: solo puede pedir que se baje, nunca que se muestre.
    const download = params.get('download') === '1';
    // `?offline=1` (tampoco firmado) solo saltea la caché del arranque: la app baja el archivo entero por partes
    // para tenerlo sin red, y la caché respondería partes más cortas que las pedidas y le quitaría el lugar al
    // video que alguien esté mirando. No cambia lo que el pase deja ver.
    const offline = params.get('offline') === '1';

    const range = req.headers.get('Range');
    // Solo los videos pasan por la caché del arranque: un PDF pedido por partes desplazaría a los videos.
    const cached = range && isVideo(data.t) && !offline ? await this.fromCache(req, data, range, download) : {};
    if (cached.response) return cached.response;

    const headers = new Headers();
    if (range) headers.set('Range', range);
    const res = await this.drive(`/files/${encodeURIComponent(data.f)}?alt=media`, { headers });
    if (res.status === 416) return new Response(null, { status: 416, headers: { 'Content-Range': res.headers.get('Content-Range') ?? '' } });
    if (!res.ok && res.status !== 206) {
      // Drive lo marcó como malware o spam: no lo deja bajar (no se pide `acknowledgeAbuse`).
      if (res.status === 403 && (await driveReasons(res)).includes('cannotDownloadAbusiveFile')) {
        throw new HttpError(403, 'Google Drive flagged this file as malware or spam and does not let it be downloaded.', 'abusive');
      }
      if (res.status === 404) throw new HttpError(404, 'This file is not in Google Drive anymore.', 'drive_missing');
      throw new HttpError(502, `Google Drive answered ${res.status}.`);
    }
    // Un pase sin el peso del archivo (la prueba de media): se aprende de la respuesta, para la próxima.
    if (cached.learn && res.status === 206) await this.learnSize(data.f, res);

    // El tipo es el del pase; un pase de la prueba de media sin tipo usa el que dice Drive.
    const out = servedHeaders(data.t || (res.headers.get('Content-Type') ?? ''), passName(data), download);
    for (const h of ['Content-Length', 'Content-Range', 'ETag', 'Last-Modified']) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(req.method === 'HEAD' ? null : res.body, { status: res.status, headers: out });
  }

  // --- caché del principio y del final de los archivos (arranque del video) -------------------------

  /**
   * Un pedido por partes que empieza adentro de una punta guardada se sirve desde el almacenamiento del
   * portero, sin ir a Drive. Si empieza en el principio y sigue después (Chrome pide `bytes=0-`), se
   * devuelve solo lo guardado, con un 206 más corto que lo pedido: el navegador pide lo que sigue. Si
   * empieza en una punta que todavía no está guardada, se le pide a Drive la punta entera (una vez), se
   * guarda y se sirve. Lo demás va a Drive como siempre.
   */
  private async fromCache(req: Request, data: Pass, header: string, download: boolean): Promise<{ response?: Response; learn?: boolean }> {
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m || (!m[1] && !m[2])) return {};
    const id = data.f;
    const [head, tail, slot] = await Promise.all([
      this.store.get<CacheZone>(`cache:${id}:head`),
      this.store.get<CacheZone>(`cache:${id}:tail`),
      this.store.get<string>(slotKey(id)),
    ]);
    const mine = slot === id;
    if (mine) {
      const hit =
        (await this.readZone(req, data, download, head, 'h', m[1], m[2])) ?? (await this.readZone(req, data, download, tail, 't', m[1], m[2]));
      if (hit) return { response: hit };
    }

    let size = (mine ? (head?.size ?? tail?.size) : undefined) ?? (Number.isSafeInteger(data.s) && data.s! > 0 ? data.s! : 0);
    if (!size) size = (await this.store.get<{ size: number }>(`cache:${id}`))?.size ?? 0;
    if (!size) return { learn: true };
    const r = byteRange(m[1], m[2], size);
    if (!r) return {};
    const zone = cacheZones(size);
    let from: number;
    let kind: 'h' | 't';
    if (r.start < zone.head) [from, kind] = [0, 'h'];
    else if (zone.tail > 0 && r.start >= size - zone.tail) [from, kind] = [size - zone.tail, 't'];
    else return {};
    const to = kind === 'h' ? zone.head - 1 : size - 1;

    const res = await this.drive(`/files/${encodeURIComponent(id)}?alt=media`, { headers: { Range: `bytes=${from}-${to}` } });
    const got = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '');
    if (res.status !== 206 || !got || Number(got[1]) !== from || Number(got[2]) !== to || Number(got[3]) !== size) {
      await res.body?.cancel();
      // El archivo no pesa lo que se creía: se olvidan sus puntas (eran de otro peso), se anota el peso de
      // verdad para la próxima y se va a Drive.
      if (res.status === 206 && got && Number(got[3]) > 0) {
        await Promise.all([this.store.delete(`cache:${id}:head`), this.store.delete(`cache:${id}:tail`)]);
        await this.store.put(`cache:${id}`, { size: Number(got[3]) });
      }
      return {};
    }
    // Es poco (hasta ~762 KiB): se puede tener entero en memoria.
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length !== to - from + 1) return {};
    // El lugar se vuelve a leer ahora: mientras se esperaba a Drive, otro archivo pudo haberlo tomado, y
    // hay que olvidar ese (no el que estaba al principio) para no dejar trozos sin dueño.
    await this.claim(id, await this.store.get<string>(slotKey(id)));
    // Copias (`slice`), no vistas: una vista se guardaría con todo el búfer de atrás.
    const writes: Promise<void>[] = [];
    for (let i = 0; i * CACHE_PIECE < bytes.length; i++) {
      writes.push(this.store.put(pieceKey(id, size, kind, i), bytes.slice(i * CACHE_PIECE, (i + 1) * CACHE_PIECE)));
    }
    await Promise.all(writes);
    // Lo último, y entera: la descripción de la punta, recién cuando sus trozos ya están.
    const saved: CacheZone = {
      size,
      length: bytes.length,
      type: res.headers.get('Content-Type') ?? undefined,
      etag: res.headers.get('ETag') ?? undefined,
      modified: res.headers.get('Last-Modified') ?? undefined,
    };
    await this.store.put(`cache:${id}:${kind === 'h' ? 'head' : 'tail'}`, saved);
    const end = Math.min(r.end, to);
    const body = bytes.slice(r.start - from, end - from + 1);
    return { response: cacheResponse(req, data, download, saved, { start: r.start, end }, body, 'fill') };
  }

  /** Lo pedido desde una punta guardada, si empieza adentro (hasta donde llegue la punta); si no, `null`. */
  private async readZone(
    req: Request,
    data: Pass,
    download: boolean,
    zone: CacheZone | undefined,
    kind: 'h' | 't',
    a: string,
    b: string,
  ): Promise<Response | null> {
    if (!zone || !(zone.length > 0) || !(zone.size > 0) || zone.length > zone.size) return null;
    const asked = byteRange(a, b, zone.size);
    if (!asked) return null;
    const start = kind === 'h' ? 0 : zone.size - zone.length;
    const last = start + zone.length - 1;
    if (asked.start < start || asked.start > last) return null;
    const r = { start: asked.start, end: Math.min(asked.end, last) };
    const first = Math.floor((r.start - start) / CACHE_PIECE);
    const final = Math.floor((r.end - start) / CACHE_PIECE);
    const keys = Array.from({ length: final - first + 1 }, (_, i) => pieceKey(data.f, zone.size, kind, first + i));
    const pieces = await Promise.all(keys.map((k) => this.store.get<Uint8Array | ArrayBuffer>(k)));
    const out = new Uint8Array(r.end - r.start + 1);
    let pos = 0;
    for (let i = 0; i < pieces.length; i++) {
      const raw = pieces[i];
      if (!raw) return null;
      const piece = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      const pieceStart = start + (first + i) * CACHE_PIECE;
      // Cada trozo tiene que medir justo lo que le toca; si no, no se usa.
      if (piece.length !== Math.min(CACHE_PIECE, last + 1 - pieceStart)) return null;
      const from = Math.max(r.start, pieceStart) - pieceStart;
      const to = Math.min(r.end, pieceStart + piece.length - 1) - pieceStart;
      out.set(piece.subarray(from, to + 1), pos);
      pos += to - from + 1;
    }
    if (pos !== out.length) return null;
    return cacheResponse(req, data, download, zone, r, out, 'hit');
  }

  private async learnSize(id: string, res: Response): Promise<void> {
    const total = Number(/\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '')?.[1]);
    if (!Number.isSafeInteger(total) || total <= 0) return;
    await this.store.put(`cache:${id}`, { size: total });
  }

  /** Ocupa el lugar del archivo en la caché; si había otro, lo olvida (primero sus descripciones). */
  private async claim(id: string, current: string | undefined): Promise<void> {
    if (current === id) return;
    if (current) {
      const [head, tail] = await Promise.all([
        this.store.get<CacheZone>(`cache:${current}:head`),
        this.store.get<CacheZone>(`cache:${current}:tail`),
      ]);
      await Promise.all([`cache:${current}:head`, `cache:${current}:tail`, `cache:${current}`].map((k) => this.store.delete(k)));
      const keys: string[] = [];
      for (const [zone, kind] of [[head, 'h'], [tail, 't']] as const) {
        if (!zone || !(zone.length > 0)) continue;
        for (let i = 0; i * CACHE_PIECE < zone.length && i < CACHE_HEAD_PIECES + CACHE_TAIL_PIECES; i++) keys.push(pieceKey(current, zone.size, kind, i));
      }
      await Promise.all(keys.map((k) => this.store.delete(k)));
    }
    await this.store.put(slotKey(id), id);
  }
}

/**
 * Lo que lleva un pase (todo firmado): el id de Drive, el tipo del archivo, cuándo vence, el peso (si se
 * sabe) y el nombre (de `files.name`; los pases de antes no lo traen y se sirven sin nombre). Si se muestra
 * o se baja no va en el pase: se decide al servir, a partir de `t`, así los pases viejos también reciben
 * los encabezados de ahora.
 */
interface Pass {
  f: string;
  t: string;
  u: number;
  s?: number;
  n?: string;
  /** La fecha de cambio en Drive (los archivos de una carpeta, P.9): la miniatura se guarda por archivo y fecha. */
  m?: string;
}

/**
 * Si la persona puede crear y subir adentro de una carpeta (P.9): la que la agregó según la base (`created_by`);
 * con una base sin ese dato, la que la creó en Drive (`FileRecord.creator`), o cualquiera con nivel 3 mientras
 * todavía no se creó (esa pasa a ser la creadora).
 */
function isCreator(who: Who, media: MediaFile, rec: FileRecord): boolean {
  if (media.created_by !== undefined) return !!media.created_by && media.created_by === who.userId;
  if (!(media.drive_id || rec.drive)) return true;
  return rec.creator === who.userId;
}

/** Los encabezados de una miniatura (`/t/`): una foto chica que el navegador guarda un día, sin nada que corra. */
function thumbHeaders(type: string): Headers {
  return new Headers({
    'Content-Type': type,
    'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': 'sandbox',
  });
}

interface ByteRange {
  start: number;
  end: number;
}

/** Un pedido `bytes=a-b`, `bytes=a-` o `bytes=-n` sobre un archivo de `size` bytes; `null` si no se puede servir. */
function byteRange(a: string, b: string, size: number): ByteRange | null {
  if (a === '') {
    const n = Number(b);
    if (!(n > 0)) return null;
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
  return { start, end };
}

/** El lugar de un archivo en la caché (0 a `CACHE_FILES - 1`), sacado de su id. */
export function cacheSlot(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h % CACHE_FILES;
}

function slotKey(id: string): string {
  return `cacheSlot:${cacheSlot(id)}`;
}

function pieceKey(id: string, size: number, kind: 'h' | 't', n: number): string {
  return `cache:${id}:${size}:${kind}${n}`;
}

/** Qué se guarda de un archivo: el principio y el final, o entero si es chico. */
function cacheZones(size: number): { head: number; tail: number } {
  const all = (CACHE_HEAD_PIECES + CACHE_TAIL_PIECES) * CACHE_PIECE;
  if (size <= all) return { head: size, tail: 0 };
  return { head: CACHE_HEAD_PIECES * CACHE_PIECE, tail: CACHE_TAIL_PIECES * CACHE_PIECE };
}

// --- encabezados de lo que se sirve -----------------------------------------------------------------

function isVideo(type: string): boolean {
  return /^video\//i.test(type);
}

/**
 * El tipo con el que un archivo se puede mostrar en el navegador (`inline`), o `null` si se tiene que
 * bajar. Solo fotos (menos SVG, que puede traer scripts), videos, audio, PDF y texto plano. HTML, XML, JS,
 * Office, comprimidos, ejecutables y todo lo demás se bajan como `application/octet-stream`.
 */
export function inlineType(type: string): string | null {
  const base = (type.split(';')[0] ?? '').trim().toLowerCase();
  if (!MIME.test(base)) return null;
  if (base === 'application/pdf') return base;
  // El texto, como UTF-8 (sin eso, un navegador puede mostrar mal los acentos).
  if (base === 'text/plain') return 'text/plain; charset=utf-8';
  const [top, sub = ''] = base.split('/');
  // Un subtipo XML (`image/x+xml`, lo puede escribir cualquiera en `files.mime`) el navegador lo muestra como
  // documento: se baja.
  if (sub === 'xml' || sub.endsWith('+xml')) return null;
  if (top === 'image' && !sub.includes('svg')) return base;
  if (top === 'video' || top === 'audio') return base;
  return null;
}

// Controles (C0, DEL, C1), marcas de dirección (bidi: con un U+202E, `gpj.exe` se lee `exe.jpg`), los de ancho
// cero (U+200B a U+200F: también el ZWJ y el ZWNJ, salvo el ZWJ de un emoji compuesto: ver `stripHidden`) y los
// separadores de renglón.
const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069]/g;
// Mitades de un par sustituto sin su pareja: `encodeURIComponent` no las acepta.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
// Lo que puede ir antes del ZWJ de un emoji compuesto: un emoji, su selector de variante (U+FE0F, `❤️‍🔥`) o su tono de
// piel (`👩🏽‍💻`). Lo de después tiene que ser un emoji. La misma regla que `cleanFileName` de la app
// (src/media/attachments.ts).
const EMOJI = /^\p{Extended_Pictographic}$/u;
const EMOJI_BEFORE_ZWJ = /^[\p{Extended_Pictographic}\u{FE0F}\u{1F3FB}-\u{1F3FF}]$/u;
/** El ZWJ (U+200D), como escape: escrito tal cual no se ve en el código. */
const ZWJ = '\u200D';

/**
 * El texto sin `HIDDEN_CHARS`, salvo el ZWJ (U+200D) cuando está entre dos emojis (`👨‍👩‍👧`, una familia, sigue siendo
 * una): entre letras o suelto no se ve y dos nombres iguales a la vista serían distintos. El ZWNJ (U+200C) siempre se saca.
 */
function stripHidden(text: string): string {
  if (!text.includes(ZWJ)) return text.replace(HIDDEN_CHARS, '');
  const kept: string[] = [];
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === ZWJ && kept.length && EMOJI_BEFORE_ZWJ.test(kept[kept.length - 1]!) && EMOJI.test(chars[i + 1] ?? '')) {
      kept.push(ch);
      continue;
    }
    if (ch.replace(HIDDEN_CHARS, '') !== '') kept.push(ch);
  }
  return kept.join('');
}

/** El nombre de un archivo listo para `Content-Disposition`: sin controles, bidi ni barras; `''` si no queda nada. */
export function cleanFileName(name: string): string {
  const clean = stripHidden(name.replace(LONE_SURROGATE, '').normalize('NFC')).replace(/[/\\]/g, '_').trim();
  return keepExtension(clean, NAME_MAX);
}

/**
 * Un nombre de hasta `max` caracteres; si hay que cortar, se corta antes de la extensión (queda `.pdf`) y sin partir
 * un grafema (`cutText`).
 */
function keepExtension(name: string, max: number): string {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  const dot = chars.lastIndexOf('.');
  const ext = dot > 0 && chars.length - dot <= 16 ? chars.slice(dot).join('') : '';
  const stem = ext ? chars.slice(0, dot).join('') : name;
  return cutText(stem, max - Array.from(ext).length) + ext;
}

type Segmenter = { segment(text: string): Iterable<{ segment: string }> };
let graphemeSegmenter: Segmenter | null | undefined;

/**
 * El principio del texto con grafemas enteros (una bandera, un emoji con su tono, una letra con su tilde suelta) y a
 * lo sumo `max` puntos de código: cortar por punto de código podía dejar media bandera. Sin `Intl.Segmenter` (lo
 * tiene Workers), por punto de código. Igual que `cutText` de la app (src/lib/graphemes.ts).
 */
export function cutText(text: string, max: number): string {
  if (max <= 0) return '';
  const points = Array.from(text);
  if (points.length <= max) return text;
  if (graphemeSegmenter === undefined) {
    const Ctor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => Segmenter }).Segmenter;
    graphemeSegmenter = Ctor ? new Ctor(undefined, { granularity: 'grapheme' }) : null;
  }
  if (!graphemeSegmenter) return points.slice(0, max).join('');
  let out = '';
  let used = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    const n = Array.from(segment).length;
    if (used + n > max) return used === 0 ? Array.from(segment).slice(0, max).join('') : out;
    out += segment;
    used += n;
  }
  return out;
}

/**
 * `inline` o `attachment`, con el nombre dos veces: `filename` en ASCII (lo que no es ASCII, las comillas y
 * las barras pasan a `_`) para los navegadores viejos, y `filename*` (RFC 5987) en UTF-8, que es el que usan
 * todos los de hoy. Sin nombre (un pase de antes), sin `filename`.
 */
export function contentDisposition(kind: 'inline' | 'attachment', name: string | undefined): string {
  const clean = cleanFileName(name ?? '');
  if (!clean) return kind;
  const ascii = Array.from(clean, (c) => (c >= ' ' && c <= '~' && c !== '"' ? c : '_')).join('');
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function passName(data: Pass): string | undefined {
  return typeof data.n === 'string' ? data.n : undefined;
}

/**
 * Los encabezados de todo lo que se sirve (de Drive o de la caché del arranque). Lo que no está en la lista
 * de `inlineType` sale como `application/octet-stream` y `attachment`: nunca corre como página en la
 * dirección del portero (un HTML o un SVG subido). `download` (`?download=1`) solo puede pasar a
 * `attachment`. Siempre `nosniff`, `Referrer-Policy: no-referrer` (el pase no se filtra desde los links de
 * un PDF) y `CSP: sandbox`, salvo el PDF que se muestra: el visor de PDF del navegador no carga en un
 * documento con `sandbox` (queda con `nosniff` y sin scripts de la página; el visor corre aparte).
 */
export function servedHeaders(type: string, name: string | undefined, download: boolean): Headers {
  const shown = inlineType(type);
  const inline = shown !== null && !download;
  const out = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Content-Type': shown ?? 'application/octet-stream',
    'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', name),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (!(inline && shown === 'application/pdf')) out.set('Content-Security-Policy', 'sandbox');
  return out;
}

/** Las razones de un error de Drive (`error.errors[].reason`, `error.details[].reason`); vacío si no se lee. */
async function driveReasons(res: Response): Promise<string[]> {
  try {
    type Reason = { reason?: unknown };
    const body = (await res.json()) as { error?: { errors?: Reason[]; details?: Reason[] } } | null;
    const all = [...(body?.error?.errors ?? []), ...(body?.error?.details ?? [])];
    return all.map((e) => (typeof e?.reason === 'string' ? e.reason : '')).filter(Boolean);
  } catch {
    return [];
  }
}

function cacheResponse(
  req: Request,
  data: Pass,
  download: boolean,
  meta: CacheZone,
  r: ByteRange,
  body: Uint8Array<ArrayBuffer>,
  how: 'hit' | 'fill',
): Response {
  const out = servedHeaders(data.t || meta.type || '', passName(data), download);
  out.set('Content-Length', String(body.length));
  out.set('Content-Range', `bytes ${r.start}-${r.end}/${meta.size}`);
  if (meta.etag) out.set('ETag', meta.etag);
  if (meta.modified) out.set('Last-Modified', meta.modified);
  // Para medir desde el navegador (herramientas de desarrollo): si salió de la caché o de Drive.
  out.set('X-Portero-Cache', how);
  return new Response(req.method === 'HEAD' ? null : body, { status: 206, headers: out });
}

/** El correo de la cuenta de Google que se conectó, sacado del id_token que devuelve Google. */
function readEmail(idToken: string): string | undefined {
  try {
    const body = JSON.parse(new TextDecoder().decode(fromB64url(idToken.split('.')[1] ?? ''))) as { email?: string };
    return body.email;
  } catch {
    return undefined;
  }
}
