# La tabla en el teléfono (P.28)

Qué pasaba, cómo quedó y cómo se midió. Es presentación pura: no hay nada nuevo en el documento (`Y.Doc`), ni propiedad,
ni tipo de bloque, así que una versión vieja de la app abre y edita las mismas páginas sin perder nada.

## Qué pasaba

Las tablas de 5 o más columnas de las plantillas de fábrica (el *On-Set Report* tiene tres de 6 o 7) guardan el ancho
de cada columna: `colwidth` en las celdas, 97 px a 7 columnas (680 px entre todas, lo que entra en una hoja A4;
`SHEET_TABLE_PX` en `src/templates/builtin.ts`). BlockNote le pone a la tabla `width: auto !important` y su hoja de
estilos `table-layout: fixed`; con ancho automático el navegador deja la tabla en lo que cabe en su bloque. En la compu
caben los 680 px; en un teléfono de 375 px el bloque mide 335 y la tabla se **encogía a 304 px: cada columna de 42 px**,
una palabra por renglón (y las miniaturas de las celdas, de 21 px de ancho).

## Cómo quedó

Solo hasta 1024 px de ancho (`@media (max-width: 1024px)`: teléfono y tablet; desde v0.160, antes eran los 760 px del
teléfono que usa el resto de `styles.css`) y solo en la página abierta (`.page:not(.sd-export-source)`: la vista de impresión y el armado del PDF de exportar miden
con el ancho de la hoja y no se tocan):

- **Piso de 96 px por columna** con ancho guardado (`min-width` en las celdas con `colwidth`; el ancho de fábrica del
  reporte a 7 columnas es 97): ninguna columna baja de eso. Con el piso, la tabla de 7 columnas del reporte mide 673 px
  (7 × 96 + bordes) en vez de 680, y la de 12 columnas, 1153. Una columna que alguien angostó mucho en la compu se ve
  ahí con 96 px, para poder leerla. Los anchos guardados no se tocan. Con una columna sin ancho guardado no cambia
  nada: esas ya tenían su mínimo de 120 px por columna (`--default-cell-min-width`) y el `min-width` de la tabla.
- **No se fuerza el ancho de la tabla (D244).** Una primera versión le ponía `width: max-content` para que midiera la
  suma exacta de lo guardado (680 en vez de 673); se sacó porque también agrandaba tablas que sí cabían: una de 3
  columnas de 227 px o una de 2 de 340 pasaban de 304 a 681 px y había que desplazarlas. Así, solo se desplaza la tabla
  que quedaría con columnas de menos de 96 px; la que entra en la pantalla con columnas de 96 o más se achica como
  siempre (3 × 227: 101 por columna, 2 × 340: 152).
- **La tabla se desplaza de costado dentro de su bloque.** Ya lo hacía el contenedor de BlockNote (`.tableWrapper`
  recorta en vertical y por lo tanto desplaza en horizontal); lo único agregado es `overscroll-behavior-x: contain`,
  para que llegar al borde de la tabla no arrastre la página. La página no se corre de costado y el gesto vertical
  sigue moviendo la página aunque empiece sobre la tabla.
- **La celda donde se escribe se acomoda a la vista** (`src/ui/tableScroll.ts`, enganchado a la selección en
  `PageEditor.tsx`): el editor ya lleva el cursor a la vista, pero con Tab o las flechas lo dejaba pegado al borde con
  la celda cortada. Ahora corre el contenedor lo justo para que la celda entre entera. Solo de costado, solo dentro de la
  tabla, solo en pantalla angosta, y no hace nada con una celda más ancha que lo visible.
- Ayuda: *Wide tables on a phone / Tablas anchas en el teléfono*.

## Qué no cambia

- **La compu y el PDF:** las tablas miden lo mismo antes y después (las 7 tablas del reporte, comparadas con lo medido
  antes del cambio; 680 / 113 / 97 px por columna, sin desplazamiento),
  la vista de impresión de una página A4 mide lo mismo en el teléfono que en la compu, y el PDF sale igual.
- **Las fotos en las celdas** (miniaturas Small, Medium y Large) miden igual que en la compu: antes, en el teléfono,
  las de una tabla de 7 columnas quedaban en 21 px de ancho.
- **Una pantalla angosta con mouse** (una ventana de compu de hasta 1024 px) recibe lo mismo que el teléfono: es el mismo corte.

## Cómo se midió

Chromium de Playwright sin ventana, perfil temporal, sobre la página real (`PageView`) con el servidor en memoria y sin
login. Teléfono: 375 × 812, con toque y `hover: none`; compu: 1280 × 900. El reporte de fábrica completo más una tabla
de 7 columnas con fotos en las celdas, una de 12 columnas de 97 px, una de 3 × 227, una de 2 × 340 y una de 3 × 50.
Resultado de la ronda 1: **39 de 39** (el script y los números se guardan fuera del repo). Lo que se comprobó, en el
teléfono:

