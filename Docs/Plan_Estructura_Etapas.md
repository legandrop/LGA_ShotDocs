# Plan: el árbol por etapas, los tipos y los links por contenido

Fecha: 2026-10-25. Pedido de Lega. Reemplaza, a medida que se implementa, las reglas ES2 y ES6 de
`Doc_Estructura_Proyecto.md` («el scouting va adentro de su locación», «el planning va adentro de su día»). Auditado
por dos revisiones independientes (código y flujo contra Coda); las decisiones de la sección 9 salen de ahí.

## 1. Por qué

Las importaciones de ERSO y VLLF desarmaron la forma en que Lega trabaja. En Coda los dos proyectos separan las etapas
arriba de todo:

| Etapa | ERSO en Coda | VLLF en Coda |
|---|---|---|
| Breakdown | `BD Main` (tabla de fichas) y `Locaciones` (en realidad, decorados: columna *Locacion Guion*) | Lo mismo, en el doc `EEI` |
| Scouting | `ERSO \| Scouting Reports`: 10 por fecha | `Scouting`: 28 por fecha (doc `VLLF VFX Reports`) |
| Pruebas | — | `Pruebas` (comparación de técnicas) y *Puestas de cámara* |
| Planeamiento | `ERSO \| Rodaje Planning`: un plan por jornada, con separadores de semana y de bloque | `Info` › semana › un plan por jornada; `sin orden`: planes de una locación para varias fechas |
| Rodaje | `ERSO \| Rodaje Reportes` › semana › un reporte por jornada | `Reportes` › semana › un reporte por jornada |
| Referencia | `Tasks`, `Assets`, `Plates Europa`, `Timeline` | `Info` (links y dudas), `CONSIDERACIONES para los reportes`, `Calendar`, `Timeline` |

La importación puso cada scouting adentro de su locación y cada plan adentro de su día, porque la app sacaba de ahí
dos relaciones: «este scouting es de esta locación» y «este plan es de este día». El resto ya salía del texto. Se
perdieron las etapas.

## 2. El principio

**El árbol es de la persona.** Lo arma por etapas, como en Coda, y lo reacomoda cuando quiere sin romper nada. **Qué es
cada página y con qué se conecta sale de la página misma o de la carpeta que eligió para ella**, nunca de estar
adentro de una escena, una locación o un día.

ES1 sigue igual: cada relación se escribe una sola vez, donde nace el dato; lo inverso lo arma la app en vivo.

## 3. El árbol que se sugiere

```
1 | Preproducción
   1.1 | Desglose              una página por escena, con sus fichas adentro   (Type: Scenes)
   1.2 | Locaciones            una página por lugar físico                     (Type: Locations)
   1.3 | Decorados             una página por decorado de guion                (Type: Sets)
   (notas y reuniones: páginas libres, donde la persona quiera)
2 | Scouting                   un reporte por recorrido, por fecha             (Type: Scouting)
3 | Pruebas                    un reporte por prueba                           (Type: Tests)
4 | Planeamiento               semanas › un plan por jornada; «Sin orden»      (Type: Plans)
5 | Rodaje                     semanas › un reporte por jornada                (Type: Shoot days, en cada semana)
6 | Tablas y referencia        tablas, tasks, assets, plates, calendario, instrucciones
90 | Archivo                   fuera de las relaciones
```

Los nombres y el orden son libres. Lo que cuenta es el tipo de cada carpeta. Dos límites que siguen de antes:

- Los **días** (*Shoot days*) se marcan en la carpeta que los tiene en su primer nivel (cada semana o bloque), como
  hoy (D403). Adentro de un día, una subpágina sin tipo es parte de ese día.
- Las **escenas** se marcan en su carpeta; una subcarpeta de episodio es un grupo (como hoy).

## 4. Los tipos

- **Entidades** (lo que se linkea): escena, locación y **decorado** (nuevo).
- **Documentos** (lo que se escribe en una etapa): scouting, prueba y plan (nuevos); el reporte del día sigue siendo el
  día mismo. Dicen en qué etapa se nombra cada cosa: lo que nombra un scouting está «scouteado», lo que nombra un plan
  está «planeado» y lo que nombra un reporte está «filmado».
- Las notas no son un tipo: son páginas libres, y lo que nombran cuenta como breakdown.

**Dónde se guarda** (decisión 1): en las mismas claves de hoy. `settings.entity.kind` y `settings.holds` suman
`'scouting' | 'test' | 'plan' | 'set'`. Una versión vieja los lee como `'other'` («un tipo de una versión más nueva»):
no los pisa, no los confunde con escena, locación o día, y una carpeta con `holds: 'plan'` no se deduce carpeta de
reportes. Página y carpeta tienen un solo tipo; el menú *Type* sigue siendo una sola elección.

**De dónde sale** (decisiones 2 y 3): se sube por el árbol y **gana lo más cercano**:

