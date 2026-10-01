# Instalar la app (v0.079)

Pedido de Lega (2026-10-01): reconocer si la app está instalada y, si no, ofrecer instalarla (sin obligar a
nadie), con los pasos exactos para el iPhone y para Android.

## Por qué importa

En el iPhone y el iPad, Safari puede borrar lo que una web guarda en el dispositivo (la copia sin red, los cambios
que faltan subir) después de unos días sin abrirla. La app agregada a la pantalla de inicio tiene su propio
almacenamiento y Safari no lo borra. En Android y en la computadora, la app instalada se abre en su propia ventana
y el navegador le da almacenamiento persistente con más facilidad.

## Qué ve la persona

- **Menú de la cuenta → *Install app*** (con su tooltip), mientras la pestaña no es la app instalada.
- **Pantalla de entrar → *Install app*** en el pie: en el iPhone conviene instalar antes de entrar, porque la
  app instalada guarda su sesión aparte de Safari.
- **En el teléfono y la tableta (iPhone, iPad, Android)**, un aviso abajo de la barra de arriba: *Install* y
  *Not now*. Se va con el resto al desplazar (no tapa nada). *Not now* lo esconde por 30 días
  (`localStorage`, `shotdocs-install-banner`); instalar desde Chrome también. En la computadora no hay aviso.
- **La ventana de pasos** abre en la pestaña del dispositivo (*iPhone and iPad*, *Android*, *Computer*, la propia
  marcada con un punto) y deja ver las otras. Cada paso lleva un dibujo propio del botón o la opción que hay que
  tocar (Compartir de Safari, *Agregar a pantalla de inicio*, *Agregar* con *Abrir como app web*, el menú ⋮ de
  Chrome, *Instalar app*, el ícono de instalar de la barra de la dirección, *Archivo → Agregar al Dock*), con el
  objetivo marcado en ámbar. Son dibujos, no capturas: siguen el tema y el idioma de la app.
  - iPhone con Chrome, Edge o Firefox: los pasos de Safari más una nota (desde iOS 16.4 también pueden; si no
    aparece, Safari). En un navegador adentro de otra app (Instagram, la app de Google, un WebView): un aviso para
    abrir la página en Safari, con el link para copiar. Lo mismo en Android (Instagram, Facebook, un WebView, que
    dice `; wv)`): abrirla en Chrome.
  - El paso 1 del iPhone dibuja las dos barras de Safari: la compacta de iOS 26 (Compartir está adentro de **⋯**)
    y la de antes (Compartir abajo).
  - Android y computadora con Chrome o Edge: si el navegador ofreció instalar (`beforeinstallprompt`), un botón
    *Install* directo arriba de los pasos; el *Install* del aviso del teléfono instala directo.
  - El último paso del iPhone pide esperar a que no quede nada por subir (el ícono de arriba a la derecha pasa a
    ser un tilde verde; se describe el ícono y no un texto, que en el teléfono no se ve): lo que falta subir queda
    en Safari hasta que se vuelva a abrir (no se pierde, pero tarda).
- **La app instalada del iPhone arranca vacía**, como un dispositivo nuevo: su almacenamiento es aparte del de
  Safari (IndexedDB, `localStorage`, la sesión). Pide entrar y vuelve a bajar todo el contenido del servidor; lo
  que era solo de ese navegador (el último proyecto y la última página abiertos, el aviso cerrado, el ancho de la
  barra lateral) no pasa. Las preferencias de la cuenta (tema, letra, idioma) sí, porque viven en la cuenta.
  La Mac con *Agregar al Dock* funciona igual; en Android y en la computadora con Chrome o Edge, la app instalada
  comparte los datos del navegador.

## Cómo funciona

- `src/ui/install.ts` (primera carga): `detectPlatform` (por el `userAgent`; el iPad con iPadOS se presenta como
  Mac y se reconoce por la pantalla táctil), `isStandalone` (`display-mode` `standalone`, `minimal-ui` o
  `window-controls-overlay`, o `navigator.standalone` del iPhone; `fullscreen` no, porque también es la pantalla
  completa del navegador de la computadora), el pedido de Chrome
  guardado desde `main.tsx` antes de dibujar (se cancela la barrita propia de Chrome: el aviso hace lo mismo), y
  `appinstalled`.
- `src/ui/InstallBanner.tsx` (primera carga): el aviso y `InstallHost`, que dibuja la ventana (en la pantalla
  principal y en la de entrar).
- `src/ui/InstallDialog.tsx`, `installDialog.css` y `src/i18n/lazy/install.ts`: se bajan aparte (`lazyPart`).
- Pruebas: `src/ui/install.test.tsx` (plataformas con `userAgent` reales, instalada o no, el pedido de Chrome, el
  aviso y sus 30 días, la ventana en cada plataforma, el menú de la cuenta).

## El manifiesto

Ya tenía lo que piden iOS y Android: nombre y nombre corto, `display: standalone`, colores, íconos 192 y 512,
uno *maskable*, `apple-touch-icon` de 180 px sin transparencia, `apple-mobile-web-app-title`. Se sumó `id: '/'`
(la misma identidad que tenía sin `id`, explícita) y `mobile-web-app-capable` (Chrome avisa que el `apple-…` solo
está viejo). Quedan para más adelante: capturas en el manifiesto (`screenshots`, para la ventana de instalar más
completa de Android y Chrome) y la pantalla de arranque del iPhone (`apple-touch-startup-image`).

## Sin probar

En un iPhone y un Android de verdad: la detección se probó con los `userAgent` reales y la interfaz en Chromium
emulando cada teléfono, pero Chromium no instala como Safari. Las palabras de los menús cambian un poco con la
versión y el idioma del sistema (la ventana lo aclara).
