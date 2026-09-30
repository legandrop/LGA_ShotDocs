# Imágenes en la página: elegir, tamaño y filas

Diseño de lo que pidió Lega el 2026-09-30 (fotos y videos del editor; en la página los dos son un bloque
`image`, ver `Doc_Carrete.md`). Estado: **hecho: v0.044 (elegir y abrir), v0.045 (anchos y filas), v0.046 (acomodar en filas), v0.047 (en el teléfono, en fila o apiladas) y v0.058 (calidad en la página).** "Correcciones de la auditoría previa" manda sobre lo anterior.

## Lo que se pide

1. **El primer clic elige, el segundo abre.** Hoy, con el mouse, un clic en una foto abre el carrete. El
   primer clic tiene que elegirla: un borde alrededor, tiradores para cambiar el tamaño y la barra de arriba
   (la que hoy aparece pero no sirve porque la foto ya se abrió). El segundo clic (o doble clic) abre el
   carrete.
2. **Tamaños rápidos en la barra:** ancho entero, 1/2, 1/3 y 1/4 del ancho de la página.
3. **Una al lado de la otra:** hoy cada foto va debajo de la anterior. Dos de 1/2, tres de 1/3 o cuatro
   de 1/4 seguidas tienen que quedar en una fila.
4. **Acomodar en filas:** con varias fotos o videos elegidos, un botón los reparte en una o más filas del
   ancho de la página, cada fila con todas sus fotos a la misma altura (el ancho de cada una sale de su
   proporción), eligiendo solo cuántas filas y dónde cortar para que quede prolijo.
5. **El cursor entre fotos:** hoy, moviéndose con las flechas, una foto elegida no se ve elegida y el cursor
   entre dos fotos no se ve. Tiene que verse siempre dónde se está.
6. **PDF igual a la pantalla** (arreglado aparte en v0.043; lo de acá tiene que mantenerlo).

## Reglas que no se rompen

- **Nada de tipos de bloque nuevos** (AGENTS.md, "regla del editor"): una versión vieja borra del documento
  compartido lo que no conoce. Una fila **no es un bloque**: son bloques `image` seguidos con un ancho
  menor que el de la página. No hay contenedor de fila ni columnas (el paquete de columnas de BlockNote,
  `xl-multi-column`, agrega los tipos `columnList` y `column`: descartado por esta regla).
- **Una propiedad nueva se puede perder** si alguien edita ese bloque en una versión vieja. Por eso: la
  versión vieja tiene que mostrar algo razonable (la foto con un ancho parecido, una debajo de otra) y,
  después de publicar, se sube `min_app_version` (pide autorización de Lega).
- **El PDF es lo que se ve:** las mismas reglas de ancho en el editor, en las marcas de hoja y en el PDF.
- **Teléfono primero** para mirar (el carrete ya lo es); para armar filas alcanza con la computadora, pero
  en el teléfono las filas se ven igual (más chicas) y se pueden elegir y abrir las fotos.

## Modelo: una propiedad `width` en el bloque `image`

- `width`: número entre 0 y 1, la parte del ancho del área de texto que ocupa la foto. `0` (por defecto):
  sin ancho propio, como hoy (el tamaño que da BlockNote: `previewWidth` en px o el de la miniatura).
  Se guarda redondeado a 4 decimales.
- Los tamaños rápidos ponen 1, 1/2, 1/3 o 1/4. Los tiradores y "Acomodar en filas" ponen cualquier valor.
- **Compatibilidad:** junto con `width`, la app pone también `previewWidth` (px) con el ancho que ocupa en
  pantalla en ese momento. Una versión que no conoce `width` muestra la foto con ese ancho, una debajo de
  otra: no se ve rota, solo sin filas. Si esa versión edita el bloque (por ejemplo, cambia la leyenda), se
  pierde `width` y queda `previewWidth`: la foto sigue ahí.
- En el esquema: la spec `image` de BlockNote con `propSchema` extendido (`width: { default: 0 }`), el
  mismo tipo `image`. Hay que confirmar que BlockNote permite extender el `propSchema` del bloque de imagen
  sin cambiar su render (hoy ya se cambia su `meta`), y que el Y.Doc guarda el atributo nuevo como los de
  Script o pregunta.

