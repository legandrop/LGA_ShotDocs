# Relaciones en vivo: el motor (E1, v0.237)

La app reconoce sola, en el dispositivo, qué escenas y locaciones nombra cada página, y arma con eso un índice: dónde
se nombra cada escena (en un título de sección, en el texto o con un link), qué secciones abre y qué fotos hay en
cada una. Es el motor de la propuesta «D» (escribir libre, relacionar solo, preparar el día antes): la cabecera de
escena, locación y día, el subrayado pasivo, el `/` con escenas, el mapa y *Prepare tomorrow's report* (entregas E2
a E9) se dibujan con este índice. Esta entrega no muestra nada todavía, salvo el progreso de la primera lectura.

Nada de esto escribe en el documento ni sube a la base: se arma con lo que la persona ve y se recalcula al escribir.

## 1. Qué hay y dónde

| Pieza | Archivo | Qué hace |
|---|---|---|
| Lector | `src/relations/reader.ts` | Dado lo que existe (`buildRegistry`) y un texto, dónde nombra escenas, pendientes y locaciones (`scan`). Puro. |
| Lo de cada bloque | `src/search/extract.ts` (`unitsFromYDoc(doc, meta)`, `BlockMeta`) | En la misma pasada que el texto de la búsqueda: nivel de título, links a páginas (`/p/<id>`) y fotos (`sdmedia://`) de cada bloque. |
| Una página | `src/relations/pageRelations.ts` (`readPageRelations`) | Menciones (entidad → bloque, por título, texto o link) y secciones con sus fotos. Puro. |
| Qué es cada página | `src/relations/register.ts` (`registerProject`) | Con el tipo de `kind.ts` (E2): a qué escena o locación se refiere cada página, su episodio, su etapa; `graph: false` (sección 4). |
| El índice | `src/relations/relationIndex.ts` (`RelationIndex`, `entityRelations`, `pendingRelations`, `pageRelations`, `indexPages`) | Reconoce cada página con lo que ya leyó la búsqueda, de a poco y solo lo que cambió; la consulta es pura sobre una foto. |
| Lectura y caché | `src/search/projectIndex.ts`, `src/search/indexCache.ts` | El índice de la búsqueda, que ahora arranca al abrir el proyecto, se guarda en el dispositivo y relee la página abierta. |
| En la app | `src/ui/relationsUi.ts` (`RelationsSession`, `RelationsRunner`, `useIndexProgress`), `Sidebar.tsx` (`IndexProgress`), `Workspace.tsx` | Arranque, relectura a 500 ms, progreso y el objeto de depuración. |

## 2. El lector

Es la gramática de la maqueta S3/S4 (`engine.js`), portada a TypeScript y medida igual (sección 7):

- **Escenas con letra propia** (`101_069A`, `104_054A`) son su propia escena y nunca se pliegan a la base. La letra
  es una «parte» (`1074C` → `101_074`, parte C) solo si la escena con letra no existe.
- **Formas:** nombre de plano (`ERSO_105_027_010`), canónica (`105_027`, `105-027`, `105_027b`), compacta (`5027b`,
  `H1067`, `2065A_PD`), con cero (`0116B`, solo en títulos), corta (`5-27A`), «Esc 27» dentro de su episodio;
  continuaciones `+ 029B`, `/46`, `+C`, `+14` y rangos `105_70-72` (las del medio, `hidden`: cuentan, no se dibujan).
- **El dígito de la forma compacta** sale de los episodios que existen (101…109 → 1…9, también 201…); si dos
  terminan igual (110 y 210), la forma compacta se apaga y queda la canónica.
- **Regla de títulos:** en un título, una forma compacta o corta cuenta solo si es lo primero o va tras
  «Escena/Sc». En el texto, solo con «Escena/Sc/plano/toma» delante, con letra pegada, con H delante o con «plano»
  después: años, direcciones, horas, cantidades e ids no cuentan.
- **Pendiente:** una escena nombrada con una forma fuerte que no existe ni con letra, de un episodio que existe.
- **Locaciones:** por nombre o alias, palabra entera, sin tildes ni mayúsculas; los genéricos (*Estudio*, *Casa*,
  *Centro*, *Europa*, *Abril*) y los alias de menos de 4 letras que no van en mayúsculas no se reconocen solos.
- **Proyectos sin episodios** (un largo, D383): la escena se escribe con 3 cifras y su letra (`074`, `069A`).
  Cuenta con «Escena/Esc./Sc/Scene» delante (texto o título), como nombre de plano `ABC_074_010`, o como lo primero
  de un título si tiene 3 cifras con ceros (`074`, `074A`), 3 cifras con `|`, `-`, `:`, `.` o nada después
  (`120 | Plaza`), o lo sigue INT/EXT (`12 - INT. COCINA`) (D391). Nunca una letra pegada a 1–2 cifras («3D
  Tracking», «4K Plates», «2D»), una lista numerada («1. General»), «plano 12», «toma 74» ni un número suelto: lo
  dibujado en un título decide de quién son las fotos de la sección. Las formas compactas de 4 cifras no existen en un
  largo.
- **«Esc» sin punto** cuenta solo con un número de 2 cifras o más: «Presioná Esc 2 veces» es la tecla (D392).

## 3. El índice

- **Lo de cada bloque** se lee en la misma pasada que la búsqueda (`ProjectIndex.readPage`): abrir los documentos
  es lo caro y se hace una sola vez. `BlockMeta` va solo para los bloques con título, fotos o links; el texto es el
  de las unidades de la búsqueda (no se guarda dos veces).
- **Menciones:** por bloque, cada escena, pendiente o locación con su forma de llegar: título (`heading`), texto
  (`text`) o link a su página (`link`, la señal más fuerte: los renglones «→ Escena 101_074» de un día). Un link a
  otra página tapa su texto. Los nombres de archivo no cuentan; los pies de foto sí.
- **Secciones:** cada título abre una sección hasta el próximo título de su nivel o mayor. Si nombra escenas, la
  sección es de ellas y las fotos de adentro (también las de sus subsecciones) son suyas, no del día entero.
- **Etapa de cada página** (`PageRole.stage`): escena o lo de adentro → desglose; día o lo de adentro → rodaje; lo de
  adentro de una locación → scouting; la locación → `location`; lo demás → `other`.
- **Páginas índice:** más de 20 escenas y locaciones distintas (`INDEX_PAGE_MIN`): quedan marcadas (`indexPage`) para
  que la cabecera las pliegue. En ERSO son 9 (BD Main, su Backup, Rodaje Planning, Locaciones, EP 101–105).
- **`graph: false`** en una página o carpeta la saca de las relaciones, con todo lo de adentro (por ejemplo
  `90 | Archivo`). Vive en `settings.graph` (D387) y no se hereda con `resolveSetting`: se mira acá.
- **Reconocer de nuevo** solo lo necesario: cada página se recalcula si cambió lo leído, su episodio o lo que existe en
  el proyecto (una escena nueva vuelve a reconocer todo, sin abrir documentos), cediendo el hilo cada 12 ms.
- **Permisos:** solo cuentan las páginas que la persona ve ahora (el árbol, sin la papelera), igual que la búsqueda:
  lo leído antes de perder un acceso puede seguir en el dispositivo, pero no se consulta.

### Consultas (para E3 en adelante)

Sobre la foto (`relationIndex.snapshot(projectId)`):

