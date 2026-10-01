# Imágenes en la página: elegir, tamaño y filas

Diseño de lo que pidió Lega el 2026-09-30 (fotos y videos del editor; en la página los dos son un bloque
`image`, ver `Doc_Carrete.md`). Estado: **hecho: v0.044 (elegir y abrir), v0.045 (anchos y filas), v0.046 (acomodar en filas), v0.047 (en el teléfono, en fila o apiladas) y v0.058 (calidad en la página).** "Correcciones de la auditoría previa" manda sobre lo anterior.

**Desde v0.078, nada crea fotos-bloque nuevas** con un archivo: pegar, soltar y "/Image" ponen las fotos y los videos
en el renglón (`Doc_Fotos_En_Linea.md`, "Cómo quedó (entrega 2)"); los adjuntos siguen siendo un bloque `image` (la
tarjeta). Lo de este documento sigue valiendo para las fotos-bloque que ya existen (sus filas, tamaños y *Arrange in
rows* sobre la tanda) y para las que todavía crea pegar HTML con un `<img>`, hasta convertirlas (la conversión
existe desde v0.078 pero no tiene entrada en la interfaz, D-26; `Doc_Fotos_En_Linea.md`, "Cómo quedó (entrega 3)").

**La barra de la foto-bloque cambió en v0.078 (D-24):** es la misma que la de la foto en línea (`MediaBar.tsx`), por
sectores: [ver, bajar] | [1/1, 1/2, 1/3, 1/4, *Arrange in rows*] | [alinear] | [comentar] | [*Replace image*, *Rename
image*, *Delete image*], todos los botones de 30 × 30 px y con `data-tip`. Sin *Edit caption* (una leyenda que ya
existe se sigue viendo) ni *Toggle preview*; *Replace image* abre el selector de archivos (sin *Embed*). Ver
`Doc_Fotos_En_Linea.md`, "Paridad con la foto-bloque".

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

## Fotos HEIC (v0.075)

Decisión D-20 (`Doc_Decisiones.md`): la app muestra las fotos HEIC, las del iPhone. Chrome (Windows y Mac) no
sabe decodificar HEIC: antes, una foto HEIC soltada en el editor se guardaba y se subía, pero quedaba sin
miniatura y la página mostraba un ícono. Desde el iPhone casi no pasa (Safari entrega JPEG al elegir de la
fototeca), pero un HEIC que llega como archivo sí.

**Qué hace: guardar primero, convertir después.** Al agregar una foto HEIC (soltar, pegar, elegir con el
selector, reemplazar el archivo de un bloque, una imagen embebida en HTML pegado, la importación de Coda), la
cola la **guarda tal cual en el acto**, como cualquier archivo: a salvo en el dispositivo en milisegundos,
marcada "por convertir". Enseguida, en segundo plano, la **pasa a JPEG en el dispositivo** y reemplaza el HEIC
por el JPEG en una sola transacción, siempre antes de registrarla en la base. Lo que queda en el dispositivo y
en el Drive es el JPEG: nombre con `.jpg` (`IMG_1234.HEIC` → `IMG_1234.jpg`), tipo `image/jpeg`, tamaño
completo, calidad 0,92. El archivo de la persona no se toca. De ahí en más es una foto como cualquiera:
miniatura, medidas, imagen nítida, carrete y PDF salen del JPEG, sin cambios en `probe.ts` ni en
`sharpImages.ts`. Es lo mismo que hace desde v0.072 el comando que baja un doc de Coda (`Doc_Importar_Coda.md`,
"Fotos HEIC"). Así, "sin red", "decodificador no disponible", "la pestaña se cerró a mitad" y "conversión
lenta" son el mismo camino: el HEIC ya está guardado y se convierte cuando se puede.

- **Orientación:** la aplica el decodificador (las cajas `irot`/`imir` del HEIC): una foto vertical sale
  vertical.
