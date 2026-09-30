# Tutorial animado y ayuda (P.13)

Estado: **diseño, sin implementar.** Falta la auditoría previa y que Lega confirme las decisiones del final. Lo
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
- **Sin migración ni tablas nuevas.** Lo único que puede ir a la cuenta es una clave más en
  `user_settings.prefs` (ya es `jsonb`, tope 4000 caracteres).
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
| Fotos y videos | `imageRowsEditor.ts`, `MediaToolbarButtons.tsx` | Primer clic elige, segundo abre el carrete; tamaños rápidos (entero, 1/2, 1/3, 1/4), fotos en fila, "Acomodar en filas". |
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
| Mod+Alt+M | Comentar el bloque del cursor (o el señalado) | Editor | App (`commentsUi.ts`) |
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
| "/" | Menú de bloques | Editor | BlockNote |
| "# ", "## "…, "- ", "1. ", "[] ", "> ", "---", "```" | Título, viñeta, numerada, casilla, cita, divisor, código | Editor, al principio del renglón | BlockNote |
| Clic en una foto elegida, doble clic, barra espaciadora | Abrir el carrete (en un adjunto: abrir o bajar) | Editor | App (`PageEditor.tsx`) |
| ← / → | De una foto a otra en una fila | Foto de una fila elegida | App (`imageRowsEditor.ts`) |
| ↑ / ↓ | Salir de la fila | Foto de una fila elegida | App |
| Enter | Párrafo nuevo después de toda la fila | Foto de una fila elegida | App |
| ← / →, Inicio / Fin, Esc, rueda o doble clic | Anterior / siguiente, primera / última, cerrar, zoom | Carrete | App (`Carrete.tsx`) |
| ↑ / ↓, Enter, Esc | Elegir cómo pegar un link de Drive | Menú de pegar Drive | App (`DrivePasteMenu.tsx`) |
| Enter, → / ← | Abrir la página, abrir o cerrar sus páginas de adentro | Árbol | App (`Sidebar.tsx`) |
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
  el pie. No aparece en el árbol; se entra desde la recorrida y desde la ayuda ("Abrir la página de
  práctica").
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
  planos?") con un hilo de ejemplo ya contestado, una fila de tres fotos, una tabla de tomas y un H2 con texto
  debajo (para colapsar, cuando exista P.11). Ni tarjeta de Drive (cargaría un reproductor de Google) ni
  adjunto (la tarjeta sale de un archivo registrado en el Drive): los explican la recorrida y la ayuda.
- **Fotos del ejemplo:** tres WebP chicas (unos 1200 px de ancho, 30 a 60 KB cada una) en `public/tutorial/`,
  con la dirección de la app (`https://<app>/tutorial/terraza-1.webp`). El carrete ya las acepta (fuente
  `web` de `carreteSourceOf`), y los tamaños rápidos y "Acomodar en filas" andan igual. Para que la práctica
  ande sin red se suman a la caché del service worker (`globPatterns` hoy no incluye `.webp`: unos 150 KB más
  en la instalación). Tienen que ser fotos propias o con licencia libre, anotada al lado.
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
  hilo de ejemplo), y `docs`, `engine`, `tree`, `remote`, `client` reemplazados por objetos que **tiran un
  error** si alguien los llama: si un componente de abajo intenta guardar algo real, falla en las pruebas en
  vez de escribir.
- Para eso `CommentQueue` y `MediaQueue` se describen con una interfaz (lo que usan los componentes: leer hilos,
  suscribirse, agregar, resolver una dirección, `fileInfo`, `display`), y la práctica implementa solo eso. Lo
  que hoy usa `useServices()` debajo del editor: `EditorComments`, `CommentsPanel`, `CommentsToggle`,
  `MediaToolbarButtons`, `SheetBreaks`, `AttachmentSheet`. La lista se revisa en la auditoría.
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
| 5 | `practice-photos` | Fotos / Images | Un clic elige una foto y otro la abre en grande. En su barra elegís el tamaño o las acomodás en filas. Soltá cualquier archivo (PDF, zip) y queda como tarjeta. | One click selects an image, another opens it full screen. Its toolbar sets the size or arranges a row. Drop any file (PDF, zip) to attach it. |
| 6 | `comments` (ícono de arriba) | Comentarios y preguntas / Comments and questions | Comentá cualquier bloque ({Mod+Alt+M}) y acá ves todos los hilos. Una pregunta, como la del ejemplo, la puede contestar quien solo comenta. | Comment on any block ({Mod+Alt+M}); all threads are here. A question, like the one above, can be answered by anyone who can comment. |
| 7 | `find` (lupa) | Buscar / Find | Buscá y reemplazá en la página ({Mod+F}). | Find and replace in the page ({Mod+F}). |
| 8 | `page-menu` ("⋯") | La página / The page | Compartir, mover, tamaño de hoja y Exportar PDF ({Mod+P}). | Share, move, page size and Export PDF ({Mod+P}). |
| 9 | `sync` | Siempre guardado / Always saved | Todo se guarda primero en tu dispositivo y se sube solo, también sin red. Acá ves si falta subir algo. | Everything is saved on your device first and uploads by itself, even offline. This shows if anything is pending. |
| 10 | `help` ("?") | Ayuda / Help | Acá está todo explicado, con todos los atajos. Desde acá podés volver a ver esta recorrida. | Everything is explained here, with every shortcut. You can replay this tour from here. |

