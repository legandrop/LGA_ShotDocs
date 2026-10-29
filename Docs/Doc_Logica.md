# La lógica de LGA Shot Docs, de una sola lectura

Cómo piensa la app (v0.308): qué es cada página, cómo se da cuenta sola de qué escena, locación, decorado o día nombra
cada una y qué muestra con eso. El detalle técnico está en los documentos de la sección 8. Ante una duda, manda el
código (`src/relations/`).

## 1. Todo es una página

Un proyecto es un árbol de páginas sin límite de profundidad: cada página puede tener texto y otras páginas adentro, y
una **carpeta es una página sin texto**. Cada **proyecto** (una serie, un largo) tiene su árbol, y cada **workspace** es
una isla con su servidor y su Drive.

Lo que la app sabe de una página no se escribe en su texto: hay dos marcas en sus ajustes (`settings.entity`, qué es;
`settings.holds`, qué se crea adentro) y lo demás, quién nombra a quién, **se arma en el dispositivo con las páginas que
la persona ve** y se rearma al escribir. *Leave out of relations*, en el menú ⋯, saca una rama del cálculo (D540).

**Dónde se ve cada página (D815).** La barra tiene dos partes. *Pages* (*Páginas*) es **todo lo que se escribe**, por
etapa: la preproducción (`1.1 | Escenas`, una página por escena, y `1.2 | Locaciones`, con los decorados adentro de
cada locación; notas y reuniones), los
scoutings, las pruebas, cada semana de rodaje con el plan y el reporte de cada día, la referencia. El *Overview*
(*Panorama*) **no tiene páginas propias y no se edita**: junta lo que dicen esas páginas, y cada escena, locación o
decorado abre un resumen con links a cada página que habla de eso. Cada página vive en un solo lugar: *Pages*. (La v0.302
había pasado las escenas, locaciones y decorados al *Overview*, D813 parte 1; Lega lo vio con VLLF y no tenía sentido:
el Panorama tiene que armarse solo, D815.) Un proyecto nuevo arranca con esas carpetas vacías (D817), y las carpetas
de Escenas y Locaciones muestran arriba *New scene* / *New location* y una tabla armada sola (D818).

**En términos simples:** no es una base de datos con columnas. Es un cuaderno que la app lee como una persona atenta, y
con lo que lee arma índices que se actualizan solos.

## 2. Los tipos de página

**Entidades**, las cosas a las que se linkea:

- **Escena** (*Scene*): una escena del guion con su número (`105_027` en una serie, `074` en un largo).
- **Locación** (*Location*): el lugar físico donde se filma, el que se scoutea (`CENADE`, `Palomar`).
- **Decorado** (*Set*): el lugar de la historia (`Ambulancia | Ruta INT`). Se puede filmar en varias locaciones y una
  locación aloja varios (entidad desde v0.294, D804). Desde v0.308 (D818) su página vive **adentro de su locación** (*New
  set* en la cabecera de la locación, o *Create page* desde la escena que lo nombra) y se filma ahí; mover una página
  no le cambia el tipo (se marca antes de moverla).
- **Día de rodaje** (*Shoot day*): una jornada, por su fecha (`2026-02-19 | Día 59`). Su página es el reporte del día.

**Documentos**, lo que se escribe en una etapa: **scouting** (*Scouting report*), **prueba** (*Test report*, puede no
tener fecha) y **plan de jornada** (*Day plan*). Un documento no es algo a lo que se linkea: nombra entidades y dice en
qué etapa se las nombró (lo que nombra un scouting está scouteado; un plan, planeado; un reporte del día, filmado). Por
eso vive donde la persona quiera y se conecta por su contenido, no por estar adentro de una locación o un día (D778,
D780).

**Parte de**: una página sin marca adentro de una entidad es parte de ella. Las fichas `ERSO_105_027_010` adentro de la
escena `105_027` son suyas (nunca otra escena, aunque tengan número), y las fotos adentro de un día, de ese día. Un
documento que quedó adentro de una entidad también sigue siendo de ella.

**Nada**: una nota, una reunión, una tabla de referencia. Lo que nombra cuenta igual, en *Other* (*Otras*) de la escena
y en *Also named in* (*También la nombran*) de la locación. Las plantillas nunca son de ningún tipo.

**Cómo se marca.** Con *Type* (*Tipo*), en el menú ⋯ de cualquier página: *This page is* marca esa página y *Pages
created inside are* marca una carpeta, que muestra su rótulo (SCENES, LOCATIONS, SETS, SHOOT DAYS, SCOUTING, TESTS,
PLANS). Las plantillas *Scene*, *Location*, *Tech scout*, *Creative scout*, *Test report* y *Day plan* marcan la página
que crean. Para saber qué es una página, la app sube por el árbol y **gana lo más cercano**:

1. La marca de la página; *None of these* (*Nada de esto*) gana sobre la carpeta.
2. Una carpeta de entidades marca su primer nivel. Un episodio (`105`, `EP 105`) es un grupo de escenas; en una de
   días, una página sin fecha ni número de día (`Semana 03`) es un grupo, y adentro es día lo que tiene fecha **y**
   número de día, o un reporte.
3. Subiendo, si aparece primero una entidad, la página es parte de ella; si aparece una carpeta de documentos, es ese
   documento **a cualquier profundidad** (`Planes por locación › Palomar › plan`).

La marca de documento no se escribe en cada página: mover un plan de carpeta le cambia el tipo. Sacar una entidad de su
carpeta no le quita la marca. Una carpeta de días es la carpeta de reportes del día: marcar una marca la otra.

**Los planes al lado de su reporte (v0.303, D813).** Desde la parte 2 de `Plan_Fichas_Cuaderno.md` el plan de cada día
puede vivir en la carpeta de días, justo arriba de su reporte (`2026-05-12 | Día 40 | 7 Puentes | Plan`). Ahí la
carpeta dice «días», así que el plan se reconoce **por su marca propia** (`entity.kind = 'plan'`, la escriben *New day
plan*, la plantilla *Day plan* y el reacomodo) y, sin marca, por una parte del título que es «Plan» o «Plan · …» (la
red de `kind.ts`; al confirmar el título recibe la marca de plan, nunca la de día). Esto invierte, para los planes en
Rodaje, la decisión 3 de `Plan_Estructura_Etapas.md` (el tipo de documento sale de la carpeta). *New day report*,
*Tomorrow* y el orden de la carpeta saltean los planes (`isDayPlanRow`).

| Tipo | Qué es | Cómo se marca | Dónde aparece |
|---|---|---|---|
| Escena | Una escena, con su número | Carpeta *Scenes*, *Type › Scene* o plantilla *Scene* | Cabecera propia, *Overview › Scenes* |
| Locación | El lugar físico | Carpeta *Locations*, *Type › Location* o plantilla *Location* | Cabecera, *Overview › Locations* |
| Decorado | El lugar de la historia | Adentro de su locación (*New set*), carpeta *Sets* o *Type › Set* | Cabecera, *Overview › Sets* |
| Día de rodaje | Una jornada: su reporte | Carpeta *Shoot days*, *On-Set Report* o *New day report* | Cabecera, *Overview › Shoot days* |
| Scouting | Un recorrido | Carpeta *Scouting reports*, *Tech scout* o *Creative scout* | Sus locaciones y escenas, *Overview › Scouting* |
| Prueba | Una prueba | Carpeta *Test reports* o plantilla *Test report* | Sus locaciones y escenas, *Overview › Scouting* |
| Plan de jornada | Lo previsto para un día | Carpeta *Day plans*, plantilla *Day plan* o *New day plan* (al lado de su reporte) | Su día y sus escenas, *Overview › Shoot days* |
| Parte de | Fichas, fotos, anexos | Estar adentro de una entidad | La cabecera de su entidad |
| Nada | Notas, tablas, referencia | Sin marca, o *None of these* | *Other* / *Also named in* |

**En términos simples:** las entidades son los sustantivos del proyecto (qué escena, dónde, cuándo); los documentos, los
informes de cada etapa que hablan de ellos. La carpeta dice de qué tipo es lo de adentro; las conexiones salen de lo
escrito.

## 3. Cómo reconoce la app las relaciones

La app lee cada página como la búsqueda (el **índice**, en el dispositivo, también sin red) y anota qué entidades nombra
cada bloque: en un **título de sección** (lo de abajo, fotos incluidas, es de esa entidad), en el **texto** o con un
**link** (la señal más fuerte). También lee **campos** «rótulo: valor»: una tabla de dos columnas (como las fichas de
Coda), un título como *Consultas* con su texto abajo o un renglón `Locación: CENADE` (rótulos en `fields.ts`).

**Escena.**

- Su número sale del título de su página: completo al principio (`105_027 | título`), corto como primera parte con el
  episodio de la carpeta (`027 | título` adentro de `105`) o completo como última parte (`027 | título | 105_027`).
- Un título de sección que la nombra (`Escena 105_027`) abre su sección: así un reporte se reparte entre sus escenas
  sin cortarlo.