- **Perfil de color:** las fotos del iPhone están en Display P3. Los píxeles se decodifican tal cual, se
  codifica el JPEG y se le mete el perfil ICC del HEIC (segmentos APP2). Sin eso el JPEG se leería como sRGB y se
  vería menos saturado. Si el navegador le puso un perfil propio al codificar, se saca: queda uno solo. Desde
  v0.0XX el perfil es el de la **imagen principal** (`pitm` → `ipma` → `ipco`; una grilla sin color propio toma
  el de su primer cuadro), no el primero que aparece en el archivo: un HEIC con un mapa o una miniatura con
  perfil antes de la foto llevaba el equivocado. Si la foto declara su color solo con números (`nclx`, sin
  perfil), se arma un perfil estándar equivalente: Display P3 (primarios 12) o BT.2020 (9), con la curva sRGB o
  BT.709; con primarios sRGB no hace falta, y HDR (curvas PQ o HLG) queda sin perfil. El Display P3 armado tiene
  los mismos números que el de un iPhone y Chromium lo dibuja igual. Es el mismo código que usa el comando de
  Coda (`src/media/heifColor.mjs`, JavaScript puro). Si la cabecera no se puede leer (cortada, rara), se busca
  como antes, por orden.
- **Se comprueba:** el JPEG se vuelve a abrir (`createImageBitmap`, sin aplicar el perfil) y tiene que medir lo
  mismo que el HEIC y parecerse. Lo que devuelve un canvas no es de fiar a ciegas: pasado su tope de área (16,7 MP
  en iOS) puede salir vacío (blanco o negro), y hay navegadores que alteran lo que se lee. Dos comparaciones: una
  grilla pareja de 16 puntos (el promedio de cuadraditos de 8 × 8, con tolerancia amplia; más de la mitad
  distintos no es la foto) y, desde v0.0XX, hasta 12 **puntos que se apartan del fondo** de la foto (la mediana
  de la luminancia, en una grilla de hasta 48 × 48 cuadraditos de 4 × 4): el texto de un documento, el horizonte
  de un cielo. En cada uno, el JPEG tiene que estar más cerca de la foto que del fondo (en luminancia, que el JPEG
  guarda casi exacta); si más de la mitad no, es un canvas vacío. Antes, con una foto casi toda blanca, un canvas
  en blanco pasaba la grilla. Una foto lisa no tiene esos puntos (y un canvas vacío del mismo color es igual a
  ella). Si no coincide, cuenta como fallida y queda el HEIC.
- **Tope de 50 megapíxeles:** entra la foto más grande de un iPhone (48 MP) y el pico de memoria queda cerca de
  800 MB (con 100 MP serían 1,6 GB). Una más grande queda como HEIC.
- **Cómo se reconoce un HEIC:** por la firma del archivo (caja `ftyp` con marca `heic`, `heix`, `heim` o
  `heis`; o la genérica `mif1` si no es un AVIF, que Chrome sí muestra) y, si no tiene firma, por el tipo
  (`image/heic`, `image/heif`). Se leen solo los primeros 64 bytes. El nombre solo no alcanza. **Las secuencias**
  (marcas `hevc`, `hevx`, `hevm`, `hevs`, `msf1`, tipos `*-sequence`: varias imágenes, como un video corto) no
  se convierten: un JPEG de la primera perdería el resto. Se guardan tal cual.

**Estados y avisos** (en el lugar de la foto, en inglés o castellano; `MediaRecord.heic` en el dispositivo):

| Estado | Marca | Aviso | Qué pasa |
|---|---|---|---|
| Recién agregada | `pending` | *HEIC photo: turning it into a JPEG…* | Se convierte en segundo plano; apenas está el JPEG la página lo muestra, sin recargar. |
| El decodificador no está, sin red (y este dispositivo nunca lo bajó) | `pending` | *HEIC photo: turns into a JPEG once online* | La cola vuelve a probar en cada vuelta, antes de registrarla. Si el dispositivo cree que no tiene red (`navigator.onLine` en `false`), sigue el camino de siempre: la manda a registrar (falla sin red, queda `sent`) y al volver la red pregunta a la base y la convierte. Si en realidad había red, se registra y se sube el HEIC: nunca espera para siempre. |
| El decodificador no cargó con red (una red mala cortó la bajada) | `pending` | *HEIC photo: trying again to turn it into a JPEG…* (desde v0.0XX) | Hasta 3 intentos, a los 30 s y a los 2 min (`HEIC_ONLINE_TRIES`, `MediaRecord.heicMisses`), sin registrarla. Si el tercero tampoco carga, se registra y se sube el HEIC (subir manda). Después de recargar, el aviso sale de `heicMisses`: dice esto mientras espera el próximo intento, no "convirtiendo". |
| Se mandó a registrar como HEIC sin saber si llegó | `sent` | el mismo | Antes de convertirla se le pregunta a la base (`fetchMediaFiles`): si ya tiene la fila, queda como HEIC; sin respuesta, se espera. |
| No se pudo convertir (archivo roto, falta de memoria, más de 50 MP, el JPEG no pasó la comprobación, más de 2 minutos) o ya se registró como HEIC | `failed` | *HEIC photo: could not turn it into a JPEG* | Se sube como HEIC. No se reintenta. |
| Un HEIC subido sin convertir (otro dispositivo, una versión anterior) | — | *HEIC photo: this browser cannot show it* | Queda así (ver pendientes). |

