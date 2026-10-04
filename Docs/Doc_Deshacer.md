# Deshacer en el orden en que editaste (P.26)

**Estado: entregas 0 (v0.132: el límite de Yjs, arreglado con un parche; sección 16), 1 (v0.140: la línea de tiempo
con las páginas; sección 17), 2 (v0.144: el reemplazo adentro; sección 18) y 3 (v0.152: anotar una foto como un paso;
sección 19) hechas; B.22 (v0.0XX: el ⌘Z con dos personas ya no tira la excepción de Yjs; sección 20) y B.26 (v0.0XX:
deshacer el borrado de un renglón ya no deja a dos personas con textos distintos; sección 21) también.** Pedido de Lega
del 2026-10-02, al responder cómo se deshace un reemplazo en todo el proyecto (una pregunta de su lista de decisiones;
no es la D-10 de `Doc_Decisiones.md`). Se diseñó contra `main` v0.123
y se revisó contra v0.125. Las decisiones (DH1 a DH10, sección 11) son propuestas con la recomendación elegida: el
número final lo pone quien las cierre con Lega. Lo medido salió de prototipos en pruebas que no se versionan (sección
9). Auditado el 2026-10-02 (aprobado con condiciones): las correcciones ya están en el texto y resumidas al final
("Correcciones de la auditoría").

## En corto

- **El pedido.** ⌘Z (Ctrl+Z en Windows) sigue el **orden en que editaste**, no la página: deshace lo último que
  hiciste, después lo anterior, y si una de esas cosas fue un *Replace all in project*, deshace ese reemplazo en todas
  las páginas que tocó.
- **Hoy** cada página tiene su propia pila de deshacer (la de Yjs, por y-prosemirror) que **muere al cambiar de
  página**, y el reemplazo del proyecto no está en ninguna pila: se deshace solo con *Undo* del aviso o del panel.
- **La propuesta:** una **línea de tiempo** por proyecto y por pestaña que anota, en orden, cada paso de deshacer de
  cada página y cada reemplazo del proyecto. Las pilas de Yjs de cada página siguen siendo las que deshacen (nada nuevo
  en el documento): la línea de tiempo solo decide **cuál** va primero y las mantiene vivas al cambiar de página.
