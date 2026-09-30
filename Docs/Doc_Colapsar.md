# Colapsar secciones por sus títulos (P.11)

Estado: **diseño, sin implementar**. Lega contestó casi todas las decisiones el 2026-09-30 (al final,
"Decisiones"); las que faltan siguen "a confirmar". Hubo una auditoría independiente: **"Correcciones de la
auditoría", al final, manda sobre lo de arriba** (incluye lo que cambió con las respuestas: borrar un título
colapsado borra su sección, y Enter crea un renglón después sin abrirla). Sale de leer el código de `main` (v0.050) y el de BlockNote 0.55. Lo pidió Lega: "como en Coda:
cada título se puede colapsar y abrir con un triángulo a su izquierda".

## Qué se pide

1. Todo título (H1, H2, H3…) colapsa y abre **la sección que tiene abajo**, con un **triángulo lleno** a su
   izquierda (ni contorno ni chevron): apunta a la derecha colapsado y abajo abierto.
2. Colapsar un título esconde todo lo que sigue **hasta el próximo título de su nivel o mayor**: un H1 esconde
   sus H2 y H3 con lo suyo. Los títulos de adentro **guardan su propio estado** cuando se vuelve a abrir el de
   afuera.
3. El triángulo aparece al pasar el mouse por el título; en un título colapsado se ve siempre. Nada que
   activar: todos los títulos lo tienen.
4. **Por defecto es de cada persona**: un filtro de su vista, los demás no ven ningún cambio.
5. **Shift+clic colapsa o abre para todos** los que miran la página. Solo quien puede editar la página; el
   tooltip lo explica. A quien solo ve, el tooltip no menciona Shift y Shift+clic hace lo mismo que el clic.
