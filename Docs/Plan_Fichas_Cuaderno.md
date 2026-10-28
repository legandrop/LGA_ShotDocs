# Plan: fichas en el Panorama, documentos en Páginas

Fecha: 2026-10-27. Pedido de Lega, que eligió la alternativa B de tres (A: el Panorama como lente sobre Páginas; C: un
Panorama que nunca se edita y todo lo escrito como documentos). Sigue a `Plan_Estructura_Etapas.md`, que dejó el árbol
por etapas (partes 1 a 4 hechas, v0.275 a v0.295); su parte 5 (`6 | Tablas y referencia` y lo suelto) queda adentro de
este plan. **Todavía no se implementa nada:** primero lo revisa Lega.

## 1. Por qué

Mirado sobre VLLF real (2026-10-27) y su origen en Coda (docs «EEI» y «EEI | VFX Info & Reportes»):

- **La misma página tiene dos entradas.** *Overview › Locations*, *Sets*, *Scouting* y *Shoot days* abren exactamente
  las páginas que están en `1.2 | Locaciones`, `1.3 | Decorados`, `2 | Scouting Reports` y `5 | Rodaje`. Como lo abierto
  desde el Overview pliega *Pages* (D805, D806), nunca se ve que es la misma página: parece una copia que se puede
  editar. *Overview › Scenes* abre una tercera cosa, la vista de la escena en el mapa (`/map/scenes?scene=…`), con los
  mismos renglones por etapa que la cabecera de la página de la escena.
- **`BD Main` repite el Desglose.** Sus 258 filas son hoy los planos adentro de cada escena de `1.1 | Desglose` (D785,
  D786); la página que quedó en `6 | Tablas y referencia` es un índice que apunta a lo mismo. La importación sí inventó
  dos cosas: que haya una página por escena (en Coda era una fila por plano) y sus títulos, que salen del comienzo de
  la descripción del primer plano («040 | RUBIO ¿Qué está pasando? PORTERO Hace como…», D-VLLF-14).
- **El plan del día vive lejos de su reporte.** `4 | Planeamiento › Semana 08` y `5 | Rodaje › Semana 08` tienen los
  mismos días en dos carpetas. En set se mira el plan mientras se escribe el reporte, y en post se comparan.
- **Lo que busca Lega:** cargar rápido y claro en cada etapa, y que en post alguien diga «trabajo en la 059» y encuentre
  en un lugar el desglose, el scouting, las pruebas, el plan y lo filmado.

## 2. El principio

**Se escribe por etapa y se lee por cosa. Cada página vive en un solo lugar.**

- **Panorama (*Overview*) = las fichas y las vistas.** Una **ficha** por escena, locación y decorado: arriba lo que arma
  la app (la cabecera viva, no se edita), abajo lo propio de esa cosa (el desglose y los planos de la escena, la
  dirección y los otros nombres de la locación, el arte del decorado), que sí se edita. Las **vistas** (*Shoot days*,
  *Shots*, *Pending*) no tienen páginas propias: llevan a la página donde vive cada cosa.
- **Páginas (*Pages*) = el cuaderno.** Lo que se escribe en cada etapa, en el orden en que pasa: notas y reuniones,
  scoutings, pruebas y previs, el plan y el reporte de cada día, referencia y archivo.
- **En la base no cambia nada para la parte 1.** Las carpetas de escenas, locaciones y decorados siguen siendo páginas
  donde están (`1 | Preproducción › 1.1 | Desglose`…); lo que cambia es dónde las muestra la barra. Una versión vieja
  las sigue mostrando en *Pages*: se ve distinto, no se pierde nada.

## 3. Cómo queda

```
PANORAMA (Overview)                       PÁGINAS (Pages)
  Scenes      fichas, por episodio          1 | Preproducción      notas, reuniones, guion técnico
  Locations   fichas                        2 | Scouting Reports   un reporte por recorrido
  Sets        fichas                        3 | Pruebas y previs   un reporte por prueba
  Shoot days  calendario → abre el día      4 | Rodaje
  Shots       tabla de planos (solo lee)        Semana 08
  Pending                                         2026-05-12 | Día 40 | 7 Puentes | Plan
                                                  2026-05-12 | Día 40 | 7 Puentes
                                            5 | Referencia
                                            90 | Archivo           BD Main, BD Main OLD…
```