1. La marca de la página.
2. Subiendo: si aparece primero una entidad, la página es «parte de» ella (las fichas adentro de su escena, las fotos
   adentro de su día). Si aparece primero una carpeta de documentos, la página es ese documento, a cualquier profundidad
   (`4 | Planeamiento › Semana 03 › plan`).
3. Las entidades se deducen como hoy (primer nivel de su carpeta, más un nivel de grupo).

El tipo de documento **se deduce al leer** y no se escribe en cada página: mover un plan de carpeta le cambia el tipo
sin dejar marcas pegadas. Solo lo escriben la plantilla y *Type* en la página.

## 5. Los links, por contenido

| Relación | Cómo se sabe |
|---|---|
| Página → escena | El número de escena en el texto o el título (como hoy). |
| Página → locación | El nombre o un «Otro nombre» de la locación (como hoy). |
| Página → decorado | **Solo** el valor de un campo de decorado (*Locación Guion*, *Decorado*, *Set*) o un link a su página, con el valor entero igual al título o a un «Otro nombre». Nunca el texto libre ni las partes del título («Comedor», «Auto Rubio», «Plaza de Mayo» chocan con locaciones y palabras comunes). |
| Scouting o prueba → sus locaciones (pueden ser varias) | Un link a la locación o el campo *Locación*; las que nombra el título; los títulos de sección que son exactamente una locación. |
| Plan → su día | Ver abajo. |

**Plan → día** (decisión 4), en orden:

1. Un link al día o el campo *Día* del plan.
2. Un plan adentro de un día sigue siendo de ese día (los proyectos de hoy).
3. Si no: la fecha del título (`AA.MM.DD`, `AAAA-MM-DD`, `AAMMDD`, `DD.MM`, `MM.DD` cuando el día pasa de 12, `D.MM`;
   separadores `_`, `.`, espacio). Se prueban todas sus lecturas contra los días que existen; el año sale de los días
   vecinos del proyecto, nunca de un «año del proyecto». Y el número de jornada del título (`D03`, `Día 03`).
4. Se conecta solo si la fecha y la jornada apuntan al mismo día, o si hay una sola de las dos y apunta a un día
   único. Dos días con la misma fecha (unidades U1/U2): desempata la unidad del título. Si se contradicen o empatan,
   no se conecta y va a *Overview › Pending* con sus candidatos.
5. Un plan con dos fechas o más, o sin fecha, es un plan de su locación (como «Plaza de Mayo | 21 Mar | 2,3,4,11
   Abr»): no se pega a ningún día.
6. Un plan cuya fecha no tiene día todavía (se planea antes de filmar) muestra sus escenas «planeadas para el 25/03» y
   el Overview muestra esa fecha; cuando se crea el reporte de ese día, se conectan solos.

## 6. Qué cambia en la app

1. **El lector** (`kind.ts`, `register.ts`, `entitySync.ts`): los tipos nuevos en `entity`/`holds`, la regla de lo
   más cercano, la etapa de cada página por su tipo (`Stage` suma `test`, `plan` y `set`).
2. **Las relaciones**: lo propio de cada entidad (`relationIndex.ts` `isOwn`, `projectMap.ts`), los scoutings de una
   locación y de una escena (`liveView.ts`: `scoutsVia`, los de la locación, *Also named in*), el plan del día
   (`dayLive.ts` `planOf`, `liveView.ts` `planMap`), el `/` (`slashRelations.tsx`), `sceneMentions.ts`, la galería
   (`photoGallery.ts`), *Tomorrow* y *Prepare*, y el formato del mapa para el asistente (`Doc_Relaciones.md` §12).
3. **Los decorados**: se portan D423 y D424 (el campo `set` y las páginas con *Locacion Real*) a la entidad nueva; no se
   suma un sistema al lado.
4. **El menú *Type***: *Scouting*, *Tests*, *Plans* y *Sets*, para una carpeta o una página.
5. **Las plantillas**: *Tech scout* y *Creative scout* (ya existen) pasan a marcar *Scouting*; *Test report* y *Day
   plan* nuevas, con la tabla de arriba (Fecha / Locación, o Fecha / Día). *Day plan* nunca es una plantilla de
   reporte (si lo fuera, su carpeta se deduciría carpeta de reportes).
6. **El Overview**: *Scouting* (scoutings y pruebas por fecha, con sus locaciones), *Sets* (decorados con sus escenas y
   locaciones), *Shoot days* con las fechas que solo tienen plan, *Pending* con los planes sin día claro.
7. **Las cabeceras**: la locación lista sus scoutings y pruebas estén donde estén; el día, su plan; el decorado, sus
   escenas y sus locaciones.
8. **La ayuda, el tutorial y los docs** (`Doc_Relaciones.md` §3, §4, §10, §11, §12, §21; «Tipo de página» de
   `Doc_Estructura_Proyecto.md`).

Compatibilidad: nadie borra ni reescribe contenido (no hay tipos de bloque nuevos; los ajustes se fusionan por clave).
Una versión vieja ve los scoutings y planes movidos sin relación con su locación o su día: se ve distinto, no se pierde
nada. Después de cada parte publicada se sube `min_app_version` (LEY 1).

