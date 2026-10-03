// Imágenes que llevan una dirección de la app (`sdmedia://<id>`) en un HTML que no se muestra: lo que arma
// BlockNote para el portapapeles y para arrastrar (`toExternalHTML`) y los HTML sueltos del editor.
//
// Un `<img>` con `src` hace un pedido apenas se le pone, aunque no esté en la página (también si lo crea un
// documento inerte y después se lo adopta), y el navegador no sabe abrir `sdmedia://`: queda un
// `net::ERR_UNKNOWN_URL_SCHEME` en la consola (B.24). Con `loading="lazy"` puesto ANTES del `src`, una imagen que
// no está en la página nunca se pide; la dirección queda escrita en el HTML, que es lo que lee el pegado.

/** El esquema de las fotos y los videos de la app (el mismo de `media/queue.ts`, sin traer esa cola entera). */
const APP_MEDIA = 'sdmedia://';

/** Una imagen transparente de 1×1: el `src` que lleva un bloque mientras se arma, hasta ponerle el verdadero. */
const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';

/** ¿La dirección es de un archivo de la app, que el navegador no puede pedir? */
export function isAppMediaUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith(APP_MEDIA);
}

/** La dirección de la imagen para un HTML que no se muestra: sin pedido si es de la app, como siempre si no. */
export function setQuietSrc(img: HTMLImageElement, url: string): void {
  if (isAppMediaUrl(url)) img.setAttribute('loading', 'lazy');
  img.setAttribute('src', url);
}

interface ExternalResult {
  dom: HTMLElement | DocumentFragment;
  contentDOM?: HTMLElement;
}

/**
 * Envuelve el `toExternalHTML` de un bloque de imagen: una foto de la app sale con su dirección en el `<img>` y en el
 * `data-url` del bloque, pero sin pedirla. El de BlockNote pone el `src` al crear la imagen, antes de poder marcarla:
 * se lo arma con una imagen mínima (y su `data-url`) y después se pone la dirección verdadera con la marca ya puesta.
 * Se llama con el mismo `this` y los mismos argumentos que el original (BlockNote lo usa para los atributos del bloque).
 */
export function quietExternalHtml<B extends { props: { url?: unknown } }, A extends unknown[]>(
  original: (this: unknown, block: B, ...rest: A) => ExternalResult,
): (this: unknown, block: B, ...rest: A) => ExternalResult {
  return function (this: unknown, block, ...rest) {
    const url = block.props.url;
    if (!isAppMediaUrl(url)) return original.call(this, block, ...rest);
    const out = original.call(this, { ...block, props: { ...block.props, url: PLACEHOLDER } }, ...rest);
    const els = [out.dom, ...Array.from((out.dom as ParentNode).querySelectorAll?.('*') ?? [])].filter((el): el is HTMLElement => el instanceof HTMLElement);
    for (const el of els) {
      if (el instanceof HTMLImageElement && el.getAttribute('src') === PLACEHOLDER) setQuietSrc(el, url);
      if (el.getAttribute('data-url') === PLACEHOLDER) el.setAttribute('data-url', url);
    }
    return out;
  };
}
