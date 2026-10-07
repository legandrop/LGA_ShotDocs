# Evaluación de `@blocknote/core/y` (y-prosemirror 2, Yjs 14)

Estado: **evaluado en v0.225 (2026-10-07). No se cambió código ni dependencias.** Es el punto B.10 del roadmap. La
decisión de migrar es de Lega (`Doc_Decisiones.md`, D330 y D331, pendientes); acá está lo medido y una recomendación.

Todos los datos de paquetes, versiones y fechas se consultaron el **2026-10-07** (npm con `npm view`, el código
publicado de cada paquete y el repositorio de BlockNote en la etiqueta `v0.55.0`). Lo que no se pudo confirmar en una
fuente primaria está dicho como **no confirmado**.

## En corto

- **Qué es.** `@blocknote/core/y` es una segunda entrada de BlockNote para colaboración, que usa `@y/y` (Yjs 14) y
  `@y/prosemirror` (y-prosemirror 2) en lugar de `yjs` 13 e `y-prosemirror` 1. Ya viene adentro de la versión que usa
  el repo (`@blocknote/core` 0.55.0), pero **depende de dos librerías que solo existen como versiones previas** y, tal
  cual se publica, **no trae deshacer**.
- **Qué cambia en lo guardado.** El formato binario de Yjs **no cambió en nada de lo medido** (los mismos bytes en los
  dos sentidos). Lo que cambia es **dónde vive el texto adentro de cada bloque**, y eso alcanza para que las dos
  formas no puedan convivir: el editor nuevo abre una página de hoy **vacía y le borra todo el texto**; el editor de
  hoy no puede abrir una página nueva.
- **Si resuelve lo que se esperaba: no.** Escribir en un renglón mientras otro le cambia el tipo, lo sangra o lo junta
  con el de arriba pierde lo escrito **igual que hoy** (300 de 300 agendas en los dos). Mover el renglón da **peor**
  que hoy (293 contra 173). Lo único que mejora es cuando los dos cambian la estructura a la vez (de 141 agendas con
  texto perdido a 1), a cambio de más bloques duplicados y con el mismo id.
- **El deshacer.** Yjs 14 tiene los mismos tres errores que el repo arregló con su parche (B.21, B.22 y B.26): los
  casos mínimos dan los mismos resultados malos. El parche habría que rehacerlo.
- **Costo.** Con una página de 1.000 bloques, cada letra escrita cuesta unas 17 veces más que hoy (57 ms contra 3 ms,
  en una PC). Y hay que reescribir todo lo que la app construyó sobre la forma de hoy: 81 archivos importan `yjs`.
- **Recomendación: esperar**, con condiciones concretas para volver a medir (sección 6). Hoy el riesgo para los datos
  es alto y el beneficio medido es casi nulo.

**En términos simples:** la pieza nueva todavía está en obra (ni sus propios autores la dan por estable), no arregla
el problema por el que se la quería mirar, y pasarse a ella obliga a convertir todas las páginas guardadas con una
operación que, mal hecha, borra texto. Conviene esperar a que salga terminada y volver a correr las mismas pruebas,
que quedaron armadas.

## 1. Qué es exactamente y en qué estado está

### 1.1 Desde cuándo existe y si está en la versión del repo

| Dato | Valor | Fuente |
|---|---|---|
| `@blocknote/core` en el repo | `^0.55.0`; instalado 0.55.0 | `package.json`; `node_modules/@blocknote/core/package.json` |
| Última versión publicada | 0.55.0, del 2026-09-22 (etiqueta `latest`) | `npm view @blocknote/core dist-tags time` |
| Entradas (`exports`) de la 0.55.0 | `.`, `./style.css`, `./fonts/inter.css`, `./comments`, `./blocks`, `./locales`, `./extensions`, `./yjs`, **`./y`** | `package.json` del paquete |
| Primera versión con `./y` | **0.52.0**, del 2026-07-20. La 0.51.4 (2026-06-02) no la tiene | `npm view @blocknote/core@<versión> exports` en 11 versiones |
| Qué hay en `./y` | `dist/y.js` (35.366 bytes), tipos en `types/src/y`, fuente en `src/y` | el paquete instalado |

`src/y/README.md` del paquete dice que es la integración para Yjs 14 sobre `@y/y` y `@y/prosemirror`, y que BlockNote
va a mantener las dos (`/yjs` para Yjs 13, `/y` para Yjs 14) por separado.

**En términos simples:** no hay que subir de versión de BlockNote para probarla: ya está instalada. Usarla es cambiar
de dónde se importa `withCollaboration` y sumar tres paquetes nuevos.

### 1.2 Qué versiones de Yjs y de y-prosemirror exige

- `peerDependencies` de `@blocknote/core` 0.55.0 (todas opcionales): `@y/y ^14.0.0-rc.23`, `@y/prosemirror ^2.0.0-6`,
  `@y/protocols ^1.0.6-rc.1`; y para la entrada de hoy `yjs ^13.6.27`, `y-prosemirror ^1.3.7`, `y-protocols ^1.0.6`.
  Además depende de `lib0` **fijo en `1.0.0-rc.22`** (sin rango).
- **Lo declarado no alcanza para que funcione.** `dist/y.js` importa 17 nombres de `@y/prosemirror`. Comparados con lo
  que exporta cada versión publicada:

  | `@y/prosemirror` | Publicada | Lo que le falta de lo que importa BlockNote 0.55.0 |
  |---|---|---|
  | 2.0.0-6 (el mínimo declarado) | 2026-07-06 | `deltaAttributionToFormat`, `deltaToPNode`, `deltaToPSteps`, `nodeToDelta` |
  | 2.0.0-8 | 2026-08-20 | los mismos cuatro (comprobado también al cargarla: *does not provide an export named 'deltaToPSteps'*) |
  | 2.0.0-9, -10, -11 | 2026-09-07 y 08 | nada |
  | 2.0.0-12, -13, -14 (la última) | 2026-09-21 a 2026-10-01 | `deltaAttributionToFormat`, `pmToFragment` |

  La 2.0.0-7 no se revisó.
- **BlockNote la usa con un parche propio.** En su repositorio, etiqueta `v0.55.0`, el archivo `pnpm-workspace.yaml`
  fija `@y/y` en `14.0.0-rc.23`, `@y/prosemirror` en `2.0.0-6` y `lib0` en `1.0.0-rc.22`, y aplica
  `patches/@y__prosemirror@2.0.0-6.patch` (27.796 bytes; su último cambio es del 2026-07-07). Ese parche agrega los
  cuatro nombres que faltan y cambia qué hace el binding con un nodo que el esquema no conoce (lo descarta en vez de
  tirar un error). **El parche no está en npm**: quien instala `@blocknote/core` y `@y/prosemirror` no lo recibe.