## 4. Parte 1 — La barra: cada página en un solo lugar

Hoy *Pages* solo esconde la papelera: las filas salen de `tree.roots` y `visibleRows` (`src/ui/Sidebar.tsx`, `roots` y
`visibleRows`; `src/ui/treeNav.ts`), y *Templates* es una raíz más. Lo abierto desde el Overview pliega todas las
carpetas, no abre las madres ni centra la fila (`Sidebar.tsx`, `shutFor`, `collapseToBranch`, `follow`;
`src/ui/sidebarRows.ts`, `markOpenedFromOverview`).

1. ***Pages* no muestra las fichas.** No aparece en el árbol una página que es escena, locación o decorado (su marca o
   su carpeta, `pageKind` en `src/relations/kind.ts`), ni una carpeta con `holds` de esos tipos, ni nada de lo que
   tienen adentro. Vale también para una entidad marcada a mano en cualquier lugar (*Type › This page is*): cada página
   en un solo lugar. Los días no se esconden: el reporte es lo que más se escribe y vive en `Rodaje`. Es un filtro en
   el armado de las filas; el teclado como un solo árbol (`sidebarRows.ts`, `ROWS`) recorre lo que está dibujado, así
   que sigue igual.
2. **Las fichas en el Panorama.** Una fila de *Scenes*, *Locations* o *Sets* abre la página de la ficha (la de la escena
   también: hoy abre la vista del mapa, `/map/scenes?scene=…`; esa vista queda en la pestaña central *Scenes*, con *N
   pages*). La fila tiene flecha cuando la ficha tiene subpáginas (una ficha con comentarios que no se trajo, un anexo,
   un scouting que quedó adentro de su locación) y se despliega como en *Pages*, con el mismo teclado (D806). Arrastrar
   una página sobre una fila la mete adentro. Lo que está en una carpeta de fichas y no es ficha (una nota con *None of
   these*, una página de grupo con texto) va al final de su parte, en *Other pages*, para que no quede inalcanzable.
3. **Crear desde el Panorama.** Un «+» en *Scenes* (y en cada episodio), *Locations* y *Sets* crea la ficha con su
   plantilla (*Scene*, *Location*; el decorado no tiene) en la carpeta de ese tipo. Hoy `createEntity.ts` solo crea
   escenas y locaciones, y sin carpeta del tipo el botón queda apagado («Primero marcá una carpeta como Escenas»): se
   suma el decorado y, si el proyecto no tiene carpeta, la crea en la raíz («Scenes», «Locations», «Sets», con su
   tipo), que desde ahí ya no se ve en *Pages*. Con varias carpetas del mismo tipo, la regla de hoy (`sceneFolder`,
   `locationFolder`); la de un episodio, desde su fila. Sigue pidiendo ver el proyecto entero (G1).
4. **La ruta.** Arriba del título (`PageHeader` en `src/ui/PageView.tsx`, con `headerPages` de `src/ui/titles.ts`), en
   las migas de la barra de arriba (`src/ui/Workspace.tsx`) y en los resultados de la búsqueda (`path` en
   `src/search/projectIndex.ts`), una ficha y lo de adentro muestran «Overview › Scenes › 105 › 027», no
   «1 | Preproducción › 1.1 | Desglose».
5. **Lo que vive en *Pages* se revela en *Pages*.** Una fila de *Shoot days* abre el reporte del día y lo muestra en
   el árbol: abre su semana, marca y centra la fila, sin plegar el resto (al revés que hoy). Una fecha con plan y sin
   reporte abre el plan. Abrir una ficha sigue plegando *Pages* (no tiene nada que mostrar ahí).
6. **Se saca *Overview › Scouting*** (pregunta 2 de la sección 10): repite `2 | Scouting Reports` uno a uno, y cada
   locación ya lista sus scoutings en su cabecera.
7. ***Move to…* y la papelera.** *Move to…* lista hoy todas las páginas del proyecto en el orden del árbol, sin mirar
   tipos (`src/ui/MoveDialog.tsx`): las fichas y sus carpetas pasan a un grupo «Overview» al final. Mover una página al
   primer nivel de una carpeta de escenas la vuelve escena (`placedEntity` en `entitySync.ts`), como hoy. Restaurar una
   ficha la devuelve a su carpeta: aparece en el Panorama.
