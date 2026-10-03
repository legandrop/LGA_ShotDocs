import { createInlineContentSpecFromTipTapNode } from '@blocknote/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { t } from '../i18n';
import '../i18n/lazy/editor';
import { pxToRowWidth, snapRowWidth } from './imageRows';
import { isAppMediaUrl, setQuietSrc } from './quietImage';

// --- Fotos en línea (Docs/Doc_Fotos_En_Linea.md, entrega 1a) -------------------------------------------
//
// La foto como un carácter del renglón: un nodo en línea, atómico (sin contenido adentro), que vive en el
// texto de un párrafo, un título, un ítem de lista, una cita o una celda de tabla, entre letras.
//
// ESTE SÍ ES UN TIPO DE NODO NUEVO, la excepción a la regla "nada de tipos nuevos" (editorSchema.ts): una
// versión que no lo conoce lo borraría del documento compartido al abrir la página. Lo que la cubre es el
// resguardo de `unknownContent.ts` (toda versión que puede entrar lo tiene, desde v0.021), que no abre en el
// editor una página con algo que no conoce: la foto (v0.052 a v0.075) o la marca del renglón `lgaStableGaps`
// (también v0.076), que queda aunque al renglón le borren todas las fotos. Desde v0.078 la crean pegar, soltar y
// el menú "/" (inlinePhotoCreate.ts); importar de Coda, todavía no (entrega 4).
//
// Propiedades:
// - `url`: `sdmedia://<id>` (o una dirección `https`). Se llama `url` a propósito: `mediaIdsInDoc`
//   (media/usage.ts) cuenta como usado el archivo de cualquier elemento con ese atributo.
// - `name`: el nombre del archivo.
// - `w`: el ancho, como parte del ancho del renglón (0 a 1), con el mismo significado que `rowWidth` de las
//   fotos-bloque (imageRows.ts). 0: su ancho natural.

export const PHOTO = 'photo';

/**
 * La marca que lee el parche de y-prosemirror (`normalizePNodeContent`, patches/): alrededor de un nodo en
 * línea que la tiene, donde no hay texto (antes, entre o después de fotos) se guarda un texto vacío. Así dos
 * personas que escriben a la vez en ese hueco escriben en el mismo texto, en vez de crear cada una el suyo
 * (después se juntan mal: se pierde o se duplica lo escrito). Ver Docs/Doc_Colaboracion.md.
 */
export const GAP_TEXT_SPEC = 'lgaGapText';

export interface PhotoProps {
  url: string;
  name: string;
  w: number;
}

const attr = (el: HTMLElement, name: string) => el.getAttribute(name) ?? '';

/** `w` válido: un número entre 0 y 1 (cualquier otra cosa, 0: ancho natural). */
export function photoWidth(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1) : 0;
}

/** El elemento de la foto en línea: un `<span>` con su `<img>` adentro (el mismo en el editor y en el HTML suelto). */
function photoElement(): { dom: HTMLElement; img: HTMLImageElement } {
  const dom = document.createElement('span');
  dom.className = 'sd-photo';
  dom.setAttribute('data-inline-content-type', PHOTO);
  const img = document.createElement('img');
  dom.append(img);
  return { dom, img };
}

/** Las propiedades en `data-*`: la forma que lee `parseHTML` (portapapeles) y la que van a buscar los selectores. */
function setData(dom: HTMLElement, props: PhotoProps): void {
  dom.setAttribute('data-url', props.url);
  dom.setAttribute('data-name', props.name);
  dom.setAttribute('data-w', String(props.w));
}

const propsOf = (node: PMNode): PhotoProps => ({
  url: String(node.attrs.url ?? ''),
  name: String(node.attrs.name ?? ''),
  w: photoWidth(node.attrs.w),
});

