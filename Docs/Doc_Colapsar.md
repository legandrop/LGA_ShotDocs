# Colapsar secciones por sus títulos (P.11)

Estado: **diseño, sin implementar**. Las decisiones del final son propuestas: Lega todavía no las contestó.
Sale de leer el código de `main` (v0.050) y el de BlockNote 0.55. Lo pidió Lega: "como en Coda: cada título
se puede colapsar y abrir con un triángulo a su izquierda".

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

Propuesta:

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
todos, si se puede editar. No choca con nada de BlockNote 0.55 (sus atajos con Alt son `Mod-Alt-0` a `6`, `q`,
`c`) ni de la app (`p`, `s`, `m`); hay que probarlo en Mac, Windows y Linux. En el menú de la página, **Colapsar
todo** y **Abrir todo**, para vos.

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
anda en memoria. Se borra junto con la base local (`RemovedScreen.tsx`). **Más adelante (opcional):** que siga
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
| Arrastrar un título colapsado | **Se mueve la sección entera.** BlockNote arrastra todo lo elegido si el bloque está en la selección (`dragStart` de `SideMenu/dragging.ts`): en la captura del `dragstart` del tirador se elige del título al último bloque escondido (`MultipleNodeSelection`) y BlockNote hace el resto. El estado viaja con el id. Si da problemas, en la primera entrega se mueve solo el título. |
| "+" del menú lateral, o soltar algo justo debajo de un título colapsado | El bloque nuevo queda adentro de la sección: se abre. |
| Una selección que cruza una sección colapsada, y se borra o se escribe encima | Se borra también lo escondido (está en la selección), con un aviso: "Se borraron también 12 bloques escondidos" (Ctrl+Z lo trae). |
| Copiar o cortar | Lleva lo escondido (está en el documento). Al pegar, BlockNote da ids nuevos: lo pegado aparece abierto. |
| Tab / Shift+Tab sobre un título colapsado | Cambia de grupo y su sección se recalcula (los que eran sus hermanos pueden quedar a la vista). |
| Deshacer | Colapsar no se deshace. Si deshacer cambia algo escondido o deja la selección ahí, se abre. |
| Cambios de otros adentro de una sección escondida | Siguen escondidos. Si alguien agrega un título de igual o mayor nivel adentro, la sección se corta ahí y lo de abajo se ve; si pasa el título a párrafo, se ve todo. |
| Cursores de otros adentro de lo escondido | No se ven. |
| Ctrl+A | Elige todo, también lo escondido. |
| Buscar con Ctrl+F del navegador | **No encuentra lo escondido.** Más adelante: `hidden="until-found"` (Chrome y Edge lo encuentran y avisan con `beforematch` para abrir; en Safari y Firefox, a verificar). |

Los atajos van con prioridad sobre los de BlockNote (`KeyboardShortcutsExtension`, prioridad 50): lo mismo que
hoy hace `imageRowsExtension` con Enter y las flechas. Se confirma con las pruebas en jsdom.

## 6. Lo que abre una sección solo, y lo que no

- **"Ir al bloque" del panel de comentarios** (`revealBlock` en `commentsUi.ts`): antes del scroll y el
  resaltado, abre para vos todos los títulos que esconden el bloque (`hidersOf`). El editor registra esa
  función como ya registra la fuente de bloques (`setBlockSource`).
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

- **Las marcas de hoja en pantalla cuentan solo lo visible, casi sin cambios:** la vista para medir es una copia
  del DOM (`buildPrintView`) y se lleva las clases; `measureUnits` ya saltea lo que mide 0 de alto. Hace
  falta que el CSS de esconder valga también en `.print-view`, y que colapsar recalcule: `isContentMutation`
  ignora los cambios de `class` (por eso el atributo `data-sd-collapsed`, que sí cuenta; además cambia el alto,
  que ya mira el `ResizeObserver`).
- **El PDF, propuesta: con todo abierto por defecto** (es un documento para mandar), con la opción "Imprimir como
  se ve". Para imprimir todo abierto, `cleanCopy` saca las clases de colapso en la vista de salida.
- **Choca con la regla de `Doc_Hojas_PDF.md`, "lo que se ve es lo que sale":** con algo colapsado, las marcas de
  la pantalla (lo que se ve) y las hojas del PDF (todo abierto) no coinciden. Opciones: (a) lo propuesto, y las
  marcas siguen lo que se ve; (b) el PDF sale como se ve por defecto y la opción es "Imprimir todo abierto".
  **A decidir por Lega.**
- **La opción va en el menú de la página** (una casilla "Al imprimir, abrir todo", guardada en el dispositivo),
  no en un diálogo al imprimir: en el iPhone el diálogo de impresión tiene que abrirse en el mismo toque
  (`printPage.ts`). Ctrl/⌘+P usa la misma casilla. Solo se muestra si la página tiene algo colapsado.
