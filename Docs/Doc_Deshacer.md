# Deshacer en el orden en que editaste (D10)

**Estado: diseño, sin código.** Pedido de Lega del 2026-10-02 al cambiar la decisión D10. Se diseñó contra `main`
v0.123. Las decisiones (DH1 a DH10, sección 11) son propuestas con la recomendación elegida: el número final lo pone
quien las cierre con Lega. Lo medido salió de prototipos en pruebas que no se versionan (sección 9).

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
  de Yjs de la página** y se deshace con ella (exacto, medido en 300 corridas al azar).
- **Dura lo que la pestaña:** al recargar, la pila de Yjs no se puede rearmar (medido: lo borrado ya no está en el
  documento). Los reemplazos siguen en el panel con *Undo*, como hoy.
- **No cambia nada guardado**: ni el documento, ni el registro de reemplazos, ni la base. Sin migración, sin
  `min_app_version`; una versión vieja no se entera.
- **Entregas:** 1 la línea de tiempo con las páginas, 2 el reemplazo adentro, 3 (opcional) anotar fotos y lo que queda.

## Reglas que no se rompen

- **Nunca perder datos.** Deshacer es una edición nueva que se guarda primero en el dispositivo y sube como cualquier
  otra. Rehacer existe para todo lo que se deshace con ⌘Z.
- **Nunca pisar lo ajeno.** Deshacer saca solo lo tuyo: lo que escribió otra persona (o vos en otro dispositivo) queda,
  aunque sea adentro de lo que se deshace. Yjs ya lo hace por origen; el reemplazo sigue la misma regla.
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
acciones fue un reemplazo en todo el proyecto, se deshace ese reemplazo" (D10, cambiada el 2026-10-02). Eso pide:

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
| **Anotaciones** (entrega 3) | la foto y los pasos del anotador de esa vez | la pila del anotador, todos juntos |

La línea de tiempo **no guarda contenido**: guarda punteros a pasos de Yjs que ya existen. El orden lo da el momento en
que cada paso se crea (`stack-item-added` de cada pila). Lo que se junta en medio segundo (`stack-item-updated`) es el
mismo paso.

### 3.2 Las pilas de cada página sobreviven al cambiar de página

- **El documento se retiene**: la línea de tiempo abre la página (`docs.open`, que suma una referencia) mientras tenga
  pasos de ella, así el `Y.Doc` no se destruye al salir. Sin esto, el deshacer de Yjs no puede volver a poner lo borrado:
  un documento rearmado desde lo guardado ya no lo tiene (medido, sección 9).
- **La pila pasa de un editor al siguiente**: al desmontarse el editor, la línea de tiempo se queda con sus listas
  (`undoStack`, `redoStack`); al montarse de nuevo, se las pone al `UndoManager` nuevo. Es lo mismo que hace BlockNote al
  "bifurcar" un documento (`ForkYDoc`: guarda `undoStack` y lo vuelve a asignar). **Sin parchear y-prosemirror.**
  Medido: con la pila pasada a otro `UndoManager`, y con la otra persona escribiendo y borrando en el medio, deshacer
  vuelve a poner lo borrado y saca solo lo tuyo.
- Mientras la página no está en pantalla **no hay ningún `UndoManager` escuchando** su documento: lo que escriba un
  editor sin pantalla (el reporte del día, la importación) no entra en la pila por error.
- **Topes:** las últimas **20 páginas** con pasos y **1000 pasos** en total por pestaña. Al pasar el tope se olvida lo
  más viejo (y se suelta el documento si ya no tiene pasos). Medido: un documento vivo ocupa unas 10 veces lo que pesa
  guardado (0,33 MB una página de 26 KB, 0,94 MB una de 90 KB); cada paso, del orden de 1 KB. 20 páginas grandes son
  unos 20 MB, aceptable también en el iPhone.
- **Si un documento retenido queda viejo** (llegó algo que no se pudo aplicar, `stale` en `docs.ts`) o se rearma, sus
  pasos dejan de valer: se sacan de la línea de tiempo y el próximo ⌘Z que llegue ahí lo dice (sección 5).

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
  pila se borra del registro como una deshecha por las anclas.
- **El *Undo* del aviso y el de "Last" en el panel** siguen andando, también cuando el reemplazo ya no es lo último
  (DH10): ahí deshacen por las anclas en todas las páginas (fuera de orden, como hoy), y el paso de ese reemplazo **se
  saca** de la pila de cada página con historia (si quedara, deshacerlo después volvería a escribir "cámara" encima de
  lo que ya volvió) y de la línea de tiempo. Si el reemplazo es lo último, el botón hace exactamente lo mismo que ⌘Z.

### 3.4 Qué hace ⌘Z

Un ⌘Z deshace **una** entrada, la última del proyecto que tenés abierto:

