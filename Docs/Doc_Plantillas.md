# Plantillas y el reporte del día

**Estado: entregas 0 y 1 implementadas** (las tres de fábrica, la vista previa y crear desde una; ver "Cómo quedó",
al final); las entregas 2 y 3 siguen en diseño. Sin migración (roadmap P.23, fase 3 de `Plan_ShotDocs.md`; pedido de
Lega del 2026-10-02). Diseñado contra `main` v0.108. Las decisiones PL1 a PL10 (sección 13) son propuestas: se adoptan como
están hasta que Lega diga otra cosa. El contenido de las tres plantillas es una primera versión para que Lega la
ajuste: la entrega 0 la deja a la vista sin guardar nada, justamente para eso. Corregido con la auditoría
independiente del 2026-10-02 ("aprobado con cambios"; ver "Correcciones de la auditoría", al final).

## En corto

- **Tres plantillas de fábrica, en el código:** *Pre-production Notes* (una página por escena), *On-Set Report*
  (una página por día de rodaje) y *Shot Breakdown* (una página por plano de VFX). Solo usan bloques que ya existen:
  títulos (que se colapsan desde P.11), párrafos, listas, casillas, tablas con encabezado, párrafos de guion
  (`script`), preguntas (`question`) y fotos en línea. **Ningún tipo de bloque ni propiedad nueva.**
- **Una plantilla propia es una página** (PL2): una página con `settings.template` adentro de una carpeta
  *Templates* del proyecto. Se edita con el editor de siempre, se sincroniza sin red como cualquier página, tiene
  historial, comentarios y papelera, y la ve quien ve esa página: **los permisos son los de la página, sin nada
  nuevo en la base.** No hace falta la tabla `templates` del plan ni ninguna migración.
- **Crear desde una plantilla es copiar** (sección 4): se arma la lista de bloques de la plantilla sobre una copia
  en memoria de su documento (la plantilla nunca se toca), se les dan ids nuevos y se **agregan antes** del párrafo
  vacío de la página nueva, sin borrar nada. Todo pasa en el dispositivo: anda sin red.
- **Dónde se elige** (PL3): en una página vacía recién creada aparece una tira *Start from a template* con las tres
  de fábrica y *More…*; seguir escribiendo la ignora. El "+" sigue creando la página al instante.
- **Guardar como plantilla** (sección 5): *Save as template…* en el menú de la página copia la página a la carpeta
  *Templates* (la crea si falta), con la opción de vaciar las tablas y las casillas.
- **El reporte del día** (sección 6): en la carpeta de reportes y en cada reporte, un botón **New day report**
  (Ctrl/⌘+Alt+Shift+N) abre un globito con la **fecha de hoy** (la del dispositivo, hora local), el **día de rodaje**
  siguiente y la **locación del último reporte**, ya puestos y editables. Enter crea la página
  `2026-10-02 | Day 06` al final de la carpeta, con la unidad, el equipo de cámara y la gente de VFX del día anterior.
  Si ya hay uno con esa fecha, Enter lo abre. Sin red, igual.
- **La carpeta de reportes es una página marcada** (PL5, `settings.dayReports`), que se marca sola al crear el primer
  reporte adentro de una carpeta.
- **Entregas:** 0 (las tres plantillas en el código, para ver sin guardar), 1 (crear desde una de fábrica), 2 (el
  reporte del día), 3 (plantillas propias: guardar, editar, otros proyectos).

**En términos simples:** las plantillas son páginas modelo. Las tres de fábrica vienen con la app y traen lo que un
supervisor de VFX anota antes del rodaje, en el set y por plano. Las propias son páginas comunes guardadas en una
carpeta *Templates* del proyecto: para cambiar una, se abre y se escribe. Al usar una, la página nueva recibe una
copia; cambiar la plantilla después no toca lo ya creado. Y en el set, un botón crea el reporte de hoy con la fecha, el
número de día y la locación de ayer ya escritos, adentro de la carpeta de reportes, aunque no haya señal.

## Reglas que no se rompen

1. **Nada de tipos de bloque nuevos** ni de propiedades nuevas en los bloques. Las plantillas se arman con lo que ya
   conoce la versión mínima publicada (prueba con el esquema publicado, sección 10).
2. **Crear desde una plantilla nunca borra nada**: ni en la página nueva (se agrega antes del párrafo vacío), ni en la
   plantilla (se lee una copia en memoria).
3. **Los permisos son los de las páginas.** Ver una plantilla = ver su página; crear desde una plantilla = poder crear
   la página (nivel 4 donde va) o editar la vacía (nivel 3); guardar una = poder crear en *Templates*. Nada se decide
   solo en la app que la base no haga cumplir ya.
4. **Sin red, igual.** El árbol y el contenido de todas las páginas ya están en el dispositivo
   (`Doc_Copias_Locales.md`, sección 1): elegir, copiar, crear el reporte y leer el reporte anterior son locales.
5. **Copia, no vínculo.** Cambiar una plantilla no cambia ninguna página creada con ella.

## 1. Qué hay hoy

- `pages.template_id` existe desde la fase 1 (uuid, sin FK, "la FK llega con las plantillas"); la app no lo escribe ni
  lo baja (`PAGE_COLUMNS` de `src/sync/remote.ts` no lo trae). Se puede insertar (`grant insert (…, template_id)`) y
  cambiarlo pide nivel 3 (`pages_permissions`, `20260930160000_equipo.sql`).
- `pages.settings` (JSON, hasta 2000 caracteres, `pages_settings_shape`) guarda ajustes de la rama: cada clave se
  resuelve hacia arriba solo si el código la pide con `tree.resolveSetting`; `setSetting` copia las claves que no
  conoce, así que **una versión vieja conserva claves nuevas** al cambiar el formato o el encabezado, siempre que ya
  las haya recibido (en secuencia; a la vez, se pisan: punto siguiente).
- Crear una página (`tree.create`) es una operación de la cola del árbol, sin red; la subida es `upsert` con
  `ignoreDuplicates` (un reintento no duplica).
- Escribir bloques en una página sin abrirla ya existe: `writePage` de `src/import/codaImport.ts` (documento con la
  semilla, editor sin pantalla, `findUnknownContent` para no tocar lo que no conoce). La página de práctica
  (`src/tutorial/practice*.ts`) arma bloques desde textos por idioma: el mismo molde sirve para las de fábrica.
- Una foto pegada en una página de **otro proyecto** se registra como uso ajeno (`link_page_file` devuelve `foreign`,
  `src/media/queue.ts`) y se muestra con la tarjeta de "otro proyecto" (`foreignPlaceholder`), no la foto; en el mismo
  proyecto, la cola registra el uso al ver el archivo en el documento (`reconcileMedia`, también sin abrir la página).
- `updatePage` sube `settings` **entero** (`remote.ts`, `.update(patch)`): dos cambios de ajustes de la misma página
  hechos a la vez sin red se pisan y gana el último en llegar (ver 8).

## 2. Las tres plantillas de fábrica

### 2.1 Con qué bloques se arman