- **Fotos que nunca se vieron:** una foto escondida puede no haber cargado. `imagesPending` (espera de hasta 8
  s) tiene que saltear las escondidas, y la copia abierta espera sus propias imágenes (`imagesLoaded`, ya
  está) antes de medir: sin la proporción de la foto en pantalla, la copia mide cuando carga.

## 8. Riesgos

1. **Teclado y selección alrededor de lo escondido:** cada navegador mueve el cursor distinto cerca de un
   `display: none`, y jsdom no lo reproduce. La regla general (sección 5) es la red; hace falta probar a mano
   Chrome, Safari, Firefox y el iPhone.
2. **Prioridad de los atajos** frente a los de BlockNote: si alguno corre antes (Supr, Retroceso, Enter), se
   une o se borra algo escondido. Lo cubren las pruebas con el editor real.
3. **Lugar del triángulo** frente al menú lateral de BlockNote, y en el teléfono, donde el margen es angosto.
4. **Encabezados plegables viejos:** el CSS que los neutraliza depende de clases internas de BlockNote.
5. **PDF:** la diferencia entre marcas y hojas mientras hay algo colapsado (sección 7), y la espera de fotos
   escondidas.
6. **Escribir el mapa sin permiso** dejaría una subida rechazada: por eso la doble revisión (sección 4).
7. **Ctrl+F no encuentra lo escondido.** Puede confundir en páginas largas.
8. **Lo tuyo vive en el navegador:** se pierde si se borran los datos del sitio (es solo la vista).
9. **Versiones viejas** ven todo abierto aunque alguien haya colapsado para todos (esperado; no pierden nada).

## 9. Entregas y pruebas

1. **Entrega 1, para vos:** `collapse.ts`, el plugin con todos los casos de la sección 5, el triángulo
   (computadora y teléfono), el atajo, "Colapsar todo" y "Abrir todo", abrir desde el panel de comentarios, el
   margen sin marcas escondidas, las marcas de hoja con lo visible, los encabezados plegables fuera de los
   menús y neutralizados, textos y docs. Lo tuyo ya se guarda con el `G` que viste (falso), así la entrega 2 no
   cambia el formato.
2. **Entrega 2, para todos:** el `Y.Map`, Shift+clic y el atajo con Shift, los tooltips completos, la regla
   entre los dos.
3. **Entrega 3:** la opción del PDF, la pista de lo escondido, la suma de comentarios en el título, el toque
   largo en el teléfono, y (si Lega quiere) lo tuyo en todos tus dispositivos y `hidden="until-found"`.

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
- **Hojas:** `measureUnits` con bloques escondidos; la vista de salida con todo abierto.
- **De punta a punta** (`colapsar.mjs`, en el repo de pruebas privado, sin escribir en la base de producción):
  pasar el mouse y ver el triángulo, colapsar un H1 con un H2 colapsado adentro y reabrir, flechas, Shift+clic
  con dos usuarios (quien edita y quien solo ve), recargar y que siga, imprimir con las dos opciones,
  arrastrar una sección, un encabezado plegable viejo. A mano: Safari de Mac, iPhone, Firefox.

## Decisiones (a confirmar por Lega)

1. **Por secciones, no por hijos:** nuestro triángulo en todos los títulos; los "encabezados plegables" de
   BlockNote salen del menú "/" y del selector de tipo, y los que ya existan se ven como títulos comunes.
2. **Para todos, en el documento de la página** (un `Y.Map` aparte del contenido): sin propiedad nueva, sin
   migración, sin subir `min_app_version`. Las versiones viejas ven todo abierto.
3. **Para vos, en el dispositivo.** Que siga a la persona en todos sus dispositivos, más adelante.
4. **Cuando alguien colapsa o abre para todos, lo tuyo de ese título deja de contar.**
5. **Teléfono:** triángulo siempre visible y tenue, un toque para vos; para todos, solo desde la computadora.
6. **Atajo Ctrl/⌘+Alt+Enter** (con Shift, para todos) y "Colapsar todo" / "Abrir todo" en el menú de la página.
7. **Enter al final de un título colapsado crea un título del mismo nivel después de la sección** (o abre la
   sección).
8. **Arrastrar un título colapsado mueve la sección entera.**
9. **"Borrar" en un título colapsado borra solo el título** y su contenido se ve.
10. **Borrar una selección que cruza lo escondido lo borra también**, con un aviso.
11. **El carrete muestra todas las fotos**, también las escondidas.
12. **PDF con todo abierto por defecto**, con la opción de imprimir como se ve; las marcas de la pantalla,
    como se ve. (Rompe "lo que se ve es lo que sale" mientras haya algo colapsado.)
13. **Sin pista de lo escondido** en la primera entrega ("…" o "12 bloques", más adelante si gusta).
14. **Colapsado para todos y para vos se ven igual**; solo cambia el tooltip.
15. **Un invitado con Editar sobre la página puede usar Shift+clic**, como puede editarla.
