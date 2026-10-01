import { createInlineContentSpecFromTipTapNode } from '@blocknote/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

// --- Fotos en línea (Docs/Doc_Fotos_En_Linea.md, entrega 1a) -------------------------------------------
//
// La foto como un carácter del renglón: un nodo en línea, atómico (sin contenido adentro), que vive en el
// texto de un párrafo, un título, un ítem de lista, una cita o una celda de tabla, entre letras.
//
// ESTE SÍ ES UN TIPO DE NODO NUEVO, la excepción a la regla "nada de tipos nuevos" (editorSchema.ts): una
// versión que no lo conoce lo borraría del documento compartido al abrir la página. Lo que la cubre es el
// resguardo de `unknownContent.ts` (toda versión que puede entrar lo tiene: `min_app_version`), que no abre
// en el editor una página con algo que no conoce. Por eso esta versión solo lo CONOCE (lo muestra y lo
// edita): nada en la app lo crea todavía (ni pegar, ni soltar, ni importar). Recién cuando el workspace
// exija esta versión se publica la que lo crea.
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
    };
  },

  // La marca para el parche de y-prosemirror (ver GAP_TEXT_SPEC). Tiptap llama a esta función con cada nodo
  // del esquema: solo `photo` la lleva.
  extendNodeSchema(extension) {
    return extension.name === PHOTO ? { [GAP_TEXT_SPEC]: true } : {};
  },

  // Solo lo que copió la propia app. Sin regla para un `<img>` de afuera, a propósito: pegar de una web no
  // tiene que crear fotos en línea mientras haya versiones permitidas que no las conocen.
  parseHTML() {
    return [{ tag: `span[data-inline-content-type="${PHOTO}"]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-inline-content-type': PHOTO, class: 'sd-photo' }),
      ['img', { src: String(node.attrs.url ?? ''), alt: String(node.attrs.name ?? '') }],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const { dom, img } = photoElement();
      // El navegador no edita adentro de la foto ni la arrastra por su cuenta (la mueve el editor).
      dom.contentEditable = 'false';
      // La clase que buscan la nitidez y la impresión (`img.bn-visual-media`), como la foto-bloque.
      img.className = 'bn-visual-media';
      img.draggable = false;

      let shown: PhotoProps | null = null;
      const paint = (n: PMNode) => {
        const props = propsOf(n);
        // La imagen se toca SOLO si cambió la dirección: cambiar el ancho no la vuelve a cargar ni a dibujar.
        if (!shown || shown.url !== props.url) showSource(img, props.url);
        if (!shown || shown.name !== props.name) img.alt = props.name;
        setData(dom, props);
        shown = props;
      };
      paint(node);

      return {
        dom,
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

/**
 * Pone la imagen en su `<img>`. PUNTO DE ENGANCHE de la entrega 1b: acá entran la resolución de
 * `sdmedia://<id>` (`resolveFileUrl`), la miniatura y la mejora de nitidez, como en la foto-bloque. Por ahora
 * va la dirección tal cual: una `https` se ve; una `sdmedia://` queda sin imagen hasta la 1b (nada en la app
 * crea fotos en línea todavía).
 */
function showSource(img: HTMLImageElement, url: string): void {
  if (url) img.src = url;
  else img.removeAttribute('src');
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
      if (props.url) img.src = props.url;
      img.alt = props.name;
      return { dom };
    },
  },
);
