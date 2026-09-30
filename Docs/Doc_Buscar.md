# Buscar en el proyecto y en la página (P.12)

Estado: **entrega 1 hecha (v0.051): buscar y reemplazar en la página; entrega 2 hecha (v0.054): buscar en el
proyecto (Ctrl/⌘+K); ajustes de v0.057 (lo que encontró Lega probando)**. "Correcciones de la auditoría" manda
sobre lo de arriba, y "Cómo quedó (entrega 1)", "Cómo quedó (entrega 2)" y "Ajustes de v0.057", al final, sobre
todo lo demás (el último, sobre los otros dos). Lo pidió Lega (urgente, 2026-09-30): "dos lupas: una a la izquierda del
+ de páginas, que busca en todo el proyecto y te lleva al lugar; otra a la izquierda de los comentarios, que
busca en la página abierta, también adentro de las secciones colapsadas". Después sumó **reemplazar**, como en
VS Code. Sale de leer el código de `main` (v0.050) y `Doc_Colapsar.md` (rama `lega/colapsar`, en diseño).

## Qué se pide

1. **Buscar en la página** (lupa a la izquierda del ícono de comentarios, **Ctrl/⌘+F**): una barra como la
   del navegador, con "3 de 12", anterior y siguiente; encuentra también lo que está en secciones colapsadas
   (P.11) y, al ir ahí, abre la sección.
2. **Reemplazar en la página**: la barra se despliega (una flecha a su izquierda, como en VS Code) y muestra
   el campo de reemplazo, con *Reemplazar* y *Reemplazar todo*. Solo quien puede editar la página.
3. **Buscar en el proyecto** (lupa a la izquierda del "+" de la barra lateral, **Ctrl/⌘+K**): títulos y
   contenido de todas las páginas del proyecto que la persona ve; tocar un resultado abre la página, va al
   lugar y lo resalta.
4. Sin distinguir mayúsculas ni tildes ("camara" encuentra "Cámara"), con partes de palabras.

## Reglas que no se rompen

- **Nunca se muestra nada de una página que la persona no ve**: ni un resultado, ni un título, ni un
  fragmento, ni la cantidad.
- **Buscar no cambia el documento.** Los resaltados son decoraciones de ProseMirror, como las marcas de
  guion (`scriptMarksPlugin`), las filas de fotos (`imageRowsPlugin`) y las marcas de hoja.
- **Reemplazar es una edición común**: pasa por el editor, se guarda y se sube como cualquier otra, y se
  deshace con Ctrl/⌘+Z.
- Sin tipo de bloque ni propiedad nueva, sin migración y sin subir `min_app_version`.
- Anda sin red, como el resto de la app.

## 1. Dónde está el texto, y qué tiene cada dispositivo

- El contenido de una página es un Y.Doc (`src/sync/docs.ts`, `PageDocs`) con el fragmento
  `CONTENT_FRAGMENT = 'document-store'` (`src/sync/structure.ts`). En el servidor solo hay updates de Yjs
  (`page_updates`, `push_page_update`, `pull_page_updates`): **no hay texto plano**. El título de la página no
  está en el Y.Doc: es `pages.title` (el árbol, `PageTree` en `src/sync/tree.ts`).
- **Cada dispositivo baja todas las páginas que la persona ve, de todos sus proyectos, no solo las que
  abrió.** Lo verifiqué en `SyncEngine.cycle` (`src/sync/engine.ts`): `fetchProjects()`, después
  `fetchTree(todos los proyectos)` (la tabla `pages` ya filtrada por la política `pages_select` →
  `private.can_view_page_row`), y después baja (`pullPage`, de a 4) toda página cuyo `update_seq` supera el
  `cursor` guardado. Queda en IndexedDB (`docUpdates` y `docState`).
- La papelera de archivos ya recorre todas las páginas guardadas sin abrir el editor: `docs.snapshot(pageId)`
  arma un Y.Doc aparte y `mediaIdsInDoc` (`src/media/usage.ts`) recorre el fragmento; se saltea lo que no
  cambió con una marca `version:cursor` (`reconcileMedia`). La búsqueda del proyecto hace lo mismo.
- **Lo que queda en el dispositivo aunque ya no se vea:** si le sacan a alguien el permiso sobre una página,
  el árbol deja de traerla (`setSnapshot` reemplaza todo), pero sus updates siguen en `docUpdates` (no hay
  limpieza). Por eso la búsqueda **filtra siempre por el árbol**, nunca por lo que haya guardado.

Datos reales (Wanka, consulta de solo lectura, 2026-09-30): 12 páginas (2 en la papelera) en 7 proyectos, 66
updates, 40 KB en total; la página más pesada, 34 KB en 50 updates. La base entera, 15 MB. Hoy todo es chico;
las cuentas de la sección 10 suponen proyectos de cientos de páginas.

## 2. Local o en el servidor: local

**Elegido: buscar en el dispositivo**, en las dos lupas.

| | En el dispositivo | Texto derivado en el servidor (`page_text` + búsqueda de Postgres) |
|---|---|---|
| Qué encuentra | Todo lo que la persona ve (se baja todo) | Lo mismo, si el texto está al día |
| Permisos | Los del árbol, que ya pasó por RLS | Una política más con `can_view_page` por fila (recursiva hasta la raíz: cara con muchos resultados) |
| Sin red | Anda | No anda |
| Al día | Incluye lo que se acaba de escribir, sin subir | Atrasado hasta que alguien lo suba (¿quién?) |
| Costo en Supabase (plan gratis) | Ninguno | Espacio, índice, y cada subida escribe dos veces |
| Quién escribe el texto | Nadie | El cliente (un editor podría poner cualquier texto y "envenenar" la búsqueda de los demás; una versión vieja no lo escribe) o una Edge Function con Yjs en cada subida (invocaciones, otra pieza que mantener). Postgres no lee Yjs |
| Invitados | Igual que el árbol | Igual, con la política |

El servidor serviría para lo que el dispositivo no tiene: la primera sincronización de un dispositivo nuevo
(mientras baja, los resultados avisan que faltan páginas) o si algún día se deja de bajar todo. **Se revisa
solo si pasa eso.** Los comentarios sí son otra historia (sección 4).

## 3. Permisos y papelera

- **Qué páginas entran:** las que el árbol muestra (`tree.get(id)`) del proyecto elegido
  (`useCurrentProject`), que no estén en la papelera (`tree.isTrashed(id)`, que mira también los padres).
  Es exactamente lo que se puede ver en la barra lateral. Vale igual para invitados (el árbol solo trae sus
  páginas) y para páginas creadas sin red que todavía no llegaron al servidor (son de la persona).
- Un update guardado de una página que ya no está en el árbol **no se lee**.
- Sin la base local (la pantalla "You no longer have access", `RemovedScreen.tsx`), no hay búsqueda.
- **Papelera:** afuera. Más adelante, una casilla "Incluir la papelera" (a confirmar).
- **El resultado de otra persona en el mismo navegador** no aparece: la base local es por workspace y usuario.
- **Buscar en la página** lo puede usar quien ve la página (nivel 1 o más). **Reemplazar**, solo con el editor
  editable (`editable` de `BlockEditor`: con permiso **y** con la página completa, `opening.complete`).

## 4. Qué se busca y cómo se compara

**Qué entra** (lo arma `src/search/extract.ts`, nuevo, recorriendo el Y.Doc como `mediaIdsInDoc`, sin el
editor y sin depender del esquema; la barra de la página hace lo mismo sobre el documento de ProseMirror):

| Dónde | Entra | Cómo |
|---|---|---|
| Título de la página | Sí (proyecto) | `pages.title` del árbol. En la barra de la página, no (es un `textarea`; se ve arriba) |
| Párrafos, títulos, listas, citas, código, tablas (cada celda) | Sí | El texto del bloque. Script y pregunta son párrafos: entran igual |
| Tarjetas de Drive | Sí, el texto del link | El `href` no |
| Fotos y videos: pie (`caption`) | Sí | Resultado "en el pie de una foto" |
| Adjuntos y fotos: nombre (`name`) | Sí | El nombre que el bloque guardó al soltarlo (`fileDrop.ts`); la tarjeta muestra `files.name`, que casi siempre es el mismo |
| Comentarios y respuestas | **No en la primera entrega** | El dispositivo solo baja los comentarios de las páginas que se abren (`comments.watch`): buscar ahí daría resultados incompletos. Más adelante, con una función en la base |
| Links (`href`), colores, ids | No | |

Cada bloque sale con su id (`blockContainer.id`), su tipo y su texto. Un salto de línea adentro del bloque
(`hardBreak`) o cualquier cosa que no es texto cuenta como separador: una búsqueda nunca lo cruza.

**Cómo compara** (`src/search/normalize.ts`, nuevo, lo usan las dos lupas):

- Se normalizan el texto y lo buscado: minúsculas (`toLocaleLowerCase`), sin tildes ni diéresis (NFD y fuera
  las marcas combinadas), con un mapa de cada carácter normalizado a su lugar en el original (para resaltar
  justo lo que se encontró, también con una "Í" descompuesta pegada desde macOS). **La ñ vale como n**, como el
  Ctrl+F de Chrome (a confirmar: "ano" encontraría "año").
- **Partes de palabras:** "cam" encuentra "cámara". Los espacios de más se juntan en uno.
- **Página:** lo escrito se busca como una frase, igual que el navegador.
- **Proyecto:** cada palabra por separado; una página entra si tiene todas (en el título o en cualquier
  bloque). Primero las que lo tienen en el título, después por cantidad.
- **Opciones como VS Code** (en la barra de la página, y en el proyecto más adelante): *Aa* (mayúsculas y
  tildes exactas) y *Palabra entera*. Expresiones regulares, más adelante.

## 5. Buscar en la página