8. **Invitados y links públicos.** Un invitado con permiso solo sobre una escena hoy la ve como raíz de *Pages* y sin
   ruta (`tree.ts`, el índice de hijos); con el punto 1 la ve solo en *Overview › Scenes*, que ya se arma con lo que ve.
   Un visitante de un link público no recibe los tipos (`plink_tree`) ni el Overview: ve el árbol como hoy.

## 5. Parte 2 — El plan y el reporte del día, juntos en Rodaje

Lo que hay: VLLF tiene 67 planes para 57 días (10 días con dos o más planes) y ERSO 35 para 33. **Todos** tienen su
marca propia (`settings.entity.kind = 'plan'`) y el puntero a su día (`settings.entity.day`), que dejó el reacomodo de
v0.276/v0.277. La marca de la página gana sobre la carpeta (`kind.ts`, `own` y `kindOf`): un plan con marca adentro de
una carpeta de días sigue siendo un plan y no un día. Por eso se pueden mudar sin tocar el lector.

1. **Dónde.** Cada plan pasa de `4 | Planeamiento › Semana NN` a la semana de su día en `Rodaje`, justo arriba de su
   reporte. Un plan sin día (una fecha que todavía no tiene reporte) va en la semana de su fecha, en su lugar por fecha.
   `4 | Planeamiento` vacía va a la papelera.
2. **Títulos (idea de Lega: el mismo nombre, uno dice Plan y el otro Reporte).** El plan toma el título de su día más
   « | Plan» (`2026-05-12 | Día 40 | 7 Puentes | Plan`); con varios planes, « | Plan · Casa Rosada», « | Plan · Driving
   Plates Puentes» (lo que agrega el título de Coda). El título viejo queda como subtítulo. En la barra, la fila del
   plan lleva su etiqueta PLAN. **El reporte no suma « | Reporte»:** con la etiqueta del plan ya se distinguen, y el
   sufijo rompería tres cosas de hoy: un reporte vacío deja de reusarse (`hasReportTitle` exige `fecha | Día NN` exacto,
   `isReusableReport` en `src/templates/dayReport.ts`), la fila de la barra toma «Reporte» como lugar cuando el título
   no nombra una locación conocida (`src/ui/datedTitle.ts`) y el reporte de mañana no lo copia (`nextDayTitle` en
   `tomorrowNew.ts`). Si Lega lo quiere igual, se enseñan esas tres antes de renombrar.
3. **Una red por si falta la marca.** En una carpeta de días, una página sin marca cuyo título termina en «Plan» (o
   *Day plan*) es un plan y no un día: si no, un plan creado a mano con fecha y jornada sería un segundo día con el mismo
   número y caería en *Pending › Merge*. Es un cambio del lector: después se sube `min_app_version`.