1. **Un paso de esta página:** se deshace acá, como hoy (el cursor vuelve donde estaba).
2. **Un paso de otra página:** la app va a esa página, la deja en pantalla con el bloque del cambio a la vista (el
   mismo `reveal` de "ir al bloque" de los comentarios, que abre la sección si está colapsada) y lo deshace. Aviso:
   "Undone in “Shot 12” · Back" (*Back* vuelve a la página donde estabas). DH2.
3. **Un reemplazo:** se deshace en todas sus páginas sin moverte de donde estás, con el avance y *Stop* de hoy si tarda.
   Aviso: "Undid “Cámara” → “Camera” in 12 pages · Redo"; si alguna cambió: "· 2 had changed and were left as they are
   · Show". DH3.
4. **Un paso que ya no cambia nada** (otra persona borró justo eso): se descarta y sigue con el anterior, **sin cambiar
   de página** en el mismo ⌘Z. (Yjs, si un paso no cambia nada, se saltea solo al anterior de la misma pila; la línea de
   tiempo le pasa **un paso por vez** para que no se saltee uno de otra página que iba antes. Medido.)

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
- **⌘⇧Z** (y Ctrl+Y en Windows) rehace en el mismo orden y con las mismas reglas. **Algo nuevo** (escribir en
  cualquier página del proyecto, reemplazar) borra todo lo que había para rehacer, en todas las páginas (como cualquier
  editor: un solo orden).
- **Con nada para deshacer**, ⌘Z no hace nada (sin aviso, como hoy).

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
| **Otra persona editó después lo mismo** | Lo tuyo se deshace igual y lo suyo queda (Yjs, por origen). Si borró justo lo tuyo, ese paso no cambia nada y se pasa al anterior. En un reemplazo: en las páginas con historia, el deshacer de Yjs (medido: con "XX" escrito por el otro adentro de "Camera", deshacer deja "cámaraXX"; deshacer también lo escrito antes deja solo "XX"); en las demás, las anclas ("had changed", queda como está, con *Show*). Nunca se borra nada del otro: 0 en 300 corridas al azar con el otro escribiendo y borrando. |
| **Sin red** | Igual que con red: todo es local. Lo deshecho queda pendiente de subir, como cualquier edición. |
| **La página no está abierta** | Si tiene pasos, su documento está retenido (3.2): ⌘Z la abre (instantáneo, ya está en memoria). Las páginas que solo tocó un reemplazo se deshacen sin abrirlas en pantalla, como hoy. |
| **La página se fue a la papelera, perdiste Editar, o la borraron** | Ese paso se saca y el aviso lo dice: "Can't undo in “Shot 12”: it's in the trash. ⌘Z again for the previous change." En un reemplazo, esas páginas quedan para *Undo the rest* del panel, como hoy. |
| **El documento retenido se rearmó** (llegó algo que no se pudo aplicar) | Sus pasos ya no valen: se sacan y el próximo ⌘Z que llegue ahí avisa "Older changes in “Shot 12” can't be undone (the page was reloaded)" y sigue con el anterior en el ⌘Z siguiente. |
| **Cambiar de proyecto** | Cada proyecto tiene su línea de tiempo (DH7). Al volver, sigue donde estaba (si no se pasó el tope). |
| **Cambiar de workspace, cerrar sesión, recargar, cerrar la pestaña** | Se pierde la línea de tiempo (DH4). Los reemplazos siguen en el panel con *Undo*. Dos pestañas: cada una la suya. |
| **Un reemplazo corriendo** | ⌘Z no hace nada hasta que termina (no se puede deshacer algo a medias); *Stop* sigue igual. |
| **Un reemplazo cortado con *Stop* o por no poder guardar** | Entra igual, con las páginas que alcanzó a escribir. |
| **El asistente aplica** | Ya es un paso de la pila de la página (A1, `asOneUndoStep`): entra solo. Si al comprobar falla y lo deshace (`while undo…`), el paso sale de la línea de tiempo con él (escucha `stack-item-popped`). |
| **Restaurar una versión** | Un paso de la página. *Undo* del aviso sigue andando mientras sea lo último de esa pila. |
| **Crear desde una plantilla** | Un paso de la página; ⌘Z en el título recién creado sigue sacando la plantilla (ahora por la línea de tiempo). |
| **Reporte del día** | Crea una página y escribe con un editor sin pantalla: no entra (sección 10). La página nueva se manda a la papelera como cualquier otra. |
| **Anotar** | Con el anotador abierto, su ⌘Z es de esa foto (hoy). En la entrega 3, al cerrarlo, todo lo de esa vez es **un** paso. |
| **El teléfono** | No hay ⌘Z sin teclado. Con teclado físico, igual que en la compu. El gesto de deshacer de iOS llega al editor como `historyUndo` y `undoGuard.ts` lo manda a la línea de tiempo (a probar a mano). Sin botón nuevo (DH8). |

