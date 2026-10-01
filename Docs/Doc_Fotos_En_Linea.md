# Fotos en línea: la foto como un carácter del renglón (P.15)

Estado: **diseño auditado, sin implementar** (2026-10-01; las "Correcciones de la auditoría", más abajo,
mandan sobre el resto). Pedido de Lega del 2026-10-01, con sus palabras: las
imágenes tienen que ser "como en Coda o en cualquier lado, un carácter más de un texto". Reemplaza el modelo de
`Doc_Imagenes.md` (la foto como bloque y las filas como arreglo entre bloques), que queda para las fotos que
ya existen hasta que se conviertan (ver "Lo que ya existe").

## Qué se pide

1. Poner el cursor **al lado** de una foto, en su mismo renglón, y ahí escribir o pegar otra foto.
2. Las fotos **fluyen** como palabras: dos que entran quedan una al lado de la otra; cuando no entran, la
   que sigue baja al renglón de abajo. Sea cual sea su tamaño.
3. Las flechas pasan por una foto como por una letra: → desde una foto queda a su derecha, en el mismo
   renglón, no en el de abajo.
4. **Backspace** con el cursor delante de una foto que está sola en su renglón la sube al renglón de arriba
   (como unir dos renglones de texto). Enter entre dos fotos las separa.
5. **Elegir varias fotos seguidas** como se eligen letras: Shift+flechas, Shift+clic, arrastrar. Y con varias
   elegidas, **acomodarlas** de una (el organizador automático: filas parejas que llenan el ancho).
6. Lo que se importa de Coda queda como estaba en Coda: las fotos de un mismo renglón, en el mismo renglón, con
   su texto al lado si lo tenían.

Hoy nada de esto se puede (comprobado en la app, v0.072): la foto es un bloque, no hay posición de cursor a su
lado, Shift+clic y Shift+flechas dejan elegida una sola foto, y "Acomodar en filas" aparece con una foto
elegida y reparte toda la tanda de fotos seguidas, no las elegidas. Los tamaños 1/2, 1/3 y 1/4 sí ponen dos
fotos lado a lado, pero es otra cosa: no se puede escribir al lado ni mover una foto de renglón con el teclado.

Cuánto pesa (medido en un doc real de Coda, fuera de sus tablas): de 890 renglones con fotos, 307 tienen
varias fotos juntas y 249 mezclan fotos y texto. La importación de hoy las apila todas.

## Reglas que no se rompen

- **Nunca perder datos.** Ni una foto ni un texto se pierden al convertir, al editar a la vez ni con una
  versión vieja abierta.
- **Una versión vieja no borra lo nuevo.** Ver "Versiones viejas".
- Los originales siguen en el Drive del dueño y la referencia sigue siendo `sdmedia://<id>`.
- En la Mac los atajos van con ⌘. Tooltips con `data-tip`. UI en inglés.

## El modelo

**Un contenido en línea nuevo, `photo`**: un nodo en línea, atómico (sin contenido adentro), que vive en el
texto de un párrafo, un título, un ítem de lista o una cita, entre letras. Propiedades:

| Propiedad | Qué es |
|---|---|
| `url` | `sdmedia://<id>` (o una dirección `https` de otro sitio, como hoy). Se llama `url` a propósito: `mediaIdsInDoc` (`src/media/usage.ts`) cuenta como usado el archivo de **cualquier** elemento con ese atributo, así que la papelera de archivos de las versiones de hoy ya no lo da por quitado. |
| `name` | El nombre del archivo. |
| `w` | El ancho, como parte del ancho del renglón (0 a 1). 0: su ancho natural, con tope en el del renglón. |

Sin leyenda (en Coda tampoco la tiene; el texto de al lado o de abajo cumple esa función). Una foto del
bloque viejo con leyenda no se convierte sola (ver "Lo que ya existe").