- `entityRelations(snap, 'scene' | 'loc', ref)`: la página de la entidad; por página, su etapa, si es índice, si es
  propia (la escena misma o sus fichas), las menciones y las secciones de esa escena (la más externa de cada tramo);
  `byStage`; las fotos de sus secciones; y `complete` (todo leído y nada por bajar: si es `false`, la cabecera no se
  muestra como completa).
- `pendingRelations(snap)`: las escenas nombradas que no existen, con dónde.
- `pageRelations(snap, pageId)`: lo que nombra una página (para el subrayado).
- `indexPages(snap)`.
- `pageFields(snap, pageId)` y `findFields(snap, nombre)`: los campos de las páginas (abajo).

### Campos: «rótulo: valor» (E3b, v0.240)

Una ficha de desglose importada de Coda es una tabla de dos columnas (`Shot Name | ERSO_105_027_010`, `Locacion Guion |
Ambulancia | Ruta INT` con su link, `Fecha Rodaje | 06/03/2026`) y unos títulos con su texto (`Descripción`,
`Consultas`). `src/relations/fields.ts` los lee de lo que ya leyó la búsqueda, sin escribir nada:

- **Tabla de dos columnas:** cada fila cuya primera celda parece un rótulo (corta, con letras, no una oración) es un
  campo, con cualquier rótulo; una celda vacía da un valor vacío. Para esto `BlockMeta` suma, en las tablas, `cells`
  (fila y columna de cada unidad) y `cols`: las unidades solas no dicen dónde termina una fila. Las unidades de la
  búsqueda no cambian (prueba). `CACHE_FORMAT` pasó a 2: lo guardado antes se relee una vez.
- **Título** que dice entero un rótulo conocido («Consultas», «Open questions:»): el valor es lo de abajo hasta el
  próximo título o hasta un renglón que es otro campo.
- **Renglón** que empieza con un rótulo conocido y dos puntos («Consultas: ¿…?», «INT/EXT: INT»). Solo al principio:
  «quedó una open question: …» o «Open question about…» no son campos.
- **Rótulos conocidos** (`FIELD_LABELS`, comparados sin tildes ni mayúsculas y con la puntuación como espacio, `normLabel`):
  `openQuestion` (Consultas, Open question(s), Pregunta abierta…), `set` (Locacion Guion, Decorado(s), Set(s)), `intExt`,
  `shootDate` (Fecha Rodaje, Shoot date), `location` (Locacion Real, Location), `coords`, `description`, `shot` (Shot
  Name), `vfxCat`. Un campo nuevo se suma ahí.
- **Coordenadas:** las primeras de la página (grados con hemisferio, o un par decimal de 4 decimales o más con signo o
  hemisferio; nunca «N°3925», una dirección, un año, un formato «1.7778, 2.3900» ni una hora), en `PageFields.coords`.
  Un par decimal sin signo cuenta solo como valor de un campo de coordenadas (`coordsIn(text, true)`).

Cada `FieldValue` trae el rótulo escrito, su clave normalizada, el valor como texto (un renglón por línea), los links del
valor a páginas de la app (`{ pageId, text }`), el bloque y, en un título, dónde termina (para ir ahí con la sección
resaltada). El índice de relaciones los calcula con cada lectura de la página (memo por contenido: no dependen de lo
que existe en el proyecto) y la foto los trae en `snap.fields`, solo de las páginas que la persona ve y que tienen alguno.

**Para E5:** `cardFields(snap, 'shootDate').filter((x) => fieldDate(x.field.text) === '2026-02-20')` da las fichas de
ese día con su escena (`{ pageId, scene, field }`; `fieldDate` entiende `06/03/2026`, `6-3-2026`, `2026-03-06`).
`cardFields` es `findFields` solo con lo de adentro de una escena (`roles.get(id)?.partOf?.kind === 'scene'`): en ERSO
`findFields(snap, 'shootDate')` trae además 102 copias de fichas pegadas adentro de los planes de cada día, que
contarían doble; `fieldValues(pageFields(snap, id),
'openQuestion')` da la pregunta abierta de una ficha; `emptyValue` dice si un valor es «—», «n/a» o vacío; una lista de
rótulos propia (`['Consultas Cat']`) también sirve como nombre.

## 4. El tipo de cada página (E2: D368, D369)

- **El tipo lo da `src/relations/kind.ts`** (`kindReader(tree).kindOf(id)`: `{ kind: 'scene' | 'location' | 'day';
  code }`, `{ kind: 'part'; of; ofKind; code }` o `{ kind: 'none' }`; `excluded(id)` para las plantillas).
  `registerProject(tree, projectId, kinds = kindReader(tree))` le suma, por página, a qué escena o locación se
  refiere, su episodio (el de su escena), su etapa y si está fuera de las relaciones.
- Reglas (de `kind.ts`): la marca de la página (`settings.entity`) gana y `false` la saca; si no, la carpeta con tipo
  (`settings.holds`; los días, la carpeta de reportes, D369) se lo da, salvo a los grupos (un episodio `101`,
  `EP 101`, `101 | Episodio 1`; un bloque de días); adentro de un grupo de días es día un reporte o lo que tiene fecha
  y número de día; lo de adentro de una entidad es «parte de» ella. El número de escena del título: completo al
  principio → corto con el episodio del grupo → última parte entera (`074 | … | 101-074`, la forma ERSO) → sin
  episodio de contexto, uno de 3 cifras (`074`, D383), o 1–3 con «Escena» delante; nunca `3D | Tracking` (D391).
  En la carpeta de escenas de una serie (con carpetas de episodio) no hay número sin episodio: «100 | Notas» al lado de
  los episodios es una escena sin número.
- **Sin episodios (D383):** `SCENE_CODE` acepta `074`, `069A`. Un número sin episodio sacado del título no reemplaza
  uno guardado con episodio (la escena salió de la carpeta de su episodio). Un título de solo `074` en la carpeta de
  escenas sigue siendo un grupo: `074 | título` o la marca lo vuelven escena.
- **`graph: false`** (D387) es una clave de `PageSettings`; la lee `registerProject` en la página y sus carpetas (no
  `kind.ts`), y viaja al exportar e importar.
- El nombre y los alias de una locación salen de su título (D416): el título entero y las partes separadas por ` / ` o
  ` | `. Lo de adentro de un paréntesis nunca es alias. El nombre sin el paréntesis lo es solo con dos palabras o más y
  si ninguna otra locación lo comparte (`La Arenera (estudio)` → «La Arenera»; `Lübben (Europa)` no da «Lübben», que en
  el guion es el decorado, ni `Europa (plates)` da «plates», palabra de cualquier reporte de VFX). De una sola palabra
  y sin compartir, vale solo para el lugar de un día por su título (D417: «Día 73 | Inquilinato» es
  `Inquilinato (Cachi 247)`; `dayTitleAliases`, `scan(…, { dayTitle: true })` en `dayRef`). Lo arma `registerProject`
  (`locationFromTitle`, `bareLocationName`).

## 5. Arranque, caché y relectura

- **Al abrir el proyecto** (`RelationsRunner` en `Workspace.tsx`, no con un link público) se arma el índice de la
  búsqueda y se lee lo que falte, cediendo el hilo como antes; también al sincronizar y al cambiar el árbol. Antes se
  armaba la primera vez que se abría ⌘K. Las relaciones lo retienen (`ProjectIndex.retain`): cerrar el panel de buscar
  ya no corta la lectura. Cambiar de proyecto sí: la pasada del anterior se corta (lo leído queda y se guarda) y arranca
  la del nuevo; el progreso es siempre del proyecto abierto.
