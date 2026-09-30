# Buscar en el proyecto y en la página (P.12)

Estado: **entrega 1 hecha (v0.052): buscar y reemplazar en la página**; la búsqueda del proyecto (entrega 2),
pendiente. "Correcciones de la auditoría" manda sobre lo de arriba y "Cómo quedó (entrega 1)", al final, sobre
todo lo demás. Lo pidió Lega (urgente, 2026-09-30): "dos lupas: una a la izquierda del
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

**Ctrl/⌘+F** (en `window`, solo con una página abierta, sin un diálogo modal ni el carrete abiertos):

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
  (o con la página incompleta) la flecha no aparece. Atajo: Ctrl+H (Windows y Linux) / ⌘⌥F (Mac), como VS Code
  (a confirmar: en Chrome, Ctrl+H es el historial).
- **Reemplazar:** cambia la actual y va a la siguiente.
- **Reemplazar todo (12):** una sola transacción de ProseMirror, recorriendo de atrás para adelante (las
  posiciones no se corren). y-prosemirror la pasa a una transacción de Yjs: **un solo Ctrl/⌘+Z la deshace**. Al
  terminar, un aviso "12 reemplazos" con *Deshacer*.
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
- El diseño de P.11 está en curso: el nombre y la forma de la función que abre las secciones pueden cambiar.

## Correcciones de la auditoría (mandan sobre lo de arriba)

Una auditoría independiente contrastó el diseño con el código (y-prosemirror, el router, `PageDocs`, la
impresión). El modelo (buscar en el dispositivo, decoraciones, reemplazar como edición común) se mantiene.
Cambios:

1. **Un solo deshacer, de verdad.** El `UndoManager` de y-prosemirror junta lo que pasa en 500 ms
   (`captureTimeout`): un "Reemplazar todo" rápido después de escribir quedaba en el mismo paso que lo escrito
   (verificado). Se llama `undoManager.stopCapturing()` justo antes y justo después de cada reemplazo. El
   *Deshacer* del aviso solo deshace mientras el último paso de la pila sea ese reemplazo.
2. **Una transacción por coincidencia**, de atrás para adelante, todas entre los dos `stopCapturing()` (siguen
   siendo un solo paso). Con una sola transacción por párrafo, `updateYText` borra y vuelve a escribir todo lo
   que hay entre la primera y la última coincidencia.
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

## Cómo quedó (entrega 1, v0.052)

Buscar y reemplazar en la página, con las correcciones de la auditoría. Donde esto y lo de arriba no
coinciden, vale esto.

- **`src/search/normalize.ts`:** `normalize` (texto normalizado con el mapa al original), `normalizeQuery`,
  `findIn` y `searchText`. Sin *Aa*: NFD por punto de código, sin marcas combinadas, `toLowerCase()` (la ñ vale
  como n, la "İ" como i; "ß" no es "ss"; ligaduras, ø y ł quedan como están). Con *Aa*: NFD sin sacar nada,
  y una coincidencia que corta una letra con tilde descompuesta no cuenta. Los espacios seguidos (también el de
  no separar) valen uno; el final de una coincidencia se extiende sobre las marcas que siguen.
- **`src/search/extract.ts`:** la regla de qué texto tiene cada bloque, con dos entradas que dan lo mismo en el
  mismo orden (lo fija una prueba): `unitsFromPM` (el editor abierto, con las posiciones de cada tramo) y
  `unitsFromYDoc` (el Y.Doc guardado, para la entrega 2). Un salto de línea es `\uFFFC` (no un espacio: nunca
  une dos renglones); los hijos anidados son bloques propios; pie y nombre, unidades aparte.
- **`src/ui/findEditor.ts`:** el plugin (`findExtension`, en la lista `extensions` del editor de
  `PageEditor.tsx`) con las coincidencias (hasta 1000; "de más de 1000"), la actual y las decoraciones
  (`sd-find-hit`, `sd-find-current`, y para un pie o un nombre `sd-find-block` en el contenido del bloque). Con
  cada cambio del documento las marcas se corren y se vuelve a buscar a los 150 ms. La actual se guarda también
  como posición relativa de Yjs: un cambio de otro dispositivo reemplaza el documento entero en ProseMirror (así
  trabaja y-prosemirror) y las posiciones corridas no sirven.
  - Reemplazar: `replaceCurrent` y `replaceAll` revisan `editor.isEditable` (sin permiso o con la página
    incompleta no hacen nada: `blocked: 'readonly'`); una transacción por coincidencia, de atrás para
    adelante, entre dos `undoManager.stopCapturing()` (un solo paso, separado de lo escrito justo antes); el
    texto nuevo con las marcas del primer carácter (`replaceWith`); se saltea lo que borraría un link entero
    (vacío, o una coincidencia que empieza afuera del link y lo cubre); pies y nombres se cuentan y no se tocan.
    Antes de *Reemplazar* se vuelve a buscar desde la posición relativa de la actual y solo se reemplaza si es
    exactamente la misma (si no, `blocked: 'changed'` y queda la más cercana).
  - Marcas para P.11: cada transacción de reemplazo lleva el `meta` `sd-find-replace` (`FIND_REPLACE_META`); su
    paso de deshacer también (`stack-item-added`), y el paso que sale de deshacerlo o rehacerlo, si el que se
    aplica estaba marcado. `isFindReplaceUndo(state)` dice si lo que se está aplicando es deshacer o rehacer
    un reemplazo (para que el colapso no abra secciones por eso).
  - Gancho para P.11: `setFindCollapseHooks({ isHidden, reveal })`. Sin registrar, no hace nada. Con él, la
    barra cuenta las coincidencias escondidas y, al ir a una, primero la abre.