| Bloque (existente) | Para qué |
|---|---|
| Tabla de datos: tabla de 2 columnas, primera columna como encabezado (`headerCols: 1`) | La ficha de arriba: un dato por fila (*Date*, *Location*…). Es lo que lee el reporte del día (sección 6.4). |
| Tabla con fila de encabezado (`headerRows: 1`), 4 a 7 columnas | Listas de planos, tomas, HDRI, medidas, material. Con pocas columnas para que entren en una hoja A4 vertical (~700 px). |
| Título H2 / H3 | Secciones. Todos se colapsan (P.11); ninguno es "plegable" de BlockNote. |
| Lista de casillas (`checkListItem`) | Lo que se hizo o falta: trabajos de VFX, elementos a filmar, lo tomado en cada plano. |
| Lista con viñetas | Ítems con rótulo ("Screen: …"). |
| Párrafo de guion (`script: true`) | La escena del guion, con sus marcas INT/EXT y DÍA/NOCHE. |
| Pregunta (`question: true`) | Preguntas al director, DP, arte, efectos especiales: se contestan con comentarios, también un invitado con Comentar. |
| Párrafo vacío bajo un título | Donde van texto y fotos en línea (o fotos en una celda, v0.107). |

Sin textos de ayuda adentro de la página (nada de "Escribí acá…"): un texto de muestra hay que borrarlo cada vez. Los
rótulos de las tablas y de las viñetas sí son contenido. **Idioma** (PL9): se arma en el idioma de la interfaz al
crearla (`builtin.en.ts`, `builtin.es.ts`, como la página de práctica); abajo, inglés / castellano.

### 2.2 *Pre-production Notes* (una página por escena)

Título: lo escribe la persona (por ejemplo `012 | INT. COCINA - NOCHE`, con el "|" de D-10).

| # | Bloque | Contenido (en / es) |
|---|---|---|
| 1 | Tabla de datos | *Scene* / Escena · *Script pages* / Páginas de guion (octavos) · *Set · Location* / Decorado · Locación · *INT/EXT · Day/Night* / INT/EXT · Día/Noche · *Planned shoot days* / Días de rodaje previstos · *Cast* / Elenco · *Stunts · SFX* / Dobles · Efectos especiales · *VFX shots (est.)* / Planos de VFX (estim.) · *Status* / Estado = *Draft* / Borrador |
| 2 | H2 + párrafo de guion vacío | *Script* / Guion |
| 3 | H2 + párrafo | *Summary* / Resumen: qué hace VFX en la escena |
| 4 | H2 + tabla (encabezado + 3 filas) | *Shot list* / Lista de planos: *Shot* · *Ref* (foto en la celda) · *Description* · *VFX work* · *Technique* · *Complexity* |
| 5 | H2 + casillas | *VFX work* / Trabajo de VFX: set extension · matte painting; sky replacement; green/blue screen; cleanup · paint-out (rigs, wires, crew); CG element (creature, vehicle, prop); FX simulation (fire, smoke, water, destruction); crowd; digi-double; screen inserts (phones, monitors); muzzle flashes · bullet hits; beauty · retouch; day for night · relight; retime · stabilization |
| 6 | H2 + viñetas | *Approach* / Cómo se hace: *Practical vs CG:* · *Screen (color, size):* · *Camera (locked-off, handheld, motion control):* · *Lenses:* |
| 7 | H2 + casillas | *Elements to shoot* / Elementos a filmar: clean plates; element passes (smoke, dust, sparks, blood); screen elements; actor reference · scan for digi-double; textures · photogrammetry; LiDAR; HDRI per setup; witness cameras |
| 8 | H2 + viñetas | *Set requirements* / Necesidades en set: *Screens:* · *Tracking markers:* · *Interactive light:* · *Rigs and wires:* · *SFX coordination:* · *Playback on monitors:* · *VFX time in the schedule:* |
| 9 | H2 + párrafo | *References* / Referencias: fotos, previs, storyboards, links |
| 10 | H2 + 5 preguntas | *Questions* / Preguntas: `Director: ` · `DP: ` · `Production design: ` / `Arte: ` · `SFX · Stunts: ` · `1st AD: ` / `Asistente de dirección: ` |
| 11 | H2 + viñeta vacía | *Decisions* / Decisiones (fecha · quién · qué) |
| 12 | H2 + viñetas | ***Internal — remove before sharing*** / Interno — borrar antes de compartir: *Risks:* / Riesgos · *Budget · Bid:* / Presupuesto · Cotización |

### 2.3 *On-Set Report* (una página por día de rodaje)

Título: lo pone el reporte del día, `2026-10-02 | Day 06` (PL7). Las filas marcadas **↻** se copian del reporte
anterior; las marcadas **⏱** las completa el botón (sección 6). *Setups & takes* sigue en 7 columnas para entrar en
A4 vertical: lo que no cambia en el día (EI, balance, juego de lentes) va en *Camera package*, y por setup solo lo que
cambia. Si una columna combinada ("Lens · Filters") molesta, se parte mirando la entrega 0.

| # | Bloque | Contenido (en / es) |
|---|---|---|
| 1 | Tabla de datos | *Date* / Fecha **⏱** (`2026-10-02 · Thu`) · *Shoot day* / Día de rodaje **⏱** (`6`) · *Location* / Locación **⏱↻** · *Sets* / Decorados · *Unit* / Unidad **↻** (*Main unit* / Unidad principal) · *Call · Wrap* / Citación · Fin · *Weather* / Clima · *Sunrise · Sunset* / Amanecer · Atardecer · *VFX on set* / VFX en set **↻** · *Director · DP* / Director · DF **↻** |
| 2 | H2 + párrafo | *Summary* / Resumen: qué se filmó, qué quedó pendiente |
| 3 | H2 + tabla **↻** | *Camera package* / Equipo de cámara (lo que no cambia en el día): *Cam* · *Body* · *Sensor mode · Resolution* · *EI · White balance* · *Lens set* · *Notes*; filas A y B |
| 4 | H2 + tabla (encabezado + 3 filas) | *Setups & takes* / Planos y tomas (lo que cambia por setup): *Slate (Sc · Shot · Setup)* · *Cam · Clip · TC* · *Lens · Filters (ND, diffusion, pola)* · *T-stop · Focus* · *Height · Tilt* · *FPS · Shutter* · *Circled takes · Notes* |
| 5 | H2, y un H3 `Shot ` con casillas y un párrafo | *VFX shots* / Planos de VFX. Por plano (se duplica el H3): clean plate; HDRI; chrome & grey ball; color chart; lens grid · distortion chart (each lens); measurements; tracking markers; LiDAR · photogrammetry; witness camera; reference photos; element passes |
| 6 | H2 + tabla (encabezado + 2 filas) | *Lighting reference* / Referencia de luz: *Setup* · *HDRI (brackets · files)* · *Position · Height* · *Chrome & grey ball* · *Color chart* · *Time* · *Notes* |
| 7 | H2 + tabla + párrafo | *Measurements* / Medidas: *What* · *Value* · *Notes*; filas *Camera to subject*, *Lens height*, *Set dimensions*, *LiDAR · Photogrammetry*; debajo, fotos de los croquis |
| 8 | H2 + viñetas | *Tracking markers* / Marcadores de tracking: *Type and color:* · *Where:* · *Removed after:*; fotos |
| 9 | H2 + párrafo | *Reference photos* / Fotos de referencia: set, utilería, actores, texturas |
| 10 | H2 + viñetas | *Weather & light* / Clima y luz: *Morning:* · *Afternoon:* · *Night:* (cambios de cielo y de sol en el día) |
| 11 | H2 + tabla | *Data* / Material: *Media* · *Card · Roll* · *Count* · *Offloaded to*; filas *Camera A*, *Camera B*, *HDRI*, *Lens grids*, *LiDAR · Photogrammetry*, *Reference photos*, *Witness cam* |
| 12 | H2 + casilla vacía | *Issues & follow-ups* / Pendientes |
| 13 | H2 + 2 preguntas | *Questions* / Preguntas: `Production: ` / `Producción: ` · `Director: ` |

