# Estructura estándar de un proyecto: escenas, locaciones y días relacionados

**Estado (2026-10-08, ERSO a vivo):** método elegido y aplicado por primera vez a un proyecto grande importado de
Coda (ERSO), con una reorganización hecha al importar (fuera de la app). Desde v0.236 la app sabe qué es cada página
(«Tipo de página», abajo); desde v0.237 y v0.238 arma las relaciones en el dispositivo y las muestra en una cabecera
viva. El 2026-10-08 ERSO pasó a vivo (D403 a D415): sus carpetas tienen tipo, los títulos de escena llevan `101_074`,
se borró lo que la importación había generado congelado (listas, fichas, primeras líneas de identidad, índices de
carpeta) y el Mapa fue a la papelera. Una verificación aparte, que solo usa la fuente (lo escrito en Coda y lo que
anotó la reorganización), da 28 de 28: 226 escenas, 52 locaciones y 73 días, y de los 1.762 pares página–entidad que
arma la app, 298 son de la entidad misma y 1.464 tienen el número o el nombre escrito en la fuente; ninguno sin
respaldo. Antes de D416 eran 36 sin respaldo (alias sacados del paréntesis de las locaciones). Lo que falta está en «Lo que tiene que ganar la app», abajo, y en
`Doc_Roadmap.md` (grupo R). Las piezas van numeradas ES1 a ES10; en `Doc_Decisiones.md` son la D355, tomada al
reorganizar ese proyecto (Lega la puede cambiar).

## El problema

En un proyecto de VFX la misma escena aparece en el desglose (notas, consultas, asunciones, imágenes de referencia), en
uno o varios scoutings de sus locaciones y en los reportes de los días en que se filmó. Una locación aloja varias
escenas y una escena se puede filmar por partes en varias locaciones. Si cada cosa queda en la página donde se escribió,
encontrar todo lo de una escena es arqueología.

## El principio (ES1)

**Cada relación se escribe una sola vez, donde nace el dato; todo lo inverso es derivado.** El reporte dice qué escenas
se filmaron ese día y dónde; el desglose dice qué decorado y qué locación están planeados para cada escena; el scouting
cuelga de la locación que recorrió. Las listas inversas (los días de una escena, las escenas de una locación) no se
mantienen a mano ni las escribe la importación: las arma la app en vivo (el índice de relaciones y la cabecera de la
escena y de la locación, `Doc_Relaciones.md`). Las listas fechadas que generaba la reorganización de ERSO se borraron
al pasarlo a vivo (D403 a D414).

No es una base de datos: no hay columnas, filtros, fórmulas ni vistas que el usuario edite. Todo es página, título,
texto, link y foto, y una versión vieja de la app lo muestra entero.

## El árbol (ES2): por etapas

```
1 | Preproducción
   1.1 | Desglose                 (en una serie, una carpeta por episodio) → una página por escena
   1.2 | Locaciones y scoutings   una página por lugar físico; sus scoutings (técnico, creativo, re-scouting) adentro
   1.3 | Decorados                las locaciones de guion
2 | Rodaje                        (por bloque, si hay) → una página por día: el reporte; el planning del día, adentro
3 | Tablas y referencia           lo que no es escena, locación ni día (tablas de shots, assets, plates, tareas)
90 | Archivo                      respaldos y lo que no tiene otro lugar
```

La carpeta dice qué tipo de página es, nunca la relación: una escena no se mueve de lugar porque cambie el plan. Con
*Type*: `1.1 | Desglose` → *Scenes*, `1.2 | Locaciones y scoutings` → *Locations* y cada bloque de rodaje → *Shoot days*
(no `2 | Rodaje` entero: adentro de un grupo un día sin número no cuenta, D403). `90 | Archivo` queda fuera de las
relaciones (`graph: false`, D406). Ya no hay `00 | Mapa` congelado: lo reemplaza un Mapa vivo (ES9, punto 5; D411).

