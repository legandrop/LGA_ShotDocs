# Hojas y PDF

Cómo se ven los cortes entre hojas en el editor y cómo sale el PDF (roadmap B.7, fase 4 de
`Plan_ShotDocs.md`, sección 10). El tamaño de hoja se elige por rama (`pages.settings.format`, D-08 y D-10);
acá está lo que pasa después.

## La regla

**Un corte es un cálculo, no contenido.** Nada de esto agrega nodos al documento, guarda algo o cambia el
Y.Doc: las marcas son una capa encima del editor y el PDF se arma con una copia. La única excepción la pone la
persona a mano: el **salto de hoja** (más abajo), que es un párrafo del documento con una propiedad. Lo prueba
`src/ui/pagination.test.ts` (el Y.Doc y los bloques quedan iguales al paginar y al imprimir).

**Lo que se ve es lo que sale.** Las marcas de la pantalla y los saltos del PDF salen del mismo cálculo,
hecho sobre la misma vista.

**Con secciones colapsadas** (P.11, `Doc_Colapsar.md`), el cálculo se hace igual con todo abierto: la vista
no copia lo colapsado, el PDF sale todo abierto (salvo con la casilla "Imprimir como se ve", desde v0.067: ahí
sale sin lo colapsado y pagina lo que queda, y las hojas ya no coinciden con las marcas) y los cortes que caen en algo escondido se muestran juntos en
el título colapsado ("Hojas 2–4 adentro"); los números de las marcas que se ven cuentan también las hojas
escondidas.

## Piezas

| Archivo | Qué hace |
|---|---|
| `src/ui/pageFormat.ts` | Tamaños de hoja y `printGeometry`: el papel en milímetros, el margen (20 mm) y el área de texto en píxeles de CSS (96 por pulgada). Una página libre imprime en A4 vertical. |
| `src/ui/printView.ts` | La **vista de impresión**: una copia del encabezado, el título y el contenido del editor, con el ancho del área de texto de la hoja, afuera de la pantalla. Mide, pagina y pone los saltos. |
| `src/ui/pagination.ts` | El cálculo puro (`paginate`) y la medición de la vista (`measureUnits`). |
| `src/ui/SheetBreaks.tsx` | Las marcas en el editor ("Page 2", "Page 3"…), y Ctrl/⌘+P. |
| `src/ui/editorSchema.ts` | El salto de hoja: la propiedad `pageBreak` del párrafo, `insertPageBreak`, el menú "/" y el teclado (`pageBreakExtension`). |
| `src/ui/printPage.ts` | Imprimir: arma la vista, pone la hoja con `@page` y llama a `window.print()`. |
| `src/i18n/print.ts` | Los textos ("Page 2" / "Hoja 2", los avisos). |
| `src/media/queue.ts` | `localImage`: la foto original si está en el dispositivo (solo lee lo local, nunca la red). |

Todo esto baja con el editor (no con la primera pantalla: lo revisa `src/ui/firstLoad.test.ts`). El menú
de la página pide `printPage` con un `import()` aparte, que ya está bajado si la página está abierta.
| `src/styles.css` | `.print-view` (los estilos del papel), `.sheet-breaks` (las marcas) y `@media print`. |

## La vista de impresión

Se copia el DOM de la página (nunca el documento). Del editor se copia solo el documento en pantalla
(`.bn-editor`), adentro de un contenedor vacío con las clases del de pantalla: el contenedor de verdad
también tiene la barra de formato y los menús flotantes, que no van. De la copia se saca lo que no va en
papel: los tiradores, el lugar para agregar un bloque al final, los cursores y selecciones de otras
personas, los `id` (no se repiten en la página), y de las tarjetas de Drive el reproductor y sus botones
(queda el link con el ícono). El título, que en pantalla es un campo de texto, pasa a un `h1`.

Siempre en claro, sin tocar el tema de la app: la vista define sus propios colores claros (los tokens de
`:root`, las marcas de Script y el ícono de las preguntas), y mientras se imprime la raíz también es
blanca. Los colores de fondo se imprimen (`print-color-adjust: exact`): las marcas de Script (INT/EXT,
DÍA, NOCHE…), las preguntas y las tablas.

Los estilos de `.print-view` valen **igual en pantalla y al imprimir** y no dependen del ancho de la
ventana: al imprimir, las reglas del teléfono (`max-width: 760px`) se aplicarían porque una hoja A4 mide
menos de 760 px de texto, así que la vista las pisa (margen, tamaño del título, relleno del editor). Por
eso la vista se mide igual en la computadora, en el teléfono y en el PDF. Las fotos y videos del editor
también: en la vista van con un ancho fijo en px que no sale de la pantalla (ver "Imprimir", punto 4).

