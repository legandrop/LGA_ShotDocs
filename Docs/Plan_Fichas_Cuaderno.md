# Plan: fichas en el Panorama, documentos en Páginas

Fecha: 2026-10-27. Pedido de Lega, que eligió la alternativa B de tres (A: el Panorama como lente sobre Páginas; C: un
Panorama que nunca se edita y todo lo escrito como documentos). Sigue a `Plan_Estructura_Etapas.md`, que dejó el árbol
por etapas (partes 1 a 4 hechas, v0.275 a v0.295); su parte 5 (`6 | Tablas y referencia` y lo suelto) queda adentro de
este plan. Auditado contra el código el mismo día (tres bloqueantes y once cambios, ya corregidos acá). **Estado
(2026-10-28):** Lega lo aprobó («Sí, arrancá») y salieron las partes 1 (v0.302), 2 (v0.303), 3 (v0.304) y la 4 en la
base; la simulación de punta a punta dio v0.305 y la auditoría final del plan, v0.306. **La parte 1 se deshizo en
v0.307 (D815):** al verla con VLLF, Lega no encontraba su preproducción y planteó lo correcto: se escribe en las
páginas y el Panorama se arma solo. Todas las páginas volvieron a *Pages* y el *Overview* es de solo lectura (una
locación o un decorado abre un resumen; su nombre, la página). Lo que sigue en las secciones 2 a 4 sobre «fichas en el
Panorama» queda como historia. Siguen valiendo las partes 2, 3 y 4. Queda la pregunta 1 (sección 10) y las propuestas
de la sección 12.

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
- **La parte 1 no escribe nada en la base.** Las carpetas de escenas, locaciones y decorados siguen siendo páginas
  donde están (`1 | Preproducción › 1.1 | Desglose`…); lo que cambia es dónde las muestra la barra. Una versión vieja
  las sigue mostrando en *Pages*: se ve distinto, no se pierde nada.
- **Lo que el Panorama no puede mostrar sigue en *Pages*.** Ninguna página queda sin lugar en la barra (sección 4,
  punto 1).

## 3. Cómo queda

```
PANORAMA (Overview)                       PÁGINAS (Pages)
  Scenes      fichas, por episodio          1 | Preproducción      notas, reuniones, guion técnico
  Locations   fichas                        2 | Scouting Reports   un reporte por recorrido
  Sets        fichas                        3 | Pruebas y previs   un reporte por prueba
  Shoot days  calendario → abre el día      4 | Rodaje
  Shots       tabla de planos (solo lee)        Planes por locación (varios días)
  Pending                                       Semana 08
                                                  2026-05-12 | Día 40 | 7 Puentes | Plan
                                                  2026-05-12 | Día 40 | 7 Puentes
                                            5 | Referencia
                                            90 | Archivo           BD Main, BD Main OLD…
```

## 4. Parte 1 — La barra: cada página en un solo lugar

> **Deshecha en v0.307 (D815).** Todas las páginas viven en *Pages*; el *Overview* es de solo lectura. Queda como
> historia de lo que se probó.

Hoy *Pages* solo esconde la papelera: las filas salen de `tree.roots` y `visibleRows` (`src/ui/Sidebar.tsx`;
`src/ui/treeNav.ts`), y *Templates* es una raíz más. Lo abierto desde el Overview pliega todas las carpetas, no abre las
madres ni centra la fila (`Sidebar.tsx`, `shutFor`, `collapseToBranch`, `follow`; `src/ui/sidebarRows.ts`,
`markOpenedFromOverview`, que vale 5 s).