**La barra** (`src/ui/FindBar.tsx`, nuevo, en la parte del editor que se baja aparte): abajo de la barra de
arriba, alineada a la derecha, fija al hacer scroll. Campo, "3 de 12", ↑ ↓, *Aa*, *Palabra entera* y ×.
En el teléfono ocupa todo el ancho y la tecla "Buscar" del teclado va al siguiente.

- **Enter** / **Shift+Enter**: siguiente / anterior (dan la vuelta). F3 y Ctrl/⌘+G también, con la barra
  abierta.
- **Esc**: cierra, saca los resaltados y deja la selección sobre la coincidencia actual (se puede escribir
  encima), con el foco en el editor.
- Se abre con lo elegido en el editor como texto de búsqueda, si es de una sola línea.
- Busca mientras se escribe (100 ms de espera). Con el documento cambiando (uno mismo o alguien más), se
  recalcula y la actual queda en la coincidencia más cercana a la de antes. Más de 1000: "más de 1000".
- Sin resultados: el campo en rojo suave y "Sin resultados".

**Resaltar** (`src/ui/findEditor.ts`, nuevo): un plugin de ProseMirror en una extensión (`createExtension`, como
`imageRowsExtension`) con su `PluginKey`. La búsqueda y la actual llegan por un `meta` de transacción (sin
tocar el documento). Recorre los bloques de texto (`doc.descendants`), arma el texto de cada uno con su mapa a
posiciones, busca y pone `Decoration.inline` con `sd-find-hit` (y `sd-find-current` en la actual). Para un pie o
un nombre, `Decoration.node` en el bloque (`sd-find-block`): el pie se subraya por CSS y la tarjeta del adjunto
(que es una imagen SVG) lleva un contorno; la barra dice "en el pie de una foto" o "en el nombre de un archivo".
Colores en variables del tema, distintos del amarillo de `comment-flash`.

**Ir a una coincidencia:** si está escondida en una sección colapsada, primero se abren para vos los títulos
que la esconden (la función que registra P.11 con `hidersOf`, la misma que usa "Ir al bloque" de los
comentarios; ver `Doc_Colapsar.md`, sección 6). Después, `scrollIntoView({ block: 'center' })` sobre el
elemento de `sd-find-current` (no sobre el bloque: un bloque largo quedaría con la coincidencia afuera).
Ninguna sección se abre solo por contar sus coincidencias. **Sin P.11 anda igual**: el gancho está vacío. La
barra dice cuántas están en secciones colapsadas ("3 de 12 · 4 en secciones colapsadas").

**Ctrl/⌘+F** (en `window`, solo con el documento de la página abierto, sin un diálogo ni el carrete abiertos:
`[aria-modal]`, `.modal`, `.modal-backdrop`, `.carrete`, porque no todos los diálogos, como mover, compartir o
miembros, tienen `aria-modal`):

- La primera vez abre nuestra barra (o, si ya está abierta, la enfoca y elige su texto) y hace
  `preventDefault`, así el navegador no abre la suya.
- **Con el foco en nuestra barra, Ctrl/⌘+F se deja pasar al navegador**: la segunda vez sale la del
  navegador, como pidió Lega. Esa no encuentra lo colapsado (con P.11 se puede sumar `hidden="until-found"`,
  ver `Doc_Colapsar.md`).
- Adentro de un `input` o `textarea` fuera del editor (el título, el panel de comentarios) también se deja
  pasar.

## 6. Reemplazar en la página

- **La flecha** a la izquierda del campo (como VS Code) despliega el segundo renglón: campo de reemplazo,
  *Reemplazar* y *Reemplazar todo*, y la opción *Conservar mayúsculas* más adelante. Sin permiso de edición
  (o con la página incompleta) la flecha no aparece. ~~Atajo: Ctrl+H / ⌘⌥F~~: sin atajo propio (decisión 8 de
  Lega); se abre con Ctrl/⌘+F y se despliega desde la barra.
- **Reemplazar:** cambia la actual y va a la siguiente.
- **Reemplazar todo (12):** **una sola transacción de Yjs**, escrita directo en el Y.Doc de atrás para adelante
  (ver "Cómo quedó"); y-prosemirror la pasa al editor de una vez: **un solo Ctrl/⌘+Z la deshace**. El botón
  reemplaza todas, también las que pasan de las 1000 que se cuentan y se marcan. Al terminar, un aviso "12
  reemplazos" con *Deshacer*.
- **Formato:** el texto nuevo toma **las marcas del primer carácter** de la coincidencia (negrita, color,
  link), puesto a mano (`schema.text(nuevo, marcas)` en `replaceWith`). Con `insertText` común se perdería el
  link si la coincidencia empieza justo en él (el link de Tiptap no es "inclusive"), y una tarjeta de Drive
  mira el `href` del link (`driveLinkInNode`). Si la coincidencia cruzaba dos formatos, queda con el primero.
- **Pies y nombres de archivo:** en la primera entrega **no se reemplazan**. Con la actual en un pie,
  *Reemplazar* la saltea con el tooltip "Los pies y los nombres de archivo no se reemplazan (todavía)", y
  *Reemplazar todo* avisa "2 en pies no se tocaron". Después, con `updateBlock` sobre `caption`.
- **Secciones colapsadas:** se reemplaza también ahí; solo se abre la sección de la actual. Esto choca con la
  regla de P.11 ("si una edición local toca algo escondido, esa sección se abre", `Doc_Colapsar.md`, sección
  5): **la transacción de reemplazo lleva un `meta` (`sd-find-replace`) y el plugin de colapsar no abre por
  ella**. La barra ya dijo cuántas había escondidas. Hay que sumarlo al diseño de P.11.
- Lo demás (el menú lateral, los comentarios anclados al id del bloque, las marcas de guion que se
  recalculan) sigue igual: los bloques no cambian de id.
- Reemplazar por vacío borra lo encontrado.

## 7. Buscar en el proyecto

**La lupa** va en `.section-title` de `Sidebar.tsx`, a la izquierda del "+" (`common.newPage`). **Se ve siempre**,
también para quien no puede crear páginas (hoy el "+" sale solo con `canCreateRoot`). Tooltip "Buscar en el
proyecto (Ctrl+K)".

**El panel** (`src/ui/ProjectSearch.tsx`, nuevo, se baja aparte con `Part` como los diálogos): en la
computadora, una ventana centrada arriba (como la de Notion o Linear); en el teléfono, a pantalla completa
(la barra lateral ya es un cajón: `.shell.nav-open`, y cerrarlo al cambiar de página ya lo hace `Workspace.tsx`).