### 2.4 *Shot Breakdown* (una página por plano)

Título: lo escribe la persona (`012_010 | Lucía mira al vacío`). Una página por plano (PL4), como las fichas que deja la
importación de Coda; la lista de planos de *Pre-production Notes* hace de índice.

| # | Bloque | Contenido (en / es) |
|---|---|---|
| 1 | Tabla de datos | *Shot* / Plano · *Scene* / Escena · *Description* / Descripción · *Frames (in–out · length)* / Cuadros · *Handles* / Colas · *Plates (clip · TC)* / Placas (clip · TC) · *Lens* / Lente · *Status* / Estado = *Not started* / Sin empezar · *Complexity* / Complejidad · *Due* / Entrega |
| 2 | H2 + párrafo | *Reference frame* / Cuadro de referencia (foto en línea) |
| 3 | H2 + casillas | *VFX work* / Trabajo de VFX (la misma lista de 2.2) |
| 4 | H2 + párrafo | *Technique* / Técnica |
| 5 | H2 + tabla | *Elements & assets* / Elementos y assets: *Element* · *Type (plate, CG, element, matte)* · *Source* · *Status* |
| 6 | H2 + tabla de datos | *Shoot data* / Datos de rodaje: *Shoot day (report)* · *Camera · Lens* · *HDRI* · *Clean plate* · *Measurements* |
| 7 | H2 + tabla | *Notes & feedback* / Notas y devoluciones: *Version* · *Date* · *From* · *Notes* |
| 8 | H2 + 1 pregunta | *Questions* / Preguntas: `Director: ` |
| 9 | H2 + tabla de datos | ***Internal — remove before sharing*** / Interno — borrar antes de compartir: *Artist · Vendor* / Artista · Proveedor · *Bid (days)* / Cotización (días) |

### 2.5 Lo interno, al final

Lo que no debería ver un cliente (cotización, proveedor, riesgos y presupuesto) va en una sección propia, la última,
*Internal — remove before sharing*: queda en cada página creada, y antes de compartir esa página con un invitado se
borra la sección entera (un título colapsado se arrastra con todo lo suyo, P.11). Colapsarla no alcanza: quien ve la
página la puede abrir. La ayuda de *Share* y la de *Templates* lo dicen.

### 2.6 Cómo están en el código

`src/templates/builtin.ts` (nuevo): tres funciones `(texts, values) => PartialBlock[]` y sus textos por idioma, más
ids fijos (`BUILTIN_PREPRO`, `BUILTIN_ONSET`, `BUILTIN_SHOT`: uuid constantes, para `template_id`). Las de fábrica
no se editan en la app: se personalizan con *Customize* (sección 5.3).

## 3. Dónde viven las plantillas (PL2)

- **De fábrica:** en el código, en todos los workspaces y proyectos, sin red.
- **Propias:** páginas con `settings.template = { description?: string, dayReport?: true }`, normalmente adentro de
  la carpeta *Templates* del proyecto (una página raíz con `settings.templatesFolder = true`, creada al guardar la
  primera). Su nombre es el título de la página. Ninguna de estas claves se hereda: se leen solo en la página misma
  (no pasan por `resolveSetting`).
- **Si la marca se pierde** (dos cambios de ajustes a la vez, ver 8): toda página **directamente adentro** de una
  carpeta `templatesFolder` cuenta como plantilla aunque no tenga `template`; en el selector sale sin descripción y la
  franja de 5.2 ofrece volver a marcarla.
- **Quién las ve:** quien ve la página. Para que todo el equipo use las de un proyecto, se comparte la carpeta
  *Templates* (o el proyecto) como cualquier página. No hay plantillas "personales" aparte: una página que solo ve su
  autor ya lo es.
- **El selector lista** (sección 4.1): las de fábrica, las del proyecto abierto y las de otros proyectos que la persona
  ve, cada una con su descripción. Una en la papelera (o adentro de algo en la papelera) no aparece; al restaurarla,
  vuelve.

## 4. Crear una página desde una plantilla

### 4.1 Dónde se elige (PL3)

- **La tira de la página vacía.** Debajo del título de una página vacía **creada en este dispositivo** (una lista de
  ids en `meta`, borrada al tener contenido), sin subpáginas y que se puede editar: *Start from a template* ·
  [*Pre-production Notes*] [*On-Set Report*] [*Shot Breakdown*] [*More…*]. Escribir en la página la saca. En el
  teléfono, la tira se desliza de costado.
- ***More…*** abre la ventana *Templates*: *Built-in*, *This project*, *Other projects* (con el nombre del proyecto),
  cada una con su descripción; *Use* y, en las de fábrica, *Customize*.
- **En el menú de la página:** *Apply template…* abre la misma ventana; solo con la página vacía (si no, deshabilitado
  con el tooltip *Only on an empty page*).
- **En una página que llegó vacía de otro dispositivo, la tira no se muestra** (el creador puede estar llenándola sin
  red; si los dos eligieran, la página tendría dos plantillas). Queda el menú.

### 4.2 Cómo se copia

1. **Los bloques de la plantilla.** De fábrica: los arma la función con los valores del momento. Propia: se copia el
   estado del documento de la plantilla (`Y.encodeStateAsUpdate`) a un `Y.Doc` en memoria, se mira
   `findUnknownContent` (si tiene algo que esta versión no conoce, se corta con *This template was made with a newer
   version of the app. Update to use it.*), se comprueba que esté **completa en el dispositivo** (si
   `row.update_seq` es mayor que lo bajado, el mismo control de `reconcileMedia`, se avisa *This template hasn't
   finished downloading* con *Wait* —se usa sola al llegar— y, si hay una de fábrica del mismo tipo, *Use built-in*;
   nunca se copia a medias) y se pasa a bloques con `yXmlFragmentToBlocks` (`@blocknote/core/yjs`). La plantilla
   nunca se monta en un editor: no se le escribe nada.
2. **Se limpian:** ids nuevos para todos los bloques (los comentarios de la plantilla quedan en la plantilla); las
   preguntas van sin sus respuestas (las respuestas son comentarios); el "colapsado para todos" de la plantilla
   (`collapsedHeadings`) se copia con los ids nuevos.
3. **Fotos y archivos** (PL10): la regla se decide sin red, comparando el proyecto de la plantilla con el de la página
   nueva. **Mismo proyecto:** se copian (la cola registra el uso en la página nueva, como al pegar). **Otro proyecto:**
   se sacan todas las direcciones `sdmedia://` y `sdfile://` (fotos-bloque, fotos en línea y en celdas, videos,
   adjuntos y carpetas de Drive soltadas), que ahí solo mostrarían la tarjeta de "otro proyecto", y un aviso dice
   cuántas: *3 photos and files weren't copied: they belong to another project.* Las **tarjetas de Drive**
   (`driveCard`: un párrafo con un link de Drive) se copian como están: son un link escrito, el mismo que se podría
   pegar; si el reproductor no lo puede mostrar, queda el link.