**Por qué un nodo nuevo y no un truco.** Se probaron las dos formas (prueba técnica del 2026-10-01, con el
editor real y dos documentos de Yjs):

- *Nodo en línea nuevo:* va y vuelve por Yjs entre dos editores sin perder nada; el cursor, las flechas,
  Backspace, la selección con Shift y el corte de renglón son los de cualquier carácter, porque para el editor
  **es** un carácter. Es la forma en que ProseMirror modela exactamente lo que se pide.
- *Un link con dirección `sdmedia://` dibujado como foto:* una versión vieja lo conserva (lo ve como un link),
  pero el editor habría que engañarlo para que trate un tramo de texto como una sola pieza (cursor, borrado,
  selección, teclado del teléfono, composición con tildes): frágil, y cada caso raro es una foto partida o un
  nombre de archivo suelto en el texto. Descartado.

**Qué va en línea.** Fotos y videos (lo que se ve). Los **adjuntos** (PDF, zip: la tarjeta de archivo) y las
**tarjetas de Drive** siguen siendo bloques: son una tarjeta ancha, no un carácter.

## Versiones viejas

Un tipo de nodo que el esquema no conoce, el editor lo **borra del documento compartido al abrir** (medido en
la prueba: el párrafo y su texto quedan, las fotos en línea se borran, y el borrado llega a todos). Por eso la
regla del repo dice "nada de tipos nuevos" salvo que antes se exija una versión que tenga el resguardo.

El resguardo existe desde **v0.021** (`src/ui/unknownContent.ts`): antes de mostrar una página, y con cada
cambio que llega, la app revisa que todo lo que trae esté en su esquema; si no, **no la abre en el editor**,
muestra el aviso de actualizar y no borra nada. El workspace exige hoy la v0.052 (`min_app_version`), así que
toda versión que puede entrar tiene el resguardo. Orden de publicación:

1. Una versión que **conoce** `photo` (lo muestra y lo edita) pero todavía no lo crea sola.
2. Subir `min_app_version` a esa versión (cuando Lega confirme que la tiene en sus dispositivos).
3. Recién entonces, la versión que **crea** fotos en línea (pegar, soltar, importar).

Así nunca hay una página con fotos en línea que una versión permitida no sepa abrir más que con el aviso.
`unknownContent.ts` suma `photo` a sus nombres conocidos en el paso 1 (su prueba lo exige).

## Cómo se ve y se comporta

- **En el renglón.** La foto es un elemento en línea (`inline-block`), alineada abajo con el texto. Su ancho
  es `w` × el ancho del renglón (descontando el espacio entre fotos), o el natural con tope. El navegador
  hace el corte de renglón: lo que no entra, baja. Entre dos fotos seguidas hay un espacio fijo (el de las
  filas de hoy).
- **Cursor y teclado.** Lo que da ProseMirror con un nodo atómico: ← y → pasan a cada lado de la foto; ↑ y ↓
  por renglones visuales; Backspace y Supr borran la foto que tienen al lado, o unen el renglón con el de
  arriba si el cursor está al principio; Enter parte el renglón. Escribir al lado escribe al lado.
- **Elegir.** Clic en la foto: la elige (borde y tiradores, como hoy; segundo clic: abre el carrete, P.2).
  Shift+clic, Shift+flechas o arrastrar: selección de texto común, que incluye las fotos que abarca (se ven
  marcadas). Copiar, cortar, pegar y arrastrar la selección llevan fotos y texto juntos.
- **Tamaño.** Los tiradores cambian `w` (imantado a 1, 1/2, 1/3, 1/4). En la barra: los tamaños rápidos, que
  valen para **todas las fotos de la selección**.