- **Caché:** lo leído de cada página (unidades, anotaciones y `BlockMeta`, sin el texto normalizado) se guarda en la
  base local, store `meta`, clave `searchIndex:<proyecto>:<página>` (nunca `docDirty:`), con su marca
  `version:cursor` y el formato (`CACHE_FORMAT`). Al abrir un proyecto se recupera solo lo suyo, sin abrir documentos,
  y solo se lee lo que cambió. Una fila rota se descarta sola (y se relee esa página) sin cortar la pasada. Una página
  con ediciones sin subir (marca `docDirty:`) se vuelve a leer igual (la versión se suma en otra transacción y la app
  pudo cerrarse en el medio). Lo que ya no está en el árbol se borra del caché al terminar la pasada; lo de otro
  formato, al recuperarlo. Lo de la página abierta (documento vivo) no se guarda: al cerrarla se relee de lo
  guardado. Se guarda de a tandas (cada 3 s y al terminar): si la app se cierra a mitad, no empieza de cero.
- **Relectura:** medio segundo después de la última edición local (`REREAD_MS`), la página abierta se relee de su
  documento vivo (`ProjectIndex.readOpen`) y se reconoce de nuevo solo esa página. Lo que llega de otros se lee con la
  pasada de cada sincronización.

## 6. Progreso

Mientras el índice lee 20 páginas o más (`PROGRESS_MIN_PAGES`: la primera vez en un dispositivo, o después de muchos
cambios), un renglón después del árbol dice **«Reading 340 of 921…»** (páginas al día de las del proyecto), en texto
chico y apagado, con un tooltip que dice para qué es. Mientras el árbol es más largo que la pantalla queda pegado al
borde de abajo de la barra lateral (el pie con la ayuda queda al final del árbol y en un proyecto grande no se ve). No
salta, no se cierra a mano y se va solo al terminar. Una lectura chica no lo muestra (sería un parpadeo). La ayuda tiene
su entrada (*Reading the project*). Visto en Chromium a 1440 y 390, claro y oscuro, con el arnés de la sección 8.

## 7. Medido

**Lector sobre ERSO** (las 640 páginas originales del export, el mismo parser de la maqueta; verdad `mapa.json`):
**139 de 139** secciones de reporte a su escena exacta, **0** escenas de más, **83 de 83** pares planning-escena,
**0** pendientes en todo ERSO. Contra `engine.js` unidad por unidad: **43.259 de 43.259** iguales; secciones y fotos por
sección, **6.824 de 6.824** iguales. Las 9 páginas índice son las que esperaba la auditoría.

**Rendimiento** (ERSO reorganizado, 921 páginas importadas con la app a un dispositivo de prueba, Node 22 en la PC de
escritorio; fake-indexeddb no es el IndexedDB de Safari: el orden de magnitud vale, la cifra fina hay que medirla en el
iPhone):

| Qué | Medido |
|---|---|
| Primera lectura del proyecto (búsqueda + lo de cada bloque), sin caché | **4,3 s** (la búsqueda sola medía 4,9 s; lo de cada bloque suma ruido: ±10 ms sobre ~150 ms de extraer) |
| Reconocer todo el proyecto (226 escenas, 52 locaciones, 6.404 menciones, 7.543 secciones) | **274 ms**; de nuevo sin cambios, 2 ms; el registro, 2 ms |
| Caché en el dispositivo | 921 páginas, **7,1 MB** (con el texto de cada bloque); guardar todo, 67 ms |
| Abrir de nuevo con el caché | **0 documentos abiertos**; índice 0,8 s (rearmar el texto normalizado) + reconocer 0,25 s |
| Releer la página abierta al dejar de escribir: Día 58 (605 unidades) | leer 1,3 ms + reconocer 3,5 ms (peor 7,5 + 9 ms) |
| Ídem, la página más grande (*ERSO \| BD Main*, 5.281 unidades, página índice) | leer 22 ms + reconocer 8 ms (peor 23 + 18 ms) |

Releer al escribir reusa lo de la lectura anterior: el texto normalizado de las unidades que no cambiaron y lo
reconocido por texto. En un teléfono (3 a 9 veces más lento, C8) la página de un día queda en 15–45 ms cada medio
segundo sin escribir; la más grande, 90–270 ms.

## 8. Pruebas

- `src/relations/reader.test.ts`: la tabla de la sección 6 de la propuesta, las formas de su sección 4, los 25 casos
  para romperlo de la auditoría técnica (con una trampa: existen todas las escenas que esos números podrían nombrar),
  episodios 201/301/110-210, proyectos sin episodios y locaciones.
- `src/relations/pageRelations.test.ts`: con el editor real, lo de cada bloque (títulos, links partidos, fotos) sin
  cambiar las unidades de la búsqueda; secciones, menciones, episodio, pies y nombres de archivo.
- `src/relations/register.test.ts`: carpetas con episodios, «parte de», marcas, `false`, `graph: false`, papelera,
  duplicados y un largo.
- `src/relations/relationIndex.test.ts`: caché (recuperar sin abrir documentos, `docDirty:`, borrar lo que salió del
  árbol, otro formato), `retain`, progreso, el índice con el árbol real (secciones con fotos, links, locaciones,
  pendientes, papelera, escena nueva sin releer, página índice) y la relectura a 500 ms del documento vivo.

- `src/ui/relationsUi.test.tsx`: la app montada; el índice arranca al abrir el proyecto (sin ⌘K), el renglón de
  progreso con su `data-tip` aparece y se va solo, y la foto de relaciones queda completa.
- `src/relations/kind.test.ts` y `kindCarry.test.ts`: proyectos sin episodios (D383) y `graph: false` al exportar e
  importar (D387).
- `src/relations/fields.test.ts` (E3b): una ficha con la estructura exacta del HTML de BD Main pasada por la
  importación de Coda de la app y escrita con el editor real (tabla con celda vacía, link al decorado, celda con un
  `div` adentro, títulos *Descripción* y *Consultas*); las unidades de la búsqueda iguales con y sin `cells`; renglones
  «Rótulo:»; lo que no es un campo («open question» en el medio, sin dos puntos, un título más largo, una tabla de tres
  columnas, una oración en la primera celda); coordenadas y sus trampas; fechas y valores vacíos. Las de la vista, en
  `liveView.test.ts` (también la caché: los campos vuelven sin abrir documentos y el formato 1 se relee) y las del
  render, en `liveHeader.test.tsx`.

**Arnés para mirarlo a mano** (solo desarrollo, no se publica): `src/dev/relaciones-motor.html` con vite
(`/src/dev/relaciones-motor.html?slow=25&theme=dark`). Arma un proyecto inventado de unas 900 páginas (desglose por
episodio con fichas, locaciones con scoutings, días por bloques con secciones, fotos, links y planning, notas y un
archivo con `graph: false`) en el servidor en memoria de las pruebas, muestra el progreso y deja
`__shotdocsRelations` en la consola: `stats()`, `registry()`, `scene('101_004')`, `location('Puerto Norte')`,
`page(id)`, `role(id)`, `pending()`, `indexPages()`, `scan('Escena 1004C', true)`. `?slow=<ms>` demora cada
página que lee el índice.

## 9. Límites

- La primera lectura en un teléfono son decenas de segundos (C8: 15–45 s para ERSO), en segundo plano. Mientras tanto
  la foto dice `complete: false`.
- Las locaciones por nombre son una señal débil (~87 % coherentes fuera de las páginas índice, C8): nunca dicen
  «filmada en»; eso lo decide E3 con el título del día.
- Lo que escriben otros en la página abierta se reconoce con la sincronización, no a los 500 ms.