4. **Se escriben** como `writePage` (salvo *Apply template…* con la página abierta: ahí con el editor visible, así
   entra en su deshacer): documento con la semilla, editor sin pantalla, y los bloques se **insertan antes
   del párrafo vacío** de la semilla (que queda al final), sin `replaceBlocks`. Nada que borrar: si otro dispositivo
   escribió a la vez en ese párrafo, su texto queda.
5. **La fila:** la página nueva lleva `template_id` (la de fábrica o la página plantilla; informativo, nunca da
   permisos). El título, vacío y con el foco (salvo el reporte del día). Los ajustes de la plantilla (formato de hoja)
   no se copian: manda la rama donde queda la página.
6. **Subpáginas de la plantilla:** no se copian en esta versión (sección 14).

### 4.3 Permisos y sin red

- Llenar una página vacía: nivel 3 en ella. Crear una página nueva (reporte del día, *Customize*, *Save as template*):
  nivel 4 donde va (`perms.canCreateIn`). Lo hace cumplir la base como hoy (`pages_permissions`, RLS de
  `page_updates`); la app solo esconde lo que no se puede.
- Todo es local: la cola del árbol crea la página, el contenido se guarda en IndexedDB y sube después. Usar una
  plantilla propia sin red funciona porque su contenido ya está en el dispositivo, **si terminó de bajar** (paso 1 de
  4.2); si no, se avisa y no se copia a medias.

## 5. Hacer una plantilla desde una página, y editarla

### 5.1 *Save as template…*

En el menú de la página (barra lateral y barra de la página). Ventana: *Name* (el título), *Description* (opcional,
300 letras), *Use for day reports* (marcada si la página está en una carpeta de reportes) y **Clear filled-in values**
(marcada): vacía las celdas de las tablas salvo la fila de encabezado y la primera columna de las tablas de datos,
desmarca las casillas y saca fotos y archivos. *Save* copia la página (sección 4.2) a *Templates* (la crea si falta, con
`templatesFolder`), le pone el título y `settings.template`, y avisa *Saved as template* · *Open*. Pide poder crear en
*Templates* (o en la raíz, si hay que crearla); si no, deshabilitado con el tooltip *Needs permission to create pages in
Templates*.

### 5.2 Editar una plantilla

Se abre y se escribe: es una página. Arriba del título, una franja *Template — new pages get a copy; pages already
created don't change.* con *Template settings…* (descripción y *Use for day reports*) y *Stop using as template* (saca
`settings.template`; la página queda). Mandarla a la papelera la saca del selector.

### 5.3 Personalizar una de fábrica

*Customize* (en la ventana *Templates*) crea su copia en *Templates* y la abre. Esconder las de fábrica en un proyecto
queda para después.

## 6. Crear el reporte del día

### 6.1 Dónde está el botón

- **New day report** (ícono de calendario con +), arriba a la derecha del título, en la **carpeta de reportes** y en
  **cada página de adentro**. También en el menú de la carpeta en la barra lateral. Atajo Ctrl/⌘+Alt+Shift+N con el foco
  en una de esas páginas. Solo con nivel 4 en la carpeta (crear ahí); si no, no aparece.
- En el teléfono, el mismo botón, con su área táctil grande (es el uso de set).

### 6.2 Cómo sabe cuál es la carpeta de reportes (PL5)

- Es la página con `settings.dayReports = { template?: string }` (`template`: la plantilla que usó el último reporte;
  sin él, *On-Set Report* de fábrica).
- **Se marca sola** al usar *On-Set Report* (o una plantilla propia con *Use for day reports*) en una página que está
  adentro de otra: la de arriba queda marcada (si la persona puede editarla). En la raíz del proyecto no hay carpeta:
  el reporte se crea igual, sin botón, y un aviso dice *Put day reports inside a folder to get New day report*.
- A mano: *Use for day reports* / *Stop using for day reports* en el menú de una página. Puede haber varias (unidad
  principal y segunda unidad).
- **Si la marca se pierde** (dos cambios de ajustes a la vez, ver 8): una carpeta también cuenta como de reportes si
  alguna página de adentro tiene `template_id` de *On-Set Report* o de una plantilla con `dayReport`; y cada *New day
  report* vuelve a escribir `dayReports` si falta. Solo un *Stop using for day reports* explícito la saca (deja
  `dayReports: false`, que gana sobre lo deducido).
- **La plantilla de la carpeta que esa persona no ve** (O4): `dayReports.template` apunta a una página de *Templates*
  que no está en su árbol (un data wrangler con nivel 4 solo sobre los reportes). El globito usa *On-Set Report* de
  fábrica con el aviso *The report template isn't shared with you; using On-Set Report*, no escribe
  `dayReports.template` y no corta. Lo mismo si la plantilla está en la papelera o a medio bajar (4.2).

### 6.3 El globito

Al tocar el botón, un globito con los datos ya puestos y editables; Enter crea:

- **Date:** hoy, con la **hora local** del dispositivo (a las 23:30 en Buenos Aires sigue siendo hoy, aunque en UTC
  sea mañana). Un rodaje nocturno que cruza la medianoche se corrige en el campo (PL6).
- **Shoot day:** el del último reporte + 1; si no se puede leer, la cantidad de reportes + 1.
- **Location:** la del último reporte; si no hay, vacía.
- **Template:** solo si la carpeta tiene más de una plantilla de reporte a mano; si no, no se muestra.
- **Si ya hay un reporte con esa fecha** (PL8): *Day 05 · 2026-10-02 already exists* con **Open** (Enter) y
  *Create another* (segunda unidad, un día partido).

### 6.4 De dónde salen los datos

- **"Último reporte":** entre las páginas de la carpeta (sin las de la papelera), la de fecha más alta; la fecha se lee
  del título (`AAAA-MM-DD` al principio) o de la fila *Date* / *Fecha* de su tabla de datos. Las páginas de la carpeta
  que no tienen fecha (una *Call sheets*, por ejemplo) no cuentan.
- **Leer una fila:** la primera tabla de 2 columnas de la página, la fila cuya primera celda dice (sin mayúsculas ni
  acentos) *Location*, *Place*, *Locación*, *Lugar* (lugar); *Date*, *Fecha*; *Shoot day*, *Day*, *Día de rodaje*,
  *Día*; *Unit*, *Unidad*; *VFX on set*, *VFX en set*; *Director · DP*, *Director · DF*. Si alguien renombró la fila,
  el dato queda vacío: nunca se adivina.
- **El anterior a medio bajar** (O2): si el último reporte no terminó de bajar (`row.update_seq` mayor que lo bajado),
  se usa lo que hay y el globito avisa *The previous report hasn't finished downloading — check the location*; el
  campo queda editable.
- **Se copian del anterior** (↻ en 2.3): locación, unidad, gente de VFX, director y DP, y la tabla *Camera package*
  entera. Lo demás sale vacío de la plantilla.
- **Escribirlos en la nueva:** sobre la lista de bloques, antes de copiarla (4.2): las mismas filas por rótulo. Vale
  para la de fábrica y para una propia.

### 6.5 La página

- **Título** (PL7): `2026-10-02 | Day 06` (`Día 06` en castellano): la fecha como código del "|" (D-10), que ordena y
  se busca igual en todos lados.
- **Lugar en el árbol:** al final de la carpeta; si la fecha elegida es anterior a la del último reporte, antes del
  primer reporte con fecha mayor (`keyBetween`), así la carpeta queda en orden.
