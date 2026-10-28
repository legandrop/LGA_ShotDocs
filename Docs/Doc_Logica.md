# La lógica de LGA Shot Docs, de una sola lectura

Cómo piensa la app (v0.302): qué es cada página, cómo se da cuenta sola de qué escena, locación, decorado o día nombra
cada una y qué muestra con eso. El detalle técnico está en los documentos de la sección 8. Ante una duda, manda el
código (`src/relations/`).

## 1. Todo es una página

Un proyecto es un árbol de páginas sin límite de profundidad: cada página puede tener texto y otras páginas adentro, y
una **carpeta es una página sin texto**. Cada **proyecto** (una serie, un largo) tiene su árbol, y cada **workspace** es
una isla con su servidor y su Drive.

Lo que la app sabe de una página no se escribe en su texto: hay dos marcas en sus ajustes (`settings.entity`, qué es;
`settings.holds`, qué se crea adentro) y lo demás, quién nombra a quién, **se arma en el dispositivo con las páginas que
la persona ve** y se rearma al escribir. *Leave out of relations*, en el menú ⋯, saca una rama del cálculo (D540).

**Dónde se ve cada página (D813).** La barra tiene dos partes: el *Overview* (*Panorama*), con **las fichas** (cada
escena, locación y decorado es su página, con lo de adentro) y las vistas que arma la app; y *Pages* (*Páginas*), **el
cuaderno**: lo que se escribe en cada etapa (notas, scoutings, pruebas, planes y reportes, referencia). Cada página se
ve en un solo lugar: *Pages* no dibuja las fichas ni la carpeta de un tipo que solo tiene fichas. En la base no cambia
nada: las fichas siguen guardadas en sus carpetas (`1 | Preproducción › 1.1 | Desglose`), y lo que el *Overview* no
puede listar (una escena sin número, la segunda con el mismo número, lo que está fuera de las relaciones) sigue en
*Pages* con su carpeta (`overviewPlaces.ts`).

**En términos simples:** no es una base de datos con columnas. Es un cuaderno que la app lee como una persona atenta, y
con lo que lee arma índices que se actualizan solos.

## 2. Los tipos de página

**Entidades**, las cosas a las que se linkea:

- **Escena** (*Scene*): una escena del guion con su número (`105_027` en una serie, `074` en un largo).
- **Locación** (*Location*): el lugar físico donde se filma, el que se scoutea (`CENADE`, `Palomar`).
- **Decorado** (*Set*): el lugar de la historia (`Ambulancia | Ruta INT`). Se puede filmar en varias locaciones y una
  locación aloja varios (entidad desde v0.294, D804).
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
   documento **a cualquier profundidad** (`4 | Planeamiento › Semana 03 › plan`).

La marca de documento no se escribe en cada página: mover un plan de carpeta le cambia el tipo. Sacar una entidad de su
carpeta no le quita la marca. Una carpeta de días es la carpeta de reportes del día: marcar una marca la otra.

| Tipo | Qué es | Cómo se marca | Dónde aparece |
|---|---|---|---|
| Escena | Una escena, con su número | Carpeta *Scenes*, *Type › Scene* o plantilla *Scene* | Cabecera propia, *Overview › Scenes* |
| Locación | El lugar físico | Carpeta *Locations*, *Type › Location* o plantilla *Location* | Cabecera, *Overview › Locations* |
| Decorado | El lugar de la historia | Carpeta *Sets* o *Type › Set* | Cabecera, *Overview › Sets* |
| Día de rodaje | Una jornada: su reporte | Carpeta *Shoot days*, *On-Set Report* o *New day report* | Cabecera, *Overview › Shoot days* |
| Scouting | Un recorrido | Carpeta *Scouting reports*, *Tech scout* o *Creative scout* | Sus locaciones y escenas, *Overview › Scouting* |
| Prueba | Una prueba | Carpeta *Test reports* o plantilla *Test report* | Sus locaciones y escenas, *Overview › Scouting* |
| Plan de jornada | Lo previsto para un día | Carpeta *Day plans* o plantilla *Day plan* | Su día y sus escenas, *Overview › Shoot days* |
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
su página. Dónde se filma: su campo *Locación*, o una locación que lo nombra en su campo *Decorado*.

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
  *Prepare tomorrow's report*: lo único de las relaciones que escribe en una página. Agrega al final del reporte
  siguiente un título `Escena 105_029` por cada escena sin sección, sin borrar ni reemplazar nada.

## 5. El Overview (Panorama)

El *Overview* (*Panorama*) tiene **las fichas** y **las vistas**. Está en la barra lateral, arriba de *Pages*
(*Páginas*), y en una vista grande en el centro.