- Campo arriba con el nombre del proyecto ("Buscar en *MGTZD*"). Vacío: las últimas páginas abiertas.
- **Resultados por página:** ícono y título (con lo encontrado resaltado), abajo el camino ("Brief ›
  Uruguay"), y hasta 3 fragmentos (unos 60 caracteres alrededor, con "…"), con "y 5 más en esta página". Un
  fragmento de un pie dice "Pie de foto:" antes. Hasta 50 páginas, con "Mostrar más".
- **Teclado:** ↑ ↓ entre páginas y fragmentos, Enter abre, Ctrl/⌘+Enter en otra pestaña, Esc cierra.
- **Estados:** "Sin resultados en este proyecto"; si faltan páginas por bajar (`update_seq > cursor`), una
  línea "Todavía bajando 8 páginas: puede faltar algo" (con red) o "Sin conexión: 8 páginas todavía no están
  en este dispositivo" (sin red); mientras se arma el índice, "Buscando…" con lo que ya haya.

**El índice** (`src/search/projectIndex.ts`, nuevo, sin React, como `projectSizes.ts`):

- Por página: la marca `version:cursor` de su `docState` y la lista de bloques normalizados. Se arma la
  primera vez que se abre el panel (no al abrir la app), de a tandas, cediendo el hilo entre páginas.
- Se rearma solo lo que cambió: se compara la marca (como `reconcileMedia`). Avisos: `docs.onLocalChange` y
  el fin de cada ciclo de sincronización marcan páginas como viejas; se rearman al buscar, con 300 ms de
  espera. Los títulos salen del árbol en el momento (`tree.getRevision()`).
- La página abierta sale de su documento vivo (`snapshot` ya hace `flush` antes de leer): lo recién escrito
  aparece.
- En memoria, por sesión. Guardarlo en la base local (`meta`, sin store nuevo ni cambio de versión de la base)
  solo si medir muestra que armarlo tarda.

## 8. Ir a un resultado

Hoy `/p/<uuid>` abre la página (`src/router.ts`, `pagePath`, `navigate`) y "Ir al bloque" de los comentarios
(`revealBlock` en `src/ui/commentsUi.ts`) hace scroll al bloque y lo resalta con `comment-flash`, pero solo
en la página abierta. No hay links a un bloque.

- Tocar un resultado guarda un pedido (`src/ui/findUi.ts`: página, búsqueda, id del bloque y cuál de sus
  coincidencias) y navega. Cuando el editor de esa página se monta (el mismo momento en que registra
  `setBlockSource`), toma el pedido: **abre la barra de la página con la búsqueda puesta**, elige esa
  coincidencia como actual y va ahí (sección 5, con las secciones colapsadas). Así se sigue con Enter por las
  demás de esa página, como en VS Code.
- Un resultado del título: abre la página arriba, sin barra.
- Si la página no bajó todavía, `PageView` ya espera hasta 4 s (`prefetchPage`); si el bloque no está (lo
  borraron recién), se abre la página con la barra y la búsqueda, en la primera coincidencia.
- La dirección no cambia (`/p/<id>`): el pedido vive en memoria. Un link a un bloque (`#b-<id>`) es otro tema.

## 9. Atajos y textos

- **Ctrl/⌘+F**: buscar en la página (sección 5). **Ctrl/⌘+K**: buscar en el proyecto, desde cualquier lugar
  de la app. Con texto elegido en el editor, Ctrl/⌘+K sigue creando un link (BlockNote,
  `CreateLinkButton`), la misma excepción que ya tiene hoy el selector.
- **Hoy Ctrl/⌘+K abre el selector de proyectos** (`ProjectSwitcher.tsx`, con su tooltip `project.switchTip`).
  Propuesta: Ctrl/⌘+K pasa a la búsqueda, y **el panel, con el campo vacío o con lo escrito, muestra también
  los proyectos que coinciden** ("Ir al proyecto *Wanka 2*"): cambiar de proyecto sigue a dos teclas. El
  selector se queda sin atajo propio. A confirmar.
- Textos en inglés y castellano: la lupa y su tooltip en `src/i18n/sidebar.ts` y `shell.ts`; la barra en
  `src/i18n/lazy/editor.ts`; el panel en una parte nueva (`lazy/search.ts`). "3 de 12" / "3 of 12".

## 10. Rendimiento

- **La página:** el documento de ProseMirror ya está en memoria. Recorrer unas decenas de miles de caracteres
  y normalizarlos es de pocos milisegundos; se recalcula con espera (100 ms) y solo con la barra abierta. Las
  decoraciones se limitan a 1000.
- **El proyecto:** el costo es leer de IndexedDB y armar un Y.Doc por página, una vez. Estimación (sin medir):
  un proyecto de 300 páginas de 50 KB son 15 MB de updates; armar cada Y.Doc toma del orden de milisegundos,
  así que la primera vez serían uno a pocos segundos, repartidos en tandas para no trabar la página, y después
  solo lo que cambió. Las páginas con muchos updates sin fusionar (se fusionan al abrirlas, `COMPACT_AT = 64`)
  cuestan más.
- **Web worker:** no en la primera entrega. Haría falta abrir IndexedDB y Yjs también en el worker. Se suma
  si una tanda pasa de 50 ms en un teléfono medio.
- La búsqueda sobre el índice ya armado es lineal y chica (texto en memoria): no hace falta un índice
  invertido.

## 11. Reemplazar en todo el proyecto (más adelante)

Como en VS Code: buscar en el proyecto, desplegar el reemplazo, ver la lista de cambios (cada coincidencia con
su casilla, agrupadas por página) y aplicar. Solo en páginas que la persona puede editar
(`perms.canEditPage`) y completas; las demás salen en la lista sin casilla ("solo lectura").

Por qué va en una entrega aparte:

- **Hay que modificar muchos Y.Doc sin editor.** O se monta un editor sin pantalla por página (pesado) o se
  edita el `Y.XmlText` directo (`delete` + `insert` con los atributos de formato del primer carácter), con una
  prueba contra el esquema para no dejar nada que el editor no acepte. Cada página abierta con `docs.open`, se
  guarda y se sube como una edición.
- **Deshacer por página:** el Ctrl/⌘+Z de cada editor no ve estos cambios. Haría falta un "Deshacer el
  reemplazo" propio, que guarde lo reemplazado y lo vuelva a poner solo donde el texto sigue igual.
- **Sin red:** queda todo pendiente en el dispositivo y se sube después; si mientras tanto le sacan el permiso
  sobre una página, esa subida se rechaza.
- **Choques:** si otra persona está escribiendo en el mismo lugar, Yjs une las dos ediciones (no se pierde
  nada, pero puede quedar texto mezclado). La lista se recalcula justo antes de aplicar.
- Muchas páginas a la vez son muchas subidas: de a tandas, con el estado de sincronización a la vista.

## Riesgos

1. **Primera sincronización de un dispositivo nuevo:** hasta que baja todo, el proyecto da resultados
   incompletos. Se avisa (sección 7); no se esconde.
2. **Tiempo del índice en proyectos grandes y teléfonos:** sin medir. Por eso en tandas y con la opción del
   worker.
3. **Ctrl/⌘+F:** tomarlo en el momento justo (sin romper el del título, el de los comentarios, el carrete, los
   diálogos) y dejar pasar el segundo. En Safari de Mac y en Firefox, a probar a mano.
4. **Ctrl/⌘+K:** deja de abrir el selector de proyectos (decisión de Lega pendiente); con texto elegido
   sigue siendo "link".
5. **Reemplazar y el formato:** una coincidencia que cruza negrita o un link queda con el formato del primer
   carácter. Una tarjeta de Drive sigue andando porque se conserva el `href`.
6. **Reemplazar con P.11:** hace falta la excepción del `meta` en el plugin de colapsar; si no, "Reemplazar
   todo" abriría todas las secciones.
7. **Normalizar:** la ñ como n, la "ß", las ligaduras y los emojis (pares sustitutos) con el mapa de
   posiciones. Lo cubren pruebas.
8. **Lo que queda guardado de páginas que ya no se ven** en IndexedDB: la búsqueda lo ignora (filtra por el
   árbol), pero sigue en el dispositivo. Borrarlo es otra tarea.
9. **Comentarios** afuera por ahora: alguien puede buscar algo que está en una respuesta y no encontrarlo.

## Entregas y pruebas

1. **Entrega 1, la página (independiente de P.11):** `normalize.ts`, `findEditor.ts`, `FindBar.tsx`, la lupa en
   la barra de arriba, Ctrl/⌘+F con el segundo al navegador, pies y nombres, el gancho para abrir secciones
   (vacío hasta P.11), **Reemplazar y Reemplazar todo** con *Aa* y *Palabra entera*, textos y docs.
2. **Entrega 2, el proyecto:** `extract.ts`, `projectIndex.ts`, la lupa en la barra lateral, el panel,
   Ctrl/⌘+K (con los proyectos en el panel, si Lega lo confirma), ir al resultado con la barra abierta, avisos de
   páginas sin bajar y sin red.
3. **Después:** reemplazar en pies y nombres, *Conservar mayúsculas* y expresiones regulares; incluir la
   papelera; buscar en todos los proyectos (ya están en el dispositivo); comentarios (con una función en la
   base, con la puerta de `can_view_page`); **reemplazar en todo el proyecto** (sección 11).

Pruebas:

- **Unidad:** `normalize` (tildes, "Í" descompuesta, ñ, mayúsculas, "İ", emojis, el mapa de posiciones, espacios
  juntos, palabra entera); `extract` sobre un Y.Doc armado con el editor real (párrafo con negrita y link,
  lista anidada, tabla, script, pregunta, tarjeta de Drive, foto con pie, adjunto con nombre, salto de línea,
  un tipo que el esquema no conoce); el índice (solo rearma lo que cambió de marca; una página que sale del
  árbol desaparece aunque siga guardada; una en la papelera no sale; un invitado ve solo lo suyo; faltan
  páginas por bajar); el orden de los resultados.
- **Editor real en jsdom** (como `mount()` de `fileDrop.test.ts`): las decoraciones y la cuenta; buscar no
  cambia el Y.Doc (mismo vector de estado); siguiente y anterior dan la vuelta; un update de otro documento
  recalcula; reemplazar conserva el link y la tarjeta de Drive; "Reemplazar todo" se deshace con un solo
  Ctrl/⌘+Z y los ids de los bloques no cambian; sin permiso no hay reemplazo; un pie no se reemplaza; el pedido
  de un resultado del proyecto abre la barra en la coincidencia justa.
- **Atajos (jsdom):** Ctrl/⌘+F toma la primera y deja pasar la segunda; no toma en el título, en un diálogo ni
  en el carrete; Ctrl/⌘+K con texto elegido en el editor no abre la búsqueda.
- **De punta a punta** (`buscar.mjs`, en el repo de pruebas privado, sin escribir en la base de producción):
  buscar "camara" en un proyecto con "Cámara" en tres páginas, ir al segundo resultado, seguir con Enter;
  reemplazar todo y deshacer; un invitado no ve resultados de páginas sin permiso; sin red; con P.11, una
  coincidencia escondida abre su sección. A mano: Safari de Mac, iPhone (la barra y el teclado), Firefox.

## Decisiones (respondidas por Lega el 2026-09-30)

1. **Atajos:** Ctrl/⌘+F busca en la página y Ctrl/⌘+K en el proyecto.
2. **Buscar y reemplazar, como VS Code:** la barra busca por defecto y se despliega con una flecha a su
   izquierda para mostrar el reemplazo, con *Reemplazar* (la actual y pasa a la siguiente) y *Reemplazar
   todo*. Primero en la página, solo para quien puede editarla (sin permiso la flecha no aparece), como
   ediciones comunes (un solo deshacer para "Reemplazar todo"), también en lo colapsado (abre solo la sección
   de la actual), con *Aa* y *Palabra entera*. En todo el proyecto, más adelante, con la lista de cambios y
   solo en las páginas que se pueden editar (sección 11).
3. **Ctrl/⌘+K pasa a la búsqueda**, y el panel muestra también los proyectos que coinciden (entrega 2).
4. **La ñ vale como n** al buscar, salvo con *Aa*.
5. **La papelera no entra** en la búsqueda del proyecto.
6. **Comentarios, no en la primera entrega.**
7. **Pies de foto y nombres de archivo:** se encuentran, pero no se reemplazan en la primera entrega.
8. **Sin atajo propio para reemplazar** (ni Ctrl+H ni ⌘⇧H): se abre con Ctrl/⌘+F y se despliega el reemplazo
   desde la barra. Esto manda sobre la sección 6 y la corrección 14.
9. **Primero la página** (entrega 1, con reemplazar), después el proyecto (entrega 2).

## Decisiones (a confirmar por Lega)

1. **Buscar en el dispositivo**, sin texto en el servidor (sección 2). Se revisa si un día se deja de bajar
   todo.
2. **El título de la página** se busca en el proyecto, no en la barra de la página (propuesto; así quedó la
   entrega 1).
3. **Esc deja elegida la coincidencia** (como VS Code), en vez de volver a donde estaba el cursor (propuesto;
   así quedó la entrega 1).

## Lo que no pude verificar

- Tiempos reales de armar el índice con muchas páginas (la base de hoy tiene 12): la sección 10 es una
  estimación.
- Que el Ctrl+F de Chrome trate la ñ como n y que Safari y Firefox permitan tomar Ctrl/⌘+F y ⌘⌥F sin
  problemas.
- Cómo guarda y-prosemirror un `hardBreak` y una tabla dentro del Y.Doc: el recorrido es genérico (todo
  `Y.XmlText` debajo del bloque), pero lo fija una prueba con el editor real.
- ~~El diseño de P.11 está en curso~~: P.11 (entrega 1a, v0.053) registra `setFindCollapseHooks` desde su plugin (`collapseEditor.ts`).

## Correcciones de la auditoría (mandan sobre lo de arriba)

Una auditoría independiente contrastó el diseño con el código (y-prosemirror, el router, `PageDocs`, la
impresión). El modelo (buscar en el dispositivo, decoraciones, reemplazar como edición común) se mantiene.
Cambios:

1. **Un solo deshacer, de verdad.** El `UndoManager` de y-prosemirror junta lo que pasa en 500 ms
   (`captureTimeout`): un "Reemplazar todo" rápido después de escribir quedaba en el mismo paso que lo escrito
   (verificado). Se llama `undoManager.stopCapturing()` justo antes y justo después de cada reemplazo. El
   *Deshacer* del aviso solo deshace mientras el último paso de la pila sea ese reemplazo.
2. ~~**Una transacción por coincidencia**~~ (la segunda auditoría la reemplazó: era lenta, ver "Cómo quedó"):
   **una sola transacción de Yjs** con un `delete` + `insert` por coincidencia (cambios mínimos, no el tramo
   entero), entre los dos `stopCapturing()`. Con una sola transacción de ProseMirror por párrafo, `updateYText`
   borraba y volvía a escribir todo lo que hay entre la primera y la última coincidencia.
3. **Deshacer y rehacer un reemplazo no abren secciones colapsadas.** El `meta` (`sd-find-replace`) solo marca
   la transacción original; al deshacer, P.11 abriría todo. Se marca también el paso de la pila (en
   `stack-item-added`, `stackItem.meta.set('sd-find-replace', true)`), y P.11 no abre secciones al deshacer o
   rehacer un paso marcado.
4. **Reemplazar se bloquea en el código**, no solo escondiendo la flecha: cada comando de reemplazo revisa
   `editor.isEditable` (permiso **y** página completa). Prueba: el reemplazo de quien solo ve deja el vector
   de estado igual.
5. **Una sola función que saca el texto de cada bloque**, alimentada por el Y.Doc (proyecto) y por el
   documento de ProseMirror (página), así los números de coincidencia son los mismos. El proyecto busca
   palabras y la página frases: el resultado del proyecto le pasa a la página el término que coincidió en
   ese bloque (o un modo "palabras").
6. **Ir a un resultado:** `navigate()` no hace nada si ya se está en esa dirección (`router.ts`), y ahí el cajón
   del teléfono no se cierra; `BlockEditor` se vuelve a montar al cambiar su `key` (`PageEditor.tsx`). El pedido
   queda en un store por instancia de servicios, que se consume cuando el editor de esa página está listo (o
   enseguida si ya lo está); el estado de la barra vive arriba del `BlockEditor` y se vuelve a aplicar al
   remontarlo.
7. **Leer páginas cuesta:** `docs.snapshot()` junta todas las filas guardadas; una página sin compactar puede
   tardar segundos. La página abierta se lee del Y.Doc vivo (un `peek` nuevo en `PageDocs`); al indexar, se
   compacta con el candado (reusando `loadInto`); desde la entrega 2 se guarda el texto sacado con su marca en
   `meta`. Si se usa un worker, se le pasan los bytes: nunca abre IndexedDB.
8. `docs.onLocalChange` es un solo lugar que ya usa la sincronización (`engine.ts`): pasa a ser un conjunto
   de escuchas.
9. **Formato al reemplazar:** `insertText` conserva el link si el rango empieza adentro, pero lo pierde si la
   coincidencia termina justo al final del link (el texto entero de una tarjeta de Drive). Reemplazar el texto
   entero de un link por nada borra el `href` y rompe la tarjeta: eso se saltea con un aviso.
10. **Normalizar:** el final de una coincidencia se extiende sobre las marcas combinadas que siguen
    (`\p{M}`); `toLowerCase()` y no `toLocaleLowerCase()`; se recorre por punto de código. NFD no descompone
    ligaduras, ø ni ł: se usa NFD y no se promete eso. "ß" no es "ss" (documentado).
11. Sin Ctrl/⌘+Enter "abrir en otra pestaña": la base local es de una pestaña a la vez.
12. Con el campo vacío, el panel del proyecto no muestra "últimas páginas": no hay de dónde sacarlas (se
    guarda solo la última por proyecto). Se saca, o se suma una lista chica más adelante.
13. **Impresión:** `STATE_CLASSES` de `printView.ts` saca también `sd-find-hit`, `sd-find-current` y
    `sd-find-block`, y la barra no entra en la copia.
14. **Atajos:** `Mod` (⌘ en Mac, Ctrl en el resto); las teclas con Alt se comparan por `e.code`. Reemplazar:
    **⌘⇧H en Mac** (como Google Docs) y **Ctrl+H** en Windows y Linux.
15. **Permisos al buscar:** el árbol (`tree.get`, `isTrashed`) se mira al momento de buscar, y los resultados se
    redibujan con `tree.getRevision()`. El índice y el pedido son de cada instancia de servicios (como
    `projectSizes.ts`), no del módulo.
16. La marca para saber si una página cambió no es la de la papelera de archivos
    (`${version}:${cursor}:${trash}`, y `reconcileMedia` saltea las páginas que no se editan o están a medio
    bajar): no se copian esos filtros.
17. **Extracción:** los hijos anidados (`blockGroup`) son bloques propios, no se suman al de arriba; las páginas
    `unreadable` entran en el aviso "puede faltar algo"; las decoraciones se mapean en cada `docChanged`.
18. **Antes de reemplazar** se revisa que el texto de la coincidencia actual siga siendo el buscado (alguien
    pudo cambiarlo).

Y: sumar los proyectos al panel de Ctrl/⌘+K esperaba la decisión de Lega (respondida: sí, en la entrega 2).

## Cómo quedó (entrega 1, v0.051)

Buscar y reemplazar en la página, con las correcciones de las dos auditorías (la del diseño, arriba, y la del
código, al final). Donde esto y lo de arriba no coinciden, vale esto.

- **`src/search/normalize.ts`:** `normalize` (texto normalizado con el mapa al original), `normalizeQuery`,
  `findIn`, `searchText` y `searchNormalized` (con el texto ya normalizado). Sin *Aa*: NFD por punto de código,
  sin marcas combinadas, `toLowerCase()` (la ñ vale como n, la "İ" como i; "ß" no es "ss"; ligaduras, ø y ł
  quedan como están). Con *Aa*: NFD sin sacar nada, y una coincidencia que corta una letra con tilde
  descompuesta no cuenta. Una coincidencia tiene que empezar y terminar en el borde de un carácter del original
  (NFD separa una sílaba coreana en letras: "하" no encuentra la mitad de "한"). Los espacios seguidos (también
  el de no separar) valen uno. El final se extiende sobre lo que va pegado al último carácter: marcas
  combinadas, el selector de variante (U+FE0F), el tono de piel y lo que une un ZWJ (👩‍💻), así no queda nada
  suelto al reemplazar.
- **`src/search/extract.ts`:** la regla de qué texto tiene cada bloque, con dos entradas que dan lo mismo en el
  mismo orden (lo fija una prueba): `unitsFromPM` (el editor abierto, con las posiciones de cada tramo y el nodo)
  y `unitsFromYDoc` (el Y.Doc guardado, para la entrega 2). Un salto de línea, y un "\n" adentro del texto (los
  renglones de un bloque de código), es `\uFFFC`: no es un espacio, nunca une ni se cruza. Los hijos anidados
  son bloques propios; pie y nombre, unidades aparte.
- **`src/ui/editorMeta.ts`:** `FIND_REPLACE_META = 'sd-find-replace'` (y `BACKGROUND_META`), el mismo archivo que
  en la rama de P.11, igual byte a byte, para que las dos ramas se unan sin choques.
- **`src/ui/findEditor.ts`:** el plugin (`findExtension`, en la lista `extensions` del editor de
  `PageEditor.tsx`) con las coincidencias (hasta 1000; "de más de 1000"), la actual y las decoraciones
  (`sd-find-hit`, `sd-find-current`, y para un pie o un nombre `sd-find-block` en el contenido del bloque).
  - **Cambios del documento:** las marcas se corren y se vuelve a buscar cuando se deja de escribir 150 ms (cada
    cambio corre la espera; nunca en medio de una composición, `view.composing`). El texto normalizado de cada
    bloque se guarda por nodo de ProseMirror (`WeakMap`): lo que no cambió no se vuelve a normalizar. **Un cambio
    de otro dispositivo** llega como "reemplazar el documento entero" (así trabaja y-prosemirror) y corrido por
    esa transacción todo resaltado se juntaba en un punto por 150 ms: se corre solo por el tramo que de verdad
    cambió (`findDiffStart`/`findDiffEnd`, un `StepMap` angosto). La actual se guarda también como posición
    relativa de Yjs, que sigue al texto aunque cambie el documento entero.
  - **Lo escondido:** una coincidencia adentro de una "Lista plegable" cerrada de BlockNote (`toggleListItem`, o
    un título plegable viejo: `data-show-children="false"` en su `.bn-toggle-wrapper`) cuenta como escondida
    ("3 escondidas"); al ir a ella se abren las listas de arriba con su propio botón (así BlockNote guarda que
    quedaron abiertas). Lo mismo con las secciones colapsadas de P.11, con el gancho
    `setFindCollapseHooks({ isHidden, reveal })` (sin registrar, no hace nada).
  - **Llevar a la vista:** `scrollIntoView` al centro (con `scroll-margin`), y si igual queda debajo de la barra
    de buscar (arriba de todo, donde no se puede desplazar más), la barra baja hasta dejarla a la vista.
  - **Reemplazar:** `replaceCurrent` y `replaceAll` revisan `editor.isEditable` (sin permiso o con la página
    incompleta no hacen nada: `blocked: 'readonly'`) y nunca escriben una coincidencia vacía. *Reemplazar*
    (una) va por ProseMirror, con las marcas del primer carácter (`replaceWith`), después de volver a buscar
    desde la posición relativa de la actual (solo si es exactamente la misma; si no, `blocked: 'changed'`).
    **"Reemplazar todo" escribe directo en el Y.Doc:** ubica cada coincidencia en su `Y.XmlText`
    (`absolutePositionToRelativePosition` desde su primer carácter y `createAbsolutePositionFromRelativePosition`),
    comprueba que ahí esté exactamente el texto encontrado, y en **una sola transacción de Yjs** con el origen
    del editor (`ySyncPluginKey`), de atrás para adelante, hace `delete` + `insert` con los atributos (las
    marcas) del primer carácter. y-prosemirror la lleva al editor de una vez, se guarda y se sube como cualquier
    edición, y queda un solo paso de deshacer (entre dos `stopCapturing()`, separado de lo escrito justo antes);
    deshacerlo deja el documento igual que antes. Si alguna no se puede ubicar o su texto no coincide, va por
    ProseMirror (una transacción por coincidencia, igual en un solo paso). **Medido en jsdom:** 1050 reemplazos
    en una página de 300 bloques, unos 110 ms (antes, una transacción de ProseMirror por coincidencia: 500 en
    unos 1,1 s, y de 3 a 10 s en un teléfono). Se saltea lo que borraría un link entero (vacío, o una
    coincidencia que empieza afuera del link y lo cubre: la tarjeta de Drive se quedaría sin `href`); pies y
    nombres se cuentan y no se tocan.
  - **Marcas para P.11:** la transacción de *Reemplazar* lleva el `meta` `FIND_REPLACE_META`; la de "Reemplazar
    todo" la arma y-prosemirror (llega como un cambio del Y.Doc) y la reconoce `isFindReplaceTransaction(tr)`. El
    paso de deshacer lleva `FIND_REPLACE_META` en `stackItem.meta` (en `stack-item-added`), y también el paso
    que sale de deshacerlo o rehacerlo, si el que se aplica estaba marcado. Mientras se deshace o se rehace un
    reemplazo, `undoManager.currStackItem.meta.get(FIND_REPLACE_META)` es `true` (`isFindReplaceUndo(state)`):
    así lo mira P.11 para no abrir secciones.
  - **Marcas de hoja:** resaltar parte y vuelve a unir los nodos de texto del DOM y `SheetBreaks` lo tomaba como
    un cambio del documento (repaginaba con cada tecla). `takeFindOnlyChanges()` dice si en el editor solo
    cambiaron los resaltados; `countsForSheets` no cuenta entonces lo de adentro del editor (los altos los
    sigue mirando el `ResizeObserver`).
- **`src/ui/findUi.ts`:** el estado de la barra (abierta, desplegada, lo buscado, el reemplazo, *Aa*, *Palabra
  entera* y el aviso del último reemplazo), afuera del editor: al volver a montarse el editor la búsqueda y el
  aviso siguen. El foco va al campo solo con un pedido nuevo (`takeFocusRequest`): al volver a montarse la barra
  no le roba el foco al panel de comentarios ni abre el teclado del teléfono. Atajos con la plataforma como
  parámetro (para probar la Mac): `isFindShortcut` (Ctrl+F; ⌘F en la Mac) e `isStepShortcut` (F3, Ctrl/⌘+G). Se
  mira la letra que escribe la tecla y la posición (`code`) solo si no es una letra latina: con Dvorak, Ctrl+U o
  Ctrl+I no son buscar. `takesFindShortcut` (se deja pasar al navegador con el foco en la barra, en un campo
  fuera del editor, como el título o los comentarios, y con un diálogo o el carrete abiertos) y
  `takesStepShortcut` (F3 y Ctrl/⌘+G desde la barra o el editor, sin diálogo; si otro ya tomó la tecla, no).
- **`src/ui/FindBar.tsx`:** la barra, en la parte del editor (textos en `src/i18n/lazy/editor.ts`). Un ancla
  pegajosa sin alto debajo de la barra de arriba; en la computadora flota a la derecha de la página, en el
  teléfono ocupa su lugar a todo el ancho. Campo, "3 de 12", *Aa*, *ab* (palabra entera), ↑ ↓ y ×; la flecha de
  reemplazar solo si se puede editar. Enter / Shift+Enter, F3 y Ctrl/⌘+G (con Shift, la anterior); Esc cierra,
  saca los resaltados y deja elegida la coincidencia. Enter y Esc a medio escribir con un IME son de la
  composición. Al abrir toma lo elegido en el editor (una línea, hasta 200 caracteres). Abajo, "en un pie", "en
  el nombre de un archivo", cuántas están escondidas y el resultado de reemplazar ("2 reemplazos · Deshacer", lo
  que no se tocó); *Deshacer* solo mientras el último paso de la pila sea ese reemplazo.