- **Lo que pasa:** `tree.create` con `template_id`, el contenido (4.2) y, si cambió la plantilla, `dayReports.template`
  en la carpeta. Se abre la página nueva con el foco en *Summary*.

### 6.6 Sin red y con dos dispositivos

- Todo es local: el anterior está en el dispositivo y la cola del árbol crea la página.
- **Dos dispositivos sin red que crean el reporte del mismo día** terminan con dos páginas `2026-10-02 | Day 06`. No se
  fusionan solas (las dos pueden tener datos); al bajar la segunda, el globito ya dice que existe, y la barra lateral
  muestra las dos. Se evaluó un id fijo por carpeta y fecha (la subida ignora el repetido): los dos dispositivos
  escribirían su plantilla en la misma página y quedaría duplicada; se descartó. **Tampoco sirve escribir el contenido
  con un autor de Yjs fijo** (el truco de la semilla): los dos pueden tener distinto "reporte anterior", y el mismo
  autor y reloj con contenido distinto rompen el documento de Yjs, que sí perdería datos. Que nadie lo "mejore" así.
- **Cuando llega el segundo** (O6): la barra lateral y el globito marcan *2 reports for 2026-10-02*. Si uno quedó igual
  a como se creó (su huella de contenido, como `previous` en `writePage`), se ofrece mandarlo a la papelera; nunca se
  borra solo.

## 7. Modelo de datos y migración

**No hace falta migración.** Todo entra en lo que ya existe:

| Dónde | Qué | Lo hace cumplir |
|---|---|---|
| `pages.settings.template` | `{ description?, dayReport? }`: la página es una plantilla | `pages_settings_shape` (≤ 2000 caracteres), nivel 3 para cambiarlo |
| `pages.settings.templatesFolder` | `true`: la carpeta *Templates* del proyecto | ídem |
| `pages.settings.dayReports` | `{ template? }`: la carpeta de reportes; `false`: se dejó de usar a mano | ídem |
| `pages.template_id` | De qué plantilla salió (uuid de fábrica o id de página) | `grant insert`; nivel 3 para cambiarlo |

En la app: `PageSettings` suma las tres claves (no heredables), `PAGE_COLUMNS` suma `template_id` y `NewPage` lo
manda. La tabla `templates` del plan queda descartada (PL2). Si Lega eligiera la opción B de PL2, haría falta una tabla
`templates (id, workspace_id, name, description, content bytea, created_by, updated_at, removed_at)` sin acceso directo,
con funciones que pidan `workspace_role() in ('owner','admin')` para escribir y ser miembro activo para leer, más su
caché sin red y su propio editor: es lo que esta propuesta evita.

## 8. Versiones viejas de la app

- **El contenido** son bloques que conoce la versión mínima: una versión vieja abre una página creada desde una
  plantilla sin borrar nada (prueba con el esquema publicado).
- **Las claves de `settings`**: una versión vieja no las usa y las conserva al cambiar el formato o el encabezado
  (`setSetting` copia lo que no conoce) **si ya las recibió**. Pero `updatePage` sube el objeto entero: si una versión
  vieja (o cualquier dispositivo) cambia el formato de la carpeta a la vez que otro la marca, gana el último y la marca
  se pierde. No se pierde contenido; lo cubre la recuperación de 3 y 6.2. Más adelante, una función de la base que
  fusione claves (`settings || patch`), con su migración (roadmap P.23). Ve *Templates* como una carpeta común y no
  ofrece *New day report*.
- **`template_id`**: una versión vieja no lo baja ni lo escribe. Una página recuperada de la copia local (el `create`
  de recuperación de `tree.recoverAfterRestore`) vuelve sin `template_id`: es informativo; solo pesa para deducir una
  carpeta de reportes (6.2), y la marca de la carpeta lo cubre.
- **No hay que subir `min_app_version`.**
- **Una plantilla hecha con una versión más nueva** (con algo que esta no conoce): no se usa; aviso de actualizar
  (4.2, paso 1).

## 9. Ayuda, atajos y recorrida

- **Ayuda** (`src/help/entries.ts`, `src/i18n/lazy/help.ts`): *Templates* (la tira, *More…*, *Save as template*,
  editar una plantilla, *Customize*) y *Day reports* (la carpeta, el globito, qué se copia del día anterior, qué pasa
  si ya existe).
- **Atajo** (`src/ui/shortcuts.ts`): `newDayReport`, **`Mod-Alt-Shift-n`** (⌘⌥⇧N en la Mac, Ctrl+Alt+Shift+N en
  Windows), lugar `global`, contexto *day report*; texto en `src/help/shortcutTexts.ts`. Mismo molde que `history`
  (`Mod-Alt-Shift-h`). El matcher **reusa la guarda de `isCommentShortcut`** (`src/ui/commentsUi.ts`): con AltGraph no
  es el atajo (en un teclado polaco AltGr+N escribe ń) y la tecla se lee por `code === 'KeyN'` (en la Mac, con ⌥ la
  tecla escribe otro carácter). Descartados: ⌘⌥D (en la Mac esconde el Dock en todo el sistema) y ⌘⌥N (Chrome en la Mac
  lo usa para *Open split view*). En la entrega 2 se prueba en Firefox de Mac y en un teclado latinoamericano físico.
- **Recorrida:** el paso `page-menu` suma *Save as template* a su texto; ningún ancla nueva.
- **Buscar en el proyecto** (O9): las plantillas salen en los resultados con la marca *Template*; *Replace all* en el
  proyecto las saltea salvo que se marque *Include templates* (cambiar un rótulo en todos los reportes no debería
  cambiar el molde sin querer).
- **Ayuda de *Share***: una línea sobre la sección *Internal* de las plantillas (2.5).
- **Textos de la interfaz** (en / es): *Start from a template*, *More…*, *Templates*, *Built-in*, *This project*,
  *Other projects*, *Use*, *Customize*, *Apply template…*, *Save as template…*, *Clear filled-in values*, *Template
  settings…*, *Stop using as template*, *Use for day reports*, *New day report*, *Date*, *Shoot day*, *Location*,
  *already exists*, *Open*, *Create another*, y los avisos de 4.2 y 6.2.

## 10. Pruebas

- **Esquema publicado** (molde de `publishedCompat.test.ts`): cada plantilla de fábrica en los dos idiomas, escrita en
  un documento y abierta con el esquema de la versión publicada, no pierde ningún nodo.
- **Copia** (`src/templates/apply.test.ts`): nunca borra (el párrafo de la semilla queda; dos dispositivos que aplican a
  la vez conservan todo); la plantilla no cambia (mismo vector de estado antes y después); ids nuevos y únicos; el
  colapsado copiado con los ids nuevos; fotos del mismo proyecto registradas, de otro proyecto sacadas y contadas; con
  contenido desconocido, se corta sin escribir.
- **Reporte del día** (`src/templates/dayReport.test.ts`): fecha local con la zona de Buenos Aires a las 23:30 y a las
  00:30; el anterior por título y por tabla; rótulos en los dos idiomas y uno renombrado (vacío); día + 1 y sin número;
  ya existe; el orden al elegir una fecha anterior; carpeta sin reportes; sin red (solo cola).