- `{Mod+K}` y los demás se reemplazan con el rótulo del registro para esa plataforma (⌘K o Ctrl+K). Cuando
  P.12 entrega 2 cambie Mod+K, el paso 3 cambia solo con el registro (y su texto, en la misma tanda).
- **Teléfono:** sin el paso 7 como atajo (la lupa sigue, texto sin atajo); el 2, el 3 y el 9 abren el cajón;
  el 5 dice "Tocá una foto para verla en grande"; el 10 señala la ayuda en el cajón.
- El menú de la cuenta (preferencias, idioma, miembros, Drive) no tiene paso propio: lo nombra el 9 si hace
  falta y lo explica la ayuda. Diez pasos es el tope; más cansa.

### Cuándo aparece y dónde se guarda que ya se vio

- **Estado en el dispositivo** (`localStorage`, clave `shotdocs-tour`, una por dispositivo, no por workspace:
  es lo que la persona sabe de la app, no un dato del workspace): `{ v, state: 'running' | 'done' |
  'skipped', step }`. `v` es la versión de la recorrida (sube solo si cambia mucho).
- **Estado en la cuenta** (por workspace, porque cada workspace es una isla): una clave `tour` en
  `user_settings.prefs` con la versión vista. Sigue a la persona en sus dispositivos dentro de ese workspace.
  `cleanPrefs` la valida aparte (un entero chico) y **no cuenta** para el aviso de preferencias sin subir al
  salir. Una versión vieja de la app la borra de la cuenta si sube sus preferencias (sube el objeto entero),
  igual que pasó con el idioma: el dispositivo se queda con su copia y la vuelve a subir.
- **Arranca sola** cuando la persona entra a la pantalla de siempre (con un proyecto) y **ni el dispositivo ni
  la cuenta** dicen que ya la vio. Se espera la lectura de la cuenta (o su falla, sin red) para no mostrarla de
  más. Va a `/practice` y muestra el paso 1.
  - En otro dispositivo (la cuenta dice vista) o en otro workspace (el dispositivo dice vista): no arranca;
    el "?" lleva un punto hasta que se abre la ayuda.
  - **Con un link de invitación a una página** (`inviteTarget`): primero se abre esa página, y la recorrida se
    ofrece con una tarjeta chica ("¿Primera vez? Recorrida de 2 minutos · *Empezar* · *Ahora no*") en vez de
    llevar a la práctica. A confirmar (decisión 3).
  - Sin proyectos (la pantalla "todavía no tenés proyectos") no arranca: espera a la pantalla de siempre.
- **Retomar:** si se recarga a mitad (`state: 'running'`), al volver aparece la tarjeta "¿Seguimos la
  recorrida? · Paso 4 de 10 · *Seguir* · *Terminar*".
- *Saltar* y *Terminar* cuentan igual como vista. **Volver a verla:** desde la ayuda, siempre desde el paso 1.

## 5. La ayuda

### Dónde está

- **Un botón "?"** en el pie de la barra lateral, al lado de Papelera (en el teléfono, en el cajón), con
  `data-tip` "Ayuda y atajos (?)".
