# Hojas y PDF

Cómo se ven los cortes entre hojas en el editor y cómo sale el PDF (roadmap B.7, fase 4 de
`Plan_ShotDocs.md`, sección 10). El tamaño de hoja se elige por rama (`pages.settings.format`, D-08 y D-10);
acá está lo que pasa después.

## La regla

**Un corte es un cálculo, no contenido.** Nada de esto agrega nodos al documento, guarda algo o cambia el
Y.Doc: las marcas son una capa encima del editor y el PDF se arma con una copia. Lo prueba
`src/ui/pagination.test.ts` (el Y.Doc y los bloques quedan iguales al paginar y al imprimir).

**Lo que se ve es lo que sale.** Las marcas de la pantalla y los saltos del PDF salen del mismo cálculo,
hecho sobre la misma vista.

## Piezas

| Archivo | Qué hace |
|---|---|
| `src/ui/pageFormat.ts` | Tamaños de hoja y `printGeometry`: el papel en milímetros, el margen (20 mm) y el área de texto en píxeles de CSS (96 por pulgada). Una página libre imprime en A4 vertical. |
| `src/ui/printView.ts` | La **vista de impresión**: una copia del encabezado, el título y el contenido del editor, con el ancho del área de texto de la hoja, afuera de la pantalla. Mide, pagina y pone los saltos. |
| `src/ui/pagination.ts` | El cálculo puro (`paginate`) y la medición de la vista (`measureUnits`). |
| `src/ui/SheetBreaks.tsx` | Las marcas en el editor ("Page 2", "Page 3"…), y Ctrl/⌘+P. |
| `src/ui/printPage.ts` | Imprimir: arma la vista, pone la hoja con `@page` y llama a `window.print()`. Se baja aparte. |
| `src/styles.css` | `.print-view` (los estilos del papel), `.sheet-breaks` (las marcas) y `@media print`. |

## La vista de impresión

Se copia el DOM de la página (nunca el documento) y de la copia se saca lo que no va en papel: los
controles del editor, los tiradores, el lugar para agregar un bloque al final, los cursores y selecciones
de otras personas, el margen de comentarios, y de las tarjetas de Drive el reproductor y sus botones (queda
el link con el ícono). El título, que en pantalla es un campo de texto, pasa a un `h1`. Todo queda en claro
(el papel es blanco) y los colores de fondo se imprimen (`print-color-adjust: exact`): las marcas de Script
(INT/EXT, DÍA, NOCHE…), las preguntas y las tablas.

Los estilos de `.print-view` valen **igual en pantalla y al imprimir** y no dependen del ancho de la
ventana: al imprimir, las reglas del teléfono (`max-width: 760px`) se aplicarían porque una hoja A4 mide
menos de 760 px de texto, así que la vista las pisa (margen, tamaño del título, relleno del editor). Por
eso la vista se mide igual en la computadora, en el teléfono y en el PDF.

Otros ajustes del papel: una imagen nunca pasa del ancho imprimible ni del alto de una hoja
(`object-fit: contain`); una tabla más ancha que el área de texto se ajusta al ancho (si no, el navegador
achica toda la hoja); sin transiciones; `orphans` y `widows` en 1, para que el navegador parta un párrafo
en el mismo renglón que el cálculo.

## El cálculo

Se miden las **unidades**: el encabezado, el título y la fila de contenido de cada bloque
(`.bn-block-content`, sin sus hijos: cada hijo es otra unidad). Cada una tiene su alto (con su margen de
arriba) y su posición desde el comienzo del área de texto de la primera hoja. El alto de una hoja es el
del papel menos los dos márgenes.

- Lo que entra en una hoja **no se parte**: si no entra en lo que queda, pasa entera a la siguiente (una
  imagen, un párrafo corto, una tabla chica, una pregunta).
- Lo que es **más alto que una hoja se parte**: un texto entre renglones (se miden con `Range.getClientRects`
  y el corte va a mitad del interlineado), una tabla entre filas. Lo que no se puede partir (una imagen
  enorme, que igual se achica al alto de la hoja) empieza en una hoja nueva.
- Un **título de sección** no queda solo al pie de una hoja: pasa a la siguiente con el bloque que sigue.
- **Tolerancia de 4 px** (`SHEET_TOLERANCE_PX`): para decidir si un bloque entero entra se le descuentan 4 px
  al alto de la hoja, así un redondeo del navegador no lo empuja a otra hoja (quedaría una hoja casi vacía).
  Donde se parte un bloque alto no se descuenta nada: ahí corta el navegador, en el último renglón que
  entra.