- **Ajustes:** `setSetting` conserva `template`, `templatesFolder` y `dayReports` al cambiar el formato; con la marca
  perdida, la página adentro de *Templates* sigue siendo plantilla y la carpeta con reportes sigue siendo de reportes;
  *Stop using for day reports* gana sobre lo deducido.
- **A medio bajar** (O2): plantilla con `update_seq` mayor que lo bajado → aviso, nada copiado; al llegar, se copia
  entera. Reporte anterior a medio bajar → aviso en el globito.
- **Plantilla que no se ve** (O4): el globito usa la de fábrica, avisa y no escribe `dayReports.template`.
- **Otro proyecto** (PL10): saca `sdmedia://` y `sdfile://` de bloques, renglones y celdas, cuenta bien y deja las
  tarjetas de Drive.
- **Atajo** (B1): `Mod-Alt-Shift-n` en Mac y Windows; con `AltGraph` no dispara; con ⌥ en la Mac se lee por `code`.
- **Lo ya comprobado por la auditoría** (`auditTemplateCopy.test.ts`, 4 de 4): la plantilla no cambia, la copia es fiel,
  ids nuevos, la semilla queda última, fotos y huecos estables bien, colapsado remapeado, y los dos casos sin red
  (aplicar contra escribir; aplicar dos veces: duplica contiguo, no pierde). Se pasa al repo en la entrega 1, con el
  molde de `collabPhotosVersions.published.test.ts` para la `y-prosemirror` publicada.
- **Permisos en la interfaz:** sin nivel 4 en la carpeta no hay botón; sin nivel 3 no hay tira; *Save as template*
  deshabilitado sin permiso en *Templates*.
- **Registro de atajos e i18n:** las pruebas de siempre (`shortcuts.test.ts`, `i18n.test.tsx`).
- **Base:** ninguna nueva (no hay migración); las de permisos de páginas cubren crear y editar.

## 11. Entregas

| # | Qué | Prueba de aceptación |
|---|---|---|
| 0 | Las tres plantillas en el código (en y es) y una vista para mirarlas sin guardar (`/practice?template=on-set`, como la página de práctica). Riesgo bajo. | Lega abre las tres vistas en la computadora y en el iPhone, en inglés y castellano, y anota qué cambiar; la prueba con el esquema publicado pasa. |
| 1 | Crear desde una de fábrica: la tira, *More…*, *Apply template…*, la copia (4.2) y `template_id`. Ayuda. | Crear una página con "+", elegir *Shot Breakdown*, escribir; sin red, crear otra y elegir *On-Set Report*; volver la red: las dos suben, nada duplicado. Una versión publicada abre las dos sin perder nada. |
| 2 | El reporte del día: la marca de la carpeta, el botón, el globito, lo que se copia, "ya existe", el orden, el atajo. Ayuda. | En una carpeta *Reportes*, crear el primero desde la tira (queda `… | Day 01`); escribir una locación; en modo avión, *New day report* → Enter: `… | Day 02`, con la locación y el equipo de cámara de ayer; otra vez → *already exists* → Enter abre el de hoy. En la Mac, ⌘⌥⇧N en Chrome, Safari y Firefox abre el globito (y no la vista dividida de Chrome); en Windows con teclado latinoamericano, Ctrl+Alt+Shift+N también. |
| 3 | Plantillas propias: *Save as template*, *Templates*, editar, *Template settings*, *Stop using*, *Customize*, las de otros proyectos y sus fotos. Ayuda. | Guardar un reporte como plantilla con *Clear filled-in values*; editarla; el próximo *New day report* la usa; desde otro proyecto, usarla y ver el aviso de fotos. |

Cada entrega con su auditoría independiente antes de `main`.

## 12. Riesgos

| Riesgo | Qué tan grave | Qué se hace |
|---|---|---|
| Montar un editor sobre la plantilla le escribiría arreglos | Alto si pasara | Se lee una copia en memoria (4.2); prueba del vector de estado. |
| Una plantilla de una versión más nueva perdería lo desconocido al copiarse | Medio | `findUnknownContent` corta antes, como `writePage`. |
| Dos dispositivos llenan la misma página vacía | Bajo (duplica, no pierde) | Tira solo en el dispositivo que la creó; se inserta sin borrar. |
| Dos reportes del mismo día sin red | Bajo (duplica, no pierde) | Se ven los dos; el globito avisa al día siguiente. |
| Un rótulo renombrado o una tabla reordenada | Bajo | Ese dato queda vacío; nunca se escribe en otra fila. |
| Fecha mal por zona horaria o rodaje nocturno | Bajo | Hora local; el campo se corrige antes de Enter. |
| *Templates* visible para un cliente que ve todo el proyecto | Medio (notas internas) | La ayuda lo dice; compartir con clientes por página, no el proyecto. |
| Datos internos (cotización, proveedor) en una página que ve un cliente (O8) | Medio | Sección *Internal* al final, para borrar antes de compartir; ayuda. |
| La marca de plantilla o de carpeta de reportes se pisa con otro cambio de ajustes a la vez (O1) | Medio (se pierde la marca, no contenido) | Se deduce de la carpeta y de los reportes y se vuelve a escribir al crear; la fusión en la base, en el roadmap. |
| Plantilla o reporte anterior a medio bajar (O2) | Medio | Se compara `update_seq` con lo bajado; aviso; nunca se copia a medias. |
| La plantilla de la carpeta no está compartida con quien crea el reporte (O4) | Bajo | La de fábrica, con aviso. |
| Un atajo que choca con el navegador (B1) | Resuelto | ⌘⌥⇧N con la guarda de AltGr; probado en los tres navegadores en la entrega 2. |
| Fotos de una plantilla de otro proyecto | Bajo | Se sacan y se avisa (PL10). |
| `settings` lleno (2000 caracteres) | Bajo | Descripción ≤ 300; si no entra, *Save* avisa sin guardar a medias. |

## 13. Decisiones propuestas

### PL1 · El contenido de las tres plantillas

- **Qué pasaba:** el plan dejaba los campos "para definir con Lega". En un rodaje, el lunes a las 7 hay que anotar
  lente, altura y stop de cada setup, HDRI y chrome ball, y nadie arma la tabla en el momento.
- **Las opciones:** A) las de la sección 2: ficha de datos arriba y secciones por tema, con tablas angostas y casillas;
  B) solo títulos vacíos, para que cada uno los llene; C) una tabla grande por página, como una planilla.
- **Elegí A porque** trae lo que se anota en VFX (escena, trabajos, elementos, preguntas; cámara, lente, filtros, EI,
  balance, clip y timecode, tomas elegidas, HDRI, rejillas de distorsión, LiDAR, medidas, marcadores; ficha por plano)
  y entra en una hoja A4; lo interno (cotización, proveedor, riesgos) va al final en *Internal*, para borrarlo antes de
  compartir con un cliente.
- **Si preferís otra:** la entrega 0 las muestra sin guardar nada; los cambios de texto o de filas son de una línea en
  `builtin.*.ts`. A mirar ahí: si *Setups & takes* conviene partirla, y si *Internal* va o se saca.

### PL2 · Dónde viven las plantillas propias

- **Qué pasaba:** el plan proponía una tabla `templates` con el contenido en bytes. Editar el *On-Set Report* de ERSO en
  el set, sin red, en el iPhone, pediría otro editor, otra caché y otros permisos.
- **Las opciones:** A) una plantilla es una página marcada en `settings`, en una carpeta *Templates* del proyecto; B) la
  tabla `templates` con el contenido; C) una tabla que apunta a páginas.