1. ***Pages* esconde solo lo que el Panorama muestra.** Cada ficha que el Panorama lista (una fila de *Scenes*,
   *Locations* o *Sets*: el registro la reconoce por su número o su nombre, no está repetida y está dentro de las
   relaciones; `register.ts`) se esconde de *Pages* con todo lo de adentro. La carpeta de tipo y sus grupos de episodio
   se esconden solo cuando todo lo de adentro ya está en el Panorama. Lo demás sigue en *Pages* donde está: una escena
   sin número, la segunda página con el mismo número o nombre (*Pending* las une), lo que está fuera de las relaciones
   (una carpeta de entidades guardada en el Archivo), una subcarpeta con *None of these*. Vale también para una entidad
   marcada a mano en cualquier lugar y para la ficha que un invitado ve sola (hoy cae como raíz de *Pages*, `tree.ts`):
   la ve solo en el Panorama. Los días no se esconden: el reporte es lo que más se escribe y vive en `Rodaje`.
   - **Al arrancar**, hasta la primera foto de relaciones, *Pages* muestra todo como hoy: si no, las fichas no se verían
     en ningún lado durante ese rato (el Overview espera esa foto, `OverviewNav.tsx`).
   - La flecha de una carpeta (`1 | Preproducción`) cuenta solo los hijos que se ven (`treeNav.ts`).
   - El teclado como un solo árbol (`sidebarRows.ts`, `ROWS`) recorre lo dibujado: no cambia.
   - **Antes de publicar**, una pasada en seco sobre VLLF y ERSO lista lo que queda en *Pages* adentro de carpetas de
     fichas y comprueba que ninguna página quede sin lugar.
2. **Las fichas en el Panorama, con todo lo de *Pages*.** Una fila de *Scenes*, *Locations* o *Sets* abre la página de
   la ficha (la de la escena también: hoy abre la vista del mapa, `/map/scenes?scene=…`, que queda en la pestaña central
   *Scenes* con *N pages*). Si la ficha tiene subpáginas (un plano con comentarios que no se trajo, un anexo, un scouting
   o una prueba guardados adentro de su locación), la fila se despliega con el **mismo componente del árbol de *Pages***:
   menú ⋯, «+», renombrar, reordenar y arrastrar, ⌘/Ctrl+clic, los puntos de menciones (`mentionDots.tsx`) y el mismo
   teclado (D806). Cada parte tiene además un ⋯ para su carpeta (*Type*, *Share*, *Leave out of relations*).
3. **La fila se marca se abra como se abra.** Una ficha abierta por un link, la búsqueda, Atrás o un tab despliega su
   parte (y su episodio) y marca su fila, como hoy pasa solo con una escena abierta en el mapa
   (`OverviewNav.tsx`). Lo que vive en *Pages* (un día, un plan, un scouting) abierto desde el Overview se revela en
   *Pages*: abre su semana y centra la fila, sin plegar el resto (al revés que hoy).
4. **Crear desde el Panorama.** Un «+» en *Scenes* (y en cada episodio) pide el número y crea la escena con
   `createEntity.ts`, con todas sus guardas de hoy (red, índice completo, ver el proyecto entero, que el número no
   exista; con dos carpetas posibles, G5, pregunta en cuál en vez de no crear). *Locations* pide el nombre. *Sets* es
   nuevo en `createEntity.ts` (hoy solo crea escenas y locaciones). Así una ficha nunca nace sin número o sin nombre, que
   es lo que el Panorama necesita para mostrarla. Si el proyecto no tiene carpeta de ese tipo, hoy el botón queda
   apagado («Primero marcá una carpeta como Escenas»): pasa a crearla en la raíz («Scenes», «Locations», «Sets», con su
   tipo).
5. **La ruta.** Una ficha y lo de adentro muestran «Overview › Scenes › 105» en vez de «1 | Preproducción › 1.1 |
   Desglose» en todos los lugares que hoy usan la cadena de madres: el encabezado de la página (`PageHeader` en
   `src/ui/PageView.tsx`, con `headerPages` de `src/ui/titles.ts`), que **sale también en el PDF y la exportación**
   (`exportPages.ts`); las migas de la barra de arriba (`src/ui/Workspace.tsx`); los resultados de la búsqueda (`path` en
   `src/search/projectIndex.ts`, `ProjectSearch.tsx`); y los textos de «dónde se guarda» del formato y del encabezado
   (`PageFormatDialog.tsx`, `PageView.tsx`). En el PDF sale lo mismo que en pantalla.
6. **Se saca *Overview › Scouting*** (pregunta 2 de la sección 10): repite `2 | Scouting Reports` uno a uno, y cada
   locación ya lista sus scoutings en su cabecera. Hay que tener la respuesta antes de empezar esta parte.
7. ***Move to…* y la papelera.** *Move to…* lista hoy todas las páginas del proyecto, sin mirar tipos
   (`src/ui/MoveDialog.tsx`): suma un grupo «Overview» con **solo las fichas** (meter una página adentro de una la
   vuelve parte de ella). Nunca la carpeta de tipo ni un episodio: mover una nota ahí le escribe la marca de entidad
   (`placedEntity` en `entitySync.ts`) y, sin número, quedaría como escena rota. Restaurar una ficha de la papelera la
   devuelve a su carpeta y aparece en el Panorama.