El PDF usa el cálculo así: `break-before: page` en cada unidad que empieza una hoja entera y
`break-inside: avoid` en las que entran en una hoja. Los bloques altos se dejan partir solos.

## En el editor

En una página con tamaño de hoja, `SheetBreaks` arma la vista de impresión, calcula y la saca (unos 5 ms
en una página de cinco hojas), y dibuja una línea punteada con el número de hoja donde empieza cada una.
Con el ancho de la hoja (la computadora), la página se estira hasta el final de la última hoja
(`--sheet-end`).

- **Cuándo se recalcula:** al escribir (lo que cambia el contenido del editor, no la selección), agrupado
  con una pausa de 120 ms y `requestAnimationFrame` (escribiendo sin parar, como mucho cada 600 ms); cuando
  cambia el ancho de la página, el alto del título, la fuente o el tamaño del texto, cuando termina de cargar
  una fuente o una imagen, y cuando cambia el tamaño de hoja.
- **En el teléfono** la hoja no entra y la página se ve libre, más angosta. Las marcas van igual: el cálculo
  es el de la hoja real (la vista de impresión), y cada marca se pone antes del mismo bloque que en el PDF;
  si un bloque se parte, a la misma altura proporcional adentro de él. Un bloque puede verse más alto en
  pantalla que en papel (la tarjeta de Drive con su reproductor, una imagen más alta que la hoja): la marca
  sigue antes del mismo bloque.
- Una página libre no muestra marcas.

## Imprimir y guardar como PDF

**Export PDF / Print** en el menú de la página (arriba o en la barra lateral), o Ctrl/⌘+P con la página
abierta. Se usa la impresión del navegador, sin librerías de PDF: en el diálogo, "Guardar como PDF".

1. Si la página no está abierta, se abre y se espera al editor.
2. Se arma la vista de impresión, se calculan los cortes y se ponen los saltos.
3. Las fotos del Drive van **grandes si el original está en el dispositivo** (y el navegador lo sabe abrir:
   un HEIC en Chrome sigue con su miniatura); si no, con la miniatura que ya se ve. No se baja nada. Como
   mucho 40 originales o 200 MB por PDF; el resto con su miniatura. La proporción es la misma, así que los
   cortes no cambian.
4. Se pone la hoja (`@page { size: <ancho>mm <alto>mm; margin: 20mm; }`), se oculta todo lo demás (barra
   lateral, barra de arriba, comentarios, controles), el tema pasa a claro mientras está el diálogo y el
   título de la página es el nombre del PDF. Después, `window.print()`.
5. Al cerrar el diálogo (`afterprint`, o el primer toque en la app donde `print()` no espera, como en el
   iPhone) todo vuelve a como estaba.

Si se imprime desde el menú del navegador, la vista se arma en ese momento (`beforeprint`) con las imágenes
que ya se ven. Una página libre sale en A4 vertical con los mismos cortes automáticos.

Los links (también el de cada tarjeta de Drive) quedan como links en el PDF.

## Cómo se probó

- `src/ui/pagination.test.ts`: el cálculo con alturas simuladas (todo entra, una imagen que pasa, un
  párrafo corto que pasa entero, uno largo que se parte en renglones, una tabla entre filas, una imagen más
  alta que la hoja, un título de sección con su bloque, la tolerancia, la numeración), la hoja de cada
  tamaño, y que paginar e imprimir con el editor real no cambian el Y.Doc ni los bloques.
- En Chromium sin ventana, con una página de prueba que monta el editor con contenido (títulos, Script,
  imágenes, lista, pregunta, tabla, un párrafo de más de una hoja y una tarjeta de Drive): el PDF tiene
  tantas páginas como hojas marca la pantalla, cada página empieza con el bloque (o el renglón) que marca la
  pantalla, igual en la computadora y en el teléfono, y el tamaño del papel es el de la hoja (A4, A5
  horizontal, Carta).

## Pendiente

- El **bloque de salto de hoja** (sección 10 del plan). Tiene que degradar en una versión vieja como Script
  (una propiedad de un párrafo, nunca un tipo de bloque nuevo).
- En la computadora las hojas se ven como una sola tira con líneas; no hay un espacio entre hojas.
- Safari: `@page { size }` depende de la versión; si no lo toma, el papel es el que se elige en el diálogo
  (los cortes se calculan para el de la página).