## Vocabulario (ES3)

- **Locación**: el lugar físico donde se filma (la dirección, el estudio). Es lo que se scoutea.
- **Decorado**: la locación del guion («casa de la familia, cocina»). Un decorado se puede filmar en más de una
  locación y una locación aloja varios decorados.
- **Día**: un día de rodaje, identificado por su fecha.

## Identificadores y títulos (ES4)

- **Escena**: en una serie `EP_NNN` más letra opcional (`101_074`, `102_016A`; con guion bajo, D368: `101-074` queda
  solo como forma alternativa que se reconoce); en un largo, `NNN`. Título de la página: `074 | <título corto> | 101_074`
  (adentro de la carpeta del episodio alcanza `074 | <título corto>`). La primera parte, de hasta 7 caracteres, alinea la columna de códigos de la lista (la app parte los
  títulos con `MAX_CODE_LENGTH`); el número completo en la tercera parte hace que buscar `101_074` encuentre la
  escena (hoy sale después de las fichas `ERSO_101_074_010…`, que también lo llevan en el título; que salga primero está
  en `Doc_Roadmap.md`, grupo R). La locación **no** va en el título de la escena: cambia y es muchos a muchos.
- **Sin primera línea de identidad** (D408): la de escena (`Escena 101-074 · también: …`) y la de locación (`Locación X ·
  también: …`) se borraron al pasar a vivo; la de locación juntaba lugares que el armado había separado. La escena se
  reconoce por su título y el lector de relaciones conoce las formas alternativas; ⌘K busca por subcadena, así que hoy
  `101-074` ya no trae la escena (`Doc_Roadmap.md`, grupo R).
- **Día**: `2025-11-03 | Día 03 | <locación>`, compatible con el título que arma *New day report* (`src/templates/dayReport.ts`), con la locación como tercera parte. El
  número de día viejo queda en el subtítulo.
- **Locación**: su nombre canónico. Los nombres alternativos, cuando la app tenga alias de locación.

## Cómo es cada página (ES5)

- **Escena**: página libre para escribir. Arriba, la cabecera viva (no es parte del documento): dónde está planeada,
  sus fichas y scoutings, los días con una sección suya y sus fotos, armado en el dispositivo. Debajo, como subpáginas,
  las fichas del desglose de esa escena. Sin ficha ni listas generadas (D409).
- **Locación**: página libre con la misma cabecera viva (escenas planeadas, scoutings, días, fotos); los scoutings, como
  subpáginas.
- **Día**: arriba, una tabla de dos columnas con `Fecha`, `Día` y `Locación` (la que lee *New day report* para el día
  siguiente; `src/templates/dayReportFacts.ts`); las filas Escenas y Planning se borraron (D407). Debajo de cada sección
  de escena del reporte, un renglón `→ Escena 101_074` con el link (D410). El texto del reporte no se toca y el día se
  lee de corrido. Un día sin reporte es una página vacía con fecha y lugar en el título (D412).

## Cómo escribir para que todo quede enlazado (ES6)

1. Una escena se nombra siempre con su número completo: `101_074` (en un largo, `074`); `101-074` se reconoce como forma alternativa.
2. En un reporte, cada escena abre con `Escena 101_074`.
3. Un scouting se crea adentro de su locación.
4. El planning de un día se crea adentro de ese día.

Escrito así, la búsqueda ya junta todo lo de una escena hoy, y la app lo va a poder relacionar sola cuando sume el
índice de marcas.

## Fotos (ES7)

Una foto se sube una sola vez y puede aparecer en varias páginas del mismo proyecto. Las galerías de una escena o una
locación (fotos traídas de sus scoutings y reportes) quedan apagadas en la importación: con muchas páginas suman
miles de registros de uso que la importación hace de a uno. Mientras tanto, el link a la fuente dice cuántas fotos tiene.

## Lo que no se hace (ES8)