- **Acomodar.** Con dos o más fotos en la selección: *Arrange in rows* reparte **esas** fotos, en su orden,
  con el algoritmo que ya existe (`arrangeRows` en `src/ui/imageRows.ts`: filas de la misma altura que
  llenan el ancho, como mucho 4 por fila). Con una sola foto elegida: las fotos seguidas de su renglón. Un
  solo deshacer. Para que cada fila quede entera, las fotos acomodadas tienen que estar seguidas en el mismo
  párrafo, sin texto en el medio; si la selección tiene texto entre fotos, el botón avisa (*Select images
  that are next to each other*).
- **Pegar y soltar.** Una foto pegada o soltada entra **donde está el cursor** (o donde se suelta, entre
  letras), en el renglón. Varias a la vez entran seguidas en ese renglón. Un adjunto sigue entrando como
  bloque debajo.
- **Subida, miniatura, nitidez, sin red, error de subida:** lo mismo que el bloque de hoy; el dibujo de la foto
  en línea usa la misma resolución de `sdmedia://` (`resolveFileUrl`), la misma miniatura y la misma mejora de
  nitidez (`sharpImages.ts` busca `img.bn-visual-media`: la foto en línea lleva esa clase).
- **Teléfono.** El mismo flujo; la opción de la cuenta "filas o apiladas" (P.5) pasa a ser: apiladas = cada
  foto al ancho completo en pantallas angostas.
- **Solo lectura.** Se ven igual; no se eligen para editar.

## Lo que hoy asume "foto = bloque", parte por parte

| Parte | Hoy | Con fotos en línea |
|---|---|---|
| Carrete (`carreteModel.ts`, `collectCarrete`) | Junta los bloques `image` en orden | Junta bloques `image` **y** fotos en línea, en el orden del documento |
| Archivos usados por la página (`media/usage.ts`) | Cualquier elemento con `url` | Sin cambios (por eso la propiedad se llama `url`) |
| Subida fallida (saca el bloque) | Borra el bloque `image` | Borra el nodo `photo` (transacción de fondo, `sd-background`) |
| Comentarios | Anclados al bloque de la foto | Anclados al bloque que contiene el renglón (el párrafo) |
| Hojas y PDF (`printView.ts`, `printPage.ts`) | Una fila de fotos es una unidad que no se parte | Un párrafo con fotos se puede partir **entre renglones visuales** (nunca por el medio de una foto): hay que medir los renglones del párrafo, como una fila de hoy |
| Buscar y reemplazar | Salta los bloques de foto | La foto corta el texto del renglón en dos tramos (una búsqueda no cruza una foto) |
| Colapsar | Esconde bloques | Sin cambios (la foto está adentro de su bloque) |
| Exportar HTML / copiar a otro programa | `<img>` con ancho en px | `<img>` en el párrafo, con ancho en px |
| Importar de Coda (`import/codaHtml.ts`) | Saca cada foto del renglón y la pone como bloque aparte | Deja la foto **donde estaba** en el renglón, con su ancho; el texto de al lado queda al lado |
| Tablas | Una foto no puede ir en una celda (va debajo) | Se evalúa aparte: el contenido de una celda es texto en línea, así que una foto en línea **podría** ir en la celda (pedido anterior de Lega: miniaturas en las celdas). No entra en la primera entrega |

## Lo que ya existe (bloques `image`)

- **No se convierte nada solo.** Abrir una página no la cambia. Un bloque `image` sigue viéndose y andando
  como hoy (también sus filas con `rowWidth`), para siempre si nadie lo toca.
- **Se convierte cuando la persona hace lo que hoy no puede:** Backspace al principio de una foto-bloque (la
  sube al renglón de arriba), escribir a su lado (→ después de la foto y una letra), pegar o soltar una foto
  estando elegida. En ese momento el bloque pasa a ser un párrafo con esa foto en línea (misma `url`, mismo
  nombre, `w` = su `rowWidth` o el equivalente de su `previewWidth`), en una sola transacción y un solo
  deshacer. Una foto-bloque **con leyenda** queda como bloque (convertirla perdería la leyenda): se avisa.
