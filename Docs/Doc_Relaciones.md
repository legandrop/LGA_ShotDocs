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
- Fotos por fuente y carrete de varias páginas (E8); la cabecera del día (E5).
- `kind.ts` de E2: cuando E1 lo use, la cabecera lo toma solo (lee `registration.roles`).
