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

Solo en pantalla angosta (`@media (max-width: 760px)`, el mismo corte del teléfono que usa el resto de `styles.css`) y
solo en la página abierta (`.page:not(.sd-export-source)`: la vista de impresión y el armado del PDF de exportar miden
con el ancho de la hoja y no se tocan):

- **Una tabla con todos los anchos guardados mide la suma de esos anchos** (`width: max-content`): las de 7 columnas,
  680 px, igual que en la compu. Con una columna sin ancho guardado no cambia nada: esas ya tenían su mínimo de 120 px
  por columna (`--default-cell-min-width`) y el `min-width` de la tabla, y ya se desplazaban.
- **Piso de 96 px por columna** con ancho guardado (el ancho de fábrica del reporte a 7 columnas): una columna que
  alguien angostó mucho en la compu se ve ahí con 96 px, para poder leerla. Los anchos guardados no se tocan.
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

- **La compu y el PDF:** las tablas miden lo mismo antes y después (680 / 113 / 97 px por columna, sin desplazamiento),
  la vista de impresión de una página A4 mide lo mismo en el teléfono que en la compu, y el PDF sale igual.
- **Las fotos en las celdas** (miniaturas Small, Medium y Large) miden igual que en la compu: antes, en el teléfono,
  las de una tabla de 7 columnas quedaban en 21 px de ancho.
- **Una pantalla angosta con mouse** (una ventana de compu angosta) recibe lo mismo que el teléfono: es el mismo corte.

## Cómo se midió

Chromium de Playwright sin ventana, perfil temporal, sobre la página real (`PageView`) con el servidor en memoria y sin
login. Teléfono: 375 × 812, con toque y `hover: none`; compu: 1280 × 900. El reporte de fábrica completo más una
tabla de 7 columnas con fotos en las celdas. Resultado: 30 de 30 (el script y los números se guardan fuera del repo).
Lo que se comprobó, en el teléfono:

- las tablas de 7 columnas miden 680 px con columnas de 97 (antes 304 y ~42); la página no se corre de costado;
- un gesto táctil de costado desplaza la tabla (no la página) y uno vertical mueve la página;
- tocar la última columna y escribir deja la celda a la vista; Tab recorre las 7 columnas y flecha izquierda y derecha
  vuelven, con la celda del cursor siempre entera a la vista; la selección de celdas con Shift más flechas anda;
- las miniaturas Small, Medium y Large miden igual que en la compu; tocar una abre el carrete y el segundo toque
  muestra su barra, que cabe en la pantalla;
- una página A4 en el teléfono se ve libre (como ya era), y la vista de impresión mide igual que en la compu.

Un hallazgo que viene de antes y no es de las tablas: en el teléfono el botón de comentar del margen (`.comment-add`)
se pasa 4 px del borde derecho cuando hay una selección, y la página se puede arrastrar 4 px de costado.

## Pruebas

`src/ui/tableScroll.test.ts` (la lógica de acomodar la celda: cortada por la derecha, por la izquierda, entera, tabla
que entra, celda más ancha que lo visible, pantalla ancha) y `src/ui/tablePhone.test.ts` (el CSS: solo pantalla
angosta, solo la página abierta, piso de 96 px solo con `colwidth`, `max-content` solo con todos los anchos guardados,
el desplazamiento dentro del bloque). No hay prueba con el esquema anterior porque no cambia el esquema ni el documento.
Lo medido de verdad es el recorrido en Chromium de arriba; jsdom no hace diseño.

## Queda

- Probarlo en un iPhone real: el desplazamiento con el dedo, el teclado abierto y escribir en la última columna.
- Una pista de que la tabla se desplaza (hoy se ve la columna siguiente cortada por el borde); si hiciera falta, un
  degradado en el borde derecho.
