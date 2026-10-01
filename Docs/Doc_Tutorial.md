# Tutorial animado y ayuda (P.13)

Estado: **entregas 1 y 2 hechas (v0.082); la 3 ("Mostrame" y novedades), pendiente.** "Cómo quedó" (al final)
dice lo que se hizo y en qué se apartó del diseño; "Correcciones de la auditoría" manda sobre lo anterior. **Lega
respondió las preguntas el 2026-09-30** ("Decisiones"). Las fotos del ejemplo quedaron dibujadas para la app (ver
"Cómo quedó"); falta que Lega diga si se cambian por fotos de la lista. Lo
pidió Lega el 2026-09-30 ("sí o sí lo tenemos que tener"). Sale de leer el código de `main` (v0.051) y el
diseño de colapsar (`Doc_Colapsar.md`, rama `lega/colapsar`).

## Qué se pide

1. **La primera vez que alguien entra**, aparece un documento de ejemplo ya armado y una **recorrida con
   globitos** que señalan partes de la pantalla ("acá hacés esto, acá aquello") y se avanza con *Siguiente*,
   como en tantas apps.
2. La recorrida **se puede volver a ver**.
3. Una **ayuda** (desde el menú o un "?") que explica cada función y **todos los atajos de teclado**, y desde
   donde se vuelve a ver la recorrida.
4. Los dos idiomas (es/en), el teléfono y que la ayuda **no quede vieja**: cada función nueva suma su parte.

## Reglas que no se rompen

- **La práctica no toca nada real.** El documento de ejemplo no es una página del árbol, no se guarda en la
  base local de páginas, no sube a Supabase ni al Drive, no cuenta en "cambios sin subir" ni frena el cierre
  de sesión, y no lo ve nadie más. Cada workspace sigue siendo una isla: el ejemplo viene con la app, no de un
  workspace, y no pasa de un workspace a otro.
- **Sin migración ni tablas nuevas.** Lo único que puede ir a la cuenta es una marca en los metadatos del
  usuario de Supabase Auth del workspace (`user_metadata`, corrección 12), nada en `user_settings.prefs`.
- **Nada de tipos de bloque nuevos** (la regla del editor): el ejemplo usa solo lo que ya existe (párrafo,
  títulos, Script y pregunta como propiedades, `image`, listas, tabla).
- **Sin servicios de afuera:** la recorrida y la ayuda salen del bundle; nada de estadísticas ni de pedir
  textos a un servidor. Las fotos del ejemplo vienen con la app, nunca se suben ni se piden al Drive.
- **Pocas dependencias:** el motor de la recorrida es nuestro (sección 4); la parte que se baja siempre suma
  menos de 3 KB comprimidos, lo demás se baja aparte (`lazyPart`).
- **Tooltips (D-15):** los globitos de la recorrida no son tooltips; los tooltips siguen con `data-tip` y la
  regla de no repetir lo obvio. Los atajos que muestran salen del mismo registro que la ayuda (sección 6).

## 1. Qué hay para mostrar (lo que existe hoy)

Relevado del código de `main`. Son los lugares a los que puede apuntar un globito o que explica la ayuda.

| Zona | Dónde está | Qué hace |
|---|---|---|
| Selector de proyectos | Arriba de la barra lateral (`ProjectSwitcher.tsx`) | Cambia de proyecto, crea uno, cambia de workspace; muestra lo que pesa cada proyecto. Hoy se abre con Ctrl/⌘+K. |
| Estado de sincronización | Debajo del selector (`SyncBadge.tsx`); en el teléfono, un ícono en la barra de arriba | "Todo sincronizado", "3 cambios sin subir", sin conexión, actualizá la app. |
| Árbol de páginas | Barra lateral (`Sidebar.tsx`) | Abrir, "+" para una página nueva (arriba y en cada renglón), arrastrar para ordenar, menú de cada página; ancho con el tirador (`SidebarResizer.tsx`). En el teléfono, un cajón que se abre con el botón de menú. |
| Pie de la barra lateral | `Sidebar.tsx` | Papelera (páginas y archivos) y el menú de la cuenta. |
| Menú de la cuenta | `AccountMenu` en `menus.tsx` | Apariencia (tema, letra, tamaño, ancho de la página), fotos en fila en el teléfono, idioma, miembros, Google Drive (el dueño), salir, textos legales. Las preferencias siguen a la persona ("Guardado en tu cuenta"). |
| Barra de arriba de la página | `Workspace.tsx` | Migas, **lupa** (buscar en la página, Ctrl/⌘+F), **ícono de comentarios**, menú "⋯" de la página. |
| Menú "⋯" de la página | `PageMenu` en `menus.tsx` | Compartir, página nueva adentro, renombrar, mover, tamaño de hoja, **Exportar PDF / Imprimir**, títulos cortos, mandar a la papelera. Con P.11: colapsar todo / abrir todo. |
| Título de la página | `PageView.tsx` | Enter pasa al texto. |
| Editor | `PageEditor.tsx` (BlockNote 0.55) | Menú "/" (títulos, listas, tabla, cita, código, divisor, foto, Script, pregunta), tirador "⋮⋮" y "+" al costado de cada bloque, barra de formato al elegir texto, atajos de Markdown ("# ", "- ", "1. ", "[] ", "> "). |
| Fotos y videos | `inlinePhotoCreate.ts`, `PhotoToolbar.tsx`, `inlinePhotoEditor.ts`; las fotos-bloque viejas, `imageRowsEditor.ts`, `MediaToolbarButtons.tsx` | Desde v0.078 entran en el renglón (pegar, soltar, "/Image"), como letras: texto al lado, Shift+clic o Shift+flechas para elegir varias. Primer clic elige, segundo abre el carrete; tiradores que imantan a 1/1, 1/2, 1/3 y 1/4; la barra de la foto (la misma para la foto-bloque, por sectores, D-24): ver, bajar, tamaños rápidos (para todas las elegidas) y "Acomodar en filas" de las elegidas, alinear el renglón, comentar, reemplazar, renombrar y borrar. |
| Adjuntos | `attachments.ts`, `AttachmentSheet.tsx` | Soltar o pegar cualquier archivo: tarjeta con ícono; segundo clic abre o baja; en el teléfono, la hoja con *Open*, *Download*, *Share*. |
| Carrete | `Carrete.tsx` | Pantalla completa, flechas, zoom, bajar el original. |
| Links de Drive | `DrivePasteMenu.tsx`, `driveCard.ts` | Pegar un link de Drive ofrece link, texto o tarjeta con reproductor. |
| Comentarios y preguntas | `EditorComments.tsx`, `CommentsPanel.tsx` | Comentar un bloque (ícono al costado, botón de la barra, Ctrl/⌘+Alt+M), el panel con los hilos, las preguntas (un párrafo marcado que se contesta con un hilo). |
| Buscar y reemplazar | `FindBar.tsx` | La barra de la página; reemplazar se despliega con la flecha. Con P.12 (entrega 2), la lupa del proyecto a la izquierda del "+" de páginas. |
| Compartir y miembros | `ShareDialog.tsx`, `MembersDialog.tsx` | Invitar, permisos por proyecto o página. |
| Hojas y PDF | `SheetBreaks.tsx`, `printPage.ts` | Marcas de hoja en pantalla, el PDF con los mismos cortes. |

## 2. Todos los atajos de hoy

Es la lista que tiene que salir en la ayuda. Sale de buscar los manejadores de teclado de la app y los atajos de
BlockNote 0.55 que usamos (y los de Tiptap que trae). "Mod" es ⌘ en la Mac y Ctrl en el resto.