Por qué se pregunta a la base: `register_file` no cambia una fila que ya existe y el portero compara el peso del
archivo con el de la fila. Si la respuesta del registro como HEIC se pierde y después se convierte, el JPEG
quedaría detenido ("The size does not match the file") y el HEIC ya no estaría en el dispositivo. Una vez
registrada como HEIC, la foto no se convierte más.

**Sin esperar la pregunta (v0.0XX).** Un `pending` se convierte enseguida, mientras se pregunta a la base; el
JPEG se guarda recién con la respuesta (si la base ya tiene la fila, se descarta y queda el HEIC). Si el
dispositivo sabe que no tiene red (`navigator.onLine` en `false`), no se pregunta: sin red, la consulta tardaba
unos 7 s en fallar y la conversión empezaba recién ahí. Medido en Chromium con la cola de verdad y una base que
tarda 7 s en fallar: el JPEG está a los 0,9 s (antes, 7,1 s). Un `sent` sigue esperando la respuesta antes de
convertir.

**El nombre del bloque.** El bloque nace con el nombre del archivo de la persona (`IMG_1234.HEIC`), porque
cuando la foto entra a la página todavía no está convertida. Cuando el archivo ya es un JPEG, el bloque pasa a
`IMG_1234.jpg` (`src/ui/heicNames.ts`): al terminar la conversión si la página está abierta, o la próxima vez
que la foto se muestra en un editor que puede editar (otra sesión, otro dispositivo, una página importada de
Coda). Es un cambio de la app (no abre secciones colapsadas). Un HEIC que quedó sin convertir conserva `.HEIC`.

**El decodificador.** [`libheif-js`](https://www.npmjs.com/package/libheif-js) (libheif en WebAssembly, con el
decodificador de HEVC libde265; LGPL-3.0, ver D-21 y `THIRD_PARTY_NOTICES.md`). Corre en un **Web Worker**
(`heic.worker.ts`), uno por foto, que se cierra al terminar (así su memoria se suelta entera): la pantalla no
se traba. Si el navegador no deja crear el Worker, o su script no arranca, se hace en la página (tarda lo
mismo, trabando mientras dura); si el Worker no tiene `OffscreenCanvas`, decodifica él y el JPEG lo codifica
la página. **Siempre termina:** el Worker y el respaldo en la página tienen tope (2 minutos; un Worker que ni
arrancó cuenta como "no está"), la bajada del `.wasm` se corta a los 45 s ("no está") y la cola pone su propio
tope por encima de todo (`HEIC_LIMIT_MS`). **De a dos** (`HEIC_PARALLEL`, desde v0.0XX): cada conversión pide
cientos de MB (cerca de 800 con 48 MP) y antes, al soltar muchas juntas, se abrían todas a la vez. Las demás
esperan su turno, y la espera no cuenta para el tope.

**Que no pese ni recargue.** Nada del decodificador está en el paquete principal: se carga recién cuando llega
un HEIC. `heicConvert.ts` (4,6 KB) sí va en el paquete de la cola: si se cargaba con `import()`, en la primera
sesión de un dispositivo y sin red el import fallaba y el navegador guardaba ese fallo en la pestaña, así que
el HEIC se subía sin convertir al volver la red (lo encontró la auditoría de v0.075). El Worker se crea de
nuevo en cada foto y no guarda fallos; el respaldo sin Worker (`heicLib.ts`) sí, pero solo se usa si el
navegador no puede crear el Worker. Son tres archivos aparte: `libheif-*.wasm` (1,42 MB; 477 KB comprimido),
`heic.worker-*.js` (94 KB) y `heicLib-*.js` (89 KB, el respaldo sin Worker); los dos `.js` empiezan con el
aviso de licencia. Tampoco están en lo que el service worker guarda al instalar la app (`globIgnores` en
`vite.config.ts`): se guardan la primera vez que se usan (caché `heic-decoder`), y desde ahí la conversión anda
sin red. Esos `import()` son **opcionales** (`src/lib/optionalImport.ts`): si fallan sin red, el oyente de
`vite:preloadError` (`lazyPart.tsx`) no lo toma como una versión nueva y no recarga la app con el aviso *A new
version is available*; la foto queda esperando.

