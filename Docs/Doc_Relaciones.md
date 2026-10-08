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
- El nombre y los alias de una locación salen de su título (el título, sin el paréntesis, el paréntesis, las partes
  separadas por ` / ` o ` | `).

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