## Cómo se ve una fila

- **Sin estructura nueva:** un plugin de ProseMirror decora cada `blockContainer` cuyo bloque es `image` con
  `width > 0`: le pone la clase `img-sized` y la variable `--img-w` (el número). El CSS del grupo de
  bloques (`.bn-block-group`) pasa a `display: flex; flex-wrap: wrap` con un espacio entre columnas
  (`--img-gap`, 8 px), cada bloque ocupa por defecto el 100% (`flex: 0 0 100%`) y el decorado ocupa
  `calc(var(--img-w) * (100% + var(--img-gap)) - var(--img-gap))`. Así fotos seguidas que suman 1 entran
  justo en una fila, y una que no entra baja a la siguiente, como una palabra en un renglón. Un párrafo
  entre fotos corta la fila.
- Se descuenta medio píxel para que un redondeo no mande la última foto de la fila abajo.
- La imagen llena el ancho de su bloque (`width: 100%` en el contenedor de BlockNote, que deja de usar
  `previewWidth` para las fotos con `width`), con su proporción.
- Solo el grupo de arriba (el documento) y los grupos de hijos: una foto hija de otro bloque también puede
  ir en fila con sus hermanas. Las tablas no cambian (una foto adentro de una tabla no es un bloque).
- **Riesgo a verificar:** que pasar `.bn-block-group` a flex no rompa el arrastre de bloques, el menú
  lateral, las listas numeradas, los hijos con sangría, la selección de varios bloques, los comentarios al
  margen ni las marcas de hoja. Alternativa si rompe: flex solo en los grupos que tienen algún decorado
  (clase puesta por el mismo plugin en el grupo).

## Elegir, tiradores y la barra

- **Clic:** si la foto no está elegida, el clic la elige (lo que BlockNote ya hace: selección de nodo) y
  NO abre el carrete. Si ya estaba elegida (el mismo bloque, con el editor con foco), el clic abre el
  carrete. Doble clic también lo abre. En el teléfono queda como hoy: tocar abre; tocar una foto elegida
  muestra la barra (Doc_Carrete.md). En solo lectura (sin permiso de editar) un clic abre, como hoy.
- **Borde:** una foto elegida (`.ProseMirror-selectednode`) lleva un borde de 2 px del color de acento,
  también cuando se llega con las flechas. Varias fotos en una selección de varios bloques: el mismo borde
  en cada una.
- **Tiradores:** los de BlockNote se muestran solo al pasar el mouse. Con la foto elegida se muestran
  siempre (CSS). Al soltar, BlockNote guarda `previewWidth` en px: la app lo convierte en `width` (px sobre
  el ancho del área de texto) y lo **imanta** a 1, 1/2, 1/3 o 1/4 si queda a menos de 2% de uno de ellos.
  Mientras se arrastra se ve el ancho en vivo (BlockNote cambia el ancho del contenedor; el CSS de las fotos
  con `width` no tiene que pisarlo mientras dura el arrastre).
- **La barra** (la de BlockNote para imágenes, con los botones de la app: bajar y ver) suma un grupo de
  tamaño: *Full*, *1/2*, *1/3*, *1/4* (con el marcado el actual) y, con dos o más fotos elegidas,
  *Arrange in rows*. Con varias fotos elegidas los tamaños se aplican a todas.

## Acomodar en filas

Entrada: las fotos y videos elegidos, en el orden del documento, con su proporción `a = ancho / alto`
(de la miniatura, que la conserva; si todavía no cargó, 3/2). Se reparten en filas **en ese orden** (nunca
se reordenan: el orden de la página lo decide Lega).

- En una fila con las fotos `i..j`, todas a la misma altura `h`, llenando el ancho `W` con `g` de espacio:
  `h = (W - (n - 1) g) / Σa`, y el ancho de cada una `a_k · h`. Como `width` es una parte del ancho,
  `width_k = a_k / Σa` corregido por los espacios (ver el CSS de arriba): con la fórmula del CSS, la
  parte que da la altura igual es `width_k = (a_k / Σa) · (W - (n - 1) g + n g) / (W + g)`, que se
  calcula con el ancho real del área de texto en pantalla. Se prueba con números.
