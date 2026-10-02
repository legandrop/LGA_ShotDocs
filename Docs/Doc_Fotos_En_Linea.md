# Fotos en línea: la foto como un carácter del renglón (P.15)

Estado: **entregas 0 (prototipo), 1 (v0.076: el nodo, los huecos estables, lo que se ve y se toca), 2 (v0.078:
crear, dar tamaño, acomodar las elegidas, hojas y PDF), 3 (v0.078: convertir las fotos-bloque de una página, escondida por D-26) y 4
(v0.078: importar de Coda con los renglones) y 5 (v0.107: fotos en las celdas de una tabla) hechas**
(2026-10-02; ver "Cómo quedó" de cada una; las "Correcciones de la auditoría", más abajo,
mandan sobre el diseño de arriba, y la entrega 2 trae propuestas nuevas, marcadas). Pedido de Lega del
2026-10-01, con sus palabras: las
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

**Cómo quedó (entrega 2):** el renglón con fotos lleva además una marca propia (`lgaStableGaps`) que ninguna versión
anterior conoce, así que ninguna abre una página con fotos en línea ni con un renglón que las tuvo. Con eso el
paso 2 deja de ser previo: se publica la v0.078 (paso 1 y 3 juntos) y **después** se sube `min_app_version` a
0.078. Ver "Cómo quedó (entrega 2)".

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
| Tablas | Una foto no puede ir en una celda (va debajo) | **Hecho en la entrega 5:** la foto en línea va en la celda, como miniatura del alto de una fila (pedido anterior de Lega: miniaturas en las celdas). Ver "Cómo quedó (entrega 5)" |

## Lo que ya existe (bloques `image`)

- **No se convierte nada solo.** Abrir una página no la cambia. Un bloque `image` sigue viéndose y andando
  como hoy (también sus filas con `rowWidth`), para siempre si nadie lo toca.
- **Se convierte cuando la persona hace lo que hoy no puede:** Backspace al principio de una foto-bloque (la
  sube al renglón de arriba), escribir a su lado (→ después de la foto y una letra), pegar o soltar una foto
  estando elegida. En ese momento el bloque pasa a ser un párrafo con esa foto en línea (misma `url`, mismo
  nombre, `w` = su `rowWidth` o el equivalente de su `previewWidth`), en una sola transacción y un solo
  deshacer. Una foto-bloque **con leyenda** queda como bloque (convertirla perdería la leyenda): se avisa.
- **Convertir la página entera**, a pedido: hecho en la entrega 3 (`convertPhotos.ts`), con un solo deshacer, pero
  **sin entrada en la interfaz** (D-26: no va a haber fotos viejas para convertir).
- Lo nuevo (pegar, soltar, importar) entra siempre en línea, desde el paso 3 de la publicación.

## Entregas

Cada una con sus pruebas (incluida la de dos editores a la vez donde toca el documento), auditoría
independiente y su entrada en la ayuda (P.13; existe desde v0.082).

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
   al pegar y soltar, o el carrete y la impresión contemplan celdas desde la entrega 1. (Entregas 1 y 2: se filtró al
   crear y el carrete las contempló; la entrega 5 las deja entrar a propósito.)
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

## Prototipo (entrega 0)