- **En el menú de la cuenta**, "Ayuda y atajos".
- **Teclado:** "?" (Shift+/ o la tecla que escriba "?") con el foco fuera de un lugar donde se escribe, como en
  Gmail o GitHub, y **Mod+/** desde cualquier lado (en Safari de la Mac, ⌘/ muestra la barra de estado: se
  toma solo con el foco en la app). Los dos van al registro.
- **Cómo se ve:** un diálogo grande (720 px, con el índice a la izquierda) en la computadora; pantalla completa
  en el teléfono. Es una parte que se baja aparte (`lazyPart`), con sus textos en `src/i18n/lazy/help.ts`. Se
  abre en la sección que corresponde si se llama desde un lugar (por ejemplo, "Atajos").

### Qué tiene

Arriba, un campo de búsqueda; abajo, las secciones:

1. **Primeros pasos:** *Ver la recorrida*, *Abrir la página de práctica*.
2. **Páginas y proyectos:** crear, anidar, arrastrar, renombrar, mover, títulos cortos, proyectos, workspaces.
3. **Escribir:** menú "/", títulos, listas, tabla, cita, código, divisor, atajos de Markdown, Script (con sus
   colores de escena), deshacer.
4. **Fotos y videos:** elegir y abrir, tamaños, filas, "Acomodar en filas", el carrete, el teléfono (en fila o
   apiladas), qué pasa sin red.
5. **Archivos adjuntos:** soltar o pegar cualquier archivo, abrir o bajar, la hoja del teléfono.
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

## 6. Un solo registro de atajos

- **`src/ui/shortcuts.ts`** (en la parte que se baja siempre, chico): una lista con `id`, `keys` en el formato de
  ProseMirror (`'Mod-Alt-m'`, `'Mod-f'`, `'F3'`, `'?'`), el lugar (`global`, `editor`, `photos`, `carrete`,
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

## 8. Tamaño y carga

- En la parte que se baja siempre: el registro, la decisión de si arrancar la recorrida, el botón "?" y los
  atajos para abrir la ayuda. Menos de 3 KB comprimidos.
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
7. **Mod+/ en Safari** muestra la barra de estado y "?" puede escribir otra tecla en algunos teclados. Se toman
   solo con el foco en la app, y "?" se mira por lo que escribe (`e.key`), no por la posición.
8. **Una versión vieja borra la clave `tour` de la cuenta** al subir sus preferencias. El dispositivo conserva su
   copia; en el peor caso, un dispositivo nuevo muestra la recorrida una vez más.
9. **Mostrar la recorrida de más o de menos:** una persona nueva en un dispositivo donde otra ya la vio no la ve
   sola (le queda el punto en el "?"). Aceptable; a confirmar.
10. **Lectores de pantalla:** el foco de luz es solo visual; el orden del foco y la región `aria-live` tienen que
    alcanzar. Probar con VoiceOver.

## Entregas y pruebas

1. **Entrega 1, ayuda y registro de atajos.** `shortcuts.ts` y `shortcutLabel`, los tooltips pasan a usarlo, el
   esquema importa sus atajos, `HelpDialog` con las 15 secciones, la búsqueda, el botón "?", la entrada del menú
   de la cuenta, "?" y Mod+/; la regla en `Docs/index.md`. Sin práctica ni recorrida ("Ver la recorrida" y
   "Mostrame" no aparecen todavía). README y changelog.
   - Pruebas: unidad del registro (ids, textos, rótulos, choques), el editor real contra el registro (jsdom), las
     funciones `is…Shortcut` contra sus entradas, la búsqueda de la ayuda ("ctrl f", "carrete", tildes), la ayuda
     en jsdom (abre con "?" fuera del texto y no al escribir "?" en el editor ni en un campo; abre con Mod+/; Esc
     cierra y devuelve el foco), textos en los dos idiomas.
2. **Entrega 2, práctica y recorrida.** Ruta `/practice`, `PracticeView` con los servicios en memoria y los que
   tiran error, plantillas es/en, las tres fotos, `floating.ts` común con `Tooltip.tsx`, `TourLayer` y los diez
   pasos, `data-tour` en los componentes, `navOpen` como almacén, la clave `tour` en las preferencias, el
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
     - **Preferencias (`prefs.test.ts`):** `tour` se valida, sobrevive a una cuenta que no la tiene y no cuenta
       como "sin subir" para el aviso.
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

## Decisiones (a confirmar por Lega)

1. **Práctica en memoria:** se pierde al recargar (se arma de nuevo, limpia). Alternativa: guardarla en el
   dispositivo.
2. **Sin fotos ni archivos propios en la práctica** en la entrega 2 (aviso); más adelante, fotos propias solo en
   memoria.
3. **Arranca sola la primera vez**, salvo si se entra con un link de invitación a una página: ahí se abre la
   página y se ofrece la recorrida con una tarjeta.
4. **"Ya la vi" en la cuenta (por workspace) y en el dispositivo;** no se repite en otro dispositivo ni en otro
   workspace (queda el punto en el "?").
5. **Motor propio**, sin librerías (las buenas son AGPL o pesan más que lo que hacen).
6. **Diez pasos** con los textos de la tabla de la sección 4 (nueve en el teléfono).
7. **"Animado" = el foco de luz que se desliza y un pulso suave**, sin videos ni GIF. Si Lega quiere
   animaciones dentro de los globitos (por ejemplo, alguien escribiendo "/"), van en una entrega aparte, chicas.
8. **La ayuda: botón "?" al lado de Papelera, "Ayuda y atajos" en el menú de la cuenta, "?" y Mod+/**, en un
   diálogo grande (pantalla completa en el teléfono).
9. **Las tres fotos del ejemplo:** ¿las pone Lega (fotos propias de VFX) o se usan unas con licencia libre? ¿Se
   suman a la caché para que la práctica ande sin red (unos 150 KB)?
10. **La regla de la ayuda** en `Docs/index.md` y en las reglas de trabajo, revisada en cada auditoría.