- **Cuántas filas y dónde cortar:** una partición en orden (programación dinámica, O(n²), n es chico) que
  minimiza `Σ (h_fila - h_ideal)²`, con `h_ideal` = el alto que tendría una foto de proporción 3/2 a 1/3
  del ancho (unas tres fotos por fila en la computadora). Reglas: como mucho 4 fotos por fila; una fila de
  una sola foto muy apaisada no pasa de `h_ideal · 1.5`: si con todo el ancho quedaría más alta, se
  achica (no llena el ancho) y queda centrada o a la izquierda. La última fila no se estira de más: si
  llenar el ancho la dejaría mucho más alta que `h_ideal`, queda con la altura de la anterior sin llenar.
- Las fotos elegidas tienen que estar seguidas (sin párrafos en el medio). Si hay otros bloques en el medio,
  el botón no aparece (o avisa: "Select images that are next to each other").
- Es un solo cambio (un solo deshacer).

## El cursor entre fotos

- Moverse con las flechas por fotos seguidas: cada foto se elige (selección de nodo, con el borde).
- El "cursor de hueco" (`ProseMirror-gapcursor`) entre dos fotos de una fila no tiene dónde dibujarse
  horizontalmente: entre fotos de una fila las flechas saltan de una foto a la otra; antes de la primera o
  después de la última, el cursor de hueco se dibuja vertical, al costado. Enter con una foto elegida crea
  un párrafo debajo (como hoy).

## Qué cambia en otros lados

- **Marcas de hoja y PDF** (`pagination.ts`, `printView.ts`): hoy cada bloque es una unidad apilada. Las
  fotos de una misma fila tienen el mismo `top`: se juntan en una unidad (el alto de la más alta) para no
  cortar en el medio de una fila. La vista de impresión copia las clases y la variable, y el CSS de
  `.print-view` tiene las mismas reglas.
- **Carrete:** sin cambios (sigue el orden del documento).
- **Exportar HTML / copiar a otro programa:** la foto sale con su ancho en px (`previewWidth`), sin filas.
- **Comentarios al margen:** el ancla de un comentario de una foto en fila sigue siendo su bloque.

## Pruebas

- La partición en filas y los anchos, con números (alturas iguales en cada fila, suma exacta, reglas de
  la última fila y de la foto apaisada, orden intacto).
- El esquema viejo (el de `main` antes del cambio) abre un documento con `width` y conserva la foto y su
  `previewWidth`.
- Clic: elegir y después abrir; doble clic; teléfono igual que antes; solo lectura igual que antes.
- Imantado de los tiradores.
- Paginación: una fila es una unidad.

## Correcciones de la auditoría previa (mandan sobre lo de arriba)

Una auditoría independiente revisó este diseño contra el código real de BlockNote 0.55 antes de implementar. Cambios:

1. **La propiedad se llama `rowWidth`** (no `width`: BlockNote podría agregar un `width` en px). Se agrega
   extendiendo el `propSchema` de la spec `image` (el render de BlockNote la lee sola; queda como
   `data-row-width` en `.bn-block-content`). Una versión vieja la conserva al abrir, pero **la pierde también
   si mueve un bloque vecino** (probado): se sube `min_app_version` apenas se publique.
2. **Las filas las calcula el plugin, no el navegador.** Recorre los hermanos: fotos seguidas con
   `rowWidth > 0` se juntan mientras la suma no pase de 1; una foto sin `rowWidth` o cualquier otro bloque
   corta la fila. Decora cada foto con `--img-f` (su parte), `--row-n` (cuántas hay en su fila) y clases
   de primera y última. CSS: `flex-basis: calc(var(--img-f) * (100% - (var(--row-n) - 1) * var(--img-gap)))`,
   con `column-gap: var(--img-gap)` (nunca `gap`). Así, en una fila, `f_k = a_k / Σa` da **la misma altura
   exacta con cualquier ancho** (teléfono, computadora, PDF). La última de una fila llena lleva
   `flex-grow: 1` para absorber el redondeo.