- las tablas de 7 columnas miden 673 px con columnas de 96 (antes 304 y unos 42); la de 12 columnas, 1153; la página no
  se corre de costado;
- 3 × 227 y 2 × 340 no se desplazan (columnas de 101 y 152); 3 × 50 queda en 3 × 96 y entra;
- un gesto táctil de costado desplaza la tabla (no la página) y uno vertical mueve la página;
- tocar la última columna y escribir deja la celda a la vista; Tab recorre las 7 columnas y flecha izquierda y derecha
  vuelven, con la celda del cursor siempre entera a la vista; en la de 12 columnas, Tab recorre las 11 siguientes y
  pasa a la fila de abajo (el contenedor vuelve al inicio) y Shift+Tab vuelve a la columna 12; la selección de celdas
  con Shift más flechas anda;
- las miniaturas Small, Medium y Large miden igual que en la compu (hasta 2 px: columnas de 96 contra 97); tocar una
  abre el carrete y el segundo toque muestra su barra, que cabe en la pantalla;
- una página A4 en el teléfono se ve libre (como ya era), y la vista de impresión y el armado del PDF de exportar miden
  lo mismo que en la compu.

Un hallazgo que venía de antes y no era de las tablas (arreglado en v0.160): en el teléfono el botón de comentar del
margen (`.comment-add`) se pasaba 4 px del borde derecho cuando había una selección, y la página se podía arrastrar 4 px
de costado. Era `right: -4px` en la regla de teléfono de `.comment-count, .comment-add`; ahora `right: 0` (medido a 360,
375 y 414 px: el borde derecho del botón queda en el ancho de la pantalla y la página no se corre).

**El botón de comentar ya no tapa el final del renglón (v0.165).** Con `right: 0` el botón (28 px) pasaba por arriba del
margen de la página en el teléfono (`--gutter`, 20 px) y tapaba hasta 8 px del final de un renglón muy largo. Medido en
Chromium con un párrafo de renglones a ras del margen: a 375 px el texto llegaba a 353,8 y el botón empezaba en 347 (6,8 px
encima); a 390 px, 367,7 contra 362 (5,7 px). Ahora, a 760 px o menos, el botón mide el margen (`width: var(--gutter)`, 20
px, pegado al borde): empieza en 355 y 370, y el texto termina en 353,8 y 367,7 (sin superposición). Para el dedo el área
que responde sigue siendo de 44 px de alto: un `::after` se estira 10 px para arriba y para abajo, nunca hacia los
costados, así no llega al texto. La compu y la tablet (margen de 54 px) siguen con 28 px. Prueba:
`src/ui/commentButtonPhone.test.ts`.

**El contador de comentarios tampoco pasa del margen (restos de la tanda 17).** El contador (`.comment-count`: globo y
número uno al lado del otro) medía 39,8 px con 1 comentario, 47,2 con 12 y 55,2 con 120, y a 360, 375, 390 y 414 px pasaba
sobre el texto 19,8, 27,2 y 35,2 px (el borde derecho del texto queda 20 px antes del de la pantalla). Ahora, a 760 px o
menos, es una pastilla de 20 px de ancho (el margen) pegada al borde, con el globo (12 px) arriba y el número (10 px) abajo:
mide 20 × 29 px y con 1, 12 y 120 comentarios la superposición con el texto es de 0 px en los cuatro anchos, sin
desplazamiento de la página. Con 4 dígitos o más (mil comentarios en un bloque, no probable) el ancho crece a 26 px antes
de cortar el número. Dos renglones sueltos comentados, uno debajo del otro (30 px de paso), no se pisan (29 px de alto). El
área del dedo es de unos 47 px de alto (`::after` con `inset: -8px 0`: solo para arriba y para abajo). La compu y la
tablet (más de 760 px) no cambian: medido, 39,8 / 47,2 / 55,2 px de ancho como antes. Prueba: `commentButtonPhone.test.ts`
(4 casos nuevos sobre el CSS; la medida con el diseño real está en el informe del frente).

## Pruebas

`src/ui/tableScroll.test.ts` (la lógica de acomodar la celda: cortada por la derecha, por la izquierda, entera, tabla
que entra, celda más ancha que lo visible, pantalla ancha), `src/ui/tableScrollWire.test.tsx` (el cableado: el editor de
la página llama a `revealSelectionCell` en cada cambio de selección, también entre celdas de una tabla) y
`src/ui/tablePhone.test.ts` (el CSS: solo pantalla angosta, solo la página abierta, piso de 96 px solo con `colwidth`,
sin forzar el ancho de la tabla, el desplazamiento dentro del bloque). No hay prueba con el esquema anterior porque no cambia el esquema ni el documento.
Lo medido de verdad es el recorrido en Chromium de arriba; jsdom no hace diseño.