- **Convertir la página entera**, a pedido: una entrada en el menú de la página (*Make images inline*), para
  no depender del caso por caso. Con un solo deshacer.
- Lo nuevo (pegar, soltar, importar) entra siempre en línea, desde el paso 3 de la publicación.

## Entregas

Cada una con sus pruebas (incluida la de dos editores a la vez donde toca el documento), auditoría
independiente y su entrada en la ayuda cuando exista (P.13).

1. **El nodo y su dibujo.** `photo` en el esquema, en `unknownContent.ts` y en `usage.ts` (prueba); se ve con
   miniatura, nitidez y subida; cursor, flechas, Backspace, Enter, selección, copiar y pegar dentro de la app;
   el carrete lo incluye. Todavía no se crea solo (se prueba insertándolo por la API). Publicar y **subir
   `min_app_version`**.
2. **Crear y dar tamaño.** Pegar y soltar en el renglón; tiradores y tamaños rápidos sobre la selección;
   *Arrange in rows* sobre las fotos elegidas; conversión de un bloque `image` al editarlo y la del menú.
3. **Hojas, PDF y lo demás** de la tabla de arriba (comentarios, buscar, exportar, teléfono).
4. **Importar de Coda** con los renglones como estaban, y recién ahí la importación definitiva de los docs.
5. (Aparte) Fotos en las celdas de una tabla.

## Riesgos

- **Editar a la vez.** Una foto en línea es un elemento adentro del texto del párrafo. Los parches a
  y-prosemirror de v0.052 (`Doc_Colaboracion.md`) cuidan el texto de un bloque que dos personas editan; hay que
  probar con dos editores: uno escribe en el renglón mientras otro agrega, mueve o cambia el tamaño de una
  foto de ese renglón. Cambiar `w` es cambiar un atributo del nodo (no lo recrea); moverla es borrar e insertar.
- **El teclado del teléfono y la composición (tildes en la Mac)** al lado de un nodo atómico: probar en
  Safari de iPhone, que es donde ProseMirror tiene más casos raros con nodos en línea.
- **Hojas.** Partir un párrafo entre renglones visuales es nuevo para la paginación.
- **Dos formas de foto conviviendo** (bloque y en línea) mientras haya páginas sin convertir: toda función se
  prueba con las dos.
- **Tamaño del cambio.** Es el más grande que tuvo el editor: va por entregas, y la importación definitiva de
  los docs de Coda espera a la 4.

## Correcciones de la auditoría (mandan sobre lo de arriba)

Una auditoría independiente contrastó el diseño con el código de la app, BlockNote 0.55 e y-prosemirror, con
pruebas descartables de dos editores. Veredicto: **viable con cambios**. El nodo en línea funciona y el
resguardo de versiones viejas lo cubre (también adentro de un título, una lista y una celda; también una
pestaña vieja sin red que se reconecta). Cuatro cosas del diseño de arriba estaban mal y se corrigen así:

1. **Editar a la vez sí puede perder o duplicar texto, y una parte se arregla en la entrega 1.** Un párrafo
   con fotos se guarda como `texto, foto, texto` (elementos hermanos). Medido con 300 agendas al azar por caso:

   | Qué hacen dos personas a la vez en el mismo renglón | Resultado |
   |---|---|
   | Solo texto, sin fotos (control) | 0 pérdidas, 0 duplicados |
   | Escriben en los huecos de `[foto][foto]` | 7 con texto perdido, 15 con texto duplicado |
   | Escriben en los huecos de `"abc"[foto]"def"[foto]` | 5 con texto duplicado |
   | Uno escribe y el otro borra fotos | 77 con texto perdido, 11 duplicado |
   | Uno escribe y el otro cambia el ancho, o agrega fotos en los huecos | 0 pérdidas |

   - **Los huecos** (antes, entre y después de fotos, donde no hay texto: cada persona crea su propio tramo y
     después se juntan mal) se arreglan extendiendo el parche de `normalizePNodeContent` de y-prosemirror para
     que siempre haya un texto vacío en cada hueco. Probado: con el cambio, 0 de 300. **Cambia la forma
     guardada: va en la entrega 1, antes de subir `min_app_version`.**
   - **Borrar o mover una foto** mientras otro escribe a su derecha, **insertar una foto en medio de un texto**
     mientras otro escribe después, y **unir renglones o cambiar el tipo del bloque** mientras otro pega una
     foto ahí: se pierde lo del otro. Es de y-prosemirror 1.x (insertar o sacar un elemento parte o une los
     tramos de texto y recrea el de la derecha). Queda como límite conocido, en la tabla de
     `Doc_Colaboracion.md`. La regla de arriba pasa a ser: **editar a la vez un renglón con fotos no pierde más
     que lo que ya se pierde hoy al cambiar el tipo de un bloque mientras otro escribe en él, y está medido.**
   - Cambiar el ancho, agregar fotos al final o entre fotos y Enter no pierden nada.
