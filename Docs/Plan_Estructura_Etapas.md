# Plan: el árbol por etapas, los tipos y los links por contenido

Fecha: 2026-10-25. Pedido de Lega. Reemplaza, cuando quede implementado, las reglas ES2 y ES6 de
`Doc_Estructura_Proyecto.md` («el scouting va adentro de su locación», «el planning va adentro de su día»).

## 1. Por qué

Las importaciones de ERSO y VLLF desarmaron la forma en que Lega trabaja. En Coda los dos proyectos tienen la misma
forma, que es la de su flujo:

| Etapa | ERSO en Coda | VLLF en Coda |
|---|---|---|
| Notas y breakdown | `BD Main` (tabla) y `Locaciones` (decorados) | Lo mismo, en el doc `EEI` |
| Scouting | `ERSO \| Scouting Reports`: 10 por fecha | `Scouting`: 28 por fecha (doc `VLLF VFX Reports`) |
| Planeamiento | `ERSO \| Rodaje Planning` › semana › un plan por día | `Info` › semana › un plan por día |
| Rodaje | `ERSO \| Rodaje Reportes` › semana › un reporte por día | `Reportes` › semana › un reporte por día |

La importación puso cada scouting adentro de su locación y cada plan adentro de su día, porque la app sacaba de ahí
dos relaciones: «este scouting es de esta locación» y «este plan es de este día». El resto de las relaciones ya salía
del texto (el número de escena, el nombre de la locación). Se perdieron las etapas: el scouting quedó repartido entre
45 locaciones y el plan quedó escondido como subpágina del día.

## 2. El principio

**El árbol es de la persona.** Lo arma por etapas, como en Coda, y lo puede reacomodar cuando quiera sin romper nada.
**Qué es cada página y con qué se conecta sale de la página misma**: su tipo, su título y su texto. Nunca de estar
adentro de otra página.

ES1 sigue igual: cada relación se escribe una sola vez, donde nace el dato, y lo inverso lo arma la app en vivo.

## 3. El flujo y el árbol que se sugiere

1. Reuniones y notas: páginas libres.
2. Breakdown: la tabla y, después, una página por escena («en tal escena pasa tal cosa»).
3. Scouting: un reporte por recorrido, con fecha.
4. Pruebas: un reporte por prueba, con fecha (es parecido a un scouting).
5. Planeamiento: un plan por jornada, antes de filmar.
6. Rodaje: un reporte por jornada.

```
1 | Preproducción
   1.1 | Notas y reuniones
   1.2 | Desglose            una página por escena (Type: Scenes)
   1.3 | Locaciones          una página por lugar físico (Type: Locations)
   1.4 | Decorados           una página por decorado de guion (Type: Sets)
2 | Scouting                 por fecha (Type: Scouting)
3 | Pruebas                  por fecha (Type: Tests)
4 | Planeamiento             semanas › un plan por jornada (Type: Plans)
5 | Rodaje                   semanas › un reporte por jornada (Type: Shoot days)
90 | Archivo                 fuera de las relaciones
```

Es una sugerencia: las carpetas pueden llamarse distinto, estar en otro orden o anidarse por bloque o por semana. Lo
único que importa es el **tipo** de cada carpeta (o de cada página).

## 4. Los tipos

Dos familias:

- **Entidades** (lo que se linkea): escena, locación y **decorado** (nuevo). Se reconocen en el texto de cualquier
  página.
- **Documentos de una etapa** (lo que se escribe): notas, scouting, prueba, plan y reporte del día. Dicen en qué etapa
  se nombra cada cosa: lo que nombra un scouting es «scouteado», lo que nombra un plan es «planeado», lo que nombra un
  reporte es «filmado».

De dónde sale el tipo, en orden:

1. La marca de la página (*Type* en el menú ⋯, o la que pone la plantilla al crearla).
2. La marca de la carpeta más cercana hacia arriba con tipo («todo lo de adentro es de este tipo»). Se marca una vez,
   en `2 | Scouting`, y vale para todo lo que se crea o se mueve adentro, a cualquier profundidad (semanas, bloques).
3. Compatibilidad: una página sin ninguna marca, adentro de una escena, una locación o un día, sigue siendo «parte de»
   esa entidad (las fichas de una escena, los proyectos viejos). Es la regla de hoy y queda como último recurso.