## 6. No perder datos

- Deshacer y rehacer son ediciones locales por el camino de siempre (guardar en IndexedDB, subir a `page_updates`); la
  línea de tiempo no escribe nada propio.
- **Lo ajeno nunca se borra**: deshacer saca solo lo insertado por tus pasos (Yjs) o lo que está exactamente entre las
  anclas (reemplazo sin historia). Medido: 0 caracteres del otro borrados por un deshacer en 300 corridas.
- **Lo que deshacés se rehace**: ⌘⇧Z para todo lo de la línea de tiempo, también el reemplazo (hoy no tiene rehacer).
- **Retener un documento** usa `docs.open`: la página cuenta como abierta (la guardia de versión queda armada, como con
  el editor en pantalla), nada se destruye con ediciones sin guardar.
- **Un límite de Yjs que ya existe hoy** (no lo trae este diseño): si algo que un deshacer volvió a poner se parte
  escribiendo en el medio, deshacer más atrás puede dejar restos ("la ía" en vez de "la "). Medido en una sola página,
  como el ⌘Z de hoy: 186 de 300 corridas al azar vuelven exacto al deshacer todo, y en 2 falta algo del principio (está
  en el historial de versiones). Con la línea de tiempo, en el mismo tipo de corrida: 194 de 300 exactas y 0 con algo de
  menos. Sin deshacer en el medio de la sesión, 300 de 300 exactas. Queda en el roadmap para investigarlo aparte.

## 7. Versiones viejas

- **Nada cambia en lo guardado**: ni el documento (no hay tipos ni propiedades nuevas), ni las claves `replace:` de
  `meta` (el mismo formato; rehacer un reemplazo vuelve a escribir su registro igual que al reemplazar), ni la base.
- Una versión vieja abierta en otra pestaña tiene su propio ⌘Z por página, como hoy, y ve lo deshecho como cualquier
  edición que llega.
- Sin migración, sin subir `min_app_version`.

## 8. Ayuda, atajos y textos

- **Sin atajos nuevos.** `undo` y `redo` del registro (`shortcuts.ts`) cambian de dueño (de `blocknote` al de la línea
  de tiempo) y de lugar (también fuera del editor); `shortcutSources.ts` suma los archivos nuevos. En la Mac, ⌘Z y
  ⌘⇧Z; en Windows, Ctrl+Z, Ctrl+Shift+Z y Ctrl+Y.
- **Ayuda:** la entrada `undo` dice que deshace en el orden en que editaste, también en otra página (te lleva) y un
  reemplazo de todo el proyecto; `replaceProject` cambia su última oración ("{undo} in the page doesn't undo it") por
  que ⌘Z lo deshace si es lo último que hiciste, y que *Undo* del aviso y del panel sigue andando aunque no lo sea.
- **Textos (inglés, con su traducción):** "Undone in “{page}” · Back", "Redone in “{page}” · Back", "Undid “{from}” →
  “{to}” in {n} pages · Redo", "Redid … · Undo", "Can't undo in “{page}”: {reason}. {undo} again for the previous
  change.", "Older changes in “{page}” can't be undone (the page was reloaded)."
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
| Ídem, **deshaciendo y rehaciendo en el medio** | 194 de 300 exactas, 0 con algo de menos (el resto es el límite de Yjs de la sección 6; hoy, en una página sola: 186 de 300 y 2 con algo de menos) |
| **Línea de tiempo al azar con el otro** escribiendo y borrando en las tres páginas | 300 corridas, 10.146 pasos deshechos: **0** caracteres del otro borrados por un deshacer y los dos dispositivos iguales en todas |
| **Memoria** de un documento retenido con su pila | 0,33 MB (página de 26 KB guardada) y 0,94 MB (90 KB); unos 0,9 KB por paso |

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
  entrega 3, también anotar una foto (todo lo de esa vez, un paso). Mover, crear, papelera y títulos no.
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
- **A.** Se deshace igual (como hoy, por las anclas en todas las páginas) y sale de la línea de tiempo; lo escrito
  después queda.
- **B.** Solo si es lo último; si no, el botón no está.

**Elegí A** porque es lo que hace hoy y a veces querés sacar solo el reemplazo.

**Si preferís otra:** B es un cambio chico.

## 12. Pruebas

- **Núcleo, sin pantalla** (`src/ui/undoTimeline.test.ts`, con `PageDocs`, IndexedDB y el servidor de prueba): el orden
  con varias páginas; la pila que sobrevive al desmontar y volver; el documento retenido que no se destruye y se suelta
  al pasar el tope; el paso que no cambia nada (no cruza ni se saltea otra página); `stack-item-updated` y rehacer; el
  asistente que deshace su propio paso; el documento rearmado (`stale`) que saca sus pasos.