## 10. La cabecera viva de escena y locación (E3, v0.238)

Una página que es escena o locación (lo que dice el registro, sección 4) muestra entre el título y el documento una
cabecera armada con el índice: **interfaz**, fuera del ProseMirror (`PageView.tsx`, entre `<TitleInput>` y
`<PageBarrier>`). No se guarda en la página, no sube, no sale en el PDF (`@media print`), y con un link público no
aparece (el visitante no tiene tipos de página, D381). La del día es de E5.

| Pieza | Archivo |
|---|---|
| Qué se muestra (puro, sobre la foto del índice) | `src/relations/liveView.ts` (`sceneLive`, `locationLive`, `dayRef`) |
| La cabecera | `src/relations/LiveHeader.tsx` + `liveHeader.css` (prefijo `lh-`, un tono por tipo de entidad, claro y oscuro) |
| Plegado por tipo | `src/relations/liveFold.ts` (`shotdocs.liveHeader.open` en `localStorage`) |
| Ir al lugar exacto | `src/relations/goToPlace.ts` (pedido `ResultRequest.place`), `src/relations/placeFlash.ts` (decoración pasajera), `PageEditor.tsx` (toma el pedido; `openSection` en `CollapseControl`) |
| Textos | `src/i18n/relations.ts`; ayuda `liveHeader` (`src/help/entries.ts`, since 0.238) |
| Arnés | `src/dev/cabecera-viva.html` + `cabeceraViva.tsx`, con `src/relations/fixtures/proyectoSintetico.ts` (nombres inventados) |

**Escena.** Renglón de arriba: el tipo, el episodio y las otras formas en que el proyecto la escribe (`5027b`,
`105_027b`, `5-27`…), sacadas de las menciones; nunca el número ni la ruta (C7 O3). Dos columnas:
- *Preproduction*: *Planned at* = locaciones que nombra su propio desglose (la escena y sus fichas: «named in its
  breakdown»); *Breakdown* = sus fichas (lo de adentro); *Scouting* = las páginas de scouting que la nombran, o si
  ninguna, los scoutings de las locaciones donde tiene sección («of CENADE»).
- *Shoot*: un renglón por día cuyo reporte tiene una **sección** con la escena en el título (en orden de fecha), con
  la locación **del título del día** (rotulada «Location per the day title»), cada sección (`§ Escena 105_027b`, va
  ahí) y 3 fotos. Un título con dos locaciones («CENADE + La Arenera») cuenta para las dos. Un día que solo la nombra en el texto: «named in the text». Lo de adentro de un día que no es su
  reporte (el plan del día) la nombra como **planeada** («planned in «Plan | Día 60»», D400), nunca como filmada; la
  locación tampoco cuenta ese día. Sin sección: **«No report section»**,
  nunca «not shot» (C7 B4), y **«No VFX · not expected in VFX reports»** si la escena o **todas** sus fichas con texto
  tienen un campo o una celda que dice entero «No VFX» o «VFX…: No VFX» (una frase que lo dice de pasada no cuenta); si
  son algunas, «No VFX in 1 of 4 cards» (D395). Quien no ve el proyecto entero lee «No report section you can see»
  (D401). Un plan de un día en que la escena ya tiene sección no repite ese día como «planned».

**Campos de las fichas (E3b, v0.240; sección 3, «Campos»).** En la escena, el renglón de arriba empieza con INT/EXT
de su desglose (los valores distintos, «INT-EXT/NOCHE»); *Breakdown* suma los **decorados** (campo *Locacion Guion* /
*Sets* de la escena y sus fichas: chip sin relleno que lleva a la página del decorado si la persona la ve, o el texto
del link si no); **Open question** muestra la primera pregunta abierta del desglose, su primer renglón, con «· in 2
cards» si varias fichas la comparten o «· PRUEBA_105_027_010» (su *Shot Name*), y «· +1» si hay más; tocarla abre la
ficha con la pregunta resaltada. La etapa *Breakdown* suma «· 2 questions», y cada ficha se titula con su *Shot Name*,
muestra su *Descripción* y su «Open question: …». En la locación, **Sets** (el campo de la locación y las páginas
sueltas cuyo campo *Locacion Real* la nombra por su nombre o por un alias del registro que no comparte otra locación,
`locationOf`; ya no van a «Also named in») y **Where** (las primeras coordenadas
de la locación o de sus scoutings; lleva ahí). Las filas aparecen solo con valores: nunca dicen «ninguno», tampoco
mientras el índice lee (D402).

**Locación.** *Planned here* = escenas cuyo desglose la nombra; *Scouting* = las páginas de adentro, con sus fotos;
*Shoot* = los días que la nombran en el título, con las escenas que tienen sección ese día y las secciones de arriba
sin número que tienen fotos («§ Plates ambulancia»); «No report section yet: …» para las planeadas sin sección.

**Para las dos.** «Also named in» junta las demás páginas que la nombran; las **páginas índice** (más de 20 escenas y
locaciones, sección 3) van plegadas en un solo botón y no aportan extractos ni fotos. Las ramas con `graph: false` ya
no están en la foto. Tres **etapas** cerradas (*Breakdown*, *Scouting*, *Shoot*) con su resumen; abrir una muestra
extractos (título de la sección, unos renglones, 3 fotos) que llevan al lugar exacto. Una **tira de 6 fotos**
(desglose → scouting → días, sin repetir) con su origen; cada una lleva a su sección. Pie: de cuántas páginas sale.

**En vivo.** Se redibuja con cada foto del índice (`subscribe`/`getRevision`): al escribir acá o en otra página
(relectura a 500 ms), al sincronizar o cambiar el árbol. React reutiliza lo dibujado (sin parpadeo); las miniaturas se
piden una vez por sesión con la misma dirección que usa la página (`media.resolve`). Mientras el índice no está
completo, el renglón dice «Reading…» en vez de «Live», y todo lo que afirmaría una ausencia («None», «No report
section», «No cards») dice «Reading…».

**Ir al lugar exacto.** Un extracto, una sección o una foto piden a la búsqueda (`searchSession().requestResult`) ir a
la página con `place: { endBlockId }` y navegan. El editor de esa página, al estar listo, abre lo colapsado que la
esconde y el título mismo si está colapsado (para vos, como «Ir al bloque» de los comentarios; `openSection`), lleva
la vista ahí y resalta la sección entera 2,4 s con una decoración de ProseMirror (`placeFlash.ts`): una clase puesta
a mano en el DOM se pierde porque ProseMirror vuelve a dibujar el bloque. «Ir al bloque» de los comentarios tenía ese problema (la clase
`comment-flash` duraba menos de 250 ms y no se veía): ahora usa la misma decoración con su estilo, por
`src/ui/flashControl.ts`, que el editor llena al cargarse (la primera carga no trae ProseMirror).

**Plegado.** A un renglón (~44 px) que resume (*Shot at CENADE, La Arenera · 3 days · 2 cards · 18 photos*). Se
recuerda por tipo en el dispositivo; mientras la persona no eligió, en el teléfono arranca plegada y en la
computadora abierta. Mientras el índice lee, el renglón muestra solo lo que ya encontró y el punto «Reading…» (D402).
Al plegar o desplegar, el foco pasa al control nuevo (el renglón o *Collapse*, los dos con `aria-expanded`); el
renglón no lleva `aria-label`, así un lector de pantalla lee su resumen.

**Permisos.** Todo sale de la foto del índice, que solo tiene lo que la persona ve: un invitado que ve solo la
escena ve sus fichas y nada de días, scoutings ni títulos de otras páginas (prueba).