3. **Flex solo en los grupos que tienen alguna fila** (clase que pone el mismo plugin en el `blockGroup`):
   las páginas sin filas quedan exactamente como hoy. En esos grupos: `min-width: 0` en cada bloque (si no,
   una tabla ancha o una URL larga ensancha la página), el espacio del final (`.bn-trailing-block`) con
   `flex-basis: 100%`, y sin tocar la regla de BlockNote que oculta los hijos de las listas desplegables
   cerradas.
4. **Tiradores:** el arrastre de BlockNote (bloque de imagen del núcleo) cambia el ancho del contenedor
   directo en el DOM y al soltar guarda `previewWidth`. Al empezar (captura de `pointerdown` en
   `.bn-resize-handle`) se fija el ancho real en px y se avisa al plugin (meta, sin cambiar el documento),
   que decora el bloque con `img-resizing` (el CSS deja de forzar el ancho). Al soltar, un
   `appendTransaction` atado a esa sesión (solo local, solo si hubo movimiento) convierte en la misma
   transacción el px en `rowWidth` con la inversa exacta del CSS y lo imanta a 1, 1/2, 1/3 o 1/4. Nunca
   clases a mano en el DOM de ProseMirror. Los cambios remotos no se convierten nunca.
5. **Elegir varias fotos:** la barra de BlockNote no aparece con una selección de texto que solo abarca
   fotos. Por eso **"Arrange in rows" actúa sobre la tanda de fotos seguidas de la foto elegida** (una
   sola foto elegida alcanza). Los tamaños rápidos se aplican a la foto elegida.
6. **Borde de la elegida con `outline`**, nunca `border` (cambiaría el ancho y partiría la fila).
7. **Clic:** se decide en `pointerdown` mirando la selección del modelo (NodeSelection de esa misma foto y
   el editor con foco). Con el mouse, el clic abre solo si ya estaba elegida o si es doble clic
   (`detail >= 2`); con ⌘/Ctrl no abre. Sin escuchar `dblclick` (abriría dos veces). Teléfono y solo
   lectura, como hoy. `cursor: zoom-in` solo en la elegida o en solo lectura.
8. **Acomodar en filas:** en orden, programación dinámica con como mucho 4 por fila, costo `ln(h/H)²` con
   límites 0,5·H a 2,2·H (al principio se pensó 1,6·H: con eso dos apaisadas no llenaban una fila), `H` = el alto de una foto 3:2 a un tercio del ancho (descontando espacios). La
   última fila se calcula llena y recién después, si queda más alta que 2,2·H, se achica sin llenar (como
   la tanda termina en un bloque que no es foto, nada sube a esa fila). Toda fila que no es la última
   llena. Las panorámicas pueden tener fila propia. Redondeo a 4 decimales; la última de la fila = 1 − la
   suma de las otras. El botón espera a que carguen las miniaturas (la proporción sale de ahí).
9. **Paginación:** las fotos de una fila son una sola unidad (función pura `mergeRowUnits`, por la marca de
   fila del plugin). `cleanCopy` no fija px en las fotos con `rowWidth` (su ancho ya sale de la fila).
10. **Cursor:** entre fotos de una fila, izquierda y derecha van de foto a foto; arriba y abajo, a lo que
    hay antes o después de la fila. El cursor de hueco que igual aparece se dibuja visible (línea de 2 px
    del ancho de la foto; en una fila queda horizontal sobre la foto: dibujarlo vertical queda pendiente). Enter con una foto de una fila elegida crea el párrafo después de toda la fila.
11. **Comentarios al margen:** dos fotos comentadas en la misma fila no se tapan (se agrupan).

Decisiones (a confirmar por Lega): sin tiradores en el teléfono; el tirador del menú lateral de las fotos de
una fila queda a la izquierda de la fila; las leyendas no entran en el cálculo de "Acomodar" (las fotos
quedan alineadas arriba).

## Entregas

1. **v0.044 — Elegir y abrir (hecho):** primer clic elige, segundo abre; borde visible; tiradores visibles con la foto
   elegida; cursor de hueco visible. Sin propiedad nueva.
2. **v0.045 — Anchos y filas (hecho):** `rowWidth`, filas del plugin, tamaños rápidos en la barra, tiradores que
   imantan, paginación y PDF, flechas, Enter, comentarios. Sube `min_app_version`.
3. **v0.046 — Acomodar en filas (hecho).**

## Cómo quedó (v0.045)