- **No se parten los reportes por escena**: el día se lee entero, el PDF del día sigue igual y los comentarios no
  pierden su ancla. Una partición automática se equivoca con encabezados que tienen solo el número, con escenas en
  títulos de segundo nivel y con secciones que no son de una escena.
  **R6 (D581, v0.246): ni mover ni copiar texto entre páginas.** El motivo de fondo es la conservación y la
  colaboración: mover una sección pierde lo que otro dispositivo escribe sin red adentro de lo movido (Yjs integra
  borrado lo insertado en un bloque borrado), rompe el ancla de los comentarios, las fotos por página y el PDF del día, y
  no es atómico entre dos documentos; copiar duplica el texto y envejece. Los casos raros de arriba ya los resuelve el
  lector (D582): la escena muestra su parte de cada reporte en vivo, con la sección abierta y resaltada
  (`Doc_Relaciones.md`, sección 16).
- **No se usa `#`** delante del número: la búsqueda no lo necesita y al principio de un renglón choca con el atajo de
  título del editor.
- **Nada se descarta** al reorganizar, salvo páginas sin texto ni fotos (separadores).

## Tipo de página (v0.236, D368, D369 y D372 a D382)

La app sabe qué es cada página. Lo lee `src/relations/kind.ts` (`pageKind`, y `kindReader` para recorrer un proyecto
entero) y lo escribe `src/relations/entitySync.ts`. Nada de esto toca el documento de la página: son ajustes de la fila.

**Las claves** (`PageSettings`, `src/sync/types.ts`; ninguna se hereda, se leen en la página misma):

- `entity: { kind: 'scene' | 'location' | 'day', code?: string } | false` en la página: qué ES. `code`, solo en una
  escena: el número canónico (`101_074`, `101_069A`). `false`: «nada de esto», puesto a mano; gana sobre la carpeta.
- `holds: 'scene' | 'location' | 'day' | false` en una carpeta: qué es lo que se crea adentro.
- Los días usan la carpeta de reportes del día (`dayReports`, `Doc_Plantillas.md` 6.2) como única fuente: marcar una
  carpeta como de días escribe `dayReports` (no `holds`), y una carpeta de reportes, marcada o deducida por sus
  reportes, contiene días. `holds: 'day'` se lee igual, salvo con `dayReports: false`. Marcar escenas o locaciones en una
  carpeta de reportes la deja de usar para reportes.

**Cómo se decide** (`pageKind`), en orden:

1. La marca de la página. La ve también un invitado que ve la página sin su carpeta (le llega la fila con sus ajustes).
2. Sin marca, la carpeta que la contiene: todo su primer nivel es de ese tipo. En una carpeta de escenas, una
   subcarpeta de episodio (`101`, `EP 101`, `101 | Episode 1`, `105 | Episodio 5`) es un **grupo**: no es escena, y lo
   de adentro sí (con el episodio en el número: `074 | título` adentro de `105` es `105_074`). En una de días, lo que no
   tiene fecha ni número de día en el título (`Bloque 2`) es un grupo; en su primer nivel alcanza la fecha o el número
   de día, pero adentro de un grupo es día solo un reporte o lo que tiene fecha **y** número de día
   (`2026-02-19 | Día 59`): `Call sheets › 2026-02-19 | Call sheet` no es un día. Una subcarpeta con su propio tipo
   manda adentro suyo.
3. Si no, **parte de** la entidad más cercana hacia arriba: las fichas `ERSO_105_027_010` son parte de su escena (nunca
   otra escena aunque tengan un número), el scouting de su locación, el planning de su día.
4. Nada de la carpeta *Templates* ni ninguna plantilla es una entidad.