### Decisiones de esta entrega

- **D393 · «Planned at» sale de las locaciones que nombra el desglose de la escena** (la escena y sus fichas), no de
  un campo «Locación real» (el motor no lee campos). Se rotula «named in its breakdown». Se revierte en
  `sceneLive` (`planned`).
- **D394 · En el teléfono la cabecera de escena y de locación arranca plegada** (B2 de C7 lo pedía para el día; el
  encargo, para todas). Lo elegido se recuerda por tipo y vale también en la computadora del mismo dispositivo. Se
  revierte en `liveFold.ts` (`liveOpen`: `?? !phone`).
- **D395 · «No VFX» solo con un campo entero** (la unidad es «No VFX» o «VFX…: No VFX»), y para la escena entera solo
  si lo dice la escena o todas sus fichas con texto; si son algunas, «No VFX in N of M cards». Se revierte en
  `liveView.ts` (`NO_VFX`, `noVfxCards`).
- **D396 · La tira de fotos muestra la cantidad, sin «All N · by source»**: la vista por fuente y el carrete de
  varias páginas son de E8. Tocar una foto va a su sección. Se revierte en `PhotoStrip`.
- **D397 · Las páginas índice no aportan extractos, días ni fotos**, solo el botón plegado «N index pages». Se
  revierte en `sceneLive`/`locationLive` (`indexPage`).
- **D398 · La locación de un día de rodaje es la que nombra su título**, para la escena y para la locación
  («per the day title», C8 §7.2). Una fila *Location* bajo la sección queda para cuando exista. Se revierte en
  `dayRef`.
- **D399 · Ir al lugar exacto deja abierta, para vos, la sección colapsada** (como «Ir al bloque»), en vez de
  abrirla solo mientras dura el resaltado como hace buscar: se va ahí a leerla. Se revierte en `openSection`
  (`PageEditor.tsx`).

- **D401** Quien no ve el proyecto entero lee las ausencias como «you can see» (`partial` en `LiveHeader.tsx`).
- **D402** Mientras el índice lee, el renglón plegado muestra solo lo encontrado y «Reading…» (`Line`).
- **D400** Lo de adentro de un día que no es su reporte dice «planeada», nunca filmada. Se revierte en `sceneLive`
  (`planMap`) y `sceneDays`.

Campos de las fichas (E3b): **D419** tres formas (tabla de dos columnas con cualquier rótulo; título o renglón solo con
rótulos conocidos); **D420** el valor de un título llega hasta el próximo título o un renglón que es otro campo;
**D421** filas y columnas de las tablas en `BlockMeta`, `CACHE_FORMAT` 2; **D422** la pregunta abierta: la primera,
agrupada por su primer renglón, y lleva a la ficha; **D423** decorados de la escena por el link del campo, con el texto
del link si la página no se ve; **D424** decorados de la locación: páginas sueltas cuyo *Locacion Real* la nombra, fuera
de «Also named in»; **D425** INT/EXT: todos los valores distintos (hasta 3); **D426** *Where*: solo las coordenadas, y
lleva a donde están escritas; **D427** el extracto de una ficha: *Shot Name* y *Descripción*; **D428** las filas solo
con valores, también mientras lee. Detalle en `Doc_Decisiones.md`.

**Ganchos de desarrollo** (solo con `import.meta.env.DEV`, en el mismo efecto que `__shotdocsRelations`;
`src/ui/devHooks.test.ts` cuida que no se pongan en otro lado y el build publicado no los trae):
`window.__shotdocsDev = { tree, docs, projectId }` y `__shotdocsRelations.dump(name)` → `{ name, projectId, complete,
registry: { scenes: {código: pageId}, locations: {nombre: {pageId, aliases}} }, duplicates, pending, pages: [{ id,
parent, title, settings, role, rel, units: [{b, f, t}] }] }`, las páginas en el orden del árbol (para el guion de ERSO
a vivo, E4).

### Lo que falta (anotado)

- *Planned at* sigue saliendo de las locaciones que nombra el desglose (D393), no del campo *Locacion Real*; la
  maqueta pone abajo «breakdown: «Estudio | Autos»», el valor crudo del campo. Ahora se podría con `fieldValues`.
- Fotos por fuente y carrete de varias páginas: hecho en E8 (sección 13). La cabecera del día: sección 11 (E5).
- `kind.ts` de E2: cuando E1 lo use, la cabecera lo toma solo (lee `registration.roles`).

## 11. El día de rodaje, *Tomorrow* y *Prepare tomorrow's report* (E5, v0.241)

Un reporte del día (lo que el registro dice que es un día, sección 4) muestra la misma cabecera viva, con lo del día
(maqueta `c_dia.html`), y en el día anterior la tarjeta *Tomorrow* prepara el reporte de mañana (§5 de la propuesta,
`d_escribir.html`). Todo es interfaz salvo *Prepare*, que es lo único de las relaciones que escribe en un documento.

| Pieza | Archivo |
|---|---|
| Qué se muestra (puro, sobre la foto del índice): filas, plan, preguntas, Tomorrow, el título que usa el proyecto | `src/relations/dayLive.ts` (`dayLive`, `planOf`, `openQuestions`, `dayList`, `headingStyleFor`, `linkTargetOf`) |
| La cabecera del día y la tarjeta | `src/relations/DayHeader.tsx` (usa las piezas de `LiveHeader.tsx`), `liveHeader.css` (`lh-facts`, `lh-mrow`, `lh-tomorrow`, `lh-picker`) |
| Lo ajustado a mano en la lista de mañana (por dispositivo) | `src/relations/tomorrowPlan.ts` (`shotdocs.tomorrow` en `localStorage`) |
| Escribir: preparar, deshacer, juntar repetidos | `src/relations/prepareDay.ts` (se baja aparte, con el editor) |
| En el editor del reporte: el título de la escena y la pregunta abierta | `src/relations/dayDecorations.ts` (decoraciones; `PageEditor.tsx` las registra) |
| Textos y ayuda | `src/i18n/relations.ts` (`day.*`); ayuda `liveDay` (since 0.241) |