- `src/ui/imageRows.ts`: las cuentas, sin pantalla (qué fotos van en cada fila, la inversa del CSS para
  el tirador, el imantado y "Acomodar en filas"), con pruebas en `imageRows.test.ts`.
- `src/ui/imageRowsEditor.ts`: la propiedad `rowWidth`, el plugin que decora las filas, la conversión del
  tirador (en la misma transacción, solo con un arrastre de este dispositivo) y las flechas y Enter. Pruebas
  en `imageRowsEditor.test.ts` (la versión publicada abre la página sin borrar nada, las decoraciones no
  tocan el documento, el teclado).
- `src/ui/MediaToolbarButtons.tsx`: los tamaños rápidos (guardan también `previewWidth` en px para las
  versiones viejas).
- `src/ui/pagination.ts` (`mergeRowUnits`) y `printView.ts`: una fila es una sola unidad de la paginación y
  el salto de hoja va en todas sus fotos.
- `src/ui/EditorComments.tsx`: los contadores de comentarios que caerían uno encima de otro se corren.
- CSS en `src/styles.css`, "Fotos en fila".
- Probado en Chromium de punta a punta (repo de pruebas privado, `rows.mjs`): dos fotos de 1/2 en una fila
  que llena el ancho, el tirador imanta a 1/4, flecha derecha y Enter en una fila, la vista de impresión
  con la fila y el PDF en una hoja.
- Una foto sola con ancho propio que no llena el renglón respeta su alineación (centrada o a la derecha);
  en una fila de varias, la alineación no cuenta.
- El tirador solo cuenta con el botón principal y si se movió al menos 3 px (un temblor no cambia un
  ancho que dejó "Acomodar en filas").
- Pendiente: el cursor de hueco vertical entre fotos de una fila; el botón de comentar que aparece al pasar
  el mouse por la segunda foto de una fila puede quedar sobre el contador de la primera; revisar a mano la
  impresión de filas en Safari y el iPhone (en Chromium los saltos de hoja sobre las filas andan). El
  indicador de dónde se suelta al arrastrar un bloque sigue horizontal (se podría dibujar
  vertical entre fotos con `dropCursor.hooks.computeDropPosition`), y el tirador del menú lateral de las
  fotos de una fila queda a la izquierda de la fila.

## Acomodar en filas (v0.046)

- Botón en la barra de una foto elegida (ícono de grilla, *Arrange in rows*), solo si la foto tiene al lado
  otras fotos o videos seguidos. Actúa sobre esa tanda entera, tomada al hacer clic. Se apaga mientras carga
  alguna miniatura (la proporción sale de ahí) y se prende solo cuando terminan; una foto sin miniatura,
  rota o con el marcador de "todavía no está" cuenta como 3:2.
- `arrangeRows` (`src/ui/imageRows.ts`): partición en orden por programación dinámica, como mucho 4 por fila,
  costo `ln(h/H)²` con `H` el alto de una 3:2 a un tercio del ancho, límites 0,5·H a 2,2·H. La última fila se
  calcula llena y, si queda más alta que 2,2·H, se achica a la altura de la anterior (o a 2,2·H si es la
  única). Dos apaisadas llenan una fila; una sola foto queda a unos dos tercios del ancho.
- Un solo cambio: todas las fotos de la tanda en una transacción (un solo deshacer). También guarda
  `previewWidth` para las versiones viejas.
- Probado en Chromium (`arrange.mjs`, en el repo de pruebas privado): cinco fotos de proporciones distintas quedan en 2 + 3, cada fila con
  la misma altura y llenando el ancho, el orden no cambia, un deshacer vuelve atrás.
- Visto al probar (ya pasaba antes, no es de esto): después de pegar fotos, deshacer y rehacer varias veces
  pasa por un estado intermedio sin las fotos; al rehacer todo, o al recargar, están todas.

## En el teléfono: en fila o apiladas (v0.047)

- Preferencia de la cuenta `phoneImages` (`src/prefs.ts`): `rows` (por defecto) o `stacked`. Se elige en el
  menú de la cuenta (*Images in a row* / *Fotos en fila*), que la muestra solo en pantallas angostas
  (`isPhoneLayout`, menos de 760 px).