- **Las fichas** (D813): en la barra, ***Locations***, ***Sets*** y ***Scenes*** (por episodio) listan cada locación,
  decorado y escena **como su página**, con las mismas filas del árbol de *Pages*: un clic la abre, la flecha muestra lo
  de adentro, y tienen su ⋯ y su «+». La cabecera de la página (lo que arma la app) no se edita; lo de abajo (el
  desglose, la dirección, los otros nombres), sí. El «+» de cada parte pide el número o el nombre y la crea con las
  guardas de siempre; sin carpeta de ese tipo, la crea en la raíz con su tipo, y con dos posibles pregunta en cuál. La
  ruta de una ficha dice «Overview › Scenes», no las carpetas de *Pages* donde está guardada.
- **Las vistas** (no tienen páginas propias, llevan a donde vive cada cosa): en el centro, *Locations* en el tiempo (un
  punto por día cuyo título la nombra), *Sets* con sus escenas y dónde se filman, *Scenes* con todas las páginas que
  hablan de cada una, *Scouting* (cada scouting y prueba por fecha; en la barra ya no está: repetía `2 | Scouting
  Reports`), *Shoot days* (en la barra, cada día abre su página en *Pages*, donde vive) y *Pending*, lo ambiguo de la
  sección 3, con *Create*, *Assign*, *Merge* o *Bring them all in*.

En la barra se despliega una parte a la vez; una parte vacía aparece solo para quien puede crear (con su «+»). La
carpeta de un tipo y la de cada episodio, que *Pages* ya no muestra, se alcanzan con el ⋯ de su parte o de su episodio
(*Share*, *Move to…*, *Type*, *Leave out of relations*, papelera); si hay dos de la misma parte o del mismo episodio,
quedan en *Pages*. La barra es **un solo árbol** (D805 a D807): ↑ y ↓ recorren el *Overview* y siguen en *Pages*, con
partes y episodios como carpetas y filas como páginas. Al abrir una página queda abierto solo el camino hasta ella, con
su fila centrada. Una ficha (o la carpeta de su parte), se abra como se abra, despliega su parte y su episodio y pliega
*Pages*; algo de *Pages* (un día) abierto desde el *Overview* se abre en su semana, con su fila a la vista. Para cambiar
una escena de episodio o de carpeta, *Move to…* ofrece, solo para una página de ese tipo, la carpeta y los episodios.

## 6. Cómo se cargan las cosas, por etapa

El árbol que se sugiere (`Plan_Estructura_Etapas.md`, sección 3). Nombres y orden son libres; cuenta el tipo de cada
carpeta.

```
1 | Preproducción          notas y reuniones (lo de abajo se ve en el Overview, D813)
   1.1 | Desglose          Type › Scenes             una página por escena, sus fichas adentro
   1.2 | Locaciones        Type › Locations          una página por lugar físico
   1.3 | Decorados         Type › Sets               una página por decorado de guion
2 | Scouting               Type › Scouting reports   un reporte por recorrido, por fecha
3 | Pruebas                Type › Test reports       un reporte por prueba
4 | Planeamiento           Type › Day plans          semanas › un plan por jornada; «Sin orden»
5 | Rodaje                 cada semana, Shoot days   un reporte por jornada
6 | Tablas y referencia    sin tipo
90 | Archivo               Leave out of relations
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

**Scouting.** En `2 | Scouting`, plantilla *Tech scout* o *Creative scout*. La fecha al principio del título
(`26.01.29 | Scouting | Palomar`) o en *Fecha*; las locaciones en *Locación*, en el título o como títulos de sección,
uno por lugar con su nombre exacto.

**Pruebas.** En `3 | Pruebas`, plantilla *Test report*, con *Fecha* (opcional) y *Locación*; las escenas, por número.

**Planeamiento.** En `4 | Planeamiento › Semana 03`, plantilla *Day plan* (*Fecha*, *Día*, *Locación*). El título lleva
jornada y fecha (`D03_26.03.25_Palomar`), o el campo *Día*, un link al día; las escenas, por número. Los planes de una
locación para varias fechas van en `Sin orden`.

**Rodaje.** En `5 | Rodaje › Semana 03`, *New day report* crea el día (`2026-02-19 | Día 59`; conviene sumar el lugar,
`| CENADE`, que es lo que lee la app) y copia del anterior la unidad, el equipo y la cámara. Cada escena abre su sección
con `Escena 105_027` y lo filmado debajo; la primera sección sin número (*Info general*) es del día. La víspera,
*Prepare tomorrow's report* deja listos los títulos.

## 7. Lo que todavía no hace o está a medias

- *Copy overview* y *Copy JSON* (el mapa como texto) no llevan los decorados. Falta la parte 5 del plan: `6 | Tablas y
  referencia` y lo suelto en ERSO y VLLF.
- No hay plantilla de decorado. La fila *Fecha de rodaje (planeada)* de la plantilla *Scene* no la lee el día: cuenta
  *Fecha Rodaje*.
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