- **`PageEditor.tsx`:** Ctrl/⌘+F en `window`, solo con el documento abierto (mientras carga, la del
  navegador); la barra arriba del `BlockEditor` (que avisa su editor con `onEditor`) y también mientras el
  editor se vuelve a abrir, en el mismo lugar (no se desmonta). **`Workspace.tsx`:** la lupa a la izquierda del
  ícono de comentarios ("Buscar en la página (Ctrl+F)").
- **Impresión:** la barra no entra en la copia y las clases de lo resaltado se sacan (`printView.ts`).
- Sin atajo para reemplazar (Lega). Sin cambios en la base, en el esquema ni en `min_app_version`.

**Pruebas (752 en total):** `src/search/normalize.test.ts` (tildes, ñ, Í descompuesta, *Aa*, İ, ß, ø,
espacios, palabra entera, emojis, coreano, emojis compuestos, el separador); `src/ui/findEditor.test.ts`, con el
editor real (el Y.Doc y el editor dan las mismas unidades, también con un bloque de código; un tipo desconocido
se lee; buscar no cambia el vector de estado; siguiente y anterior dan la vuelta; cerrar deja elegida la
actual; tilde descompuesta; *Aa* y palabra entera; un cambio vuelve a buscar; el gancho de P.11; "Reemplazar
todo" un solo deshacer aunque se haya escrito justo antes; el paso marcado al deshacer y rehacer, y que
`isFindReplaceUndo` da `true` mientras se aplican; *Reemplazar* y pasar a la siguiente; quien no edita no
cambia nada; el link y la tarjeta de Drive; pies que no se tocan; un cambio de otro en la coincidencia frena, en
otra parte no; una sola actualización de Yjs con el formato conservado y el deshacer que deja el documento
igual; 300 bloques en menos de 600 ms; coreano; emoji con tono; renglones de código; los resaltados que siguen en
su lugar con un cambio de otro; la lista plegable cerrada; resaltar que no repagina y escribir que sí);
`src/ui/findBar.test.tsx` (los atajos en la Mac y en el resto, con Dvorak y con un teclado ruso; cuándo pasa al
navegador, también con un diálogo sin `aria-modal`; la cuenta, Enter y Shift+Enter, Esc, lo elegido al abrir,
sin flecha para quien no edita, reemplazar todo con *Deshacer*, el editor que se vuelve a montar, la barra que
no roba el foco y conserva el aviso, el IME; y con la página real: Ctrl+F, quien solo ve y la página a medio
bajar). De punta a punta: `find.mjs` en el repo de pruebas privado (Chromium, usuario temporal que se borra al
final): Ctrl+F abre la barra y la segunda vez pasa al navegador, "1 of 2" sin tildes, Enter y Shift+Enter, *Aa*,
reemplazar todo y un solo deshacer, Esc con la coincidencia elegida, lo reemplazado sigue después de recargar
(se subió), la barra que se corre para no tapar una coincidencia arriba de todo, la lupa de arriba y el
teléfono.