- Queda en `<html data-phone-images>`; el CSS, solo en pantallas angostas y solo en el editor, pone cada foto
  de una fila en su propio renglón. La vista de impresión y el PDF no cambian.
- Una versión anterior no conoce la clave: la maneja como el idioma (una copia vieja sin la clave no la
  sube; si la cuenta no la tiene, el dispositivo se queda con la que tenía, o la de fábrica si es nuevo).
  Pruebas en `prefs.test.ts`.
- Solo en la página (`#root`): la vista de impresión (que mide las marcas de hoja también en el teléfono) y
  el PDF siguen con las filas.

## Calidad en la página (v0.058)

**El problema** (lo vio Lega con MGTZD importado de Coda): en la página las fotos se veían borrosas y en el
carrete, nítidas. **Era nuestro, no de la exportación.** `scripts/coda-export.mjs` baja la dirección tal cual
viene en el HTML de Coda (el blob `codahosted.io/.../blobs/bl-…`, sin parámetros de tamaño), y en la base las 32
fotos del proyecto tienen su tamaño original: casi todas de 2900 a 3840 px de ancho y de 0,5 a 1,4 MB (las
capturas PNG, 1100 a 1500 px). Lo que se veía en la página era siempre la **miniatura**: JPEG de 480 px de lado
mayor (calidad 0,8, 11 a 45 KB), hecha al agregar la foto y guardada en el bucket `thumbs`. `resolve` (lo que
BlockNote pone en el `<img>`) daba la miniatura en todos los casos y en todos los dispositivos, también en el que
tiene el original (el importador y quien soltó la foto); el original lo usaban solo el carrete y la impresión
(esta, solo si está en el dispositivo). Cómo se veía:

| Bloque | Ancho en pantalla | Lo que se mostraba | Resultado |
|---|---|---|---|
| Sin ancho propio (la mayoría de lo importado: en Coda iba "a lo ancho") | el natural de la miniatura: 480 px (la caja de BlockNote es `fit-content`) | 480 px | nítida en pantalla común; en una pantalla 2x (Mac, iPhone) la mitad de los píxeles que hacen falta |
| A todo el ancho (*Full*, filas) o con ancho de Coda/tirador | hasta el área de texto (720 px en A4, ~1040–1100 en hojas anchas) | 480 px estirada | **borrosa**: en 2x, 2200 px de pantalla con 480 de imagen (4,6 veces) |
| Una captura con letra chica | cualquiera de los dos | 480 px | ilegible |

Pasaba igual con las fotos soltadas o pegadas a mano, en cualquier dispositivo: no dependía de la importación
ni de tener el original.

**Lo que se hizo:** la página muestra primero la miniatura (enseguida, sin red) y, cuando una foto se dibuja más
grande que su miniatura, la cambia por una **imagen nítida** hecha en el dispositivo: de **2048 px** de lado
mayor, o de **1024** si la foto se dibuja a 900 px del dispositivo o menos (un teléfono: menos lugar y menos
memoria).

- **Cuándo** (`src/ui/sharpImages.ts`): el ancho en pantalla por la densidad (como mucho 2x) supera en 20% el
  ancho de la miniatura (`wantsSharper`). Solo las fotos a la vista o a menos de 600 px de verse
  (`IntersectionObserver` sobre `.main`, lo que se desplaza), de a dos a la vez, **lo último que se vio
  primero**; lo que se pasó de largo mientras esperaba se descarta (se vuelve a pedir si se vuelve a ver). Una
  foto a la vista que cambia de ancho (tamaños rápidos, tirador, "Acomodar en filas", hoja más ancha, barra
  lateral: `ResizeObserver`) se vuelve a mirar y puede pasar de la chica a la grande. También se vuelve a
  mirar lo que está a la vista al volver la red (`online`) y cada 65 segundos. Una foto chica en una fila de
  cuatro o sin ancho propio en una pantalla común sigue con la miniatura (se ve perfecta).
- **De dónde** (`MediaQueue.view`): 1) la ya hecha, guardada en el dispositivo en el almacén `thumbs` de la base
  de archivos (`view:<id>` la de 2048, `view1024:<id>` la chica; una de 2048 sirve para las dos), sin cambiar
  la versión de IndexedDB: una versión vieja no la lee ni se entera; 2) el original del dispositivo, reducido
  (anda sin red); 3) si no está, el original bajado **una sola vez por dispositivo** con un pase del portero
  (el mismo del carrete) y reducido acá. Nunca se sube nada: ni a Supabase ni a Drive.