- ⌘Z: si lo último fue en esta página, se deshace acá (como hoy). Si fue en otra, **la app va a esa página y lo deshace
  ahí, a la vista** ("Undone in “Shot 12” · Back"). Si fue un reemplazo, lo deshace en todas sus páginas ("Undid
  “Cámara” → “Camera” in 12 pages · Redo"). ⌘⇧Z rehace en el mismo orden.
- **Lo que se descubrió al medir:** hoy, deshacer un reemplazo y después lo que habías escrito antes **deja texto**
  ("Toma 1: cámara" en vez de "Toma 1: "), porque el deshacer del reemplazo escribe letras nuevas que la pila de la
  página no conoce. La propuesta lo arregla: en las páginas con historia en la sesión, **el reemplazo entra en la pila
  de Yjs de la página** y se deshace con ella (exacto, medido en 300 corridas al azar), también cuando se deshace desde
  el panel y ya no es lo último (DH10).
- **Dura lo que la pestaña:** al recargar, la pila de Yjs no se puede rearmar (medido: lo borrado ya no está en el
  documento). Los reemplazos siguen en el panel con *Undo*, como hoy.
- **No cambia nada guardado**: ni el documento, ni el registro de reemplazos, ni la base. Sin migración, sin
  `min_app_version`; una versión vieja no se entera.
- **Entregas:** 1 la línea de tiempo con las páginas, 2 el reemplazo adentro, 3 anotar fotos como un paso. **La
  entrega 0 está hecha (v0.132):** el deshacer de Yjs dejaba restos y a veces se llevaba texto de antes (B.21) porque
  seguía lo que otro deshacer volvió a poner solo hasta el primer corte; un parche a Yjs lo sigue entero. Medido con
  texto: de 1.844 a 3.000 de 3.000 exactas y de 14 a 0 con algo de menos. Borrando y deshaciendo bloques enteros queda
  un resto chico de Yjs (1 de 300 con el editor, antes 7) (sección 16).

## Reglas que no se rompen

- **Nunca perder datos.** Deshacer es una edición nueva que se guarda primero en el dispositivo y sube como cualquier
  otra. Rehacer existe para todo lo que se deshace con ⌘Z.
- **Nunca pisar lo ajeno.** Deshacer saca solo lo tuyo: lo que escribió otra persona (o vos en otro dispositivo) queda,
  aunque sea adentro de lo que se deshace. Yjs lo hace por origen, salvo con un renglón que creaste y donde otro escribió
  adentro: deshacer su creación borraba el bloque entero; desde la entrega 1 el bloque queda con lo del otro (17.2,
  auditoría B1). El reemplazo sigue la misma regla.
- **Nunca deshacer lo que no ves sin decirlo.** Un cambio en otra página se deshace con esa página en pantalla; un
  reemplazo, con un aviso que dice cuántas páginas tocó y ofrece rehacer.
- **Nada de tipos de bloque ni propiedades nuevas.** La línea de tiempo vive en memoria.
- **En la Mac, ⌘; en Windows, Ctrl.** Con `modPressed`/`isLetter` de `src/ui/findUi.ts`.

## 1. Qué pasa hoy (v0.123)

### 1.1 El deshacer de la página

- BlockNote monta el `yUndoPlugin` de y-prosemirror (sin opciones). Ese plugin crea un `Y.UndoManager` sobre el
  fragmento del contenido que sigue **solo** el origen del editor (`ySyncPluginKey`) y junta lo hecho en medio segundo
  (`captureTimeout`). ⌘Z y ⌘⇧Z son el atajo de BlockNote (`shortcuts.ts`: `undo`, `redo`, dueño `blocknote`).
- `undoGuard.ts` corta un paso antes y después de todo lo que saca bloques, y desvía el deshacer del navegador
  (`beforeinput` con `historyUndo`) al de la página. Con el foco en otro campo (título, comentario, búsqueda) no hace
  nada.
- **Se pierde al cambiar de página.** El editor se arma por documento (`useMemo` sobre `doc` en `PageEditor.tsx`); al
  desmontarse, y-prosemirror llama a `undoManager.destroy()`. Volver a la página empieza con la pila vacía.
- **Lo que ya pasa por esa pila** (un paso cada uno): escribir y borrar, mover bloques y secciones, reemplazar en la
  página (Ctrl/⌘+F, marcado con `FIND_REPLACE_META`), aplicar el asistente (A1, `asOneUndoStep`), restaurar una versión
  del historial, crear desde una plantilla (y ⌘Z en el título recién creado, `armTitleUndo`), convertir fotos-bloque.
- **Lo que no:** el título (un `textarea`, deshacer propio del campo), el árbol (crear, mover, papelera, renombrar), los
  comentarios, el reporte del día (un editor sin pantalla en una página nueva), y anotar fotos (su propio
  `Y.UndoManager` por foto, origen `sd-markup:<archivo>`, mientras el anotador está abierto).

**Ejemplo.** Escribís "plano general" en *Shot 12*, vas a *Shot 13* y volvés: ⌘Z no hace nada, la pila de *Shot 12* se
fue con el editor.

### 1.2 El reemplazo del proyecto

- `src/search/projectReplace.ts` escribe en el `Y.Doc` de cada página **sin editor**, con el origen propio
  `ORIGIN_REPLACE` (una edición local: se guarda y se sube). No es el origen del editor: **la pila de la página abierta
  no lo ve** (hay una prueba que lo comprueba).
- Antes de escribir guarda un registro en `meta` (`replace:<op>` y `replace:<op>:<página>`, los últimos 5 *Replace all*
  y 5 sueltos por proyecto) con dos anclas por cambio. *Undo* (aviso de 15 s o panel) vuelve a poner lo de antes **solo
  donde entre las anclas sigue exactamente lo que puso el reemplazo**; lo demás se cuenta ("2 had changed") con *Show*.
  Sobrevive a cerrar la app. Sin rehacer.

**Ejemplo.** Reemplazaste "Cámara" → "Camera" en 50 páginas. Después escribís en una de ellas y apretás ⌘Z dos veces: se
va lo que escribiste y después lo que escribiste antes del reemplazo; el reemplazo queda.

### 1.3 El hueco que apareció al medir

Cuando el reemplazo toca algo que escribiste en la misma sesión, el orden de hoy deja texto de más:

1. En *Shot 12* escribís "cámara roja" (un paso de la pila).
2. *Replace all* "cámara" → "Camera": "Camera roja".
3. *Undo* del reemplazo: "cámara roja" (pero **son letras nuevas**, escritas por el deshacer del reemplazo).
4. ⌘Z: la pila de la página saca las letras que vos escribiste en el paso 1; "cámara" ya no estaba (la había borrado el
   reemplazo) y las letras nuevas no son suyas. **Queda "Toma 1: cámara"** en vez de "Toma 1: ".

Medido en el prototipo (sección 9, prueba "HOY"). No se pierde nada, pero queda algo que no pediste. La propuesta lo
evita (sección 3.3).

## 2. Qué quiere Lega

"⌘Z sigue el orden en que editaste, no la página: deshace lo último que hiciste, después lo anterior, y si una de esas
acciones fue un reemplazo en todo el proyecto, se deshace ese reemplazo" (Lega, 2026-10-02). Eso pide:

- un solo orden para todo lo que hacés en el proyecto, con el reemplazo como **un** paso;
- que el deshacer de cada página siga funcionando como hoy (Yjs, sin pisar a nadie);
- que no se pierda la historia de una página al irte de ella (si no, "lo anterior" no existiría).

## 3. La propuesta: una línea de tiempo arriba de las pilas de cada página

### 3.1 Qué es

Un objeto por instancia de servicios (como `ProjectReplace`), en memoria, **por proyecto**: dos listas, *para deshacer*
y *para rehacer*. Cada entrada es una de:

| Entrada | Qué guarda | Cómo se deshace |
|---|---|---|
| **Paso de página** | la página y el `StackItem` de Yjs (el mismo objeto de la pila de esa página) | la pila de esa página, solo ese paso |
| **Reemplazo** | el id del registro (`replace:<op>`), lo buscado y el reemplazo, y por página el `StackItem` (páginas con historia) o las anclas (las demás) | cada página por su camino (3.3), en un solo ⌘Z |
| **Anotaciones** (entrega 3, hecha: sección 19) | la foto y los pasos del anotador de esa vez | la pila del anotador, todos juntos |

La línea de tiempo **no guarda contenido**: guarda punteros a pasos de Yjs que ya existen. El orden lo da el momento en
que cada paso se crea (`stack-item-added` de cada pila). Lo que se junta en medio segundo (`stack-item-updated`) es el
mismo paso.

### 3.2 Las pilas de cada página sobreviven al cambiar de página

- **El documento se retiene**: la línea de tiempo abre la página (`docs.open`, que suma una referencia) mientras tenga
  pasos de ella, así el `Y.Doc` no se destruye al salir. Sin esto, el deshacer de Yjs no puede volver a poner lo borrado:
  un documento rearmado desde lo guardado ya no lo tiene (medido, sección 9).
- **La pila pasa de un editor al siguiente.** **La línea de tiempo es la dueña de las listas** de cada página
  (`undoStack`, `redoStack`); el `UndoManager` del editor en pantalla solo las usa. **Sin parchear y-prosemirror.**
  Comprobado por la auditoría con el editor real de BlockNote (montar, escribir, borrar, desmontar, el otro escribe y
  borra sin ninguna pila escuchando, montar otro editor y pasarle las listas): montar no deja nada en la pila, deshacer
  vuelve a poner lo borrado y saca solo lo tuyo, rehacer es exacto y los dos dispositivos terminan iguales. Cómo se pasa:
  - **Cuándo:** React arma el editor nuevo (y su `UndoManager`) en el render, **antes** de desmontar el viejo. Las
    listas se le pasan al nuevo cuando se monta su vista, antes de que se pueda escribir; desde ahí la línea de tiempo
    ignora los eventos del `UndoManager` viejo hasta que se destruye.
  - **Nunca pisa:** si el `UndoManager` nuevo ya tiene algo (no debería: montar no escribe), las listas guardadas van
    **debajo** de lo suyo, en el orden en que se hicieron; nunca se reemplaza una lista que no esté vacía.
  - **Sin arrastrar el editor viejo:** y-prosemirror guarda en cada paso (`stackItem.meta`) la selección con el
    *binding* del editor como clave, y esa clave retiene el editor viejo con todo su documento de ProseMirror. Al pasar
    las listas se borran del `meta` las claves de los bindings que ya no existen (medido por la auditoría en una página
    de 115 KB con 30 pasos: +1,05 MB con el meta viejo, +0,52 MB sin él). La selección de esos pasos se pierde (riesgo 3).
- Mientras la página no está en pantalla **no hay ningún `UndoManager` escuchando** su documento: lo que escriba un
  editor sin pantalla (el reporte del día, la importación) no entra en la pila por error.
- **Topes:** las últimas **20 páginas** con pasos y **1000 pasos** en total por pestaña. Al pasar el tope se olvida lo
  más viejo (y se suelta el documento si ya no tiene pasos). Medido con Yjs solo: un documento vivo ocupa unas 10 veces
  lo que pesa guardado (0,33 MB una página de 26 KB, 0,94 MB una de 90 KB). Con el editor real (auditoría): 1,18 MB una
  página de 115 KB, más unos 17 KB por paso con el meta limpio (0,52 MB los 30 pasos). 20 páginas grandes con su
  historia serían unos 25 a 35 MB: aceptable en la compu; **en el iPhone se mide en la entrega 1 con el editor real** y,
  si aprieta, el tope baja a 10 páginas.
- **Si un documento retenido queda viejo** (llegó algo que no se pudo aplicar, `stale` en `docs.ts`) o se rearma, sus
  pasos dejan de valer: se sacan de la línea de tiempo y el próximo ⌘Z que llegue ahí lo dice (sección 5). La línea de
  tiempo suelta su referencia **en el mismo momento** en que `docs.ts` avisa (`unsupportedListeners`), antes de que la
  página vuelva a abrir: `docs.open` solo rearma un documento viejo si nadie lo tiene abierto, y si la referencia se
  soltara después, la página seguiría con el viejo. Con su prueba.

### 3.3 El reemplazo entra en la línea de tiempo

Un *Replace all*, *Replace in page* o *Replace* de una coincidencia es **una** entrada. Por página, dos caminos:

- **Páginas con historia en la sesión** (tienen pasos en la línea de tiempo, así que su documento está retenido): el
  reemplazo se escribe igual que hoy (`docs.applyLocal`, `ORIGIN_REPLACE`), pero **además** entra como un paso de la pila
  de Yjs de esa página: se corta el tiempo antes y después (`stopCapturing`; sin esto, medido, se pega a lo escrito medio
  segundo antes) y un `UndoManager` que sigue `ORIGIN_REPLACE` (el del editor si está montado, o uno temporal con las
  mismas opciones, que después se descarta) lo anota. Deshacerlo es el deshacer de Yjs: vuelve a poner **las mismas
  letras** que borró, así el paso anterior de la página sale exacto. Arregla el hueco de 1.3.
- **Las demás páginas** (las que el reemplazo tocó sin que las hayas editado en la sesión): las anclas del registro,
  como hoy. No hay un paso anterior de esa página en la línea de tiempo, así que el hueco no puede aparecer.
- **Rehacer** es simétrico: la pila de Yjs en las primeras; en las otras, un `planRedo` nuevo (el espejo de `planUndo`:
  vuelve a poner lo nuevo solo donde entre las anclas sigue exactamente lo de antes).
- El registro en `meta` se guarda igual que hoy (para el panel y para después de recargar). Una página deshecha por la
  pila se borra del registro como una deshecha por las anclas. Las anclas siguen sirviendo después de que la pila
  deshizo y rehízo el reemplazo, y después de deshacer y rehacer lo escrito al lado (medido por la auditoría: `undone`
  en los dos casos): después de recargar, el *Undo* del panel encuentra el reemplazo rehecho. Rehacer vuelve a escribir
  los mismos registros.
- **El *Undo* del aviso y el de "Last" en el panel** siguen andando, también cuando el reemplazo ya no es lo último
  (DH10). Si es lo último, hace exactamente lo mismo que ⌘Z. Si no:
  - **en las páginas con historia**, se deshace **ese paso de la pila de Yjs aunque no sea el de arriba**: se corta la
    pila hasta ese paso, se deshace y se vuelven a poner los de arriba (el mismo "un paso por vez" de 3.4). Así vuelven
    las mismas letras que borró el reemplazo, y deshacer después lo escrito antes sale exacto. Medido por la auditoría
    con el editor real: escribir "cámara roja", reemplazar, escribir en otro bloque, *Undo* del panel, ⌘Z, ⌘Z deja
    "Toma 1: " (por las anclas quedaba "Toma 1: cámara", el resto de 1.3). El paso contrario que deja Yjs se descarta:
    este *Undo* no se rehace con ⌘⇧Z (como hoy; para rehacer, se reemplaza de nuevo);
  - **en las demás**, por las anclas, como hoy;
  - el reemplazo sale de la línea de tiempo. Lo que se escribió después queda.

### 3.4 Qué hace ⌘Z

Un ⌘Z deshace **una** entrada, la última del proyecto que tenés abierto:

1. **Un paso de esta página:** se deshace acá, como hoy (el cursor vuelve donde estaba).
2. **Un paso de otra página:** la app va a esa página, la deja en pantalla con el bloque del cambio a la vista (el
   mismo `reveal` de "ir al bloque" de los comentarios, que abre la sección si está colapsada) y lo deshace. Aviso:
   "Undone in “Shot 12” · Back" (*Back* vuelve a la página donde estabas). DH2.
3. **Un reemplazo:** se deshace en todas sus páginas sin moverte de donde estás, con el avance y *Stop* de hoy si tarda.
   Aviso: "Undid “Cámara” → “Camera” in 12 pages · Redo"; si alguna cambió: "· 2 had changed and were left as they are
   · Show". DH3.
4. **Un paso que ya no cambia nada** (otra persona borró justo eso): se descarta y, en el mismo ⌘Z, sigue con el
   anterior **solo si es de esta misma página**. Si el anterior es de otra página o un reemplazo, ese ⌘Z se frena ahí con
   el aviso "Nothing to undo there: someone else already changed it. {undo} again for the previous change." Ejemplo:
   escribiste en *Shot 3* y después en *Shot 12*, y otra persona borró lo tuyo de *Shot 12*: el primer ⌘Z en *Shot 12*
   no cambia nada y avisa; el segundo te lleva a *Shot 3*. (Yjs, si un paso no cambia nada, se saltea solo al anterior
   de la misma pila; la línea de tiempo le pasa **un paso por vez** para que no se saltee uno de otra página que iba
   antes. Medido.)

Además:

- **Mantener apretado ⌘Z** (`event.repeat`) deshace en la página y se frena en un cambio de página o en un reemplazo:
  para cruzar hay que soltar y volver a apretar.
- **Mientras se deshace un reemplazo** (o mientras carga la otra página), los ⌘Z que lleguen no hacen nada; no se
  encolan.
- **Dónde escucha:** en el editor (el atajo de BlockNote pasa a ser el de la línea de tiempo, en `undoGuard.ts`, que
  ya desvía el `historyUndo` del navegador), y en la página fuera de un campo de texto (con el foco en el árbol o en un
  botón). **No** en el título, un comentario, la búsqueda, un diálogo ni el anotador: ahí sigue el deshacer de ese
  campo. Excepciones que ya existen y siguen: el título recién creado desde una plantilla (`armTitleUndo`) y, nueva, el
  campo del panel justo después de un reemplazo (DH9): hasta que escribas en el campo, ⌘Z ahí deshace el reemplazo.
- **⌘⇧Z** rehace en el mismo orden y con las mismas reglas; también ⌘Y en la Mac y Ctrl+Y en Windows, como hoy
  (`Mod-y` de BlockNote). **Algo nuevo** (escribir en
  cualquier página del proyecto, reemplazar) borra todo lo que había para rehacer, en todas las páginas (como cualquier
  editor: un solo orden).
- **Con nada para deshacer**, ⌘Z no hace nada (sin aviso, como hoy).
- **Quienes hoy llaman directo al deshacer de Yjs** pasan por la línea de tiempo (una función suya que deshace un paso
  dado), así ningún paso queda en una lista que ella no conoce: el asistente cuando su comprobación falla (`apply.ts`,
  `while … undo.undo()`), restaurar una versión cuando falla y el *Undo* de su aviso (`historyRestore.ts`,
  `undoRestore`), el título recién creado desde una plantilla (`armTitleUndo`, `pageEditor.undo()`) y el deshacer del
  navegador (`undoGuard.ts`, `editor.undo()` en `beforeinput`). La marca *Restored from…* (`onStepUndone`) escucha a la
  línea de tiempo y no al `UndoManager`, que cambia al volver a la página.
- **Lo que la app escribe de fondo** (`BACKGROUND_META`: renombrar un HEIC a `.jpg`, sacar el bloque de una subida que
  falló) **no entra** en la pila (`addToHistory: false`): no lo hizo la persona, y como "algo nuevo" borraría lo que
  había para rehacer en todas las páginas.

### 3.5 El orden, con el ejemplo de Lega

Reemplazaste en 50 páginas; después escribiste en *Shot 12*; antes del reemplazo habías escrito en *Shot 3*.

| Apretás | Pasa |
|---|---|
| ⌘Z (en *Shot 12*) | se va lo que escribiste en *Shot 12* |
| ⌘Z | se deshace el reemplazo en las 50 páginas: "Undid “Cámara” → “Camera” in 50 pages · Redo" |
| ⌘Z | la app va a *Shot 3* y saca lo que escribiste ahí: "Undone in “Shot 3” · Back" |
| ⌘⇧Z tres veces | vuelve todo, en orden: lo de *Shot 3*, el reemplazo, lo de *Shot 12* |

## 4. Alternativas que se descartaron

- **Solo las acciones grandes en la línea de tiempo y la página con lo suyo** (como VS Code: ⌘Z en un archivo deshace el
  "reemplazar en todos" si es lo último **de ese archivo**, y pregunta si deshacerlo en todos). Es más chico, pero no es
  lo que pidió Lega: "no la página". Queda como DH1 B.
- **Un `UndoManager` único para todo el proyecto.** Yjs no lo permite: un `UndoManager` es de un documento, y cada
  página es un documento.
- **Un registro propio con anclas para todo** (como el reemplazo, también para lo que se escribe). Sobreviviría a
  recargar, pero rehace lo que Yjs ya resuelve bien (lo ajeno, el formato, los bloques) con una regla más pobre ("solo si
  sigue exactamente igual"), y escribiría en la base local con cada tecla.
- **Que la línea de tiempo sobreviva a recargar.** Para los pasos de página no se puede (sección 9: el documento
  rearmado no tiene lo borrado). Para los reemplazos sí, pero un ⌘Z al día siguiente que cambia 50 páginas sin que
  recuerdes el reemplazo es peor que el botón del panel. DH4.
- **Deshacer en otra página sin ir a ella.** Rápido, pero cambia algo que no ves. DH2 B y C quedan como opciones.

## 5. Casos límite

| Caso | Qué pasa |
|---|---|
| **Otra persona editó después lo mismo** | Lo tuyo se deshace igual y lo suyo queda (Yjs, por origen). Si borró justo lo tuyo, ese paso no cambia nada y se pasa al anterior. En un reemplazo: en las páginas con historia, el deshacer de Yjs (medido: con "XX" escrito por el otro adentro de "Camera", deshacer deja "cámaraXX"; deshacer también lo escrito antes deja solo "XX"); en las demás, las anclas ("had changed", queda como está, con *Show*). Nunca se borra nada del otro: 0 en 300 corridas al azar con el otro escribiendo y borrando, también adentro de renglones que creaste (17.3). |
| **Sin red** | Igual que con red: todo es local. Lo deshecho queda pendiente de subir, como cualquier edición. |
| **La página no está abierta** | Si tiene pasos, su documento está retenido (3.2): ⌘Z la abre (instantáneo, ya está en memoria). Las páginas que solo tocó un reemplazo se deshacen sin abrirlas en pantalla, como hoy. |
| **La página se fue a la papelera, perdiste Editar, o la borraron** | Ese paso se saca y el aviso lo dice: "Can't undo in “Shot 12”: it's in the trash. ⌘Z again for the previous change." En un reemplazo, esas páginas quedan para *Undo the rest* del panel, como hoy. |
| **El documento retenido se rearmó** (llegó algo que no se pudo aplicar) | Sus pasos ya no valen: se sacan y el próximo ⌘Z que llegue ahí avisa "Older changes in “Shot 12” can't be undone (the page was reloaded)" y sigue con el anterior en el ⌘Z siguiente. |
| **Cambiar de proyecto** | Cada proyecto tiene su línea de tiempo (DH7). Al volver, sigue donde estaba (si no se pasó el tope). |
| **Cambiar de workspace, cerrar sesión, recargar, cerrar la pestaña** | Se pierde la línea de tiempo (DH4). Los reemplazos siguen en el panel con *Undo*. Dos pestañas: cada una la suya. |
| **Un reemplazo corriendo** | ⌘Z no hace nada hasta que termina (no se puede deshacer algo a medias); *Stop* sigue igual. |
| **Un reemplazo cortado con *Stop* o por no poder guardar** | Entra igual, con las páginas que alcanzó a escribir. |
| **El asistente aplica** | Ya es un paso de la pila de la página (A1, `asOneUndoStep`): entra solo. Si al comprobar falla y lo deshace, lo hace por la línea de tiempo (3.4) y el paso sale con él. |
| **Restaurar una versión** | Un paso de la página. *Undo* del aviso sigue andando mientras sea lo último de esa pila. |
| **Crear desde una plantilla** (de fábrica o propia, v0.124) | Un paso de la página (`insertTemplate` e `insertTemplateCopy` van por el editor; el colapsado para todos que copia no entra en la pila, como hoy); ⌘Z en el título recién creado sigue sacando la plantilla (ahora por la línea de tiempo). *Customize* y *Save as template…* escriben en otra página (la de la plantilla): son pasos de esa página si se escribe en su editor. |
| **Reporte del día** | Crea una página y escribe con un editor sin pantalla: no entra (sección 10). La página nueva se manda a la papelera como cualquier otra. |
| **Anotar** | Con el anotador abierto, su ⌘Z es de esa foto (su pila mira el mapa de anotaciones, no el contenido: no se cruza con la de la página). Al cerrarlo, todo lo de esa vez es **un** paso de la página (entrega 3, sección 19): ⌘Z lo deshace entero, con la página en pantalla y la foto a la vista, y ⌘⇧Z lo rehace. Lo que otra persona anotó en la misma foto queda. |
| **Renombrar, mover, crear o mandar a la papelera** | No entran (DH1): un ⌘Z después de renombrar *Shot 7* saltea el cambio de nombre y deshace lo anterior, que puede estar en otra página (te lleva). |
| **El teléfono** | No hay ⌘Z sin teclado. Con teclado físico, igual que en la compu. El gesto de deshacer de iOS llega al editor como `historyUndo` y `undoGuard.ts` lo manda a la línea de tiempo (a probar a mano). Sin botón nuevo (DH8). |

## 6. No perder datos

- Deshacer y rehacer son ediciones locales por el camino de siempre (guardar en IndexedDB, subir a `page_updates`); la
  línea de tiempo no escribe nada propio.
- **Lo ajeno nunca se borra**: deshacer saca solo lo insertado por tus pasos (Yjs) o lo que está exactamente entre las
  anclas (reemplazo sin historia). Medido: 0 caracteres del otro borrados por un deshacer en 300 corridas.
- **Lo que deshacés se rehace**: ⌘⇧Z para todo lo de la línea de tiempo, también el reemplazo (hoy no tiene rehacer).
- **Retener un documento** usa `docs.open`: la página cuenta como abierta (la guardia de versión queda armada, como con
  el editor en pantalla), nada se destruye con ediciones sin guardar.
- **Un límite de Yjs que existía antes de este diseño, arreglado en la entrega 0 (v0.132, sección 16).** Si algo que un
  deshacer volvió a poner se partía escribiendo en el medio, deshacer más atrás dejaba restos ("la ía" en vez de "la ")
  y, a veces, **se llevaba un pedazo de texto**: en un caso, un solo deshacer borró "ám" de "cámara" (texto original
  que un deshacer anterior había vuelto a poner). Medido por la auditoría con la **misma** secuencia al azar en una
  página, con el deshacer de Yjs tal cual y con "un paso por vez" de la línea de tiempo: idénticos, 1.844 de 3.000
  exactas al deshacer todo y **14 de 3.000 con algo de menos** en los dos. Con el parche de Yjs: **3.000 de 3.000
  exactas y 0 con algo de menos**, también idénticos con y sin "un paso por vez". Con el editor real y Enter y
  Backspace en el medio: de 68 de 300 con restos y 1 con algo de menos a 0 y 0. **No es cero en todo:** borrando y
  deshaciendo bloques enteros (con tablas y fotos), la auditoría midió 1 de 300 con una letra de antes de menos con el
  editor (antes 7) y 10 de 3.000 en un modelo de párrafos (antes 112). Ver 16.3 y 16.4.

## 7. Versiones viejas

- **Nada cambia en lo guardado**: ni el documento (no hay tipos ni propiedades nuevas), ni las claves `replace:` de
  `meta` (el mismo formato; rehacer un reemplazo vuelve a escribir su registro igual que al reemplazar), ni la base.
- Una versión vieja abierta en otra pestaña tiene su propio ⌘Z por página, como hoy, y ve lo deshecho como cualquier
  edición que llega.
- Sin migración, sin subir `min_app_version`.

## 8. Ayuda, atajos y textos

- **Sin atajos nuevos.** `undo` y `redo` del registro (`shortcuts.ts`) cambian de dueño (de `blocknote` al de la línea
  de tiempo) y de lugar (también fuera del editor); `shortcutSources.ts` suma los archivos nuevos. En la Mac, ⌘Z y
  ⌘⇧Z (y ⌘Y, como hoy); en Windows, Ctrl+Z, Ctrl+Shift+Z y Ctrl+Y.
- **Ayuda:** la entrada `undo` dice que deshace en el orden en que editaste, también en otra página (te lleva) y un
  reemplazo de todo el proyecto; `replaceProject` cambia su última oración ("{undo} in the page doesn't undo it") por
  que ⌘Z lo deshace si es lo último que hiciste, y que *Undo* del aviso y del panel sigue andando aunque no lo sea.
- **Textos (inglés, con su traducción):** "Undone in “{page}” · Back", "Redone in “{page}” · Back", "Undid “{from}” →
  “{to}” in {n} pages · Redo", "Redid … · Undo", "Can't undo in “{page}”: {reason}. {undo} again for the previous
  change.", "Older changes in “{page}” can't be undone (the page was reloaded).", "Nothing to undo there: someone
  else already changed it. {undo} again for the previous change."
- El tutorial no muestra deshacer: no cambia.

## 9. Lo medido (prototipos sin versionar)

Pruebas en el árbol de trabajo con Yjs 13.6.33 y el `replaceDoc.ts` de `main` (el reemplazo de verdad), sin editor. Los
archivos quedaron en la carpeta privada de trabajo; no van al repo.

| Prueba | Resultado |
|---|---|
| **El hueco de hoy** (escribir, reemplazar, deshacer el reemplazo por las anclas, ⌘Z) | queda "Toma 1: cámara" (lo esperable: "Toma 1: ") |
| **La pila de la página sigue el reemplazo** (con `stopCapturing` antes y después) | ⌘Z, ⌘Z: "Toma 1: "; ⌘⇧Z, ⌘⇧Z: "Toma 1: Camera roja". Exacto |
| Lo mismo **sin cortar el tiempo** | el reemplazo se pega a lo escrito medio segundo antes (un solo paso): hace falta cortar |
| **El otro escribe "XX" adentro de "Camera"** | anclas: "changed", queda "CamXXera roja" y, deshecho también lo escrito, "Toma 1: CamXXera"; pila: "cámaraXX roja" y después "Toma 1: XX". En los dos, "XX" siempre queda y los dos dispositivos terminan iguales |
| **La pila pasada a otro `UndoManager`** (el editor se desmontó) con el otro escribiendo y borrando en el medio | deshacer vuelve a poner lo borrado ("plano ") y saca solo lo tuyo; queda lo del otro |
| **La pila sobre un documento rearmado** desde lo guardado (recargar) | no vuelve a poner lo borrado ("general" en vez de "plano general"): no se puede llevar la pila a otra sesión |
| **Línea de tiempo: el orden** (escribir en A, reemplazar en A y B, escribir en B; tres ⌘Z y tres ⌘⇧Z) | cada paso en su orden, todo exacto |
| **Línea de tiempo al azar, solo** (3 páginas, 60 acciones: escribir, borrar, reemplazar en todas; deshacer todo y rehacer todo) | 300 de 300 exactas al deshacer todo y al rehacer todo (9.839 pasos deshechos, 1.518 reemplazos) |
| Ídem, **deshaciendo y rehaciendo en el medio** | 194 de 300 exactas, 0 con algo de menos (el resto es el límite de Yjs de la sección 6). **No compara con hoy:** el prototipo de una página sola (186 de 300, 2 con algo de menos) usa otro generador. La comparación controlada es la de la auditoría: misma secuencia, idénticos (1.844 de 3.000 exactas y 14 de 3.000 con algo de menos con y sin "un paso por vez") |
| **La pila pasada a otro editor real de BlockNote** (auditoría) | montar no deja nada en la pila; deshacer y rehacer exactos; lo del otro queda |
| ***Undo* del panel fuera de orden** con el editor real (auditoría) | por las anclas, "Toma 1: cámara"; por la pila de Yjs fuera de orden, "Toma 1: " (DH10) |
| **Línea de tiempo montando y desmontando** (auditoría: solo la página en pantalla tiene `UndoManager`, uno temporal para el reemplazo; 1.000 semillas × 3) | sin deshacer en el medio, 1.000 de 1.000 exactas; con deshacer en el medio, 0 con algo de menos; con el otro, 0 borrados del otro |
| **Línea de tiempo al azar con el otro** escribiendo y borrando en las tres páginas | 300 corridas, 10.146 pasos deshechos: **0** caracteres del otro borrados por un deshacer y los dos dispositivos iguales en todas |
| **Memoria** de un documento retenido con su pila (Yjs solo) | 0,33 MB (página de 26 KB guardada) y 0,94 MB (90 KB); unos 0,9 KB por paso |
| **Memoria con el editor real** (auditoría; página de 115 KB, 30 pasos) | 1,18 MB el documento; la pila +1,05 MB con el meta del editor viejo, +0,52 MB limpiándolo (3.2) |

**Lo que mostró el prototipo y entra en el diseño:** Yjs, si un paso no cambia nada, sigue solo con el anterior de la
misma pila (`popStackItem`), y eso saltearía un paso de otra página que iba antes: la línea de tiempo le pasa a Yjs un
paso por vez. Después de rehacer, Yjs no corta el tiempo, y lo que se escribe medio segundo después se pega al paso
rehecho: la línea de tiempo corta (`stopCapturing`) después de cada deshacer y rehacer, y al empezar un paso en una
página corta las demás. Escribir dentro del mismo paso (`stack-item-updated`) también borra lo que había para rehacer.

**No se pudo medir acá:** el salto de página con el editor real (cuánto tarda en montarse con el documento ya en
memoria), el gesto de deshacer de iOS en la PWA, y Safari.

## 10. Lo que queda afuera (por ahora)

- **El árbol:** crear, mover, mandar a la papelera, renombrar y el reporte del día no entran (DH1). Tienen su propio
  camino (la papelera se restaura) y van por la cola del árbol ("gana el último"), no por Yjs.
- **El título** sigue con el deshacer del campo.
- **Los comentarios** no entran.
- **Botones de deshacer en el teléfono** (DH8): al roadmap.

## 11. Decisiones

### DH1 · Qué entra en la línea de tiempo

**Qué pasaba:** escribís en *Shot 3*, reemplazás en 50 páginas, movés la página *Shot 7* a otra carpeta y escribís en
*Shot 12*. ¿Qué deshace cada ⌘Z?

**Las opciones:**
- **A.** Cada paso del deshacer de cada página (lo que hoy deshace ⌘Z en la página) y cada reemplazo del proyecto; en la
  entrega 3, también anotar una foto (todo lo de esa vez, un paso). Mover, crear, papelera, títulos y comentarios no:
  **un ⌘Z después de mover *Shot 7* o de renombrarla saltea eso** y deshace lo anterior, que puede estar en otra página
  (te lleva). En el ejemplo: ⌘Z saca lo de *Shot 12*, el siguiente el reemplazo, el siguiente lo de *Shot 3*; *Shot 7*
  queda movida.
- **B.** Solo los reemplazos del proyecto; la página sigue con su ⌘Z propio, y el reemplazo se deshace con ⌘Z cuando es
  lo último de esa página (como VS Code).
- **C.** A, y además el árbol: mover, crear, mandar a la papelera, renombrar.

**Elegí A** porque es lo que pediste (el orden en que editaste, con el reemplazo adentro) usando lo que ya anda, y el
árbol tiene su propio camino y otra forma de sincronizar.

**Si preferís otra:** B es más chica (la mitad del trabajo) pero no sigue tu orden entre páginas; C es una entrega
aparte, mediana.

### DH2 · ⌘Z cuando lo último fue en otra página

**Qué pasaba:** escribiste en *Shot 3*, pasaste a *Shot 12* sin escribir y apretás ⌘Z.

**Las opciones:**
- **A.** La app va a *Shot 3*, muestra el bloque y lo deshace ahí. Aviso "Undone in “Shot 3” · Back". Manteniendo
  apretado no cruza de página.
- **B.** El primer ⌘Z solo te lleva y te muestra qué se va a deshacer; el segundo lo deshace.
- **C.** No te mueve: avisa "The last change is in “Shot 3” · Go there".

**Elegí A** porque hace lo que pediste en un solo ⌘Z y nunca cambia algo que no estés viendo.

**Si preferís otra:** B y C son cambios chicos.

### DH3 · ⌘Z cuando lo último fue un reemplazo del proyecto

**Qué pasaba:** reemplazaste en 50 páginas y apretás ⌘Z.

**Las opciones:**
- **A.** Se deshace en las 50, sin preguntar, con el aviso "Undid “Cámara” → “Camera” in 50 pages · Redo".
- **B.** Pide confirmación antes ("Undo the replace in 50 pages?").

**Elegí A** porque es lo que pediste, ⌘⇧Z lo vuelve a hacer y el aviso dice cuántas páginas tocó.

**Si preferís otra:** B es un cambio chico.

### DH4 · Cuánto dura la línea de tiempo

**Qué pasaba:** hoy la historia de una página se pierde al salir de ella; los reemplazos quedan en el panel aunque
cierres la app.

**Las opciones:**
- **A.** Mientras la pestaña esté abierta, por proyecto, hasta 20 páginas y 1000 pasos. Al recargar empieza vacía; los
  reemplazos siguen en el panel con *Undo*.
- **B.** Que los reemplazos sigan en la línea de tiempo después de recargar (los pasos de página no pueden).

**Elegí A** porque un ⌘Z al día siguiente que cambia 50 páginas sorprende, y los pasos de página no se pueden llevar a
otra sesión (medido).

**Si preferís otra:** B es un cambio chico. Más páginas o pasos: ocupan memoria (una página grande, cerca de 1 MB).

### DH5 · Rehacer

**Qué pasaba:** hoy ⌘⇧Z rehace en la página, y el reemplazo no se puede rehacer (hay que volver a reemplazar).

**Las opciones:**
- **A.** ⌘⇧Z (y Ctrl+Y en Windows) rehace en el mismo orden, también un reemplazo y también en otra página (te lleva).
  Algo nuevo en cualquier página borra lo que había para rehacer.
- **B.** Rehacer solo en la página, y el reemplazo sin rehacer.

**Elegí A** porque deshacer sin rehacer es perder algo con un ⌘Z de más.

**Si preferís otra:** B es más chica.

### DH6 · Otro editó después lo mismo

**Qué pasaba:** escribiste "cámara roja"; otra persona agregó "XX" adentro. Apretás ⌘Z.

**Las opciones:**
- **A.** Lo tuyo se va y lo suyo queda (queda "XX"), como el ⌘Z de hoy. En un reemplazo, lo mismo en las páginas que
  editaste en la sesión; en las demás, lo que el otro cambió queda como está y el aviso lo cuenta con *Show*.
- **B.** Si otro tocó lo mismo después, no deshacer y avisar.

**Elegí A** porque nunca borra nada del otro (medido) y es lo que ya hace hoy ⌘Z en la página.

**Si preferís otra:** B es mediano y deja cosas sin deshacer que hoy sí se deshacen.

### DH7 · Una línea de tiempo por proyecto

**Qué pasaba:** escribiste en el proyecto MGTZD, cambiaste a ERSO y apretás ⌘Z.

**Las opciones:**
- **A.** Cada proyecto tiene la suya: ⌘Z en ERSO no te lleva a MGTZD. Al volver a MGTZD sigue ahí.
- **B.** Una sola para todo el workspace.

**Elegí A** porque el reemplazo es de un proyecto y saltar de proyecto con un ⌘Z desorienta.

**Si preferís otra:** B es un cambio chico.

### DH8 · El teléfono

**Qué pasaba:** en el teléfono no hay ⌘Z, y hoy tampoco hay botón de deshacer.

**Las opciones:**
- **A.** Lo del sistema (teclado físico, el gesto de deshacer de iOS) va a la línea de tiempo; sin botón nuevo por ahora.
- **B.** Botones *Undo* y *Redo* en la barra del teléfono.

**Elegí A** porque no suma pantalla y el pedido es el orden, no un botón.

**Si preferís otra:** B es chico; queda en el roadmap.

### DH9 · ⌘Z en el panel de búsqueda, justo después de reemplazar

**Qué pasaba:** apretás *Replace all* y el foco queda en el panel; ⌘Z ahí hoy deshace lo que escribiste en el campo.

**Las opciones:**
- **A.** Hasta que escribas en un campo del panel, ⌘Z ahí deshace el reemplazo (como el título recién creado desde una
  plantilla).
- **B.** ⌘Z en el campo es siempre del campo.

**Elegí A** porque el ⌘Z que apretás justo después de reemplazar es para el reemplazo.

**Si preferís otra:** B es no hacer nada.

### DH10 · *Undo* del aviso o del panel cuando el reemplazo ya no es lo último

**Qué pasaba:** reemplazaste, escribiste en otra página, y apretás *Undo* en "Last" del panel.

**Las opciones:**
- **A.** Se deshace igual: en las páginas que editaste en la sesión, por su pila (ese paso solo, aunque no sea el
  último), y en las demás por las anclas, como hoy. Sale de la línea de tiempo, no se rehace con ⌘⇧Z y lo escrito
  después queda.
- **B.** Lo mismo, pero por las anclas en todas las páginas (como hoy): más simple, y vuelve a dejar el "cámara" de
  más de 1.3 si después deshacés lo que escribiste antes del reemplazo.
- **C.** Solo si es lo último; si no, el botón no está.

**Elegí A** porque es lo que hace hoy el botón, sin el texto de más (medido con el editor real).

**Si preferís otra:** B y C son cambios chicos.

## 12. Pruebas

- **Núcleo, sin pantalla** (`src/ui/undoTimeline.test.ts`, con `PageDocs`, IndexedDB y el servidor de prueba): el orden
  con varias páginas; la pila que sobrevive al desmontar y volver; el documento retenido que no se destruye y se suelta
  al pasar el tope; el paso que no cambia nada (no cruza ni se saltea otra página); `stack-item-updated` y rehacer; el
  asistente que deshace su propio paso; el documento rearmado (`stale`) que saca sus pasos y suelta la referencia antes
  de que la página vuelva a abrir (la página abre el documento nuevo); pasar la pila con el editor real: el `meta` sin
  bindings viejos, una lista no vacía que no se pisa, y la memoria antes y después; restaurar una versión y el
  asistente que deshacen por la línea de tiempo (nada queda en una lista que ella no conoce, la marca *Restored from…*
  se entera después de volver a la página); lo escrito de fondo que no entra ni borra lo de rehacer.
- **Reemplazo** (`src/search/projectReplace.test.ts`): el hueco de 1.3 arreglado (deshacer el reemplazo y después lo
  escrito antes: exacto); páginas con y sin historia en el mismo reemplazo; rehacer por la pila y por las anclas
  (`planRedo`, en `replaceDoc.test.ts` con sus casos y al azar); *Undo* del panel fuera de orden (DH10): por la pila en
  las páginas con historia, y después ⌘Z, ⌘Z deja "Toma 1: " exacto; con el otro a la vez (al azar, `TIMELINE_SEEDS`):
  nada del otro borrado y los dos iguales.
- **El límite de Yjs** (entrega 0, hecha): `src/ui/yjsUndoRedone.test.ts` (los casos mínimos, el archivo de `require`,
  3.000 semillas al azar y 500 con otra persona a la vez) y `src/ui/yjsUndoRedoneEditor.test.ts` (con el editor real,
  Enter y Backspace). En la entrega 1, la prueba al azar de la línea de tiempo cuenta además las "con algo de menos" y
  **borra y deshace bloques enteros** (con tablas y fotos): con texto tienen que seguir en cero con "un paso por vez";
  con bloques enteros, no más que el resto conocido de 16.4.
- **Pantalla** (jsdom, la app de verdad): ⌘Z en otra página (va, muestra, deshace, *Back*); mantener apretado no cruza;
  ⌘Z con el foco en el árbol; en el título y en un comentario no; el campo del panel recién reemplazado (DH9); los avisos;
  ⌘Z en la Mac sí y Ctrl+Z en la Mac no (`macShortcuts.test.ts`); el registro de atajos (`shortcuts.test.ts`).
- **Versión publicada** (`*.published.test.ts`): abre las páginas deshechas y rehechas sin escribir nada.
- **Cada protección falla sin ella** (sacándola una por una): un paso por vez, cortar el tiempo, retener el documento,
  sacar el paso al deshacer fuera de orden.
- **Recorrido en Chromium** (arnés local sin login, sobre el servidor en memoria; en la compu y a 390 px): el ejemplo de
  3.5 completo, sin red, y un segundo dispositivo que baja todo al final igual.

## 13. Entregas

0. **Hecha (v0.132): el límite de Yjs de la sección 6 (B.21).** La causa, el parche y lo medido, en la sección 16.
1. **Hecha (v0.140, sección 17): la línea de tiempo con las páginas.** La pila de cada página que sobrevive al cambiar de página (retener y pasar
   la pila sin el meta del editor viejo, 3.2), ⌘Z y ⌘⇧Z en orden entre páginas (DH2), fuera del editor, quienes llaman
   directo al deshacer (3.4), lo de fondo fuera de la pila, topes, ayuda y atajos. **Aceptación:** escribir en *A*, en
   *B* y en *A*; desde *C*, tres ⌘Z deshacen *A*, *B* y *A* en ese orden, cada uno con su página en pantalla, y tres ⌘⇧Z
   lo vuelven; con otro dispositivo escribiendo en *A* a la vez, lo suyo queda; **la memoria medida con el editor real**
   (en Chromium y en el iPhone) con 20 páginas retenidas, para fijar el tope.
2. **Hecha (v0.144, sección 18): el reemplazo adentro.** La pila de Yjs en las páginas con historia, las anclas en las demás, `planRedo`, los avisos
   con *Redo*, DH9 y DH10. **Aceptación:** el ejemplo de Lega (3.5) en Chromium con 50 páginas: dos ⌘Z dejan las 50 como
   antes y lo escrito antes del reemplazo sale exacto (sin el "cámara" que queda hoy); ⌘⇧Z lo vuelve; sin red, igual.
3. **Hecha (v0.152, sección 19): anotar como un paso.** Lo de una vez en el anotador como un paso al cerrarlo (es algo
   que hiciste en la página; la auditoría pidió que no sea opcional). DH1 C y DH8 B, si Lega los pide, aparte.
   **Aceptación:** anotar, cerrar, ⌘Z saca todo lo de esa vez y ⌘⇧Z lo vuelve.

Cada entrega con su auditoría antes de publicar.

## 14. Riesgos

1. **Memoria en el teléfono.** 20 documentos retenidos con su historia son unos 25 a 35 MB con el editor real (si se
   limpia el meta del editor viejo; sin limpiarlo, casi el doble en la pila). Si el iPhone aprieta, bajar el tope a 10
   páginas. A medir en la entrega 1.
2. **El `UndoManager` temporal del reemplazo** tiene que usar las mismas opciones que el de y-prosemirror (el filtro que
   protege los párrafos y la marca de huecos estables del parche, `defaultDeleteFilter`): si no, deshacer podría sacar
   la marca del renglón. Una prueba lo compara.
3. **Pasar la pila de un editor a otro** depende de que y-prosemirror y BlockNote no cambien cómo arman el plugin
   (comprobado con el editor real de hoy; se vuelve a probar al actualizarlos, como los parches de `Doc_Colaboracion.md`).
   La selección guardada en cada paso tiene como clave el *binding* del editor viejo: se borra al pasar la pila (si no,
   retiene el editor viejo entero en memoria, 3.2) y, al deshacer un paso de antes del cambio de página, el cursor no
   vuelve solo; la línea de tiempo muestra el bloque.
4. **Saltar de página puede sorprender** (DH2). El aviso con *Back* y no cruzar manteniendo apretado lo atenúan.
5. **El límite de Yjs de la sección 6** quedó arreglado con un parche a Yjs (entrega 0, sección 16). Lo que queda es un
   parche más que rehacer al actualizar Yjs (las pruebas y el build lo avisan) y los restos raros de 16.4: las mismas
   letras en otro orden (algunos casos los trae el parche), una letra de antes de menos al deshacer bloques enteros
   (menos que antes) y una excepción de Yjs con dos personas que ya existía.
6. **Quien llame directo al `UndoManager`** (código nuevo que se olvide de la línea de tiempo) deja pasos que ella no
   conoce. Una prueba recorre `src` buscando `.undo()` y `.redo()` sobre un `UndoManager` fuera de la línea de tiempo.
7. **Rehacer un reemplazo por las anclas** (`planRedo`) es código nuevo con la misma regla que `planUndo`; necesita sus
   pruebas al azar como las de `planUndo`.

## 15. Lo que no se pudo comprobar

- El gesto de deshacer de iOS en la PWA instalada (si llega como `historyUndo`), y Safari de Mac.
- Cuánto tarda en montarse el editor al saltar de página con el documento ya en memoria (se espera poco: no hay que
  leer IndexedDB).
- El uso de memoria real en el iPhone con 20 páginas retenidas.
- El orden de armado y desmontado de React al cambiar de página (3.2, "Cuándo"): leído, no medido con la app entera.

## 16. Entrega 0: el límite de Yjs (B.21), cómo quedó (v0.132)

### 16.1 La causa

Deshacer un borrado no revive las letras borradas: Yjs escribe **copias** nuevas y anota en cada letra original dónde
quedó su copia (`item.redone`, solo en memoria; no viaja ni se guarda). Al deshacer después lo que se había escrito,
`popStackItem` (`UndoManager.js`) busca lo que hoy ocupa ese texto con `followRedone`, que devuelve **un solo item**: el
que tiene la primera letra de la copia (el propio Yjs lo marca: `@todo This should return several items`). Y se borra
ese item entero. De ahí salen los dos síntomas:

- **Restos.** Si después se escribió en el medio de la copia, Yjs la partió en dos items: se borra el primero y el
  segundo queda. Caso mínimo: escribir "Xx" en "abcdefgh", borrarlo, ⌘Z, escribir "Yy" entre la X y la x, deshacer
  todo: queda "abcdefxgh".
- **Texto de menos.** Si un mismo deshacer volvió a poner varias cosas seguidas, sus copias tienen relojes seguidos y
  Yjs las junta en un solo item (`mergeWith`). Buscar la copia de una sola letra devuelve el item juntado, y se borra
  todo: también la copia de texto de antes. Caso mínimo: escribir "Xx" en "abcdefgh", borrar la "f", ⌘Z, borrar "xfg",
  deshacer todo: queda "abcdegh" (se fue la "f", que era de antes).

El mismo "solo la primera parte de la copia" aparece en `redoItem` (`Item.js`) al ubicar lo que vuelve a un texto que se
volvió a crear (un renglón juntado con Backspace y deshecho): el vecino izquierdo era la primera parte de su copia, y lo
vuelto aparecía en el medio del vecino ("abXcdYef" en vez de "abXYcdef").

### 16.2 El arreglo

Un parche a Yjs (`patches/yjs+13.6.33.patch`, con `patch-package`, igual que el de y-prosemirror), marcado
`LGA-SHOTDOCS-PATCH (B.21)` en `dist/yjs.mjs` (la app y las pruebas), `dist/yjs.cjs` (`require`) y `src`:

- `popStackItem` sigue la copia **en todo su largo**: una copia tiene el mismo largo que lo copiado y relojes seguidos,
  así que lo que ocupa hoy lo insertado es el tramo exacto `[redone, redone + largo)`, partido en los bordes y siguiendo
  las copias de las copias (`lgaFollowRedoneRange`). Primero se juntan los items y después se siguen las copias (nada se
  parte mientras se recorre), en el mismo orden de antes: se borra al revés, los hijos antes que los padres (el filtro
  que protege los párrafos, `defaultDeleteFilter`, mira si quedaron vacíos).
- `redoItem` toma como vecino izquierdo la copia de la **última** letra del vecino.
- `yjs` queda fijo en `13.6.33` en `package.json` (si sube, el parche no aplica y `npm ci` falla). `vite.config.ts`
  (`assertYjsPatched`) no deja correr ni el build ni las pruebas sin el parche.

Deshacer sigue sacando solo lo propio: las copias son siempre del propio dispositivo, y lo que otro escribió adentro
tiene otro cliente y no entra en el tramo.

### 16.3 Lo medido

| Prueba | Sin el parche | Con el parche |
|---|---|---|
| Al azar, una página (el generador de la auditoría, 60 acciones; 3.000 semillas): deshacer todo | 1.844 exactas, 14 con algo de menos | **3.000 exactas, 0** |
| Lo mismo con "un paso por vez" (la línea de tiempo) | idéntico: 1.844 y 14 | **idéntico: 3.000 y 0** |
| Rehacer todo después de deshacer todo (contra lo último más lo que quedaba para rehacer) | 3.000 exactas | 3.000 exactas |
| Con otra persona escribiendo a la vez (3.000 corridas, dos documentos conectados) | 219 con restos propios, 3 con texto de antes de menos | **0 y 0**; nada del otro se va y los dos iguales, en los dos casos |
| Con el editor real (BlockNote, 300 semillas de 40 acciones con Enter, Backspace, ⌘Z y ⌘⇧Z) | 226 exactas, 68 con letras de más, 1 con letras de menos, 295 rehacen exacto | **299 exactas, 0, 0, 300** |
| Lo mismo, 2.000 semillas de 20 acciones | — | 1.999 exactas, 0 con letras de más o de menos |
| **Auditoría:** editor real borrando bloques enteros (1 o 2), con tabla y fotos (300 × 40) | 248 exactas, 32 con letras de más, 7 con letras de menos, 15 en otro orden, rehacer 298 | **296 exactas, 0 de más, 1 de menos, 3 en otro orden**, rehacer 299 (las 4 no exactas tampoco lo eran sin el parche); fotos intactas 300/300 |
| **Auditoría:** modelo de párrafos de Yjs (crear, borrar 1 o 2 enteros, escribir adentro, deshacer; 3.000) | 2.343 exactas, 112 con letras de antes de menos | **2.971 exactas, 10 con letras de menos**; 5 peores que sin parche, todas en otro orden (16.4) |
| **Auditoría:** dos personas con versiones mezcladas (vieja y nueva, texto y párrafos; 3.000 por combinación) | convergen como vieja con vieja | igual: ninguna deja de converger por el parche; 0 veces el deshacer de uno borró algo del otro |

Las cifras de "0 con algo de menos" son **con texto** (escribir, borrar tramos, Enter y Backspace). Borrando y
deshaciendo bloques enteros queda un resto chico, menor que antes (16.4).

Las pruebas: `src/ui/yjsUndoRedone.test.ts` (los tres casos mínimos, `dist/yjs.cjs`, 3.000 semillas y 500 con otra
persona) y `src/ui/yjsUndoRedoneEditor.test.ts` (los dos casos con el editor y 150 semillas). Todas fallan sin el parche
(comprobado con la librería original).

### 16.4 Lo que queda

- **Las mismas letras en otro orden**, sin nada de más ni de menos: 1 de 300 con el editor (semilla 123, "segundo
  rglónen" en vez de "segundo renglón") y 1 de 2.000 con 20 acciones. Pasa cuando lo que vuelve tiene como vecino algo
  que se borró y volvió en otro lado: Yjs lo ubica al lado del original borrado y no de su copia. Seguir la copia
  también en ese caso no lo arregla del todo (se probó: la semilla de 20 acciones sigue igual y rehacer empeora de 300 a
  297 exactas), así que no se tocó. La prueba del editor lo deja anotado como caso conocido.
- **Algunos de esos casos los trae el parche** (auditoría). La parte de `redoItem` toma como vecino izquierdo el item
  que **termina** en la última letra de la copia, pero ese item puede empezar antes; si en la misma función el vecino
  derecho parte esa copia, el izquierdo queda más corto y lo que vuelve cae en el medio del vecino (modelo de párrafos,
  semilla 70347: "uno" queda "uon"; sin el parche salía exacto). En 3.000 semillas del modelo de párrafos son 5 peores
  que sin parche, contra 633 que el parche deja exactas y antes no lo eran; con el editor real no apareció ninguno. La
  corrección probada (volver a ubicar el vecino izquierdo después de buscar el derecho) los saca, pero sube los casos de
  documento local distinto de lo guardado (abajo) de 33 a 52: **no se aplicó sin medir más**. Va en el reporte a Yjs.
- **Una letra de antes de menos al deshacer bloques enteros** (auditoría): 1 de 300 con el editor, borrando y
  deshaciendo uno o dos bloques con tablas y fotos (semilla 181: "la cámara" queda "a cámara"; sin el parche también
  fallaba, y eran 7 de 300), y 10 de 3.000 en el modelo de párrafos (antes 112). Es Yjs; el parche lo reduce pero no lo
  saca.
- **El documento local distinto de lo guardado** (auditoría; de Yjs, previo al parche): en el modelo de párrafos, después
  de deshacer o rehacer, el orden en memoria a veces no coincide con el que sale al rearmarlo desde sus ediciones (lo que
  ve otro dispositivo o la misma página al recargar): 42 de 3.000 sin el parche y 33 con él; con texto, 0; con el editor
  real, 1 de 300 en los dos. Nunca faltan letras: solo cambia el orden, y recargar lo arregla. **Arreglado en B.26
  (sección 21)**, junto con lo de volver a ubicar el vecino izquierdo: era la causa de los textos distintos con dos
  personas.

Todo es raro, se ve y se arregla escribiendo; lo único con algo de menos es lo de los bloques enteros, menos que antes, y
la letra está en el historial de versiones.

### 16.5 Versiones viejas y otros dispositivos

`redone` vive solo en la memoria del dispositivo (Yjs no lo guarda ni lo manda). Lo que hace el parche es decidir qué
borra y dónde escribe **el deshacer de este dispositivo**; lo que sale son borrados e inserciones comunes que una
versión vieja aplica como cualquier edición. Una versión vieja en otro dispositivo sigue con su ⌘Z de antes (con
restos), sin cruzarse con este. **No hace falta subir `min_app_version`.**

### 16.6 Lo que cambia para la entrega 1

- La comparación "un paso por vez" contra el deshacer de Yjs tal cual da idéntico con el parche: el diseño de 3.4 no
  cambia.
- Con la línea de tiempo se deshace más lejos, que era lo que hacía visible el límite: ya no es condición.
- `redone` está en los items del documento, no en el `UndoManager`: pasar las listas de un editor al siguiente (3.2) y
  el `UndoManager` temporal del reemplazo (3.3) lo usan igual. Un documento rearmado lo pierde, que ya era la razón por
  la que la pila no sobrevive a recargar.
- La prueba al azar de la línea de tiempo (sección 12) cuenta las "con algo de menos" y las "con letras de más": cero
  con texto; con bloques enteros borrados y deshechos, no más que el resto de 16.4.
- **La excepción de Yjs con dos personas** (auditoría, previa al parche): con dos editores reales (1 de 150) y en 24 de
  3.000 del modelo de párrafos, `UndoManager.undo()` tira `TypeError` (`reading 'client'`) en `redoItem`, cuando la copia
  del padre ya fue recolectada y `redone` queda sin valor. Con la línea de tiempo se deshace más lejos: la entrega 1
  tiene que atrapar esa excepción en su deshacer (descartar el paso y avisar, como un paso que no cambia nada, 3.4) y
  medirla. Está en el roadmap (B.22). **Medida y arreglada en el parche (v0.0XX, sección 20).**
- **Al actualizar Yjs** (o al pasar a `@blocknote/core/y`, Yjs 14, `Doc_Colaboracion.md`): ver si la versión nueva ya lo
  trae; si no, rehacer el parche en los tres archivos y `npx patch-package yjs`. Las dos pruebas lo cubren. Conviene
  reportarlo a Yjs con los dos casos mínimos de 16.1.

## 17. Entrega 1: cómo quedó (v0.140)

### 17.1 Qué se hizo

- **`src/ui/undoTimeline.ts`**: la línea de tiempo (una por instancia de servicios, `undoTimelineFor`). Cada página con
  pasos tiene su entrada: el documento (retenido con `docs.open` desde el primer paso), y sus listas de Yjs mientras no
  hay editor; con el editor en pantalla, las listas son las de su `UndoManager`. Cada paso lleva un número de orden
  (`WeakMap` sobre el `StackItem`: el momento en que se creó o se extendió); el próximo ⌘Z es el paso de arriba con el
  número más alto entre las páginas del proyecto (DH7). `step` le pasa a Yjs un paso por vez (los de abajo se sacan un
  momento) y corta el tiempo después. Topes de 20 páginas y 1000 pasos (lo más viejo se olvida y se suelta su
  documento); el aviso de `docs.ts` (`subscribeUnsupported`) suelta la referencia en el momento y deja una marca para
  avisar en el próximo ⌘Z que llegue ahí.
- **`src/ui/PageEditor.tsx`**: el editor de la página de verdad (no la práctica ni una versión del historial) se anota
  al montarse la vista (`editor.onMount`) y se va al desmontarse. Lo que da: el `UndoManager` de y-prosemirror, su
  *binding* (para borrarlo del `meta` de cada paso al irse), si se puede editar, y cómo mostrar un cambio
  (`undoReveal.ts`: el cursor donde empieza la diferencia, abriendo la sección colapsada que lo esconde).
- **`src/ui/undoTimelineUi.ts`** (montado en `Workspace.tsx`): ⌘Z, ⌘⇧Z y ⌘Y (Ctrl en Windows; `modPressed`/`isLetter`)
  en `window`, en la fase de captura, con el foco en el editor de la página o fuera de un campo de texto (el árbol, un
  botón); no con un diálogo, el carrete o el anotador abiertos, ni en el título, un comentario o la búsqueda. Va a la otra
  página, espera hasta 10 s a que su editor esté listo y editable, deshace y avisa "Undone in “Shot 12” · Back".
  Manteniendo apretado no cruza; mientras va, los ⌘Z que llegan no hacen nada. `undoGuard.ts` manda el `historyUndo`
  del navegador (menú Edición, gesto de iOS) a la línea de tiempo.
- **Lo de fondo, fuera de la pila** (`addToHistory: false`): pasar una imagen `data:` a archivo, sacar el bloque de una
  subida que falló, poner la dirección al terminar de subir y renombrar un HEIC a `.jpg`.
- **`historyRestore.ts`**: la marca *Restored from…* se entera también por la línea de tiempo (`subscribeStepPopped`)
  cuando el paso se deshace con otro editor de la misma página.
- Atajos (`shortcuts.ts`: `undo` y `redo` pasan a ser de la app; `shortcutSources.ts`), la ayuda (`help.undo.text`) y los
  avisos en inglés y castellano (`src/i18n/shell.ts`).

### 17.2 Diferencias con el diseño (decididas al implementar)

- **Quienes llaman directo al `UndoManager` no se cambiaron.** El asistente, restaurar una versión y el título recién
  creado desde una plantilla deshacen su propio paso, que siempre es el de arriba de la página en pantalla. En vez de
  pasarlos por una función de la línea de tiempo, la línea de tiempo escucha los eventos de esa pila
  (`stack-item-added`, `-updated`, `-popped`), así lo que hagan queda en el orden igual. Menos código tocado en zonas de
  otros frentes, y un llamador nuevo tampoco puede dejar un paso que ella no conozca. La prueba de riesgo 6 (buscar
  `.undo()` en `src`) no hace falta.
- **Mientras el editor está en pantalla, las listas son las de su `UndoManager`.** Yjs reemplaza la lista de rehacer
  (`clear`) con cada edición nueva: guardar la misma lista y compartirla no sirve. La línea de tiempo las lee del
  `UndoManager` montado y se las queda al irse.
- **C1 (el *Undo* del panel fuera de orden) y DH9 van con la entrega 2**: en esta entrega el reemplazo no cambia (anclas,
  como hoy). Con las pilas que ahora sobreviven, el resto de 1.3 ("Toma 1: cámara") se puede ver también después de
  cambiar de página; no se pierde nada, sobra texto, y lo arregla la entrega 2.
- **B.22**: si Yjs tira el error al deshacer, el paso se descarta, se avisa "Nothing to undo there…" y ese ⌘Z se frena
  (no sigue con el anterior aunque sea de la misma página: Yjs pudo haber dejado algo a medias).
- **Una página en la papelera, borrada o sin permiso de editar**: se olvidan todos sus pasos (no solo el de arriba) y se
  avisa una vez "Can't undo in “Shot 12”: it's in the trash. ⌘Z again for the previous change."
- **El cursor**: un paso de antes de cambiar de página no guarda la selección del editor nuevo; al deshacerlo, el cursor
  va donde empieza el cambio (y se abre la sección colapsada). Con el foco en el árbol y el paso en la misma página, solo
  se mueve la vista.
- **Lo ajeno adentro de un renglón tuyo (auditoría B1).** Creás un renglón ("Toma 3:"), otra persona escribe adentro
  ("— buena") y más tarde deshacés hasta antes del renglón: Yjs borraba el `blockContainer` (tuyo) y con él lo del otro.
  Ya pasaba antes en la misma página; con la pila que dura toda la pestaña pasa mucho más. Ahora la línea de tiempo
  envuelve el filtro de borrado del `UndoManager` montado (`protectOthers`): no se borra un elemento con algo vivo de
  otro autor adentro, ni sus atributos (sin el `id`, el editor le pondría uno nuevo y esa edición borraría lo de
  rehacer). Lo tuyo de adentro se va; el renglón queda con lo del otro. Queda un caso de Yjs: lo del otro que vos
  borraste y volviste a poner con ⌘Z ya es una copia tuya, y se va con el renglón si después deshacés hasta antes de
  crearlo (1 letra en 300 corridas). Si Yjs le cambió el autor al documento (B.16), puede sobrar un renglón tuyo.
- **Avisos de la auditoría:** si después de cruzar el paso no cambió nada a la vista (O2), se avisa "Nothing to undo
  there…" en vez de "Undone in…"; lo que olvidó el tope (O3) se avisa una vez cuando ⌘Z llega ahí: "Older changes can't
  be undone: undo keeps your last 20 pages and 1000 changes in this tab."

### 17.3 Lo medido

| Prueba | Resultado |
|---|---|
| Aceptación en Chromium (arnés con la app de verdad, servidor en memoria; Windows con Ctrl y Mac con ⌘): escribir en A y en B, desde C dos ⌘Z y dos ⌘⇧Z, *Back* | cada paso en su página y en orden, con el aviso; en la Mac Ctrl+Z no hace nada; el otro dispositivo baja lo mismo; sin errores en la consola |
| Pasear entre páginas sin escribir (retener documentos) | 0 filas nuevas en el dispositivo y en el servidor |
| Memoria en Chromium con el editor real: 20 páginas retenidas con 5 pasos cada una | +13,2 MB con páginas de 60 KB (0,66 MB por página) y +19,1 MB con páginas de 115 KB (0,96 MB por página); sin borrar el `meta` del editor viejo, +31,5 MB con las de 115 KB (C2). El tope queda en 20 |
| Al azar con el editor, 3 páginas y cambios de página (300 semillas de 40 acciones, ⌘Z y ⌘⇧Z en el medio) | deshacer todo: 300 de 300 exactas, 0 con letras de menos ni de más; rehacer todo: 300 de 300 |
| Lo mismo borrando bloques enteros | deshacer todo: 297 de 300 exactas (300 de 300 con renglones nuevos, después de la auditoría), 0 con letras de menos; rehacer todo: 300 de 300 |
| Lo mismo con otra persona escribiendo y borrando en las tres, también adentro de renglones que creaste (después de B1) | 0 letras del otro borradas por un deshacer (sin el arreglo de B1: 51 en 60 corridas); 1 letra que era una copia tuya de lo del otro (17.2); los dos iguales en 300 de 300; ninguna excepción de Yjs (B.22) |
| Pruebas de mutación (cada protección sacada) | 8 de 9 hacen fallar alguna prueba: un paso por vez, retener el documento, borrar el `meta` del editor viejo, soltar al rearmarse, borrar lo de rehacer en las demás, el editor viejo con sus listas, soltar al olvidar, no pisar una lista. Sobrevive cortar el tiempo después de deshacer o rehacer: Yjs ya corta al deshacer, y no se puede rehacer con lo escrito todavía "abierto" (escribir borra lo de rehacer); queda como protección barata |
| Versión vieja (el esquema anterior) abriendo lo deshecho y rehecho entre páginas | no escribe nada al abrir y ve el mismo texto |
| Correcciones de la auditoría: B1 (cruzando y en la misma página), el deshacer del navegador por la línea de tiempo, lo de fondo fuera de la pila, un diálogo abierto, el tope que no suelta la página en pantalla y su aviso | cada una con su prueba, que falla sacando la protección |

Las pruebas: `src/ui/undoTimeline.test.ts` (núcleo con `PageDocs` y el editor real), `undoTimelinePage.test.tsx` (la app
en jsdom: otra página, *Back*, mantener apretado, el árbol, el título), `undoTimelineRandom.test.ts` (al azar; 12
semillas en la suite, `TIMELINE_SEEDS` para más) y las de atajos (`shortcuts.test.ts`, `macShortcuts.test.ts`).

### 17.4 Lo que falta

- La memoria en el iPhone con 20 páginas retenidas (si aprieta, el tope baja a 10) y el gesto de deshacer de iOS en la
  PWA instalada.
- La excepción de Yjs con dos personas (B.22) medida con dos editores borrando bloques enteros. **Hecho (v0.0XX):**
  medida y arreglada en el parche de Yjs (sección 20).
- Entregas 2 (el reemplazo adentro, C1, DH9, `planRedo`; hecha, sección 18) y 3 (anotar como un paso).
- Pruebas que faltan (auditoría, O1): no limpiar el `meta` al montar (A5), los ⌘Z que llegan mientras cruza (A7, probado
  en el navegador, sin prueba en la suite) y esperar a que el editor sea editable (A9). **Hechas con la entrega 2**
  (`undoTimeline.test.ts`; cada una falla con su mutante).

## 18. Entrega 2: cómo quedó (v0.144)

### 18.1 Qué se hizo

- **`src/ui/undoTimeline.ts`**: el reemplazo es una entrada de la línea de tiempo (`ReplaceEntry`) con su número de orden.
  `beginReplace` (con el primer cambio: borra lo que había para rehacer en el proyecto), `writeReplace` (en una página
  con historia en la sesión, lo escrito entra como un paso de su pila de Yjs: el `UndoManager` del editor si está en
  pantalla o uno de un momento, `tempManager`, con las mismas opciones y lo ajeno protegido; se corta el tiempo antes y
  después), `endReplace`, `popReplace` (deshace o rehace **ese** paso de la página aunque no sea el de arriba; lo
  contrario queda para rehacer, o se descarta fuera de orden) y `settleReplace` (pasa a la otra lista con las páginas
  hechas, o sale). Los pasos de un reemplazo quedan marcados: `peek` no los ofrece como pasos de página, ofrece la
  entrada. El tope olvida un reemplazo entero.
- **`src/search/projectReplace.ts`**: `ReplaceHistory` (la línea de tiempo vista desde el reemplazo); `run` escribe cada
  página por ella; `undo(opId, { inOrder })` usa la pila en las páginas con paso y las anclas en las demás; `redo` nuevo
  (vuelve a escribir el registro en `meta`); lo escrito queda en memoria (`SavedOp`) para rehacer y para deshacer uno
  que ya salió de los últimos 5 del panel.
- **`src/search/replaceDoc.ts`**: `planRedo` (el espejo de `planUndo`). Además, el vecino de un borrado que se borró y
  volvió con un deshacer (una copia de Yjs) cuenta como el mismo (`currentId`, abajo).
- **`src/ui/replaceUi.ts`**: `undoReplace` y `redoReplace` con sus avisos ("Undid “camara” → “Camera” in 53 pages ·
  Redo", "Redid … · Undo"). El *Undo* del aviso y del panel es en orden (como ⌘Z, con *Redo*) si el reemplazo es lo
  último, y fuera de orden si no (DH10, C1).
- **`src/ui/undoTimelineUi.ts`**: ⌘Z y ⌘⇧Z sobre un reemplazo lo hacen en todas sus páginas sin moverte; manteniendo
  apretado se frena antes; mientras corre, los demás no hacen nada.
- **`src/ui/ProjectSearch.tsx`** (DH9): recién reemplazado, ⌘Z y ⌘⇧Z en el panel (en el campo o en un botón) deshacen y
  rehacen el reemplazo, hasta que se escriba en el campo de buscar o en el del reemplazo.
- Ayuda (`help.undo.text`, `help.replaceProject.text` con `{redo}`), atajos (`shortcuts.ts`, `shortcutSources.ts`),
  textos en inglés y castellano (`shell.ts`; los avisos de deshacer un reemplazo pasan de `lazy/search.ts` a `shell.ts`
  porque ⌘Z los muestra sin el panel cargado) y el avance *Redoing…*.

### 18.2 Diferencias con el diseño (decididas al implementar)

- **Las anclas en orden entran en la pila cuando la página ya tiene historia.** Qué pasaba (la prueba al azar, semilla
  3003): una página sin historia al reemplazar va por las anclas; después escribís adentro de "Camera" ("Camwkera").
  Deshacer todo sale bien, pero al rehacer todo, `planRedo` escribe letras nuevas y lo que vuelve a poner Yjs ("wk")
  sigue a las letras viejas: quedaba "wkCamera". Ahora, si al deshacer (o rehacer) en orden por las anclas la página ya
  tiene historia, lo escrito entra en su pila como lo contrario (con `undoing` / `redoing` de Yjs, que no borra lo de
  rehacer), así rehacer es el de Yjs y sale exacto.
- **El vecino de un borrado que volvió con ⌘Z.** Deshacer un borrado por las anclas pide que los dos vecinos sigan
  vivos y pegados. Si un vecino se borró y volvió con un deshacer, es una copia (otro id, la misma letra) y contaba como
  cambiado: "la cámara roja" quedaba "la  roja" (semillas 3114 y 3285). Ahora se sigue la copia, como hace Yjs con las
  posiciones relativas. Vale también para el *Undo* del panel de siempre.
- **El *Undo* del aviso y del panel cuando el reemplazo es lo último** hace lo mismo que ⌘Z: queda para rehacer, con
  *Redo* en el aviso (antes no había rehacer).
- **Las páginas que no se pudieron deshacer** (papelera, sin permiso, sin bajar): su paso sale de la pila y quedan para
  *Undo the rest* del panel, por las anclas; ⌘⇧Z rehace solo las que se deshicieron.
- **Fuera de orden no borra lo de rehacer**: Yjs resuelve el orden y lo que estaba para rehacer sigue andando.
- **Un reemplazo que no cambió nada no borra lo de rehacer** (`beginReplace` va con el primer cambio).
- **Sin *Show*** en el aviso de ⌘Z cuando algo había cambiado: el aviso lo cuenta ("2 had changed…"); *Show* tampoco
  existía antes. Al roadmap.
- **El filtro del `UndoManager` de un momento se toma del editor** (el primero que se anota en la línea de tiempo) en vez
  de importar y-prosemirror: `undoTimeline.ts` va en la primera carga y la prueba `firstLoad.test.ts` no deja que la
  arrastre. Siempre hay uno: una página con historia la tuvo en pantalla. Una prueba lo compara con el de y-prosemirror.
- **A5, A7 y A9** (pruebas de la entrega 1) van con esta entrega.

### 18.3 Lo medido

| Prueba | Resultado |
|---|---|
| Aceptación en Chromium (arnés con la app de verdad, servidor en memoria, 53 páginas; Windows con Ctrl, Mac con ⌘, sin red y a 390 px) | *Replace all* "camara" → "Camera" en 53; ⌘Z en el panel lo deshace y ⌘⇧Z lo rehace (DH9); en Shot 12, ⌘Z saca lo escrito, ⌘Z deshace el reemplazo en las 53 sin moverte ("Undid … in 53 pages · Redo"), ⌘Z va a Shot 3 y deja "plano" exacto; tres ⌘⇧Z vuelven todo en orden; el otro dispositivo baja lo mismo; sin red queda pendiente y sube al volver; 0 errores en la consola. 69 de 69 comprobaciones |
| El hueco de 1.3 (D167) con el editor real | "Toma 1: " exacto, también cambiando de página; sin la línea de tiempo, "Toma 1: cámara" (la prueba lo muestra) |
| Al azar con el editor, 3 páginas, reemplazos en las tres (el motor de verdad, con su registro; 300 semillas de 40 acciones, 753 reemplazos) | deshacer todo: 300 de 300 exactas, 0 con letras de menos ni de más; rehacer todo: 300 de 300 (sin los dos arreglos de 18.2: rehacer todo exacto en 9 de 12 semillas sin el primero; deshacer todo exacto en 298 de 300 sin el segundo) |
| Lo mismo con el *Undo* del panel fuera de orden y otra persona escribiendo y borrando en las tres (625 reemplazos, 239 *Undo* del panel) | 0 letras del otro borradas, 300 de 300 iguales en los dos dispositivos, 0 excepciones de Yjs; 1 copia propia de lo ajeno (el caso de Yjs de 17.2) |
| Las de la entrega 1 (texto, bloques, con el otro), otra vez con 300 | sin cambios: 300 de 300, 300 de 300, 0 letras del otro |
| `planRedo` al azar con otra persona (300 semillas) | nada del otro borrado, los dos iguales; sin el otro, exacto |
| Pruebas de mutación (cada protección sacada) | 19 de 21 hacen fallar alguna prueba: entrar en la pila, cortar el tiempo antes y después, el paso marcado, fuera de orden solo ese paso y sin rehacer, las anclas en orden a la pila, borrar lo de rehacer (al escribir y al reemplazar), `planRedo` solo donde sigue lo de antes, DH9 (los dos campos), mantener apretado, las opciones del `UndoManager` de un momento, sacar lo que quedó, el vecino copia, y A5, A7 y A9. Sobreviven dos: `busy` mientras se deshace un reemplazo (el motor ya no deja correr dos a la vez) y olvidar por el tope el paso del reemplazo en vez de la entrada (en la vuelta siguiente se olvida la entrada; en el peor caso esa página va por las anclas) |

### 18.4 Lo que falta

- *Show* en el aviso de ⌘Z de un reemplazo con páginas cambiadas. **Hecho con la entrega 3 (19.1).**
- **Una página con historia en la papelera durante el ⌘Z de un reemplazo** (auditoría, O1). Escribís "cámara roja" en
  *Shot 3*, *Replace all*, mandás *Shot 3* a la papelera, ⌘Z (deshace en las demás; *Shot 3* "couldn't be undone
  now"), la restaurás y ⌘Z: deshace lo escrito pero queda "Toma 1: Camera"; *Undo the rest* lo deja "Toma 1: cámara"
  en vez de "Toma 1: ". Es el resto de D167 en ese rincón: texto de más, nada de menos. Causa: el paso de esa página
  sale de la pila al pasar el reemplazo a rehacer (18.2). Arreglarlo pide que un reemplazo quede a la vez para rehacer
  (las páginas hechas) y para deshacer (las que faltan): mediano, al roadmap. **Sigue pendiente** (19.4).
- Una prueba de la ventana de O4 (re-verificación): la marca de «algo nuevo en el medio» se toma antes del primer `await`; un
  mutante que la toma después sobrevive. El código está bien; falta la prueba. **Hecha con la entrega 3 (19.1).**
- La memoria en el iPhone (entrega 1) y el gesto de deshacer de iOS en la PWA instalada.
- Entrega 3 (anotar como un paso). **Hecha (sección 19).**

### 18.5 Correcciones de la auditoría

Auditoría independiente sobre `87baf3b`: aprobado con observaciones, sin bloqueantes; 450 semillas al azar propias, con
la otra persona escribiendo adentro de lo reemplazado, sin nada perdido.

- **O2, `busy` con prueba.** Con dos ⌘Z muy seguidos, el segundo llegaba al motor antes de que marcara que estaba
  corriendo: las anclas no escriben dos veces, pero el segundo descartaba el reemplazo y se perdía su ⌘⇧Z. `busy` ya lo
  frenaba; ahora una prueba lo comprueba (falla sin `busy`).
- **O3, pruebas de cuatro guardas**: un reemplazo sin cambios no borra lo de rehacer (18.2), el *Redo* de un aviso viejo
  no rehace fuera de orden, el paso de una página se deshace solo con su mismo documento, y `planRedo` no escribe en un
  bloque borrado. Las tres primeras fallan con su mutante; la de `planRedo` no puede: con el bloque borrado su texto
  ya no es lo de antes y sale "changed" igual.
- **O4, escribir mientras ⌘Z recorre un reemplazo largo.** Lo escrito borraba lo de rehacer en las páginas ya hechas,
  pero al terminar el reemplazo igual quedaba para rehacer. Ahora la línea de tiempo cuenta lo nuevo (`newEdits`) y, si
  hubo algo nuevo desde que empezó a deshacerse (`markReplace`), el reemplazo no queda para rehacer.
- **O1**: al roadmap (18.4). **Fuera de alcance, al roadmap:** después del *Undo* de "Last" del panel el foco queda en la
  página y Esc ya no cierra el panel (pasa igual en `main`; arreglado con la entrega 3, 19.1); con el panel abierto y el foco puesto por programa en el
  editor, Ctrl+Shift+Z deshace (una persona no llega ahí: el panel es modal).

## 19. Entrega 3: cómo quedó (v0.152)

### 19.1 Qué se hizo

- **`src/ui/undoTimeline.ts`**: lo anotado es una entrada de la línea de tiempo (`MarkupEntry`): la página, la foto, el
  mapa de anotaciones de su documento y los pasos del anotador de esa vez. `pushMarkup` la anota al cerrarse el
  anotador (algo nuevo: borra lo de rehacer en el proyecto, también en esa página); `stepMarkup` la deshace (o rehace)
  entera con un `UndoManager` de un momento sobre el mapa (`markupManager`, las mismas opciones que el del anotador),
  paso por paso hasta vaciar la lista, y lo contrario queda para rehacer. Cuenta como paso de la página: la retiene
  (`docs.open`), entra en los topes, sale con la papelera (`forget`), con el documento rearmado (con su aviso) y con algo
  nuevo si estaba para rehacer.
- **`src/ui/Annotator.tsx`**: al cerrarse o desmontarse, primero guarda el texto a medio escribir y después pasa lo que
  quedó en su pila (`onUndoSteps`); lo deshecho adentro y no rehecho se olvida. `PageEditor.tsx` lo manda a la línea de
  tiempo de la página (no en la práctica ni en una versión del historial).
- **`src/ui/undoTimelineUi.ts`**: ⌘Z sobre lo anotado va a su página si hace falta (como un paso de página, DH2), lo
  deshace y trae la foto a la vista (`revealPhoto` en `undoReveal.ts`: abre la sección colapsada y la acerca, sin mover
  el cursor). Si cruzó, "Undone in “Shot 3” · Back". Manteniendo apretado se frena antes (como un reemplazo).
- **Pendientes de 18.4:** *Show* en el aviso de deshacer un reemplazo con lugares que habían cambiado (`showChanged` en
  `replaceUi.ts`: va a la página y al bloque; con más de uno, *Next*); el aviso tiene un segundo botón para eso
  (`notice.ts`, `Workspace.tsx`). Después del *Undo* de "Last" del panel, el foco vuelve al campo del reemplazo
  (`keepFocusInPanel`, `ProjectReplace.tsx`) y Esc cierra el panel. La prueba de la ventana de O4 (escribir antes de que
  el motor lea su registro).
- Ayuda: `help.undo.text` (anotar es un paso) y `help.photosAnnotate.text` (al cerrarlo, ⌘Z en la página deshace todo lo
  de esa vez); textos nuevos en inglés y castellano (`shell.ts`). Sin atajos nuevos.

### 19.2 Diferencias con el diseño (decididas al implementar)

- **Lo de otra persona en la misma foto.** Deshacer sigue solo el origen de la foto y Yjs no vuelve a poner un campo que
  otro cambió después, pero borraba igual algo tuyo con lo del otro adentro: deshacer la forma que creaste se llevaba
  el cambio que otra persona le hizo (moverla, cambiarle el color), y deshacer la primera anotación de una foto borraba
  el marco aunque el otro hubiera dibujado con él (sus formas quedaban sin marco, sin verse). Ahora el filtro de borrado
  (`protectMarkupOthers`, el mismo criterio que B1 en el texto) deja la forma con lo del otro adentro, entera, y
  **deshacer nunca borra el marco de una foto** (corrección de la auditoría, 19.5: mirar si quedaban formas no
  alcanzaba con el otro sin red). Vale también para el ⌘Z adentro del anotador (antes tampoco lo cuidaba).
  Para saber qué formas creó el paso que se deshace, se deshace de a un paso por vez (`popMarkupStep`), como `step` en
  la página. Tus cambios a una forma que ya existía se deshacen igual.
- **Escribir en el anotador es algo nuevo aunque se deshaga todo adentro.** Qué pasaba (la prueba al azar, 1 de 3.000):
  deshacer una anotación con ⌘Z, abrir el anotador otra vez, dibujar en la misma foto y deshacerlo adentro, cerrar y
  ⌘⇧Z: la anotación vieja volvía sin marco, porque Yjs no rehace una clave del mapa que se volvió a escribir después
  (aunque esté borrada) si no fue por la misma pila. Ahora el anotador avisa aunque su pila quede vacía y la línea de
  tiempo borra lo de rehacer (como cualquier editor: escribir y deshacerlo no devuelve lo que había para rehacer). Con
  el marco que ya no se borra (19.5) ese caso tampoco podría pasar; la regla queda por lo de cualquier editor.
- **Sin aviso al deshacer en la misma página**, como un paso de página; solo si cruzó. Si la foto ya no está en la
  página (se borró el bloque y la anotación sigue hasta la poda), se deshace igual y se dice: "Undid annotations on a
  photo that's no longer in “Shot 3”."
- **Manteniendo apretado ⌘Z se frena antes de lo anotado**, como antes de un reemplazo: es un paso grande.
- **Abrir el anotador sin hacer nada** no es un paso ni borra lo de rehacer.
- **O1 (la papelera durante el ⌘Z de un reemplazo) no se tocó:** pide que un reemplazo quede a la vez en las dos listas,
  un cambio mediano en la parte más delicada de la entrega 2. Sigue en el roadmap.

### 19.3 Lo medido

| Prueba | Resultado |
|---|---|
| Recorrido en Chromium (arnés con la app de verdad, servidor en memoria con archivos, sin login; Windows con Ctrl y Mac con ⌘) | anotar la foto de Shot 3 (rectángulo y flecha), escribir en Shot 12, ⌘Z saca lo escrito, ⌘Z vuelve a Shot 3 y saca la anotación entera (formas y marco) con la foto a la vista y "Undone in “Shot 3” · Back", ⌘⇧Z la vuelve igual, ⌘⇧Z vuelve a Shot 12 con lo escrito; con otra persona dibujando en la misma foto, ⌘Z saca lo tuyo de esa vez y deja lo suyo, y el otro dispositivo baja lo mismo; 0 errores en la consola. 36 de 36 comprobaciones |
| Al azar sin el editor, sola (3.000 semillas de 50 acciones: anotar dos fotos con dibujar, mover, cambiar el color, borrar y ⌘Z / ⌘⇧Z adentro, escribir en dos páginas, ⌘Z y ⌘⇧Z de la línea de tiempo en el medio) | deshacer todo: 3.000 de 3.000 exactas (el mapa y el texto como al principio); rehacer todo: 3.000 de 3.000 (13.471 veces en el anotador) |
| Lo mismo con otra persona anotando las mismas fotos (dibuja, mueve y cambia formas suyas y tuyas, borra) | 0 cosas suyas a la vista (formas, campos, el marco de una foto con formas) borradas por un deshacer o rehacer, de la línea de tiempo o del anotador, en 3.000 corridas (29.735 pasos deshechos); 3.000 de 3.000 iguales en los dos dispositivos. Sin `protectMarkupOthers` falla |
| Correcciones de la auditoría (19.5): al azar con cortes de red y el otro deshaciendo lo suyo, 1.000 semillas | 0 formas sin marco al volver la red, 0 cosas del otro perdidas, 1.000 de 1.000 iguales; con la regla de antes del marco, falla |
| Recorrido en Chromium, con las correcciones | 44 de 44: lo de arriba, la foto lejana entera y por encima del aviso después de cruzar, y el tooltip del triángulo (Windows y Mac) |
| Mutantes de las correcciones | 7 de 7 mueren: el marco con la regla de antes, `nearest` sin volver a centrar, y A5, A2, A6, A10 y A1 de la auditoría |
| Pruebas de mutación (cada protección sacada) | 18 de 18 hacen fallar alguna prueba: proteger lo ajeno, la forma con lo del otro, el marco, los campos de la forma creada en el paso, el paso a mano, lo deshecho adentro que borra lo de rehacer, anotar que borra lo de rehacer de su página, escribir que borra el rehacer de lo anotado, retener la página, rearmar, el tope, mantener apretado, mostrar la foto, el texto a medio escribir, el aviso con la pila vacía, el anotador de a un paso, y la ventana de O4 y el foco del panel |
| Versión vieja (el esquema anterior) abriendo la página con lo anotado deshecho y rehecho | no escribe nada al abrir |

Las pruebas: `src/ui/undoTimelineMarkup.test.ts` (con el editor real y `PageDocs`: orden con lo escrito en la misma y en
otra página, dos veces en el anotador, algo nuevo y rehacer, mantener apretado, la otra persona, la foto que ya no está,
la papelera, el documento rearmado, el tope, retener, la versión vieja), `undoTimelineMarkupRandom.test.ts` (al azar;
`TIMELINE_SEEDS`), `Annotator.test.tsx` (lo que pasa al cerrarse y la forma que otro movió), `projectReplace.test.tsx`
(*Show* y el foco) y `undoTimelineReplace.test.ts` (O4).

### 19.4 Lo que falta

- O1 (18.4): una página con historia en la papelera durante el ⌘Z de un reemplazo, restaurada después.
- La memoria en el iPhone y el gesto de deshacer de iOS en la PWA instalada (entregas 1 y 2).
- El anotador en el teléfono (sin ⌘Z): sus botones de deshacer siguen siendo de esa vez; lo de esa vez, en la página, se
  deshace con teclado físico o con el gesto de iOS (a probar a mano).

### 19.5 Correcciones de la auditoría

Auditoría independiente sobre `d29bd15`: no aprobado, un bloqueante chico; 1.000 corridas al azar propias por variante
(con otra persona, con cortes de red, y el otro también deshaciendo lo suyo).

- **B1, las formas del otro sin marco.** Si yo anotaba primero una foto (escribía su marco) y deshacía mi anotación
  mientras otra persona dibujaba sobre ella sin red, al volver la red sus formas llegaban sin marco y no se veían (42 a
  46 de 1.000 con cortes). Mirar las formas que ya llegaron no alcanza. Ahora **deshacer nunca borra el marco**: un marco
  sin formas no se dibuja (`readPhotoMarkup` pide al menos una) y la poda lo saca con la foto. Deshacer todo deja el
  mapa sin formas (con el marco). Cubre también **O2** (rehacer lo mío después de que el otro anotó y deshizo lo suyo:
  mis formas volvían sin marco). Pruebas: los casos R6/D2 y D1, y la prueba al azar con cortes de red (200 semillas en
  la suite; 1.000: 0 formas sin marco, 0 cosas del otro perdidas, 1.000 de 1.000 iguales).
- **O1, la foto lejana tapada por el aviso.** Después de cruzar de página, la foto de abajo de una página larga quedaba
  con 27 de 270 px a la vista: se acercaba (`nearest`) antes de que la página tuviera su alto. Ahora `revealPhoto` la
  centra si no se ve entera (con lugar para el aviso), y otra vez cuando la imagen carga y a los 300 ms, salvo que la
  persona ya se haya movido. Medido en Chromium: entera, por encima del aviso.
- **O3, guardas sin prueba:** el proyecto en `peek` (⌘Z en otro proyecto no ofrece lo anotado de este), `forget` con la
  página en pantalla, `stepMarkup` sin poder editar, y los dos chequeos del documento. Cada una con su prueba, que falla
  con su mutante.
- **F1 (de `main`, nivel alto), rehacer un pegado con anotaciones después de ir y volver.** El deshacer de la página
  sumaba el mapa de anotaciones recién al pegar (`trackMarkupInUndo`); el editor nuevo de la misma página no lo tenía, y
  rehacer el pegado traía la foto sin sus flechas. Ahora `PageEditor.tsx` lo suma al montar el editor (solo el origen
  de lo pegado). Pruebas: con la app (el editor recién montado lo sigue) y con la línea de tiempo (vuelven las flechas;
  sin el arreglo, no).
- **F2** (un error de la consola al pegar una foto): al roadmap (B.24).
- **D226**, que viaja con esta entrega (pedido de Lega): el tooltip del triángulo de colapsar, un renglón por acción
  (`Doc_Colapsar.md`, §3).

## 20. B.22: la excepción del ⌘Z con dos personas, cómo quedó (v0.0XX)

### 20.1 La causa

- Deshacer un borrado vuelve a poner cada cosa **adentro de la copia de su padre**: `redoItem` (`Item.js`) sigue
  `parentItem.redone` hasta el renglón que está hoy en el documento.
- Las copias que escribe un deshacer quedan guardadas (`keep`) para que Yjs no las recolecte. Pero esa marca se pone y
  se saca **subiendo por los padres** (`keepItem`), y cuando Yjs vacía la lista de rehacer (al escribir algo nuevo) le
  saca la marca a lo que guardaban esos pasos y a todos sus padres: también a la copia del renglón.
- Si después **otra persona** borra esa copia, en este dispositivo Yjs la recolecta en el momento (`tryGcDeleteSet`): el
  renglón queda como un item sin su tipo (`ContentDeleted`) y lo de adentro como `GC` (sin `redone` ni padre). Si la
  borra uno mismo, ese borrado la vuelve a guardar: por eso hacen falta dos personas.
- Cuando un ⌘Z tiene que volver a poner algo de ese renglón, `redoItem` llega al `GC` y tira `TypeError` ("reading
  'client'"; si lo borrado era un hijo directo del renglón, como una foto en línea, "reading '_item'"). El paso ya salió
  de la pila y no se hizo nada: lo que tenía en otros renglones tampoco vuelve.

Caso mínimo (Yjs solo): A escribe los renglones "abc" y "xyz". B borra la "b" y la "y" en un paso; borra el renglón
"ac" entero; ⌘Z (vuelve una copia); escribe "Z" en la copia y ⌘Z; escribe "q" en el otro renglón (vacía rehacer). A
borra la copia. B: ⌘Z (se va la "q") y ⌘Z: `TypeError`, y "xz" se queda sin la "y". Con una foto en línea en vez de
la "b", el mismo caso tira "reading '_item'".

### 20.2 Lo medido antes del arreglo

| Prueba | Resultado |
|---|---|
| **Dos editores reales** (BlockNote con el esquema de la app, conectados en cola como la app, con la reparación; 5 bloques con foto en línea y tabla; 40 acciones con 16 % de borrar 1 o 2 bloques enteros, Enter, Backspace, ⌘Z y ⌘⇧Z; después los dos deshacen todo, intercalado; 3.000 corridas) | **10 corridas con la excepción, 13 ⌘Z**, todas en el deshacer final |
| Qué deja en pantalla cada ⌘Z frenado | **nada cambia**: 0 de 13 tocaron el documento, el editor muestra el texto del documento 13 de 13 y los dos editores terminan iguales 10 de 10 corridas. Lo que se pierde es **el paso**: el mismo ⌘Z con el arreglo vuelve a poner texto en 7 de 13 (renglones enteros: "tercero", la tabla, "segundo renglón", "la cámara y la toma"), saca letras escritas por esa persona en 3 y no cambia letras en 3 |
| Modelo de párrafos de la auditoría (dos personas, 3.000 semillas) | 24 con la excepción (25 ⌘Z); ninguno cambió el documento; con el arreglo, 11 de esos 24 ⌘Z cambian algo |
| 20.000 semillas más del modelo | 236 con la excepción (1,2 %) |

La línea de tiempo atrapaba la excepción (17.2): el paso se descartaba con "Nothing to undo there…" y el ⌘Z se frenaba.
No quedaba nada a medias, pero ese paso ya no se podía deshacer, y lo que tenía para volver no volvía.

### 20.3 El arreglo

En el parche de Yjs (`patches/yjs+13.6.33.patch`), marcado `LGA-SHOTDOCS-PATCH (B.22)` en `dist/yjs.mjs`,
`dist/yjs.cjs` y `src` (`assertYjsPatched` lo exige):

- **`redoItem`**: si al seguir la copia del padre llega a un `GC` o a un item sin su tipo, no vuelve a poner esa cosa
  (devuelve `null`, como ya hace Yjs cuando el padre no se puede volver a poner) y deja una marca en la transacción.
  Un atributo del renglón (`parentSub`, como la alineación o el ancho de una foto) se salta sin marca: no es texto
  movido.
- **`popStackItem`**: si la marca está, ese paso **no saca lo que había insertado**. Lo insertado puede ser el mismo
  texto movido (un Enter, un bloque arrastrado): sacarlo cuando el original no tiene dónde volver lo haría desaparecer.
  Sobra texto en vez de faltar **al final de la historia**, no en cada ⌘Z: un ⌘Z que antes se frenaba y ahora se
  hace puede volver a poner algo en una estructura que el esquema no acepta, y el editor borra ese bloque (en 2 o 3 de
  3.000 corridas, una vez una tabla de la otra persona); con los ⌘Z siguientes vuelve, y las letras que faltan al final
  nunca son más que con el ⌘Z frenado. No es nuevo: con B.21, dos ⌘Z que tiraban ya borraban así. Por ejemplo, un *Replace all* de la página "b" → "B" en dos renglones, deshecho cuando
  uno de los dos ya no existe, deja "xbBz" en el otro (vuelve la "b" y la "B" queda). Lo demás del paso se hace.

Actúa donde antes Yjs tiraba la excepción: al llegar a un `GC` el código anterior seguía con `undefined` y tiraba
siempre, y al llegar a un item sin su tipo tiraba siempre con texto y renglones. Con un atributo de ese renglón, Yjs a
veces lo saltaba sin tirar (cuando a la derecha hay un valor de otra persona): por eso los atributos no marcan, y ese
caso queda igual que antes (lo encontró la auditoría; está en la prueba). Como B.21, decide qué escribe el deshacer de este dispositivo; lo que sale son ediciones comunes: **no hace
falta subir `min_app_version`**. La línea de tiempo sigue atrapando la excepción, por si Yjs tira por otra causa.

Se descartaron:

- **Saltar y sacar igual lo insertado** (lo que hace Yjs cuando el padre se borró sin copia). Con el editor, en 2 de las
  10 corridas el final quedaba con texto de antes de menos que con el ⌘Z frenado: un Enter deshecho sacaba " la toma"
  del renglón nuevo y no lo podía devolver al de arriba, que la otra persona había borrado.
- **Frenar el paso entero, sin la excepción**: deja afuera lo que sí tiene dónde volver (los 7 de 13 de arriba).
- **Revisar también los vecinos** (`leftTrace`, `rightTrace`) por si son un `GC`: no apareció en 23.000 corridas del
  modelo ni en 3.000 con el editor (todas las excepciones salen del padre); no se agregó código que no se puede probar.

### 20.4 Lo medido con el arreglo

| Prueba | Con B.21 | Con B.21 y B.22 |
|---|---|---|
| Dos editores reales, bloques enteros (3.000) | 10 corridas con la excepción | **0**; terminan iguales 2.994 en los dos casos, y las 10 corridas de la excepción terminan con el mismo texto que con el ⌘Z frenado |
| Modelo de párrafos, dos personas (3.000) | 24 con la excepción | **0**; las mismas 2.978 terminan iguales (las 22 que no, ya estaban) |
| 20.000 semillas más del modelo | 236 | **0** |
| Las 2.976 semillas del modelo sin la excepción | — | cada ⌘Z da **idéntico**, antes y después (también con la corrección de los atributos, que en la auditoría dio 30.000 de 30.000 idénticas) |
| Letras de antes que faltan al final (las 24 semillas de la excepción) | 55 | 55 |
| Versiones mezcladas (una persona con B.22 y otra sin él, párrafos y texto) | — | ninguna deja de converger por el arreglo |
| Una persona (los tres generadores de 16.3) y mapas (anotar) | — | idénticos |

Las pruebas: `src/ui/yjsUndoGone.test.ts` (los dos casos mínimos, el atributo en conflicto, `dist/yjs.cjs`, el caso con dos editores, el Enter
cuyo texto no tiene dónde volver y 3.000 semillas del modelo). Cada parte del arreglo sacada hace fallar alguna.

### 20.5 Lo que queda

- **De Yjs, sin copias y sin el arreglo** (encontrado al medir): A parte un renglón con Enter, B borra el de arriba y A
  hace ⌘Z: la segunda mitad vuelve al renglón borrado y desaparece también. Lo hace Yjs con cualquier padre borrado por
  otro; está en el historial y ⌘⇧Z lo trae.
- Con dos editores, 6 de 3.000 corridas terminan con los dos textos distintos (las mismas 6 sin el arreglo, ninguna con
  la excepción; en 5, también rearmando cada documento desde cero), y 22 de 3.000 en el modelo de párrafos. Ya estaba:
  queda para investigar aparte. **Investigado y arreglado en B.26 (sección 21).**
- La reparación del editor después de un deshacer con dos personas: cuando lo que vuelve no entra en el esquema, el
  editor borra el bloque entero (lo dicho en 20.3; pasa también sin B.22: 298 de 35.184 ⌘Z en la auditoría). Es otro
  ítem del roadmap.
- Reportarlo a Yjs con los casos mínimos de 20.1, junto con los de 16.1 y 16.4.

## 21. B.26: dos personas con textos distintos después de deshacer, cómo quedó (v0.0XX)

### 21.1 En qué capa se rompía

Con el arnés de B.22 (dos editores reales, 3.000 corridas), las 6 corridas que terminaban distintas se miraron capa por
capa:

- **Los dos `Y.Doc` tenían las mismas ediciones** (el mismo vector de estado, nada pendiente en la red) y aun así otro
  texto: "y la toma" en uno y "y la omat" en el otro. Rearmar cada documento desde sus ediciones da el texto **del otro**,
  y armar uno nuevo con todas las ediciones da siempre lo mismo. O sea: **la memoria de quien deshizo no coincide con lo
  que dicen sus propias ediciones** (lo que recibe el otro, y lo que ve él mismo al recargar). No es la carga desde cero
  (un snapshot o la compactación) ni la red.
- **El editor no agrega nada:** en las 3.000 corridas cada editor muestra el texto de su documento, y los dos editores
  muestran lo mismo salvo los ids de bloques repetidos (abajo).
- **Es de Yjs, no de un parche nuestro.** Modelo de párrafos de dos personas (3.000 semillas): 27 distintas con Yjs sin
  parches, 22 con B.21 y las mismas 22 con B.21 y B.22. Con una sola persona también pasa: 33 de 3.000 del modelo de una
  persona dejan la memoria distinta de lo rearmado (es "el documento local distinto de lo guardado" de 16.4; nadie lo ve
  hasta que otro abre la página o se recarga).

Fuera del texto, dos cosas que ya estaban y no son textos distintos: en ~25 % de las corridas quedan dos bloques con el
mismo id y cada editor le pone al repetido un id al azar distinto (`Doc_Colaboracion.md`, "Ids repetidos"); y en 103 la
página termina vacía, y el editor la muestra con un párrafo vacío.

### 21.2 La causa

- Al deshacer el borrado de un renglón, `redoItem` (`Item.js`) vuelve a poner cada letra en la copia del renglón y le
  busca los vecinos siguiendo las copias (`redone`): el izquierdo desde la letra de la izquierda, el derecho desde la
  letra misma hacia la derecha.
- Un ⌘Z anterior dentro del mismo renglón deja **el original borrado y su copia en el mismo texto**, la copia pegada a
  la izquierda. Siguiendo las copias, el vecino izquierdo (la copia) y el derecho (el original, que apunta a esa copia)
  terminan **en la misma letra**, o el derecho queda antes que el izquierdo: los vecinos quedan **cruzados**.
- Con vecinos cruzados, Yjs ubica la letra en la memoria con un recorrido que depende de cómo tiene partidos los items, y
  la manda con `origin` y `rightOrigin` (sus dos letras de al lado). Otro dispositivo la ubica por esas dos letras y, con
  los items partidos o juntados de otra forma, cae en otro lugar. Desde ahí cada uno sigue con su orden: Yjs nunca
  compara los textos.
- Pariente, de la parte de B.21 del parche (16.4): el vecino izquierdo es el item que termina en la última letra de su
  copia, y buscar el derecho puede partir ese item. El izquierdo queda más corto y la letra cae en el medio de su vecino
  ("dso"). Eso era igual para todos, pero la corrección conocida (volver a tomar el izquierdo después de buscar el
  derecho) armaba más vecinos cruzados (16.4: de 33 a 52 documentos distintos de lo guardado), y no se había aplicado.

Casos mínimos (deterministas; una sola persona, el otro documento recibe cada cambio):

- **Yjs solo, "tres":** borrar "re" y ⌘Z; borrar "es" y ⌘Z; borrar el renglón y ⌘Z. Quien deshizo ve "tres"; el otro, y
  él mismo al recargar, "ters". Igual con Yjs sin parches, con B.21 y con B.21 y B.22.
- **Yjs solo, "dos":** borrar "os" y ⌘Z; borrar la "s"; borrar el renglón, ⌘Z y ⌘Z. Sin parches: "dos" en quien deshizo y
  "dso" en el otro; con B.21: "dso" en los dos.
- **Con el editor de la app** (achicado de la semilla 1406): renglones "la cámara y la toma" y "otro"; Enter justo antes
  de "toma" y ⌘Z; escribir "AB" entre la "t" y la "o" de "toma"; Enter después de "cámara y"; borrar los dos renglones
  (con el menú del bloque, juntos o de a uno) y deshacer todo. Quien deshizo ve "la cámara y la toma"; el otro, y él mismo
  al recargar, "la cámara y la omat". Borrándolos con una selección y Backspace no pasa (es otra edición).

### 21.3 El arreglo

En el parche de Yjs (`patches/yjs+13.6.33.patch`, marca `LGA-SHOTDOCS-PATCH (B.26)` en `dist/yjs.mjs`, `dist/yjs.cjs` y
`src`; `assertYjsPatched` la exige), en `redoItem`, después de buscar los dos vecinos:

1. **El izquierdo se vuelve a tomar** como el item que termina en la misma letra que antes de buscar el derecho: si
   buscar el derecho lo partió, ya no queda más corto y la letra no cae en el medio de su vecino.
2. **El derecho tiene que estar a la derecha del izquierdo.** Si es el mismo o está antes, se toma como derecho el que
   hoy está pegado al izquierdo.

Lo que sale (`origin`, `rightOrigin`) son entonces dos letras en orden, y cualquier dispositivo (y la recarga) ubica la
letra en el mismo lugar que quien deshizo. Cumple las tres condiciones: **nunca saca ni agrega texto** (solo decide
dónde va lo que vuelve); **lo que decide viaja**: es una edición común, que cualquier versión, vieja o nueva, ubica igual
sin saber nada de las copias; y **las versiones mezcladas convergen**: una versión vieja sigue armando sus propios vecinos
cruzados (su diferencia de siempre), pero ninguna nueva. **No hace falta subir `min_app_version`.** Si los vecinos no
estaban cruzados ni el izquierdo partido, hace lo mismo que antes. Cuesta un recorrido del vecino izquierdo al derecho
por cada tramo que vuelve; normalmente están al lado.

Se descartaron: **solo la parte 2** (converge igual, 3.000 de 3.000, pero deja el "dso" de B.21); **solo la parte 1**
(es la corrección de 16.4: arma más vecinos cruzados, y sin la parte 2 diverge); **ubicar en la memoria como lo haría
otro dispositivo** (rearmar los vecinos desde `origin` y `rightOrigin`; razonado, no medido): arregla esa memoria,
pero con vecinos cruzados dos dispositivos que tienen los items partidos de otra forma siguen ubicándolo distinto entre
ellos; y **dejar el lugar
de la memoria y corregir `origin` y `rightOrigin` después de ubicarlo**: idéntico en las 3.000 semillas a la parte 2, y
cambia un dato del item después de integrarlo.

### 21.4 Lo medido

| Prueba | Con B.21 y B.22 | Con B.26 |
|---|---|---|
| Dos editores reales, bloques enteros (el arnés de B.22, 3.000 corridas) | **6 distintas**; rearmar da otro texto en las 6 | **0**: 3.000 iguales, y rearmar da lo mismo en las 3.000 |
| Las mismas corridas, texto final | — | igual en 2.991; en las 6 que divergían queda el orden bueno ("y la toma", "renglón", "tercero"); en 2 cambia el orden de un renglón ya desordenado, a mejor (" y la tomGHa" en vez de " y omGHala t"); 3 son el azar del arnés (dan distinto corriendo dos veces la misma librería) |
| Letras de antes que faltan al final (editor, por semilla) | — | idénticas: ninguna corrida con una letra menos |
| Modelo de párrafos, dos personas (3.000) | 22 distintas (sin parches, 27) | **0**; letras faltantes idénticas semilla por semilla |
| Modelo de una persona (la auditoría de B.21, 3.000) | 33 con la memoria distinta de lo rearmado; 2.971 exactas, 19 en otro orden, 10 con letras de menos (14) | **0**; 2.985 exactas, 5 en otro orden, las mismas 10 (14 letras) |
| Versiones mezcladas, modelo de dos personas (3.000) | — | vieja con nueva: 2.985 y 2.993 iguales (las que faltan son las de la vieja: 15 y 7, que suman las 22); nueva con nueva: 3.000. Ninguna distinta nueva |
| Los generadores de texto de B.21 (una persona, y dos a la vez con versiones mezcladas) | — | idénticos: 3.000 exactas, 3.000 convergen |

Las pruebas: `src/ui/yjsUndoCrossed.test.ts` (6: los dos casos mínimos, `dist/yjs.cjs`, el caso con el editor, 3.000
semillas del modelo de una persona y las seis semillas de B.22 con dos editores) y la prueba al azar de
`yjsUndoGone.test.ts`, que ahora exige las 3.000 iguales. Sin el arreglo fallan las 7; sin la parte 2, 5 de las 6 del
archivo nuevo; sin la parte 1, la del "dso".

### 21.5 El Enter con el renglón de arriba borrado (20.5)

- **No es la misma familia:** los dos ven lo mismo, no diverge. Es cómo deshace Yjs (igual sin parches, con B.21, B.22 y
  B.26): el ⌘Z del Enter tiene que devolver la segunda mitad al renglón de arriba; como lo borró otra persona (sin copia
  propia), `redoItem` no la puede volver a poner y devuelve `null`, y el paso igual saca lo que insertó, el renglón nuevo
  con esa mitad. Caso mínimo (Yjs solo): "la cámara y la toma" y "otro"; A parte después de "cámara ", B borra el de
  arriba, A ⌘Z: queda "otro" solo; ⌘⇧Z trae "y la toma".
- **Arreglo posible, medido y no aplicado:** extender la decisión F de B.22 (si algo del paso no puede volver, lo
  insertado se deja) a cualquier padre borrado por otro, no solo al recolectado. Con eso el ⌘Z del Enter deja "y la
  toma" y no hace nada más (la línea de tiempo lo avisa como un paso que no cambia nada). Medido:
  - Converge igual (modelo de dos personas y versiones mezcladas, 3.000 de 3.000; dos editores, 3.000 de 3.000).
  - **Cambia mucho más que B.22:** el final de 655 de 3.000 corridas con dos editores; en 609 quedan letras que hoy
    desaparecen (las letras de antes que faltan bajan de 11.501 a 6.350 en total), pero en 34 quedan letras de menos que
    hoy y en 4 faltan más letras de antes (el arnés llama a Yjs sin la línea de tiempo: un paso que ya no cambia nada hace
    que Yjs deshaga también el anterior en el mismo ⌘Z, y la corrida sigue por otro camino).
  - **Empeora un caso que hoy sale bien:** *Replace all* "b" → "B" en "abc" y "xbz", la otra persona borra el primer
    renglón, ⌘Z: hoy "xbz" (exacto); con la extensión, "xbBz" en el que quedó (y así en cada renglón con una
    coincidencia).
- **Por qué no se aplicó:** no cumple "nunca peor que hoy" (el *Replace all* y las 4 corridas), y cambia el deshacer en
  una de cada cinco corridas, no solo donde Yjs fallaba. **Propuesta para un ítem aparte:** dejar lo insertado solo
  cuando es **el mismo texto movido** (lo que no pudo volver y lo que el paso insertó tienen el mismo contenido: un Enter,
  un bloque arrastrado), medido con el arnés de la línea de tiempo (sin el doble paso de Yjs). Hasta entonces, la segunda
  mitad está en el historial de la página y ⌘⇧Z la trae.

### 21.6 Lo que queda

- Reportarlo a Yjs con los casos mínimos de 21.2, junto con los de 16.1, 16.4 y 20.1.
- Los ids de bloques repetidos (21.1) siguen como estaban: el texto es el mismo, el id del repetido no.

## Correcciones de la auditoría (2026-10-02)

Veredicto: "aprobado con condiciones", sin bloqueantes; la premisa de pasar la pila de un editor al siguiente sin
parchear nada se comprobó con el editor real de BlockNote, y en 4.000 corridas al azar no se borró nada del otro.

- **C1, el *Undo* del panel fuera de orden dejaba el texto de más de 1.3.** Ahora, en las páginas con historia, deshace
  ese paso de la pila de Yjs aunque no sea el de arriba (medido: "Toma 1: " en vez de "Toma 1: cámara"); las demás
  siguen por las anclas (3.3, DH10, "En corto").
- **C2, pasar la pila arrastraba el editor viejo.** Al pasarla se borra del `meta` la clave del binding viejo (+1,05 MB
  contra +0,52 MB en 30 pasos); la línea de tiempo es la dueña de las listas, se pasan al montar la vista del editor
  nuevo y nunca pisan una lista que no esté vacía; la memoria se mide con el editor real en la entrega 1 (3.2, riesgos
  1 y 3).
- **C3, el límite de Yjs.** La comparación "no lo empeora" no era controlada; con la misma secuencia, por página es
  idéntico a hoy (14 de 3.000 con algo de menos en los dos), pero se deshace más lejos. Investigarlo y decidir es
  condición de la entrega 1 (sección 6, sección 9, entrega 0, B.21 del roadmap).
- **Observaciones resueltas en el texto:** DH1 dice con un ejemplo que mover, renombrar y (hasta la entrega 3) anotar
  se saltean; anotar deja de ser opcional; quienes llaman directo al deshacer de Yjs pasan por la línea de tiempo y
  `onStepUndone` la escucha a ella (3.4, riesgo 6); lo que se escribe de fondo no entra en la pila; el documento viejo
  retenido se suelta en el mismo momento del aviso; la analogía con `ForkYDoc` se cambió por la comprobación con el
  editor real; el nombre del pedido ya no choca con D-10 de `Doc_Decisiones.md`; las plantillas propias (v0.124) en la
  tabla de casos; ⌘Y en la Mac sigue rehaciendo, como hoy; el paso que ya no cambia nada, con un ejemplo; las anclas
  siguen sirviendo después de deshacer y rehacer por la pila.