| Atajo | Qué hace | Dónde | De quién |
|---|---|---|---|
| Mod+F | Buscar en la página (el segundo, con el foco en la barra, abre el del navegador) | Página abierta | App (`PageEditor.tsx`, `findUi.ts`) |
| Enter / Shift+Enter, F3 / Shift+F3, Mod+G / Mod+Shift+G | Siguiente / anterior coincidencia | Barra de buscar abierta | App (`FindBar.tsx`) |
| Esc | Cerrar la barra (queda elegida la coincidencia) | Barra de buscar | App |
| Mod+K | **Hoy:** abrir el selector de proyectos. **Con P.12 entrega 2:** buscar en el proyecto (el panel muestra también los proyectos). Con texto elegido en el editor, crea un link | Toda la app | App (`ProjectSwitcher.tsx`) y BlockNote |
| Mod+P | Exportar PDF / imprimir la página abierta (con los cortes de hoja) | Página abierta | App (`printPage.ts`) |
| Mod+Alt+M | Comentar el bloque del cursor (o el señalado) | Editor | App (`isCommentShortcut` en `commentsUi.ts`, el manejador en `EditorComments.tsx`) |
| Mod+Enter | Mandar el comentario | Campo del panel de comentarios | App (`CommentsPanel.tsx`) |
| Esc | Cancelar / cerrar el panel (en el teléfono, la hoja) | Panel de comentarios | App |
| Mod+Alt+P | Pregunta | Editor | App (`editorSchema.ts`, `QUESTION_SHORTCUT`) |
| Mod+Alt+S | Script (guion) | Editor | App |
| Enter en una línea de Script | Sigue en Script; en una línea vacía, vuelve a párrafo | Editor | App |
| Mod+Alt+0 | Párrafo común | Editor | BlockNote y app |
| Mod+Alt+1 … 6 | Título 1 a 6 | Editor | BlockNote |
| Mod+Alt+Q | Cita | Editor | BlockNote |
| Mod+Shift+7 / 8 / 9 / 6 | Lista numerada / con viñetas / de casillas / plegable | Editor | BlockNote |
| Mod+B, Mod+I, Mod+U, Mod+Shift+S, Mod+E | Negrita, cursiva, subrayado, tachado, código | Editor | Tiptap |
| Mod+Z, Mod+Shift+Z / Mod+Y | Deshacer, rehacer | Editor | BlockNote |
| Tab / Shift+Tab | Meter o sacar un nivel el bloque (en una tabla, la celda siguiente o anterior) | Editor | BlockNote |
| Mod+Shift+↑ / ↓ | Mover el bloque arriba o abajo | Editor | BlockNote |
| Shift+Enter | Salto de renglón dentro del bloque (a verificar con el registro, sección 6) | Editor | BlockNote |
| "/" | Menú de bloques (↑ / ↓, Enter elige, Esc cierra; seguir escribiendo filtra) | Editor | BlockNote |
| "# ", "## "…, "- ", "1. ", "[] ", "> " o `" `, "---", "```" | Título, viñeta, numerada, casilla, cita, divisor, código | Editor, al principio del renglón | BlockNote |
| Esc | Cerrar la hoja de un adjunto | Hoja del adjunto (teléfono) | App (`AttachmentSheet.tsx`) |
| Clic en una foto elegida, doble clic, barra espaciadora | Abrir el carrete (en un adjunto: abrir o bajar) | Editor | App (`PageEditor.tsx`) |
| Una letra, Enter, un emoji o el dictado con una foto en línea elegida | Escribe después de la foto (no la reemplaza); Enter parte el renglón ahí | Editor | App (`inlinePhotoEditor.ts`; v0.076, emojis y dictado v0.078) |
| Shift+← / →, Shift+clic, arrastrar | Elegir varias fotos en línea (y texto), como letras | Editor | ProseMirror y app (`inlinePhotoEditor.ts`) |
| Una letra, Enter, Espacio con varias fotos en línea elegidas | Escribe después de la última / parte el renglón ahí / abre el carrete en la primera (no las borra) | Editor | App (v0.078) |
| Supr o Retroceso con fotos elegidas | Borrarlas (también *Delete image* en su barra) | Editor | ProseMirror |
| Mod+V con archivos, soltar archivos | Fotos y videos en el renglón, donde está el cursor o donde se sueltan; otros archivos, como tarjeta debajo | Editor | App (`inlinePhotoCreate.ts`; v0.078) |
| ← / → | De una foto a otra en una fila | Foto de una fila elegida | App (`imageRowsEditor.ts`) |
| ↑ / ↓ | Salir de la fila | Foto de una fila elegida | App |
| Enter | Párrafo nuevo después de toda la fila | Foto de una fila elegida | App |
| ← / →, Inicio / Fin, Esc, rueda o doble clic | Anterior / siguiente, primera / última, cerrar, zoom | Carrete | App (`Carrete.tsx`) |
| ↑ / ↓, Enter, Esc | Elegir cómo pegar un link de Drive | Menú de pegar Drive | App (`DrivePasteMenu.tsx`) |
| ↑ / ↓, Inicio / Fin | Abrir la página visible anterior o siguiente, la primera o la última (con la tecla apretada, al frenar) | Árbol | App (`Sidebar.tsx`, `treeNav.ts`; v0.074) |
| → / ← | Desplegar o pasar a la primera subpágina; plegar o ir a la página madre | Árbol | App |
| Enter, Espacio | Abrir la página | Árbol | App |
| Enter / Esc | Guardar o cancelar el nombre | Renombrar en el árbol | App |
| ← / →, Inicio / Fin | Achicar o agrandar la barra lateral, mínimo o máximo | Tirador de la barra lateral | App (`SidebarResizer.tsx`) |
| ↑ / ↓, Enter | Elegir un proyecto | Selector de proyectos | App |
| ↑ / ↓, Inicio / Fin, Esc | Recorrer y cerrar menús; Esc cierra diálogos | Menús y diálogos | App (`menus.tsx`) |
| Enter | Pasar al texto | Título de la página | App (`PageView.tsx`) |
| Mod+Alt+Enter (con Shift: para todos) | Colapsar o abrir la sección del título | Editor | App, **cuando llegue P.11** (`Doc_Colapsar.md`) |

Dos observaciones del relevamiento:

- `Doc_Colapsar.md` nombra un `Mod-Alt-c` de BlockNote para bloques de código: en el código de 0.55 no está.
  Es el tipo de diferencia que el registro con su prueba (sección 6) encuentra solo.
- Los rótulos de los atajos hoy están repartidos: `FIND_SHORTCUT_LABEL` (`findUi.ts`), `COMMENT_SHORTCUT_LABEL`
  y `QUESTION_SHORTCUT_LABEL` (`commentsUi.ts`) y el `SHORTCUT` de `ProjectSwitcher.tsx` (para
  `project.switchTip`), y cada uno calcula si es Mac con su propia copia de `IS_MAC`. Pasan a salir del registro.

## 3. El documento de ejemplo: una página de práctica en memoria

### Opciones

| | Página de práctica en memoria | Página real en un espacio propio o de demo | Demo estática de solo lectura |
|---|---|---|---|
| Editar libremente | Sí, con el editor de verdad | Sí | No (o solo de mentira) |
| Ensucia el workspace | No | **Sí:** un proyecto o página más, que alguien tiene que borrar; ocupa la base del dueño | No |
| Se sincroniza | No | **Sí:** sube, cuenta en "sin subir", la ve el dueño o un admin | No |
| Permisos | No hace falta ninguno | Un miembro sin permiso de crear no podría tenerla | No hace falta |
| Fotos | De la app | Irían al Drive del dueño (o habría que inventar una excepción) | De la app |
| Empezar de nuevo | Trivial | Borrar y crear (papelera, sincronización) | No hace falta |
| La recorrida puede pedir "escribí /" | Sí | Sí | No |

**Se elige la página de práctica en memoria.** Una página real rompe dos reglas (ensucia y sincroniza) y
choca con los permisos; la estática no deja probar, que es lo que más enseña.

### Cómo es

- **Dirección propia: `/practice`** (`src/router.ts` suma la ruta `practice`). Se muestra adentro de la misma
  pantalla de siempre (barra lateral, barra de arriba), así la recorrida puede señalar el árbol, el selector y
  el pie. No aparece en el árbol; se entra desde la recorrida y, **siempre**, desde la entrada *Practicar* de la
  ayuda, que la abre (o la vuelve a armar de cero si ya estaba abierta).
- **Un aviso arriba** de la página, siempre visible: "Página de práctica: lo que hagas acá no se guarda ni lo ve
  nadie." con *Empezar de nuevo* y *Salir*. Las migas dicen "Práctica".
- **El documento:** un `Y.Doc` en memoria, armado al abrir desde una plantilla de la app en el idioma de la
  interfaz (`src/tutorial/practice.es.ts` y `.en.ts`, bloques de BlockNote convertidos al fragmento de siempre,
  `CONTENT_FRAGMENT`). Queda en memoria mientras la app está abierta: se puede ir a otra página y volver sin
  perder lo hecho. Se descarta al recargar, con *Empezar de nuevo*, al cambiar de workspace y al salir de la
  sesión (lo escrito en la práctica de un workspace no aparece en otro).
- **Qué tiene** (un ejemplo de VFX corto, que entre en dos pantallas): un título "Plano 012 · Persecución en la
  terraza", un párrafo con negrita y un link, una lista de casillas (tareas del plano), dos líneas de Script
  ("EXT. TERRAZA - NOCHE" con sus marcas de color), una pregunta ("¿El cielo se reemplaza en todos los
  planos?") con un hilo de ejemplo ya contestado, un renglón con tres fotos en línea (como las crea hoy pegar o
  soltar), una tabla de tomas y un H2 con texto
  debajo (para colapsar, cuando exista P.11). Ni tarjeta de Drive (cargaría un reproductor de Google) ni
  adjunto (la tarjeta sale de un archivo registrado en el Drive): los explican la recorrida y la ayuda.
- **Fotos del ejemplo:** tres WebP chicas (unos 1200 px de ancho, 30 a 60 KB cada una) en `public/tutorial/`,
  con la dirección **absoluta** de la app (`https://<app>/tutorial/terraza-1.webp`; una relativa no la acepta
  `carreteSourceOf`). El carrete ya las acepta (fuente `web`), sin pasar por la cola, y los tamaños rápidos y
  "Acomodar en filas" andan igual. Para que la práctica ande sin red, una regla de caché del service worker
  para `/tutorial/` que las guarda la primera vez (no en la instalación; corrección 18). **Fotos con licencia
  libre** (Lega), elegidas en la sección "Fotos del ejemplo", con autor, fuente y licencia anotados en un
  `public/tutorial/LICENSES.txt` al lado.
- **Fotos o archivos propios en la práctica:** en la entrega 2, soltar o pegar un archivo avisa "En la práctica
  no se suben archivos: probá con las fotos de ejemplo" y no hace nada. Si Lega lo quiere, más adelante: se
  guardan como `data:` achicados (hasta 1600 px) solo en memoria; pegados después en una página real pasan
  por el conversor de imágenes `data:` que ya existe y se suben como cualquier foto pegada. Nunca `blob:`:
  pegado en una página real, quedaría roto para todos después de recargar.

### Cómo se aísla (lo delicado)

El editor de la página (`BlockEditor` en `PageEditor.tsx`) y lo que cuelga de él piden todo a `useServices()`:
`files` y `media` (guardar y mostrar fotos), `comments` (hilos y preguntas), `user`. La práctica **no toca
`docs`, `engine` ni `tree`** (no pasa por `PageEditor`, que abre el documento con `docs.open`) y le da al resto
versiones en memoria:

- `PracticeView` (nuevo) arma el `Y.Doc` y monta `BlockEditor` adentro de un `ServicesContext.Provider` con
  los servicios del workspace **pisados**: `media` y `files` de práctica (`enabled: false`, `resolve` devuelve
  la misma dirección, `add` rechaza con el aviso de arriba), `comments` en memoria (`MemoryComments`, con el
  hilo de ejemplo), y `docs`, `engine`, `tree`, `remote`, `client` envueltos para que **solo las escrituras
  tiren un error** (las lecturas que usa la pantalla siguen andando; corrección 1): si un componente de abajo
  intenta guardar algo real, falla en las pruebas en vez de escribir.
- Para eso `CommentQueue` y `MediaQueue` se describen con una interfaz (lo que usan los componentes: leer hilos,
  suscribirse, agregar, resolver una dirección, `fileInfo`, `display`), y la práctica implementa solo eso. La
  lista completa de lo que usa `useServices()` (y los ganchos que lo llaman) está en la corrección 1.