**La cabecera.** Renglón de arriba: *Shoot day*, la fecha larga, la locación del título («per the day title», D398) y el
día anterior y el siguiente (rótulo corto: «Día 58», o la fecha si el título no tiene número de día, con el título
entero en el tooltip; en el teléfono las herramientas bajan de renglón y *Live*/*Collapse* quedan a la vista). *Scenes of the day*: una fila por sección de escena del reporte (la más externa de cada
escena, con su parte), con el título de la escena en vivo, sus fotos y un estado: **shot** (algo escrito o fotos
debajo), **prepared** (la sección está y sigue vacía), **shot · not in plan** (hay plan y no la nombra); las secciones
de arriba sin número con fotos («Plates ambulancia», con aviso, llevan a la sección) salvo la **sección general** («Info general», o la primera de
arriba sin número), cuyas fotos son del día y van primero (lo mismo en el *Shoot* de la locación); las escenas del plan
sin sección,
**planned · no section** (D400). *Open questions* (hasta 3, de las fichas de sus escenas, con la ficha y la categoría),
*Named in the text* y *Plan* (de dónde sale). Tira de fotos por sección. Plegado por tipo `day`: en el teléfono arranca
en un renglón («CENADE · 2 scenes · 7 photos · 2 open questions»); mientras lee, sin ceros (D402).

**El plan de un día** (`planOf`): lo de adentro del día que no es el reporte (la página *Plan*, D400), en el orden en
que nombra las escenas → si no, las fichas con *Fecha Rodaje* igual a la fecha del título (`cardFields`, sin las copias
de fichas pegadas en los planes, más la página de la escena si tiene la fecha), por número → si no, nada.

***Tomorrow*.** El día siguiente (por fecha entre los días que la persona ve) con su plan. La lista se ajusta: sacar (×)
o *Add scene* (selector por número, `5027`, `105-027`, o por título); lo ajustado se guarda en el dispositivo como
diferencia con el plan, así si el plan cambia se sigue aplicando. Sin permiso de editar mañana, la tarjeta lo dice y
no tiene el botón. Si el reporte de mañana tiene títulos repetidos vacíos (dos dispositivos), lo avisa.

***Prepare tomorrow's report*** (`prepareReport`):

1. Si el reporte de mañana no está entero en el dispositivo, intenta bajarlo 8 s; si no, no hace nada y lo avisa. Si
   tiene contenido que esta versión no conoce, tampoco (`findUnknownContent`).
2. Lee el documento en el momento (no la foto del índice) con el mismo lector: una escena ya tiene sección si un título
   la nombra de cualquier forma («Escena 105_029a», «5-29», un link).
3. Agrega al final (antes del renglón vacío de cierre, si hay), por cada escena que no tiene: un título con la palabra
   y el nivel que usa el proyecto (`headingStyleFor`: mañana, hoy y los días de antes; si ninguno, «Escena»/«Scene» y
   el nivel de los títulos de mañana) y el número como link a la escena (`/p/<id>`, marca `link`), y un renglón vacío.
   No copia el título de la escena. Usa un editor sin pantalla sobre el documento: primero en el dispositivo, después
   sube.
4. Lleva al reporte de mañana con lo agregado resaltado y avisa «Día 60 · added 2 sections · 105_029 already had
   one» (y las escenas sin una página que la persona ve), con *Undo*. Ir a un lugar (también los extractos de E3) sigue
   el lugar unos segundos mientras la página termina de cargar las fotos de arriba, hasta que la persona toca o
   desplaza (`keepInView` en `placeFlash.ts`): en un día largo con fotos, el lugar quedaba miles de píxeles abajo.

*Undo* saca cada título agregado con su renglón si siguen iguales y vacíos; uno con algo escrito debajo (o bloques
nuevos, o el título cambiado) queda, y el aviso lo dice. Si lo agregado ya salió del dispositivo (el `syncedSV` de la
página tiene algo de este autor posterior a lo de antes de preparar, o hay una subida en camino), saca **solo los
títulos** y el aviso dice que quedan los renglones: otro dispositivo pudo recibirlo y estar escribiendo en ese renglón
sin que llegue todavía (D437). *Undo* y la limpieza de repetidos **borran directo en el Y.Doc**: exactamente el
contenedor de cada bloque, por su id, verificado en el momento (mismo id, mismo texto, vacío), en una transacción; si
la estructura no es la esperada (un título movido adentro de otro bloque), no borran nada y avisan. Con el editor
(`removeBlocks`), y-prosemirror reutilizaba contenedores y borraba el del renglón donde otro escribía, cuando la sección
no era la última (R1 y R2 de la re-verificación de la auditoría). Agregar sí va por el editor: solo inserta. Preparar de nuevo solo agrega lo que falta y nunca toca lo
escrito.

**Dos dispositivos a la vez, sin red (D436).** Probado con dos Y.Doc (`prepareDay.test.ts`): Yjs no funde dos títulos
insertados por separado, así que al juntarse queda cada escena dos veces, en el mismo orden en los dos. Solo cuenta ese
par (dos títulos con la forma de *Prepare*): una sección escrita a mano («Escena 105_029a») nunca hace sacar nada. Nada se pierde:
lo escrito debajo de cualquiera de las copias queda. La cabecera cuenta una sola fila. *Prepare* de nuevo (en
cualquiera de los dos) lo resuelve: de una escena con otra sección, saca los títulos preparados y vacíos; si todas son
preparadas y vacías, deja la primera. Saca **solo el título** (el renglón vacío queda en blanco): si alguien escribe
sin red en esa copia mientras otro la saca, su texto no se pierde con el bloque (medido); con varias escenas puede quedar
debajo de la última sección de la tanda y no de la suya. Nunca se limpia solo: solo al tocar *Prepare*.

**En el editor del reporte** (`dayDecorations.ts`). Al lado del link de un título que lleva a una escena, su título en
vivo (« · La camioneta frena en la banquina»); debajo, la primera pregunta abierta de su desglose con la ficha y la
categoría (tocarla abre la ficha). Vale para cualquier título de un reporte cuyo link lleva a una escena (no hay marca
en el documento de «preparado»). Son decoraciones de ProseMirror: no están en el Y.Doc, no se copian, no se imprimen
(`@media print`); se vuelven a leer con cada foto del índice. Un invitado que no ve las fichas no ve la pregunta.

**Una versión vieja.** Lo escrito son títulos, párrafos y la marca `link`, de siempre: una versión vieja lo abre igual
(prueba con el esquema anterior en `prepareDay.test.ts`). No sube `min_app_version`.

**Pruebas.** `dayLive.test.ts` (filas, plan por página *Plan* y por desglose, copias de fichas en otro día, «prepared»,
repetidos, título del proyecto, *Prepare* sobre el reporte de verdad con su *Undo*, reporte sin bajar);
`prepareDay.test.ts` (solo agrega, no duplica, no pisa, otras formas del número, *Undo* con y sin texto, esquema
anterior, dos dispositivos: repetidos, los dos escribieron, los dos limpian a la vez, el que escribe mientras otro
limpia); `prepareCollab.test.ts` (dos Y.Doc: título a mano, *Undo* y limpieza con una, dos y tres secciones, estructura inesperada); `prepareSync.test.ts` (dos y tres dispositivos con el servidor de prueba); `dayHeader.test.tsx` (la app montada: cabecera, quitar de la lista, *Prepare* que escribe solo en mañana y no
en hoy, aviso y *Undo*, decoraciones en el editor, teléfono plegado sin ceros, invitado sin el botón). Arnés:
`src/dev/cabecera-viva.html?page=d59&days=1` (el proyecto sintético con fechas en las fichas y el Día 60 sin plan).

**Decisiones:** D429–D445 en `Doc_Decisiones.md`.

### Lo que falta (E5)

- Sin día siguiente no hay tarjeta: crear el reporte de mañana desde ahí (con *New day report*) y prepararlo.
- *Assign* en una sección sin número (E7) y la barra *Today* sobre el teclado en el teléfono (E6).
- El link del título preparado se ve como un link, no como la ficha-chip de la maqueta (la ficha es de E6/E7).
- *Undo* vive en el aviso (15 s); después, se borra a mano.

## 12. El mapa del proyecto, la lupa por escenas y locaciones, y el mapa para un asistente (E9, v0.242)

El pedido de Lega incluye «un mapa que ayude a encontrar las cosas al asistente de IA y al usuario» y «buscar una
escena» como primer gesto (C7, O1). Todo sale de la foto del índice (lo que la persona ve), en el dispositivo; nada se
guarda ni se escribe en un documento.

| Pieza | Archivo |
|---|---|
| El mapa, en una pasada (puro): días, escenas, locaciones, pendientes, duplicadas, secciones sin número | `src/relations/projectMap.ts` (`projectMap`, `mapCounts`) |
| Lo que se copia: JSON y texto | `src/relations/projectMap.ts` (`mapJson`, `mapText`, `MAP_FORMAT`, `MAP_VERSION`) |
| Buscar escenas y locaciones por cualquier forma (puro; también para E7: `/`, *Tomorrow*, *Assign*) | `src/relations/sceneSearch.ts` (`searchScenes`, `searchLocations`, `findEntities`) |
| La vista | `src/relations/MapView.tsx` + `map.css` (prefijo `mp-`), ruta `/map/<pestaña>` (`src/router.ts`, `mapPath`), se baja aparte |
| La fila *Map* de la barra lateral | `src/relations/MapNav.tsx` + `mapNav.css` (en `Sidebar.tsx`, arriba de *Pages*) |
| La lupa | `src/ui/ProjectSearch.tsx` (grupo *Scenes and locations*) |
| Textos y ayuda | `src/i18n/lazy/map.ts`, `sidebar.map*`, `search.ent*`; ayuda `relationsMap` y `searchEntities` (since 0.242) |

**La fila *Map*.** Arriba del árbol, como en la maqueta, solo en un proyecto con escenas, locaciones o días de rodaje
(lo que dice el registro de lo que la persona ve); suma «N pending» si hay alguno, nunca un cero, con el mismo número que
la pestaña *Pending* (`pendingSummary`: números que no existen + duplicadas + secciones sin número). Con un link público
no hay mapa (`/map` lleva a la página compartida).

**Las pestañas** (mismas reglas que la cabecera viva: «filmada» = una sección de un reporte; la locación de un día, la
de su título, D398; «planeada en» = lo que nombra su desglose, D393):

- *Locations*, en el tiempo: una fila por locación con días, ordenadas por su primer día; «6 scenes · 2 days» (escenas
  que planea su desglose más las que tienen sección en uno de sus días; los días cuyo título la nombra); un punto por día
  en una línea de meses (lleno: el reporte tiene un renglón escrito que no es un título, o fotos; hueco: nada escrito),
  con el título del día en su tooltip y que lleva al día. Los días cuyos puntos se tocarían con el ancho que tiene la
  línea (13 px; `groupDots`, `dotGap`) van juntos, uno al lado del otro desde la fecha del primero: cada uno se puede
  abrir (encimados, el de arriba tapaba al otro). Las locaciones sin días van al pie. Ícono de scouting si tiene
  páginas adentro.
- *Scenes*, por episodio: número (lleva a la escena), título en vivo, locaciones «· report» / «· planned» y los días
  con sección (cada uno lleva al día); sin sección, «in a plan» si un plan la nombra o «No report section» («you can
  see» para un invitado, D401). Nunca «not shot».
- *Shoot days*, por fecha: día, locación del título (si el título no nombra una que exista, lo que dice, apagado:
  «Frente Ruso Villarino»; `titlePlace`), «1 with a section · 2 planned», «nothing written».
- *Pending*: los números que no existen con dónde se nombran (lleva al bloque), las escenas en dos páginas
  (`registration.duplicates`) y las secciones de un reporte con fotos y sin número (sin la general, D429; *Open section*
  lleva a la sección exacta). Cada fila es un `PendingRow` con una ranura `actions`: ahí van *Create* y *Assign* con sus
  guardas (E7); en E9 queda vacía. **Quien ve una parte del proyecto** (un invitado) no puede saber si una escena existe
  en una página que no ve: el número que no está en su registro dice «105_029 isn’t in the pages you can see» (y «may
  exist in a page you can’t see»), nunca «doesn’t exist»; lo mismo la cabecera del día y la lupa (D401).

El filtro de *Scenes* y *Shoot days* lee el número con `searchScenes` (exacto, como la lupa): `5027`, `105-027`,
`105_027b`, «Escena 27»; si lo escrito no nombra escenas, filtra por el texto (título, locación, fecha de un día con
sección). El de *Locations*, por nombre, alias y fecha de sus días. Mientras el índice lee, la línea
de arriba dice «Reading 340 of 921…», los números aparecen solo si no son cero y lo vacío dice «Reading…» (D402).

**La lupa ⌘K.** Arriba de los proyectos y las páginas, el grupo *Scenes and locations* con `findEntities`: lo escrito
leído como un título por el mismo lector (`101_074`, `101-074`, `1074`, `5027b`, `H1067`, `1033B+C`); «Escena 27» o
«27», en el episodio de la página abierta y si no en todos (el de la página primero); una escena que existe solo con
letra la encuentra el número sin letra; las locaciones por nombre o alias, o por el principio del nombre o de una de sus palabras, desde 3 letras (`cenad`, `are`;
con «la» o «de» subía media lista); un número que no
existe, solo si alguna página lo nombra (lleva a *Map › Pending*). Enter abre la primera; con una entidad no se ofrece
«New project». La búsqueda de texto, las anotaciones y reemplazar no cambian. `searchScenes` suma, para el `/` de E7,
los códigos que contienen los dígitos y el título (con `loose`), con `near` (las escenas del día) primero.

### El JSON del mapa: `shotdocs.map`, versión 1

*Copy JSON* copia un objeto compacto con esta forma fija (las claves en este orden; una versión nueva solo si cambia el
significado o se saca algo; sumar una clave opcional no cambia la versión). Las páginas se nombran por su id y van una
sola vez en `pages`; el link de cada una es `pageUrl` con `{id}` reemplazado. Solo lo que la persona ve; `scope` dice si
es todo el proyecto o una parte (un invitado), y `complete: false` si el dispositivo todavía estaba leyendo.

```text
{
  format: "shotdocs.map", version: 1,
  project: { id, name }, pageUrl: "https://…/p/{id}", builtAt: ISO, complete: bool, scope: "project" | "visible",
  counts: { scenes, locations, days, pending, duplicates, unnumbered },   // cada uno, el largo de su lista
  scenes: [{ code: "105_027", page: id | null, title, episode: "105" | null,
             plannedAt: [locación…],                       // las que nombra su desglose (D393)
             shot: [{ day: id, date, locations: [locación…], sections: [Section…] }],   // reportes con sección suya
             plannedDays: [id…], cards: [id…], mentions: [Mention…] }],
  locations: [{ name, page, aliases: [..], days: [id…], planned: [código…], shot: [código…], scouts: [id…],
                mentions: [Mention…] }],
  days: [{ page, label: "Día 59", date, locations: [..], written: bool,
           plan: { source: "plan" | "breakdown" | "none", scenes: [código…] },
           sections: [Section & { scenes: [código…], pending?: [código…] }], unnumbered?: [Section…] }],
  pending: [{ code, mentions: [{ page, blocks: [blockId…] }] }],   // con scope "visible": no está en lo que se ve
  duplicates: [{ code, pages: [id…] }],
  pages: { [id]: { title, kind: "scene" | "location" | "day" | "part" | "page", stage: "breakdown" | "scouting" | "shoot" | "location" | "other" } }
}
Section = { block: blockId, end: blockId | null, title, photos: n }     // del título hasta `end` (null: el final)
Mention = { page, stage, own?: true, index?: true, via: ["heading" | "text" | "link"], blocks: [blockId…], sections?: [Section…] }
```

`own`: la página es la entidad o parte de ella (una ficha, un scouting); `index`: una página índice (más de 20 escenas y
locaciones). `unnumbered` está en cada día (`days[].unnumbered`) y su total en `counts`. Con `scope: "visible"`, un código
en `pending` es uno nombrado que no está en las páginas que la persona ve (puede existir en otra). *Copy map* copia lo
mismo como texto legible, sin ids, para pegar en un chat (con «To resolve: …» separado por clase). Medido en ERSO (921
páginas): texto 48 KB, JSON 538 KB. Abrir el mapa con el índice ya leído: menos de medio segundo en la PC de escritorio.

### Decisiones de esta entrega

D486–D501 en `Doc_Decisiones.md`: la fila *Map* y la ruta (D486), una pasada con las reglas de la cabecera (D487), lo que
cuenta *Locations* (D488), *Scenes* (D489), *Pending* con duplicadas y la ranura de E7 (D490), sin ceros mientras lee
(D491), texto y JSON sin descarga (D492), la lupa (D493), `sceneSearch.ts` para E7 (D494), sin mapa con link público
(D495), sin atajo nuevo (D496), un número suelto de 4 cifras en la lupa (D497); y de la auditoría: el invitado nunca lee
«no existe» (D498), días cercanos juntos en la línea (D499), los números de *Pending* separados (D500), locaciones en la
lupa desde 3 letras (D501).

### Comparado con la verdad (ERSO, `mapa.json`)

Escenas 226/226, locaciones 52/52, días 73/73. Escena × día con sección: las 131 de la verdad están; la app suma 9 que
son subtítulos que nombran otra escena dentro de una sección («5056 plano 1» en el Día 34; C8 ya los había revisado:
son reales). Las 8 secciones sin número son las mismas. Día → locación: 60 de 73 iguales; en 13 el título usa un nombre
que el registro no tiene («Estudio Autos», «Arenera VA», «Centro CABA», «Mansión Rosenberg»; D417): *La Arenera
(estudio)* muestra 2 días de 8. *Planned here* difiere en 6 de 52 locaciones porque sale de lo que nombra el desglose y
no del campo *Locacion Real* (D393; ver «Lo que falta» de la sección 10).

### Lo que falta (E9)

- *Create* y *Assign* en *Pending* (E7, en la ranura `actions`).
- Los alias de lugar de los títulos de los días que el registro no reconoce (13 días de ERSO, arriba).
- Que el asistente de la app reciba el mapa sin copiar y pegar, y que el MCP (fase 5) lo sirva.

## 13. Fotos por fuente y el carrete de varias páginas (E8, v0.243)

La tira de 6 fotos al pie de la cabecera de escena, locación y día dice la fuente de cada una y trae **«All N · by
source»** (revierte D396): abre la galería con *All* y un botón por fuente con su cantidad, en una grilla de 12 (11 y
«+N»). Elegir una fuente muestra solo sus fotos y *Go to the section* (o *Go to the photos*, si la fuente es una página
entera) lleva a su lugar exacto, resaltado como los extractos. **Tocar una foto** (en la tira o en la galería) abre el
**carrete con todas las fotos de la galería**, de varias páginas, en el orden de la galería, empezando por esa: cada una
dice «From Tech scout 06/01» y *Go to place* cierra el carrete y va a **esa foto** en su página (`Doc_Carrete.md`,
«Varias páginas»).

**Ir a una foto (ronda de corrección, B1).** Las fotos de los reportes de Coda van varias en un mismo párrafo (en
línea): ir al bloque mostraba otra foto. `goToPlace(services, place, mediaId)` anota la foto pedida en
`src/relations/photoTarget.ts` (sin dependencias: va en la primera carga) y `showPlace` (`placeFlash.ts`, con el editor)
la toma: lleva la vista a esa `.sd-photo`, centrada (también si crece al cargar), y resalta solo esa foto
(`rel-flash-photo`); una foto que es un bloque propio, el bloque, como antes. Lo mismo hace *Go to the photos* de una
fuente de página entera (su primera foto). El pedido de la búsqueda (`ResultRequest`) y el editor no cambiaron.

| Pieza | Archivo |
|---|---|
| Qué fuentes y en qué orden (puro, sobre lo que armó la cabecera) | `src/relations/photoGallery.ts` (`sceneGallery`, `locationGallery`, `dayGallery`, `groupLabel`, `scoutKindOf`, `scoutDateOf`) |
| La tira y la galería | `src/relations/PhotoSources.tsx` (en `LiveHeader.tsx` y `DayHeader.tsx`) + `liveHeader.css` (`lh-seg`, `lh-grid`) |
| El carrete de varias páginas (se baja aparte) | `src/relations/GalleryCarrete.tsx`; `itemsOfEntries`/`carreteItemsOfEntries` en `src/ui/carreteModel.ts` |
| Textos y ayuda | `gallery.*` en `src/i18n/relations.ts`, `carrete.from`/`carrete.goToPlace` en `src/i18n/lazy/carrete.ts`; ayuda `livePhotos` (since 0.243) |

**Las fuentes, en el orden de la maqueta.** Escena: el desglose (la página de la escena y cada ficha con fotos; con más
de una, «Breakdown · ERSO_105_027_010») → cada sección de scouting que la nombra, **técnico y creativo por separado**
(C7 O7: «Tech scout 06/01», «Creative scout 08/01»; el tipo sale del título, la fecha del campo *Date*/*Fecha* o del
principio del título: `260106`, `26.01.06`, `2026-01-06`, «06/01») → cada sección de cada reporte, en orden de fecha
(«Día 59 · Escena 105_027b»). Las fotos de una sección son las de esa sección (el índice las sabe por título; nada de
«Plates ambulancia» en la 105_027). Locación: la locación misma → sus decorados que son páginas → sus scoutings enteros →
sus días enteros («Día 59»). Día: lo general del día → cada sección («105_027b», «Plates ambulancia»). El arte de un
decorado dice «Art · Negocio de Telas». Dos fuentes del mismo tipo con exactamente las mismas fotos (la misma imagen en
dos fichas) son una sola. En la miniatura va el rótulo corto (el día, el tipo de scouting); la sección queda para el
selector, que en el teléfono es un renglón que se desliza de costado. Sobre ERSO:
105_027 da 49 fotos en 6 fuentes (1 + 3 + 15 + 14 + 3 + 13), CENADE 78 (7 + 52 + 19),
el Día 59 52 (15 + 37).