**Medido** (Chromium sin ventana, build de producción, fuera del repo): cuatro fotos reales de iPhone de 24 MP
(5712 × 4284, 2,5 a 5,1 MB) tardan entre 1,0 y 1,4 s cada una, contando la carga del decodificador y la
comprobación; el hueco más largo de la página mientras tanto fue de 12 ms. El JPEG pesa alrededor de 1,3 a 1,5
veces el HEIC (3,3 a 6,5 MB) y lleva el perfil Display P3 entero.

**Pendiente / para después:**

- **Los HEIC ya subidos** sin convertir siguen sin verse (con su aviso). Convertirlos pide bajar el original,
  subir un archivo nuevo y cambiar la fila: no está hecho.
- **Los metadatos** (fecha, lugar, cámara) no pasan al JPEG: quedan en el archivo de la persona.
- **Sin portero** (workspace sin Drive) las fotos van a Supabase por otro camino, que no convierte.
- **HDR y 10 bits:** el JPEG es de 8 bits; el mapa de ganancia HDR del iPhone no pasa, y un HEIC que declara su
  color con una curva HDR (`nclx` con PQ o HLG) sale sin perfil.
- **En el iPhone** no se midió la memoria con una foto de 48 MP. Safari casi nunca entrega un HEIC, y si la
  conversión falla queda el HEIC, que Safari sí muestra.
- **Dos pestañas a la vez:** si una pestaña con una versión anterior registra el HEIC, la respuesta se pierde y
  justo entonces esta versión lo convierte sin red (sin poder preguntar), el JPEG quedaría detenido. Necesita
  las tres cosas juntas; con red, la pregunta a la base lo evita. Otra, de la misma pestaña líder (anterior a
  v0.0XX, ventana de microsegundos): si al tercer intento marca `sent` justo después de que otra pestaña guardó
  el JPEG, el JPEG se sube bien pero en este dispositivo queda con el aviso de HEIC. Se cerraría haciendo ese
  `patch` condicional a que la marca siga en `pending`.
- **La comprobación del JPEG acepta uno con la mitad en blanco** (límite conocido, anterior a v0.0XX): en la
  grilla pareja da justo la mitad distinta (no "más de la mitad") y los puntos que se apartan del fondo caen
  repartidos. Un canvas entero vacío (blanco o negro) sí se rechaza, y es lo que se conoce del tope de iOS. Se
  cerraría rechazando también cuando una mitad entera, la de arriba o la de abajo, es distinta.
- **`min_app_version` no frena la cola de archivos** (revisado en v0.0XX): solo la usan `push_page_update` en la
  base y el ciclo de páginas de `sync/engine.ts`. `register_file` no recibe la versión, el portero tampoco, y la
  cola de archivos no mira `status.outdated`: una pestaña de v0.074 o anterior sigue registrando y subiendo
  HEIC sin convertir aunque se suba la mínima. Para frenarla haría falta una migración que haga con
  `register_file` lo mismo que con `push_page_update`: una versión nueva con `p_app_version`, y la de siempre (la
  que llaman las versiones viejas) sin versión, que deja de andar en cuanto el workspace pide una mínima. La
  versión vieja quedaría con el archivo detenido en el dispositivo (sin perderlo) hasta actualizar.