- Las versiones 2.0.0-9 a -11, las únicas que exportan todo lo que BlockNote importa, piden `@y/y ^14.0.0-rc.26` y
  `lib0 ^1.0.0-rc.32`: con el `lib0` fijo de BlockNote quedan dos o tres copias de `lib0` 1.x en la misma app (medido
  con las últimas: tres copias). **No se probó si funciona así**; Yjs avisa en su propio código que dos copias de la
  librería rompen sus comprobaciones.

**En términos simples:** hoy hay una sola combinación con la que esta pieza anda como la prueban sus autores, y es
una versión de julio de y-prosemirror 2 con un arreglo casero de BlockNote encima. Para usarla habría que copiar ese
arreglo al repo: un tercer parche, y sobre una librería que cambia de nombres cada pocas semanas.

### 1.3 ¿Estable, experimental o beta?

- **`@y/y`** (Yjs 14): 34 versiones publicadas, **todas previas**. Primera candidata (`14.0.0-rc.0`) del 2026-02-25;
  última, `14.0.0-rc.28`, del 2026-09-29, bajo la etiqueta `beta`. La etiqueta `latest` apunta a `14.0.0-rc.7`. No
  existe una `14.0.0`. El paquete `yjs` sigue en 13 (`latest` = 13.6.33, del 2026-09-23).
- **`@y/prosemirror`**: 14 versiones, todas previas (`2.0.0-0` a `2.0.0-14`, la última del 2026-10-01, etiqueta
  `beta`). Su README (leído en el paquete 2.0.0-8) dice que es la versión **inestable** y que la mayoría debería
  seguir con `y-prosemirror` y Yjs 13 por ahora. `y-prosemirror` sigue en 1.3.7 (2025-07-03).
- **La API todavía se mueve.** Entre `@y/y` `rc.23` y `rc.28` la clase de los tipos compartidos cambió de nombre
  (`Y.Type` pasó a `Y.Node`; el archivo `src/ytype.js`, a `src/ynode.js`). Entre `@y/prosemirror` 2.0.0-11 y -12
  desaparecieron dos funciones que BlockNote usa (tabla de arriba).