- En el texto cuentan las formas fuertes (`105_027`, `105-027`, `5027b`, `ERSO_105_027_010`) y «Escena 27» dentro de
  su episodio, no años ni horas. `/e 027` lo deja como link.

**Locación.**

- Su nombre es el título entero de su página, y cada parte si lo separan ` / ` o ` | `; un paréntesis nunca cuenta.
- *Otros nombres* (un renglón `Otros nombres: Arenera, Estudio Autos` en su página): uno de dos palabras o más cuenta
  en cualquier texto; uno de una palabra, o común como «Estudio», solo donde se espera un lugar, el **título de un día**
  y el **campo *Locación***. Un nombre que escriben dos locaciones no cuenta para ninguna.
- El lugar de un día es el que nombra **su título** (D398); si no nombra ninguno, *Link to a location…* lo arregla.
- Un scouting o una prueba es de las locaciones de su campo *Locación* (link o nombre), de su título y de sus títulos de
  sección que son exactamente una locación (un recorrido cuenta para cada lugar). Un link en el cuerpo solo la nombra.
- Una escena está planeada en las locaciones que nombra su desglose (ella y sus fichas).

**Decorado: solo por campo o por link**, nunca por texto suelto. Lo nombra el valor entero de un campo *Decorado*,
*Locación Guion* o *Set* igual a su título o a uno de sus *Otros nombres*, o un link a su página; «Comedor» en una
oración chocaría con locaciones y palabras comunes. Sus escenas: las que lo nombran así (o sus fichas) y las que nombra
su página. Dónde se filma: la locación de arriba (si vive adentro de una), su campo *Locación*, o una locación que lo
nombra en su campo *Decorado*.

**Día y plan.**

- Una escena está **filmada** un día si el reporte tiene una sección suya con algo escrito o fotos, **preparada** si
  la sección está vacía, y solo **nombrada** si aparece en el texto.
- Plan → día, en orden: el puntero que dejó el reacomodo de ERSO y VLLF; un campo *Día* con link al día; la fecha y la
  jornada del título o de los campos *Fecha* y *Día* (`D03_26.03.25_Palomar`: jornada 3, 25 de marzo de 2026). Se
  conecta si las dos apuntan al mismo día, o si hay una sola y el día es único; dos días de la misma fecha los desempata
  la unidad (U1, U2). El año sale de los días vecinos, no se inventa.
- Un plan con varias fechas (`Plaza de Mayo | 21 Mar | 2,3,4,11 Abr`) es de su locación, no de un día. Una fecha con
  plan y sin reporte figura como planeada, y se conecta sola cuando se crea el reporte.
- Un día sin plan toma como planeadas las escenas cuyas fichas dicen esa fecha en *Fecha Rodaje*.

**Lo que no se reconoce.** El texto suelto como decorado; los nombres de archivo; las plantillas; la papelera; lo que
está fuera de las relaciones; las páginas que la persona no ve (un invitado lee «en las páginas que ves», nunca «no
existe»). Las **páginas índice**, que nombran más de 20 escenas y locaciones (`BD Main`), van plegadas al final, sin
extractos ni fotos, y no aportan locaciones a un scouting ni decorados.

**Lo ambiguo no se adivina: va a *Overview › Pending*** (*Pendientes*): números de escena que no existen, escenas en dos
páginas o dos reportes con el mismo título (*Merge…*), secciones con fotos y sin número (*Assign*), planes cuya fecha y
jornada se contradicen o empatan (con sus candidatos) y escenas con sus planos todavía como subpáginas.

**En términos simples:** la app conecta solo lo escrito de forma inequívoca. Cuando duda no inventa: lo deja en
*Pending* para que una persona decida.

## 4. La cabecera viva

Arriba de cada entidad, entre el título y el texto, la app arma una cabecera con el índice. No es parte de la página: no
se edita, no se guarda ni se imprime, y cada link lleva al lugar exacto, abierto y resaltado. Se pliega a un renglón (en
el teléfono arranca así). Los documentos no tienen cabecera: aparecen en las de sus entidades.

- **Escena**: el episodio, INT/EXT y las otras formas en que se la escribe; después un renglón por etapa y tipo
  (D783, D784): *Preproduction | Set*, *Location* y *Open questions*; *Scouting | Reports*; *Tests | Reports*;
  *Planning | Day plan*; *Shoot | Reports*, un día por renglón con secciones y fotos; y *Other*. Ofrece *Bring them into
  this page…* si sus fichas son subpáginas, y *Merge…* si el número está en dos páginas.
- **Locación**: *Planned here* (las escenas que planea su desglose), sus scoutings y pruebas, *Sets*, *Where* (las
  primeras coordenadas escritas en ella o en sus scoutings) y los días cuyo título la nombra, con lo filmado ahí.