**Auditoría del código (independiente, 2026-09-30).** Nada bloqueante. Arreglado todo lo que encontró: "Reemplazar
todo" lento (ahora en una transacción de Yjs), los resaltados que se juntaban con cada cambio de otro, las
listas plegables cerradas, la barra que se desmontaba al reabrirse el editor (perdía el aviso y robaba el foco),
coreano, bloques de código y emojis compuestos, las marcas de hoja que se recalculaban con cada resaltado, la
espera al escribir (de verdad, sin IME y con lo normalizado guardado), los diálogos sin `aria-modal`, Ctrl+F
mientras carga, F3 y Ctrl/⌘+G con otro teclado o en otro campo, Enter y Esc con un IME, y la barra que podía tapar
la coincidencia.

**Verificación de las correcciones (independiente, 2026-09-30).** Nada bloqueante; "Reemplazar todo" directo en
Yjs aguantó todos los intentos de romperlo. Arreglado además:

- **Contar lo escondido** (la barra lo pide en cada dibujo) buscaba en todo el DOM por cada bloque con
  coincidencias: 16 s con 1000 en jsdom. Ahora, si no hay ninguna lista plegable cerrada (y P.11 no dice que haya
  algo colapsado, `anyHidden`), no recorre nada; si hay, una sola pasada junta los ids de lo que esconden, y el
  resultado se guarda por lista de coincidencias mientras no se abra ni se cierre ninguna lista. Prueba: 1000
  coincidencias con una lista cerrada, menos de 300 ms la primera vez y casi nada la segunda.