4. **Crear.** Hoy nada crea un plan: solo se leen (`planDay.ts`) o se marcan con *Type*. Al lado de *New day report*
   (`createDayReport` en `src/templates/dayReportCreate.ts`), ***New day plan***: crea el plan con la plantilla *Day
   plan* (que ya marca la página como plan), el puntero si el día ya existe y el título de arriba, en la semana, arriba
   de su reporte. La tarjeta *Tomorrow* suma *Plan tomorrow*. **El orden:** hoy un reporte nuevo va antes del primer
   reporte con fecha mayor (`placeBefore`), sin mirar los planes; con planes en la semana iría abajo de un plan de otra
   fecha. Pasa a ubicarse justo abajo del plan de su fecha, si hay, y si no antes del primer plan o reporte de una fecha
   mayor (lo mismo en *Create and prepare tomorrow's report*, `tomorrowNew.ts`).
5. **El día lo muestra.** La cabecera del día ya dice de dónde sale su plan; con los dos al lado, ↑ y ↓ pasan de uno al
   otro.

## 6. Parte 3 — *Overview › Shots*: la tabla de planos, en lugar de `BD Main`

- Una parte nueva del Panorama con su vista en el centro: **una fila por plano** de todas las escenas, leída de los
  planos adentro de cada página (título 1 «Planos»/«Shots» y un título 2 por plano con su tabla de dos columnas, D785;
  `shotSections` en `liveView.ts`) y de las fichas que sigan siendo subpáginas. Columnas: las de los campos que existan
  (*Shot Name*, escena, *Descripción*, *Decorado*, *Locación*, *Fecha Rodaje*, *INT/EXT*, *Consultas*, *Complejidad*,
  *Grupo*…), con filtro y orden, y los totales arriba (planos y escenas). Cada fila lleva al plano en su escena.
- **Solo lee.** No se escribe en la tabla: se escribe en la escena. *Copy* la copia como tabla para pegar en una
  planilla (presupuesto, vendors).
- La página `BD Main` va a `90 | Archivo` (fuera de las relaciones).

## 7. Parte 4 — VLLF y ERSO

Con las operaciones de la app, como el reacomodo de v0.276: prueba en seco sobre una copia del árbol (escenas
planeadas, filmadas y scouteadas por día y por escena, y el plan de cada día, antes y después; las diferencias en cero),
copia de seguridad, mover, esperar la sincronización y repetir la comparación sobre la base real. Registro para deshacer.

1. Los planes a `Rodaje` con sus títulos (parte 2); `4 | Planeamiento` a la papelera.
2. `BD Main` a `90 | Archivo` (en ERSO, `ERSO | BD Main` con sus 5 índices).
3. Nombres, en los dos: `1.2 | Locaciones y scoutings` → `1.2 | Locaciones` (los scoutings ya no están ahí);
   `5 | Rodaje` → `4 | Rodaje` y `6 | Tablas y referencia` → `5 | Referencia` (sin el número que deja libre
   Planeamiento). `1 | Preproducción` queda para notas y reuniones: sus tres carpetas siguen adentro, escondidas.
   VLLF: `3 | Pruebas` → `3 | Pruebas y previs`. ERSO no tiene pruebas: se crea `3 | Pruebas y previs` y entra
   `Previs Ambulancia` (hoy en Tablas); `2 | Scouting` → `2 | Scouting Reports`, como en VLLF.
4. Los títulos de las escenas de VLLF, según lo que diga Lega (pregunta 1).

## 8. Parte 5 — Ayuda, tutorial, documentos y versión

- Ayuda (`src/i18n/lazy/help.ts`): `pagesTree`, `pagesArrange`, `pagesKeys`, `pageTypes`, `relationsMap`,
  `scenesSection`, `dayReports` y `liveDay` (el plan al lado del reporte, *New day plan*, *Plan tomorrow*), y una entrada
  nueva para *Shots*. El tutorial no muestra la barra (revisado en `src/tutorial`): no cambia. `Doc_Logica.md`
  (secciones 1, 5 y 6), `Doc_Relaciones.md` (sección 22), `README.md` (cambia lo que ve un usuario).
- `min_app_version` se sube después de la parte 2 (cambia el lector). Las partes 1 y 3 no escriben nada nuevo.

## 9. Orden de trabajo

Cada parte sale entera (código, ayuda, pruebas), auditada por alguien que no la escribió, y publicada.

1. La barra (parte 1).
2. Plan y reporte juntos (parte 2) y su reacomodo en VLLF y ERSO (parte 4, puntos 1 y 3).
3. *Shots* (parte 3) y `BD Main` al Archivo.
4. Los títulos de las escenas de VLLF (parte 4, punto 4).

## 10. Preguntas que decide Lega

1. **Los títulos de las escenas de VLLF.** Hoy son el comienzo de la descripción del primer plano. Opciones: (a) armados
   solos con el decorado y el INT/EXT de sus planos (`059 | Puente Larralde · EXT`); (b) un nombre corto que escribe
   Lega; (c) dejarlos. Recomendada: a, y después cada uno lo cambia si quiere.
2. **¿Se saca *Overview › Scouting*?** Recomendado: sí (sección 4, punto 6).

Lo demás va como dice este plan salvo que Lega diga otra cosa: el plan con « | Plan» y el reporte sin sufijo (sección
5, punto 2), los nombres nuevos de las carpetas y la parte *Shots*.

## 11. Decisiones

- D813: la alternativa B (este plan).