**Archivos:** `src/media/heic.ts` (reconocer, nombre, meter el perfil en el JPEG), `heifColor.mjs` y
`heifColor.d.mts` (cuál es el perfil: la imagen principal y `nclx`; compartido con el comando de Coda), `heicDecode.ts` (decodificar, codificar
y comprobar), `heicLib.ts` (cargar la librería), `heic.worker.ts`, `heicConvert.ts` (el Worker y el respaldo),
`queue.ts` (`add`, `ensureConverted`, `convertNow`, `heicState`, `HEIC_ONLINE_TRIES`), `src/ui/heicNames.ts` (el nombre del bloque) y
`src/lib/optionalImport.ts`. **Pruebas:** `heic.test.ts` (firma, tipo y secuencias, nombre, perfil, el color de
la imagen principal con cabeceras armadas a mano (otra imagen con perfil antes, una grilla, `ipma` de 32 bits,
sin color, perfil y `nclx` juntos, cortada), el perfil Display P3 desde `nclx` contra los números del de un
iPhone, la comprobación del JPEG (también un documento, un cielo y una noche con un canvas vacío de su color, y un
JPEG con ruido que pasa), el tope de 50 MP, y el decodificador de verdad por la misma entrada que la app: el HEIC
de prueba de 96 × 64 girado sale de 64 × 96 con sus colores), `heicConvert.test.ts` (el archivo del Worker de
verdad con un Worker de mentira, el respaldo sin Worker, el Worker que no arranca o se cae, los topes, sin el
`.wasm`), `queue.test.ts` ("fotos HEIC": guardar primero, el JPEG que se sube, lo que no pasa por el conversor,
el conversor que falla o no contesta, sin red, los tres intentos con red y sus esperas, un decodificador que no
baja una vez y el reintento que sube el JPEG, sin red sin contar intentos ni preguntar a la base, un navegador
que cree que no hay red y sí hay (se sube igual), el aviso al reintentar (también después de recargar), de a dos,
la conversión mientras la pregunta tarda, la respuesta perdida de `register_file`, la fila registrada
mientras se convertía, la medición en curso), `heicNames.test.ts`, `lazyPart.test.tsx` (el oyente de verdad con
un import opcional) y `scripts/licenses.test.mjs`. En Chromium, fuera del repo, el camino entero con el build de
producción: en el Worker, sin Worker, sin el `.wasm` y sin el decodificador, y las cuatro fotos reales. Para
v0.0XX, en Chromium con el servidor de desarrollo y sin sesión (un banco de prueba fuera del repo): cuatro fotos
reales de iPhone (dos verticales) convertidas en el Worker con el perfil de su imagen principal (536 bytes, el
mismo que el HEIC) en 0,9 a 2,0 s; la comprobación con el codificador de verdad pasa con las fotos reales y con
un documento, un cielo y una nieve dibujados, y rechaza el canvas en blanco de cada uno; el Display P3 armado desde
`nclx` se dibuja igual que el del iPhone (diferencia 0; sin perfil, 10 niveles); con la bajada del `.wasm`
cortada una vez, la conversión siguiente lo baja y convierte.

**Correcciones de la auditoría: estado al pausar (2026-10-01).** Los diez puntos están aplicados y pusheados en
`lega/heic-app`, con `origin/main` (v0.074) ya unido; suite completa 1410 pasan, `tsc` y build limpios.

- Hechos, con su prueba: (1) pregunta a la base antes de convertir y marca `sent`; (2) imports opcionales, sin
  recarga falsa; (3) tope en la cola y en el respaldo sin Worker; (4) guardar primero y convertir después, con el
  aviso "convirtiendo" y el nombre del bloque a `.jpg`; (5) la medición en curso no pisa al JPEG; (6) el JPEG se
  comprueba al abrirlo y el tope baja a 50 MP; (7) las secuencias HEIF no se convierten; (8) la bajada del
  `.wasm` colgada cuenta como "no está", el aviso depende de `registered`, y el caso `nclx` está en pendientes;
  (9) avisos y textos de licencia en `public/licenses/`, con el comentario en los archivos de libheif; (10) las
  pruebas del conversor, del Worker y del decodificador por la misma entrada que la app.
- A medias o sin empezar: ninguno.
- Sin verificar: la app real con sesión (Chrome en Windows y Mac, Safari, iPhone); el renombrado del bloque solo
  se probó con el editor en jsdom, no en un navegador; después de estas correcciones no se repitió la prueba del
  service worker (la caché `heic-decoder` y que `/licenses/` no caiga en la app).
- Por dónde seguir: una segunda auditoría de `convertNow` en `src/media/queue.ts` (el caso de dos pestañas
  anotado arriba queda abierto) y la prueba a mano en la app antes de publicar.