- **Reemplazo** (`src/search/projectReplace.test.ts`): el hueco de 1.3 arreglado (deshacer el reemplazo y después lo
  escrito antes: exacto); páginas con y sin historia en el mismo reemplazo; rehacer por la pila y por las anclas
  (`planRedo`, en `replaceDoc.test.ts` con sus casos y al azar); *Undo* del panel fuera de orden que saca el paso de la
  pila; con el otro a la vez (al azar, `TIMELINE_SEEDS`): nada del otro borrado y los dos iguales.
- **Pantalla** (jsdom, la app de verdad): ⌘Z en otra página (va, muestra, deshace, *Back*); mantener apretado no cruza;
  ⌘Z con el foco en el árbol; en el título y en un comentario no; el campo del panel recién reemplazado (DH9); los avisos;
  ⌘Z en la Mac sí y Ctrl+Z en la Mac no (`macShortcuts.test.ts`); el registro de atajos (`shortcuts.test.ts`).
- **Versión publicada** (`*.published.test.ts`): abre las páginas deshechas y rehechas sin escribir nada.
- **Cada protección falla sin ella** (sacándola una por una): un paso por vez, cortar el tiempo, retener el documento,
  sacar el paso al deshacer fuera de orden.
- **Recorrido en Chromium** (arnés local sin login, sobre el servidor en memoria; en la compu y a 390 px): el ejemplo de
  3.5 completo, sin red, y un segundo dispositivo que baja todo al final igual.

## 13. Entregas

1. **La línea de tiempo con las páginas.** La pila de cada página que sobrevive al cambiar de página (retener y pasar
   la pila), ⌘Z y ⌘⇧Z en orden entre páginas (DH2), fuera del editor, topes, ayuda y atajos. **Aceptación:** escribir en
   *A*, en *B* y en *A*; desde *C*, tres ⌘Z deshacen *A*, *B* y *A* en ese orden, cada uno con su página en pantalla, y
   tres ⌘⇧Z lo vuelven; con otro dispositivo escribiendo en *A* a la vez, lo suyo queda.
2. **El reemplazo adentro.** La pila de Yjs en las páginas con historia, las anclas en las demás, `planRedo`, los avisos
   con *Redo*, DH9 y DH10. **Aceptación:** el ejemplo de Lega (3.5) en Chromium con 50 páginas: dos ⌘Z dejan las 50 como
   antes y lo escrito antes del reemplazo sale exacto (sin el "cámara" que queda hoy); ⌘⇧Z lo vuelve; sin red, igual.
3. **(Opcional) Anotar y lo que queda.** Lo de una vez en el anotador como un paso al cerrarlo; el roadmap de DH1 C y
   DH8 B si Lega los pide. **Aceptación:** anotar, cerrar, ⌘Z saca todo lo de esa vez y ⌘⇧Z lo vuelve.

Cada entrega con su auditoría antes de publicar.

## 14. Riesgos

1. **Memoria en el teléfono.** 20 documentos retenidos y 1000 pasos son unos 20 MB en el peor caso medido. Si el iPhone
   aprieta, bajar el tope a 10 páginas. A medir en la entrega 1.
2. **El `UndoManager` temporal del reemplazo** tiene que usar las mismas opciones que el de y-prosemirror (el filtro que
   protege los párrafos y la marca de huecos estables del parche, `defaultDeleteFilter`): si no, deshacer podría sacar
   la marca del renglón. Una prueba lo compara.
3. **Pasar la pila de un editor a otro** depende de que y-prosemirror y BlockNote no cambien cómo arman el plugin (hoy
   BlockNote mismo lo hace en `ForkYDoc`). La selección guardada en cada paso queda con la clave del editor viejo: al
   deshacer un paso de antes del cambio de página el cursor no vuelve solo; la línea de tiempo muestra el bloque.
4. **Saltar de página puede sorprender** (DH2). El aviso con *Back* y no cruzar manteniendo apretado lo atenúan.
5. **El límite de Yjs de la sección 6** (restos al deshacer mucho con deshacer y rehacer en el medio) ya existe; la
   línea de tiempo no lo empeora (medido) pero lo hace más visible al deshacer más lejos.
6. **Rehacer un reemplazo por las anclas** (`planRedo`) es código nuevo con la misma regla que `planUndo`; necesita sus
   pruebas al azar como las de `planUndo`.

## 15. Lo que no se pudo comprobar

- El gesto de deshacer de iOS en la PWA instalada (si llega como `historyUndo`), y Safari de Mac.
- Cuánto tarda en montarse el editor al saltar de página con el documento ya en memoria (se espera poco: no hay que
  leer IndexedDB).
- El uso de memoria real en el iPhone con 20 páginas retenidas.