- **BlockNote no la anuncia.** Las notas de las versiones 0.52.0 a 0.55.0 (leídas de la API de versiones de GitHub)
  hablan solo de `@blocknote/core/yjs` («Decouple yjs from blocknote/core», #2741); ninguna nombra `/y`, Yjs 14 ni
  `@y/`. La página de colaboración de su documentación (`blocknotejs.org/docs/features/collaboration`) muestra solo
  el import de `/yjs`. **No confirmado:** que BlockNote la llame «experimental» o «beta» con esas palabras; lo que
  hay es que la publica sin documentarla y sobre dependencias previas.
- Lo que BlockNote está construyendo con ella (se ve en `src/y`): sugerencias de cambios, autoría de cada cambio y
  versiones con diferencias. Es para eso que la necesita, más que para arreglar fusiones.

**En términos simples:** «versión previa» o «candidata» quiere decir que los autores todavía la pueden cambiar sin
aviso, y lo están haciendo. No hay ninguna versión de Yjs 14 ni de y-prosemirror 2 que sus autores llamen terminada.

### 1.4 Qué cambia de la API que usa el repo

Hoy la app monta el editor con `withCollaboration` de `@blocknote/core/yjs` y pasa solo `fragment` y `user`
(`src/ui/PageEditor.tsx`). Con `/y`:

| Tema | Hoy (`/yjs`) | Con `/y` (0.55.0) |
|---|---|---|
| `collaboration.fragment` | `doc.getXmlFragment('document-store')` (`Y.XmlFragment`) | `doc.get('document-store')` (`Y.Type`). En Yjs 14 **no existen** `Y.XmlFragment`, `Y.XmlElement`, `Y.XmlText`, `Y.Map`, `Y.Array` ni `Y.Text`: hay un solo tipo |
| Deshacer | BlockNote monta `yUndoPlugin` (extensión `yUndo`) | **No monta ninguno.** `editor.undo()` tira *No undo plugin found* (medido), y Ctrl/⌘+Z llama a esa misma función. `@y/prosemirror` sí trae `yUndoPlugin`, pero hay que montarlo a mano con un `Y.UndoManager` propio |
| Cursores de otros | `provider.awareness` de `y-protocols` | igual, con `@y/protocols` (la app no los usa todavía) |
| Estado del plugin de sincronización | `ySyncPluginKey` da `binding` (`mapping`, `type`, `doc`, `mux`, `_forceRerender`, `_prosemirrorChanged`) | da `ytype`, `renderer` y funciones; **no hay `binding` ni `mapping`** |
| Funciones sueltas | `updateYFragment`, `yXmlFragmentToProseMirrorRootNode`, `prosemirrorToYXmlFragment`, `yXmlFragmentToBlocks`, `blocksToYXmlFragment` | `pmToFragment`, `fragmentToPm`, `docToDelta`, `deltaToPNode`; en BlockNote, `yfragmentToBlocks`, `blocksToYType`, `blocksToYDoc`, `yDocToBlocks` |
| Funciones de Yjs que la app usa y Yjs 14 no tiene | — | `createDeleteSet`, `mergeDeleteSets`, `equalDeleteSets`, `isDeleted`, `parseUpdateMeta`, `getItem`, `typeListToArraySnapshot` (hay equivalentes con otro nombre: la familia `IdSet`) |

**En términos simples:** no es cambiar una línea. La app saca de adentro de la pieza de hoy varias herramientas
(mover bloques, volver a dibujar, restaurar versiones, la línea de tiempo del deshacer) que en la nueva no existen o
se llaman distinto, y el deshacer directamente no viene.

## 2. Qué cambia en lo guardado

### 2.1 Cómo se guarda un bloque hoy y cómo con el binding nuevo

La misma página (un título, un párrafo con una palabra en negrita y un párrafo vacío con un hijo), escrita por cada
binding y leída de su `Y.Doc`:

- **Hoy:** `blockgroup > blockcontainer[id] > paragraph[atributos] > (un Y.XmlText con el texto y sus formatos)`. El
  texto vive en un tipo aparte, hijo del párrafo. Un párrafo vacío lleva un `Y.XmlText` vacío (parche del repo).
- **Nuevo:** `blockGroup > blockContainer[id] > paragraph[atributos]`, y **el texto son hijos directos del párrafo**
  (las letras y los formatos van en la misma lista que tendría los hijos). Un párrafo vacío no tiene nada adentro.
- Los nombres de los nodos, los atributos y el `id` del bloque son los mismos.

**En términos simples:** hoy cada renglón es una caja con un sobre adentro, y el texto está en el sobre. En la forma
nueva el texto está suelto en la caja. Las cajas se llaman igual, pero quien busca el sobre no lo encuentra, y quien
no espera un sobre lo toma por basura.

### 2.2 El formato binario: Yjs 14 lee y escribe lo de Yjs 13

Medido con `yjs` 13.6.33 y `@y/y` 14.0.0-rc.23 sobre la misma página y sobre un documento con borrados de dos autores
armado sin GC (*garbage collection*: cuando Yjs reemplaza lo borrado por un hueco que solo dice cuánto medía):

| Prueba | Resultado |
|---|---|
| Yjs 14 aplica un update v1 y uno v2 escritos por Yjs 13 | sí, sin nada pendiente |
| Yjs 14 vuelve a escribir ese documento (v1 y v2, con y sin GC) | **los mismos bytes** que Yjs 13 |
| Vector de estado (*state vector*: hasta dónde vio cada autor) | los mismos bytes |
| Snapshot de Yjs (`encodeSnapshot`) | los mismos bytes; Yjs 13 lee el de Yjs 14 y da igual; `createDocFromSnapshot` funciona |
| `decodeUpdate`, `mergeUpdates`, `diffUpdate`, `encodeStateVectorFromUpdate` sobre bytes de Yjs 13 | la misma salida que la entrada (38 elementos en las dos) |
| Yjs 13 aplica un update **nacido en Yjs 14** | sí, sin nada pendiente; mismo vector de estado |
| `new Y.Doc({ gc: false })` en Yjs 14 | existe y respeta la opción |

Lo que esto quiere decir para las tablas de la app:

- **`page_updates` (solo agregado):** las filas de hoy se siguen pudiendo leer con Yjs 14. No hay que reescribirlas
  ni borrarlas, y una fila escrita con Yjs 14 es una fila común.
- **`page_snapshots`:** los snapshots armados sin GC se leen igual. La huella (`sha256` de `encodeStateAsUpdate`)
  dio idéntica entre Yjs 13 y 14 para el mismo estado en los tres documentos medidos. **No confirmado con páginas
  reales** (grandes, con muchas ediciones).
- `Doc_Compactar.md` da por hecho que «Yjs 14 cambia el formato» y que los snapshots se apagan ese día: en lo medido
  el formato binario no cambia. Lo que obliga a rearmar es la conversión de la forma (2.3), no los bytes.

**En términos simples:** el «idioma» en que Yjs escribe los cambios es el mismo en la versión 13 y en la 14. Nada de
lo guardado en la base queda ilegible. El problema no está en los bytes: está en lo que cada editor espera encontrar
adentro de un bloque.

### 2.3 Abrir una página con el binding equivocado

Medido con dos editores reales sobre el mismo contenido, a nivel de librería (sin los resguardos de la app):

| Caso | Qué pasó |
|---|---|
| **El editor nuevo abre una página de hoy** | Monta sin error, **muestra todos los bloques vacíos y escribe en el documento al abrir: borra los textos**. Ese borrado es una edición común: se sube y llega a todos |
| Un editor de hoy que tenía esa página abierta recibe ese borrado (16 bytes) | Lo aplica como cualquier edición: **sus bloques quedan vacíos**. El texto se fue para todos |
| **El editor de hoy abre una página nacida en el nuevo** | No monta: `TypeError` (*reading 'right'*) en `createChildren` de y-prosemirror 1 |
| El resguardo de hoy (`findUnknownContent`, `unknownContent.ts`) sobre una página nueva | Devuelve `null`: **«conozco todo, se puede abrir»**. No la frena |
| La reparación de hoy (`normalizeStructure`) sobre una página nueva | No toca nada |
| Una pestaña de hoy tiene la página abierta; otro dispositivo la convierte a la forma nueva y escribe en ella | Al recibirlo, el editor de hoy tira `TypeError` al dibujar y **se queda mostrando lo de antes** |
| La persona de esa pestaña escribe una letra | Su editor **escribe su versión encima**: borra el texto en la forma nueva y vuelve a poner el suyo en la forma de hoy. Al dispositivo nuevo le llega y **todos los párrafos de la página le quedan vacíos** |
| El editor nuevo abre la semilla de página vacía de hoy | Monta y borra el texto vacío de la semilla (escribe al abrir) |
| Dos dispositivos abren una página vacía con el editor nuevo, sin semilla, y cada uno escribe | Cada editor crea su bloque inicial; al juntarse **queda el texto de uno solo** (10 de 10 repeticiones). Hoy, con la semilla, quedan los dos |

Por qué el editor nuevo borra: encuentra adentro del párrafo un tipo sin nombre (el `Y.XmlText` de hoy), que no es
un nodo del esquema; el parche de BlockNote a `@y/prosemirror` descarta lo que el esquema no conoce y **propaga ese
descarte al documento** para que todos queden iguales.

**En términos simples:** las dos formas no pueden mezclarse en una misma página ni un segundo. Una app nueva que abra
una página vieja sin convertirla antes la vacía para todos. Y las versiones viejas de la app no se dan cuenta de que
una página ya está en la forma nueva: su freno de seguridad mira los nombres de los bloques, y los nombres no
cambiaron.

## 3. Si resuelve lo que se espera

### 3.1 El banco de prueba

Armado fuera del repo, con su propia instalación (la receta está en la sección 7):

- **Hoy:** `@blocknote/core/yjs` 0.55.0, `y-prosemirror` 1.3.7 y `yjs` 13.6.33 **con los dos parches del repo** (los
  archivos parcheados son byte a byte los de `node_modules` del repo) y la reparación de la app (`normalizeStructure`,
  copia de `src/sync/structure.ts` en `c6be97a`) aplicada a cada entrega, como `applyToLive`.
- **Nuevo:** `@blocknote/core/y` 0.55.0, `@y/prosemirror` 2.0.0-6 con el parche de BlockNote, `@y/y` 14.0.0-rc.23 y
  `lib0` 1.0.0-rc.22: lo que BlockNote fija en su repositorio. Sin reparación de la app (la de hoy no entiende la
  forma nueva). Para medir el deshacer se le montó a mano el `yUndoPlugin` de `@y/prosemirror`.
- El mismo editor en los dos (BlockNote 0.55.0, **esquema de fábrica**, no el de la app), sin navegador (jsdom
  30.1.1, vitest 5.0.2, node 22).
- **Agenda:** dos editores sobre la misma página ya guardada (un título, cuatro párrafos con dos palabras y uno
  vacío). Cuatro rondas; en cada una los dos quedan sin red, cada uno hace 1 o 2 cambios **sobre el mismo bloque**,
  vuelve la red y se entrega en orden, como el servidor. Nadie borra texto a propósito: toda marca escrita (`{A12_3}`)
  o palabra inicial que falte al final es una pérdida. **300 agendas por familia**, las mismas semillas para los dos.
- Las agendas están hechas para chocar: los números no son «cada cuánto pasa» en el uso real, sino qué pasa cuando
  el choque ocurre.

### 3.2 Resultados: dos personas en el mismo bloque

Cantidad de agendas (de 300) con algo perdido; entre paréntesis, marcas perdidas sobre marcas escritas. «Dos veces»
es texto que quedó duplicado.

| Lo que hace A / lo que hace B a la vez | Hoy (con parches y reparación) | Nuevo |
|---|---|---|
| Los dos escriben (control) | 0 (0 de 3.602) | 0 (0 de 3.602) |
| A escribe, B le **cambia el tipo** | **300** (1.802 de 1.802) | **300** (1.802 de 1.802) |
| A escribe, B lo **sangra** o le quita la sangría | **300** (1.710 de 1.832) | **300** (1.571 de 1.832), y en 15 además una palabra que ya estaba |
| A escribe, B lo **mueve** arriba o abajo | 173 (283 de 1.796; 104 de esas marcas están con las letras en otro orden; con letras de menos, 102 agendas) | **293** (1.073 de 1.796; 21 en otro orden; con letras de menos, las 293) |
| A escribe, B lo **junta** con el de arriba | **300** (1.691 de 1.800) | **300** (1.691 de 1.800) |
| A escribe, B lo parte con **Enter** | 0 (0 de 1.824) | 0 con letras de menos; en 42 una marca queda con las letras en otro orden (44 de 1.824) |
| Los dos escriben en el mismo **párrafo vacío** | 0 (0 de 3.569) | 0 (0 de 3.569) |
| Los dos le cambian el tipo | 0; nada dos veces | 0; **294 con el bloque dos o tres veces**; en las 300 quedan bloques con el mismo id |
| Los dos lo sangran | 0; 208 con algo dos veces | 13 con una palabra perdida; 300 con algo dos veces; 297 con ids repetidos |
| Los dos cambian la estructura (tipo, sangría, mover, juntar, Enter) | **141** con palabras perdidas (267 palabras); 231 con algo dos veces | **1** (2 palabras); 284 con algo dos veces; 249 con ids repetidos |
| De todo un poco | 274 (608 de 1.814 marcas; 122 palabras que ya estaban, en 64 agendas); 132 con algo dos veces | 272 (633 de 1.823 marcas; 7 palabras que ya estaban, en 3 agendas); 158 con algo dos veces |
| De todo un poco, con un bloque elegido entero del otro lado | 272 (571 de 1.806 marcas; 122 palabras, en 68 agendas) | 260 (614 de 1.804 marcas; 7 palabras, en 3 agendas) |

«Con las letras en otro orden» es la marca desordenada de `Doc_Colaboracion.md` (`9}{A1_` por `{A1_9}`): las letras
están todas. Con el binding de hoy, ninguna agenda terminó con dos bloques con el mismo id.

En las 3.600 agendas de cada uno: **0** veces los dos editores terminaron distintos, **0** un editor mostrando algo
viejo, **0** errores al entregar, **0** cambios yendo y viniendo sin fin, **0** escrituras al abrir.

La tabla es de una corrida completa. En otras dos, las cifras se movieron unas pocas agendas (173, 177 y 173 en
«mueve» con el binding de hoy; 143, 140 y 141 en «los dos cambian la estructura»): Yjs desempata dos cambios a la vez
por el número de autor, que es al azar. El cuadro no cambia.

Lo que explica los números del binding nuevo: `blockMatchNodes` (`src/y/extensions/blockMatchNodes.ts` de BlockNote)
decide que un `blockContainer` cuyo contenido cambia de tipo, o que gana o pierde hijos, es **otro bloque**: lo borra
entero y crea uno nuevo al lado. Es el mismo «borrar y volver a crear» de hoy, hecho a propósito para no dejar dos
contenidos en un bloque; lo que otro escribía en el bloque viejo se va con él.

**En términos simples:** lo que el roadmap esperaba que arreglara, no lo arregla. Si una persona escribe en un
renglón y otra, sin verla, le cambia el tipo, lo sangra o lo junta, lo escrito se pierde igual que hoy. Si lo mueve,
se pierde más seguido que hoy. La mejora es otra: cuando las dos personas reordenan a la vez, el texto que ya estaba
casi nunca se pierde (1 de 300 contra 141), porque en vez de perderlo lo deja repetido. Y el caso de las dos personas
en un párrafo vacío de una página que ya existe, que hoy necesita un parche, anda sin él (la página recién creada
sigue necesitando una semilla: 2.3).

### 3.3 Resultados: deshacer

**Casos mínimos con Yjs solo** (los de `Doc_Deshacer.md`, secciones 16.1, 20.1 y 21.2):

| Caso | Esperado | `yjs` 13.6.33 con el parche del repo | `yjs` 13.6.33 publicado | `@y/y` 14.0.0-rc.23 y rc.28 |
|---|---|---|---|---|
| B.21, restos | `abcdefgh` | `abcdefgh` | `abcdefxgh` | `abcdefxgh` |
| B.21, texto de menos | `abcdefgh` | `abcdefgh` | `abcdegh` | `abcdegh` |
| B.26, «tres» (quien deshizo / el otro / al recargar) | tres / tres / tres | tres / tres / tres | tres / **ters / ters** | tres / **ters / ters** |
| B.26, «dos» | dos / dos / dos | dos / dos / dos | dos / **dso / dso** | dos / **dso / dso** |
| B.22, la copia del renglón borrada por otro | sin error, `xyz` | sin error, `xyz` | `TypeError`, `xz` | `TypeError`, `xz` |
| 20.5, Enter con el renglón de arriba borrado (pendiente también hoy) | — | `otro` | `otro` | `otro` |

**Con el editor**, pasos al azar (escribir, Enter, juntar, cambiar el tipo, borrar un bloque, deshacer y rehacer
intercalados) y al final deshacer todo; 500 corridas de 30 pasos:

| Prueba | Hoy | Nuevo (con el deshacer montado a mano) |
|---|---|---|
| Una persona: la página vuelve a ser la inicial | **500 de 500** | 470 de 500 (en 29 quedan letras de más, como `6}` delante de un renglón; en 1, una palabra dos veces) |
| Dos personas: vuelve a ser la inicial | 113 | 97 |
| Dos personas: falta alguna palabra que ya estaba | 68 | 43 |
| Dos personas: alguna palabra quedó dos veces | 142 | 228 |
| Dos personas: un ⌘Z tiró una excepción / terminaron distintos / la memoria distinta de lo rearmado | 0 / 0 / 0 | 0 / 0 / 0 |

La prueba de dos personas llama al deshacer de Yjs directo, sin la línea de tiempo de la app, y sirve solo para
comparar los dos bindings entre sí; la calidad del deshacer de hoy está medida con su propio arnés en
`Doc_Deshacer.md` (secciones 20.4 y 21.4). Con 500 corridas no alcanza para ver la excepción ni los textos distintos,
que en el repo aparecieron 10 y 6 veces en 3.000.

**En términos simples:** los tres arreglos que el repo le hizo al deshacer de Yjs no están en Yjs 14: el mismo ⌘Z
que hoy sale bien, allá deja letras de más, se lleva letras de antes o deja a dos personas con textos distintos. Y
con una sola persona, deshacer todo hoy devuelve la página exacta siempre; con la pieza nueva, 30 de 500 veces no.

### 3.4 Costo al escribir y peso

- **Escribir en una página grande** (jsdom en una PC; sirve para comparar, no es el número del iPhone). Mediana de 5
  aperturas y de 100 letras en cada una; rango de tres corridas:

  | Página | Abrir: hoy / nuevo | Cada letra escrita: hoy / nuevo |
  |---|---|---|
  | 200 bloques | 20 a 25 ms / 39 a 41 ms | 0,5 a 0,6 ms / 11,6 a 12,5 ms |
  | 1.000 bloques | 49 a 54 ms / 126 a 135 ms | 3,0 a 3,7 ms / **56 a 58 ms** |

  Una corrida anterior, con la máquina más cargada, dio 147 ms por letra con el binding nuevo en 1.000 bloques (y
  3,4 ms con el de hoy). **No confirmado** por qué (no se leyó a fondo): el binding nuevo sincroniza comparando el documento
  del editor con el de Yjs, y el costo crece con el tamaño de la página.
- **Peso:** Yjs, el binding y la entrada de BlockNote, empaquetados y minificados (sin ProseMirror ni el resto de
  BlockNote): 140.340 bytes hoy (45.737 con gzip) contra 172.788 (53.340 con gzip): unos 7,6 kB más comprimido.

**En términos simples:** en una página larga, cada tecla tarda unas 17 veces más con la pieza nueva, medido en una
computadora (y más si la máquina está ocupada). En un teléfono eso se puede notar al escribir; hoy no.

### 3.5 Lo que no se pudo medir

- **El esquema de la app** (fotos en línea, Script, tablas con sus párrafos, anotaciones): se usó el de fábrica. Las
  fotos en línea son el caso donde más cambia la forma (hoy: huecos estables y la marca del renglón); no se midió.
- **El camino real de la app** (`PageDocs`, IndexedDB, subidas que se pierden, compactación): solo dos editores
  conectados en orden.
- **Un navegador real y el iPhone:** todo corrió en jsdom.
- **Las últimas versiones** (`@y/prosemirror` 2.0.0-14, `@y/y` rc.28) con el editor: a BlockNote 0.55.0 le faltan
  dos funciones en esa versión de `@y/prosemirror` (1.2). De `@y/y` rc.28 se midieron solo los casos mínimos del
  deshacer.
- **Tres personas o más**, y corridas largas del deshacer (3.000 o más).

## 4. Qué se rompe o hay que rehacer

En el repo, **81 archivos que no son pruebas importan `yjs`** (80 en `src/`, 1 en `portero/`), 16 importan
`y-prosemirror` y 10 `@blocknote/core/yjs`; además, 170 archivos de prueba. Punto por punto:

| Qué | De qué depende hoy | Con el binding nuevo |
|---|---|---|
| **Parche de y-prosemirror** (`patches/y-prosemirror+1.3.7.patch`, 1.877 líneas) | Archivos de y-prosemirror 1 | No aplica: la librería es otra. Por parte: **bloque elegido entero** (`restoreRelativeSelection`): el binding nuevo restaura la selección de otra manera; en 300 agendas con un bloque elegido no hubo editor viejo ni error. **Texto vacío en el párrafo vacío:** deja de hacer falta (0 de 3.569 sin parche). **Texto de los huecos, huecos estables y marca del renglón** (fotos en línea): la forma nueva no tiene textos separados entre fotos, así que el problema de origen no debería existir; **no medido**. La marca `lgaStableGaps` (que frena a las versiones viejas) hay que repensarla |
| **Parche de Yjs** (`patches/yjs+13.6.33.patch`: B.21, B.22, B.26) | `UndoManager.js` e `Item.js` de Yjs 13 | **Hay que rehacerlo** sobre `@y/y`: los tres errores siguen (3.3). Las funciones (`followRedone`, `redoItem`, `popStackItem`) existen con la misma idea, y `followRedone` conserva la nota de sus autores que cita `Doc_Deshacer.md` (*This should return several items*). Mientras Yjs 14 cambie cada pocas semanas, el parche se rehace con cada versión |
| `assertYProsemirrorPatched` y `assertYjsPatched` (`vite.config.ts`) | Marcas en archivos que dejan de existir | Se reescriben para las librerías nuevas |
| **Reparación de bloques** (`normalizeStructure`, `structure.ts`) | `Y.XmlElement`, `Y.XmlText`; «dos contenidos» y «dos grupos de hijos» | Se reescribe. Los dos casos que arregla hoy el binding nuevo los evita reemplazando el bloque (por eso duplica). Pero el binding nuevo **descarta del documento lo que no entra en el esquema** (elige qué hijos quedan y borra el resto): es «perder antes que duplicar», al revés de la regla de la app. Hay que decidir si se le antepone una reparación propia |
| **Semilla de página vacía** (`buildSeedRoot`, capa de texto) | Bytes fijos con autor fijo; un `Y.XmlText` vacío | La raíz de la semilla (versión 1, sin la capa de texto) tiene la forma que espera el editor nuevo: medido, abre la semilla de hoy y solo le saca el texto vacío. La capa de texto sobra. **Sin semilla se pierde texto** en una página nueva abierta en dos dispositivos (2.3). No confirmado: que Yjs 14 arme la raíz byte a byte igual |
| **`syncedSV` / `syncedDS` y la subida sin GC** (`docs.ts`, `deleteSets.ts`, `removedWriting.ts`) | Vectores de estado, el delete set v1 recortado a mano, `Y.Item`/`Y.GC`, `doc.store.pendingStructs` | Los bytes son los mismos (2.2), así que lo guardado en IndexedDB sigue valiendo. El código se porta: `createDeleteSet` y familia no existen (pasan a `IdSet`). `doc.store` conserva `clients`, `pendingStructs` y `pendingDs`. No confirmado: que Yjs 14 cambie el número de autor de un documento abierto igual que Yjs 13 (la app depende de eso para anotar «lo propio») |
| **Compactar** (`compact.ts`: snapshots, huellas, `compareUnits`) | `sha256(encodeStateAsUpdate)`; recorrer elemento por elemento | Las huellas dieron iguales entre Yjs 13 y 14 en lo medido. `compareUnits` se porta (los campos existen). **La conversión de una página invalida sus snapshots** si se hace con una época nueva (sección 5) |
| **Historial y restaurar** (`history*.ts`, `historyRestore.ts`) | Snapshots de Yjs, `typeListToArraySnapshot`, `parseUpdateMeta`, `mergeDeleteSets`, `toDelta(snapshot)` de un `Y.XmlText`, `updateYFragment` | Los snapshots se leen. Tres funciones no existen y hay que reemplazarlas. **El historial tiene que entender las dos formas para siempre:** las versiones anteriores a la conversión tienen el texto en la forma de hoy. Restaurar una versión vieja la escribe en la forma nueva. Yjs 14 trae sus propias herramientas de diferencias y autoría (`diffDocsToDelta`, renderers), que podrían simplificar esta parte |
| **Línea de tiempo del deshacer** (P.26, `undoTimeline.ts`) | El `UndoManager` que monta y-prosemirror; reasignar `undoStack`/`redoStack`; `deleteFilter`; `captureTimeout`; eventos `stack-item-*`; `Y.isDeleted` sobre `insertions` | La app tiene que **montar ella el deshacer** (BlockNote `/y` no lo trae). `undoStack`, `redoStack`, `deleteFilter`, `captureTimeout`, `trackedOrigins`, `currStackItem` y los eventos `stack-item-added`, `-updated` y `-popped` existen; los pasos guardan `IdSet` en lugar de `DeleteSet`. Todo lo medido en `Doc_Deshacer.md` se vuelve a medir |
| **Comentarios** | Van al `id` del bloque (`comments.block_id`), no al texto | Siguen andando: el `id` se conserva. Pero con dos cambios de tipo a la vez quedan **dos bloques con el mismo id** mucho más seguido (en las 300 agendas contra ninguna); el comentario queda en uno de los dos |
| **Buscar y reemplazar en el proyecto** (`search/extract.ts`, `replaceDoc.ts`) | Lee `Y.XmlText.toDelta()`; escribe con `insert`/`delete` sobre el `Y.XmlText`; guarda posiciones relativas de ese texto para deshacer | Se reescriben lectura y escritura. **Los reemplazos ya registrados no se pueden deshacer después de convertir** (apuntan a textos que la conversión borra). El JSON de una posición relativa tiene la misma forma |
| **Importar, exportar, plantillas, Coda** | `yXmlFragmentToBlocks`, `blocksToYXmlFragment`; `importCommit.ts` compara bytes y guarda un diario | Cambian de nombre. Los diarios de importación a medias se terminan o se descartan antes de convertir. Un zip exportado hoy trae páginas en la forma de hoy: **el importador tiene que saber convertir siempre** |
| **Link público con escritura** (`admit.ts`, `linkShape.ts`) | Tablas escritas a mano de qué hijo y qué atributo puede tener cada nodo, recorriendo elementos de Yjs | Se reescriben las reglas (el texto pasa a ser hijo directo del bloque). Es el control de lo que escribe alguien sin cuenta: **pide su propia auditoría de seguridad**. A favor: la admisión puede rechazar la forma vieja y así frenar una pestaña vieja de un visitante |
| **Portero** (`portero/src/mcpPage.ts`) | Lee páginas con `yjs` 13 | Se actualiza y se publica **junto con** la app |
| **Regla de degradar en versiones viejas** (`unknownContent.ts`, `min_app_version`) | El resguardo mira nombres de nodos y de marcas | **No protege:** una versión vieja cree que conoce una página nueva (2.3). Ver abajo |

**Una pestaña vieja y una página nueva, y al revés:**

- *Versión vieja, página en la forma nueva:* el resguardo la deja pasar; el editor viejo tira un error al dibujarla.
  Si la pestaña ya tenía el editor abierto, se queda con lo de antes y, a nivel de librería, con su próxima tecla
  escribe encima y la página queda vacía en los dispositivos nuevos (2.3). La app tiene desde v0.052 un resguardo
  para un error al dibujar (vuelve a dibujar o pasa a solo lectura): **no se midió** si alcanza en este caso.
  `min_app_version` frena solo las subidas: una versión vieja baja y edita igual en el dispositivo, y cuando se
  actualiza sube su cola (`Doc_Colaboracion.md`, «Versiones viejas»).
- *Versión nueva, página en la forma de hoy:* si la abre sin convertir, la vacía (2.3). La app nueva **tiene que
  convertir antes de montar el editor, siempre**, también lo que llega después de una pestaña vieja.
- *El binding nuevo y lo que no conoce:* borra del documento compartido cualquier nodo que su esquema no tenga (es lo
  que hace el parche de BlockNote). La regla «nada de tipos de bloque nuevos» y `unknownContent.ts` **siguen haciendo
  falta** con la pieza nueva.

**En términos simples:** casi todo lo que hace especial a esta app en materia de datos (no perder nada sin red, el
historial, compactar, el link público, el deshacer de varios pasos) está escrito sabiendo exactamente cómo guarda la
pieza de hoy. Cambiar la pieza es volver a escribir y volver a medir cada una de esas cosas. Y el freno que hoy evita
que una versión vieja rompa una página nueva, acá no frena.

## 5. Cómo sería la migración, si se hiciera

Es un esquema para dimensionar, no un diseño cerrado: la conversión pide su propio diseño, con prototipo y
auditoría.

### 5.1 Convivencia

- **Las dos formas no conviven en una página** (2.3). Sí pueden convivir **páginas** en una forma y en la otra: se
  puede migrar página por página, si cada página dice en qué forma está de un modo que **las versiones viejas vean
  como contenido desconocido**. Es el mecanismo que ya se usó con la marca del renglón de las fotos (v0.078).
- La marca no puede ir adentro de lo que dibuja el editor nuevo (la borraría). Dos caminos a prototipar:
  1. **Otra raíz.** La página convertida vive en una raíz nueva del `Y.Doc`; en `document-store` queda un elemento
     que ninguna versión vieja conoce. La vieja no abre la página; la nueva usa la raíz nueva.
  2. **Época de contenido.** Usar lo que ya existe para «todos rearman desde esta base» (`pages.content_epoch`,
     `Doc_Compactar.md`): la conversión es una base nueva, y la versión mínima para bajar esa época es la nueva.
     Pide que la base también frene las **bajadas** de una versión vieja, que hoy no frena.
- **Hace falta un corte con `min_app_version`** a la versión que sabe convertir, pero no alcanza solo (frena subidas,
  no ediciones locales): lo que protege es la marca.

### 5.2 Convertir sin perder nada

- **El historial no se toca:** las filas de `page_updates` quedan como están. La conversión son filas nuevas: borrar
  cada `Y.XmlText` y escribir su texto, con sus formatos, como hijos del bloque.
- **Dos dispositivos que convierten a la vez duplican la página.** O convierte uno solo (un pedido a la base que le
  da el turno, como el de los snapshots, que ya detecta dos armados distintos), o la conversión es determinista (mismo
  autor y mismos números, como la semilla), lo que exige que los dos partan del mismo estado.
- **Lo que un dispositivo tiene sin subir** en la forma de hoy puede llegar después de la conversión (un teléfono que
  estuvo días sin red). Son escrituras sobre textos que la conversión ya borró: Yjs las acepta y quedan invisibles. La
  app nueva tiene que **detectarlas y llevarlas a la forma nueva**, y avisar (como hoy «lo que escribiste quedó dentro
  de algo borrado»). Es la parte más difícil y la que más pruebas al azar necesita.
- **Lo que no sobrevive:** las pilas de deshacer abiertas, los reemplazos del proyecto ya registrados y los snapshots
  de la página. Los comentarios sí (van por `id`).

### 5.3 Vuelta atrás

- Antes de publicar la versión que convierte: se vuelve atrás como cualquier tanda.
- **Después de convertir una página no hay vuelta atrás simple:** una versión anterior no la puede abrir. Las
  opciones son restaurar la copia de seguridad (se pierde lo escrito desde entonces) o tener escrita y probada la
  conversión inversa. Por eso la conversión se prueba primero en un workspace descartable y con un interruptor por
  workspace (como `snapshot_min_version`).

### 5.4 Orden de entregas y tamaño

| # | Entrega | Tamaño estimado |
|---|---|---|
| 0 | Reportar a Yjs los casos mínimos de B.21, B.22 y B.26 (ya está en el roadmap) y esperar una versión estable | chico; depende de terceros |
| 1 | Las pruebas de dos editores del repo corriendo con los dos bindings (el banco de esta evaluación, con el esquema de la app y las fotos en línea) | mediano |
| 2 | El parche del deshacer rehecho sobre `@y/y`, con sus pruebas | mediano |
| 3 | Una capa propia sobre Yjs para que los 81 archivos no dependan de la versión | grande |
| 4 | El editor con el binding nuevo detrás de un interruptor, en páginas de prueba: deshacer montado por la app, mover bloques, volver a dibujar, la selección | grande |
| 5 | Reparación, semilla, resguardo de contenido desconocido y admisión del link en la forma nueva, con auditoría de seguridad | grande |
| 6 | Historial y restaurar en las dos formas; buscar y reemplazar; importar y exportar; el portero | grande |
| 7 | La conversión: marca, turno, lo que llega tarde, prueba al azar con versiones mezcladas y con la librería publicada de verdad | grande; la de más riesgo |
| 8 | Prender por workspace, convertir, subir `min_app_version`, medir | chico |

Con las tandas de este repo como vara, son **del orden de 15 a 25 tandas**, y la mayor parte no agrega nada que el
usuario vea.

### 5.5 Qué medir en el iPhone

- El tiempo por tecla en páginas de 200 y 1.000 bloques (3.4), con el teclado y con el dictado.
- La memoria al abrir una página grande.
- El tiempo de convertir una página grande y un proyecto entero, y qué pasa si Safari suspende la app a mitad.
- El almacenamiento: la conversión agrega filas; cuánto crece IndexedDB antes de compactar.
- La selección y el cursor después de un cambio de otro.

**En términos simples:** migrar se puede, página por página, pero es un trabajo largo cuyo paso central (convertir lo
guardado) no tiene marcha atrás y tiene que salir bien también para el teléfono que estuvo una semana sin señal.

## 6. Recomendación

**Esperar. No migrar ahora.**

| | Dato |
|---|---|
| Beneficio medido | Los casos que motivaban la evaluación quedan **igual** (cambiar el tipo, sangrar, juntar: 300 de 300 en los dos) o **peor** (mover: 293 contra 173; con Enter no se pierden letras, pero en 42 de 300 queda una marca desordenada, contra 0). Mejora un caso: los dos cambian la estructura a la vez (1 contra 141), con más duplicados y bloques con el mismo id. El párrafo vacío anda sin parche (hoy también da 0) |
| Lo que empeora | El deshacer pierde los tres arreglos del repo (3.3); deshacer todo con una persona deja de ser exacto (470 contra 500 de 500); cada tecla cuesta unas 17 veces más en una página de 1.000 bloques |
| Riesgo para los datos | La conversión: una página abierta por la versión equivocada queda vacía para todos (2.3), y el resguardo de hoy no lo ve. Sin vuelta atrás simple |
| Madurez | `@y/y` y `@y/prosemirror` no tienen ninguna versión estable; BlockNote la usa con un parche propio que no publica; entre las versiones de julio y las de septiembre cambiaron nombres de clases y de funciones (1.3) |
| Costo | 15 a 25 tandas, casi todas invisibles para el usuario |

**Volver a medir cuando se cumplan las tres:**

1. `@y/y` 14.0.0 y `@y/prosemirror` 2.0.0 publicadas como estables (etiqueta `latest`, sin sufijo).
2. BlockNote documenta `/y`, la usa sin parche propio y trae deshacer.
3. Yjs 14 pasa los casos mínimos de B.21, B.22 y B.26, o el parche del repo está rehecho y medido.

Ese día se corre otra vez el banco (sección 7; lleva unos diez minutos) con el esquema de la app. Si el cuadro de 3.2
sigue igual, la respuesta sigue siendo no: lo que falta arreglar (escribir en un bloque que otro recrea) no depende
de la librería sino de que **un cambio de tipo, de sangría o de posición no borre el bloque**, y eso el binding nuevo
decidió no hacerlo.

Mientras tanto, lo que sí conviene: mandar a Yjs los casos mínimos del deshacer (ya figura en el roadmap), para que
Yjs 14 salga con ellos resueltos.

**Preguntas para Lega** (en `Doc_Decisiones.md`):

- **D330:** ¿esperar con esas tres condiciones (recomendado), empezar ahora por las entregas 1 a 3, que no tocan lo
  guardado, o descartar B.10?
- **D331:** ¿se mandan a Yjs los casos mínimos del deshacer? Es un reporte público con la cuenta de Lega.

**En términos simples:** hoy se pagaría mucho y se arriesgarían las páginas guardadas para quedar igual o peor en lo
que importaba. Si más adelante la pieza madura, las pruebas ya están hechas para saberlo en diez minutos.

## 7. El banco de prueba: cómo volver a correrlo

Está fuera del repo, en la carpeta privada de trabajo (`evalY`), con su propio `package.json`; no usa ni toca el
`node_modules` del repo. Para rearmarlo desde cero:

1. `package.json` con versiones exactas: `@blocknote/core` 0.55.0, `@tiptap/core` y `@tiptap/pm` 3.31.3, `yjs`
   13.6.33, `y-prosemirror` 1.3.7, `y-protocols` 1.0.7, `@y/y` 14.0.0-rc.23, `@y/prosemirror` 2.0.0-6, `@y/protocols`
   1.0.6-rc.1; `jsdom` 30.1.1 y `vitest` 5.0.2. Tiene que quedar **una sola copia de `lib0` 1.x** (la `1.0.0-rc.22`).
2. Aplicar a esa instalación los dos parches del repo (`git apply -p1` de `patches/*.patch`) y, a
   `node_modules/@y/prosemirror`, la parte `src/` de `patches/@y__prosemirror@2.0.0-6.patch` del repositorio de
   BlockNote en `v0.55.0`.
3. Una segunda instalación sin parches (carpeta `ult`) con `yjs` 13.6.33 y `@y/y` 14.0.0-rc.28, para los casos
   mínimos del deshacer.
4. Correr con node 22:

| Qué | Comando (desde la carpeta del banco) | Tarda |
|---|---|---|
| Dos personas en el mismo bloque (300 agendas por familia) y deshacer con el editor (500 corridas) | `EVALY_RUNS=300 EVALY_UNDO=500 npx -y node@22 node_modules/vitest/vitest.mjs run hoy/banco.test.ts nuevo/banco.test.ts hoy/deshacer.test.ts nuevo/deshacer.test.ts` y después `node tabla.mjs` | unos 4 minutos |
| Formato, convivencia, página vacía, pestaña vieja; casos mínimos del deshacer; el deshacer que no viene | `npx -y node@22 node_modules/vitest/vitest.mjs run formato deshacer/minimos.test.ts nuevo/sinDeshacer.test.ts` | menos de 1 minuto |
| Costo de abrir y de escribir (cada uno solo, sin otra corrida a la vez) | `npx -y node@22 node_modules/vitest/vitest.mjs run ritmo/hoy.test.ts` y lo mismo con `ritmo/nuevo.test.ts` | 1 minuto |

Los resultados quedan en `out/` (un `.txt` y un `.json` por prueba). `EVALY_ONLY=<familia>` corre una sola familia.

Para medir otra versión: cambiar las versiones de `@y/*` (y de BlockNote) en el `package.json`, reinstalar, volver a
aplicar los parches y correr lo mismo.

## 8. Fuentes

Todas consultadas el 2026-10-07.

| Fuente | Qué se sacó |
|---|---|
| `npm view` de `@blocknote/core`, `@y/y`, `@y/prosemirror`, `@y/protocols`, `yjs`, `y-prosemirror`, `lib0` (`dist-tags`, `time`, `versions`, `exports`, `dependencies`, `peerDependencies`) | versiones, fechas, etiquetas y dependencias de 1.1 a 1.3 |
| El paquete `@blocknote/core` 0.55.0 instalado: `package.json`, `dist/y.js`, `src/y/` (`README.md`, `extensions/index.ts`, `YSync.ts`, `blockMatchNodes.ts`, `utils.ts`), `src/editor/managers/StateManager.ts` | qué es `/y`, qué importa, cómo empareja bloques, que no monta deshacer |
| Los paquetes `@y/prosemirror` 2.0.0-6, -8 a -14 y `@y/y` 14.0.0-rc.23 y rc.28 (`README.md`, `src/index.js`, `src/sync-plugin.js`, `src/undo-plugin.js`, `src/commands.js`, `src/utils/UndoManager.js`) | exportaciones de cada versión, el aviso de «inestable», la API del deshacer |
| `https://github.com/TypeCellOS/BlockNote`, etiqueta `v0.55.0`: `pnpm-workspace.yaml`, `packages/core/package.json`, `patches/@y__prosemirror@2.0.0-6.patch`; y `pnpm-workspace.yaml` de `main` | las versiones que fija BlockNote y su parche |
| `https://api.github.com/repos/TypeCellOS/BlockNote/releases/tags/v0.52.0` a `v0.55.0` | notas de versión: ninguna nombra `/y` ni Yjs 14 |
| `https://www.blocknotejs.org/docs/features/collaboration` | la documentación muestra solo `@blocknote/core/yjs` |
| El banco de prueba de la sección 7 | todo lo medido en las secciones 2 y 3 |