- La barra de arriba en `/practice` muestra la lupa, el ícono de comentarios (dentro del mismo `Provider`) y
  un "⋯" con lo que no toca nada real: tamaño de hoja (solo en memoria), Exportar PDF / Imprimir, *Empezar de
  nuevo* y *Salir de la práctica*.
- **Contadores:** como nada pasa por `docs`, `media` ni `comments` reales, "cambios sin subir", el aviso al
  salir de la sesión (`useLeaveGuard`) y el estado de sincronización no cambian. Lo fija una prueba.
- **Copiar de la práctica y pegar en una página real:** el texto pasa como siempre; las fotos del ejemplo
  quedan como fotos web con la dirección de la app (andan y no pesan en el Drive); los comentarios no viajan.

### Por qué no guardarla en IndexedDB

Serviría para que lo hecho sobreviva a una recarga, pero pide una base más en el dispositivo (con el nombre del
workspace, como toda base local), cuidar la cuota y el borrado al salir, y no suma nada a lo que se aprende.
Queda como decisión (la 1).

## 4. El motor de la recorrida: propio

### Librerías revisadas (2026-09-30)

| Librería | Licencia | Peso (JS comprimido) | Comentario |
|---|---|---|---|
| Shepherd.js 15 | **AGPL-3.0** | grande, con `@floating-ui/dom` | La licencia la descarta para una app que se publica. |
| Intro.js 8 | **AGPL-3.0** | grande | Igual. |
| React Joyride 3 | MIT | ~720 KB sin comprimir, 10 dependencias | Demasiado para lo que hace. |
| @reactour/tour 3 | MIT | ~12 KB con sus tres paquetes | Razonable, pero con su propio estilo y posicionamiento. |
| driver.js 1.8 | MIT | ~7 KB más su CSS | El más liviano; trabaja sobre el DOM, sin React. |

**Se hace uno propio** (unos 3 a 4 KB comprimidos, en su propia parte que se baja aparte). Razones:

- Lo difícil no es dibujar un globito sino **esperar a que aparezca lo que señala**: partes que se bajan aparte
  (`lazyPart`), el menú "/" y el tirador de BlockNote que existen solo al escribir o al pasar el mouse, el
  cajón del teléfono que hay que abrir antes. Ninguna librería lo resuelve; habría que envolverla igual.
- Ya tenemos casi todo: el posicionamiento con flecha que se da vuelta y no se sale de la pantalla
  (`Tooltip.tsx`), el comportamiento de los paneles flotantes (`useFloating` en `menus.tsx`), el foco atrapado
  del carrete, `isPhoneLayout`, los textos con `useT` y el estilo de la app.
- Sin dependencias nuevas, en línea con el repo (solo BlockNote, Mantine, Supabase, Yjs e `idb`).

### Cómo funciona

- **Pasos como datos** (`src/tutorial/steps.ts`): `id`, `anchor` (un atributo **`data-tour="..."`** puesto a
  propósito en el componente, nunca una clase de CSS que puede cambiar), `placement`, `layout` (`all`,
  `desktop`, `phone`), `before` (lo que hay que hacer antes: abrir el cajón en el teléfono, ir a `/practice`,
  llevar el cursor a un bloque de la práctica), `interactive` (el paso deja tocar lo señalado y avanza solo
  cuando pasa algo, por ejemplo aparece el menú "/"), textos por clave (`tour.<id>.title`, `.text`,
  `.textPhone`).
- **Esperar el ancla:** un `MutationObserver` busca el `data-tour` hasta 3 s. Si aparece, se desplaza hasta él
  (`scrollIntoView({ block: 'center' })`) y se muestra. Si no, el paso se muestra centrado, sin foco de luz
  (nunca se traba la recorrida). Si el ancla desaparece a mitad (se cerró el cajón), el globito queda centrado.
- **Foco de luz:** un solo `div` con el tamaño del ancla más un margen y una sombra enorme
  (`box-shadow: 0 0 0 100vmax`) que oscurece el resto; un borde del color de acento y un pulso suave. Se mueve
  de un ancla a otra con una transición de 250 ms: **eso es lo "animado"**. Sin videos ni GIF. Sigue al ancla
  con `ResizeObserver` y con `scroll`/`resize` (una vez por cuadro).
- **El globito:** tarjeta con título, texto de 2 o 3 renglones, "3/10", *Atrás*, *Siguiente* (en el último,
  *Terminar*) y *Saltar recorrida*. Posición con la misma lógica de `Tooltip.tsx`, que se saca a una función
  común (`src/ui/floating.ts`) para no tener dos copias.