Una página de prueba con el editor de la app más el nodo `photo`, sin sincronización ni login, medida en
Chromium con scripts (fuera de este repo). **Lega lo vio el 2026-10-01 y lo aprobó** ("me encanta el prototipo
de fotos en línea"). Conclusiones:

- **Andan tal cual** con un nodo atómico elegible: el cursor a cada lado de la foto, Backspace, Supr, Enter,
  pegar y cambiar el ancho.
- **Con la foto elegida hace falta manejo propio** de: una letra, la barra espaciadora, Enter y la tecla que
  abre una composición (el cursor pasa a la derecha de la foto y la tecla sigue su camino); Shift+flechas
  (pasar a una selección de texto); y Shift+clic.
- **Una selección de solo fotos no se ve** sin una decoración que las marque.
- **El modelo de ancho que sirve:** `w · (100% − (n−1)·espacio − 1px)`, con una decoración que le dice a cada
  foto cuántas hay en su fila (`n`). Medido: 0 filas rotas en 831 anchos × 5 densidades, y alturas parejas
  (diferencia ≤ 0,08 px), contra hasta 7,5 px de diferencia sin la decoración.
- Una fila que no llena el renglón, seguida de otra, necesita un margen que complete el renglón.
- **Falta probar Safari e iPhone.**

**A futuro (Lega, 2026-10-01, después de ver el prototipo):** que se puedan escribir varias líneas de texto a
los costados de una foto (el texto rodea la foto), no solo un renglón alineado abajo.

## Cómo quedó (entrega 1a: el nodo, el parche de huecos y los huecos estables)

La parte del modelo de datos de la entrega 1 (v0.074). La 1b es lo que se ve y se toca: la imagen resuelta
(`sdmedia://`, miniatura, nitidez), el CSS y la decoración de las filas, el teclado y el mouse propios, la
selección de varias, la barra, el carrete y los selectores por bloque más posición.

**El nodo** (`src/ui/inlinePhoto.ts`). Un nodo propio de Tiptap registrado en BlockNote con
`createInlineContentSpecFromTipTapNode`: `photo`, en línea, atómico, elegible y arrastrable, con `url`, `name` y
`w` (la parte del ancho del renglón, 0 a 1, como `rowWidth`; 0 = ancho natural). En el HTML del portapapeles
va como `<span data-inline-content-type="photo" data-url data-name data-w>`, y solo eso se lee al pegar: sin
regla para un `<img>` de afuera. La vista es mínima (`<span class="sd-photo" contenteditable="false"><img
class="bn-visual-media" draggable="false"></span>`): cambiar el ancho no vuelve a cargar la imagen, y la
dirección va tal cual (`showSource` es donde la 1b engancha `resolveFileUrl`, la miniatura y la nitidez). **Nada
en la app crea una foto en línea:** solo se inserta por la API del editor (las pruebas). `@tiptap/core`, que ya
venía con BlockNote, pasó a ser una dependencia declarada.

**El resguardo.** `unknownContent.ts` conoce `photo` (la versión anterior no, y por eso no abre una página que
la tenga: probado adentro de un párrafo, un título, un ítem de lista y una celda de tabla; si la montara, las
fotos se borrarían del documento compartido y quedaría el texto). `media/usage.ts` ya cuenta su archivo como
usado. La importación de Coda (`writePage`) ahora revisa lo mismo antes de montar su editor: una página con
algo que esta versión no conoce no se toca, queda anotada y sin terminar (se escribe al seguir la importación
con la app al día).

**El parche de los huecos** (`patches/y-prosemirror+1.3.7.patch`, `normalizePNodeContent`; detalle en
`Doc_Colaboracion.md`, "El texto de los huecos"). Un renglón con fotos se guarda con un texto, aunque esté
vacío, a cada lado de cada foto: `"" [foto] "" [foto] ""`. Decisiones:

- **Solo alrededor de `photo`.** El nodo lleva una marca en su esquema (`lgaGapText`) y el parche mira esa
  marca. Ningún otro elemento cambia: un salto de línea (Shift+Enter) se guarda como siempre, también al lado
  de una foto (`[salto] "" [foto] ""`). Probado: los párrafos con saltos (uno, varios seguidos, al principio y
  al final) se guardan igual que con la versión anterior, agregarles una foto no vuelve a crear su texto ni
  sus saltos, y abrir una página (con saltos, con fotos, o con las dos cosas) no escribe nada.
- **Versiones mezcladas.** La versión anterior nunca edita un renglón con fotos (no abre la página), y todo lo
  demás las dos lo escriben igual: las mismas 300 agendas con saltos de línea dan lo mismo con dos editores
  de esta versión, dos de la anterior, o uno de cada una. Las dos formas de guardar un renglón con fotos (con
  y sin el texto de los huecos) no llegan a mezclarse; si se mezclaran no habría un ida y vuelta de arreglos
  (con los huecos estables, tampoco pérdidas en 300 agendas; antes, 173). La marca y el parche van juntos
  (`vite.config.ts` no construye sin esa parte del parche). Un renglón al que le borraron todas las fotos sí lo
  abre la versión anterior y lo muestra bien, pero si otro escribe a la vez en ese renglón **se pierde texto**
  (con dos versiones anteriores, el renglón queda dos veces; medido en `Doc_Colaboracion.md`, "Versiones
  viejas"). No pasa mientras nada cree fotos; la entrega 2 lo tiene que resolver antes de crearlas.
- **Sacarlo es una línea** (`extendNodeSchema` en `inlinePhoto.ts`), mientras nada cree fotos en línea.

**Los huecos estables** (el resto del parche; detalle en `Doc_Colaboracion.md`, "Huecos estables"). En un
renglón con fotos ningún texto de Yjs se borra ni se vuelve a crear: borrar una foto saca solo la foto y deja
los textos de los dos lados seguidos (`"abc" "def"`), que el editor lee como un solo texto; cada cambio va al
texto que tiene esa posición (lo que se escribe en el borde entre dos textos, al de la izquierda). Los textos de
un renglón con fotos llevan la marca `lgaGapText` como atributo, para que el renglón siga así cuando se le borra
la última foto. Un párrafo sin fotos va por el código de siempre.

**Lo medido** (dos editores sobre dos documentos de Yjs que se cruzan los cambios en cualquier orden; 300
agendas al azar por caso, con semilla; cada número es la cantidad de agendas con algo perdido o duplicado; son
agendas hechas para chocar: todos los pasos caen en el mismo renglón). "Desordenada" es una marca escrita que
quedó con todas sus letras, desordenadas (`7}{A` por `{A7}`, ver `Doc_Colaboracion.md`): ninguna letra se
perdió.

| Qué hacen dos personas a la vez en el mismo renglón | Con los huecos estables (lo de esta entrega) | Solo el texto de los huecos | Sin él |
|---|---|---|---|
| Solo texto, sin fotos (control) | 0 | 0 | 0 |
| Escriben en los huecos de `[foto][foto]` | **0** | 0 | 21 perdido, 52 duplicado |
| Escriben en los huecos de `"abc"[foto]"def"[foto]` | **0** | 0 | 20 duplicado |
| Uno escribe y el otro cambia el ancho o agrega fotos en los huecos | 0 | 0 | 0 |
| Los dos escriben, cambian anchos y agregan fotos en los huecos | **0** | 0 | 2 duplicado |
| Uno escribe justo a la derecha de una foto y el otro borra fotos (`[foto][foto][foto]`) | **0** | 205 perdido | 40 perdido, 3 duplicado |
| Uno escribe pegado a una foto y el otro borra fotos (`"abc"[foto]"def"[foto]`) | **0** | 206 perdido | 167 perdido |
| Uno escribe a la derecha de una foto y el otro mueve fotos (fila de tres) | **0** | 74 desordenada | 87 perdido, 1 duplicado |
| Uno escribe pegado a una foto y el otro mueve fotos (texto y fotos) | **0** | 29 desordenada | 166 perdido, 5 duplicado; una foto perdida en 3 y duplicada en 3 |
| Uno escribe pegado a una foto y el otro aprieta Enter pegado a una foto | **41 desordenada, 0 perdido** | 172 (166 perdido) | 139 perdido |
| Uno escribe al final y el otro pone fotos en el medio del texto | 0 (lo escrito queda antes de la foto) | 0 | 0 |
| Los dos borran fotos de un renglón con texto entre ellas | **0** | texto que ya estaba: perdido en 53, duplicado en 139 | igual |
| Uno une el renglón con el de arriba o le cambia el tipo y el otro pega fotos en él | las fotos pegadas se pierden (227 y 261) | igual | igual |
| Uno une el renglón con el de arriba y el otro escribe pegado a sus fotos | 231 perdido | igual | igual |
| De todo un poco, los dos | **7 desordenada, 0 perdido**; 6 y 13 duplicado (los dos con Enter); fotos: 0 perdidas, **39 duplicadas** | 103 (98 perdido), 19 duplicado; fotos: 25 perdidas, 25 duplicadas | 101 perdido, 18 duplicado; fotos: 19 y 33 |
| Saltos de línea, esta versión, la anterior y mezcladas | 2 perdido y 1 duplicado; 4 y 12 | igual | — |

**Lo que encontró la medición, y cómo se resolvió.** Solo, el texto de los huecos arreglaba lo que se buscaba
(escribir los dos en el mismo hueco: de 73 agendas con problemas a 0) pero **empeoraba borrar una foto o
apretar Enter mientras el otro escribe en un hueco vacío pegado a ella** (de 40 a 205 en la fila de tres
fotos): al borrar la foto, y-prosemirror unía los dos textos de los costados y borraba uno, con lo que el otro
escribió adentro. Los huecos estables lo resuelven: borrar una foto ya no borra ningún texto. La vara era
"borrar" en 40 o menos y Enter no peor que sin huecos (139); dio 0 y 41 (sin ninguna letra perdida). Lo que
queda es de la estructura (unir y cambiar el tipo vuelven a crear el bloque, igual que antes) y de copiar: dos
Enter a la vez, o mover y Enter a la vez, dejan texto o fotos dos veces (39 fotos duplicadas en "de todo un
poco", contra 25 antes; ninguna perdida, contra 25). Se prefiere duplicar a perder. Sacar todo esto sigue
siendo una línea (`extendNodeSchema` en `inlinePhoto.ts`) mientras nada cree fotos.

**Deshacer.** Insertar, borrar y cambiar el ancho de una foto se deshacen de un paso, y los dos editores
terminan iguales.

**Pruebas.** `src/ui/inlinePhoto.test.ts` (el nodo, cómo se guarda, abrir no escribe, la versión anterior,
deshacer), `collabPhotos.test.ts` (los casos que tienen que dar 0), `collabPhotosLimits.test.ts` (los límites,
con su número), `collabPhotosNoGaps.test.ts` (lo mismo sin el texto de los huecos y las dos formas mezcladas),
`stableGaps.test.ts` (los huecos estables con un editor: ida y vuelta, el borde, 400 pasos al azar, y las dos
copias de la librería escribiendo lo mismo),
`collabPhotosVersions.test.ts` (saltos de línea con las dos versiones) y la de `writePage` en
`src/import/codaImport.test.ts`. Las ayudas están en `src/ui/photoHarness.ts`.

**Anotado, sin hacer:**

- Dos personas que escriben a la vez en el hueco entre dos saltos de línea (o después del último) pierden o
  duplican texto, por lo mismo que los huecos de las fotos: 2 perdido y 1 duplicado de 300 con saltos en el
  medio, 4 y 12 con saltos al principio y al final. Ya pasaba antes de esta versión; arreglarlo cambia cómo se
  guardan párrafos que las versiones de hoy sí abren, así que necesita su propio paso (una versión que
  entienda las dos formas, subir `min_app_version`, y recién después escribir la nueva).
- El texto de un bloque que usa la importación para ubicar los comentarios de Coda (`pageBlocks`) junta los
  textos de un párrafo con un espacio: con fotos en línea, los textos vacíos de los huecos suman espacios, y
  los textos seguidos que deja borrar una foto quedan separados por un espacio (`"abc" "def"` → `abc def`). Lo
  mismo el texto plano de "exportar lo no sincronizado" (`unsynced.ts`, un renglón por texto). La búsqueda
  (`search/extract.ts`) ya los junta bien. Se revisa en la entrega 4 (importar en línea).
- El `README.md` dice que el parche de y-prosemirror son dos arreglos chicos; ahora tiene una parte más. No se
  tocó (nada visible para el usuario cambió).

## Preguntas para Lega

Lega vio el prototipo el 2026-10-01 y lo aprobó ("me encanta el prototipo de fotos en línea"). Pidió, a futuro,
texto de varias líneas a los costados de una foto (ver "Prototipo (entrega 0)"). Siguen abiertas:

1. **Leyenda:** la foto en línea no tiene leyenda propia. ¿Está bien (el texto de al lado o de abajo la
   reemplaza), o hace falta?
2. **Videos:** ¿también en línea, como las fotos? (Propuesta: sí.)
3. **Alto de las fotos de un renglón:** en Coda cada foto conserva su alto y quedan alineadas abajo. *Arrange in
   rows* las deja de la misma altura. ¿Al pegar varias juntas, se acomodan solas o entran con su tamaño y se
   acomodan a pedido? (Propuesta: entran a 1/3 del ancho cada una, y se acomodan a pedido.)


## Cómo quedó (entrega 1b: lo que se ve y se toca)

Lo que se ve y se toca de la foto en línea, sobre la 1a. Nada en la app crea fotos en línea todavía: se probaron
puestas por la API del editor, con la página real de la app (el editor, sus extensiones, su CSS, el carrete, buscar,
colapsar, comentarios e imprimir) en Chromium sin ventana, con scripts fuera de este repo.

**Archivo por archivo:**

- `src/ui/inlinePhoto.ts`: la imagen pasa por `resolveFileUrl` del editor, como el bloque `image` (miniatura,
  cuadro de video con la marca de reproducir, marcador de subida, sin red o de otro proyecto); una respuesta
  vieja no pisa la nueva; `--ph-w` con el ancho.
- `src/ui/inlinePhotoEditor.ts` (lo suma `PageEditor.tsx`: BlockNote no registra las extensiones de un contenido
  en línea): las filas con `groupRows` (la decoración `sd-photo-sized`, `--row-n`, `sd-photo-row-first`,
  `sd-photo-row-break` con `--row-rest`), la marca `sd-photo-in-range` de las fotos dentro de una selección de
  texto, y el teclado y el mouse antes de `nodeSelectionKeyboard`.
- `src/styles.css` ("Fotos en línea"): el modelo de ancho del prototipo, `w = 0`, listas, el contorno de la
  elegida, la marca de la selección y "apiladas" en el teléfono.
- `src/ui/carreteModel.ts`, `carreteClick.ts` y `PageEditor.tsx`: cada foto tiene una clave (el id del bloque
  `image`, o `<bloque>#<n>` para la n-ésima foto en línea): el carrete junta las dos clases en el orden del
  documento (listas, hijos y celdas), y el clic, el segundo clic, el dedo y `ensureLinks` usan la clave.
- `sharpImages.ts`, `attachments.ts`, `printPage.ts`, `printView.ts`: encuentran la foto en línea por
  `.sd-photo[data-url] > img` (nunca el `<img>` separador de ProseMirror).

**Lo medido en Chromium:**

| Caso | Resultado |
|---|---|
| Anchos: 831 anchos (320 a 1150 px) × 5 densidades (1 a 3), filas de 2, 3, 4, 8, siete acomodadas, una fila que no llena seguida de otra, y una lista | **0 renglones distintos de su fila**; alturas de una fila: diferencia ≤ **0,08 px** (lo mismo que el prototipo) |
| `w = 0` | Ancho natural con tope en el renglón (300 px; la de 2400 px queda en el ancho del renglón) |
| Texto al lado de una foto | El texto queda abajo, 2 px por debajo del borde de la foto (su margen) |
| Lista con fotos | La viñeta y el número quedan en el renglón del texto |
| Teléfono, "apiladas" | Cada foto con ancho propio ocupa el renglón (334 px de 335); "en fila", las filas como en la computadora |
| Clic en una foto | La elige (contorno de 2 px), sin abrir el carrete; el segundo clic lo abre **en esa foto** (las 15 fotos de la página de prueba, en orden); doble clic y la barra espaciadora, también |
| Carrete | Junta bloques y fotos en línea en el orden de la página: bloque, fotos del texto, hijo, viñeta, número, tarea, bloque, celdas, cita, fotos del Drive (`sdmedia://`, con la miniatura del dispositivo) |
| Una letra, Shift+letra, Enter, con la foto elegida | El cursor pasa a la derecha de la foto y la tecla sigue: `[F1]a`; Enter parte el renglón ahí (sin bloque hijo); con la foto sola, Enter abre un renglón debajo |
| AltGr (`@` con Ctrl+Alt+Q en Windows), con la foto elegida | Escribe `@` después de la foto |
| Composición (tilde muerta e IME) con la foto elegida, entre dos fotos, al principio y al final | Lo compuesto queda después de la foto; pantalla y documento iguales; Ctrl+Z vuelve todo |
| Shift+flechas | Selección de texto; la marca muestra las fotos que abarca (F3, F3 y F4, las tres) |
| Shift+clic (desde un cursor, desde una foto elegida, para atrás, a otro párrafo) | Selección de texto que abarca las fotos; no abre el carrete |
| Arrastrar para elegir texto que pasa por fotos | Las abarca y las marca |
| Arrastrar una foto dentro del renglón, al final del texto y a otro renglón | Se mueve; un Ctrl+Z la devuelve |
| Deshacer y rehacer (escribir, borrar una foto, Enter, Backspace, cambiar el ancho) | Cada paso con un Ctrl+Z; Ctrl+Y y Ctrl+Shift+Z rehacen; las imágenes siguen cargadas |
| Copiar y pegar dentro de la app (tres fotos, texto con una foto, cortar una foto) | Llegan con su ancho y sus filas |
| Pegar el HTML de otro programa con un `<img>` | Entra el texto, sin foto (nada crea fotos en línea todavía) |
| Buscar y reemplazar | `gato` encuentra las 3; una búsqueda no cruza una foto (`antes gato`: nada); reemplazar todos deja las 13 fotos |
| Colapsar | El párrafo con fotos se esconde con su título |
| Comentar (Ctrl+Alt+M con la foto elegida) | Comenta el bloque; la foto sigue elegida y el documento no cambia |
| Imprimir (A4) | Espera las fotos en línea (13 de 13 cargadas), usa los originales del dispositivo (1200 × 800, no la miniatura) y la marca de la selección no va |
| Solo lectura | Un clic abre el carrete en esa foto; las teclas no cambian nada |

**Corregido en esta pasada (con su prueba):** en solo lectura, Shift+clic en una foto en línea no abría el carrete
(`shiftSelects` en `carreteClick.ts`: Shift solo elige texto si se puede editar); Ctrl+Alt+M (comentar) o
Ctrl+Alt+1 (título) con la foto elegida movían el cursor fuera de ella como si fueran AltGr (`typesCharacter`
distingue la letra de la tecla misma).

**Límites que quedan:**

- Una composición que empieza **sin** la tecla de antes (solo `compositionstart`, algunos teclados de teléfono)
  con una foto elegida entre dos fotos duplica el primer carácter (`´á`, `ｎ日本`). Igual que en el prototipo;
  con la tecla de antes (tilde muerta de la Mac, IME de Windows) anda. Probar en Safari del iPhone.
- Con una foto en línea elegida aparece la barra de formato de texto (negrita, tipo de bloque…): no hace nada
  sobre la foto. Con una selección de solo fotos no aparece barra. La barra propia (tamaños, *Arrange in rows*)
  es de la entrega 2.
- Copiar fotos a otro programa deja en el texto plano `![nombre](dirección)` (con `sdmedia://` para las del
  Drive): es la exportación de la entrega 3.
- El panel de comentarios muestra cada foto en línea como `[Image]` en el texto del bloque (decidido por Lega, D-22).
- Un párrafo con fotos se imprime como una sola unidad (partirlo entre renglones es la entrega 2); la conversión
  de imágenes `data:` sigue mirando solo bloques.
- Sin probar: Safari, iPhone, dos editores a la vez en un navegador (los cubren las pruebas de Yjs de la 1a).
- La auditoría de v0.076 dejó tres cosas para antes de la entrega 2 y algunas para decidir (roadmap P.15):
  emojis y dictado con una foto elegida la reemplazan, arrastrar para elegir y soltar sobre una foto, la barra
  de texto encima de la foto vecina; pegar HTML con una foto (`data-inline-content-type="photo"`) ya crea una.

## Cómo quedó (entrega 2: crear, dar tamaño, acomodar las elegidas, hojas y PDF)

v0.078. Es la primera versión que **crea** fotos en línea. Antes de crear se cerró lo que dejaron las auditorías de
v0.076 (fase A); después, lo de crear (fase B). Todo medido con pruebas en el repo y en Chromium sin ventana, con la
página real de la app sobre el servidor en memoria (scripts fuera de este repo).

### Antes de crear (fase A)

**Versiones mezcladas: la marca del renglón. PROPUESTA para la auditoría; cambia la forma guardada.** Un renglón
al que le borraban todas las fotos quedaba con sus textos seguidos y sin nada que una versión anterior desconociera:
esas versiones lo abrían y, al editarlo, juntaban los textos en uno y borraban los otros, con lo que otro hubiera
escrito en ellos. Medido con la librería **publicada** de verdad (`collabPhotosVersions.published.test.ts`, 7
posiciones por lado, sin verse): uno viejo y uno nuevo, **28 de 49 perdían**; dos viejos, **49 de 49 dejaban el
renglón dos veces**. Subir `min_app_version` no alcanzaba: una versión vieja sin permiso para subir sigue bajando y
editando en el dispositivo, y al actualizarse sube su cola (para Yjs el orden no cambia nada: las mismas pérdidas).

Ahora el renglón lleva, primero, un elemento vacío `lgaStableGaps` que el parche pone con la primera foto, nunca
borra (tampoco el deshacer: ver "Lo que dejaron las auditorías") y nunca dibuja; las versiones de la v0.052 a la v0.076 no lo conocen y no abren la página. Con la marca:
**0 de 49** en todas las combinaciones (viejo y nuevo, dos viejos, dos nuevos, renglón con fotos), y un dispositivo
viejo sin red que editó el renglón *antes* de que tuviera fotos y sube su cola después: **0 letras perdidas en 104
combinaciones** (en 9, lo que el viejo borró vuelve, porque el nuevo partió ese texto con una foto). Un párrafo sin
fotos se guarda igual que antes, byte a byte, contra la librería publicada (40 agendas de 40 pasos). La otra salida
medida, juntar los textos al borrar la última foto, perdía 4 de 7 entre dos versiones nuevas y duplicaba si los dos
borraban a la vez: descartada. Detalle en `Doc_Colaboracion.md`, "Versiones viejas".

**La prueba con la librería publicada** queda en el repo: `src/test/publishedYProsemirror.ts` la arma sin red ni git
(copia `node_modules/y-prosemirror` a `node_modules/.cache/`, le saca el parche de hoy, le pone el de la v0.052,
`src/test/fixtures/y-prosemirror-v0.052.patch`, y comprueba las huellas), y el proyecto `published` de
`vite.config.ts` la pone en lugar de `y-prosemirror`, también adentro de BlockNote.

**Lo que dejó la auditoría de la 1b** (`inlinePhotoEditor.ts`, con su prueba cada uno):

- Texto que entra sin tecla con una foto elegida (emojis, dictado): va después de la foto (`handleTextInput`).
- Arrastrar para elegir y soltar sobre una foto: la elección termina en el borde de la foto más cercano al puntero
  (mitad izquierda, antes; derecha, después), al leer la selección y al soltar. Mientras se arrastra, la marca puede
  quedarse atrás un instante: corregirla en el medio del arrastre le corría el ancla al navegador (medido).
- La barra de texto con una foto elegida: ya no se abre (tapaba la foto vecina y se quedaba con su clic); va la barra
  propia.

### Crear (`inlinePhotoCreate.ts`)

- **Pegar** (archivos), **soltar** y **"/Image"** (abre el selector de archivos del sistema, con varios). Las fotos y
  los videos entran en el renglón, donde está el cursor o entre las letras donde se soltaron; los adjuntos siguen
  entrando como tarjeta, un bloque debajo (`fileDrop.ts`). Sin portero, solo imágenes (a Supabase), también en el
  renglón.
- **Dónde, si ahí no pueden ir:** con una foto-bloque o un bloque elegido entero, con el cursor en una celda de tabla
  o en código, o soltando sobre una foto-bloque o una tarjeta, van en un renglón nuevo al lado del bloque.
- **Al pegar** con texto elegido, lo reemplazan (como al pegar texto); con una foto en línea elegida, van después de
  ella (como una letra).
- **El ancho:** una sola, su ancho natural (como entraba un bloque); varias a la vez, 1/3 cada una. Es la propuesta
  del diseño mientras Lega no responda ("Preguntas para Lega", 3): una constante (`NEW_PHOTO_WIDTH`).
- **Cuándo:** la foto entra cuando el archivo ya está guardado en el dispositivo, con su dirección definitiva: no hay
  marcador en el documento ni "la subida fallida saca la foto". Mientras tanto, una marca de espera (una decoración)
  en el lugar, que se sigue con el mapeo de ProseMirror y, para lo que llega de otro dispositivo o un deshacer (que
  reescriben todo el documento del editor), con una posición de Yjs. Todas juntas, en orden, en un solo cambio: un
  Ctrl+Z las saca. Un archivo que no se pudo guardar avisa y no corta los demás.
- Las fotos HEIC pasan a `.jpg` en el nombre cuando se convierten, también las en línea (`heicNames.ts`).

### La barra de la foto (`MediaBar.tsx`, `PhotoToolbar.tsx`) y el tamaño (`inlinePhotoSize.ts`)

Lega probó la entrega 2 y la rechazó como estaba: la foto en línea tenía menos que la foto-bloque. Decidió la
**D-24** (`Doc_Decisiones.md`): paridad completa, sin leyenda, y la misma barra para las dos, por sectores.

- **La barra, igual para la foto-bloque y la en línea:** [ver, bajar] | [1/1, 1/2, 1/3, 1/4 y *Arrange in rows*] |
  [alinear a la izquierda, al centro, a la derecha] | [comentar] | [*Replace image*, *Rename image*, *Delete image*].
  Un separador fino entre sectores. Todos los botones miden lo mismo, **30 × 30 px, sin relleno** (medido en
  Chromium: los 17 de cada barra; antes los de tamaño medían 49,6 × 30, por el relleno de un botón de texto). Los
  tooltips son `data-tip`: el nombre (un ícono no lo dice) y, si lo hay, el atajo (ver: Espacio; comentar: ⌘⌥M o
  Ctrl+Alt+M; borrar: Supr o Retroceso) o lo que agrega (los tamaños, "las fotos seguidas llenan una fila"; con varias
  elegidas, "para todas las fotos elegidas"). Con un video, los botones dicen *video*; con un adjunto, *file*. En el
  teléfono la barra pasa a dos renglones, adentro de la pantalla.
- **Sin leyenda** (D-24): no hay *Edit caption* en ninguna de las dos. Una leyenda que ya existe en una foto-bloque se
  sigue mostrando: no se borra ni se esconde; solo no hay botón para crearla. Tampoco va *Toggle preview* (no está en
  la barra que pidió Lega; una foto-bloque que ya la tiene apagada se sigue viendo así). Aprobado por Lega (D-24).
- **Ver** abre el carrete en esa foto; **bajar** baja el original (del Drive) o la dirección, con su nombre.
- **Tamaños** para todas las fotos elegidas, en un solo cambio (un atributo del nodo: editar a la vez no pierde nada,
  medido en la entrega 1).
- ***Arrange in rows*** acomoda **solo las elegidas** (pedido de Lega; la auditoría de la entrega 2 sacó la propuesta
  de sumar la fila de antes): con una sola elegida, las seguidas de su renglón. Si hay texto entre las elegidas, el
  botón queda apagado y dice *Select images that are next to each other, with no text between them*. Para que queden
  en filas propias dentro de una tanda más larga, la primera elegida y la foto que sigue a la última llevan una marca
  nueva del nodo, `rowStart` ("empieza fila": las filas se cortan ahí; solo `true` o nada, así una foto sin la marca
  se guarda igual que antes); ningún ancho de las otras cambia. La última fila no se estira: queda con la altura que le
  da `arrangeRows` (como mucho la de la fila anterior o 2,2 veces el alto ideal), como en la foto-bloque. Dos
  verticales elegidas quedaban de 533 px de alto; ahora, 344 px en un renglón de 720.
- **Alinear** (izquierda, centro, derecha): en la foto en línea alinea su renglón (la alineación del bloque, la misma
  propiedad que el texto); con varias elegidas, los bloques de todas. Marca la que tiene.
- **Comentar** comenta el bloque, como hoy.
- **Reemplazar** abre el selector de archivos (uno); el archivo se guarda (al Drive, como al pegar) y la foto pasa a
  ser ese archivo, en su lugar y con su ancho. **Renombrar** abre un campo, como el de BlockNote; no aparece en un
  archivo del Drive (la descarga y la papelera usan el nombre del archivo), igual que en la foto-bloque. **Borrar**
  saca la foto (con varias elegidas, *Delete images*, todas). Con varias elegidas no van ver, bajar, reemplazar ni
  renombrar.
- **Los tiradores** (`inlinePhoto.ts`): dos barritas a los costados, como los de la foto-bloque, con la foto elegida
  o al pasar el mouse. Arrastrar cambia el ancho en vivo y al soltar se guarda, imantado a 1, 1/2, 1/3 y 1/4 si queda a
  menos de 2 %. Como la foto-bloque: solo con el botón principal y si se movió al menos 3 px; un solo deshacer.
- **Dónde va:** arriba de la foto más alta de su renglón, alineada a la izquierda de las fotos, a 10 px: la misma
  ubicación que la barra de la foto-bloque (arriba del bloque, a 10 px). Abajo, si arriba no entra. No se muestra
  mientras se aprieta el mouse. Como la de la foto-bloque, puede quedar sobre el renglón de arriba (la auditoría lo
  marcó, O5): un clic pensado para ese renglón puede caer en un botón. No se movió a otro lado porque Lega pidió la
  misma ubicación que la de la foto-bloque; ningún botón borra sin poder deshacerse.
- La barra de texto de BlockNote no se abre con fotos elegidas (su contenedor vacío aparecía un instante al soltar el
  clic y se quedaba con el clic en la foto vecina: medido). Con texto y fotos elegidos, la de texto suma los tamaños y
  *Arrange in rows*.
- **Una fila llena después de un texto** del mismo renglón empieza en un renglón nuevo (una marca que no es parte del
  documento, `sd-photo-row-start`, puesta después del cursor para que lo que se escribe al final del texto quede en
  el texto). Una fila que no llena sigue al lado del texto, como una palabra: si no entra entera, se parte en dos
  renglones (la auditoría lo anotó, O8; es "fluir como palabras", lo pedido).

### Paridad con la foto-bloque

Inventario de lo que hace hoy la foto-bloque (el código de `src/ui/`: `MediaBar.tsx`, `MediaToolbarButtons.tsx`,
`imageRowsEditor.ts`, `PageEditor.tsx`, `carreteClick.ts`, `heicNames.ts`, `printView.ts`, `pagination.ts`;
`Doc_Imagenes.md`, `Doc_Carrete.md`, `Doc_Adjuntos.md`; y la app en Chromium) contra la foto en línea.

| La foto-bloque hoy | En línea | Dónde, o por qué no |
|---|---|---|
| Primer clic elige (borde), segundo clic o doble clic abre el carrete | hecho | 1b (`carreteClick.ts`) |
| Barra espaciadora con la foto elegida abre el carrete | hecho | 1b; con varias elegidas, en la primera |
| En solo lectura, un clic abre el carrete | hecho | 1b |
| En el teléfono, un toque abre; tocar la elegida muestra la barra | hecho | 1b y auditoría 2b |
| Tiradores a los costados (elegida o al pasar el mouse), imantan a 1/1, 1/2, 1/3, 1/4, 3 px de umbral | hecho | `inlinePhoto.ts` |
| Barra: ver | hecho | `MediaBar.tsx` |
| Barra: bajar el original (Drive) o la dirección | hecho | `MediaBar.tsx` |
| Barra: tamaños 1/1, 1/2, 1/3, 1/4 (marca el actual) | hecho | para todas las elegidas |
| Barra: *Arrange in rows* | hecho | de las elegidas (en la foto-bloque, la tanda) |
| Barra: alinear izquierda, centro, derecha | hecho | alinea el renglón |
| Barra: comentar (y el atajo) | hecho | |
| Barra: *Replace image* | hecho | selector de archivos (en las dos; antes la foto-bloque abría el panel de BlockNote, con *Embed*) |
| Barra: *Rename image* (no en un archivo del Drive) | hecho | la misma regla |
| Barra: *Delete image* | hecho | |
| Barra: *Edit caption* | — | se sacó de las dos (D-24); la leyenda que existe se sigue viendo |
| Barra: *Toggle preview* (no en un archivo del Drive) | — | se sacó de las dos (D-24, aprobado por Lega) |
| Fotos en fila con su ancho; "apiladas" en el teléfono | hecho | 1b |
| Flechas entre las fotos de una fila; Enter después de la fila | hecho | como letras (1b): ← → de a una, Enter parte el renglón |
| Borrar con Supr o Retroceso | hecho | 1b |
| Arrastrar para mover | hecho | 1b (arrastrar la foto) |
| Copiar y pegar dentro de la app (con su ancho) | hecho | 1b; con la marca de fila |
| Carrete: todas las fotos de la página, en orden | hecho | 1b |
| Miniatura, nitidez, marcador de subida, sin red, de otro proyecto | hecho | 1b (`resolveFileUrl`) |
| Videos: cuadro con la marca de reproducir; el carrete los reproduce | hecho | 1b; los botones dicen *video* |
| Adjuntos (PDF, zip): tarjeta, *Open* | — | siguen siendo un bloque (tarjeta), como dice el diseño ("adjuntos como hoy") |
| HEIC: el nombre pasa a `.jpg` al convertirse | hecho | `heicNames.ts` |
| Subida fallida: saca la foto | — | no hace falta: la foto entra cuando el archivo ya está guardado en el dispositivo; si se sale de la página antes, avisa |
| Imprimir y PDF: una fila no se corta; originales del dispositivo | hecho | 1b y entrega 2 |
| Comentarios anclados al bloque | hecho | 1b (el párrafo) |
| Buscar y reemplazar la saltea | hecho | 1b |
| *Rename* y *Toggle preview* escondidos en un archivo del Drive | hecho | *Rename*, igual; *Toggle preview* ya no está |

### Lo que dejaron las auditorías de la entrega 2

- **Datos, B1:** deshacer la primera foto sacaba la marca del renglón (`Doc_Colaboracion.md`, "Versiones viejas").
  Arreglado en el parche (el filtro del deshacer), con su prueba (`stableGapsUndo.test.ts`: 70 casos, 0 renglones sin
  marca).
- **Navegador, B1:** con varias fotos elegidas, una letra, la barra espaciadora o Enter las borraban. Ahora, como con
  una: la tecla sigue después de la última, Espacio abre el carrete en la primera, Supr y Retroceso borran.
- **O1:** "Copy image" de una web (el archivo y un HTML que es solo esa imagen) entraba como foto-bloque con la
  dirección de la web; ahora es un archivo: entra en el renglón y va al Drive (`fileDrop.ts`).
- **O2 y O3:** *Arrange in rows* acomoda solo las elegidas, con `rowStart`, y no estira la última fila (arriba).
- **O4:** los tiradores (arriba). **O5:** la ubicación de la barra (arriba). **O6:** *Download video* y los demás
  nombres. **O7:** si se sale de la página mientras un archivo grande se guarda, avisa (*The page closed before…*):
  nunca un archivo guardado que no aparece sin aviso. **O8:** documentado (arriba).
- **Datos, observaciones:** deshacer una foto puesta en el medio de un texto mientras otro escribe a la derecha, y
  poner una foto en el medio de un texto mientras otro borra o aprieta Enter a la derecha: en la tabla de
  `Doc_Colaboracion.md`. El lugar de las fotos mientras se guardan, si el otro aprieta Enter antes o une o borra el
  renglón, puede quedar al final de la parte izquierda o en un renglón nuevo después del bloque siguiente (nunca se
  pierde nada). Pegar HTML de la app con una foto adentro de una celda crea una foto en línea en la celda (los datos
  están bien; la impresión de celdas con fotos no está probada: entrega 5; hasta la entrega 5, que la probó). Buscar y la importación de comentarios de
  Coda le ponen un espacio al principio a un renglón con la marca (no escriben nada).

### Lo medido

| Caso | Resultado |
|---|---|
| Pegar una foto en el medio de un renglón (Chromium, con portero) | Entra ahí, `sdmedia://`, ancho natural; el cursor queda después |
| Pegar tres al final de un texto | Juntas, en orden, a 1/3; una fila propia debajo del texto; un Ctrl+Z las saca, Ctrl+Y las vuelve |
| Soltar dos entre dos palabras / sobre una foto-bloque / pegar en una celda | Entre las palabras / renglón nuevo después de la foto-bloque / renglón nuevo después de la tabla |
| "/Image" | Abre el selector (varios archivos); entran donde estaba el cursor |
| "Copy image" de una web | En el renglón, al Drive, sin partir el párrafo |
| Mientras se guardan, el otro escribe en el renglón (dos editores con Yjs) | Lo escrito queda, las fotos en su lugar, el renglón con su forma |
| Las dos barras | Los mismos 17 botones en el mismo orden, 5 sectores; todos 30 × 30 px, relleno 0; `data-tip` y ningún `title`; sin leyenda |
| Tirador de una foto de 1/4 arrastrado a casi la mitad | En vivo, de 180 a 269 px; al soltar, 1/2; un temblor de 1 px no cambia nada; Ctrl+Z vuelve a 1/4 |
| Alinear al centro, borrar, renombrar, reemplazar (Chromium) | El renglón centrado (la foto en el medio); la foto se va; el nombre cambia; la foto pasa a ser el archivo nuevo del Drive, con su ancho |
| Varias elegidas + una letra, Espacio, Enter | Ninguna se borra (Espacio abre el carrete) |
| Acomodar 3 de 6 fotos a 1/3 | Las otras tres no cambian de ancho; las tres en una fila propia de la misma altura (diferencia ≤ 0,02 px) |
| Dos verticales elegidas con otra después | 229 × 344 px en un renglón de 720 (antes 533 de alto) |
| Un video elegido | *Download video*, *Replace video*, *Delete video* |
| Teléfono (375 px) | La barra en dos renglones, adentro de la pantalla |
| Clic en una foto | La elige; la barra propia arriba (no tapa la foto ni la vecina más alta); la de texto no aparece |
| Emoji (`insertText`) con una foto elegida | `[F5]😀[F6]` |
| Arrastrar para elegir y soltar en la mitad derecha / izquierda de una foto | Termina después / antes de ella |
| Escribir delante de una fila llena que pasa a empezar renglón | `abc[F3][F4][F5]`; tres Backspace borran las letras |
| Imprimir A4 con un párrafo de tres filas de fotos que cruza el corte | El cálculo corta entre la 2.ª y la 3.ª fila, y el PDF de Chromium (`page.pdf`) también |
| Los scripts de la 1b (teclado, composición, carrete, el resto) | Iguales a la 1b, salvo lo cambiado a propósito (las barras) |
| Anchos: 831 anchos × 2 densidades (1 y 1,75) | 0 renglones distintos de su fila; diferencia de alto ≤ 0,08 px (como la 1b) |

Pruebas en el repo: `inlinePhotoCreate.test.ts`, `inlinePhotoSize.test.ts`, `mediaBar.test.tsx`,
`stableGapsMarker.test.ts`, `stableGapsUndo.test.ts`, `collabPhotosVersions.published.test.ts`, y casos nuevos en
`inlinePhotoEditor.test.ts`, `pagination.test.ts`, `fileDrop.test.ts` y `heicNames.test.ts`.

### Límites que quedan

- **Sin probar en Safari ni en el iPhone** (pegar, soltar, el selector de "/Image" con la cámara, la barra y los
  tiradores con el dedo, la composición).
- Pegar HTML con texto y un `<img>` (de una web, de otro programa) sigue creando una foto-bloque: llevarlo al renglón
  es de la entrega 3, con la conversión de imágenes `data:`.
- "/Image" y *Replace image* ya no ofrecen pegar una dirección (*Embed*) para una foto de otro sitio: abren el
  selector de archivos.
- Las fotos en las celdas de una tabla siguen afuera (van en un renglón después de la tabla; hasta la entrega 5, que
  las pone en la celda).
- La marca de espera solo se ve en el renglón; si las fotos van a un renglón nuevo, no hay marca mientras se guardan.
- Lo que sigue de editar a la vez junto a fotos (unir renglones, cambiar el tipo, dos Enter a la vez, deshacer una
  foto mientras otro escribe al lado) está en `Doc_Colaboracion.md`.

### `min_app_version`

Con la marca del renglón, ninguna versión anterior abre una página con fotos en línea (ni con un renglón que las
tuvo), así que no hace falta subirlo antes. Orden: **publicar la v0.078 y después subir `min_app_version` a 0.078**
(una fila de la base; la cambia Lega), cuando la tenga en sus dispositivos. Así las versiones viejas dejan de subir
cambios y avisan que hay que actualizar.

## Cómo quedó (entrega 3: convertir las fotos-bloque que ya existen)

### Función escondida, sin entrada en la interfaz (D-26)

La entrega 3 se hizo con una acción en el menú de la página (*Convert photos to inline*); Lega la sacó (D-26): la app
no tiene usuarios, las fotos-bloque que existen son de proyectos de prueba que se van a borrar y ERSO se reimporta
con las fotos en línea. Queda el código, `convertPhotos(editor, check)` en `convertPhotos.ts`, con sus pruebas y
sin nada que lo llame, por si alguna vez entra algo con fotos sueltas. Para volver a ofrecerlo: un registro como el
de colapsar (`collapseControl.ts`) que el editor abierto llena y el menú consulta, con `check.hasComments` de los
hilos de la página y sin convertir hasta que los comentarios estén bajados (`comments.isFresh`), como estaba en
`d02c1aa`. Convertir sola al abrir sigue descartado: dos dispositivos que convierten a la vez dejan cada renglón
dos veces (medido, ver abajo).

**Riesgos si vuelve al menú** (auditoría de datos de las entregas 3 y 4): convertir saca los bloques y pone el
renglón, así que lo que **otro dispositivo cambie a la vez** en esas fotos-bloque se pierde: una leyenda que agrega, un
*Replace*, un comentario nuevo en una foto que no es la que da su id al renglón (queda sin bloque), el texto que
escribe en un bloque hijo de una foto. Y de la foto-bloque no pasan al renglón `backgroundColor` ni `showPreview`
(la foto en línea no los tiene).

### Qué hace (`convertPhotos.ts`)

- **Cada fila de fotos-bloque** (las seguidas con `rowWidth`, las mismas que arma `groupRows`) pasa a ser **un
  renglón** con sus fotos en línea, con el mismo ancho (`w` = `rowWidth`). Una foto-bloque sola pasa a ser un
  renglón con esa foto: su `rowWidth` o, si solo tiene `previewWidth` (de antes de los tamaños), esa parte de un
  ancho de referencia **fijo de 720 px** imantada a 1, 1/2, 1/3 y 1/4 (dos dispositivos convierten igual); sin
  ninguno, su ancho natural. Una foto sola centrada o a la derecha conserva la alineación (la del renglón).
- **Queda como bloque**: una foto con leyenda (se perdería; D-24), un adjunto (su tarjeta) y una foto a medio
  subir. Los videos y las fotos del Drive se convierten (misma dirección `sdmedia://`).
- **Nada se pierde**: nombre, dirección y ancho de cada foto; los hijos de una foto pasan a su renglón (una foto con
  hijos termina su renglón); y los **comentarios**, que están anclados al id del bloque: el renglón toma el id de su
  foto con comentarios (o el de la primera). Solo si dos fotos de una misma fila tienen comentarios la fila se
  parte en dos renglones (cada parte se ve hasta 5 px más grande: reparte el lugar entre menos fotos).
- **Versiones viejas**: el renglón nuevo lleva la marca (`lgaStableGaps`); ninguna versión anterior abre la página.

### Lo que costó descubrir

- **"Reemplazar" en un solo cambio perdía fotos.** y-prosemirror reusa el contenedor del bloque (mismo id) y mete el
  párrafo adentro en lugar de la imagen. Deshacer no saca un párrafo con contenido (`protectedNodes`): quedaban
  imagen y párrafo en el mismo bloque y el editor tiraba el bloque entero (la fila desaparecía). Y dos dispositivos
  que convertían a la vez metían dos párrafos en el mismo bloque: la fila desaparecía de los dos. Ahora cada renglón
  **saca** sus bloques y **después pone** el renglón (dos cambios, y cada renglón por separado para que y-prosemirror
  no toque los bloques de al lado), y todo junto es un solo paso de deshacer (`asOneUndoStep` en `undoGuard.ts`:
  sacar bloques ya no corta el deshacer en el medio).
- **Dos conversiones a la vez** (sin verse): cada renglón queda dos veces, ninguna foto se pierde, y los dos renglones
  con el mismo id reciben ids nuevos en cada editor (BlockNote no deja dos iguales), así que los comentarios de esa
  fila quedan sin bloque (se ven en el panel). Es el motivo de no convertir sola al abrir.
- Convertir mientras otro le cambia algo a una foto-bloque (el tamaño, el nombre, una leyenda) pierde ese cambio del
  otro; si el otro la borra, la foto vuelve en el renglón. Se prefiere eso a perder una foto.

### Lo medido

- Pruebas (`convertPhotos.test.ts`, 10): filas, solas, leyenda, adjunto, comentarios, hijos, videos y Drive, foto
  única hija de un ítem, página que es solo una fila; un Ctrl+Z vuelve todo como estaba (ids, anchos, leyenda) y
  Ctrl+Shift+Z lo rehace, también con las extensiones de la página; las versiones anteriores no abren el resultado;
  dos editores: el otro escribe mientras se convierte (no se pierde nada) y los dos convierten a la vez (todo dos
  veces, nada perdido).
- Chromium, página tipo ERSO (6 escenas, 61 fotos-bloque: filas de 3, 4 y 2 como las deja *Arrange in rows*, solas
  de 360 px, una con leyenda y un comentario en la tercera foto de una fila): 12 de 12. Convierte 60 en ~0,1 s; la
  de leyenda queda; **las 25 filas quedan iguales** (las mismas fotos, en el mismo orden) y cada foto de una fila
  mide lo mismo (diferencia máxima 0,55 px de ancho y 0,31 px de alto); las solas de 360 px pasan a 1/2 (360 px); el
  comentario sigue en el margen de su renglón; un Ctrl+Z vuelve las 61 fotos-bloque a su lugar y tamaño exactos.
  La página queda 185 px más alta en 5966 (3 %): unos 7 px más entre renglones de fotos que entre filas de bloques.

### Límites

- Pegar HTML con texto y un `<img>` (de una web) sigue creando una foto-bloque, y las imágenes `data:` de una página
  vieja quedan como están: no entraron en esta entrega.
- El ícono de comentario del margen de un renglón con fotos altas sigue arriba del renglón (los puntos ya bajan al
  texto, v0.078).

## Cómo quedó (entrega 4: importar de Coda con los renglones como estaban)

### Qué cambió

- **La importación** (`codaHtml.ts`, `codaImport.ts`): cada foto o video de Coda entra como foto en línea en el
  mismo lugar de su renglón (Coda pone cada `<img>` en un `<span style="display: inline-block">` dentro del
  renglón), en párrafos, ítems de lista, títulos y citas. `w` = el ancho que tenía en Coda sobre 624 px (el ancho
  del texto de Coda, `CODA_TEXT_WIDTH`): las que iban juntas en un renglón de Coda van juntas en uno de la app, y
  las más anchas que el renglón, a todo el renglón. En una lista, el renglón de Coda es más angosto (24 px menos por
  nivel) y `w` se calcula sobre él (auditoría, ronda 3: sin eso salían 1 a 5 % más chicas). Un título con solo fotos pasa a párrafo. Un adjunto sigue
  siendo la tarjeta (bloque). Las fotos de una celda de tabla van debajo de la tabla, juntas en un renglón
  (hasta la entrega 5, que las deja en su celda). Detalle en `Doc_Importar_Coda.md`, "La conversión".
- **Las fichas de las tablas** (`codaTables.mjs`, el comando): las fotos de una columna de fotos van en un solo
  renglón (una con su ancho; varias, a un tercio cada una). Cambia lo que escribe `--convert-only`: para una
  importación nueva hay que volver a correrlo (sin red ni token).
- **Un arreglo de la entrega 2** que apareció con fotos reales: un renglón de solo fotos que no lo llenaban medía
  lo que sumaban los anchos naturales de las miniaturas (`.bn-block-content` es flex), y cada foto salía más chica
  (una a 1/1 medía 479 px en vez de 720). Ahora el renglón con fotos ocupa todo el bloque (`styles.css`). Con las
  fotos de prueba (SVG grandes) no se veía.

### Lo medido

- Pruebas: `codaInlinePhotos.test.ts` (10, con las formas de HTML de ERSO: dos de 312 px juntas, el carácter de
  objeto, ítem con texto y foto, texto y fotos en un renglón, títulos, celdas, adjunto y video, Script, y la página
  escrita como en la app: con la marca del renglón, sin nada que una versión anterior abra), `codaImport.test.ts`
  (las fotos en línea con su `w`) y `coda-tables.test.mjs` (las fotos de la ficha juntas).
- Copia parcial de ERSO (3 páginas de reporte y 2 fichas, 41 archivos, 93 MB; la exportación real solo se leyó)
  importada en Chromium contra el servidor de mentira, comparada con el HTML de Coda en una columna de 624 px:
  17 de 17. Las mismas filas que en Coda en las tres páginas (la más cargada: 23 renglones con 24 fotos, uno con dos), cada
  foto ocupa la misma parte de la página (diferencia máxima 1 %; 3 % en un ítem de lista, que en Coda tiene más
  sangría), todas en línea y ningún bloque de foto; las fichas, con sus fotos en línea.

### Límites

- **El recorte de Coda** (`data-docx-crop`, 101 de 6129 fotos de ERSO) no se trae: la foto entra entera, más alta.
- Una página cuya tabla pasó a tarjetas o fichas (v0.063) no se compara foto a foto con Coda: sus miniaturas de
  celda pasan a ser las fotos de la tarjeta.
- La importación de prueba de ERSO ("ERSO (prueba)") se hizo antes: tiene fotos-bloque. La definitiva, con esta
  versión, entra con los renglones; la de prueba se borra (D-26).

## Cómo quedó (entrega 5: fotos en las celdas de una tabla)

Pedido anterior de Lega: miniaturas en las celdas. Sin tipos ni propiedades nuevas: la foto en línea que ya existe
(`photo`, con `w`) entra también en una celda, y en una celda `w = 0` se dibuja como miniatura.

### Qué pasaba antes (medido en Chromium con v0.104)

- **Crear:** con el cursor en una celda, pegar, "Copy image" de una web y "/Image" ponían la foto en un renglón nuevo
  **debajo de la tabla**; soltar sobre una celda, en un renglón nuevo **arriba o abajo de la tabla** (según la mitad).
  Solo pegar HTML copiado de la app metía una foto en una celda.
- **Cómo se veía** una foto que ya estaba en una celda (pegada así o puesta por la API): con su ancho natural, con tope
  en la celda. Una tabla de 6 filas con 8 fotos medía **2799 px de alto**; una vertical, 628 px; la columna se estiraba
  a lo que diera la página.
- **Lo que ya andaba:** el primer clic la elige y el segundo abre el carrete en ella, el carrete las recorre en orden
  (celda por celda, fila por fila: `inlinePhotosOf` y `photoKeyAtPos` ya contemplaban la tabla), un toque en el teléfono
  la abre, `mediaIdsInDoc` cuenta su archivo (mira el atributo `url` de cualquier elemento), sale en la impresión y en
  el PDF (grande, como en pantalla), y una tabla no se parte en el medio de una foto (la tabla no es "partible").
- **Importar de Coda:** las fotos de una celda iban debajo de la tabla, juntas en un renglón.

### Qué cambió

- **Crear** (`inlinePhotoCreate.ts`): `canHostPhoto` acepta la celda (sigue fuera el código). Pegar, soltar, "/Image"
  y "Copy image" ponen las fotos en la celda, donde está el cursor o entre las letras donde se soltaron. Soltar en el
  relleno de la celda (abajo, en una fila alta por una miniatura, o a los costados) las pone al final del texto de esa
  celda (`dropPos`, `cellTextEnd`; ahí ProseMirror da una posición entre el cierre del texto y el de la celda, donde no
  entra nada en línea, y antes de la auditoría terminaban debajo de la tabla). Entran **todas
  con `w = 0`** (`CELL_PHOTO_WIDTH`), aunque sean varias (no a 1/3: un tercio de una celda angosta es una estampilla).
  Un adjunto sigue siendo una tarjeta debajo de la tabla. Con varias celdas elegidas no hay lugar: van debajo.
- **Cómo se ve** (`styles.css`, "Fotos en las celdas"): en una celda, una foto sin ancho es una **miniatura de 96 px
  de alto** (`--sd-cell-photo-h`), con el ancho de su proporción y tope en la celda; las de una celda quedan una al
  lado de la otra, a la misma altura, con el espacio de las filas (8 px) a la derecha de cada una. Con ancho propio es
  una parte de la celda (como en un renglón), y no agranda la columna (`contain: inline-size`; antes la columna tomaba
  lo que medía el original). La misma tabla mide ahora **656 px** de alto.
- **La barra** (`PhotoToolbar.tsx`; D32): en una celda ofrece solo **Thumbnail / Miniatura** (vuelve a `w = 0`, marcada
  cuando lo está) y **Full cell width / Todo el ancho de la celda**; no van 1/2, 1/3, 1/4 ni *Arrange in rows* (en una
  columna de 120 px, la de fábrica, dejaban la foto más chica que la miniatura: 49 × 33 px con 1/2), ni alinear (la
  tabla no tiene alineación; el botón no hacía nada). El tirador sigue agrandándola dentro de la celda; los tiradores
  miden el renglón de la celda (`photoLine` en `inlinePhoto.ts`; antes tomaban la tabla entera). Con una selección que
  mezcla fotos de celdas y de renglones, la barra de siempre (tamaños de la página), sin alinear (auditoría, O7).
- **↑ desde el primer renglón de una celda con fotos** (`inlinePhotoEditor.ts`, `handleCellArrowUp`): va al final del
  texto de la celda de arriba. Antes iba a la celda de la izquierda: la miniatura hace alto el renglón y ProseMirror no
  veía el cursor arriba de todo, así que la tecla quedaba al navegador (auditoría, O4). Después de una foto también: el
  primer renglón se reconoce porque el alto del cursor se superpone con el del principio del texto (comparar solo los
  bordes de abajo fallaba por 2 px: 518 contra 516).
- **Imprimir** (`printView.ts`): la copia fija el ancho de una foto sin ancho propio en el de su miniatura; en una celda,
  el ancho que da el alto de 96 px (lo lee de la pantalla), así el original que pone la impresión sale igual y no se
  deforma.
- **Importar de Coda** (`codaHtml.ts`, `cellPhotos`): las fotos y videos de una celda quedan en la celda, en su lugar,
  como miniaturas; un adjunto de una celda sigue yendo debajo de la tabla. No se comprobó con una exportación real:
  la copia parcial de ERSO no tiene fotos en tablas de páginas (las tablas de Coda pasan a fichas, `codaTables.mjs`).
- **Ayuda:** entrada *Photos in a table / Fotos en una tabla*. Sin atajos nuevos.

### Versiones viejas

Nada nuevo en el documento: el mismo nodo, con la marca del renglón (`lgaStableGaps`) y los huecos estables adentro de la
celda (probado). La versión publicada de v0.083 a v0.092 (`fixtures/editorSchemaAnterior.ts`) abre una página con fotos
en celdas **sin escribir nada** y, al escribir en esas celdas, no borra ninguna foto; las de v0.052 a v0.076 (sin
`photo`) no la abren (el resguardo). Una versión de v0.078 a v0.104 la abre y la ve con las fotos grandes (como antes).
La publicada hoy (`fixtures/editorSchemaMain.ts`, regenerada desde v0.107) también la abre sin escribir nada.
`editorSchemaFixture.test.ts` falla si ese fixture queda distinto de `editorSchema.ts` sin declararlo.

### Lo medido

| Caso (Chromium, la página real sobre el servidor en memoria, sin login) | Antes (v0.104) | Ahora |
|---|---|---|
| Pegar con el cursor en una celda vacía | debajo de la tabla | en la celda, miniatura |
| "Copy image" de una web en la celda | debajo de la tabla | en la celda |
| Soltar dos sobre el texto de una celda | arriba de la tabla | en la celda, al final del texto |
| "/Image" en una celda | debajo de la tabla | en la celda |
| Alto de la tabla de prueba (6 filas, 8 fotos) | 2799 px | 656 px; cada miniatura de 96 px de alto (144, 64, 96 px de ancho según la proporción) |
| Clic, segundo clic, carrete en orden (10 fotos), toque en el teléfono | andaba | igual |
| Tirador arrastrado 70 px | — | `w` 0,67 de la celda (213 px); Ctrl+Z vuelve a miniatura |
| *Full cell width* / *Thumbnail* | — | todo el ancho de la celda / vuelve a `w = 0` |
| Soltar en el relleno de abajo de una celda de una fila alta, y en la celda vacía (script de la auditoría) | — | antes de la auditoría, 2 de 4 debajo de la tabla; ahora 4 de 4 en la celda, al final de su texto |
| ↑ desde el principio de "Texto [foto] y más texto" | — | antes, la celda de la izquierda; ahora la de arriba (las otras 7 flechas, iguales) |
| Una letra, ←, Espacio, Retroceso con una foto de la celda elegida | — | la letra después de la foto, ← la elige, Espacio la abre en el carrete, Retroceso la borra y Ctrl+Z la devuelve |
| Imprimir (A4) | las 8 fotos grandes | las 8 como en pantalla (144 × 96…), cargadas, los originales del dispositivo |
| Teléfono (375 px) | fotos de hasta 99 px de ancho, una debajo de otra | miniaturas con tope en su celda; la página no se desborda; un toque abre el carrete |

Pruebas en el repo: `src/ui/cellPhotos.test.ts` (dónde entra, varias y un solo deshacer, soltar, adjuntos, selección de
celdas, la forma guardada, el carrete y las claves del clic, `mediaIdsInDoc`, las filas, la versión publicada y la
anterior a `photo`, soltar en el relleno de una celda con lo que da `posAtCoords` en Chromium, ↑ desde una celda con
fotos), casos nuevos en `mediaBar.test.tsx` (la barra en una celda y con una selección mixta), `pagination.test.ts` (el ancho de
impresión), `inlinePhotoCreate.test.ts` y `codaInlinePhotos.test.ts` (las celdas de Coda).

### Límites que quedan

- La columna no crece sola para una foto con ancho propio: para agrandarla hay que ensanchar la columna (su tirador).
- **Lo que dejó la auditoría para después** (no lo cambió esta entrega):
  - O1: pegar solo `text/html` de una fila con fotos (el portapapeles entre dos orígenes, o un navegador que no pase el
    formato propio de la app) la deja sin las fotos: el camino de HTML externo de las tablas de BlockNote
    (`parseTableContent`) pierde las fotos en línea de las celdas. Con los formatos que pone la app, copiar o cortar
    una fila anda. Ya pasaba antes. Propuesta: tratar como interno el HTML con `data-inline-content-type="photo"`.
  - O2: una tabla de Google Docs o Excel con imágenes llega con las celdas vacías (ya pasaba). Propuesta: pasar los
    `<img>` de las celdas a fotos en línea con `w = 0`, guardando el archivo como "Copy image".
  - O5: la papelera de archivos al borrar una fila o columna con fotos no se pudo comprobar sin la base real
    (`mediaIdsInDoc` deja de contarlas y Ctrl+Z las vuelve a contar; la desvinculación es del motor, sin cambios).
- El alto de la miniatura es fijo (96 px); no hay opción para cambiarlo.
- El texto pegado a una miniatura queda a 8 px (el espacio de la foto) además de su espacio.
- La barra de la foto, como en un renglón, puede quedar sobre la fila de arriba (O5).
- Sin probar en Safari ni en el iPhone de verdad (el teléfono, emulado en Chromium).