Otros ajustes del papel: una imagen nunca pasa del ancho imprimible ni del alto de una hoja
(`object-fit: contain`; en pantalla, en una página con hoja, el mismo tope); una tabla más ancha que el área
de texto se ajusta al ancho (si no, el navegador achica toda la hoja) y va sin el lugar de los botones de
filas y columnas; sin transiciones; `orphans` y `widows` en 1, para que el navegador parta un párrafo en el
mismo renglón que el cálculo.

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
- **Una fila de fotos** (Doc_Imagenes.md) es una sola unidad (`mergeRowUnits`): desde la foto que empieza más
  arriba hasta la que termina más abajo. Una hoja nunca la corta, y el salto de hoja va en todas sus fotos.
- **Un párrafo con fotos en línea** (Doc_Fotos_En_Linea.md, v0.078) se parte entre renglones aunque entre en una
  hoja (`breakable`): cada renglón es una fila de fotos, que nunca se corta. Si no entra ni el primer renglón, pasa
  entero. La copia de impresión no le pone `break-inside: avoid`, así corta el navegador en el mismo renglón
  (medido con el PDF de Chromium: las fotos de cada hoja son las del cálculo).
- Un **título de sección** no queda solo al pie de una hoja: pasa a la siguiente con el bloque que sigue,
  si los dos entran juntos en una hoja (si no, el título queda y pasa el bloque).
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

- **Cuándo se recalcula:** cuando cambia el documento en pantalla (`isContentMutation`: cambios adentro de
  `.bn-editor` y del encabezado; no los menús, el menú del costado, los tiradores, la barra de formato, el
  menú de pegar un link de Drive, el carrete ni los cursores de otras personas, ni atributos de estado como
  `class`, `style`, `draggable`, `id` o `aria-*`), agrupado con una pausa de 120 ms y
  `requestAnimationFrame` (escribiendo sin parar, como mucho cada 600 ms); cuando cambia el ancho de la
  página, el alto del título, la fuente o el tamaño del texto, cuando termina de cargar una fuente o una
  imagen del documento, y cuando cambia el tamaño de hoja. Elegir, pasar el mouse o abrir la barra no
  recalcula. Cada cálculo copia y mide toda la página: unos 5 ms con cinco hojas, más en páginas muy largas
  (con 600 bloques, de 55 a 120 ms, una vez por pausa al escribir).
- **Un bloque partido** (un párrafo, una tabla): la marca va al hueco entre renglones (o filas) de la
  pantalla más cercano a donde corta el PDF.
- **En el teléfono** la hoja no entra y la página se ve libre, más angosta. Las marcas van igual: el cálculo
  es el de la hoja real (la vista de impresión), y cada marca se pone antes del mismo bloque que en el PDF;
  si un bloque se parte, en el hueco entre renglones más cercano a la misma altura proporcional (los
  renglones del teléfono son otros). La etiqueta es más chica y un poco transparente. Un bloque puede verse más alto en
  pantalla que en papel (la tarjeta de Drive con su reproductor, una imagen más alta que la hoja): la marca
  sigue antes del mismo bloque.
- Una página libre no muestra marcas.

## Imprimir y guardar como PDF

**Export PDF / Print** en el menú de la página (arriba o en la barra lateral), o Ctrl/⌘+P con la página
abierta. Se usa la impresión del navegador, sin librerías de PDF: en el diálogo, "Guardar como PDF".

1. Si la página no está abierta, se abre y se espera al editor.
2. Se espera (hasta 8 segundos) a que las imágenes de la página terminen de ponerse: recién abierta,
   todavía están buscando su dirección, y la vista saldría sin fotos y con otros cortes.
3. Se arma la vista de impresión, se calculan los cortes y se ponen los saltos.
4. Las fotos del Drive van **grandes si el original está en el dispositivo** (`localImage`, que no pregunta
   nada a la red), achicadas a 2400 px de lado mayor (`createImageBitmap` y un canvas). Una foto que el
   navegador no sabe abrir (un HEIC en Chrome) sigue con su miniatura, igual que las que no están en el
   dispositivo. **El tamaño en la hoja no cambia:** al armarse, la vista le fija a cada foto o video un
   ancho en px, el mismo desde cualquier pantalla: el que le puso la persona (`previewWidth`) o, si no
   tiene, el natural de lo que se ve (la miniatura, 480 px de lado), sin pasar del área de texto. Así el
   original solo gana nitidez y los cortes son los que marca la pantalla. Hasta v0.042 el original
   llenaba el ancho y en el PDF la foto salía más alta que en pantalla: la hoja se cortaba antes que la
   marca.
   Como mucho 40 originales o 200 MB por PDF (12 o 60 MB en un teléfono o una tableta). Mientras
   tanto se ve el aviso "Preparing the PDF…". Si la impresión se cancela (se cerró o empezó otra), no se
   crea nada más.