- **Depende del portero de v0.058.** La app baja el original con `fetch`, y el navegador solo la deja leer la
  respuesta si el portero manda `Access-Control-Allow-Origin` en `/m/` (`Doc_Portero.md`, "Lo que se sirve"),
  que se publica con esta versión. Con un portero anterior la bajada falla y la página sigue con la
  miniatura; después de tres fallas seguidas sin respuesta (con red) la app no baja nada por media hora.
  El original del dispositivo no depende del portero.
- **Qué no se baja para la página:** videos (queda la miniatura con la marca de "play"), fotos que no todos los
  navegadores abren (HEIC, TIFF, RAW: solo del original local, si el navegador puede), las que todavía no
  llegaron a Drive, las de más de 25 MB (**8 MB en un teléfono o una tableta**, puntero grueso: una foto de
  teléfono pesa 2 a 5 MB), y nada sin red, con *Save-Data* o con una conexión lenta (2g/3g). Ojo: *Save-Data* y
  la velocidad (`navigator.connection`) solo los dice Chrome (también en Android); **Safari y Firefox no dicen
  si la conexión es medida**, así que en el iPhone se baja igual (con el tope de 8 MB).
- **Lo que no se pudo no se repite:** si el navegador no abre lo bajado o el original local, si tarda más de
  20 segundos, o si lo bajado pesa más que el tope, en esa sesión no se vuelve a bajar ni a decodificar. Nunca
  hay dos decodificaciones del mismo archivo a la vez. Una bajada que falló (sin red, el portero) se vuelve a
  probar al minuto, después a los 4, a los 16… hasta una hora.
- **El mismo tamaño:** una foto sin ancho propio se veía del ancho natural de la miniatura; la nítida es más
  grande, así que lleva ese ancho de tope (`--sd-thumb-w`, regla en `styles.css`). En la imagen quedan las
  medidas naturales de la miniatura (`data-sd-sharp` y `data-sd-sharp-h`), de qué archivo (`data-sd-sharp-id`)
  y de qué lado es la nítida (`data-sd-side`). La vista de impresión (ancho y proporción) y "Acomodar en filas"
  usan las medidas de la miniatura (`src/ui/sharpMarks.ts`): dan lo mismo en un dispositivo con la nítida que
  en otro sin ella. La foto no crece ni cambian las marcas de hoja ni el PDF. Con ancho propio (px o fila)
  manda ese ancho.
- **Sin tocar el documento:** BlockNote sigue creyendo que muestra la miniatura; si la vuelve a poner (o la pone
  `subscribeThumbs`), la nítida vuelve en el acto. Si se reemplaza el archivo del bloque o la foto pasa a
  mostrar otra cosa (borrada, de otro proyecto), pierde las marcas y el tope. Una foto mandada a la papelera de
  Drive borra su nítida guardada.
- **Lugar en el dispositivo:** las nítidas guardadas se anotan en `meta` (`viewIndex`) en el orden en que se
  usaron; pasado 150 MB (u 800) se borran las más viejas. Si falta lugar para guardar un archivo nuevo, primero
  se borran todas las nítidas (se vuelven a hacer cuando hagan falta). En memoria quedan como mucho 60
  direcciones; las más viejas que ninguna imagen muestra se sueltan.
- **El carrete** empieza con la nítida si ya está (y después el original, como antes). **La impresión** sigue
  usando el original del dispositivo; en otro dispositivo, ahora sale con la nítida en vez de la miniatura.
- **Versiones viejas:** nada cambia en el documento, en la base ni en el bucket. La miniatura sigue siendo el
  mismo JPEG de 480 px.