8. **Links públicos.** Un visitante no recibe los tipos (`plink_tree`) ni el Overview: ve el árbol como hoy.

## 5. Parte 2 — El plan y el reporte del día, juntos en Rodaje

Lo que hay: VLLF tiene 67 planes para 57 días (10 días con dos o más planes) y ERSO 35 para 33. **Todos** tienen su
marca propia (`settings.entity.kind = 'plan'`) y el puntero a su día (`settings.entity.day`), que dejó el reacomodo de
v0.276/v0.277. Ningún título de día de los dos proyectos tiene una parte «Plan» (revisado en la base).

**El lector ya los entiende:** un plan con marca adentro de una carpeta de días sigue siendo plan (`entityMark` lo lee
`'other'`, `own` da `null` y `kindOf` lo toma por su marca de documento; `kind.ts`). **Pero hay código que busca los
reportes por la fecha al principio del título** y confundiría un plan con el reporte. Hay que arreglarlo antes de mudar
nada:

- ***New day report*** (`src/templates/dayReportCreate.ts`) toma como reportes los hermanos con fecha al principio del
  título y copia los datos del último: sería el plan de mañana (la plantilla *Day plan* tiene Fecha / Día / Locación).
  Propondría un número de día de más y copiaría del plan la unidad, el equipo y la cámara; el globito diría que el
  reporte de esa fecha «ya existe», señalando al plan (`DayReportPopover.tsx`).
- ***Tomorrow*** (`src/relations/tomorrowNew.ts`, `reportsOnDate`) también busca por fecha en el título: *Prepare
  tomorrow's report* escribiría las secciones de escenas **adentro del plan**, y la lógica de dos reportes del mismo día
  podría mandar a la papelera el reporte nuevo a favor del plan.
- **El orden** (`placeBefore`): un reporte nuevo va antes del primer reporte con fecha mayor, sin mirar los planes.

Las tres pasan a ignorar los planes. Después:

1. **Dónde.** Cada plan pasa de `4 | Planeamiento › Semana NN` a la semana de su día en `Rodaje`, justo arriba de su
   reporte. Los 4 planes de varias fechas de VLLF (`6 | Tablas y referencia › Planes por locación (varios días)`, sin
   marca) van al principio de `Rodaje`, en esa carpeta marcada como de planes: son planes de su locación, no de un día.
   `4 | Planeamiento`, vacía, va a la papelera.
2. **Títulos (idea de Lega: el mismo nombre, uno dice Plan y el otro Reporte).** El plan toma el título de su día más
   « | Plan» (`2026-05-12 | Día 40 | 7 Puentes | Plan`); con varios planes, « | Plan · Casa Rosada», « | Plan · Driving
   Plates Puentes» (lo que agrega el título de Coda). El título viejo queda en el registro para deshacer, no como
   subtítulo (D793 sacó los que repetían el título). En la barra, la fila del plan lleva su etiqueta PLAN.
   **El reporte no suma « | Reporte»:** con la etiqueta del plan ya se distinguen, y el sufijo rompería tres cosas de
   hoy: un reporte vacío deja de reusarse (`hasReportTitle` exige `fecha | Día NN` exacto, `isReusableReport` en
   `src/templates/dayReport.ts`), la fila de la barra muestra «Reporte» como lugar cuando el título no nombra una
   locación conocida (`src/ui/datedTitle.ts`), y ni *New day report* ni *Tomorrow* lo ponen, así que los títulos
   quedarían mezclados. Si Lega lo quiere igual, se enseñan esas tres antes de renombrar.
3. **Una red para el plan escrito a mano.** Al confirmar el título de una página nueva en una carpeta de días, la app le
   escribe la marca de día (`entitySync.ts`); desde ahí la marca gana. Un plan escrito a mano con fecha y jornada sería
   entonces un segundo día con la misma fecha: no cae en *Merge* (`dayTwins` agrupa títulos idénticos) sino en algo peor
   y callado («Same day», sus secciones contadas como filmadas, los planes de esa fecha empatados). La red va en
   `context()` de `kind.ts`, para que no se escriba la marca de día: en una carpeta de días, una página con una parte
   del título que es «Plan» o empieza con «Plan ·» es un plan, y al confirmar el título recibe la marca de plan. Una
   locación que se llame «Plan…» es un riesgo bajo; la parte tiene que ser entera.