export const PhotoNode = Node.create({
  name: PHOTO,
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: (el: HTMLElement) => attr(el, 'data-url'),
        renderHTML: (a: Record<string, unknown>) => ({ 'data-url': String(a.url ?? '') }),
      },
      name: {
        default: '',
        parseHTML: (el: HTMLElement) => attr(el, 'data-name'),
        renderHTML: (a: Record<string, unknown>) => ({ 'data-name': String(a.name ?? '') }),
      },
      w: {
        default: 0,
        parseHTML: (el: HTMLElement) => photoWidth(attr(el, 'data-w')),
        renderHTML: (a: Record<string, unknown>) => ({ 'data-w': String(photoWidth(a.w)) }),
      },
      // La foto empieza una fila ("Arrange in rows" de las elegidas, D-24 y auditoría de la entrega 2): las filas se
      // arman desde acá aunque la foto de antes deje lugar. Solo `true` o nada (sin valor no se guarda nada).
      rowStart: {
        default: null,
        parseHTML: (el: HTMLElement) => (el.getAttribute('data-row-start') === 'true' ? true : null),
        renderHTML: (a: Record<string, unknown>) => (a.rowStart === true ? { 'data-row-start': 'true' } : {}),
      },
    };
  },

  // La marca para el parche de y-prosemirror (ver GAP_TEXT_SPEC). Tiptap llama a esta función con cada nodo
  // del esquema: solo `photo` la lleva.
  extendNodeSchema(extension) {
    return extension.name === PHOTO ? { [GAP_TEXT_SPEC]: true } : {};
  },

  // Solo lo que copió la propia app. Sin regla para un `<img>` de afuera: pegar HTML de una web o de otro programa
  // sigue creando fotos-bloque (y pasa por la conversión de imágenes `data:`, que mira bloques); llevarlo al renglón
  // es de la entrega 3.
  parseHTML() {
    return [{ tag: `span[data-inline-content-type="${PHOTO}"]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-inline-content-type': PHOTO, class: 'sd-photo' }),
      // `loading` primero: un `sdmedia://` en un `<img>` que no se muestra no se pide (quietImage.ts).
      ['img', { ...(isAppMediaUrl(node.attrs.url) ? { loading: 'lazy' } : {}), src: String(node.attrs.url ?? ''), alt: String(node.attrs.name ?? '') }],
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const { dom, img } = photoElement();
      // El navegador no edita adentro de la foto ni la arrastra por su cuenta (la mueve el editor).
      dom.contentEditable = 'false';
      // La clase que buscan la nitidez y la impresión (`img.bn-visual-media`), como la foto-bloque.
      img.className = 'bn-visual-media';
      img.draggable = false;

      let shown: PhotoProps | null = null;
      /** Cuántas veces se pidió la imagen: una respuesta vieja (la dirección cambió mientras tanto) no se pone. */
      const asked = { count: 0 };
      const paint = (n: PMNode) => {
        const props = propsOf(n);
        // La imagen se toca SOLO si cambió la dirección: cambiar el ancho no la vuelve a cargar ni a dibujar.
        if (!shown || shown.url !== props.url) showSource(img, props.url, resolverOf(n), asked);
        if (!shown || shown.name !== props.name) img.alt = props.name;
        setData(dom, props);
        // El ancho, para el CSS de las filas (styles.css, "Fotos en línea"); cuántas hay en la fila lo pone
        // la decoración de inlinePhotoEditor.ts.
        dom.style.setProperty('--ph-w', String(props.w));
        shown = props;
      };
      paint(node);
      // Los tiradores, como los de la foto-bloque (D-24): arrastrar cambia `w`, imantado a 1, 1/2, 1/3 y 1/4.
      const stopHandles = addResizeHandles(dom, img, () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        return typeof pos === 'number' && editor.isEditable ? { view: editor.view, pos } : null;
      });

      return {
        dom,
        destroy: stopHandles,
        // Un cambio de propiedades reusa esta vista y su `<img>` (sin `update`, el editor la tira y arma otra).
        update(n: PMNode) {
          if (n.type.name !== PHOTO) return false;
          paint(n);
          return true;
        },
        // Lo de adentro lo maneja esta vista (y, más adelante, la carga de la imagen): el editor no lo relee.
        ignoreMutation: () => true,
      };
    };
  },
});

type Resolver = (url: string) => Promise<string>;

/**
 * El `resolveFileUrl` del editor de BlockNote que dibuja la foto (el de la página: PageEditor.tsx), o `null`
 * (un editor sin él, como el de las pruebas). BlockNote deja el editor en el esquema de ProseMirror.
 */
function resolverOf(node: PMNode): Resolver | null {
  const editor = (node.type.schema.cached as { blockNoteEditor?: { resolveFileUrl?: Resolver } }).blockNoteEditor;
  return editor?.resolveFileUrl ?? null;
}

/**
 * Pone la imagen en su `<img>`, como el bloque `image` de BlockNote: la dirección pasa por `resolveFileUrl`, que
 * en la app da la miniatura de `sdmedia://<id>` (del dispositivo o bajada), el cuadro con la marca de reproducir
 * de un video, el marcador de un archivo que se está subiendo, sin red o de otro proyecto, o la dirección tal
 * cual (`https`). Cuando llega una miniatura después, o una imagen nítida, las cambian `subscribeThumbs`
 * (PageEditor.tsx) y sharpImages.ts, que encuentran esta foto por su `.sd-photo[data-url]`.
 */
function showSource(img: HTMLImageElement, url: string, resolve: Resolver | null, asked: { count: number }): void {
  const ask = ++asked.count;
  if (!url) {
    img.removeAttribute('src');
    return;
  }
  if (!resolve) {
    // Un editor sin `resolveFileUrl` no sabe mostrar un archivo de la app: sin imagen, y sin pedirla al navegador.
    if (isAppMediaUrl(url)) img.removeAttribute('src');
    else img.src = url;
    return;
  }
  // Mientras se busca, sin imagen (una `sdmedia://` el navegador no la sabe abrir).
  img.removeAttribute('src');
  void resolve(url).then(
    (src) => {
      if (ask === asked.count) img.src = src;
    },
    () => undefined,
  );
}