- **Teclado y lectores de pantalla:** `role="dialog"` no modal con `aria-labelledby` y `aria-describedby`; al
  mostrar un paso el foco va a *Siguiente*; → y Enter avanzan, ← vuelve, Esc sale (con el aviso "Podés volver
  a verla desde la ayuda (?)"). Tab queda adentro del globito salvo en los pasos interactivos, donde el foco
  va a lo señalado. Una región `aria-live` dice "Paso 3 de 10: Menú /".
- **Movimiento reducido:** con `prefers-reduced-motion: reduce`, sin transición ni pulso: el foco salta.
- **Teléfono:** el globito es una hoja abajo, de todo el ancho (como el panel de comentarios), arriba del
  teclado (`visualViewport`); el foco de luz igual. Los pasos del cajón lo abren antes y lo cierran después
  (hoy `navOpen` es un estado local de `Workspace.tsx`: pasa a un pequeño almacén para poder abrirlo desde
  afuera). Sin atajos en los textos (`textPhone`).
- **Mientras dura:** los tooltips se apagan; la recorrida no abre menús ni diálogos (los menús se cierran al
  tocar afuera y el globito quedaría afuera): los señala cerrados y los explica. Si la persona sale de
  `/practice` a mitad, la recorrida se pone en pausa con una tarjeta chica "Recorrida en pausa · *Seguir*".
- **Progreso:** se cuenta sobre los pasos del diseño que corresponde (computadora o teléfono), así "3/10" nunca
  salta.

### Los pasos

Diez en la computadora, nueve en el teléfono. Textos cortos, de vos, sin jerga.

| # | Ancla (`data-tour`) | Título es / en | Texto es | Texto en |
|---|---|---|---|---|
| 1 | (centrado) | ¡Hola! / Hi! | Esta es una página de práctica: podés escribir, mover y borrar lo que quieras, no se guarda ni lo ve nadie. Te muestro lo principal en dos minutos. | This is a practice page: write, move and delete anything, nothing is saved and nobody else sees it. Here's the tour, two minutes. |
| 2 | `pages` (árbol y su "+") | Tus páginas / Your pages | Acá están las páginas del proyecto, unas adentro de otras. Con + creás una; arrastrándolas las ordenás. | Your project's pages live here, nested. + creates one; drag to reorder. |
| 3 | `project-switcher` | Proyectos / Projects | Un workspace tiene varios proyectos. Acá cambiás de proyecto o creás uno ({Mod+K}). | A workspace has several projects. Switch or create one here ({Mod+K}). |
| 4 | `practice-empty-line` (interactivo) | El menú / / The / menu | Escribí / en un renglón vacío: títulos, listas, tablas, guion, preguntas y fotos. Con ⋮⋮, al costado, arrastrás un bloque. | Type / on an empty line: headings, lists, tables, script, questions and images. Drag a block by its ⋮⋮ handle. |
| 5 | `practice-photos` | Fotos / Images | Las fotos van en el renglón, como letras: podés escribir al lado. Un clic elige una y otro la abre en grande; en su barra elegís el tamaño o las acomodás en filas. Con Google Drive conectado, soltá cualquier archivo (PDF, zip) y queda como tarjeta. | Photos go in the line, like letters: you can write right next to them. One click selects one, another opens it full screen; its bar sets the size or arranges them in rows. With Google Drive connected, drop any file (PDF, zip) to attach it. |
| 6 | `comments` (ícono de arriba) | Comentarios y preguntas / Comments and questions | Comentá cualquier bloque ({Mod+Alt+M}) y acá ves todos los hilos. Una pregunta, como la del ejemplo, la puede contestar quien solo comenta. | Comment on any block ({Mod+Alt+M}); all threads are here. A question, like the one above, can be answered by anyone who can comment. |
| 7 | `find` (lupa) | Buscar / Find | Buscá y reemplazá en la página ({Mod+F}). | Find and replace in the page ({Mod+F}). |
| 8 | `page-menu` ("⋯") | La página / The page | Compartir, mover, tamaño de hoja y Exportar PDF ({Mod+P}). | Share, move, page size and Export PDF ({Mod+P}). |
| 9 | `sync` | Siempre guardado / Always saved | Todo se guarda primero en tu dispositivo y se sube solo, también sin red. Acá ves si falta subir algo. | Everything is saved on your device first and uploads by itself, even offline. This shows if anything is pending. |
| 10 | `help` ("?") | Ayuda / Help | Acá está todo explicado, con todos los atajos. Desde acá podés volver a ver esta recorrida. | Everything is explained here, with every shortcut. You can replay this tour from here. |

- `{Mod+K}` y los demás se reemplazan con el rótulo del registro para esa plataforma (⌘K o Ctrl+K). Cuando
  P.12 entrega 2 cambie Mod+K, el paso 3 cambia solo con el registro (y su texto, en la misma tanda).
- **Teléfono:** sin el paso 7 como atajo (la lupa sigue, texto sin atajo); el 2 y el 3 abren el cajón; el 9
  señala el ícono de sincronización de la barra de arriba; el 5 dice "Tocá una foto para verla en grande" y que, de
  vuelta en la página, otro toque muestra su barra (en el teléfono el primer toque abre el carrete); el
  10 señala la ayuda en el cajón.
- El menú de la cuenta (preferencias, idioma, miembros, Drive) no tiene paso propio: lo nombra el 9 si hace
  falta y lo explica la ayuda. Diez pasos es el tope; más cansa.

### Cuándo aparece y dónde se guarda que ya se vio

- **Estado en el dispositivo** (`localStorage`, clave `shotdocs-tour`, una por dispositivo, no por workspace:
  es lo que la persona sabe de la app, no un dato del workspace): `{ v, state: 'running' | 'done' |
  'skipped', step }`. `v` es la versión de la recorrida (sube solo si cambia mucho).
- **Estado en la cuenta** (por workspace, porque cada workspace es una isla): `shotdocs_tour: 1` en los
  metadatos del usuario de Supabase Auth (`client.auth.updateUser({ data })`). Llega con la sesión, sin
  migración, y ninguna versión vieja lo pisa (corrección 12; **no** va en `user_settings.prefs`).
- **Arranca sola** solo para alguien nuevo y solo en el inicio (corrección 5): la primera carga de este
  workspace en este dispositivo (`useBootServices` todavía no tenía `workspaceId`), en la dirección `/`, y
  **ni el dispositivo ni la cuenta** dicen que ya la vio. Va a `/practice` y muestra el paso 1. A quien ya
  usaba la app cuando se publique, o entra por un link a una página, no se le arranca: ve el punto en el "?" o
  la tarjeta.
  - En otro dispositivo (la cuenta dice vista) o en otro workspace (el dispositivo dice vista): no arranca;
    el "?" lleva un punto hasta que se abre la ayuda.
  - **Con un link de invitación a una página** (`inviteTarget`): primero se abre esa página, y la recorrida se
    ofrece con una tarjeta chica ("¿Primera vez? Recorrida de 2 minutos · *Empezar* · *Ahora no*") en vez de
    llevar a la práctica (respondida por Lega, decisión 2).
  - Sin proyectos (la pantalla "todavía no tenés proyectos") no arranca: espera a la pantalla de siempre.
- **Retomar:** si se recarga a mitad (`state: 'running'`), al volver aparece la tarjeta "¿Seguimos la
  recorrida? · Paso 4 de 10 · *Seguir* · *Terminar*".
- *Saltar* y *Terminar* cuentan igual como vista. **Volver a verla:** desde la ayuda, siempre desde el paso 1.

## 5. La ayuda

### Dónde está

- **Un botón "?"** en el pie de la barra lateral, al lado de Papelera (en el teléfono, en el cajón). Su
  `aria-label` es "Ayuda y atajos"; sin `data-tip` (no agregaría nada al ícono, D-15).
- **En el menú de la cuenta**, "Ayuda y atajos".
- **Sin atajo de teclado** (Lega): la ayuda se abre solo con el botón o con la entrada del menú. Ni "?" ni
  Mod+/ (este último, además, chocaba con la lista numerada en los teclados en castellano).
- **Cómo se ve:** un diálogo grande (720 px, con el índice a la izquierda) en la computadora; pantalla completa
  en el teléfono. Es una parte que se baja aparte (`lazyPart`), con sus textos en `src/i18n/lazy/help.ts`. Se
  abre en la sección que corresponde si se llama desde un lugar (por ejemplo, "Atajos").

### Qué tiene

Arriba, un campo de búsqueda; abajo, las secciones:

1. **Primeros pasos:** *Ver la recorrida* y *Practicar* (abre la página de práctica, o la arma de nuevo).
2. **Páginas y proyectos:** crear, anidar, arrastrar, renombrar, mover, títulos cortos, proyectos, workspaces.
3. **Escribir:** menú "/", títulos, listas, tabla, cita, código, divisor, atajos de Markdown, Script (con sus
   colores de escena), deshacer.
4. **Fotos y videos:** agregarlas al renglón (pegar, soltar, "/Image"; una con su tamaño, varias a un tercio),
   escribir al lado, elegir varias (Shift+clic, Shift+flechas, arrastrar), elegir y abrir, los tiradores (imantan a
   1/1, 1/2, 1/3 y 1/4), la barra de la foto (ver, bajar, tamaños para las elegidas, "Acomodar en filas" de las
   elegidas, alinear, comentar, reemplazar, renombrar, borrar), el carrete, el teléfono (en fila o apiladas), el PDF
   (un párrafo de fotos se parte por filas), qué pasa sin red.
5. **Archivos adjuntos:** soltar o pegar cualquier archivo, abrir o bajar, la hoja del teléfono. Y **carpetas**
   (P.9; ver "Entradas que suma P.9" en la sección 7).
6. **Links de Drive:** pegar un link y elegir link, texto o tarjeta.
7. **Comentarios y preguntas.**
8. **Buscar y reemplazar** (y, con P.12 entrega 2, buscar en el proyecto).
9. **Colapsar secciones** (cuando llegue P.11).
10. **Compartir y miembros:** permisos, invitados.
11. **Papelera:** páginas y archivos, qué se recupera.
12. **Sin red y sincronización:** qué quiere decir cada estado, por qué no se pierde nada.
13. **Hojas, PDF e impresión.**
14. **Preferencias:** tema, letra, tamaño, ancho, idioma.
15. **Atajos de teclado:** la tabla entera, por lugar (toda la app, editor, fotos, carrete, buscar, comentarios,
    árbol, menús), con los rótulos de la plataforma (⌘⌥M en la Mac, Ctrl+Alt+M en el resto). En el teléfono la
    sección dice que los atajos son para un teclado.

- **Cada entrada** es un dato (`src/help/entries.ts`): `id`, sección, textos por clave (título y 2 a 4 renglones),
  palabras para buscar, los atajos que usa (por id del registro, así el rótulo nunca queda viejo), `showMe` (el
  paso de la recorrida que lo muestra), `since` (la versión de la app que lo trajo) y `when` (solo si hay
  portero, solo quien puede editar, solo el dueño: una entrada de algo que la persona no puede usar se muestra
  apagada con el porqué, no se esconde).
- **Buscar en la ayuda:** en el dispositivo, sin mayúsculas ni tildes, con `src/search/normalize.ts` (el mismo de
  buscar en la página). Busca en títulos, textos, palabras y atajos: "ctrl f", "carrete", "pdf" o "filas"
  encuentran lo suyo. Sin resultados: "No encontramos eso. Probá con otra palabra."
- **"Mostrame"** en cada entrada con `showMe` (entrega 3): abre la práctica y hace **solo ese paso** (o una
  tanda corta), y al terminar vuelve a donde estaba la persona.

### Entradas de funciones que llegaron antes que la ayuda

**Ya están en la ayuda (v0.082):** la entrada `install` de `src/help/entries.ts`. Desde v0.082 cada función nueva suma
su entrada directamente ahí, no acá.

- **Instalar la app** (v0.079, `Doc_Instalar.md`). Sección *Primeros pasos*. Sin atajos. `since: '0.083'`.
  - *Install the app* / *Instalar la app*: "Install app in the account menu (or Install in the banner on your
    phone) shows the steps for your device: iPhone and iPad, Android or computer. Installed, Shot Docs opens
    from the home screen in its own window; on iPhone it keeps its own storage, which Safari doesn't clear." /
    "*Instalar la app* en el menú de la cuenta (o *Instalar* en el aviso del teléfono) muestra los pasos para tu
    dispositivo: iPhone y iPad, Android o computadora. Instalada, Shot Docs se abre desde la pantalla de inicio
    en su propia ventana; en el iPhone guarda sus datos aparte y Safari no los borra."
  - Palabras para buscar: instalar, app, pantalla de inicio, home screen, iPhone, Android, PWA, Dock.
  - `when`: solo si la pestaña no es la app instalada (si lo es, la entrada dice que ya está instalada).

## 6. Un solo registro de atajos

- **`src/ui/shortcuts.ts`** (en la parte que se baja siempre, chico): una lista con `id`, `keys` en el formato de
  ProseMirror (`'Mod-Alt-m'`, `'Mod-f'`, `'F3'`), el lugar (`global`, `editor`, `photos`, `carrete`,
  `find`, `comments`, `tree`, `menus`), la clave del texto, de quién es (`app`, `blocknote`, `tiptap`) y el
  estado (`on`, o `soon` con el ítem del roadmap: Mod+Alt+Enter hasta P.11).
- **`shortcutLabel(id, mac = IS_MAC)`** arma el rótulo: ⌘⌥M / Ctrl+Alt+M, ⌘⇧Z / Ctrl+Shift+Z. Un solo `IS_MAC`.
  Lo usan los tooltips (se van `FIND_SHORTCUT_LABEL`, `COMMENT_SHORTCUT_LABEL`, `QUESTION_SHORTCUT_LABEL` y el
  `SHORTCUT` de `ProjectSwitcher.tsx`), la ayuda y la recorrida.
- **Los atajos de ProseMirror de la app salen del registro** (`QUESTION_SHORTCUT`, `Mod-Alt-s`, `Mod-Alt-0`, las
  flechas de las filas): el esquema los importa en vez de escribirlos. Los que se toman en `window` (Mod+F,
  Mod+K, Mod+P, Mod+Alt+M) siguen con sus funciones (`isFindShortcut`, `isCommentShortcut`…), que tienen en
  cuenta AltGr, Dvorak y teclados no latinos; una prueba comprueba que cada función y su entrada dicen lo mismo.
- **Pruebas que lo mantienen al día:**
  - Unidad: ids únicos, textos en los dos idiomas, rótulos Mac y resto, y **sin choques** (dos atajos iguales en
    lugares que se pisan, por ejemplo `global` y `editor`).
  - Con el editor real (jsdom): se arma el editor con `editorSchemaOptions` y se recorren los atajos de todas sus
    extensiones (las de BlockNote y las nuestras). Cada uno tiene que estar en el registro o en una lista corta
    de los que no se documentan a propósito (Backspace, Delete, Enter común, Escape de BlockNote). Si BlockNote
    suma o saca uno al actualizarlo, la prueba falla y avisa. Así se habría visto que `Mod-Alt-c` no existe.
  - Por cada función `is…Shortcut`, eventos de teclado sintéticos en Mac y en Windows contra su entrada.

## 7. La regla: cada función nueva suma su ayuda