**El número de escena** sale del título, en este orden: uno completo al principio de la primera parte
(`101_074 | título`, `Escena 101_069A`); uno corto que es toda la primera parte, con el episodio de la carpeta
(`074 | título` adentro de `105`); una última parte que es entera un número completo (`074 | título | 101_074`). Un
número en el medio del texto nombra otra escena y no cuenta (`075 | Persecución, sigue en 105_076` es `105_075`). Sin
episodio, un número corto no alcanza y la página queda escena sin número (los largos, por ahora).

**Cuándo se escribe la marca:**

- Al ponerle título a una página adentro de una carpeta con tipo (crearla con título, o nombrarla la primera vez: la
  creada con «+» espera al nombre, que dice si es una escena o un grupo). Mientras tanto la carpeta ya le da el tipo. El
  título que se escribe en la página cuenta al confirmarlo (Enter, salir del campo, cambiar de página o cerrar la app),
  no en cada pausa en que se guarda: así `Episodio ` con una pausa antes del `6` no queda escena, y no se suben números
  a medio escribir (D382).
- Al marcar la carpeta (*Type* → *Pages created inside are*): todo lo que toma el tipo de ella y no tiene marca.
- Al moverla adentro (con lo de adentro, si es un episodio entero). Al sacarla, la marca se queda: sigue siendo una
  escena; *Type* → *None of these* la cambia.
- El número sigue al título: si un título nuevo (confirmado) trae otro número canónico, se actualiza; si no trae
  ninguno, el guardado se queda, también al elegir *Type* → *Scene* sobre una escena que ya lo es.
- Desmarcar una carpeta no les saca la marca a sus páginas (perderla no sirve para nada y se pierde información).
- Las plantillas *Scene* y *Location* marcan la página esté donde esté (y una propia que salió de ellas).
- Nunca se pisa una marca de otro tipo, ni `false`, ni una de una versión más nueva (un tipo que esta no conoce).

**Decisiones:** D368 y D369 (el contrato y los días como carpeta de reportes), D372 a D382 en `Doc_Decisiones.md`.

**En la pantalla:** el menú ⋯ tiene *Type* (*This page is* / *Pages created inside are*), y en el árbol una carpeta con
tipo lleva el rótulo SCENES, LOCATIONS o SHOOT DAYS (tooltip: «Everything created inside is a scene»).

**Compatibilidad:** cada marca es una clave de ajustes que sube sola (`patch_page_settings` fusiona por clave): una
versión de la app que cambia otro ajuste de la página no la borra. Las anteriores a v0.214 subían el objeto entero,
pero `min_app_version` ya es 0.227. Sin migración y sin tipos de bloque nuevos.

**Lo que no llega:** un visitante de un link público recibe solo `header` y `format` de los ajustes (`plink_tree`):
para él nada tiene tipo. Mostrárselo pide una migración que sume `entity` a lo que devuelve `plink_tree` (pendiente).

## Lo que tiene que ganar la app (ES9), en orden

1. Índice de marcas en el dispositivo y un panel **Relacionado** fuera del documento (quién menciona esta escena o esta
   locación), que reemplaza a las listas generadas. **Hecho:** el índice en v0.237 y la cabecera viva de la escena y de
   la locación en v0.238 (`Doc_Relaciones.md`); falta la del día.
2. Un selector de escena al escribir, que conozca los nombres alternativos.
3. Plantillas *Escena*, *Locación* y *Scouting* (hechas en v0.236: *Scene*, *Location*, *Tech scout*, *Creative scout*), y *New day report* con la locación en el título.
4. Galería por fuente en la escena y en la locación.
5. Un Mapa vivo.
6. ~~«Repartir por escenas» un reporte, con prueba de que no se pierde nada y que se puede deshacer.~~ **Cerrado en
   v0.246 (D581): no se reparte.** La escena muestra su parte de cada reporte en vivo (puntos 1, 4 y 5) y el reporte
   queda entero; la prueba de que ninguna sección ni foto se pierde en esa vista es `sectionCoverage.test.ts`.

Ninguna regeneración futura escribe dentro de una página que edita la gente (ES10).
