# Imágenes en la página: elegir, tamaño y filas

Diseño de lo que pidió Lega el 2026-09-30 (fotos y videos del editor; en la página los dos son un bloque
`image`, ver `Doc_Carrete.md`). Estado: **diseño, antes de implementar** (se audita antes y después).

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