5. Cuando cargaron las imágenes de la vista, se vuelve a medir y a cortar.
6. Se pone la hoja (`@page { size: <ancho>mm <alto>mm; margin: 20mm; }`), se oculta todo lo demás (barra
   lateral, barra de arriba, comentarios, controles) y el título de la página es el nombre del PDF. Después,
   `window.print()`; si falla, se saca todo y se avisa.
7. Al cerrar el diálogo (`afterprint`) todo vuelve a como estaba. Antes de llamar a `print()` queda el
   respaldo: donde `print()` no espera al diálogo y no llega `afterprint` al cerrarlo, limpia el primer toque
   o tecla en la app.

**En el iPhone** el diálogo solo se abre desde un toque. Si no hay nada que esperar (la página abierta, las
fuentes y las imágenes cargadas, ninguna foto del Drive), todo pasa antes del primer `await` y
`window.print()` se llama dentro del mismo toque. En un teléfono o una tableta, un `afterprint` que llega
menos de un segundo después de `print()` se ignora (Safari del iPhone lo manda apenas abre el diálogo) y
limpia el primer toque después. Esto hay que probarlo a mano en el iPhone.

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
  horizontal, Carta). También una tabla de 46 filas que pasa por tres hojas (la marca cae entre las mismas
  filas que el PDF), un párrafo partido (el mismo renglón), que la barra de formato abierta no sale en el
  PDF, el PDF en claro con la app en oscuro, y que elegir, mover el mouse o abrir la barra no recalcula.
- En `pagination.test.ts`, además: la barra flotante y los `id` fuera de la copia, el tema de la app sin
  tocar, el respaldo sin `afterprint`, el `afterprint` temprano en un táctil, un `print()` que falla, la
  espera de las imágenes de la página, la cancelación mientras se buscan los originales, el achique a
  2400 px, qué cambios recalculan las marcas, y el ancho fijo de las fotos en la vista (el mismo desde el
  teléfono o la computadora, que no cambia al poner el original, que respeta `previewWidth` y que no toca
  otras imágenes).

## Salto de hoja