export const photoSpec = createInlineContentSpecFromTipTapNode(
  PhotoNode,
  { url: { default: '' }, name: { default: '' }, w: { default: 0 } },
  {
    // Copiar adentro de la app y exportar: la misma forma que `renderHTML` y que lee `parseHTML`.
    render: (inlineContent: { props: Partial<PhotoProps> }) => {
      const props: PhotoProps = {
        url: String(inlineContent.props.url ?? ''),
        name: String(inlineContent.props.name ?? ''),
        w: photoWidth(inlineContent.props.w),
      };
      const { dom, img } = photoElement();
      setData(dom, props);
      if (props.url) setQuietSrc(img, props.url);
      img.alt = props.name;
      return { dom };
    },
  },
);

// --- Tiradores (D-24, paridad con la foto-bloque) ----------------------------------------------------------
//
// Dos tiradores, a los costados de la foto (los de BlockNote: una barrita negra con borde blanco), que se ven con la
// foto elegida o al pasar el mouse (styles.css). Arrastrar cambia el ancho en vivo (solo en pantalla) y, al soltar, lo
// guarda como `w`: la inversa del CSS de las filas (`pxToRowWidth`, con cuántas hay en la fila) imantada a 1, 1/2,
// 1/3 o 1/4 si queda a menos de 2 % (`snapRowWidth`), en un solo cambio. Como la foto-bloque: cuenta solo con el
// botón principal y si se movió al menos 3 px (un temblor no cambia un ancho que dejó "Arrange in rows").

/** Lo más angosta que puede quedar una foto al arrastrar (px). */
const MIN_PX = 24;

interface Target {
  view: import('@tiptap/pm/view').EditorView;
  pos: number;
}

/**
 * El renglón de la foto: el texto de su bloque o, en una tabla, el de su celda (`td > p`; la tabla entera también lleva
 * `.bn-inline-content`, y el ancho de una foto en una celda es una parte de la celda, no de la tabla).
 */
export function photoLine(dom: Element): HTMLElement | null {
  return dom.closest<HTMLElement>('td > p, th > p, .bn-inline-content');
}

/** El ancho en px que da el CSS al renglón de la foto (sin relleno), el espacio entre fotos y cuántas hay en su fila. */
export function lineMetrics(dom: HTMLElement): { W: number; g: number; n: number } {
  const line = photoLine(dom) ?? dom.parentElement;
  const cs = line ? getComputedStyle(line) : null;
  const W = line && cs ? line.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) : 0;
  const g = parseFloat(getComputedStyle(dom).getPropertyValue('--img-gap')) || 8;
  const n = Number(dom.style.getPropertyValue('--row-n') || getComputedStyle(dom).getPropertyValue('--row-n')) || 1;
  return { W, g, n };
}

/** El `w` que corresponde a un ancho en px (imantado). */
export function widthFromPx(px: number, m: { W: number; g: number; n: number }): number {
  return snapRowWidth(pxToRowWidth(px, m.W, m.g, m.n));
}

function addResizeHandles(dom: HTMLElement, img: HTMLImageElement, target: () => Target | null): () => void {
  const cleanups: (() => void)[] = [];
  for (const side of ['left', 'right'] as const) {
    const handle = document.createElement('span');
    handle.className = `sd-photo-handle sd-photo-handle-${side}`;
    handle.setAttribute('aria-hidden', 'true');
    handle.dataset.tip = t('photoBar.resize');
    dom.append(handle);
    let drag: { id: number; startX: number; startW: number; px: number; moved: boolean } | null = null;
    // Que el editor no lo tome como un clic en la foto (elegirla, arrastrarla para moverla).
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !target()) return;
      swallow(e);
      const w = dom.getBoundingClientRect().width;
      drag = { id: e.pointerId, startX: e.clientX, startW: w, px: w, moved: false };
      handle.setPointerCapture?.(e.pointerId);
      dom.classList.add('sd-photo-resizing');
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.startX;
      if (Math.abs(dx) >= 3) drag.moved = true;
      const { W } = lineMetrics(dom);
      drag.px = Math.max(MIN_PX, Math.min(W > 0 ? W : Infinity, drag.startW + (side === 'right' ? dx : -dx)));
      dom.style.width = `${drag.px}px`;
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const done = drag;
      drag = null;
      handle.releasePointerCapture?.(e.pointerId);
      const m = lineMetrics(dom);
      dom.style.width = '';
      dom.classList.remove('sd-photo-resizing');
      const at = target();
      if (!done.moved || !at || !(m.W > 0)) return;
      const node = at.view.state.doc.nodeAt(at.pos);
      if (node?.type.name !== PHOTO) return;
      const w = widthFromPx(done.px, m);
      if (Math.abs(photoWidth(node.attrs.w) - w) > 1e-6) at.view.dispatch(at.view.state.tr.setNodeAttribute(at.pos, 'w', w));
    };
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('mousedown', swallow);
    handle.addEventListener('click', swallow);
    handle.addEventListener('dragstart', swallow);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    cleanups.push(() => handle.remove());
  }
  void img;
  return () => cleanups.forEach((c) => c());
}