**Permisos y lo que falta.** Todo sale de la foto del índice, que solo tiene las páginas que la persona ve (filtrada
contra el árbol, sección 3); además, un grupo cuya página ya no se ve (`title` sin respuesta) no entra. Mientras el
índice no terminó, la galería dice «more may appear: N pages still being read» (o «… when every page is on this
device»). Sin red, el carrete muestra la miniatura o la versión grande guardada y su aviso de siempre; las carpetas no
entran (tienen su visor).

**Pruebas.** `photoGallery.test.ts` (orden, rótulos, técnico y creativo, fechas, cada foto en su bloque y cada grupo en
su sección, carpetas, varias fichas, locación, día, invitado que ve solo la escena); `liveHeader.test.tsx` (la app
montada: tira, galería, fuente con su lugar, carrete de varias páginas con *Go to place*); `src/ui/carreteMultiPage.test.tsx`.

**Decisiones:** D466–D477 en `Doc_Decisiones.md`.

### Lo que falta (E8)

- En Chromium con toque emulado, el primer toque después de deslizar en el carrete no hace clic (lo mismo en el carrete
  de una página: es de antes). Probable causa: la foto grande que tocó el dedo se saca al cambiar de foto y el gesto
  queda sin terminar. Mirarlo en un iPhone real.

- Las miniaturas de los renglones de día y de los extractos siguen yendo a su lugar (no abren el carrete, D471).
- Desde el carrete de varias páginas no se anota (D470): anotar va en la página.
- Las anotaciones de una foto de otra página salen de una copia de lo guardado: una anotación nueva hecha en otro
  dispositivo mientras el carrete está abierto se ve al volver a abrirlo.
