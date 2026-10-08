# Estructura estándar de un proyecto: escenas, locaciones y días relacionados

**Estado (2026-10-08):** método elegido y aplicado por primera vez a un proyecto grande importado de Coda, con una
reorganización hecha al importar (fuera de la app). La app todavía no lo mantiene sola: lo que falta está en
«Lo que tiene que ganar la app», abajo, y en `Doc_Roadmap.md` (grupo R). Las piezas van numeradas ES1 a ES10; en
`Doc_Decisiones.md` son la D355, tomada al reorganizar ese proyecto (Lega la puede cambiar).

## El problema

En un proyecto de VFX la misma escena aparece en el desglose (notas, consultas, asunciones, imágenes de referencia), en
uno o varios scoutings de sus locaciones y en los reportes de los días en que se filmó. Una locación aloja varias
escenas y una escena se puede filmar por partes en varias locaciones. Si cada cosa queda en la página donde se escribió,
encontrar todo lo de una escena es arqueología.

## El principio (ES1)

**Cada relación se escribe una sola vez, donde nace el dato; todo lo inverso es derivado.** El reporte dice qué escenas
se filmaron ese día y dónde; el desglose dice qué decorado y qué locación están planeados para cada escena; el scouting
cuelga de la locación que recorrió. Las listas inversas (los días de una escena, las escenas de una locación) no se
mantienen a mano: hoy las genera la importación con fecha; más adelante, la app.

No es una base de datos: no hay columnas, filtros, fórmulas ni vistas que el usuario edite. Todo es página, título,
texto, link y foto, y una versión vieja de la app lo muestra entero.

## El árbol (ES2): por etapas

```
00 | Mapa                         cómo encontrar, cómo escribir, tablas de escenas, locaciones y días, pendientes
1 | Preproducción
   1.1 | Desglose                 (en una serie, una carpeta por episodio) → una página por escena
   1.2 | Locaciones y scoutings   una página por lugar físico; sus scoutings (técnico, creativo, re-scouting) adentro
   1.3 | Decorados                las locaciones de guion
2 | Rodaje                        (por bloque, si hay) → una página por día: el reporte; el planning del día, adentro
3 | Tablas y referencia           lo que no es escena, locación ni día (tablas de shots, assets, plates, tareas)
90 | Archivo                      respaldos y lo que no tiene otro lugar
```

La carpeta dice qué tipo de página es, nunca la relación: una escena no se mueve de lugar porque cambie el plan.

## Vocabulario (ES3)

- **Locación**: el lugar físico donde se filma (la dirección, el estudio). Es lo que se scoutea.
- **Decorado**: la locación del guion («casa de la familia, cocina»). Un decorado se puede filmar en más de una
  locación y una locación aloja varios decorados.
- **Día**: un día de rodaje, identificado por su fecha.

## Identificadores y títulos (ES4)

- **Escena**: en una serie `EP-NNN` más letra opcional (`101-074`, `102-016A`); en un largo, `NNN`. Título de la
  página: `074 | <título corto> | 101-074`. La primera parte, de hasta 7 caracteres, alinea la columna de códigos de la lista (la app parte los
  títulos con `MAX_CODE_LENGTH`); el número completo en la tercera parte hace que buscar `101-074` traiga primero la
  escena. La locación **no** va en el título de la escena: cambia y es muchos a muchos.
- **Primera línea de la escena**: `Escena 101-074 · también: 1074, 101_074, …`, con todas las formas en que se escribió.
  La búsqueda es por subcadena, así que encuentra la escena con cualquiera de ellas.
- **Día**: `2025-11-03 | Día 03 | <locación>`, compatible con el título que arma *New day report* (`src/templates/dayReport.ts`), con la locación como tercera parte. El
  número de día viejo queda en el subtítulo.
- **Locación**: su nombre canónico; los nombres alternativos, en su primera línea.

## Cómo es cada página (ES5)

- **Escena**: primera línea de identidad; una tabla de dos columnas (Escena, Episodio, Decorados, Locaciones —planeada o
  reportada—, Días de rodaje, Planning, Scoutings); `## Notas`, para lo que escriba la gente; y
  `## Relacionado · generado <fecha>`, solo links, que no se edita. Debajo, como subpáginas, las fichas del desglose de
  esa escena.
- **Día**: arriba, una tabla de dos columnas con `Fecha`, `Día` y `Locación` (la que lee *New day report* para el día
  siguiente; `src/templates/dayReportFacts.ts`) y después Escenas y Planning con links. Debajo de cada sección de escena del
  reporte, un renglón `→ Escena 101-074` con el link. El texto del reporte no se toca y el día se lee de corrido.
- **Locación**: primera línea con sus nombres alternativos, tabla con sus escenas (con la fuente: planeado o reportado),
  sus decorados y sus días; los scoutings, como subpáginas.
- **Mapa**: cómo encontrar, cómo escribir, las tablas de escenas, locaciones y días con links, y la lista de pendientes
  (secciones que no se pudieron asignar, nombres de locación dudosos).

## Cómo escribir para que todo quede enlazado (ES6)

1. Una escena se nombra siempre con su número completo: `101-074` (en un largo, `074`).
2. En un reporte, cada escena abre con `Escena 101-074`.
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
- **No se usa `#`** delante del número: la búsqueda no lo necesita y al principio de un renglón choca con el atajo de
  título del editor.
- **Nada se descarta** al reorganizar, salvo páginas sin texto ni fotos (separadores).

## Lo que tiene que ganar la app (ES9), en orden

1. Índice de marcas en el dispositivo y un panel **Relacionado** fuera del documento (quién menciona esta escena o esta
   locación), que reemplaza a las listas generadas.
2. Un selector de escena al escribir, que conozca los nombres alternativos.
3. Plantillas *Escena*, *Locación* y *Scouting*, y *New day report* con la locación en el título.
4. Galería por fuente en la escena y en la locación.
5. Un Mapa vivo.
6. «Repartir por escenas» un reporte, con prueba de que no se pierde nada y que se puede deshacer.

Ninguna regeneración futura escribe dentro de una página que edita la gente (ES10).