**Cómo se codifica** ("Exportar para web", `src/media/probe.ts`, `viewImage`): se decodifica ya reducida
(`createImageBitmap` con `resizeWidth`/`resizeHeight` y `resizeQuality: 'high'`: una foto de 48 MP entera no
entra en la memoria de un iPhone). Solo si el navegador no tiene esas opciones se dibuja la imagen entera y se
achica en el canvas de a mitades con `imageSmoothingQuality: 'high'` (un solo salto grande deja dientes o
moiré); los canvases intermedios se sueltan enseguida. Sale en **WebP 0,8** donde el navegador lo hace
(Chrome, Edge, Firefox) y en **JPEG 0,8** donde no (Safari devuelve PNG: se prueba una vez y queda anotado).
Siempre sobre **blanco**, como la miniatura: un PNG con transparencia se ve igual que su miniatura, en los dos
temas y en Safari (JPEG no tiene transparencia); guardar la transparencia en WebP haría que la misma foto se
viera distinta según el navegador. Un JPEG que ya entra en el tamaño y pesa menos de 900 KB se usa tal cual
(del dispositivo, sin guardar una copia). Medido en Chromium (la de 2048):

| Original | Miniatura (JPEG 480) | Nítida WebP 0,8 | Nítida JPEG 0,8 (Safari) |
|---|---|---|---|
| "12 MP de teléfono" 4032 × 3024, JPEG 2,4 MB (mosaico de fotos reales con ruido de sensor: más detalle que una foto común) | 31 KB | 2048 × 1537, 285 KB | 398 KB |
| Como las de Coda: 3840 × 1630, JPEG 642 KB | 15 KB | 2048 × 870, 127 KB | 182 KB |
| Documento escaneado A4 300 dpi, letra chica, 2480 × 3508, JPEG 2,5 MB | 34 KB | 1448 × 2048, 340 KB | 563 KB |
| Captura de pantalla 2x con una planilla de letra de 12 px, 2880 × 1800, PNG 619 KB | 44 KB | 2048 × 1280, 287 KB | 490 KB |

(WebP 0,75 pesa un 10% menos que 0,8; a 2x de zoom no se distingue de JPEG 0,8.) Con la letra chica, la
miniatura estirada a 1100 px no se lee y la nítida sí.

**Costos:** en el dispositivo, unos 130 a 350 KB por foto vista grande (menos la chica), con el tope de 150 MB.
En la red, la primera vez en cada dispositivo sin el original, el original entero por el portero (las de
MGTZD, ~1 MB; una de teléfono, 2 a 5 MB); después, nada. Cloudflare: un pedido por foto (el plan gratis da
100.000 por día). Supabase: nada (no se guarda ni se baja nada más de ahí). Se descartó guardar una versión
mediana en Supabase: ~250 KB por foto llenaría el GB del plan gratis con unas 4000 fotos del workspace, y hace
falta migración y generarla en el dispositivo que tiene el original (las ya subidas quedarían sin ella).

**Pendiente / para después:**

- Si en el teléfono con datos pesa, que el dispositivo que sube la foto suba también la nítida a Drive, al lado
  del original (ruta nueva del portero): en otro dispositivo se bajarían ~300 KB en vez del original. Necesita
  el portero publicado y probarlo con el portero real.
- La bajada por el portero no se pudo probar desde la nube (el portero no se alcanza): probar a mano en otro
  dispositivo, después de publicar el portero, que las fotos importadas se vean nítidas.
- El importador deja sin ancho propio las fotos que en Coda iban a lo ancho: en la página se ven de 480 px (el
  ancho natural de la miniatura). Si Lega las quiere a todo el ancho, el importador podría ponerles `rowWidth: 1`.
- Un video a todo el ancho sigue con la miniatura (el póster) de 480 px.
- Pruebas: `src/media/view.test.ts` (de dónde sale en cada dispositivo, qué no se baja, sin red y los
  reintentos, lo que no se pudo no se repite, una decodificación a la vez, la chica y la grande, el tope de lo
  guardado, hacer lugar), `src/ui/sharpImages.test.ts` (cuándo, el tope, BlockNote que vuelve a poner la
  miniatura, archivo reemplazado, de a dos y lo último visto primero, agrandar a la vista, volver la red, la
  pausa con un portero sin CORS), `portero/src/core.test.ts` (CORS en `/m/`), `pagination.test.ts`
  (impresión) y `carreteLoader.test.ts`. En Chromium, `sharp.mjs` del repo de pruebas privado: solo el camino
  del original local.