- **La espera al escribir** tiene un tope: escribiendo sin parar, igual se vuelve a buscar cada segundo (nunca en
  medio de una composición).
- **Un cambio de otro que toca varios bloques** en una misma transacción (dos lugares lejanos) vuelve a buscar
  enseguida: corrido por un solo tramo, lo del medio se juntaba.
- **Abrir una lista plegable o una sección** para llegar a una coincidencia cuenta como cambio para las marcas de
  hoja, aunque en el mismo momento cambien los resaltados.
- **"Reemplazar todo" en Yjs** exige además que el texto ubicado sea del mismo bloque que encontró la búsqueda
  (si no, va por ProseMirror). Prueba con dos párrafos iguales.

**Queda para después:** la búsqueda del proyecto (entrega 2, con las correcciones 5 a 8, 11, 12, 15 a 17);
reemplazar en pies y nombres, *Conservar mayúsculas* y expresiones regulares; probar
a mano Safari de Mac, iPhone y Firefox (Ctrl/⌘+F, el teclado del teléfono, los IME).

**Con P.11 (v0.053):** el plugin de colapsar registra `setFindCollapseHooks(view, hooks)`, por vista (`isHidden`,
`reveal` para vos, `anyHidden`) y no abre nada por `isFindReplaceTransaction` ni por deshacer o rehacer un reemplazo (la entrada de
la pila marcada con `FIND_REPLACE_META`). Lo prueban `collapseFind.test.ts` (contar lo escondido, ir a una
coincidencia escondida abre solo esa sección, "Reemplazar todo" adentro de secciones colapsadas y su deshacer y
rehacer las dejan colapsadas) y `find.mjs`.

## Cómo quedó (entrega 2, v0.054)

Buscar en todo el proyecto, con las correcciones 5 a 8, 11, 12 y 15 a 17 y lo que pidió la auditoría del código
(al final). Donde esto y lo de arriba no coinciden, vale esto.

- **Cada dispositivo tiene todas las páginas:** verificado en `SyncEngine.cycle` (`fetchTree` de todos los
  proyectos y `pullPage` de toda página con `update_seq > cursor`), y de punta a punta: un teléfono que entra
  por primera vez encuentra el texto de una página que nunca abrió.
- **`src/sync/docs.ts`:** `onLocalChange` pasó a ser un conjunto de escuchas (`subscribeLocalChange`, corrección
  8); cada escucha va en su `try/catch` (uno que falla no deja sin aviso a los demás ni frena la suma de la
  versión; el error va a la consola), y la sincronización suelta el suyo en `engine.stop()`. `peek(pageId)` da el Y.Doc vivo de una página
  abierta (ya cargado y sin `stale`), sin abrirla. `indexSnapshot(pageId)` lee lo guardado con el candado de la
  página, **primero el estado y después el contenido** (si algo cambia en el medio, el contenido es más nuevo
  que la marca y se vuelve a leer; nunca al revés), y con más de 64 updates sueltos los fusiona (`loadInto`,
  corrección 7). No mira si esta versión puede mostrar la página: la búsqueda lee el texto sin depender del
  esquema (un tipo de bloque desconocido también se encuentra), así que no falta nada por eso.
- **`src/search/projectIndex.ts`** (`ProjectIndex`, sin React, como `projectSizes.ts`):
  - **Qué páginas:** las de la barra lateral del proyecto abierto (raíces e hijas, sin la papelera), en ese
    orden. **Al buscar** se vuelve a mirar el árbol: `tree.get`, el proyecto y `isTrashed` (corrección 15). Una
    página que salió del árbol (le sacaron el permiso) no da nada aunque siga en IndexedDB o en el índice.
  - **Por página:** las unidades de `unitsFromYDoc` (la misma regla que la barra; los hijos anidados, pies y
    nombres son unidades propias, corrección 17) con su texto normalizado (sin el mapa al original), y una
    marca: `version:cursor` del `docState` (sin los filtros de la papelera de archivos, corrección 16) más las
    páginas que avisa `subscribeLocalChange` (una edición guardada se vuelve a leer aunque la suma de la versión
    falle). La página abierta sale de `docs.peek`, con lo recién escrito aunque no esté guardado; su marca es
    `live:<número del documento>:<cambios>` (`doc.on('update')`: cuenta también los borrados, que no mueven el
    vector de estado). El índice no guarda el documento: uno cerrado y destruido no queda retenido.
  - **Cuándo lee:** la primera vez que se abre el panel (no al abrir la app), y después, con el panel abierto,
    en cada búsqueda, al terminar cada sincronización y con cada cambio del árbol; solo lo que cambió de marca.
    Cede el hilo cada ~12 ms; **avisa lo leído a lo sumo cada 250 ms** (cada aviso vuelve a buscar) y al
    terminar. `building` ("Buscando…") se prende **solo si alguna página cambió de marca**: una búsqueda o una
    sincronización sin cambios no lo prende. Antes de cada página espera si hay ediciones sin guardar (fusionar no les
    demora el guardado), con un tope de 2 s para toda la pasada y sin esperar si guardar está fallando (sin
    espacio: no se arregla solo; antes eran hasta 1 s por página, unos 17 minutos con mil páginas), y **cerrar el panel corta la pasada** (`cancel`; lo leído queda). Un
    error de la base (se está cerrando) no rompe nada: se intenta la próxima vez.
  - **Buscar:** cada palabra por separado (`parseWords`: sin repetir, sin las que quedan vacías), sin
    mayúsculas ni tildes, la ñ como n, con partes de palabras; una página entra si tiene todas, en el título o
    en cualquier bloque. **Para ordenar se cuenta con `indexOf` sobre el texto normalizado, sin mapas**; los
    mapas y los fragmentos se arman solo para las páginas que se muestran (y no se guardan). Orden: todas las
    palabras en el título, alguna en el título, el resto; después por cantidad de coincidencias y, a igualdad,
    el orden de la barra lateral. Hasta 50 páginas, con "Mostrar más". **Una sola letra busca solo en los
    títulos** (en el texto coincide con casi todo); el panel lo dice. No en chino, japonés y otras escrituras
    donde un carácter es una palabra: ahí se busca también en el texto. `total` (la cantidad de páginas) puede
    contar de más una página que queda fuera de las que se muestran y cuyas únicas coincidencias no se confirman
    con el mapa (solo con medias sílabas coreanas): se deja así.
  - **Fragmentos:** hasta 3 por página, **el mejor primero** (el bloque con más palabras distintas; a igualdad,
    el orden del documento), unos 110 caracteres desde un poco antes de la primera coincidencia, sin partir
    palabras, con "…", todo lo encontrado resaltado y "y N más en esta página". Un pie dice "Pie de foto:" y un
    nombre "Nombre del archivo:". Cada fragmento lleva **la palabra que coincidió primero en ese bloque** (como
    se escribió) y **cuál de las de esa palabra en el bloque es** (contando las unidades de antes del mismo
    bloque: pie y nombre incluidos), que es como las cuenta la barra (corrección 5). Los tramos se confirman con
    el mapa (una coincidencia que corta un carácter del original, como media sílaba coreana, no cuenta): una
    página que al final no tiene nada confirmado no se muestra.
  - **Avisos:** páginas con `update_seq > cursor` (y no creadas acá sin subir): "Todavía bajando N páginas:
    puede faltar algo" o, sin red, "Sin conexión: N páginas todavía no están en este dispositivo"; páginas con
    `unreadable`: "N páginas no se pudieron leer enteras en este dispositivo: puede faltar algo" (corrección 17).
  - **Medido** (fake-indexeddb en Node, 1000 páginas de 10 párrafos): el índice la primera vez, ~1,1 s; la
    primera búsqueda amplia ("de la", en todas), ~20 ms (antes de la auditoría, ~650 ms: armaba mapas y
    fragmentos de todas las páginas); una letra, ~2 ms; dos palabras poco comunes, ~8 ms; releer sin cambios,
    ~6 ms. La prueba tiene esos topes con `SHOTDOCS_STRICT_PERF=1` (5 s, 150 ms, 30 ms, 100 ms, 500 ms) y cinco
    veces más sin él, para no fallar por el reloj con la máquina cargada.
  - **No se guarda nada en `meta`** (desvío aceptado de la corrección 7): el índice es en memoria, por sesión.
    La contra: **en cada apertura de la app, el primer Ctrl/⌘+K vuelve a leer todas las páginas del proyecto**
    (en un teléfono, con muchas páginas, "Buscando…" un rato y resultados que van apareciendo). Se revisa si en
    un teléfono tarda de verdad.
- **`src/ui/projectSearchUi.ts`** (siempre cargado): `searchSession(services)`, una por instancia de servicios
  (se guarda por `docs`), con el índice (se arma la primera vez que se pide), si el panel está abierto y **el
  pedido de ir a un resultado** (página, palabra, bloque y cuál; vence al minuto). `Workspace.tsx` la suelta
  (`disposeSearchSession`: el índice deja de escuchar y se libera) al cerrar sesión o cambiar de workspace.
  `isSearchShortcut` (**Ctrl+K; en la Mac solo ⌘K**, con `modPressed` e `isLetter` de `findUi.ts`) y
  `takesSearchShortcut` (no con texto elegido en el editor, que es "link" de BlockNote, ni con otro diálogo o
  el carrete abiertos).