- **Decorado**: sus otros nombres, *Shot at* (sus locaciones), sus escenas con los días en que se filmaron y las páginas
  que lo nombran en su campo. Sin etapas ni fotos propias: eso está en cada escena.
- **Día**: la fecha, su locación, el día anterior y el siguiente; las escenas del día con su estado (*shot*, *prepared*,
  *planned*), las preguntas abiertas de sus fichas y de dónde sale el plan. Y la tarjeta *Tomorrow* (*Mañana*), con
  *Prepare tomorrow's report*: lo único de las relaciones que escribe en una página. Agrega en el reporte siguiente un
  título `Escena 105_029` por cada escena sin sección, sin borrar ni reemplazar nada: después de las secciones de escena
  que ya tiene o, si no tiene, después de su primera sección (el *Summary*), no al final (`sectionsSpot`, v0.305).

## 5. El Overview (Panorama)

El *Overview* (*Panorama*) es el mapa del proyecto, armado con lo que la persona ve; **no se edita** (D815). Está en la
barra lateral, arriba de *Pages* (*Páginas*), y en una vista grande en el centro. Sus partes:

- ***Locations***: cada locación en el tiempo, un punto por día cuyo título la nombra (lleno si el reporte tiene algo).
  En la barra, cada una abre su resumen: la cabecera de su página (planeada acá, scoutings, días de rodaje), con links,
  y su nombre arriba abre la página en *Pages*.
- ***Sets***: los decorados por nombre, con sus escenas y dónde se filman; cada uno abre su resumen, igual.
- ***Scenes***: por episodio, con sus locaciones y sus días; abrir una muestra todas las páginas que hablan de ella, con
  los renglones por etapa de la cabecera (desglose, scouting, plan, rodaje, otras).
- ***Shoot days***: cada día con su locación, sus escenas y su plan; una fecha con solo plan figura como planeada. En la
  barra, cada día abre su página, que se ve en *Pages*, en su semana.
- ***Shots*** (D813, v0.304): una fila por plano de todas las escenas con los campos de su desglose, ordenable y para
  copiar a una planilla. Reemplaza a `BD Main`, que se mantenía a mano: se escribe en la escena, la tabla solo lee.
- ***Pending***: lo ambiguo de la sección 3, con *Create*, *Assign*, *Merge* o *Bring them all in*.
- *Scouting* (cada scouting y prueba por fecha) sigue como pestaña del centro; en la barra ya no está, porque repetía
  `2 | Scouting Reports`.

En la barra, una parte vacía no aparece y se despliega una a la vez. La barra es **un solo árbol** (D805 a D807): ↑ y
↓ recorren el *Overview* y siguen en *Pages*, con partes y episodios como carpetas y filas como páginas. Al abrir una
página queda abierto solo el camino hasta ella, con su fila centrada; una vista del *Overview* pliega *Pages*, y un día
abierto desde *Shoot days* se ve en su semana. Las escenas, locaciones y decorados se crean en *Pages* (el «+» de su
carpeta) o con `/e` y `/l`.

## 6. Cómo se cargan las cosas, por etapa

El árbol que se sugiere (`Plan_Estructura_Etapas.md`, sección 3). Nombres y orden son libres; cuenta el tipo de cada
carpeta.

```
1 | Preproducción          el desglose, las locaciones, los decorados, notas y reuniones
   1.1 | Desglose          Type › Scenes             una página por escena, sus fichas adentro
   1.2 | Locaciones        Type › Locations          una página por lugar físico
   1.3 | Decorados         Type › Sets               una página por decorado de guion
2 | Scouting Reports       Type › Scouting reports   un reporte por recorrido, por fecha
3 | Pruebas y previs       Type › Test reports       un reporte por prueba o previs
4 | Rodaje                 cada semana, Shoot days   el plan y el reporte de cada jornada, uno arriba del otro
   Planes por locación     Type › Day plans          los planes de una locación para varias fechas
5 | Referencia             sin tipo
90 | Archivo               Leave out of relations    lo viejo (BD Main: hoy es Overview › Shots)
```

**Notas.** Páginas libres, donde se quiera; lo que nombran va a *Other* y *Also named in*. Una nota adentro de una
escena es de su desglose.

**Desglose.** En una serie, una carpeta por episodio (`105`) y adentro cada escena (`027 | La camioneta frena` es
`105_027`), con la plantilla *Scene*. Las fichas van adentro de la escena (`ERSO_105_027_010`) o en su página, bajo un
título 1 *Planos* con un título 2 por plano (D785), con una tabla de dos columnas: *Shot Name*, *Decorado* (el nombre
exacto o un link), *Locación*, *Fecha Rodaje* (`06/03/2026`), *INT/EXT* y *Consultas*. De ahí salen el decorado, dónde
y cuándo está planeada y la pregunta abierta.