Lo que sigue empieza en una hoja nueva, en las marcas de la pantalla y en el PDF (sección 10 del plan, "Control
de cortes").

### Diseño

- **Qué es.** Un párrafo con `pageBreak: true`, igual que Script es un párrafo con `script: true`: **nada de
  tipos de bloque nuevos**. La hoja nueva empieza **después** de ese párrafo. Es una variante más del párrafo
  (`paragraphProps('pageBreak')`): no va junto con Script, pregunta ni tarjeta de Drive, y *Paragraph* en la
  barra de formato se la saca.
- **Puede tener texto.** Es lo más simple que no pierde nada: si alguien escribe en el salto, el texto se ve, se
  imprime como un párrafo común al pie de su hoja y la hoja nueva empieza después. Bloquear la escritura obligaba
  a decidir qué hacer con lo pegado, el dictado o lo que llega de otro dispositivo, y cualquier error ahí borraba
  texto. Vacío, en el papel no ocupa lugar.
- **Cómo se crea.** El menú "/" (*Page break* / *Salto de hoja*, en los bloques básicos; también "salto", "page
  break", "hoja nueva"…) convierte el renglón del "/" en el salto (si tiene texto, el salto va abajo) y deja el
  cursor en un párrafo nuevo, en la hoja siguiente. **Ctrl+Enter** (⌘↩ en la Mac), como en Word y Google Docs:
  en un párrafo vacío, ese párrafo pasa a ser el salto; al principio de un bloque, el salto va antes; en el medio
  de un párrafo, lo parte y queda entre las dos partes (la segunda conserva sus propiedades: Script sigue Script);
  al final, va después con un párrafo nuevo. En una tabla o una imagen no hace nada; en un bloque de código hace lo
  de antes (sale del bloque).
  Ctrl+Enter no lo usaba nadie en el editor (el de mandar un comentario es en su campo, otro lugar del registro).
- **Cómo se saca.** Retroceso al principio del bloque que sigue: vacío se borra, con texto queda como párrafo
  común. Sin esto, BlockNote juntaba el bloque con el salto y el texto subía arriba de la línea; por eso el teclado
  va en una extensión que corre antes que la de BlockNote (`pageBreakExtension`). También se borra como cualquier
  párrafo, o con *Paragraph* en la barra.
- **Lo que se le pone encima.** Soltar o pegar un archivo o una carpeta en un salto vacío no lo reemplaza (el
  archivo va debajo, como con una pregunta vacía). Pegar texto en un salto vacío lo deja adentro, arriba de la
  línea: ProseMirror reemplaza el párrafo vacío por el pegado y el salto se perdía, así que se le devuelve al párrafo
  que queda ahí (si lo pegado empieza con un título o una lista, el salto se pierde; el texto, nunca). Un link de
  Drive pegado como tarjeta en el salto lo deja tarjeta y salto a la vez.
- **Cómo se ve.** Una línea punteada con "PAGE BREAK" / "SALTO DE HOJA" (el rótulo es CSS y sale de
  `--sd-page-break-label`, en el idioma de la app): vacío, la línea pasa por el renglón; con texto, va debajo. En
  una página libre, más tenue: no hay hojas en pantalla, pero el PDF (A4) lo respeta. En el teléfono, igual.
- **El cálculo.** La unidad del salto lleva `breakAfter`; la siguiente unidad con alto empieza hoja (si no la
  empieza ya). Vacío mide 0 en la vista de impresión (`print-page-break-empty`, `display: none`) y cuenta igual.
  Varios saltos seguidos valen uno (no dejan hojas en blanco) y uno al final no suma una hoja vacía. Un título justo
  antes del salto queda en su hoja: el salto manda. El PDF usa el mismo cálculo (`break-before: page` en el bloque
  que sigue), así marcas y hojas coinciden; la línea y el rótulo nunca salen en el papel.
- **Secciones colapsadas** (P.11): el cálculo, con todo abierto como siempre (un salto adentro de lo colapsado
  suma "Hoja N adentro" en el título). Con "Imprimir como se ve", el salto escondido no se imprime ni corta.
- **Copiar y pegar:** adentro de la app sigue siendo salto (vacío o con texto). Afuera sale como
  `<p class="page-break-line" style="break-after: page">`; al pegar, se reconoce esa clase o cualquier `<p>` con
  `break-after: page` o `page-break-after: always`. Deshacer: un solo Ctrl+Z (partir un párrafo va en dos pasos
  que el historial junta). Buscar: el rótulo no es texto y no aparece; lo escrito en el salto, sí. No hay exportar
  ni importar `.md` todavía: cuando exista, el salto tiene que ir como una línea propia que vuelva al importar.
- **Una versión vieja** (hasta v0.088) ve un párrafo vacío o con su texto, sin línea, y no lo borra (las
  propiedades que no conoce quedan en el Y.Doc). Si escribe en ese renglón, pierde solo el salto; el texto y el id
  quedan. Como perder la propiedad deja el contenido intacto, **no hace falta subir `min_app_version`**.

### Cómo quedó

- `src/ui/pageBreak.test.ts` (22 pruebas, más una en `fileDrop.test.ts` y otra en `driveCard.test.ts`): el cálculo con saltos (vacío, con texto, seguidos, al final, cuando ya
  empieza hoja, un título antes, un bloque alto después), crear y sacar (también con el teclado real del editor de
  la página), el menú "/", partir un Script, copiar y pegar (HTML de la app y de afuera, `avoid-page` no es salto, pegar en un salto vacío), la vista de impresión
  (esconde el vacío, el Y.Doc no cambia) y la **versión anterior** (`fixtures/editorSchemaV088.ts`, copia del
  esquema publicado): abre la página, ve los párrafos con su texto, no borra ni desmarca nada al editar otro bloque
  y, si escribe en el salto, conserva texto e id.
- En Chromium, con la página real sobre el servidor en memoria (sin login), 28 de 28: la línea; las marcas
  "Page 2" y "Page 3" antes de los bloques que siguen a cada salto; el PDF (`page.pdf`) con 3 hojas que empiezan
  donde marca la pantalla y sin el rótulo; Ctrl+Enter en el medio de un párrafo (4 hojas) y un solo Ctrl+Z; "/page
  br" + Enter; Retroceso; escribir en el salto (el texto sale al pie de la hoja 1); copiar y pegar; el teléfono
  (las mismas marcas y el mismo PDF); la página libre (sin marcas, línea tenue, PDF A4 con los saltos); una sección
  colapsada ("Page 3 inside", el PDF con todo abierto da 3 hojas, "como se ve" 2). Y el rótulo en castellano, en
  oscuro.

## Pendiente

- En la computadora las hojas se ven como una sola tira con líneas; no hay un espacio entre hojas.
- Safari: `@page { size }` depende de la versión; si no lo toma, el papel es el que se elige en el diálogo
  (los cortes se calculan para el de la página).
- A probar a mano en el iPhone: el diálogo desde el menú (el `import()` del menú es asincrónico: si Safari no
  lo acepta como parte del toque, habría que llamar a `printPage` sin pasar por él), la limpieza al cerrarlo
  y las fotos HEIC.