Permisos: un permiso sobre una locación hoy alcanza a sus scoutings porque están adentro. Al mover los scoutings fuera,
deja de alcanzarlos (los permisos siguen el árbol). Se anota en la ayuda de compartir y se prueba.

## 7. ERSO y VLLF

Se reacomodan en la app, sin volver a importar, con las operaciones de la app (no por SQL). La regla del handover «en
ERSO real solo se lee» se levanta para esta tanda (LEY 1), con copia de seguridad antes.

- Se crean las carpetas de etapa con su tipo, incluida `6 | Tablas y referencia` (las tablas, tasks, assets, plates y
  la página *Info* de VLLF) y `4 | Planeamiento › Sin orden` (los planes de varias fechas).
- Cada scouting sale de su locación a `2 | Scouting`, y las pruebas a `3 | Pruebas`. A **todos** se les agrega arriba
  el link a la locación donde estaban (el campo *Locación*): los alias que cargó la importación son frágiles.
- Cada plan sale de su día a `4 | Planeamiento › Semana NN`, y se le agrega arriba el link a ese día (el campo *Día*):
  así las erratas de fecha de Coda no lo despegan. Los títulos: los de Coda; en los 24 planes de ERSO sin año se
  completa la fecha como `AA.MM.DD` (como hizo Lega desde el bloque 2) y el original queda en el subtítulo.
- `1.3 | Decorados` se marca *Sets*.
- Antes de escribir nada, una prueba en seco sobre una copia del árbol: scoutings por locación, escenas planeadas,
  filmadas y scouteadas por día y por escena, antes y después. Las diferencias tienen que dar cero o estar explicadas
  una por una (el plan D43 de ERSO, pegado al Día 44; `Reconquista` y `Bar Berlin (Claridge)`, que pueden ser el mismo
  lugar). Recién ahí: copia de seguridad, mover, esperar la sincronización y repetir la comparación sobre la base real.
- Lo que está en la papelera adentro de una locación o un día se queda ahí.

## 8. Orden de trabajo

Cada parte se publica entera (código, *Type*, plantilla, Overview, cabecera, ayuda), probada y auditada, y después se
sube `min_app_version`.

1. **El lector**: tipos nuevos, regla de lo más cercano, etapa por tipo. Sin cambios a la vista: las relaciones de ERSO
   y VLLF simulados tienen que dar iguales antes y después.
2. **Scouting y pruebas**: *Type*, scouting → locaciones, cabecera, *Overview › Scouting*, galería, plantillas, ayuda.
   Después se mueven los scoutings y pruebas de ERSO y VLLF. **Las partes 1 y 2 salieron juntas en v0.275 (D778)**: el
   lector solo no se podía probar sin *Type*. La etapa de una prueba es la del scouting (no se sumó `test` a `Stage`).
   Un link a la locación cuenta solo en el campo *Locación*; uno en el cuerpo del texto la nombra (*Also named in*). Una
   página índice (más de 20 escenas y locaciones) no toma la locación de sus títulos de sección. **Antes de mover nada en
   ERSO y VLLF se sube `min_app_version` a 0.275**: una versión vieja lee una carpeta de documentos adentro de una de
   locaciones como locación y le escribe la marca (auditoría de v0.275).
3. **Planes**: *Type*, *Day plan*, plan → día, cabecera del día, *Tomorrow*, *Prepare*, el `/`, *Shoot days*,
   *Pending*, ayuda. Después se mueven los planes.
4. **Decorados**: portar D423 y D424, *Type*, cabecera, *Overview › Sets*, ayuda. Después se marca `1.3 | Decorados`.
   **Salió en v0.294 (D804).** La cabecera no tiene etapas ni fotos propias (lo de cada escena está en su página).
   *Copy overview* y *Copy JSON* todavía no llevan los decorados. Antes de marcar `1.3 | Decorados` en ERSO y VLLF se
   sube `min_app_version` a 0.294.
5. `6 | Tablas y referencia` y lo que queda suelto en ERSO y VLLF.

## 9. Decisiones

1. Los tipos nuevos van en `entity.kind` / `holds`, no en una clave aparte (una versión vieja escribiría `entity`
   sobre una página con la clave aparte y la convertiría en locación o día).
2. Gana lo más cercano; los documentos valen a cualquier profundidad; las entidades, como hoy.
3. El tipo de documento se deduce de la carpeta al leer; solo la plantilla y *Type* lo escriben en una página.
4. Plan → día: link o campo, después lo de adentro, después fecha y jornada que coinciden; si no, *Pending*. Hecho en
   v0.277 (D780), con un puntero `entity.day` que escribe el reacomodo para que cada plan conserve su día.
5. Scouting → varias locaciones: link o campo, título, títulos de sección.
6. Decorados solo por campo o link, con el valor entero.
7. Las notas no son un tipo; las pruebas pueden no tener fecha.
8. El orden de la sección 8, con `min_app_version` después de cada parte.