Se agrega a "Reglas de trabajo" de `Docs/index.md` y a las reglas de trabajo del repo (las locales, junto a la
del cierre de fase):

> **Ayuda y atajos.** Toda función nueva que ve un usuario suma en la misma tanda: su entrada en la ayuda
> (`src/help/entries.ts` y sus textos en los dos idiomas), sus atajos en el registro (`src/ui/shortcuts.ts`),
> y si cambia algo que señala la recorrida, el paso (`src/tutorial/steps.ts`). La auditoría de cierre lo
> revisa como parte de la documentación.

Y pruebas que lo sostienen sin depender de acordarse:

- La del registro contra el editor real (sección 6).
- Una que lee los pasos y busca cada `data-tour` en el código de `src/ui/`: si se renombra o se borra un ancla,
  falla.
- La de los textos (`i18n.test.tsx`) cubre `help.ts` y `tour.ts` como las demás partes: mismas claves y mismos
  `{valores}` en los dos idiomas.
- Cada entrada de `Changelog.md` que trae algo visible nombra su entrada de ayuda (costumbre, no prueba).

### Entradas que suma P.9: carpetas (v0.081)

**Ya están en la ayuda (v0.082):** `folderDrop`, `folderUpload`, `folderOpen` y `folderWho` de `src/help/entries.ts`
(sección "Archivos adjuntos"; textos en inglés en la app, con su traducción). `when`: solo con portero; subir, solo quien puede editar la página.

- **Drop a folder** (*Soltar una carpeta*). "Drag a folder from your computer onto the page. A window shows what
  goes up: how many files, in how many folders, how much it weighs, and what is skipped (hidden and system
  files, unless you tick *Include hidden files*). *Upload* sends it to the owner's Google Drive and leaves a
  folder card in the page. Keep the tab open until it finishes." Palabras: carpeta, folder, subir, arrastrar,
  soltar, drive. Sin atajos.
- **While it uploads** (*Mientras sube*). "The card says how it is going; click it to see the upload: *Pause*,
  *Resume*, *Retry* for the files that failed. If you close the tab, drop the same folder on its card again (or
  *Choose the folder…*): only what is missing goes up. Dropping the same folder elsewhere in the page offers to
  continue it. *Stop uploading* forgets it on this device (what reached Drive stays)." Palabras: pausar, retomar,
  faltan, error, dejar de subir.
- **Open a folder** (*Abrir una carpeta*). "Click the card twice (once on the phone or without edit access), or
  press Space with it selected, or *Open* in its bar. You see what is in the Drive folder right now: subfolders
  first, then files with their thumbnail. A photo or a video opens in the viewer; a PDF opens in a new tab; the
  rest downloads. Esc goes up one level." Palabras: ver, visor, migas, bajar, download. Atajos: Space (abrir la
  elegida, el mismo de las fotos), Escape (subir un nivel; ya está en el registro como "cerrar").