El tipo de documento se guarda en una clave nueva de `settings` (por ejemplo `settings.stage`), separada de
`settings.entity`: una versión vieja ignora la clave y sigue mostrando la página como siempre. El decorado sí es un
tipo de entidad nuevo (`settings.entity.kind: 'set'`): `entityMark` de una versión vieja ya lo lee como `'other'`
(«un tipo de una versión más nueva») y no lo confunde con escena ni locación. No hay tipos de bloque nuevos.

## 5. Los links, por contenido

| Relación | Cómo se sabe |
|---|---|
| Página → escena | El número de escena en el texto o el título (como hoy). |
| Página → locación | El nombre o un «Otro nombre» de la locación (como hoy). |
| Página → decorado | El nombre del decorado, su título entero, o un «Otro nombre»; y el valor de un campo *Locación Guion* / *Decorado* / *Set*. |
| Scouting o prueba → su locación | La locación que nombra su título; si el título no nombra ninguna, el valor de su campo *Locación* (la tabla de arriba, como la del día). |
| Plan → su día | La fecha del título (`2026-03-25`, `26.03.25`, `D03_26.03.25`, `25.03` con el año del proyecto) o, si no tiene fecha, el número de jornada (`D03`, `Día 03`). |
| Fecha de un scouting, prueba o plan | La fecha de su título. |

Un plan se escribe antes de que exista la página del día: mientras no exista, sus escenas figuran como «planeadas para
el 25/03» y el Overview muestra esa fecha. Cuando se crea el reporte de ese día, se conectan solos.

Un nombre que es a la vez de una locación y de un decorado (en VLLF, «Plaza de Mayo») se lee como locación en el texto
libre y como decorado en un campo de decorado.

## 6. Qué cambia en la app

1. **El lector de tipos** (`kind.ts`, `register.ts`): el tipo de documento por marca de página o de carpeta, a
   cualquier profundidad; la etapa de cada página (`stage`) sale de ese tipo y no de la posición; el decorado como
   entidad. La regla de hoy («parte de») queda como último recurso.
2. **Las relaciones** (`liveView.ts`, `dayLive.ts`, `projectMap.ts`): los scoutings y pruebas de una locación por su
   título o su campo; el plan de un día por la fecha o el número de jornada; los decorados de una escena y de una
   locación por su nombre y sus campos.
3. **El menú *Type***: suma *Scouting*, *Tests*, *Plans* y *Sets* (para una carpeta o una página).
4. **Las plantillas**: *Scouting report*, *Test report* y *Day plan*, con la fecha en el título y la tabla de arriba
   (Fecha / Locación), como *New day report*.
5. **El Overview**: suma *Scouting* (scoutings y pruebas por fecha, con su locación) y *Sets* (decorados con sus escenas
   y sus locaciones); *Shoot days* muestra también las fechas que solo tienen plan.
6. **La cabecera de la locación** lista sus scoutings y pruebas estén donde estén; la del día, su plan esté donde
   esté; la del decorado, sus escenas y las locaciones donde se filma.
7. **La ayuda** suma cada tipo y plantilla nuevos; el tutorial ajusta lo que muestre del árbol.

## 7. ERSO y VLLF

Se reacomodan en la app, sin volver a importar: se mueven páginas, no se reescribe su contenido (la LEY 1 lo permite,
pero mover alcanza).

- Se crean las carpetas de etapa con su tipo.
- Cada scouting sale de su locación a `2 | Scouting`, en orden de fecha. Si su título no nombra la locación, se le
  agrega arriba la tabla con el campo *Locación* (un link a su locación de hoy). Así no pierde la relación.
- Cada plan sale de su día a `4 | Planeamiento › Semana NN`, con la fecha al principio del título (la del día donde
  estaba). VLLF: el título vuelve a ser el de Coda (`D03_26.03.25_Palomar Dagmar | Mie`, que hoy está en el subtítulo).
- Los decorados (`1.3 | Decorados`) se marcan *Sets*.
- Se verifica con los números de hoy: las mismas escenas filmadas por día, los mismos scoutings por locación y las
  mismas escenas planeadas, antes y después.

## 8. Orden de trabajo

1. Auditoría independiente de este plan y la decisión.
2. Tipos de documento por marca de página o carpeta, a cualquier profundidad; la etapa por tipo. Con pruebas que
   comparan, en ERSO y VLLF simulados, las relaciones de hoy contra las de después.
3. Scouting y prueba → locación por título o campo; plan → día por fecha o jornada.
4. Decorados como entidad.
5. *Type*, plantillas, Overview, cabeceras y ayuda.
6. Reacomodar ERSO y VLLF, y verificar.

Cada paso se publica solo, probado y auditado.