4. **Crear.** Hoy nada crea un plan: solo se leen (`planDay.ts`) o se marcan con *Type*. Al lado de *New day report*
   (`createDayReport`), ***New day plan***: crea el plan con la plantilla *Day plan* (que ya marca la página como plan),
   el puntero si el día ya existe y el título de arriba, en la semana, arriba de su reporte. La tira de plantillas de
   una carpeta de días suma *Day plan* (hoy solo ofrece *On-Set Report*, `stripKinds.ts`). La tarjeta *Tomorrow* suma
   *Plan tomorrow*. Un reporte nuevo va justo abajo del plan de su fecha, si hay, y si no antes del primer plan o
   reporte de una fecha mayor (también *Create and prepare tomorrow's report*).
5. **Uno al lado del otro.** En la barra, con el foco en el árbol, ↑ y ↓ pasan del plan al reporte (no son atajos
   nuevos: es el árbol de siempre). La cabecera del día ya dice de dónde sale su plan.
6. **Permisos.** Siguen el árbol: un permiso sobre `Rodaje` pasa a cubrir los planes, y uno sobre `4 | Planeamiento`
   deja de cubrirlos. Va en la ayuda de *Share*.
7. **Cambia una decisión anterior.** `Plan_Estructura_Etapas.md` (decisión 3) deducía el tipo de documento de la
   carpeta; los planes en Rodaje dependen de su marca propia (la carpeta dice «días»). Es parte de D813 (sección 11) y
   va a `Doc_Logica.md`, sección 2, cuando se implemente.

## 6. Parte 3 — *Overview › Shots*: la tabla de planos, en lugar de `BD Main`

- Una vista en el centro, como *Pending*: sin lista en la barra (la barra no tiene el contenido de las páginas). **Una
  fila por plano** de todas las escenas, armada con lo que el índice ya tiene en memoria (`projectIndex.ts`): los planos
  adentro de cada página (título 1 «Planos»/«Shots» y un título 2 por plano con su tabla de dos columnas, D785;
  `shotSections` y el reparto por bloque de `sceneLive` en `liveView.ts`) y las fichas que sigan siendo subpáginas.
  Columnas: las de los campos que existan (*Shot Name*, escena, *Descripción*, *Decorado*, *Locación*, *Fecha Rodaje*,
  *INT/EXT*, *Consultas*, *Complejidad*, *Grupo*…), con filtro y orden, y los totales arriba (planos y escenas). Cada
  fila lleva al plano en su escena.
- Es una pasada lineal (unos 260 planos en VLLF: milisegundos), guardada por foto de relaciones como `setIndex`.
  Mientras el índice lee, dice *Reading…* (`relationIndex.ts`).
- **Solo lee.** No se escribe en la tabla: se escribe en la escena. *Copy* la copia como tabla para pegar en una
  planilla (presupuesto, vendors).
- La página `BD Main` va a `90 | Archivo` (fuera de las relaciones): deja de aparecer en *Other* y *Also named in*.

## 7. Parte 4 — VLLF y ERSO

Recién después de publicar la parte 2 y subir `min_app_version` (las versiones abiertas hoy, 0.295 a 0.300, tienen el
problema de *New day report* y *Tomorrow* apenas los planes están en Rodaje). Con las operaciones de la app, como el
reacomodo de v0.276, y registro para deshacer.

**Prueba en seco**, sobre una copia del árbol, antes y después, con las diferencias en cero o explicadas una por una:

- Que cada plan a mover tenga la marca de plan (uno sin marca, con fecha y jornada, recibiría la de día al moverlo).
- La lista de días, la locación de cada día, las fechas planeadas, el plan de cada día y las escenas planeadas,
  filmadas y scouteadas por día y por escena.
- *Pending*: días repetidos y planes sin día.
- El orden en la barra de cada semana.
- *New day report* y *Tomorrow* simulados sobre la última semana de cada proyecto.
- Diferencias esperadas: `Previs Ambulancia` pasa a ser una prueba y `BD Main` sale de *Other* / *Also named in*.

Después: copia de seguridad, mover, esperar la sincronización y repetir la comparación sobre la base real.

1. Los planes a `Rodaje` con sus títulos (parte 2): el del día con « | Plan». Lo que el título viejo decía y el del
   día no (el lugar planeado, «SIN VFX», «ESMA Salon Dorado») queda como « · nota» («… | ESMA | Plan · ESMA Salon
   Dorado»), así no se pierde nada del nombre; dos planes del mismo día se distinguen igual. `4 | Planeamiento` (con
   sus semanas: 16 carpetas, todas sin contenido, medido en la base) a la papelera.
2. `BD Main` a `90 | Archivo` (en ERSO, `ERSO | BD Main` con sus 5 índices).
3. Nombres, en los dos: `1.2 | Locaciones y scoutings` → `1.2 | Locaciones` (los scoutings ya no están ahí);
   `5 | Rodaje` → `4 | Rodaje` y `6 | Tablas y referencia` → `5 | Referencia` (sin el número que deja libre
   Planeamiento). `1 | Preproducción` queda para notas y reuniones: sus tres carpetas siguen adentro, escondidas.
   VLLF: `3 | Pruebas` → `3 | Pruebas y previs`. ERSO no tiene pruebas: se crea `3 | Pruebas y previs` y entra
   `Previs Ambulancia` (hoy en Tablas); `2 | Scouting` → `2 | Scouting Reports`, como en VLLF. Renombrar no rompe
   nada: los punteros y los links son por id, y los títulos de carpeta solo se leen para episodios y grupos de días.
4. Los títulos de las escenas de VLLF, según lo que diga Lega (pregunta 1).

## 8. Parte 5 — Ayuda, tutorial, documentos y versión

- Ayuda (`src/i18n/lazy/help.ts`): `pagesTree`, `pagesArrange`, `pagesKeys`, `pagesExpand`, `pageTypes`,
  `relationsMap`, `scenesSection`, `findPage`, `trash`, `share`, `templates`, `dayReports` y `liveDay` (el plan al lado
  del reporte, *New day plan*, *Plan tomorrow*), y *Shots* (quedó adentro de `relationsMap`, la del Overview, junto
  a las otras vistas, con sus palabras de búsqueda: *shots*, *planos*, *bd main*).
- Tutorial: el paso `pages` apunta al árbol (`src/tutorial/steps.ts`, ancla `pages` de `Sidebar.tsx`): se revisa su
  texto (`tour.pages.*` en `src/i18n/lazy/tutorial.ts`).
- Documentos: `Doc_Logica.md` (secciones 1, 2, 5 y 6), `Doc_Relaciones.md` (secciones 11 y 22), `Doc_Plantillas.md`
  (sección 6, *New day report*) y `README.md` (cambia lo que ve un usuario).
- `min_app_version`: se sube después de publicar la parte 2 (cambia el lector y lo que ignora *Tomorrow*) y **antes**
  de mover los planes (parte 4). Las partes 1 y 3 no escriben nada nuevo.

## 9. Orden de trabajo

Cada parte sale entera (código, ayuda, pruebas), auditada por alguien que no la escribió, y publicada.

1. Con la respuesta a la pregunta 2: la barra (parte 1), con su pasada en seco de lo que queda en *Pages*. **Hecha
   (v0.302).** Pasada en seco sobre la base (2026-10-28): ERSO 226 escenas, 52 locaciones y 136 decorados; VLLF 142,
   45 y 66. En las dos, ninguna página sin lugar, y *Pages* esconde `1.1 | Desglose`, `1.2 | Locaciones y scoutings` y
   `1.3 | Decorados` (en ERSO también los cinco episodios), a los que se llega con el ⋯ de su parte o episodio.
2. El código del plan y el reporte juntos (parte 2): las tres funciones que ignoran planes, la red, *New day plan*,
   el orden. Publicar y subir `min_app_version`. **Hecha (v0.303).**
3. El reacomodo de VLLF y ERSO (parte 4, puntos 1 a 3). **Hecho (2026-10-28, con `min_app_version` 0.303):** 117
   operaciones en una sola transacción, cada una con la fila como estaba; después, las 117 en la base tal cual, ninguna
   otra página cambiada y la pasada de la barra igual (ninguna página sin lugar, mismas fichas). El contenido de las
   páginas no se tocó.
4. *Shots* (parte 3). **Hecha (v0.304).**
5. La simulación de punta a punta (2026-10-28): un proyecto nuevo armado solo con la interfaz, sobre el servidor en
   memoria (`src/dev/simulacion.html`, sin tocar la base): página a página, scouting de director y técnico de la misma
   locación, una prueba, consultas por departamento, plan y reporte de dos días y la mirada de post desde la escena.
   Desde la escena se llega con un clic a su desglose, sus scoutings, su plan y la sección exacta del reporte. Lo que
   cortaba la cadena se arregló en v0.305 (sección 12).
6. Los títulos de las escenas de VLLF (parte 4, punto 4).

## 10. Preguntas que decide Lega

1. **Los títulos de las escenas de VLLF.** Hoy son el comienzo de la descripción del primer plano. Opciones: (a) armados
   solos con el decorado y el INT/EXT de sus planos (`059 | Puente Larralde · EXT`); (b) un nombre corto que escribe
   Lega; (c) dejarlos. Recomendada: a, y después cada uno lo cambia si quiere.
2. **¿Se saca *Overview › Scouting*?** Recomendado: sí (sección 4, punto 6). **Respondida: sí** (Lega, 2026-10-27).
   Hecho en v0.302.

Lo demás va como dice este plan salvo que Lega diga otra cosa: el plan con « | Plan» y el reporte sin sufijo (sección
5, punto 2), los nombres nuevos de las carpetas, la ruta «Overview › …» también en el PDF y la parte *Shots*.

## 11. Decisiones

- D813: la alternativa B (este plan). Incluye que los planes en Rodaje se reconocen por su marca propia (sección 5,
  punto 7).
- D814: el lugar en el título de un día nuevo es el que se escribió o el del plan de esa fecha, nunca la locación de
  ayer que el globito propone y nadie tocó (sección 12).

## 12. Lo que encontró la simulación

**Arreglado en v0.305:** la fecha planeada de la plantilla *Scene* no se leía (*Tomorrow* decía «0 scenes»); los días
nuevos se titulaban sin el lugar y el día quedaba sin locación en todo el Overview (D814); *New day report* desde una semana
creaba el día afuera de la semana (ahora una página con nombre de semana o bloque, `Semana 2`, es la carpeta; `Call
sheets` no), y desde un plan no proponía sus datos; el primer día de una semana nueva sigue el número y lo de ayer de las
semanas de antes; las secciones de mañana iban al final del
reporte; `/e 001` sin carpeta de escenas decía «No items found»; *Move to…* no ofrecía la carpeta de escenas a una página
con número; la cabecera contaba solo la primera consulta de la sección *Questions*; la ayuda tenía el Overview bajo
«Find and replace»; el mapa no ponía su nombre en la pestaña y *Locations* vacío decía «Nothing pending».

**No es de la app:** «Only people who see the whole project…» al dueño era del arnés (el servidor de prueba arrancaba sin
las reglas de equipo); las fotos sin contar en las cabeceras eran porque el arnés no tiene Drive (las fotos quedan
`sdfile://` y las cabeceras cuentan `sdmedia://`; en Wanka, con Drive, sí cuentan).

**Para decidir con Lega (propuestas, no hechas):**

1. **Un tipo para la preproducción.** «Página a página» y las notas de `1 | Preproducción` caen en *Other | Also named
   in* de cada escena. Propuesta: *Type › Pages created inside are: Pre-production notes*, y esas páginas van al renglón
   *Preproduction* de la cabecera.
2. **Las secciones de hoy.** Un reporte con un plan del mismo día que nombra escenas nace sin sus secciones (la cabecera
   las marca *PLANNED · NO SECTION*). Propuesta: *Add planned sections* en la cabecera del día, como *Prepare tomorrow's
   report* pero para hoy.
3. **Las consultas juntas.** Las preguntas de un scouting que nombran una escena no llegan a la escena, los comentarios no
   aparecen en ninguna cabecera y *Pending* no lista lo que falta responder. Propuesta: *Overview › Questions*, las
   consultas abiertas de todo el proyecto por escena y departamento.
4. **Las fotos sin Drive.** En un workspace sin Drive conectado las fotos no cuentan en las cabeceras. Propuesta: que
   cuenten igual (hoy solo le pasa a quien no conectó Drive).
5. **Detalles al escribir:** Enter al final de una *Question* deja un párrafo común (para otra pregunta hay que volver a
   escribir `/question`), y la cabecera crece en vivo mientras se escribe una consulta y corre el texto.