2. **El clic, la barra y parte del teclado no vienen gratis.** El contenido en línea que arma BlockNote con
   contenido `none` no se puede elegir (`selectable: false`) y la barra de formato no aparece con una selección
   de solo fotos. Hace falta un **nodo propio de Tiptap** (`createInlineContentSpecFromTipTapNode`, elegible,
   con `update` para que cambiar el ancho no redibuje la imagen), manejo propio de **Enter, una letra y la barra
   espaciadora con una foto elegida** (hoy la letra queda bloqueada y Enter crea un bloque hijo con sangría), y
   un disparador propio para la barra. Alcanza el de core: el de React arma un portal por foto.
3. **El ancho.** `inline-block` con el corte del navegador no da filas parejas: el CSS de hoy necesita saber
   cuántas fotos hay en la fila y que la última absorba el redondeo; sin eso, tres fotos de 1/3 no entran o
   medio píxel manda la última abajo. Se decide antes de guardar nada: **`w` significa lo mismo que
   `rowWidth`** (así convertir no pierde nada y `arrangeRows` sirve igual), las filas se calculan con
   `groupRows` sobre las fotos seguidas de un párrafo, y una decoración le pone a cada foto cuántas hay en su
   fila, con 1 px de holgura. Razonado, no medido: necesita un prototipo en un navegador real.
4. **Convertir las fotos que ya existen, por tanda o por página, nunca de a una al editar.** Convertir una foto
   de una fila de tres deja foto, párrafo, foto (el párrafo corta la fila). Backspace al principio de un
   párrafo con una foto-bloque arriba hoy **borra esa foto con su leyenda** (es de BlockNote): hay que
   interceptarlo. Un bloque `image` no tiene "principio" donde poner el cursor. Y si el ancho saliera de una
   medida de la pantalla, dos dispositivos convertirían distinto (medido: la foto quedó tres veces): el cálculo
   tiene que ser determinista, con un ancho de referencia fijo, y llevar la alineación. Convertir a la vez que
   otro le agrega una leyenda o le reemplaza el archivo pierde eso del otro: se documenta. Deshacer la conversión
   devuelve el bloque con su leyenda y su `rowWidth`.

Además:

5. **Hojas y PDF van junto con "crear", no después.** Los selectores de impresión no ven una foto en línea (no
   espera las imágenes ni usa los originales), y la paginación solo parte una unidad más alta que la hoja: un
   párrafo de tres filas de fotos pasaría entero a la hoja siguiente. En la copia de impresión, el párrafo se
   parte en un bloque por renglón visual y se tratan como las filas de hoy.
6. **Todo lo que busca la foto por su bloque** hay que llevarlo a "bloque más posición": `sharpImages.ts`
   (resuelve el archivo por el ancestro `[data-content-type="image"][data-url]`), `PageEditor.tsx` (clic y
   carrete: dos fotos de un párrafo comparten id, y el primer clic en la segunda abriría el carrete en la
   primera), `attachments.ts`, `printView.ts`, `carreteModel.ts`.