6. (Respuestas de Lega.) "Colapsar todo / Abrir todo" y un atajo; el PDF sale todo abierto, con una casilla
   para imprimirlo como se ve; **las marcas de hoja en pantalla cuentan todo abierto** ("acá corta la página 5,
   por más que haya colapsado las dos primeras"); arrastrar un título colapsado mueve toda su sección.

## Reglas que no se rompen

- **Ningún tipo de bloque nuevo y ninguna propiedad nueva en los bloques.** Colapsar es un cálculo sobre el
  documento, como las filas de fotos (`imageRowsEditor.ts`) y las marcas de hoja (`SheetBreaks.tsx`): se
  dibuja con decoraciones de ProseMirror y nunca cambia el contenido.
- Colapsar para vos **no escribe nada en la página** (ni en el Y.Doc ni en el servidor).
- **Nada escondido se borra ni se cambia sin que se vea.** Si una edición local toca algo escondido, esa
  sección se abre (sección 5).
- Lo que una versión vieja no conozca se ve abierto, **nunca se borra**.

## 1. Qué es una sección

Para un bloque `heading` de nivel N, adentro de un `blockGroup`:

- Su sección son **sus propios hijos** (los bloques anidados debajo del título) y **los hermanos que siguen**,
  hasta el primer hermano que sea un título de nivel N o menor (sin incluirlo), o hasta el final del grupo.
- Un título anidado más adentro (hijo de un párrafo o de una lista) no corta la sección de afuera: queda
  escondido con su bloque. Un título anidado solo esconde hermanos de su propio grupo.
- Un título colapsado adentro de una sección escondida mantiene su estado. Al abrir la de afuera, la de adentro
  sigue colapsada.
- El estado se guarda **por id de bloque** y solo vale mientras el bloque sea un `heading`. Si deja de serlo,
  su sección desaparece y lo que escondía se ve.

Todo esto es una función pura (`src/ui/collapse.ts`, nuevo): `hiddenRanges(doc, isCollapsed)` recorre la
estructura (como `decorate` en `imageRowsEditor.ts`, sin entrar al texto) y devuelve, por cada título
colapsado, los `blockContainer` que esconde. Además, `hidersOf(doc, blockId)` devuelve los títulos colapsados
que esconden un bloque (hacen falta para abrirlo desde afuera, sección 6).

## 2. Cómo se esconde, y los "encabezados plegables" de BlockNote

**Un plugin de ProseMirror con decoraciones** (`src/ui/collapseEditor.ts`), del mismo tipo que
`imageRowsPlugin`:

- El título colapsado lleva `sd-collapsed` y el atributo `data-sd-collapsed` en su `blockContainer`
  (`.bn-block-outer`). El CSS esconde su grupo de hijos (`.sd-collapsed > .bn-block > .bn-block-group`).
- Cada hermano escondido lleva `sd-collapsed-hidden` (`display: none`).
- Se recalcula cuando cambia el documento o cuando cambia el estado (una transacción con un `meta` del plugin,
  sin tocar el documento). Recorre solo la estructura: O(bloques), como las filas de fotos.

**Por qué no el `isToggleable` de BlockNote** ("Encabezado plegable 1/2/3" en el menú "/", ver
`editorLocale.ts`). Lo miré en `@blocknote/core` 0.55 (`blocks/Heading/block.ts`,
`blocks/ToggleWrapper/createToggleWrapper.ts`):

- Esconde solo los **hijos anidados** del título (CSS sobre `.bn-block-group` con `data-show-children`). En
  nuestras páginas lo de abajo de un título son **hermanos**, no hijos: con eso no se colapsa nada.
- Guarda el estado en `localStorage` con la clave `toggle-<id>`, sin usuario ni workspace, y **por defecto
  esconde** los hijos: en un dispositivo nuevo, un título plegable con hijos aparece cerrado.
- Es una propiedad del bloque (`isToggleable`), con su propio botón (el triángulo ya se parece al pedido, pero
  es de BlockNote y hace otra cosa).

Decidido (Lega):

- **Sacar los encabezados plegables del menú "/"** (las claves `toggle_heading`, `toggle_heading_2`,
  `toggle_heading_3` en `slashItems` de `PageEditor.tsx`) **y del selector de tipo** de la barra
  (`blockTypeSelectItems` trae tres con `isToggleable: true`; se filtran en `toolbarItems`). La "Lista
  plegable" (`toggleListItem`) queda: es otro bloque, y ahí esconder los hijos es lo esperado.
- **Los que ya existan se tratan como títulos comunes.** No sé cuántos hay (no miré la base de producción);
  pudieron crearse desde que el menú los ofrece. El esquema no cambia (la propiedad sigue, así nada se
  descarta); el CSS esconde su botón y su "agregar bloque" y **muestra siempre sus hijos**, salvo que nuestro
  colapso los esconda. Nuestro triángulo aparece como en cualquier título. Una versión vieja los sigue viendo
  como antes. El CSS depende de las clases de BlockNote (`.bn-toggle-wrapper`, `.bn-toggle-button`): lo cubre
  una prueba de punta a punta, para que una actualización de BlockNote no lo rompa en silencio.

## 3. El triángulo

- **Una capa encima del editor** (`src/ui/CollapseToggles.tsx`, nuevo), como el margen de comentarios
  (`CommentMargin` en `EditorComments.tsx`): no entra al DOM de ProseMirror, así que no molesta al escribir
  (un widget al principio del texto del título trae problemas conocidos con el cursor en Safari y Chrome) y
  anda igual en solo lectura. Se ubica midiendo cada `[data-content-type="heading"]`, con los mismos avisos
  de cambio de tamaño que ya usa el margen.
- **Dibujo:** triángulo lleno (SVG), de unos 10 px, del **color del título** (`currentColor`, así respeta el
  color de texto del bloque), centrado en el primer renglón, en el margen izquierdo junto al texto. Zona
  para el mouse de 24×24 px. Abierto: apunta abajo, se ve al pasar el mouse por el título (suave) y fuerte
  sobre el triángulo. Colapsado: apunta a la derecha y se ve siempre.
- **Choque con el menú lateral de BlockNote** (el tirador ⋮⋮ y el "+", que aparecen a la izquierda del bloque
  al pasar el mouse): los dos quieren el mismo lugar. Propuesta: en los títulos el menú lateral se corre unos
  20 px a la izquierda y el triángulo queda pegado al texto, como en Coda. Se decide con una maqueta.
- **Accesibilidad:** es un `button` con `aria-expanded` y un `aria-label` con el texto del título; no entra en
  el orden de Tab (en el editor Tab anida bloques). Con el teclado se usa el atajo.
- **Shift+clic:** el `pointerdown` del botón hace `preventDefault`, así Shift no extiende la selección del
  texto.
- **Pista de lo escondido (opcional, no en la primera entrega):** algo tenue después del título colapsado
  ("…" o "12 bloques"). Tiene el mismo problema del cursor si va adentro del texto; en la capa hay que medir
  dónde termina el renglón. A decidir.

**Tooltips** (con el formato de `Tooltip.tsx`; los textos van en `src/i18n/lazy/editor.ts`):

| Estado | Quien puede editar | Quien solo ve o comenta |
|---|---|---|
| Abierto para todos | **Colapsar solo para vos**<br>Shift+clic: para todos | **Colapsar** (solo para vos) |
| Colapsado solo para vos | **Colapsado solo para vos**<br>Clic: abrir · Shift+clic: colapsar para todos | **Abrir** |
| Colapsado para todos | **Colapsado para todos**<br>Clic: abrir solo para vos · Shift+clic: abrir para todos | **Abrir** (solo para vos) |
| Abierto solo para vos (para los demás está colapsado) | **Abierto solo para vos**<br>Clic: colapsar · Shift+clic: abrir para todos | **Colapsar** |

En inglés: *Collapse just for you / Shift+click: for everyone*, *Collapsed for everyone / Click: open just for
you · Shift+click: open for everyone*, etc. Colapsado para todos y colapsado para vos **se ven igual**; solo
cambia el tooltip.

**Teléfono y pantallas táctiles** (sin mouse ni Shift): el triángulo **se ve siempre, tenue**, en todos los
títulos (`pointer: coarse` o el diseño del teléfono, `isPhoneLayout`); un toque colapsa o abre **para vos**;
zona de toque de 32 px que no tape el principio del texto. Para todos, solo desde la computadora (más adelante
se puede sumar un toque largo con un menú).

**Teclado:** **Ctrl/⌘+Alt+Enter** colapsa o abre el título donde está la selección (si está en otro bloque,
el título de su sección, y la selección pasa a ese título). Con Shift además (**Ctrl/⌘+Alt+Shift+Enter**), para
todos, si se puede editar. Ctrl+←/→ y Ctrl+Alt+flechas están ocupados (Lega). Revisado:

- **BlockNote 0.55:** ningún atajo con Enter en el editor de la página. Sus atajos con Alt son `Mod-Alt-0` a
  `6`, `Mod-Alt-q` y `Mod-Alt-c`; `Mod-Enter` solo existe en su editor de comentarios (que no usamos). Los
  atajos de base de Tiptap (donde `Mod-Enter` sale de un bloque de código) están apagados:
  `enableCoreExtensions: false` en `BlockNoteEditor.ts`.
- **La app:** Ctrl/⌘+Alt+P, S y M, Ctrl/⌘+P; Ctrl/⌘+Enter solo en el campo del panel de comentarios (manda el
  comentario), que está afuera del editor.
- **Navegadores y sistemas:** con el foco en la página, Ctrl/⌘+Alt+Enter no está tomado en Chrome, Safari ni
  Firefox, en Mac, Windows ni Linux. En Windows, Ctrl+Alt es AltGr: AltGr+Enter no escribe nada. A probar
  igual con los lectores de pantalla (VoiceOver usa Ctrl+Option como prefijo).
- **Alternativa: Ctrl/⌘+Enter**, como en Notion. También está libre en el editor (mismo control), es más
  corto y con Shift queda **Ctrl/⌘+Shift+Enter** para todos. Contra: quien viene de Google Docs lo usa para un
  salto de página. A elegir por Lega.

En el menú de la página, **Colapsar todo** y **Abrir todo**, para vos.

## 4. Para vos y para todos

**Para todos: en el mismo Y.Doc de la página, afuera del contenido.** Un `Y.Map` propio (por ejemplo
`doc.getMap('collapsedHeadings')`), al lado del fragmento `CONTENT_FRAGMENT`: clave el id del título, valor
`true`; abrir para todos borra la clave (así no se juntan valores `false` de títulos viejos).

- **Viaja solo:** `docs.ts` sube el estado entero del documento (`Y.encodeStateAsUpdate`), no solo el
  fragmento. Se escribe con un origen propio (no `ORIGIN_LOAD` ni `ORIGIN_REMOTE`), así se guarda y se sube
  como cualquier edición. El plugin escucha el mapa (`observe`) y se redibuja cuando llega un cambio de otro.
- **Sin propiedad nueva, sin migración, sin subir `min_app_version`.** `findUnknownContent`,
  `usage.ts` y `unsynced.ts` miran solo el fragmento, así que el mapa no molesta.
- **Una versión vieja lo conserva:** Yjs guarda un tipo raíz que no conoce (`Doc.get` lo crea como
  `AbstractType` al leer el update) y lo vuelve a codificar al fusionar, compactar y subir. Esa versión ve todo
  abierto. Lo fija una prueba con la versión publicada (`publishedCompat.test.ts`).
- **No se deshace con Ctrl+Z:** el `UndoManager` de y-prosemirror mira solo el fragmento. Colapsar no es una
  edición del texto.
- **Quién puede:** `push_page_update` ya exige `can_edit_page` (nivel 3: Editar, o Editar y crear páginas;
  también un invitado con Editar sobre la página). Ver y Comentar no pueden escribir la página: los
  comentarios van por otro lado (`comments.ts`). Pero **la app no puede escribir el mapa sin permiso**: el
  cambio quedaría guardado en el dispositivo y la subida, rechazada (la página aparecería con un rechazo).
  Por eso Shift solo vale con el editor editable (`editable` de `BlockEditor`: con permiso **y** con la
  página completa), y la función que escribe el mapa lo vuelve a revisar.

**Para vos: en el dispositivo, en `localStorage`.** Tiene que ser sincrónico: al abrir la página las
decoraciones tienen que estar desde el primer dibujo (con IndexedDB se vería todo abierto y después se
cerraría). Una clave por base local (el nombre de la base ya es por workspace y usuario):
`sd-collapse:<base>` → por página, la fecha de uso y, por título, `[colapsado, lo que valía para todos]`. Se
guardan las 300 páginas usadas más recientemente. Si `localStorage` falla (navegación privada, bloqueado),
anda en memoria. Se borra junto con la base local (`RemovedScreen.tsx`). **A futuro (Lega lo quiere):** que siga
a la persona en todos sus dispositivos, como las preferencias.

**La regla entre los dos** (en `collapse.ts`, con prueba):

- `G` = colapsado para todos (el mapa). `P` = lo tuyo, si hay: `{colapsado, G que viste}`.
- **Lo que ves:** `P.colapsado` si `P` existe **y** se hizo contra el `G` de ahora; si no, `G`.
- **Clic:** lo contrario de lo que ves. Si coincide con `G`, se borra `P`; si no, se guarda con el `G` de ahora.
- **Shift+clic (quien edita):** `G` pasa a lo contrario de lo que ves y se borra tu `P`.
- Cuando alguien cambia `G`, los `P` de ese título hechos contra el valor anterior dejan de contar: todos
  vuelven a ver lo que decidió quien hizo Shift+clic. Se limpian al leerlos.

## 5. Editar con secciones colapsadas

La regla general, en `appendTransaction` del plugin, después de cada transacción local (una transacción de
y-prosemirror con `isChangeOrigin` y sin `isUndoRedoOperation` es de otro; deshacer cuenta como local):

- **Si la selección quedó adentro de algo escondido por un cambio del documento** (escribir, pegar, soltar,
  deshacer), **esa sección se abre para vos**, con todos los títulos que la escondían.
- **Si quedó ahí solo por moverse** (clic, flechas, algo que pone la selección), **pasa al final del título
  colapsado**, sin abrir nada.
- **Si una edición local cambió bloques escondidos** sin que la selección quede adentro, también se abre la
  sección, salvo que la selección cubriera la sección entera con su título (borrar una sección colapsada).

Los casos, uno por uno:

| Caso | Qué pasa (propuesta) |
|---|---|
| Colapsar con la selección adentro de la sección | La selección va al final del título. |
| ↓ o → al final de un título colapsado | Salta al principio del primer bloque visible después de la sección (manejado a mano: no se confía en cómo mueve el navegador el cursor alrededor de `display: none`). |
| ↑ o ← al principio del bloque que sigue a una sección colapsada | Al final del título colapsado. |
| Supr al final de un título colapsado | **No hace nada**: BlockNote uniría el primer bloque escondido al título. |
| Retroceso al principio del título que sigue a una sección colapsada | BlockNote lo pasa a párrafo, entonces se suma a la sección de arriba: la sección se abre (regla general) y queda a la vista. |
| Retroceso al principio de un título colapsado | BlockNote lo pasa a párrafo: deja de ser título y lo que escondía se ve. |
| Enter al final de un título colapsado | **Un título nuevo del mismo nivel después de la sección**, con la selección ahí (un párrafo ahí quedaría adentro de la sección, escondido). Alternativa: abrir la sección y seguir como siempre. |
| Enter en el medio o al principio de un título colapsado | Abre la sección y sigue como siempre. |
| Cambiar el nivel o el tipo de un título colapsado (barra, Ctrl/⌘+Alt+1…6, "## ") | Se abre para vos; y para todos si estaba colapsado para todos (quien lo cambia puede editar). Si no, un H2 que pasa a H1 escondería de golpe las secciones de al lado. |
| "Borrar" del menú del bloque en un título colapsado | Borra solo el título; su contenido pasa a la sección de arriba y se ve (salvo que esa también esté colapsada). |
| Arrastrar un título colapsado | **Se mueve la sección entera.** BlockNote arrastra todo lo elegido si el bloque está en la selección (`dragStart` de `SideMenu/dragging.ts`): en la captura del `dragstart` del tirador se elige del título al último bloque escondido (`MultipleNodeSelection`) y BlockNote hace el resto. El estado viaja con el id. (Decidido por Lega: siempre la sección entera.) |
| "+" del menú lateral, o soltar algo justo debajo de un título colapsado | El bloque nuevo queda adentro de la sección: se abre. |
| Una selección que cruza una sección colapsada, y se borra o se escribe encima | Se borra también lo escondido (está en la selección), con un aviso: "Se borraron también 12 bloques escondidos" (Ctrl+Z lo trae). |
| Copiar o cortar | Lleva lo escondido (está en el documento). Al pegar, BlockNote da ids nuevos: lo pegado aparece abierto. |
| Tab / Shift+Tab sobre un título colapsado | Cambia de grupo y su sección se recalcula (los que eran sus hermanos pueden quedar a la vista). |
| Deshacer | Colapsar no se deshace. Si deshacer cambia algo escondido o deja la selección ahí, se abre. |
| Cambios de otros adentro de una sección escondida | Siguen escondidos. Si alguien agrega un título de igual o mayor nivel adentro, la sección se corta ahí y lo de abajo se ve; si pasa el título a párrafo, se ve todo. |
| Cursores de otros adentro de lo escondido | No se ven. |
| Ctrl+A | Elige todo, también lo escondido. |
| Buscar | La búsqueda en la página de la app (P.12) **busca también en lo escondido y abre la sección** del resultado (sección 6). El Ctrl+F del navegador no encuentra lo escondido; si P.12 no toma Ctrl/⌘+F, se puede sumar `hidden="until-found"` (Chrome y Edge lo encuentran y avisan con `beforematch` para abrir; en Safari y Firefox, a verificar). |

Los atajos van con prioridad sobre los de BlockNote (`KeyboardShortcutsExtension`, prioridad 50): lo mismo que
hoy hace `imageRowsExtension` con Enter y las flechas. Se confirma con las pruebas en jsdom.

## 6. Lo que abre una sección solo, y lo que no

- **"Ir al bloque" del panel de comentarios** (`revealBlock` en `commentsUi.ts`): antes del scroll y el
  resaltado, abre para vos todos los títulos que esconden el bloque (`hidersOf`). El editor registra esa
  función como ya registra la fuente de bloques (`setBlockSource`).
- **La búsqueda en la página (P.12 del roadmap):** busca en el documento (no en la pantalla), así que encuentra
  el texto de las secciones colapsadas; al ir a un resultado escondido, abre para vos los títulos que lo
  esconden (`hidersOf`), como "Ir al bloque". Ninguna sección se abre solo por aparecer en la lista de
  resultados. El diseño de P.12 tiene que usar esta misma función.
- **Links a un bloque:** hoy no existen (`/p/<id>` abre la página). Cuando existan, usan lo mismo.
- **El margen de comentarios** (`CommentMargin`): un bloque escondido no tiene lugar en pantalla (su contador
  saldría arriba de todo). Primera entrega: sus contadores y el botón "Answer" de las preguntas escondidas no se
  dibujan; el panel los sigue mostrando. Opcional: el título colapsado muestra la suma de los comentarios
  abiertos de lo que esconde.
- **El carrete muestra todas las fotos y videos**, también los escondidos (`collectCarrete` lee el documento,
  no la pantalla: no cambia nada). Ver una foto escondida en el carrete no abre la sección, y al cerrar la
  selección queda donde estaba.
- **Tarjetas de Drive y preguntas escondidas:** no se ven; el reproductor queda montado pero sin mostrarse.

## 7. Hojas y PDF

**Lo que pidió Lega:** las marcas de hoja en pantalla se calculan **como si todo estuviera abierto**. Si una
sección colapsada ocupa las hojas 2 a 4, el próximo corte visible dice "Hoja 5", y el título colapsado avisa
que adentro hay cortes. Así el PDF de siempre (todo abierto) coincide con las marcas y la regla de
`Doc_Hojas_PDF.md`, "lo que se ve es lo que sale", se mantiene.

**Cómo funciona hoy** (`SheetBreaks.tsx`, `printView.ts`, `pagination.ts`): `buildPrintView` copia el DOM del
editor en pantalla (`.bn-editor`) a una vista afuera de la pantalla con el ancho de la hoja; `measureUnits`
mide cada `.bn-block-content` y **saltea lo que mide 0 de alto**; `paginate` decide los cortes; `placeMarks`
busca en pantalla el bloque de cada corte **por su clave** (`b:<id>`) y dibuja la marca a su altura (si el
corte parte un bloque, a la misma altura adentro de él).

**El cambio:**

1. **La copia se mide abierta.** `cleanCopy` saca las marcas del colapso (`sd-collapsed`, `sd-collapsed-hidden`,
   `data-sd-collapsed`) de la copia, en la vista para medir y en la de salida. Sin nada colapsado, nada
   cambia.
2. **Cada corte se ubica en lo visible** (`placeMarks`, con `hidersOf` de `collapse.ts`):
   - El bloque del corte **se ve en pantalla**: la marca va como hoy, con su número ("Hoja 5"). Los números
     cuentan todas las hojas, también las escondidas.
   - El bloque del corte **está escondido**: no hay dónde dibujarlo. Se junta en el **título colapsado de más
     afuera** que lo esconde (el único que se ve), que muestra una marca compacta en el margen, del mismo
     estilo que las otras: "Hojas 3–4 adentro" (una sola: "Hoja 3 adentro"; en inglés *Pages 3–4 inside*).
     Con el tooltip: "Esta sección colapsada tiene cortes de hoja. Abrila para verlos."
   - El corte cae justo en el título colapsado: marca normal (el título se ve).
3. **`--sheet-end`** (el alto para que la última hoja se vea entera) sale de la última marca visible; si los
   últimos cortes están escondidos, del título colapsado que los junta.
4. **Recalcular al colapsar:** la paginación no cambia (se mide abierta), pero las alturas en pantalla sí.
   `isContentMutation` ignora los cambios de `class`: por eso el atributo `data-sd-collapsed`, que sí cuenta
   (además cambia el alto, que ya mira el `ResizeObserver`). Más adelante se puede guardar el resultado de
   `paginateView` y, al colapsar, correr solo `placeMarks`.

**Fotos en secciones escondidas.** Para medir abierto hace falta el tamaño de cada foto. Hoy `cleanCopy` pone en
la copia `aspect-ratio` con el `naturalWidth`/`naturalHeight` de la imagen en pantalla, y `fixMediaWidth` el
ancho de `previewWidth` (el `width` en px del contenedor) o, si no tiene, el ancho natural; las fotos en fila
usan su `rowWidth`. Una foto escondida **igual se carga**: el `<img>` de BlockNote no lleva `loading="lazy"` y
el navegador baja las imágenes con `display: none`, así que su tamaño natural está como el de las demás. Si
todavía no cargó (recién abierta, sin red), pasa lo mismo que hoy con una foto que no cargó: `imagesPending`
(la espera de hasta 8 s antes de imprimir) ya la cuenta, y la copia espera sus propias imágenes
(`imagesLoaded`, 6 s) antes de repaginar. Para las marcas en pantalla, cuando la foto carga cambia el alto y se
recalcula (hoy igual). A verificar en Safari del iPhone, que puede demorar las imágenes que no se ven.

**El PDF:**

- **Por defecto, todo abierto**: la vista de salida es la copia abierta, y las hojas coinciden con las marcas.
- **"Imprimir como se ve" (colapsado)**, una casilla. Con ella, `cleanCopy` deja las marcas del colapso en la
  vista de salida y **esa vista pagina su propio contenido** (`paginateView` ya lo hace sobre la copia que va a
  imprimir): las secciones colapsadas no salen y los cortes son otros. **Las marcas de la pantalla no
  cambian** (siguen contando todo abierto): las hojas impresas no van a coincidir con ellas, y la casilla lo
  dice en su tooltip ("Las hojas no coinciden con las marcas de la pantalla").
- **Dónde va la casilla: al lado de "Imprimir", en el menú de la página, y solo si la página tiene algo
  colapsado** para vos. No puede ser un diálogo que pregunte antes de imprimir: en el iPhone, el diálogo de
  impresión del navegador tiene que abrirse **en el mismo toque** (`printPage` imprime antes del primer
  `await` cuando no hay nada que esperar; ver `printPage.ts`); un diálogo propio en el medio haría que el
  toque de "Imprimir" ya no cuente y Safari no abriría el de impresión. La casilla se guarda en el dispositivo
  y la usan también Ctrl/⌘+P y la impresión desde el menú del navegador (`installPrintShortcuts`,
  `beforeprint`).

## 8. Riesgos

1. **Teclado y selección alrededor de lo escondido:** cada navegador mueve el cursor distinto cerca de un
   `display: none`, y jsdom no lo reproduce. La regla general (sección 5) es la red; hace falta probar a mano
   Chrome, Safari, Firefox y el iPhone.
2. **Prioridad de los atajos** frente a los de BlockNote: si alguno corre antes (Supr, Retroceso, Enter), se
   une o se borra algo escondido. Lo cubren las pruebas con el editor real.
3. **Lugar del triángulo** frente al menú lateral de BlockNote, y en el teléfono, donde el margen es angosto.
4. **Encabezados plegables viejos:** el CSS que los neutraliza depende de clases internas de BlockNote.
5. **Hojas:** medir abierto cuesta lo mismo que hoy sin colapsar, pero las marcas que caen en lo escondido se
   juntan en el título y hay que ubicarlas bien (títulos colapsados adentro de otros, el final de la página).
   Una foto escondida que el navegador no cargó mide mal hasta que carga. Con "Imprimir como se ve", el papel
   no coincide con las marcas (avisado en la casilla).
6. **Escribir el mapa sin permiso** dejaría una subida rechazada: por eso la doble revisión (sección 4).
7. **El Ctrl+F del navegador no encuentra lo escondido** mientras no esté la búsqueda de la página (P.12).
8. **Lo tuyo vive en el navegador:** se pierde si se borran los datos del sitio (es solo la vista).
9. **Versiones viejas** ven todo abierto aunque alguien haya colapsado para todos (esperado; no pierden nada).

## 9. Entregas y pruebas

1. **Entrega 1, para vos:** `collapse.ts`, el plugin con todos los casos de la sección 5, el triángulo
   (computadora y teléfono), el atajo, "Colapsar todo" y "Abrir todo", abrir desde el panel de comentarios, el
   margen sin marcas escondidas, las marcas de hoja contadas con todo abierto (con la marca "Hojas 3–4
   adentro" en el título), el PDF todo abierto y la casilla "Imprimir como se ve", arrastrar la sección entera,
   los encabezados plegables fuera de los menús y neutralizados, textos y docs. Lo tuyo ya se guarda con el `G` que viste (falso), así la entrega 2 no
   cambia el formato.
2. **Entrega 2, para todos:** el `Y.Map`, Shift+clic y el atajo con Shift, los tooltips completos, la regla
   entre los dos.
3. **Después:** la pista de lo escondido, la suma de comentarios en el título, el toque largo en el teléfono,
   lo tuyo en todos tus dispositivos (Lega lo quiere, a futuro) y, si hace falta, `hidden="until-found"`. La
   búsqueda en la página (P.12) abre secciones con `hidersOf` desde que exista.

Pruebas:

- **Unidad (`collapse.test.ts`):** qué esconde cada título: un H1 con H2 y H3 adentro; un H2 que corta en el
  próximo H2 o H1; los hijos anidados del título; un título anidado en otro grupo que no corta; la última
  sección hasta el final; un título que pasa a párrafo; `hidersOf` con dos niveles colapsados. La regla entre
  para vos y para todos, caso por caso. Lo guardado en el dispositivo: dañado, lleno, sin `localStorage`,
  el recorte a 300 páginas.
- **Editor real en jsdom** (como `mount()` de `fileDrop.test.ts`): las clases en los bloques; colapsar no
  cambia el Y.Doc (mismo vector de estado); la selección pasa al título; Supr no une; Enter crea el título
  después de la sección; Retroceso en el título siguiente abre; cambiar el nivel abre; pegar y deshacer
  adentro abren; un update de otro documento adentro de lo escondido no abre; arrastrar mueve la sección
  entera; sin permiso, Shift+clic no escribe el mapa; con permiso, lo escribe y otro editor conectado lo ve.
- **Sincronización:** la versión publicada (`fixtures/publishedDocs.ts`) abre un documento con el mapa, edita,
  sube, y el mapa sigue en el servidor y en un dispositivo nuevo. La subida de alguien con Ver o Comentar se
  rechaza (ya lo prueban las pruebas de permisos).
- **Hojas:** la copia para medir sale abierta aunque haya secciones colapsadas (mismos cortes que sin
  colapsar); `placeMarks` con un corte en un bloque visible (número de hoja contando las escondidas), con
  cortes escondidos (juntos en el título de más afuera: "Hojas 3–4 adentro"), con un corte en el título mismo,
  y `--sheet-end` con los últimos cortes escondidos; la vista de salida abierta por defecto y colapsada con la
  casilla; el Y.Doc sigue igual al paginar.
- **De punta a punta** (`colapsar.mjs`, en el repo de pruebas privado, sin escribir en la base de producción):
  pasar el mouse y ver el triángulo, colapsar un H1 con un H2 colapsado adentro y reabrir, flechas, Shift+clic
  con dos usuarios (quien edita y quien solo ve), recargar y que siga, las marcas de hoja con una sección
  colapsada que ocupa varias hojas, imprimir con y sin la casilla (en el iPhone, el diálogo en el mismo toque),
  arrastrar una sección, un encabezado plegable viejo. A mano: Safari de Mac, iPhone, Firefox.

## Decisiones

### Respondidas por Lega el 2026-09-30

1. **Por secciones, no por hijos:** sí. Se sacan "Encabezado plegable 1/2/3" del menú "/" y de "Turn into":
   todos los títulos se colapsan. Los que ya existan se ven como títulos comunes, con nuestro triángulo.
2. **Lo tuyo, por dispositivo por ahora.** A futuro, que siga a la persona en todos sus dispositivos.
3. **Teléfono:** triángulo siempre visible y tenue, un toque solo para vos; para todos, solo desde la
   computadora.
4. **"Colapsar todo" / "Abrir todo" en el menú de la página, y un atajo:** sí. Ctrl+←/→ y Ctrl+Alt+flechas
   están ocupados. Queda Ctrl/⌘+Alt+Enter (punto 10).
5. **Arrastrar un título colapsado mueve la sección entera:** sí, siempre.
6. **El tooltip dice si está colapsado para todos o solo para vos:** sí (se ven igual; cambia el tooltip).
7. **PDF todo abierto por defecto**, con una casilla para imprimirlo como se ve. La casilla va en el menú de la
   página, al lado de "Imprimir" y solo con algo colapsado, no en un diálogo antes de imprimir (sección 7: el
   iPhone).
8. **Las marcas de hoja en pantalla cuentan todo abierto**, y el título colapsado avisa qué hojas tiene
   adentro. Con eso el PDF de siempre coincide con las marcas.
9. (Del roadmap, P.12) **La búsqueda en la página encuentra lo que está en secciones colapsadas y las abre.**

10. **Atajo: Ctrl/⌘+Alt+Enter** (con Shift, para todos).
11. **Enter al final de un título colapsado crea un renglón nuevo después de toda la sección, sin abrirla.**
12. **Borrar un título colapsado borra su sección entera** (el título y todo lo que esconde, con los hijos y
    las secciones colapsadas de adentro). Lega pide que ande perfecto: en Coda falla, y hasta se cuelga al
    borrar el último título colapsado de la página.
13. **Borrar una selección que cruza lo escondido lo borra también**, con un aviso ("Se borró también lo que
    estaba colapsado", y cómo deshacerlo).
14. **El carrete muestra todas las fotos**, también las escondidas.
15. **Sin pista de lo escondido** (a lo sumo en el tooltip; no hace falta).
16. **Un invitado con Editar sobre la página puede usar Shift+clic.**

### A confirmar por Lega

1. **Para todos, en el documento de la página** (un `Y.Map` aparte del contenido): sin propiedad nueva, sin
   migración, sin subir `min_app_version`. Las versiones viejas ven todo abierto.
2. **Cuando alguien colapsa o abre para todos, lo tuyo de ese título deja de contar** (con la marca única de
   la corrección 8).
3. **La marca de las hojas escondidas:** "Hojas 3–4 adentro" en el margen del título colapsado.
4. **Retroceso al principio de un título colapsado** (vacío o no) lo pasa a párrafo, como hoy: deja de ser
   título, su sección desaparece y lo que escondía se ve (corrección 2 si queda debajo de otro colapsado).

## Correcciones de la auditoría (mandan sobre lo de arriba)

Una auditoría independiente contrastó el diseño con el código de BlockNote 0.55, y-prosemirror y la app. El
modelo (secciones, decoraciones, sin tipo de bloque ni propiedad nueva) se mantiene. Cambios, con la numeración
de la auditoría; lo que decidió Lega después (borrar la sección entera, Enter sin abrir) ya va incluido.

1. **Borrar un título colapsado borra su sección entera, siempre de una vez** (decisión de Lega). Vale para
   "Borrar" del menú del bloque (`removeBlocks`), el bloque elegido entero (clic en el tirador, Ctrl/⌘+clic) con
   Retroceso, Supr o Cortar, y cualquier otra edición local que saque el bloque del título entero. Cómo: después
   de cada transacción local de la app (no de Yjs: ni de otro ni deshacer), si un paso borró el
   `blockContainer` entero de un título colapsado, en la misma pasada (`appendTransaction`, un solo Ctrl+Z) se
   borra lo que escondía y todavía está: los hermanos escondidos, sus hijos y las secciones colapsadas de
   adentro. **Nunca queda una parte.** Si la página queda sin bloques, queda un párrafo vacío (BlockNote
   necesita al menos uno). Aviso: "Se borró también lo que estaba colapsado" con Ctrl/⌘+Z. Cortar y Copiar con
   el título elegido entero llevan la sección entera al portapapeles: antes, la selección pasa a ser del título
   al último bloque escondido (`Selection.fromJSON(doc, {type: 'multiple-node', anchor, head})`, la selección de
   varios bloques de BlockNote). Deshacer trae todo, con los mismos ids, y el título vuelve colapsado (su estado
   no se borra al borrarlo). Si otro edita adentro mientras tanto, Yjs junta los dos: lo que escribió en un
   bloque borrado se pierde con él (como con cualquier borrado) y un bloque nuevo suyo queda, a la vista.
   Juntar un título con el bloque de arriba (Retroceso con parte del texto) **no** es borrarlo: su contenido
   queda y se reacomoda (corrección 2).
2. **Nada se esconde sin querer.** Después de cada transacción que cambia el documento (propia **o de otro**),
   se comparan los bloques escondidos antes y después: todo bloque que se veía y ahora queda escondido abre,
   para vos, los títulos que lo esconden. Excepciones: los bloques nuevos (no se veían), las transacciones de
   reemplazo de la búsqueda (`sd-find-replace`, ver `Doc_Buscar.md` en `lega/buscar`) y su deshacer (punto 18).
   Cubre: soltar algo en medio de una sección colapsada, pasar un título a párrafo, cambiar el nivel (un H2 que
   pasa a H1), Tab, mover con el teclado, lo que llega de otro.
3. **Qué cambió se mira por bloque, no por pasos:** deshacer en y-prosemirror (`_typeChanged`) es un solo
   `ReplaceStep` de todo el documento. Un bloque escondido "cambió" si su nodo no es el mismo (`node.eq` por id).
   Un cambio local (también deshacer) en un bloque escondido abre sus títulos; uno de otro, no.
4. **Shift+Ctrl/⌘+↑/↓** (`moveBlocksUp/Down` de BlockNote): un título colapsado se mueve con su sección, y los
   demás bloques saltan una sección colapsada como si fuera uno. Con prioridad sobre BlockNote (sus atajos van
   con prioridad 50; los nuestros, por encima de 100). Entrega 1b; mientras tanto, la corrección 2 evita que algo
   quede escondido sin querer.
5. **Para todos, de otro:** si un Shift+clic de otro escondería tu selección, esa sección queda abierta para
   vos (se guarda lo tuyo contra el `G` nuevo), con un aviso chico. Entrega 2.
6. **Lo tuyo va en la base local del dispositivo (IndexedDB), no en `localStorage`:** en `meta`, clave
   `collapse:<página>` (sin cambiar la versión de la base, como las marcas `docDirty:`). Se lee junto con
   `docs.open`, antes de crear el editor, así no hay parpadeo; se borra con la base local cuando se saca el
   workspace del dispositivo (`RemovedScreen.tsx`). Por título: `{c: colapsado, g: marca de "para todos" vista
   (null en 1a), e?: fin}` (ver 19).
7. **Arrastrar la sección entera:** en la captura del `dragstart` del tirador, la selección pasa a ser del
   título al último bloque escondido (`multiple-node`) y BlockNote arrastra todo. Soltar en medio de una sección
   colapsada: corrección 2. Entrega 1b.
8. **ABA en "para todos":** el valor del mapa es una marca única (no `true`), y lo tuyo guarda la marca que
   viste; colapsar, abrir y volver a colapsar da otra marca. Entrega 2.
9. **Shift solo con los permisos conocidos** (`perms.known`), además de editable. Si a alguien le sacan el
   permiso sin red, su escritura del mapa se rechaza como cualquier edición y queda en los rechazados; está
   documentado. Entrega 2.
10. **Las transacciones de la app en segundo plano no abren nada:** pasar una imagen `data:` a archivo, sacar
    el bloque de una subida que falló y `convertResize` de las filas de fotos llevan el `meta` `sd-background`.
11. **Shift+flechas** mantienen el ancla (extienden la selección saltando lo escondido); probado también desde
    una foto elegida.
12. **El final de la página:** el último bloque, si es un párrafo vacío, nunca se esconde (es el lugar para
    seguir escribiendo; el renglón de BlockNote para agregar al final solo aparece si la página no termina en
    uno). Si la última sección está colapsada y no termina en uno, el renglón de BlockNote agrega el párrafo
    vacío y ese ya no se esconde.
13. **"Imprimir como se ve"** (1b) saca de la copia de salida los `.bn-block-outer` escondidos (no alcanza con
    las clases). "Colapsar todo / Abrir todo" y la casilla valen solo para la página abierta.
14. **El triángulo** toma el color del estilo calculado del título (`getComputedStyle`). En el teléfono el
    margen es de 20 px: la zona del toque queda entera en el margen, sin tapar el texto, así un toque para
    poner el cursor al principio del título nunca colapsa.
15. **Solo lectura:** los triángulos entran en el orden de Tab (con el editor editable no, porque Tab anida),
    con `aria-expanded` y `aria-label` que dice la acción y el título.
16. **Detalles:** un reproductor de Drive que queda escondido se para (se recarga el iframe); el CSS que
    neutraliza los encabezados plegables viejos le gana a `Block.css` de BlockNote (líneas 310–321) y el de
    colapsar usa `!important` para ganarles a los dos; pegar `<details><summary><hN>` crea títulos plegables:
    al pegar se les pone `isToggleable: false`; el selector de tipo compara solo el nivel (así un plegable viejo
    aparece como su título) y no ofrece los plegables.
17. **Entregas** (reemplaza la sección 9):
    - **1a:** colapsar para vos, el triángulo, el atajo, "Colapsar todo / Abrir todo", toda la seguridad al
      editar (correcciones 1–3, borrar la sección entera, Enter, flechas, fin de página), las marcas de hoja
      contadas con todo abierto con "Hojas N adentro" en el título, el PDF todo abierto, los plegables fuera de
      los menús, abrir desde "Ir al bloque" y el margen de comentarios sin marcas escondidas.
    - **1b:** arrastrar la sección entera, Shift+Ctrl/⌘+↑/↓, la casilla "Imprimir como se ve".
    - **2:** para todos (Shift).
    - **3:** lo demás (lo tuyo en todos tus dispositivos, toque largo, `hidden="until-found"`).
18. **Buscar y reemplazar (P.12) no abre secciones, ni al deshacer.** La búsqueda (rama `lega/buscar`) marca
    sus transacciones con el `meta` `sd-find-replace` y la entrada de la pila de deshacer con la misma clave
    (`stackItem.meta`, en `stack-item-added` del `UndoManager`). El plugin saltea las dos cosas: la transacción
    marcada y el deshacer o rehacer de una entrada marcada (durante ese deshacer, `undoManager.currStackItem`
    es la entrada que se está aplicando). Las claves están en un archivo común, `src/ui/editorMeta.ts`
    (`FIND_REPLACE_META`, `BACKGROUND_META`), que importan las dos ramas.
19. **Enter al final de un título colapsado** (decisión de Lega): el renglón nuevo va después de lo escondido y
    **se ve sin abrir la sección**. Como por la regla de las secciones ese renglón sería parte de la sección
    (no hay un título de su nivel antes), lo tuyo guarda un **fin** (`e`): el id del primer bloque que se ve
    después de lo escondido. Lo que sigue desde ahí se ve mientras el título siga colapsado; si se abre y se
    vuelve a colapsar, el fin se borra y se esconde toda la sección. Si el bloque del fin se borra, el fin pasa
    al bloque que quedó en su lugar. Si justo después de lo escondido ya hay un párrafo vacío que se ve, Enter
    va ahí en vez de crear otro.

## Cómo quedó (1a)

(Se completa con la implementación.)