- **`src/ui/ProjectSearch.tsx`** (se baja aparte, `lazyDialogs.ts`; textos en `src/i18n/lazy/search.ts`): el
  panel, `role="dialog"` con `aria-modal`, arriba al centro en la computadora y a pantalla completa en el
  teléfono. Campo "Buscar en *MGTZD*" (combobox con `aria-activedescendant`), 120 ms de espera al escribir.
  - Vacío: una línea de ayuda y **todos los proyectos**, el abierto marcado (sin "últimas páginas", corrección
    12). Con algo escrito: **los otros proyectos** cuyo nombre tiene todas las palabras (hasta 5, arriba; el
    abierto no, porque elegirlo solo cerraría el panel) y las páginas; la opción activa es siempre la primera.
    **Si ningún proyecto coincide y la persona puede crear proyectos** (las mismas reglas que el selector), al
    final de la lista "Proyecto nuevo «…»" (el nombre, hasta 200 caracteres, como la base y el selector). Como un
    proyecto no se puede borrar, se ofrece **solo con los resultados al día**: lo escrito ya se buscó (no un nombre
    a medio corregir), el índice no está leyendo y no faltan páginas por bajar. Y **Enter lo crea solo si la
    persona llegó a esa opción con las flechas** (nunca por ser la primera o la única, ni con el mouse encima); un
    clic lo crea.
  - **Teclado:** ↑ ↓ por todas las opciones (dan la vuelta), Enter; Esc cierra con el foco en cualquier lado del
    panel; Tab no sale del panel. Al cerrar sin ir a ningún lado (Esc, la cruz, afuera o Ctrl/⌘+K otra vez) el
    foco vuelve adonde estaba. Sin Ctrl/⌘+Enter (corrección 11).
  - **"Buscando…"** aparece solo si la lectura sigue después de 300 ms; "Sin resultados" no aparece mientras
    se lee.
  - **Accesibilidad:** en la lista (`role="listbox"`) solo hay opciones y grupos (los proyectos; cada página
    con sus fragmentos); la ayuda y los avisos van afuera, y los rótulos de sección y "y N más" van con
    `aria-hidden`. Una región `aria-live="polite"` dice cuántas páginas se encontraron.
- **Ir a un resultado** (corrección 6): el panel guarda el pedido, cierra el cajón del teléfono (`onGo`, desde
  `Workspace.tsx`: en la misma página la dirección no cambia y el cajón no se cerraba solo) y navega.
  `PageEditor.tsx` toma el pedido de su página cuando su editor está listo, o enseguida si ya lo estaba:
  `openFindBarAt(palabra, { bloque, cuál })` abre la barra con esa palabra, sin *Aa* ni palabra entera y sin
  tomar lo elegido en el editor, y la barra elige esa coincidencia (`goToOccurrence` en `findEditor.ts`; si el
  bloque ya no está, la primera de la página) y la lleva a la vista **una sola vez** (`takeFindTarget`). **Con
  la página a medio bajar** (el editor en solo lectura) el pedido se guarda: cuando termina de bajar y el
  editor se vuelve a montar, va otra vez a esa coincidencia. El pedido lleva su página (la barra de otra página
  no lo usa) y se descarta al cambiar lo buscado, al cerrar la barra o al salir de la página. Enter sigue por las demás. El foco va al campo de
  la barra, salvo en pantallas táctiles. **La página** (su renglón): si lo encontrado está en el título, se abre
  arriba y sin barra; si no, va a su mejor fragmento. Lo escondido en una lista plegable o en una sección
  colapsada (P.11, v0.053) se abre para vos al llegar, con los ganchos de cada editor (`setFindCollapseHooks(view,
  hooks)`); lo prueba `projectSearch.test.tsx` (una página que abre con la sección colapsada: ir a la coincidencia
  escondida la abre y queda ahí).
- **Ctrl/⌘+K** (`Workspace.tsx`): abre el panel desde cualquier lugar; con el panel abierto, lo cierra. Con un
  IME escribiendo, no. Con el selector de proyectos abierto, el selector se cierra. **Esc en la barra de buscar
  deja elegida la coincidencia** (entrega 1), y con texto elegido Ctrl/⌘+K sería "link": si lo elegido es
  exactamente lo que dejó Esc (`closeFind` lo anota con `recordFindSelection` en `findUi.ts`: el editor, el
  documento y el tramo) y nadie lo tocó, un escucha en `window` en la fase de captura abre la búsqueda antes que
  BlockNote (`preventDefault` y `stopPropagation`), salvo con un diálogo abierto. **Cualquier clic o tecla en el
  editor lo olvida** (menos ⌘, Ctrl, Shift o Alt solos: el principio del atajo), y también si el editor ya no
  está: si la persona vuelve a elegir lo mismo (un doble clic en la palabra para hacerle un link), es "link". **El
  selector de proyectos se quedó sin atajo** (su tooltip dice ahora "⌘K busca páginas y proyectos"); crear un
  proyecto desde el teclado sigue andando desde el panel.
- **La lupa** en `Sidebar.tsx`, a la izquierda del "+" de "Páginas", también para quien no puede crear páginas
  ("Buscar en el proyecto (Ctrl+K)").
- **Regla del repo (Lega): en la Mac, siempre ⌘ y nunca Ctrl.** Además de Ctrl/⌘+F y Ctrl/⌘+K, pasaron a
  `modPressed` (con la plataforma como parámetro, para probar la Mac): mandar un comentario (⌘Enter,
  `isSendShortcut`), comentar (⌘⌥M, `isCommentShortcut`) e imprimir (⌘P, `isPrintShortcut`). Quedan como están,
  a propósito: el zoom del carrete con la rueda (`ctrlKey` ahí es el pellizco del trackpad, también en la Mac),
  el carrete que no deja pasar ninguna combinación con Ctrl o ⌘ al resto de la app, y en `PageEditor.tsx` el
  clic con modificador (que no abre el carrete) y la barra espaciadora con modificador (que no lo abre): son
  exclusiones, no atajos.
- Sin cambios en la base, en el esquema ni en `min_app_version`. Los comentarios y la papelera no entran.

**Pruebas (1039 en total, con lo de `main` hasta v0.053):** `src/search/projectIndex.test.ts` (las palabras; títulos y texto, cada palabra en
algún lado, la ñ; grupos, camino, 3 fragmentos y "más"; hijos anidados, pies y nombres con cuál de su bloque;
la papelera y lo de adentro sin volver a leer; una página que sale del árbol y un árbol que la esconde al buscar;
solo el proyecto abierto; solo relee lo que cambió, local o bajado de otro dispositivo; el aviso de edición
local aunque la marca no cambie; la página abierta desde su documento vivo, también un borrado; la fusión de
más de 64 updates; faltan bajar e ilegibles; ceder el hilo y avisar a lo sumo cada 250 ms; sin cambios no se
prende "leyendo"; cortar la pasada; una letra, solo títulos; `dispose` y un escucha que falla; **80 cruces al
azar de leer para buscar (fusionando más de 64 updates) con escribir, subir, bajar y otro dispositivo
escribiendo**, sin perder nada, con lo guardado igual a lo que se ve y un dispositivo nuevo que ve lo mismo;
**1000 páginas con topes de tiempo**). `src/ui/projectSearch.test.tsx`, con la app de verdad (`Shell`, el
árbol, la base local y el editor en jsdom): el atajo (Mac: Ctrl+K pasa de largo; ruso; con un diálogo); Ctrl+K
abre con el foco en el campo, resultados, pies, Esc y Ctrl+K otra vez; cada palabra y "sin resultados"; ↑ ↓;
los proyectos y cambiar de proyecto; el abierto no aparece con algo escrito, la primera opción activa, crear un
proyecto desde el panel y quien no puede no lo ve; "Buscando…" que no parpadea y que aparece con una lectura
lenta; Esc en la barra y Ctrl+K sobre eso abre la búsqueda, y Ctrl+K otra vez devuelve el foco al editor; modal
(Tab, Esc con el foco en la cruz, el foco que vuelve); la lista solo con opciones y grupos y la cantidad
anunciada; el selector que se cierra; la lupa para quien solo ve; Ctrl+K con texto elegido en el editor no abre;
ir a otra página, la coincidencia justa del bloque y que se queda ahí; una página a medio bajar que no pierde la
coincidencia al completarse; la misma página (cierra el cajón, dos veces seguidas); el título (arriba, sin
barra); el pedido por instancia de servicios. `src/ui/macShortcuts.test.ts`: los atajos con ⌘ en la Mac y Ctrl
en el resto (buscar, comentar, mandar, imprimir). De punta a punta: `search.mjs` en el repo de pruebas privado
(Chromium, usuario temporal que se borra al final, puerto 4176), y `projects.mjs` actualizado (el selector se
abre con un clic; Ctrl+K con texto elegido no abre la búsqueda; a 700 px, Ctrl+K abre la búsqueda a pantalla
completa y el selector sube como hoja desde el cajón).

**Auditoría del código (independiente, 2026-09-30).** Nada bloqueante; los cambios en la sincronización se
verificaron con 80 cruces al azar. Arreglado todo lo que encontró: el proyecto abierto como primera opción
(Enter solo cerraba), la primera búsqueda amplia lenta con muchas páginas, "Buscando…" que parpadeaba, Esc y
después Ctrl/⌘+K que creaba un link, crear un proyecto desde el teclado (se había perdido con el atajo del
selector), escuchas de ediciones sin `try/catch`, el índice y la sesión que no se soltaban al cerrar sesión (y
documentos cerrados retenidos), un cálculo que no se usaba (`supported`), el foco al cerrar con Ctrl/⌘+K, Tab y
Esc en el panel, la accesibilidad de la lista, el IME en Ctrl/⌘+K, el selector que quedaba abierto abajo, la
lectura que seguía con el panel cerrado, y la coincidencia pedida que se perdía con la página a medio bajar. De paso: un ciclo de sincronización cortado por
`stop()` con la base ya cerrada dejaba un error sin atrapar al contar lo pendiente (`engine.ts`); ahora se ignora.