## Tablet vertical (v0.160)

Con el corte en 760 px, un iPad vertical (768 a 834 px) no recibía nada: el cajón de páginas queda a la vista y la
página mide 372 a 438 px, así que el reporte se encogía igual que en el teléfono (columnas de 47 a 57 px; una de 12
columnas, 33). **Decisión:** el corte de las tablas sube a **1024 px**, solo en las reglas de tabla y en
`TABLE_SCROLL_QUERY` (`src/ui/tableScroll.ts`); el resto de las reglas de teléfono sigue en 760. Como el piso no fuerza el
ancho de la tabla (D244), a un ancho donde la tabla entra no cambia nada. Medido en Chromium (arnés con el Shell
completo, con el cajón): a 768 y 834 px el reporte de 7 columnas mide 673 con columnas de 96 (antes 341 y 407, con 47 y
57) y la de 12 columnas 1153 con columnas de 96 (antes 33 y 34), se desplazan dentro de su bloque y la página no se
corre; a 1024 px igual (antes 597 y 85). A 1025 y 1280 px las tablas miden exactamente lo mismo que antes, y la vista de
impresión y el armado del PDF de exportar miden lo mismo a 1280, 1025, 1024, 834, 768 y 375 px, y lo mismo que antes del
cambio. Un iPad de 1024 px de ancho en horizontal (el de 9,7 pulgadas y el mini) con el cajón a la vista entra en el mismo
caso; uno más ancho (1025 px o más) sigue como la compu.

## Páginas con hoja entre 761 y 1024 px (ronda 1, decisión de Lega)

La auditoría midió que el corte de 1024 px alcanzaba también a una página con formato de hoja (A4, A3, Carta): entre 761 y
1024 px la hoja conserva su ancho entero (794 px para A4; la página se desplaza de costado) y el texto mide 643 px, igual
que en el PDF. Con el piso, el reporte de 7 columnas, que en la hoja mide 612 px (columnas de 87), pasaba a 673 y se salía
de ella, y una tabla de 10 columnas de 68 px pasaba de 612 a 961. **Decisión (Lega):** entre 761 y 1024 px el piso y el
desplazamiento valen **solo para páginas sin hoja** (`.page:not(.sheet)`); una hoja queda como el PDF. Hasta 760 px la hoja
se ve libre (lo hace `.page.sheet` en esa pantalla), así que ahí el piso vale también para ella, como en P.28: son dos
bloques de `styles.css`, el de 1024 px con `:not(.sheet)` y el de 760 px con `.page.sheet`.
Medido en Chromium (arnés con el Shell completo, A4): a 768, 834 y 1024 px el reporte de 7 columnas y la tabla de 10 miden
**612 px** (columnas de 87 y 61, sin desplazamiento: igual que a 1280 px y que el PDF); una página libre a 768, 834 y 1024
px sigue con el piso (7 columnas: 673, de 96; 10 columnas: 961); a 375 px, hoja o no, el piso vale; la compu (1280 px),
680 px libre y 612 con A4, sin cambios. Prueba: `tablePhone.test.ts` ata el `:not(.sheet)` del bloque de 1024 y el
`.page.sheet` del de 760; el mutante «quitar `:not(.sheet)`» muere (en la prueba y en Chromium: la hoja pasa a 673).
`revealSelectionCell` queda igual: solo mueve algo si el contenedor desborda, y la hoja entre 761 y 1024 no desborda.

## Queda
- **Sin probar en headless:** `overscroll-behavior-x` (solo importa para el gesto «atrás» de Safari), el impulso del dedo
  en iOS, el teclado abierto, un editor remoto escribiendo en la misma tabla (si su cambio mueve la selección local, el
  enganche podría devolver la tabla a la celda del cursor). Las tablas no usan `:has()` (el árbol de páginas sí, con `:is()`
  que lo protege, v0.160). El CSS compilado de las tablas usa `@media (width<=1024px)` y, para las hojas, `(width<=760px)`
  (Safari 16.4 o más), igual que las demás reglas de teléfono de la app.

- Probarlo en un iPhone real: el desplazamiento con el dedo, el teclado abierto y escribir en la última columna.
- Una pista de que la tabla se desplaza (hoy se ve la columna siguiente cortada por el borde); si hiciera falta, un
  degradado en el borde derecho.