- **`src/ui/findUi.ts`:** el estado de la barra (abierta, desplegada, lo buscado, el reemplazo, *Aa*, *Palabra
  entera*), afuera del editor: al volver a montarse el editor la búsqueda sigue. `isFindShortcut` (Ctrl+F; ⌘F en
  la Mac) y `takesFindShortcut` (se deja pasar al navegador con el foco en la barra, en un campo fuera del
  editor, como el título o los comentarios, y con un diálogo o el carrete abiertos).
- **`src/ui/FindBar.tsx`:** la barra, en la parte del editor (textos en `src/i18n/lazy/editor.ts`). Un ancla
  pegajosa sin alto debajo de la barra de arriba; en la computadora flota a la derecha de la página, en el
  teléfono ocupa su lugar a todo el ancho. Campo, "3 de 12", *Aa*, *ab* (palabra entera), ↑ ↓ y ×; la flecha de
  reemplazar solo si se puede editar. Enter / Shift+Enter, F3 y Ctrl/⌘+G (con Shift, la anterior); Esc cierra,
  saca los resaltados y deja elegida la coincidencia. Al abrir toma lo elegido en el editor (una línea, hasta
  200 caracteres). Abajo, "en un pie", "en el nombre de un archivo", cuántas están en secciones colapsadas y
  el resultado de reemplazar ("2 reemplazos · Deshacer", lo que no se tocó); *Deshacer* solo mientras el último
  paso de la pila sea ese reemplazo.
- **`PageEditor.tsx`:** Ctrl/⌘+F en `window` (solo con una página abierta); la barra arriba del `BlockEditor`
  (que avisa su editor con `onEditor`). **`Workspace.tsx`:** la lupa a la izquierda del ícono de comentarios
  ("Buscar en la página (Ctrl+F)").
- **Impresión:** la barra no entra en la copia y las clases de lo resaltado se sacan (`printView.ts`).
- Sin atajo para reemplazar (Lega). Sin cambios en la base, en el esquema ni en `min_app_version`.

**Pruebas:** `src/search/normalize.test.ts` (tildes, ñ, Í descompuesta, *Aa*, İ, ß, ø, espacios, palabra
entera, emojis, el separador); `src/ui/findEditor.test.ts`, con el editor real (el Y.Doc y el editor dan las
mismas unidades; un tipo desconocido se lee; buscar no cambia el vector de estado; siguiente y anterior dan la
vuelta; cerrar deja elegida la actual; tilde descompuesta; *Aa* y palabra entera; un cambio vuelve a buscar;
el gancho de P.11; "Reemplazar todo" un solo deshacer aunque se haya escrito justo antes; el paso marcado al
deshacer y rehacer; *Reemplazar* y pasar a la siguiente; quien no edita no cambia nada; el link y la tarjeta
de Drive; pies que no se tocan; un cambio de otro en la coincidencia frena, en otra parte no);
`src/ui/findBar.test.tsx` (el atajo y cuándo pasa al navegador, la cuenta, Enter y Shift+Enter, Esc, lo
elegido al abrir, sin flecha para quien no edita, reemplazar todo con *Deshacer*, el editor que se vuelve a
montar, y Ctrl+F con la página real). De punta a punta: `find.mjs` en el repo de pruebas privado (Chromium,
usuario temporal que se borra al final): Ctrl+F abre la barra y la segunda vez pasa al navegador, "1 of 2" sin
tildes, Enter y Shift+Enter, *Aa*, reemplazar todo y un solo deshacer, Esc con la coincidencia elegida, lo
reemplazado sigue después de recargar, la lupa de arriba y el teléfono.

**Queda para después:** la búsqueda del proyecto (entrega 2, con las correcciones 5 a 8, 11, 12, 15 a 17);
reemplazar en pies y nombres, *Conservar mayúsculas* y expresiones regulares; que P.11 registre
`setFindCollapseHooks` y respete `sd-find-replace` e `isFindReplaceUndo`; probar a mano Safari de Mac, iPhone
y Firefox (Ctrl/⌘+F, el teclado del teléfono). "Reemplazar todo" con cientos de coincidencias hace una
transacción por cada una (y-prosemirror compara el documento en cada una): a medir en una página grande.