**Verificación de los arreglos (independiente, 2026-09-30).** Un bloqueante, arreglado: "Proyecto nuevo «…»" se
creaba con Enter aunque hubiera páginas que coincidían (con el índice leyendo, con páginas por bajar, o con lo
escrito todavía sin buscar: un nombre viejo o a medio corregir), y un proyecto no se puede borrar. Ahora se
ofrece solo con los resultados al día y Enter lo crea solo después de llegar con las flechas (pruebas: una
lectura lenta, páginas por bajar, "Bosquex" corregido a "Bosque", Enter sin flechas). Además: el nombre hasta 200
caracteres; lo que dejó Esc se olvida con un clic o una tecla en el editor (lo encontró la prueba de punta a
punta: Ctrl sola no cuenta) o con un diálogo abierto; la coincidencia pedida lleva su página y se descarta al
cambiar lo buscado o cerrar la barra; esperar a que se guarde tiene un tope por pasada y no espera si guardar
falla; `onWriteError` después de `stop()`; los topes de tiempo de las pruebas, holgados; una letra en chino o
japonés busca en el texto; y el error de un escucha a la consola.

**Queda para después:** lo de la sección "Entregas" (reemplazar en el proyecto, la papelera, todos los proyectos,
comentarios); *Aa* y palabra entera en el panel; guardar el índice en `meta` si en un teléfono tarda.
**Decidido por Lega:** los proyectos que coinciden van arriba de las páginas; en la Mac, solo ⌘K (nunca Ctrl).

## Ajustes de v0.057 (lo que encontró Lega probando)

Lega probó v0.054 en Chrome, en la computadora, y encontró tres cosas. Donde esto y lo de arriba no coinciden,
vale esto.

1. **Ir a un resultado abría la página pero no la llevaba a la coincidencia.** La prueba de punta a punta pasaba
   porque sus páginas eran cortas. Con una página larga con fotos se ve la causa: la coincidencia se centraba
   **una vez**, en el cuadro siguiente, y después la página seguía cambiando de alto por encima (fotos que
   bajan o que todavía no están y dejan su recuadro "Not available yet", marcas de hoja, lo que se abre de una
   sección colapsada). Medido en Chromium, en otro dispositivo con la página A3: el alto del contenido pasó de
   2231 a 3401 px en los primeros 2 s y la coincidencia se corrió de 420 a 690 px, y con más fotos queda afuera.
   Además `scrollIntoView` mueve todos los antepasados (también la ventana) y no sabe de la barra de arriba.
   Ahora (`src/ui/findScroll.ts`, sin ProseMirror):
   - **El contenedor que se desplaza** (`scrollParent`: el primer antepasado con `overflow` auto o scroll; en la
     app, `.main`, no la ventana) y **la coincidencia centrada a mano ahí** (`centerInScroller`): de arriba
     abajo, en lo que se ve debajo de la barra de arriba (`.main` tiene `scroll-padding-top` con su alto); de
     costado, con una hoja más ancha que la ventana (A3), si queda afuera se trae con 24 px de margen. Una
     coincidencia escondida (sin tamaño) no mueve nada.
   - **Al llegar desde la búsqueda del proyecto** (`landOnOccurrence` en `findEditor.ts`, que usa `FindBar.tsx`
     cuando hay una coincidencia pedida), la coincidencia **se sigue centrando mientras la página se acomoda**
     (`keepInView`): con cada cambio de tamaño del editor o de la página (`ResizeObserver`) y con cada foto que
     termina de bajar (`load`), a lo sumo una vez por cuadro, **hasta 4 s o hasta que la persona desplaza
     (rueda o trackpad), toca, hace clic o aprieta una tecla**: nunca se pelea con ella. Ir a otra coincidencia,
     cerrar la barra o borrar lo buscado corta lo anterior. Ir con Enter a la siguiente la centra una sola vez.
   - **Si el documento todavía no tiene la coincidencia** cuando se busca (se está dibujando o terminando de
     bajar), espera hasta 3 s a que aparezca y recién ahí va a la pedida; si mientras tanto se busca otra cosa,
     no salta. La espera es lo que acomoda ese editor (`holdKeeper`, uno por editor): otra llegada, cerrar la
     barra o **cualquier cosa que haga la persona la corta**, con los mismos escuchas que el centrado
     (`watchUser`: rueda o trackpad, toque, clic, arrastrar o soltar algo, una tecla).
   - **Si la persona se va a otro lado** (esperando o ya acomodando), la coincidencia pedida se descarta
     (`dropFindTarget`): con la página a medio bajar, cuando termina y el editor se vuelve a montar, no se
     vuelve a ir ahí. Y cuando el editor se vuelve a montar sin nada nuevo que buscar (la misma búsqueda), se
     busca otra vez pero la página no se mueve. Al desmontarse la barra o el editor se sueltan los escuchas y el
     `ResizeObserver`.
   - No hay un escucha de `scroll` para cortar: el ajuste del navegador al crecer algo arriba (*scroll
     anchoring*) también dispara `scroll` y se confundiría con la persona; la rueda, el toque, el clic en la
     barra de desplazamiento y las teclas ya cubren cómo se desplaza a mano.
   - Un resultado del título vuelve arriba **y al borde izquierdo** de la hoja.
2. **El campo enfocado tenía un marco doble y grueso**: el `:focus-visible` global (contorno de 2 px de acento),
   el anillo de `input:focus` (3 px) y su borde del color del texto (blanco en el tema oscuro). Ahora el campo
   de la barra enfocado tiene **un solo borde de 1 px** (`--find-focus`), sin contorno ni anillo: el amarillo de
   acento en el tema oscuro y un amarillo más oscuro (`#a47300`) en el claro, porque el acento sobre blanco
   tiene 1,9:1 y un indicador de foco pide 3:1 (WCAG 1.4.11). Sin resultados, el borde rojo suave; sin
   resultados y enfocado, el rojo fuerte (`--danger`), para que el foco se siga viendo. Los botones de la
   barra mantienen su contorno de teclado.
3. **Con una hoja más ancha que la ventana (A3), la barra quedaba al borde derecho de la hoja** y se cortaba.
   Ahora el ancla de la barra (`.find-anchor`, pegada arriba al desplazarse) también se pega a la izquierda de
   lo que se ve (`position: sticky; left: 0`, como la barra de arriba) y no pasa del ancho visible de `.main`
   menos 12 px (`--find-visible-width`, lo mide `FindBar.tsx` con un `ResizeObserver`: la ventana, la barra
   lateral, la barra de desplazamiento y el panel de comentarios, que con lugar ocupa el `padding-right` de
   `.main`). Así, con la hoja entera a la vista la barra sigue al borde derecho de la página, como antes; con
   la hoja más ancha, queda **alineada con los íconos de arriba** (comentarios y "⋯") y los sigue al achicar la
   ventana o al desplazarse de costado; con el panel de comentarios abierto (1180 px o más), a 12 px del borde
   izquierdo del panel. Con el panel abierto, `.main` también tiene `scroll-padding-right` con su ancho: traer
   una coincidencia de costado no la deja debajo del panel. En el teléfono, igual que antes: a todo el ancho y sin scroll de
   costado (la hoja no pasa del ancho de la pantalla).

**Auditoría (independiente, sobre b9d4bea).** Nada bloqueante; arreglado todo lo que encontró: la espera de
3 s no escuchaba a la persona y una segunda llegada dejaba viva la primera; con la página a medio bajar, al
completarse volvía a la coincidencia aunque la persona se hubiera ido; el contraste del borde en el tema claro;
el foco sin resultados; arrastrar y soltar también cortan; el panel de comentarios al traer de costado; soltar
todo al desmontarse la barra. Pruebas nuevas en `findBar.test.tsx`: cada entrada de la persona corta la espera
(y avisa), una segunda llegada y cerrar la barra la cortan, desplazar después de llegar corta y avisa, la
página a medio bajar que al completarse no vuelve si la persona se fue, y al desmontarse se sueltan escuchas y
`ResizeObserver`; en `find.mjs`, el color del borde en cada tema y el rojo sin resultados.

**Pruebas (1050 en total en esta rama antes de la auditoría, 1055 después):** `src/ui/findScroll.test.ts` (el contenedor que se desplaza; centrar
debajo de la barra de arriba; de costado con una hoja ancha y sin mover si ya se ve; una escondida no mueve;
volver a centrar con cada cambio de tamaño y con el `load` de una foto; desplazar, un clic o una tecla lo
cortan; se termina a los 4 s, al ir a otra o al cerrar; con Enter, una sola vez) y en `src/ui/findBar.test.tsx`
(esperar a que aparezca la coincidencia pedida y no saltar si se busca otra cosa; el ancho visible del ancla,
sin el panel de comentarios). De punta a punta, en el repo de pruebas privado: `search.mjs` (una página larga
con cuatro fotos grandes y hoja A3 en una ventana de 1000 px: ir al resultado deja la coincidencia entera a la
vista, también de costado, a los 300 ms, 1,5 s y 3 s, con la barra entera; lo mismo en otro dispositivo, donde
las fotos todavía no bajaron y la página crece después de llegar; y si la persona desplaza, no se la vuelve a
centrar) y `find.mjs` (el campo enfocado con un solo borde de 1 px de acento, sin contorno ni anillo, en claro y
oscuro; con A3 a 1000 px y a 820 px, desplazada al principio, al medio y al final, la barra entera y alineada con
los íconos; en el teléfono, entera y sin scroll de costado).
