// Links de Google Drive (paso 13 de Docs/Plan_Workspaces.md): reconocer un link de Drive, sacar el id del
// archivo o de la carpeta y armar la dirección del reproductor de Drive para la tarjeta del editor.
//
// Seguridad: la dirección del reproductor NUNCA sale del link pegado. Se arma con una plantilla fija de
// drive.google.com (o docs.google.com, que también es de Drive) y el id, que solo puede tener letras,
// números, "_" y "-". Así ningún link, aunque venga editado a mano en el documento compartido, mete una
// dirección cualquiera en un iframe.

export type DriveLinkKind = 'file' | 'folder' | 'doc';

/**
 * Los tipos de docs.google.com que se reconocen (documento, planilla, presentación, dibujo). Los
 * formularios no: una tarjeta con un formulario podría parecer parte de la app; quedan como link común.
 */
export type DriveDocType = 'document' | 'spreadsheets' | 'presentation' | 'drawings';

export interface DriveLink {
  kind: DriveLinkKind;
  /** El id del archivo o de la carpeta en Drive. */
  id: string;
  /** Solo para `kind: 'doc'`. */
  docType?: DriveDocType;
  /** La clave de recurso de los links compartidos desde 2021 (hace falta para verlos). */
  resourceKey?: string;
}

const ID = /^[A-Za-z0-9_-]{10,128}$/;
const RESOURCE_KEY = /^[A-Za-z0-9_-]{1,128}$/;
const DOC_TYPES: readonly DriveDocType[] = ['document', 'spreadsheets', 'presentation', 'drawings'];

/** El id si tiene el formato de Drive; si no, `null`. */
export function validDriveId(id: string | null | undefined): string | null {
  return id && ID.test(id) ? id : null;
}

/**
 * El link de Drive que hay en `text` (un link solo, sin nada alrededor salvo espacios), o `null`.
 * Reconoce:
 * - `https://drive.google.com/file/d/<id>/…` (también `/file/u/<n>/d/<id>`)
 * - `https://drive.google.com/open?id=<id>` y `https://drive.google.com/uc?id=<id>`
 * - `https://drive.google.com/drive/folders/<id>` (también con `/u/<n>/` y `/mobile/`)
 * - `https://docs.google.com/<document|spreadsheets|presentation|drawings>/d/<id>/…` (un formulario,
 *   `docs.google.com/forms/…`, no: se pega como link común)
 * - `https://docs.google.com/file/d/<id>/…` y `https://docs.google.com/open?id=<id>` (links viejos)
 */
export function parseDriveLink(text: string | null | undefined): DriveLink | null {
  const raw = text?.trim();
  if (!raw || /\s/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'drive.google.com' && host !== 'docs.google.com') return null;

  const parts = url.pathname.split('/').filter(Boolean);
  const rk = url.searchParams.get('resourcekey');
  const resourceKey = rk && RESOURCE_KEY.test(rk) ? rk : undefined;
  const make = (kind: DriveLinkKind, id: string | null | undefined, docType?: DriveDocType): DriveLink | null => {
    const valid = validDriveId(id);
    if (!valid) return null;
    return { kind, id: valid, ...(docType ? { docType } : {}), ...(resourceKey ? { resourceKey } : {}) };
  };
  /** Saca un `u/<n>` (la cuenta elegida en el navegador) de la posición `at`. */
  const skipAccount = (at: number) => (parts[at] === 'u' && /^\d+$/.test(parts[at + 1] ?? '') ? at + 2 : at);

  // /open?id=… y /uc?id=… (en los dos dominios).
  if (parts.length === 1 && (parts[0] === 'open' || parts[0] === 'uc')) return make('file', url.searchParams.get('id'));

  // /file/d/<id>/… (en los dos dominios).
  if (parts[0] === 'file') {
    const at = skipAccount(1);
    return parts[at] === 'd' ? make('file', parts[at + 1]) : null;
  }

  if (host === 'drive.google.com') {
    // /drive/folders/<id>, /drive/u/0/folders/<id>, /drive/mobile/folders/<id>…
    if (parts[0] !== 'drive') return null;
    let at = skipAccount(1);
    if (parts[at] === 'mobile') at++;
    return parts[at] === 'folders' ? make('folder', parts[at + 1]) : null;
  }

  // docs.google.com/<tipo>/d/<id>/… (los formularios, /forms/…, no se reconocen).
  const docType = DOC_TYPES.find((t) => t === parts[0]);
  if (!docType) return null;
  const at = skipAccount(1);
  return parts[at] === 'd' ? make('doc', parts[at + 1], docType) : null;
}

/** La dirección del reproductor de Drive para la tarjeta. Siempre de drive.google.com o docs.google.com. */
export function drivePreviewUrl(link: DriveLink): string {
  const id = validDriveId(link.id);
  if (!id) throw new Error('Invalid Drive id');
  const rk = link.resourceKey && RESOURCE_KEY.test(link.resourceKey) ? link.resourceKey : '';
  if (link.kind === 'folder') {
    // La vista de una carpeta: la lista de sus archivos.
    return `https://drive.google.com/embeddedfolderview?id=${id}${rk ? `&resourcekey=${rk}` : ''}#grid`;
  }
  if (link.kind === 'doc') {
    if (!link.docType || !DOC_TYPES.includes(link.docType)) throw new Error('Unsupported Drive document type');
    return `https://docs.google.com/${link.docType}/d/${id}/preview${rk ? `?resourcekey=${rk}` : ''}`;
  }
  return `https://drive.google.com/file/d/${id}/preview${rk ? `?resourcekey=${rk}` : ''}`;
}

/** La dirección para abrir el archivo o la carpeta en Drive (el pie de la tarjeta). */
export function driveOpenUrl(link: DriveLink): string {
  const id = validDriveId(link.id);
  if (!id) throw new Error('Invalid Drive id');
  const rk = link.resourceKey && RESOURCE_KEY.test(link.resourceKey) ? `?resourcekey=${link.resourceKey}` : '';
  if (link.kind === 'folder') return `https://drive.google.com/drive/folders/${id}${rk}`;
  if (link.kind === 'doc') {
    if (!link.docType || !DOC_TYPES.includes(link.docType)) throw new Error('Unsupported Drive document type');
    return `https://docs.google.com/${link.docType}/d/${id}/edit${rk}`;
  }
  return `https://drive.google.com/file/d/${id}/view${rk}`;
}

/** Dos links apuntan a lo mismo (para no recargar el reproductor si el link no cambió). */
export function sameDriveLink(a: DriveLink | null, b: DriveLink | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.id === b.id && a.docType === b.docType && a.resourceKey === b.resourceKey;
}