7. **La subida.** Hoy se inserta un bloque vacío y después se le pone la dirección por id; un nodo en línea no
   tiene id. La foto se inserta cuando `media.add` terminó (ya está guardada en el dispositivo): sin marcador y
   sin "la subida fallida saca el nodo". Falta definir cómo se sigue la posición durante esa espera.
8. **Tablas: entra sola.** La celda acepta contenido en línea, y no se puede excluir por esquema. O se filtra
   al pegar y soltar, o el carrete y la impresión contemplan celdas desde la entrega 1.
9. **La importación monta un editor sin el resguardo** (`writePage` en `codaImport.ts`): una versión vieja
   que retoma una importación sobre una página con fotos en línea las borraría. Con contenido desconocido, no
   se toca la página. Va en la entrega 1.
10. **El paso 1 no lleva regla para leer `<img>` de afuera** (si la tuviera, pegar de una web crearía fotos en
    línea antes de subir `min_app_version`). La conversión de imágenes `data:` y `ensureLinks` solo miran
    bloques: revisar.
11. Una negrita o un link aplicados sobre un tramo con una foto no se guardan en la foto (no pierde nada).

**Casos que faltaban:** arrastrar una foto dentro del renglón (es borrar e insertar: la misma pérdida del punto
1); fotos en títulos, listas, citas y párrafos Script, pregunta o tarjeta de Drive; un workspace sin portero (el
camino de BlockNote sigue creando bloques); el tope de ancho con `w = 0`; el video en línea (marca de
reproducir, cuadro en el PDF); varias fotos pegadas juntas (orden, posición, un solo deshacer); copiar a otro
navegador (el lector de hoy descarta un `<img>` adentro de un `<p>`); Backspace que une renglones deja sueltos
los comentarios del bloque que desaparece; convertir por tanda borra ids de bloque y dispara la protección de
lo escondido de colapsar.

**Sin poder probar en la auditoría (necesita un navegador real):** el cursor junto a la foto, Shift+clic,
arrastrar, la composición con tildes, el iPhone, Backspace junto a una foto, el modelo de ancho y el corte al
imprimir.

**Entregas, corregidas (reemplazan la lista de arriba):**

0. **Prototipo en navegador** (Chrome, Safari, iPhone): cursor, Shift+clic, composición y el modelo de ancho.
1. **El nodo propio**, el parche de huecos, el teclado propio, el resguardo en la importación, los selectores
   por bloque más posición, el carrete; pruebas al azar con dos editores con 0 pérdidas en los huecos. Publicar
   y subir `min_app_version`.
2. **Crear, dar tamaño, acomodar las elegidas, hojas y PDF**, juntas.
3. **Convertir las fotos que ya existen**, por tanda o por página.
4. **Importar de Coda** con los renglones como estaban (`codaHtml.ts` ya marca dónde iba cada foto).

**La alternativa que se descarta:** mantener los bloques y sumarles selección de varias fotos y un "cursor de
fila" evita todo el punto 1 y no toca versiones viejas, pero no da texto en el mismo renglón que una foto,
que es el 28 % de los renglones con fotos del doc medido (249 de 890).

## Preguntas para Lega

1. **Leyenda:** la foto en línea no tiene leyenda propia. ¿Está bien (el texto de al lado o de abajo la
   reemplaza), o hace falta?
2. **Videos:** ¿también en línea, como las fotos? (Propuesta: sí.)
3. **Alto de las fotos de un renglón:** en Coda cada foto conserva su alto y quedan alineadas abajo. *Arrange in
   rows* las deja de la misma altura. ¿Al pegar varias juntas, se acomodan solas o entran con su tamaño y se
   acomodan a pedido? (Propuesta: entran a 1/3 del ancho cada una, y se acomodan a pedido.)