- **Who sees a folder** (*Quién ve una carpeta*). "Whoever sees the page sees and downloads what is in the
  folder, but never the folders above it or next to it. Only the person who added the folder uploads into it."
  Palabras: permisos, compartir, invitado. (Si Lega suma `drive.readonly`, agregar: "also what is added later in
  Drive".)

En la recorrida no hace falta un paso nuevo (no cambia nada de lo que ya señala).

### Entradas que suma P.10: Available offline (v0.083)

`availableOffline` y `storageDevice` de `src/help/entries.ts`, en la sección "Offline and syncing" ("Sin red y sincronización") (textos en
`src/i18n/lazy/help.ts`, en los dos idiomas), sin `when` ni atajos; las ventanas de `OfflinePart.tsx` cierran con Esc
(`menusClose` en `shortcutSources.ts`). La recorrida y la práctica no suman nada: el paso del estado de la
sincronización ya existe, y la práctica no tiene archivos ni base de archivos (solo lee lo marcado, no marca ni libera).
Cuando llegue la entrega 2 (liberar originales propios), el texto de `storageDevice` tiene que decirlo.

## 8. Tamaño y carga

- En la parte que se baja siempre: el registro, la decisión de si arrancar la recorrida y el botón "?". Menos
  de 3 KB comprimidos.
- Aparte, cada una con sus textos: la ayuda (`HelpDialog`), el motor y los pasos (`TourLayer`), la práctica
  (`PracticeView` y las plantillas; el editor ya se baja aparte). Todo `.js`, así que entra en la caché del
  service worker: anda sin red con la app instalada. Las fotos, si Lega acepta sumar `.webp` a la caché.

## Riesgos

1. **Que la práctica escriba algo real.** Es el riesgo grande: cualquier componente debajo del editor que
   llame a `useServices()` y guarde. Mitigación: los servicios que no hacen falta tiran un error, y la prueba de
   aislamiento (abajo) recorre todo lo que se puede hacer en la práctica con un servidor falso que cuenta cada
   escritura.
2. **Anclas que cambian o que no están** (el menú "/" y el tirador de BlockNote, partes que se bajan aparte, el
   cajón). Mitigación: `data-tour` propios con prueba, espera con tiempo máximo y paso centrado si no aparece.
3. **Choques con menús, diálogos y el carrete** (se cierran al tocar afuera, capturan el teclado, `z-index`). La
   recorrida no abre ninguno y se pausa si se abre uno.
4. **Teléfono:** teclado que tapa el globito, cajón animado, pantallas de 360 px con textos largos en castellano.
   Probar en iPhone (Safari y la app instalada) y en un Android chico.
5. **Que la ayuda quede vieja.** Mitigación: la regla, el registro con su prueba contra el editor y las entradas
   que citan atajos por id.
6. **Mod+K cambia de dueño con P.12 entrega 2** y Mod+Alt+Enter llega con P.11: si la ayuda sale antes, esas
   entradas se marcan `soon` y se prenden con su tanda.
7. (Sacado: la ayuda ya no tiene atajo de teclado.)
8. **Sin red al terminar la recorrida,** la marca de la cuenta no se escribe: queda la del dispositivo y se
   reintenta al volver la red.
9. **Mostrar la recorrida de más o de menos:** una persona nueva en un dispositivo donde otra ya la vio no la ve
   sola (le queda el punto en el "?"). Aceptable.
10. **Lectores de pantalla:** el foco de luz es solo visual; el orden del foco y la región `aria-live` tienen que
    alcanzar. Probar con VoiceOver.

## Entregas y pruebas

1. **Entrega 1, ayuda y registro de atajos.** `shortcuts.ts` y `shortcutLabel`, los tooltips pasan a usarlo, el
   esquema importa sus atajos, `HelpDialog` con las 15 secciones, la búsqueda, el botón "?", la entrada del menú
   de la cuenta; la regla en `Docs/index.md`. Sin práctica ni recorrida ("Ver la recorrida" y
   "Mostrame" no aparecen todavía). README y changelog.
   - Pruebas: unidad del registro (ids, textos, rótulos, choques), el editor real contra el registro (jsdom), las
     funciones `is…Shortcut` contra sus entradas, la búsqueda de la ayuda ("ctrl f", "carrete", tildes), la ayuda
     en jsdom (abre con el botón y con la entrada del menú; ninguna tecla la abre, tampoco "?" ni Mod+/; Esc
     cierra y devuelve el foco al botón), textos en los dos idiomas.
2. **Entrega 2, práctica y recorrida.** Ruta `/practice`, `PracticeView` con los servicios en memoria y los que
   tiran error, plantillas es/en, las tres fotos, `floating.ts` común con `Tooltip.tsx`, `TourLayer` y los diez
   pasos, `data-tour` en los componentes, `navOpen` como almacén, la marca `shotdocs_tour` de la cuenta, el
   arranque la primera vez, retomar, "Ver la recorrida" en la ayuda. `Docs/index.md` suma `/practice` a
   "Direcciones de la app".
   - Pruebas:
     - **Aislamiento (jsdom, con `FakeRemote` y la base local de prueba):** abrir la práctica, escribir, usar el
       menú "/", cambiar tamaños y filas, comentar y contestar la pregunta, reemplazar texto, empezar de nuevo;
       al final, cero escrituras en el servidor falso, la base local de páginas sin estados ni cola, la cola de
       fotos y la de comentarios vacías, `usePendingCount` en 0 y `useLeaveGuard` sin aviso.
     - **Motor (jsdom):** filtra por diseño y numera bien; *Siguiente*, *Atrás*, *Saltar*, →, ←, Esc; espera un ancla
       que aparece a los 500 ms y cae al centro si no aparece; se pausa al salir de `/practice`; el foco entra y
       vuelve; `aria-live`; sin transición con movimiento reducido; los estados `running` → `done` en el
       dispositivo y en la cuenta; retomar.
     - **Cuándo arranca:** nueva en todo → arranca; cuenta vista → no; dispositivo visto y cuenta no → no, con el
       punto; con link de invitación → la tarjeta; sin red la primera vez → arranca con el dispositivo.
     - **Marca de la cuenta:** se escribe al terminar o saltar, sin red queda para después, y las preferencias
       (`user_settings.prefs`) no cambian.
     - **Anclas:** cada `data-tour` de los pasos existe en `src/ui/`.
     - **De punta a punta** (`tour.mjs`, en el repo de pruebas privado, como `attach.mjs`): usuario nuevo con el
       almacenamiento vacío → práctica y "1/10"; recorrer todo en computadora y en un teléfono de 390×844
       (cada foco de luz dentro de la pantalla y sobre su ancla); escribir "/" avanza el paso 4; recargar a mitad
       y retomar; terminar y recargar → no vuelve; interceptar la red y comprobar que en la práctica no sale
       ningún pedido a Supabase (`page_updates`, comentarios) ni al portero. A mano: Safari de Mac, iPhone
       (Safari y la app instalada), Firefox, VoiceOver.
3. **Entrega 3, "Mostrame" y novedades.** El botón en cada entrada con `showMe` (un paso suelto en la práctica y
   vuelta a donde estaba), y un punto en el "?" cuando hay entradas con `since` más nuevo que la última vez que la
   persona abrió la ayuda ("Novedades"). Pruebas en jsdom del paso suelto y de la vuelta.

## Fotos del ejemplo

Lega pidió fotos con **licencia libre**. Se prefieren las **CC0** (dominio público, sin condiciones) de Wikimedia
Commons; las licencias de Unsplash y Pexels también dejan usarlas gratis y sin atribución, pero no son CC0 (no
dejan, por ejemplo, juntarlas para armar un servicio parecido) y conviene evitarlas en un repo público. Se
bajan, se recortan a unos 1200 px de ancho, se pasan a WebP (30 a 60 KB cada una) y se anota cada una en
`public/tutorial/LICENSES.txt`. Para que "Acomodar en filas" se luzca, conviene que no tengan todas la misma
proporción (una vertical).

Candidatas (tema: una ciudad de noche, como el plano de la terraza del ejemplo). Las encontré por búsqueda; la
red de trabajo no dejó abrir Commons, así que **la licencia y el autor de cada una se confirman en su página al
bajarla**, y si alguna no es CC0 se cambia por otra:

| Archivo en el repo | Fuente (Wikimedia Commons) | Autor | Licencia |
|---|---|---|---|
| `terraza-1.webp` | [File:City Lights at Night (Unsplash -uzgaA9LfNw).jpg](https://commons.wikimedia.org/wiki/File:City_Lights_at_Night_(Unsplash_-uzgaA9LfNw).jpg) | Alex Wong (vía Unsplash) | CC0 1.0 (a confirmar) |
| `terraza-2.webp` | [File:City-lights-night-street (24326520255).jpg](https://commons.wikimedia.org/wiki/File:City-lights-night-street_(24326520255).jpg) | (se anota al bajarla) | CC0 1.0 (a confirmar) |
| `terraza-3.webp` | [File:City at Night (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:City_at_Night_(Unsplash).jpg) | (se anota al bajarla) | CC0 1.0 (a confirmar) |

De repuesto: [File:Night (251499349).jpeg](https://commons.wikimedia.org/wiki/File:Night_(251499349).jpeg) y
[File:City lights from air at night 1.jpg](https://commons.wikimedia.org/wiki/File:City_lights_from_air_at_night_1.jpg)
(también CC0 según la búsqueda).

## Decisiones

### Respondidas por Lega el 2026-09-30

1. **La práctica se pierde al recargar:** de acuerdo, **pero siempre se puede volver a cargar**: la entrada
   *Practicar* de la ayuda la abre, o la arma de nuevo de cero, cuando se quiera (además de *Empezar de nuevo*
   en el aviso de la página).
2. **Arranca sola solo la primera vez, para alguien nuevo y en el inicio:** de acuerdo. Con un link a una
   página, o si ya usaba la app, se abre lo de siempre y la recorrida queda ofrecida con la tarjeta o el punto
   en el "?".
3. **Fotos del ejemplo con licencia libre:** sí; la lista y cómo se anotan, en "Fotos del ejemplo".
4. **"Animado" = el foco de luz que se desliza y un pulso suave, sin videos ni GIF:** de acuerdo.
5. **La ayuda se abre solo con el botón "?"** (al lado de Papelera) **y con "Ayuda y atajos" del menú de la
   cuenta. Ningún atajo de teclado:** ni "?" ni Mod+/.

### Tomadas en el diseño (sin objeciones)

- "Ya la vi" en la cuenta (metadatos del usuario de Supabase Auth, por workspace) y en el dispositivo; no se
  repite en otro dispositivo ni en otro workspace (queda el punto en el "?").
- Sin fotos ni archivos propios en la práctica en la entrega 2 (aviso); más adelante, fotos propias solo en
  memoria.
- Motor propio, sin librerías (las buenas son AGPL o pesan más que lo que hacen).
- Diez pasos con los textos de la sección 4 (nueve en el teléfono).
- La ayuda en un diálogo grande (pantalla completa en el teléfono).
- La regla de la ayuda en `Docs/index.md` y en las reglas de trabajo, revisada en cada auditoría.

## Correcciones de la auditoría (mandan sobre lo de arriba)

Una auditoría independiente contrastó el diseño con el código de `main` y de `lega/colapsar`. Lo de fondo (práctica
en memoria, motor propio, registro de atajos, la regla) se mantiene. Lo simple ya se corrigió arriba; esto manda
sobre lo que quede.

### Práctica

1. **(Bloqueante) Solo las escrituras tiran error.** Con `tree` y `engine` que tiran en cualquier llamada, la
   práctica se rompe al primer dibujo: `SheetBreaks` usa `useTree` y el formato de hoja (`tree.resolveSetting`),
   `CarreteHost` y el panel de comentarios usan `useSyncStatus`, `useCommentAccess` llama a `usePermissions`, y
   `Rejected` usa `engine.retryRejected`. Se envuelven con un `Proxy` que deja pasar una lista de lecturas
   (suscribirse, estado, revisión, `resolveSetting`, permisos) y tira solo en lo que escribe; o esos datos
   entran por props o por un contexto de la práctica. Todo lo que usa `useServices()` ahí: `BlockEditor`
   (`files`, `media`, `user`), `CarreteHost`, `useCommentAccess`, `CommentsPanel` (el panel y `Rejected`),
   `SheetBreaks` (`tree` y `media`), `CommentMargin`, `MediaToolbarButtons`, `AttachmentSheet` y
   `CommentsToggle`. La práctica pasa `canComment` y el permiso de editar como `true` sin preguntarle al árbol.
2. **Las bases del dispositivo, una por una.** En `lega/colapsar`, lo colapsado se guarda en la base local real
   (`meta`, `collapse:<pageId>`). La práctica pasa `db: null` (el almacén de colapsar lo acepta) y un `Map`
   nuevo; `mediaDb`, `commentsDb`, `access`, `sizes`, `shutdown` y `dbName` se listan explícitamente (nulos o
   que tiran al escribir). La prueba de aislamiento compara `meta` y el `localStorage` antes y después.
3. **`PracticeView` copia lo que hacen `PageView` y `PageEditor`,** porque la práctica no pasa por ellos: el Mod+F
   y la `FindBar` viven en `PageEditor`; `BlockEditor` hoy no se exporta (hay que exportarlo); la impresión necesita
   `article.page[data-page-id]` y `.page-header` (si no, `printPage` va a `openPage`, navega y espera 20 s);
   el editor se vuelve a montar al cambiar el idioma. La barra de arriba muestra lupa, comentarios y "⋯" solo
   con `pageId && current` (`Workspace.tsx`), y `CommentsToggle` queda afuera de cualquier `Provider` de la
   práctica: el `Provider` va en el nivel de `Shell`, alrededor de los botones de la barra y del `article`.
4. **Dónde vive el `Y.Doc`.** Salir de la sesión no recarga la página (`menus.tsx`): un documento guardado a nivel
   de módulo pasaría a la sesión de la persona siguiente. Va en un `WeakMap<Services, Y.Doc>` (muere con los
   servicios del workspace) o se borra al desmontar `Workspace`.
5. **Arrancar sola, solo a alguien nuevo y solo en el inicio.** Con el diseño anterior, al publicar le arrancaría a
   todos los que ya usan la app y cortaría los links a páginas. Arranca en `/` y solo si `useBootServices` no
   tenía `workspaceId` (primera carga de ese workspace en ese dispositivo); los demás ven el punto o la tarjeta.
13. **Soltar o pegar en la práctica:** hoy un archivo que no es imagen muestra `editor.attachNeedsDrive`
   (`PageEditor.tsx`), no el aviso de la práctica; igual las imágenes `data:` pegadas (`storeEmbedded`). La
   práctica pasa su propio `store` y `storeEmbedded` con su aviso.
18. **Fotos:** tienen que ir con dirección absoluta. `/tutorial/*.webp` pasa a ser un contrato público (una foto
   pegada en una página real apunta ahí para siempre): no se renombran ni se borran. En vez de sumarlas a la
   instalación, una regla de Workbox `runtimeCaching` `CacheFirst` para `/tutorial/`.

### Teclado y registro

6. **Sin Mod+/.** En un teclado en castellano "/" es Shift+7: ProseMirror cae al código de la tecla y Mod+/
   termina en Mod+Shift+7 (lista numerada). (Después Lega decidió que la ayuda no tenga ningún atajo: quedan
   solo el botón y la entrada del menú.)
7. **Mod+K y Mod+P no miran la distribución del teclado** (`ProjectSwitcher.tsx`, `printPage.ts`): antes de la
   prueba del registro se sacan `isProjectShortcut` e `isPrintShortcut` con `modPressed` e `isLetter`
   (`findUi.ts`). Mod+K pasa a la búsqueda del proyecto en la rama de P.12 entrega 2.
8. **La prueba del editor contra el registro cubre menos de lo dicho.** Se puede leer
   `getExtensionField(..., 'addKeyboardShortcuts')` y los atajos del administrador de extensiones (privado), pero
   no ve el Mod+K de `CreateLinkButton` (React), las teclas del menú "/", las reglas de entrada ni los `keymap()`
   sueltos. Depende de una API privada; tiene que armar el editor con las mismas extensiones que la app (una sola
   función `editorExtensions()` para los dos) y la lista de lo que no se documenta es más larga. Lo que no ve va
   al registro a mano, con su prueba de unidad.
9. **El menú "/" muestra "Mod-Alt-c" en Bloque de código,** aunque 0.55 no tiene ese atajo: se saca el rótulo en
   los ítems del menú y no va a la ayuda.
11. **Textos:** la prueba exige cada clave escrita literal en el código, así que `steps.ts` y `entries.ts` las
   escriben enteras (nada de `tour.${id}.title`); `translate` solo reemplaza `{\w+}`, así que los atajos van como
   `{modK}` (no `{Mod+K}`); las claves de una parte aparte solo en archivos que la importan, así que los textos de
   los atajos (que usan los tooltips) van en el diccionario de la primera carga (entra en los 3 KB), y
   `help.ts` y `tour.ts` se suman a la lista `LAZY` de la prueba.
14. **Más copias de rótulos e `IS_MAC`:** `CommentsPanel.tsx` ('⌘↩'), `carrete.keyboard`, `find.close` ("Esc"),
   `mediaButton.space`, `COLLAPSE_SHORTCUT_LABEL` (colapsar). Todas pasan al registro.

### Recorrida

10. **Capas y toques.** BlockNote usa `z-index` 20 (menú lateral), 50 (barra), 80 (menú "/"), 90 (panel de
    archivos); la app 50 (menús), 60 (diálogos), 70 (avisos), 95 (carrete), 100 (tooltips). Se fija un orden
    preciso para el foco de luz y el globito. En los pasos interactivos no se oscurece nada; en los demás, el
    foco de luz **no deja tocar lo señalado** (un clic en el "+" real o un arrastre crearía o movería una página
    real). Las teclas se escuchan solo en el globito, no en `window`. En un diálogo no modal no se atrapa Tab (o
    se hace modal de verdad, con `aria-modal` e `inert` en el resto).
15. **Lo que no se puede reusar tal cual:** `Tooltip.tsx` solo pone arriba o abajo y se esconde al desplazar o
    cambiar el tamaño; `trapTab` es privado de `Carrete.tsx`; `useFloating` cierra al tocar afuera (no sirve para
    el globito). Se saca lo común a `floating.ts` y el resto se escribe para la recorrida.
16. **Anclas dentro de BlockNote:** `practice-empty-line` y `practice-photos` no pueden ser atributos puestos a
    mano en el DOM del editor: se buscan por el id del bloque de la plantilla (`[data-id="..."]`). El menú "/"
    abierto se detecta con el estado de la extensión `SuggestionMenu`, no buscando su clase.
17. El paso 5 habla de adjuntos solo si hay Drive conectado; en el teléfono el ícono del paso 9 está en la barra
    de arriba (corregido arriba).
19. `TourLayer` se monta adentro de `Shell` (necesita los servicios y el almacén del cajón).
20. **Qué aviso se cuida:** `useLeaveGuard` es el del cambio de workspace; el de salir de la sesión es
    `AccountMenu.signOut` (`menus.tsx`). La prueba de aislamiento mira los dos.
21. (Ya no aplica: la ayuda no tiene atajo de teclado, decisión de Lega.)
22. **Más simple en la primera versión:** el estado del dispositivo queda en `{ v, done, step }` (sin `skipped`
    aparte); `MemoryComments` se tipa como `Pick<CommentQueue, …>` con lo que se usa. La prueba de punta a punta
    suma la red (ningún pedido a Supabase ni al portero) y la diferencia de `localStorage` y de `meta` en
    IndexedDB.

### Dónde se guarda "ya la vi"

12. **No en `user_settings.prefs`.** `cleanPrefs` guarda solo las claves de `CHOICES` y `push` sube el objeto
    entero: todas las versiones publicadas borrarían `tour`, `KEYS`/`dirtyKeys` nunca subirían una clave que no
    es de una lista, "el dispositivo la vuelve a subir" es falso y no hay aviso de "terminó de leer la cuenta".
    Va en los metadatos del usuario de Supabase Auth del workspace: `client.auth.updateUser({ data: {
    shotdocs_tour: 1 } })`. Es por workspace (cada uno tiene su Supabase), sin migración, ninguna versión vieja
    lo reescribe y llega con la sesión (no hay que esperar otra lectura).

### Preguntas de estas correcciones

Respondidas por Lega el 2026-09-30: ver "Decisiones".

## Cómo quedó (entregas 1 y 2, v0.082)

### La ayuda y el registro de atajos (entrega 1)

- **El registro** (`src/ui/shortcuts.ts`, en la primera carga): 73 atajos con `id`, teclas en el formato de
  ProseMirror, lugar (`global`, `editor`, `markdown`, `photos`, `carrete`, `find`, `comments`, `tree`, `menus` y
  `tour`), `context` (cuándo vale dentro del lugar), de quién es y cómo se toma (`keymap`, `window`, `dom`, `react`,
  `typed`). `IS_MAC` vive acá (findUi lo reexporta); `shortcutLabel(id, mac, lang)` arma ⌘⌥M / Ctrl+Alt+M. Se fueron
  `FIND_SHORTCUT_LABEL`, `COMMENT_SHORTCUT_LABEL`, `QUESTION_SHORTCUT_LABEL`, `SEARCH_SHORTCUT_LABEL`, las copias de
  `IS_MAC` de `CommentsPanel.tsx` y `collapseEditor.ts`, y los rótulos sueltos del carrete. El esquema, las filas de
  fotos y colapsar toman sus teclas del registro (`shortcutKeys`).
- **Los ids van en camelCase** (`findNext`, `carreteClose`): con punto chocaban con claves del diccionario
  (`find.next`, `carrete.next`) y la prueba de las claves sin usar dejaba de ver si se usaban.
- **Los textos de cada atajo no van en la primera carga** (aparte de la corrección 11): están en la parte de la ayuda
  (`src/help/shortcutTexts.ts`, claves `shortcut.*` en `src/i18n/lazy/help.ts`), y el registro queda chico. Una
  prueba exige un texto en los dos idiomas por atajo.
- **El menú "/"** muestra los rótulos del registro (`slashBadge`) y "Bloque de código" queda sin el ⌘⌥C que BlockNote
  0.55 rotula y no existe (corrección 9). Script suma su rótulo.
- **Las extensiones del editor** salen de una sola función (`pageEditorExtensions`, `src/ui/editorExtensions.ts`), que
  usan la página, la práctica y la prueba.
- **La ayuda** (`src/help/HelpDialog.tsx`, se baja aparte con `src/i18n/lazy/help.ts`): botón "?" al lado de
  Papelera (sin tooltip) y *Help and shortcuts* en el menú de la cuenta; ninguna tecla la abre. 760 px con el índice a
  la izquierda; en el teléfono, pantalla completa con el índice en una fila arriba. Las 15 secciones, 48 entradas
  (`src/help/entries.ts`) con sus atajos por id, y la tabla entera por lugar. La búsqueda (`src/help/search.ts`) usa
  `normalize.ts`, mira los dos idiomas y los rótulos de las dos plataformas ("ctrl f", "⌘F" y "Ctrl+F" llevan a
  Buscar). Una entrada de algo que la persona no puede usar (`when`: adjuntos sin Drive, miembros sin ser admin) se ve
  apagada con el porqué. Esc cierra y el foco vuelve al botón que la abrió; Tab queda adentro (es modal). Las entradas
  de lo que ya existía llevan `since: '0.081'`; las nuevas, `0.082` (para las novedades de la entrega 3).
- **Textos de otras funciones que ya están:** el árbol con el teclado (v0.074), archivar y borrar proyectos (v0.077) y
  sus archivos en Drive (v0.080, solo dueño y admins), las fotos HEIC como JPEG (v0.075), las fotos en el renglón
  (v0.078: pegar y soltar donde está el cursor, elegir varias con Shift+clic, Shift+flechas o arrastrando, escribir
  al lado, borrar, los tiradores que imantan, la barra por sectores y el PDF por filas), instalar la app (v0.079,
  apagada con "Esta ya es la app instalada" si lo es, con el botón que abre la ventana de instalar) y las carpetas
  (v0.081, cuatro entradas en "Archivos adjuntos", solo con portero). *Convert photos to inline* no tiene entrada en
  la interfaz (D-26): no va en la ayuda. Atajos nuevos en el registro: borrar las fotos elegidas (Supr / Retroceso),
  pegar archivos (Mod+V), Esc en el visor de una carpeta (sube un nivel) y las flechas de las pestañas de la ventana
  de instalar; Espacio abre también la primera de varias fotos elegidas y una carpeta. Las entradas que esas funciones
  habían dejado escritas en este documento ("Entradas de funciones que llegaron antes que la ayuda", "Entradas que
  suma P.9" y "Entradas esperando la ayuda") ya están en `src/help/entries.ts`.

### La práctica y la recorrida (entrega 2)

- **`/practice`** (`src/router.ts`). `PracticeView` (`src/tutorial/`, se baja aparte) arma su propia barra de arriba
  (migas "Práctica", lupa, comentarios y "⋯") y el `article.page[data-page-id="practice"]` con su `.page-header`,
  el aviso (*Empezar de nuevo*, *Salir*), el título en memoria, la `FindBar` con Ctrl/⌘+F y el `BlockEditor` de la
  página (ahora exportado, con `filesNotice`). El Provider de la práctica envuelve solo los botones de la barra y el
  artículo: la barra lateral y el ícono de sincronización del teléfono siguen con los servicios de verdad.
- **Aislamiento** (`practiceServices.ts`): `MemoryComments` (la misma `buildThreads` que la cola real, con el hilo de
  ejemplo ya contestado), fotos y archivos que avisan "En la práctica no se suben archivos" (también pegar, soltar,
  elegir y las `data:`), `access` sin datos (`Permissions` deja editar y comentar sin preguntarle al árbol), `db`,
  `mediaDb` y `commentsDb` en `null` (lo colapsado queda en memoria), y `tree`, `engine`, `docs`, `remote`, `client`
  y `sizes` envueltos en un `Proxy` que deja pasar una lista de lecturas y tira `PracticeWriteError` en cualquier
  otra llamada; los objetos que cuelgan de ellos (`client.auth`, la base del árbol, el cliente de la cola) quedan
  envueltos igual, sin ninguna lectura. El tamaño de hoja de la práctica vive en la sesión (el `Proxy` del
  árbol responde `resolveSetting`). La sesión va en un `WeakMap` por instancia de servicios (corrección 4).
- **El documento**: plantillas `practice.es.ts` y `practice.en.ts` en el idioma de la interfaz al armarla, pasadas al
  fragmento de siempre con `blocksToYXmlFragment`; ids fijos para la pregunta, el renglón de las fotos y el renglón
  vacío. **Las tres fotos van en línea** (nodos `photo` en un párrafo, con el ancho `w` de `arrangeRows`: una fila a
  la misma altura, como deja *Arrange in rows*), como las crea hoy la app desde v0.078; la primera versión de la
  práctica usaba la fila vieja de fotos-bloque y enseñaba algo que una página nueva ya no hace (no se podía escribir
  al lado). El paso "Fotos" de la recorrida lo dice: van en el renglón, como letras.
- **Las fotos del ejemplo** (`public/tutorial/terraza-{1,2,3}.webp`, 60 a 72 KB, 3:2, 2:3 y 16:9): **no son las de
  la lista** de "Fotos del ejemplo". La red de trabajo no deja bajar de Commons y bajar archivos pide permiso de Lega,
  así que se dibujaron para la app (una terraza de noche, con un script de canvas que no se versiona); no hay nada de
  terceros que atribuir (`LICENSES.txt`). Si Lega prefiere fotos, se reemplazan con los mismos nombres (son un
  contrato público). Regla de Workbox `CacheFirst` para `/tutorial/*.webp` (corrección 18).
- **El motor** (`TourLayer.tsx`, aparte): foco de luz con sombra de 100vmax que se desliza en 250 ms y pulsa (nada con
  movimiento reducido), una capa que no deja tocar lo señalado salvo en el paso interactivo (y `inert` en la app: Tab
  tampoco llega a la barra lateral de verdad), globito con `n/total`,
  *Atrás*, *Siguiente* / *Terminar* y *Saltar recorrida*; → y Enter avanzan, ← vuelve, Esc sale con el aviso; región
  `aria-live`; los tooltips se apagan mientras dura; se esconde si se abre un diálogo o el carrete. Posición con
  `placeNear` (`src/ui/floating.ts`), que ahora también usa `Tooltip.tsx`. En el teléfono, hoja abajo arriba del
  teclado (o arriba, si taparía lo señalado, como el "?" del pie del cajón). Lo decide la altura de la hoja **abajo**
  (arriba mide otra cosa: otro relleno y el notch); con la de donde estaba, lo señalado justo en el borde la hacía
  saltar de abajo a arriba sin parar y React cortaba la recorrida (pasaba en inglés, en el paso del menú "/"). El cajón pasó a un almacén
  (`src/ui/navStore.ts`) y la recorrida lo abre en los pasos que lo piden.
- **Diferencias con el diseño, para que Lega confirme:**
  1. **El paso del menú "/" avanza cuando el menú se cierra** (se eligió algo o Esc), no cuando aparece: si avanzaba al
     aparecer, el foco se iba al globito y el menú se cerraba antes de poder usarlo. *Siguiente* sigue disponible. Se
     mira el estado de la extensión `suggestionMenu` de BlockNote, no su clase (corrección 16).
  2. **En el teléfono sale el paso de Buscar** (quedan nueve): el diseño no decía cuál salía.
  3. **Primera carga entrando por un link a una página** (sin invitación): también la tarjeta "¿Primera vez?".
  4. **El punto del "?"** está mientras la recorrida no se terminó en este dispositivo y la ayuda nunca se abrió en él.
- **Arranque y "ya la vi"** (`tourState.ts` y `TourHost.tsx`, en la primera carga): `Services.firstLoad` dice si la
  base local no tenía proyecto (corrección 5); el dispositivo guarda `{ v, done, step, account }` en
  `shotdocs-tour`; la cuenta, `shotdocs_tour: 1` en los metadatos del usuario de Supabase Auth del workspace (se lee
  con `getSession`, sin red; se escribe con `updateUser`, y sin red queda `account: false` y se reintenta al abrir y
  al volver la red). Nada va a `user_settings.prefs` (corrección 12).

### Pruebas

- `src/ui/shortcuts.test.ts`: el registro (ids, textos, rótulos de las dos plataformas, sin choques), el editor real
  contra el registro en los dos sentidos (BlockNote, Tiptap y nuestras extensiones; las reglas de lo que se escribe),
  cada `is…Shortcut` con eventos de Mac y de Windows, ninguna función de atajos sin registrar, ninguna combinación
  suelta en el código, ningún `keymap()` suelto, y **cada tecla que un archivo compara con un evento** tiene que ser
  de un atajo registrado para ese archivo (`src/ui/shortcutSources.ts`): `e.key === 'x'` y `'x' === e.key`, con
  `.toLowerCase()`, `case` de un `switch` sobre la tecla, `isLetter`, `e.code === 'KeyX'`, una expresión regular
  (`/^F8$/.test(e.key)`, `/^Arrow(Left|Right)$/`; si tiene clases o comodines la prueba la nombra para que se mire),
  `['a', 'b'].includes(e.key)` y la tecla guardada aparte (`const { key } = event`, `const { key: k } = e`,
  `const k = e.key`). Una prueba con código de ejemplo fija cada forma. Los rótulos del menú "/". No ve teclas
  guardadas en un `Set` con nombre ni las que pasan por una función propia (`isTreeKey`): ahí sigue haciendo falta
  la revisión de la auditoría.
- `src/help/help.test.tsx`: la búsqueda (atajos escritos de varias formas, tildes, los dos idiomas) y el diálogo en
  el Shell (lo abren el "?" y el menú, ninguna tecla, Esc devuelve el foco, castellano).
- `src/tutorial/tourState.test.ts`: cuándo arranca (los siete casos), la marca de la cuenta (con y sin red, sin tocar
  las preferencias), los pasos por diseño y que cada `data-tour` exista.
- `src/tutorial/practice.test.tsx`: la plantilla (las tres fotos en línea, en un renglón y a la misma altura, sin
  fotos-bloque), aislamiento con el Shell y la app de verdad (escribir, comentar, contestar y
  resolver la pregunta, la hoja, buscar, agregar archivos, empezar de nuevo, salir: el servidor, la base local
  `meta`, las colas, los contadores de "sin subir" y `localStorage` quedan iguales; lo que escribiría tira
  `PracticeWriteError`) y el motor (arranque, Siguiente, Atrás, flechas, Esc con el aviso, sin ancla al centro,
  pausa y seguir, retomar, la cuenta que ya la vio con el punto y la ayuda, el link de invitación).
- En Chromium sin ventana (un arnés con el servidor en memoria, fuera del repo): la ayuda en computadora, teléfono y
  oscuro; la recorrida entera en computadora y teléfono (claro y oscuro), cada foco de luz dentro de la pantalla y
  sobre su ancla; "/" y elegir avanza el paso 4; Esc, volver a verla desde la ayuda, recargar a mitad y retomar, el
  punto, la tarjeta del link, sin red al terminar, movimiento reducido y cero pedidos de red en la práctica. Después
  de la unión con main (v0.078 a v0.081): la recorrida en el teléfono en 10 tamaños (360×640 a 428×926) y los dos
  idiomas sin trabarse; las fotos de la práctica (se ven, un clic elige con barra y tiradores, Shift+clic elige las
  tres, 1/2, *Arrange in rows*, escribir al lado, el carrete; en el teléfono el toque abre y el segundo muestra la
  barra); y los recorridos de fotos en línea, carpetas e instalar la app comparados con los de main.
- **Auditoría independiente** (antes de cerrar): sin bloqueantes. Se corrigieron la ayuda que prometía Shift+clic
  "para todos" en colapsar (todavía no existe), la prueba de atajos (ahora mira cada tecla, no solo el archivo), los
  tooltips apagados durante la pausa, el cajón que quedaba cerrado al retomar en el teléfono, el teclado que llegaba a
  la app durante un paso, el `Proxy` sin los objetos anidados, la hoja del teléfono que no seguía al teclado y textos
  ("Print as shown", "/ Guion", los 30 días de proyectos borrados, la papelera de archivos solo con Drive, Ctrl/⌘+K
  busca y no crea). La segunda auditoría (la unión con main) corrigió *Images in a row* en la ayuda en inglés, la
  práctica con fotos en línea, la prueba de atajos con las formas que no veía y el sangrado de `Workspace.tsx`; el
  recorrido en el navegador encontró la hoja del teléfono que saltaba sin parar. Quedan para Lega: una foto real (`sdmedia://`) pegada en la práctica se ve rota (no escribe
  nada), y "ya la vi" y el paso a medias son del dispositivo, no de la persona (otra persona en el mismo navegador ve
  "¿Seguimos la recorrida?"; la marca de la cuenta va solo al workspace donde se terminó).
- **Falta probar a mano:** Safari de la Mac, el iPhone (Safari y la app instalada, con el teclado en pantalla en el
  paso del menú "/"), Firefox y VoiceOver. La prueba de punta a punta `tour.mjs` del repo de pruebas privado todavía
  no está.

## Entradas esperando la ayuda

**Ya están en la ayuda (v0.082):** esta entrada es `projectsDrive` de `src/help/entries.ts`. Se deja el texto como
referencia. Desde v0.082 cada función nueva suma su entrada directamente en `src/help/entries.ts` (regla de
`Docs/index.md`), no acá.

- **Archivar o borrar un proyecto (P.14, entregas 1 y 2; `Doc_Proyectos_Borrar.md`).** La entrada de la entrega 1
  está en "Cómo quedó (entrega 1)". La entrega 2 le suma:

  > **Its files in Google Drive.** When the workspace owner or an admin deletes a project, *Also send its files to the
  > Google Drive trash* sends its whole folder to the Drive trash; it starts unticked. Google deletes it for good after
  > 30 days; *Restore* before that brings the folder back with everything in it. From *Deleted projects* you can also
  > send it later. If Google Drive no longer has the folder, the app asks before restoring the pages without their
  > files, and *Look for its files again*, on the project's start page, brings them back if the folder turns up.
  >
  > **Sus archivos en Google Drive.** Cuando el dueño del workspace o un admin borra un proyecto, *Mandar también sus
  > archivos a la papelera de Google Drive* manda su carpeta entera a la papelera de Drive; arranca destildada. Google
  > la borra para siempre a los 30 días; *Restaurar* antes la trae de vuelta con todo lo de adentro. Desde *Proyectos
  > borrados* también se puede mandar después. Si Google Drive ya no tiene la carpeta, la app pregunta antes de
  > restaurar las páginas sin sus archivos, y *Buscar sus archivos de nuevo*, en el inicio del proyecto, los trae si la
  > carpeta aparece.