- **Elegí A porque** "todo es una página": se edita, sincroniza, comenta y restaura como cualquier página, los permisos
  son los de la página y no hace falta migración.
- **Si preferís otra:** B pide la migración de la sección 7 y su editor; C es A con una tabla más, útil solo para
  listarlas desde el servidor.

### PL3 · Dónde se elige la plantilla

- **Qué pasaba:** el "+" crea la página al instante. Si siempre preguntara "¿qué plantilla?", crear una carpeta para
  *Escena 12* costaría un clic de más cada vez.
- **Las opciones:** A) la tira en la página vacía, más *More…* y *Apply template…*; B) una ventana al tocar "+"; C) un
  "+" con flecha y menú de plantillas.
- **Elegí A porque** no frena el caso común (se escribe y la tira se va) y la plantilla queda a un toque, como en
  Notion; anda igual en el teléfono.
- **Si preferís otra:** B y C usan la misma ventana y la misma copia; cambia solo el botón.

### PL4 · *Shot Breakdown*: por plano o una tabla

- **Qué pasaba:** un desglose de 40 planos en una tabla de 10 columnas no entra en una hoja, y las notas y fotos de cada
  plano no tienen lugar en una celda.
- **Las opciones:** A) una página por plano (ficha) y la lista de planos en *Pre-production Notes* como índice; B) una
  página por secuencia con una tabla; C) las dos.
- **Elegí A porque** cada plano tiene sus fotos, devoluciones y preguntas, y es como quedaron las fichas de Coda
  (todo bakeado).
- **Si preferís otra:** B es otra función en `builtin.ts` con la tabla de 2.2.

### PL5 · Cuál es la carpeta de reportes

- **Qué pasaba:** el botón tiene que saber dónde crear el día 7. Si el proyecto tiene *Reportes – Unidad 1* y
  *Reportes – Unidad 2*, adivinar mal mezcla los días.
- **Las opciones:** A) una carpeta marcada (`dayReports`), que se marca sola con el primer reporte; B) siempre al lado del
  reporte abierto, sin marca; C) preguntar cada vez.
- **Elegí A porque** el botón aparece también en la carpeta (antes del primer día o con la carpeta abierta), guarda la
  plantilla de ese rodaje y admite varias unidades. Si la marca se pierde por dos cambios a la vez, se deduce de los
  reportes de adentro y se vuelve a escribir; si quien crea no ve la plantilla de la carpeta, usa la de fábrica con un
  aviso.
- **Si preferís otra:** B sale de sacar la marca y usar el padre; se pierde el botón en la carpeta.

### PL6 · De dónde salen la fecha y el lugar

- **Qué pasaba:** a las 00:40 de un nocturno, la fecha del dispositivo ya es mañana; y el GPS da una dirección, pero en
  el set se escribe "Estancia La Paz – galpón".
- **Las opciones:** A) un globito con la fecha local de hoy y la locación del reporte anterior, editables, Enter crea;
  B) crear directo sin preguntar; C) la ubicación del dispositivo.
- **Elegí A porque** casi siempre es Enter y listo, pero el nocturno o el reporte de ayer hecho tarde se corrigen antes
  de crear; la ubicación pide permiso, red para la dirección y no dice el nombre del set.
- **Si preferís otra:** B es saltear el globito (queda para un clic largo); C se suma como botón en el campo.

### PL7 · El nombre de la página del día

- **Qué pasaba:** en la barra lateral, `Día 6`, `Day 6 - jueves` o `02/10` no ordenan ni se buscan igual, y `02/10` se lee
  distinto en Argentina y en Estados Unidos.
- **Las opciones:** A) `2026-10-02 | Day 06`; B) `Day 06 | 2026-10-02`; C) `Day 06 · Estancia La Paz`.
- **Elegí A porque** la fecha ISO ordena, no es ambigua y queda como código del "|" alineado en la barra; el número de
  día va al lado.
- **Si preferís otra:** es una línea; las páginas ya creadas no cambian.

### PL8 · Si ya existe el reporte de hoy

- **Qué pasaba:** el data wrangler toca el botón de nuevo a la tarde para seguir cargando y se encuentra con dos
  *Day 06*.
- **Las opciones:** A) el globito avisa y Enter abre el existente, con *Create another* aparte; B) crear igual; C) no dejar
  crear otro.
- **Elegí A porque** el caso común es volver al de hoy, y una segunda unidad o un día partido siguen siendo posibles.
- **Si preferís otra:** B o C cambian solo el botón principal del globito.

### PL9 · El idioma de las plantillas de fábrica

- **Qué pasaba:** la interfaz está en inglés y castellano, pero el contenido es del equipo: un reporte para una
  productora de afuera va en inglés; uno para un rodaje local, en castellano.
- **Las opciones:** A) en el idioma de la interfaz al crearla; B) siempre en inglés; C) elegir el idioma en la ventana.
- **Elegí A porque** es lo que hace la página de práctica y quien quiere el otro idioma lo personaliza una vez
  (*Customize*); el reporte del día lee los rótulos de los dos idiomas.
- **Si preferís otra:** C suma un selector a *More…*.

### PL10 · Fotos de una plantilla de otro proyecto

- **Qué pasaba:** la plantilla de ERSO tiene el croquis de los marcadores; usada en MGTZD, esa foto es de otro proyecto
  (su Drive) y mostraría la tarjeta de "otro proyecto" en lugar de la foto.
- **Las opciones:** A) sacarlas y avisar cuántas; B) dejarlas con la tarjeta de "otro proyecto"; C) volver a subirlas al proyecto nuevo.
- **Elegí A porque** no deja tarjetas de "otro proyecto" en una página nueva ni sube nada sin que la persona lo sepa;
  se decide sin red (proyecto de la plantilla contra el de la página) y vale para fotos, videos, adjuntos y carpetas;
  las tarjetas de Drive, que son un link escrito, se copian; en el mismo proyecto se copia todo.
- **Si preferís otra:** C necesita red y el portero de los dos proyectos; queda para después.

## 14. Fuera de este diseño

- Copiar también las subpáginas de una plantilla (por ejemplo, una escena con sus planos).
- "Siguiente plano" (`012_020` después de `012_010`), con el mismo globito del reporte del día.
- Clima y amanecer/atardecer automáticos (piden red y coordenadas).
- Esconder las de fábrica por proyecto; plantillas para todo el workspace sin compartir carpetas.
- Insertar una plantilla en una página que ya tiene contenido.

## Correcciones de la auditoría (2026-10-02)

Auditoría independiente sobre `39e9559`: "aprobado con cambios", 1 bloqueante y 10 observaciones. Comprobó la copia con
una prueba propia (4 de 4: la plantilla no cambia, copia fiel, ids nuevos, semilla última, fotos y huecos bien,
colapsado remapeado, los dos casos sin red).

