import { deviceTraits } from '../services';

// Sacar una foto o filmar desde la app (Docs/Doc_Fotos_En_Linea.md, "Cámara"). La cámara es solo otra fuente de
// archivos: un selector del sistema con `capture`, que en el teléfono abre la cámara; lo que vuelve entra por el
// mismo camino que "/Image" (`pickFiles`, inlinePhotoCreate.ts) y sube al Drive por la cola de siempre.
// "Save to camera roll" es la hoja de compartir del sistema con el archivo (`navigator.share`): ahí la persona
// elige "Guardar imagen" o "Guardar video". Guardar en el carrete sin la hoja espera la app nativa.

export type CameraKind = 'photo' | 'video';

/** Qué ofrece el selector para cada una. */
export const CAMERA_ACCEPT: Record<CameraKind, string> = { photo: 'image/*', video: 'video/*' };

/** La cámara de atrás: la de sacar fotos de lo que se tiene adelante (la de la persona es `user`). */
export const CAMERA_FACING = 'environment';

/**
 * Lo que se ofrece para sacar con la cámara: nada en la compu (ahí `capture` no abre la cámara sino el mismo
 * selector de "/Image", y sería una entrada repetida); solo en el teléfono, la foto, y el video solo con
 * portero (sin portero solo se guardan imágenes).
 */
export function cameraKinds(opts: { phone: boolean; videos: boolean }): CameraKind[] {
  if (!opts.phone) return [];
  return opts.videos ? ['photo', 'video'] : ['photo'];
}

/**
 * Captura solo en teléfonos identificables: iPhone o Android Mobile con pantalla táctil. Un puntero grueso o
 * una ventana chica también pueden ser de una computadora o tableta, así que no alcanzan. Si "Sitio de
 * escritorio" oculta la identidad del teléfono, se omite la cámara; elegir archivos existentes sigue disponible.
 */
export function capturePhone(n: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!n || !(n.maxTouchPoints > 0)) return false;
  const ua = n.userAgent;
  if (/iPad|iPod|Tablet|PlayBook|Silk|Kindle|Windows|Macintosh|CrOS/i.test(ua)) return false;
  return /iPhone/i.test(ua) || (/Android/i.test(ua) && /\bMobile\b/i.test(ua));
}

/** Si este dispositivo es de toque (el puntero principal es un dedo): el teléfono y la tableta. */
export function touchDevice(): boolean {
  return deviceTraits().phone;
}

// --- Save to camera roll -------------------------------------------------------------------------------------

type ShareNavigator = Pick<Navigator, 'share' | 'canShare'>;

const nav = (): Partial<ShareNavigator> | undefined => (typeof navigator === 'undefined' ? undefined : navigator);

/**
 * Si el navegador puede pasar archivos a la hoja de compartir. Se prueba con una foto vacía: un navegador que no
 * comparte archivos (Firefox de escritorio, Safari viejo) no tiene `canShare` o dice que no.
 */
export function canShareFiles(n: Partial<ShareNavigator> | undefined = nav()): boolean {
  if (!n || typeof n.share !== 'function' || typeof n.canShare !== 'function') return false;
  try {
    return n.canShare({ files: [new File([''], 'photo.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

/**
 * Si va "Save to camera roll": una foto o un video (un adjunto no va al carrete), en un dispositivo de toque (en la
 * compu la hoja de compartir no tiene carrete) y con un navegador que comparte archivos.
 */
export function saveToRollOffered(opts: { kind: 'image' | 'video' | 'file'; touch: boolean; share: boolean }): boolean {
  return opts.kind !== 'file' && opts.touch && opts.share;
}

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

/**
 * El archivo para la hoja de compartir, con su tipo: sin tipo (o `application/octet-stream`, como sale a veces
 * del Drive), el iPhone no ofrece "Guardar imagen". El tipo sale del blob, del que dice la cola o de la extensión.
 */
export function shareFileOf(blob: Blob, name: string, mime?: string): File {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  const usable = (t?: string) => !!t && t !== 'application/octet-stream';
  const type = usable(blob.type) ? blob.type : usable(mime) ? mime! : (TYPES[ext] ?? 'application/octet-stream');
  return new File([blob], name || (type.startsWith('video/') ? 'video.mp4' : 'photo.jpg'), { type });
}

/**
 * Cómo terminó la hoja: `shared` (se eligió algo), `cancelled` (se cerró sin elegir), `again` (el navegador no la
 * abrió porque se tardó en preparar el archivo después del toque: con el archivo listo, otro toque la abre),
 * `unsupported` (este archivo no se puede compartir) o `failed`.
 */
export type ShareResult = 'shared' | 'cancelled' | 'again' | 'unsupported' | 'failed';

export async function shareFile(file: File, n: Partial<ShareNavigator> | undefined = nav()): Promise<ShareResult> {
  if (!n || typeof n.share !== 'function') return 'unsupported';
  if (typeof n.canShare === 'function' && !n.canShare({ files: [file] })) return 'unsupported';
  try {
    await n.share({ files: [file] });
    return 'shared';
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'AbortError') return 'cancelled';
    // Safari y Chrome piden un toque reciente: si bajar el archivo tardó, lo rechazan con NotAllowedError.
    if (name === 'NotAllowedError') return 'again';
    return 'failed';
  }
}

// --- Las entradas fuera del editor (el menú de la página) ---------------------------------------------------

/** Abre la cámara para esa página (lo registra el editor abierto, PageEditor.tsx). */
export type PageCamera = { kinds: CameraKind[]; open: (kind: CameraKind) => void };

const cameras = new Map<string, PageCamera>();

/** El editor de la página la registra mientras está abierto y se puede editar; devuelve cómo sacarla. */
export function registerPageCamera(pageId: string, camera: PageCamera): () => void {
  cameras.set(pageId, camera);
  return () => {
    if (cameras.get(pageId) === camera) cameras.delete(pageId);
  };
}

/** La cámara de esa página, si su editor está abierto, se puede editar y hay algo que ofrecer. */
export function pageCameraFor(pageId: string): PageCamera | null {
  const camera = cameras.get(pageId);
  return camera && camera.kinds.length > 0 ? camera : null;
}
