// Qué navegadores respetan una hoja distinta por página al imprimir (P.22, Docs/Doc_Exportar.md, EX3).
//
// Las "páginas con nombre" de CSS (`@page sd-a4 { size: … }` y `page: sd-a4` en el contenedor) dan un PDF con hojas
// de tamaños distintos. Que el navegador entienda la propiedad (`CSS.supports('page', …)`, Firefox desde la 110) no
// prueba que su diálogo de imprimir respete cada tamaño: si el PDF sale con uno solo no hay cómo enterarse. Por eso se
// decide por una lista de navegadores MEDIDOS con `window.print()` y *Save as PDF* reales (entrega 1: Chrome y Edge
// de computadora). En los demás todo sale con la hoja de la raíz, repaginado, y la ventana lo avisa antes. Un
// navegador entra a la lista recién con su medición.

interface Brand {
  brand: string;
  version: string;
}

interface NavigatorLike {
  userAgent: string;
  maxTouchPoints?: number;
  userAgentData?: { brands?: Brand[]; mobile?: boolean };
}

/** Los navegadores de la lista, por la marca que dan (`navigator.userAgentData`). */
const MEASURED_BRANDS = ['Google Chrome', 'Microsoft Edge'];

/** Otros navegadores hechos sobre Chromium que no se midieron (dicen "Chrome" en el `userAgent`). */
const OTHER_CHROMIUM = /\b(OPR|Opera|Brave|Vivaldi|YaBrowser|SamsungBrowser|Electron|Tauri|CriOS|EdgiOS|EdgA)\b/;

/** Un teléfono o una tableta (el diálogo de imprimir de un táctil no se midió). */
const MOBILE = /\b(Android|iPhone|iPad|iPod|Mobile)\b/;

/**
 * El navegador imprime cada página con su hoja (está en la lista medida): Chrome o Edge de computadora. Sin datos
 * (pruebas, servidor), no.
 */
export function keepsPageSizes(nav: NavigatorLike | null = typeof navigator === 'undefined' ? null : navigator): boolean {
  if (!nav) return false;
  const data = nav.userAgentData;
  if (data?.brands?.length) {
    if (data.mobile) return false;
    return data.brands.some((b) => MEASURED_BRANDS.includes(b.brand));
  }
  const ua = nav.userAgent ?? '';
  if (MOBILE.test(ua) || OTHER_CHROMIUM.test(ua)) return false;
  // Un iPad con Safari de escritorio dice "Macintosh": se lo reconoce por el táctil.
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return false;
  return /\bEdg\/\d+/.test(ua) || (/\bChrome\/\d+/.test(ua) && /\bSafari\/\d+/.test(ua));
}

/**
 * Un teléfono o una tableta (los topes de memoria son los del táctil). No alcanza con que tenga pantalla táctil:
 * una computadora con pantalla táctil apunta con el mouse (`pointer: fine`) y tiene la memoria de una computadora.
 */
export function touchDevice(nav: NavigatorLike | null = typeof navigator === 'undefined' ? null : navigator): boolean {
  if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return true;
  if (!nav) return false;
  if (nav.userAgentData?.mobile) return true;
  const ua = nav.userAgent ?? '';
  return /\b(Android|iPhone|iPad|iPod)\b/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
}