**Locaciones y decorados.** Una página por lugar, con su nombre canónico (`La Arenera (estudio)`), plantilla *Location*,
sus *Otros nombres* y sus coordenadas. Una página por decorado, con su nombre de guion y un campo *Locación* que diga
dónde se filma; las escenas lo nombran en su campo *Decorado*.

**Scouting.** En `2 | Scouting Reports`, plantilla *Tech scout* o *Creative scout*. La fecha al principio del título
(`26.01.29 | Scouting | Palomar`) o en *Fecha*; las locaciones en *Locación*, en el título o como títulos de sección,
uno por lugar con su nombre exacto.

**Pruebas.** En `3 | Pruebas y previs`, plantilla *Test report*, con *Fecha* (opcional) y *Locación*; las escenas, por número.

**Rodaje.** En `4 | Rodaje › Semana 03`, *New day report* crea el día con la forma de los otros y el lugar
(`2026-02-19 | Día 59 | CENADE`: la locación escrita o la del plan de esa fecha, nunca la de ayer sin tocar, D814; del
título lee la app dónde se filmó) y copia del anterior la unidad, el equipo y la cámara. Desde una semana nueva
(`Semana 04`, vacía) el día va adentro y sigue el número de las anteriores. Cada escena abre su sección
con `Escena 105_027` y lo filmado debajo; la primera sección sin número (*Info general*) es del día. La víspera,
*Prepare tomorrow's report* deja listos los títulos.

**El plan al lado del reporte (v0.303, D813).** En la misma semana, *New day plan* (la pestaña de al lado en el globito
de *New day report*, o el menú ⋯) o *Plan tomorrow* (la tarjeta *Tomorrow*) crean el plan del día justo arriba de su
reporte, con su mismo nombre y « | Plan», y la plantilla *Day plan* (*Fecha*, *Día*, *Locación*); las escenas, por
número. En la barra quedan uno arriba del otro, cada fila con su etiqueta PLAN o REPORT al principio (D815; un plan con
nota muestra la nota, «Casa Rosada», en lugar del lugar, que ya dice su reporte): ↑/↓ pasan del plan al reporte. Los planes de una locación para varias
fechas van en una carpeta de planes aparte (Type › Day plans), al principio de Rodaje. VLLF y ERSO se reacomodaron así
el 2026-10-28 (parte 4): `4 | Planeamiento` ya no existe (está en la papelera, vacía), y cada plan tomó el nombre de su
día con « | Plan» y, como nota, lo que su título viejo decía y el del día no (`… | ESMA | Plan · ESMA Salon Dorado`).

## 7. Lo que todavía no hace o está a medias

- *Copy overview* y *Copy JSON* (el mapa como texto) no llevan los decorados.
- No hay plantilla de decorado.
- La preproducción («Página a página», reuniones) no tiene tipo: lo que nombra una escena cae en su renglón *Other*.
  Esta y otras propuestas de la simulación, en `Plan_Fichas_Cuaderno.md`, sección 12.
- La locación de un día sale solo de su título (D398). Una carpeta de locaciones no tiene grupos: una subcarpeta queda
  locación (se corrige con *None of these*).
- *Read here*, leer en la escena la sección entera de un reporte, está diseñado y sin construir (R.6b).
- Un visitante de un link público no ve tipos ni cabeceras. Los permisos siguen el árbol: compartir una locación no
  alcanza a los scoutings de `2 | Scouting`.
- El resto, en `Doc_Roadmap.md`, grupo R.

## 8. Dónde seguir leyendo

- `Plan_Estructura_Etapas.md`: el árbol por etapas, los tipos, los links por contenido y las partes 1 a 5.
- `Doc_Estructura_Proyecto.md`: el método de partida (ES1 a ES10) y el «Tipo de página», con sus claves y reglas.
- `Doc_Relaciones.md`: el lector, el índice y los campos, las cabeceras, *Tomorrow*, el mapa, *Pending*, *Merge*.
- `Doc_Plantillas.md`: las plantillas de fábrica y propias, y *New day report*.
- `Doc_Decisiones.md`: las decisiones citadas (D398, D540, D778, D780, D783 a D785, D804 a D807).
- `Doc_Roadmap.md`: lo que falta, por importancia.
- La ayuda de la app (`src/i18n/lazy/help.ts`): cada función como la ve el usuario.