| Hallazgo | Corrección |
|---|---|
| **B1** ⌘⌥N es *Open split view* de Chrome en la Mac | Atajo `Mod-Alt-Shift-n` (⌘⌥⇧N / Ctrl+Alt+Shift+N), con la guarda de AltGr y `code` de `isCommentShortcut` (6.1, 9, 10, entrega 2). |
| **O1** `settings` se sube entero: dos cambios a la vez borran la marca | Escrito en 1, 8 y 12. La marca se deduce (página adentro de *Templates*; carpeta con reportes) y se vuelve a escribir al crear; *Stop using* explícito gana (3, 6.2). Fusión de claves en la base: roadmap P.23. |
| **O2** Plantilla o reporte anterior a medio bajar | Control de `update_seq` contra lo bajado: la plantilla no se copia a medias (aviso, *Wait*, *Use built-in*); el reporte anterior se usa con aviso (4.2, 4.3, 6.4, 10). |
| **O3** §1 decía que la foto de otro proyecto se ve rota y no se registra | Corregido: se registra como uso ajeno y muestra la tarjeta de "otro proyecto". Regla de PL10 sin red, con `sdfile://`, carpetas y tarjetas de Drive (4.2). |
| **O4** La plantilla de la carpeta que esa persona no ve | La de fábrica con aviso, sin escribir `dayReports.template` (6.2, PL5). |
| **O5** *Apply template…* con la página abierta | Se inserta con el editor visible, así entra en el deshacer (4.2). |
| **O6** Dos reportes del mismo día | Marca *2 reports for…* y papelera ofrecida si uno quedó sin tocar; por qué no un autor de Yjs fijo (6.6). |
| **O7** Faltaban datos de set | Sumados: rejillas de distorsión, filtros (ND, difusión, pola), EI y balance, clip y timecode, tomas elegidas, LiDAR y fotogrametría; *Handles*, *Lens* y clip en *Shot Breakdown*. *Setups & takes* sigue en 7 columnas (2.3, 2.4). |
| **O8** *Bid*, proveedor y riesgos podían llegar a un cliente | Sección *Internal — remove before sharing* al final de las dos plantillas, y la ayuda (2.5, 9). |
| **O9** Buscar y reemplazar en el proyecto toca *Templates* | Resultados con la marca *Template*; *Replace all* las saltea salvo *Include templates* (9). |
| **O10** Una página recuperada vuelve sin `template_id` | Anotado en 8 (informativo). |
| PL1, PL5 y PL10 "aprobado con cambios" | Reescritas con O7 y O8, O1 y O4, y O3. |

## Cómo quedó (entregas 0 y 1)

**Entrega 0.** `src/templates/builtin.ts` arma las tres con los textos de `builtin.en.ts` y `builtin.es.ts` (mismas
filas, cambian solo los textos; una prueba lo compara) y sus ids fijos (`BUILTIN_IDS`). La vista previa es la página de
práctica con `?template=pre-production|on-set|shot-breakdown` y `&lang=en|es`: el mismo documento en memoria (no se
guarda ni se sincroniza), con un selector de plantilla y de idioma del contenido en el aviso de arriba, así se revisan
las tres en los dos idiomas sin cambiar el idioma de la app. Las tablas de 5 a 7 columnas llevan su ancho (680 px
repartidos, el `colwidth` de siempre de las celdas) para entrar en una A4 vertical.

**Entrega 1.**

- **La tira** (`src/templates/TemplateHost.tsx`, montado en `PageEditor`): sale en una página editable, completa en el
  dispositivo, vacía (solo párrafos vacíos, `isEmptyPage`), sin subpáginas y **creada acá**. "Creada acá" es la lista
  `templateOffer` de `meta` (`PageTree.isFresh`): la anota `tree.create` cuando la página se crea sin título ni
  plantilla, que es lo que hace el "+" (la importación de Coda siempre pone título), y se borra al tener contenido o al
  usar una plantilla; se recuerdan las últimas 50. En el teléfono la tira va debajo del rótulo y se desliza de costado.
- **La ventana *Templates*** (*More…* y *Apply template…*): por ahora solo *Built-in*, con su descripción, *Preview* y
  *Use*. *Apply template…* está en el menú de la página para quien puede editarla; con contenido queda apagado con el
  tooltip *Only on an empty page*. Desde la barra lateral, sobre una página que no está abierta, el menú no puede
  saber si está vacía: el renglón queda habilitado (desvío de 4.1, que lo pide apagado), abre la página y, ya cargada,
  muestra la ventana si está vacía o el aviso *Only on an empty page* si no (`templatesUi.ts`). Mientras la página se
  baja, los *Use* dicen *The page is still loading*. Una página con título también puede recibir una plantilla por el
  menú; el título queda y el foco va a la página.
- **La copia:** `insertTemplate` agrega los bloques **antes del primer bloque** de la página con el editor visible (entra
  en su deshacer); el párrafo de la semilla queda al final y lo que otro dispositivo haya escrito a la vez queda debajo.
  Después, `template_id` va con un `update` de la cola del árbol (la página ya existe), y el foco al título si está
  vacío. El editor queda con el punto de escritura en el primer dato de la ficha (la 2.ª celda de la 1.ª fila de la
  primera tabla), sin llevar el foco ni escribir nada: Enter en el título lleva ahí y no al párrafo vacío del pie
  (corrección de la auditoría de `090d676`, O1). Recién elegida, Ctrl/⌘+Z en el título vacío saca la plantilla y
  Ctrl/⌘+Shift+Z la devuelve, hasta que se escribe en el título o se sale de él; en cualquier otro momento el título
  no deshace la página (`undoGuard.ts`). `copyTemplateDoc` (pasos 1 y 2 de 4.2 para una plantilla que es una página: copia en memoria,
  `findUnknownContent`, ids nuevos, colapsado remapeado) está escrito y probado con la prueba de la auditoría, pero
  todavía no lo usa la interfaz: lo usa la entrega 3, que suma el control de `update_seq` y PL10.
- **`template_id`:** `PAGE_COLUMNS` lo baja, `NewPage` lo puede mandar (`tree.create(…, { templateId })`, para las
  entregas 2 y 3) y `PagePatch` lo acepta. La recuperación después de restaurar una copia de la base lo reenvía (solo
  si hay uno, nunca para borrarlo). **Deshacer la plantilla deja `template_id`** y la tira no vuelve (se puede volver a
  elegir con *Apply template…*): la entrega 2, que deduce la carpeta de reportes por páginas con `template_id` de
  *On-Set Report* (6.2), tiene que contar solo las que tienen contenido.
- **Pruebas:** `builtin.test.ts` (forma, idiomas, bloques conocidos, anchos, la versión publicada y la anterior abren
  cada plantilla sin escribir), `builtin.published.test.ts` (la `y-prosemirror` real de v0.052 a v0.075), `apply.test.ts`
  (vacía, deshacer, dos dispositivos sin red, y la copia de la auditoría), `sync.test.ts` (la prueba de aceptación con
  el servidor en memoria: con red, sin red y al volver; la marca de "creada acá") y `templateHost.test.tsx` (la tira, la
  ventana y el menú en la página de verdad: Enter al primer dato, deshacer desde el título, las dos guardas de página
  vacía, el foco con título y la barra lateral con una página con texto). La vista previa, en `practice.test.tsx`.
- **Auditoría independiente sobre `d772721`** (2026-10-02): pasa con observaciones, sin bloqueantes. Corregidas la
  prueba y los docs del punto de escritura, el foco con título, deshacer desde el título, la barra lateral con texto,
  las pruebas de las guardas de vacía y `template_id` en la recuperación; al roadmap, *Exit* de la vista previa y el
  aviso de ProseMirror al abrirla.
- **Pendiente para Lega:** mirar las tres vistas previas en la computadora y en el iPhone (PL1) y decir qué cambiar.
