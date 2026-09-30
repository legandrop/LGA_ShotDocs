# Carrete de fotos y videos

El carrete es el visor a pantalla completa de las fotos y los videos de una página (paso 7 de
`Plan_Workspaces.md`, sección 5 y D-17). Un toque (o, con el mouse, un segundo clic) en una foto o un video de la página abre
**todas** las de esa página, en el orden en que aparecen, empezando por la tocada. Pensado primero para
el teléfono.

El código está en `src/ui/`: `carreteModel.ts` (la lógica, sin pantalla: qué elementos hay y en qué orden, la
navegación, el zoom y los gestos), `carreteLoader.ts` (de dónde sale cada foto o video) y `Carrete.tsx`
(la pantalla); en el editor, `PageEditor.tsx` (cómo se abre) y `MediaToolbarButtons.tsx` (*View* y
*Download* en la barra de la imagen). Las pruebas: `carreteModel.test.ts`, `carreteLoader.test.ts` (con la
cola de archivos de verdad y el servidor en memoria) y `Carrete.test.tsx` (la pantalla en jsdom, más la
foto tocada en un editor real).

## Qué entra

Los bloques `image` de la página, de arriba abajo (también los que están adentro de otro bloque), con una
dirección que se pueda mostrar:

- `sdmedia://<id>`: fotos y videos del Drive del dueño (ver "Archivos grandes" en
  `Doc_Sincronizacion.md`).
- `sdfile://`: las imágenes de antes, en Supabase.
- `https://`, `http://` y `data:image/…`: imágenes pegadas de la web o embebidas.

Un bloque a medio subir (sin dirección) o con otra dirección no entra. **No hay tipos de bloque nuevos ni
cambia nada de lo que se guarda en el documento**: el carrete solo lee la página.

## Cómo se usa

| | Teléfono | Computadora |
|---|---|---|
| Abrir | Tocar la foto o el video | Un clic la elige y otro la abre (o doble clic); con la foto elegida, la barra espaciadora o *View* en su barra |
| Anterior / siguiente | Deslizar de costado, o los botones ‹ › | Flechas ← →, los botones, o arrastrar con el mouse |
| Primero / último | | Inicio / Fin |
| Zoom (fotos) | Pellizco; doble toque para ampliar ahí o volver | Rueda del mouse o pellizco del trackpad (con o sin Ctrl); doble clic |
| Mover la foto ampliada | Arrastrar | Arrastrar |
| Cerrar | Deslizar hacia abajo, la X, o "atrás" (Android) | Escape, la X, o "atrás" del navegador |
| Bajar el original | *Download* (arriba) | *Download* (arriba) |

- **Contador** "3 / 12" arriba, con el nombre del archivo (cortado si no entra; el nombre entero aparece
  en un tooltip solo si está cortado). Abajo, la leyenda del bloque (*caption*) si tiene.
- **En los extremos** no da la vuelta: el botón se oculta y el deslizamiento se resiste.
- **Zoom y deslizar no chocan:** con la foto ampliada, arrastrar mueve la foto y nunca cambia de elemento
  ni cierra; para pasar a la siguiente se vuelve a la foto entera (doble toque o pellizco) o se usan los
  botones o las flechas (al cambiar de elemento, el zoom vuelve a cero). La rueda amplía donde está el
  cursor (en un visor a pantalla completa no hay nada que desplazar, así que no hace falta Ctrl). Hasta
  5×. Al girar el teléfono (o cambiar el tamaño de la ventana) la foto ampliada se vuelve a encuadrar.
- **"Atrás" cierra el carrete:** al abrirlo se suma una entrada al historial con la misma dirección, así
  el "atrás" de Android o del navegador lo cierra sin salir de la página. Cerrar con la X, Escape o
  deslizando saca esa entrada (`history.back()`).
- **Videos:** el reproductor del navegador (`<video controls playsinline>`), sin arrancar solo. Con el
  dedo, deslizar sobre la franja de abajo del video (sus controles) no cambia de elemento; con el mouse,
  el video es solo del reproductor. Las flechas cambian de elemento aunque el foco esté en el video.
  Cambiar de elemento o cerrar pausa el video y lo suelta del todo (se le saca la dirección), para que no
  siga bajando.
- **Tooltips** (D-15) solo donde suman algo: el atajo de teclado en los botones de anterior, siguiente y
  cerrar, y el nombre cortado. Nunca `title=`.

## Qué se ve y de dónde sale

Primero lo que ya está a mano y después lo grande:

1. **La miniatura** guardada en el dispositivo (`MediaQueue.thumbnail`, sin la marca de "play" de la
   página; se baja del bucket `thumbs` si faltaba, igual que en la página). Sin miniatura, lo mismo que
   muestra la página: un ícono con el nombre.
2. **Lo grande:** el original si está en el dispositivo (anda sin red), o el archivo entero con un pase
   del portero (`POST /pass`). Una foto grande aparece encima de la miniatura recién cuando terminó de
   dibujarse (con un indicador de carga mientras tanto), así nunca queda un hueco. Un video muestra la
   miniatura de póster hasta que arranca.

Lo pedido se guarda mientras el carrete está abierto y se suelta al cerrarlo. Los pases del portero
(duran 8 horas) se reusan mientras les falte más de una hora, también de un carrete al siguiente y para
*Download* en la barra de la imagen; son de la sesión (de la cola de archivos): otra persona en el mismo
dispositivo pide los suyos. Una imagen `sdfile://` sale de su copia en el dispositivo o de Supabase; una
de la web, de su dirección.

**Precarga:** con el elemento actual listo, se precargan las **fotos** de al lado (el siguiente y el
anterior, nada más). Los videos nunca se precargan, ni siquiera se pide su pase, y tampoco las fotos en
formatos que muchos navegadores no abren (HEIC, DNG, TIFF, RAW): serían megas para nada. Sin red, o si el
navegador pide ahorrar datos (`Save-Data`), no se precarga nada.

## Lo que no se puede mostrar

- **Un original del dispositivo que el navegador no reproduce** (HEVC donde no hay soporte, ProRes):
  evento `error` del video, o un video que abre sin imagen (sin ancho ni alto, pasa con HEVC en algunos
  navegadores). Queda la miniatura, el aviso *This video can't be played in this browser* y un botón para
  bajarlo. Lo mismo con una foto que el navegador no abre (HEIC en Chrome de Windows, RAW).
- **Lo que vino del portero y no anduvo:** no se sabe si fue el formato, la red o un pase vencido, así
  que el aviso es neutro (*The video couldn't be loaded or played in this browser*, o *The photo couldn't
  be loaded or shown…*), con *Retry* (pide un pase nuevo) y el botón para bajarlo.
- **Sin red:** lo que está en el dispositivo se ve igual (originales propios, miniaturas ya bajadas,
  imágenes `sdfile://` guardadas). Lo demás muestra la miniatura con un aviso (*You're offline…*) y, al
  volver la red, pide lo grande solo. Un archivo que nunca llegó al dispositivo muestra el ícono.
- **Otro error del portero** (el archivo todavía se está subiendo desde otro dispositivo, sin permiso):
  la miniatura y el mensaje, con *Retry* y el botón para bajarlo si hay dirección.
- **Sin base de archivos en el dispositivo** (no se pudo abrir): el tipo y el nombre salen del servidor,
  y lo grande siempre viene del portero.

## Bajar el original

*Download* baja el archivo tal como se subió, con su nombre (el de `files`, o el del bloque):

- Si está en el dispositivo (o es `sdfile://` o `data:`), se baja con su nombre.
- Si viene del portero, el link lleva `?download=1` y **se abre en otra pestaña** (si el portero respondiera
  un error, no reemplaza la app). Desde v0.048 el portero pone el nombre del archivo (`Content-Disposition`
  con el nombre de `files`) y con `?download=1` lo manda como descarga, también un PDF (ver `Doc_Portero.md`,
  "Lo que se sirve"); con un portero sin actualizar, se guarda desde esa pestaña. Desde v0.049 (antes el
  link iba sin `?download=1`).
- Sin red y sin copia en el dispositivo, el botón queda deshabilitado.
- **En la barra de la imagen del editor**, *Download* de una foto o un video del Drive baja lo mismo (el
  original, nunca la miniatura que muestra la página). Se prepara apenas se elige la imagen, así el clic
  baja enseguida (Safari no abre otra pestaña si hay que esperar). Las demás imágenes usan el botón de
  siempre.

## En el editor

- **Computadora (mouse), desde v0.044:** el **primer clic elige** la foto (contorno del color de acento,
  los tiradores a la vista y su barra: ver, reemplazar, leyenda, nombre, bajar, borrar) y **el segundo
  clic, o un doble clic, abre** el carrete. Con ⌘/Ctrl no abre. En solo lectura, un clic abre. La lupa
  del cursor aparece solo sobre la foto elegida. Al cerrar (Escape o la X) el foco vuelve al editor y la
  foto queda elegida. Los tiradores y el de arrastrar el bloque nunca abren el carrete. La decisión es
  `src/ui/carreteClick.ts` (con pruebas). Ver `Doc_Imagenes.md`.
- **Un toque en la foto abre el carrete** (teléfono y tableta). El editor igual elige el bloque debajo (el
  evento no se corta), así que la edición sigue como siempre:
  - **Teléfono:** al cerrar el foco **no** vuelve al editor (abriría el teclado). La foto queda elegida,
    y **otro toque sobre ella no abre el carrete**: la edita (aparece la barra). Vale si el editor tiene
    el foco o si el toque anterior fue en esa misma foto (lo que se toca adentro del carrete no cuenta).
    Si en el medio se tocó cualquier otra cosa (otro lugar de la página, la barra lateral), la foto
    vuelve a abrir el carrete.
  - **Teclado:** con la foto elegida, la barra espaciadora abre el carrete (como la vista rápida de la
    Mac; con una foto elegida la barra no escribe nada). Enter sigue creando un párrafo debajo. En la
    barra de la imagen está también *View*.
- Funciona igual en una página de solo lectura (ahí no hay barra).
- Con el mouse, la lupa (*zoom-in*) aparece sobre la foto elegida (con el editor con foco) o en solo lectura.

## Pantalla

- A pantalla completa, fondo oscuro en los dos temas (como cualquier visor de fotos), respetando la
  muesca y la barra de inicio del iPhone (`env(safe-area-inset-*)`). Controles de 44 a 48 px. Sin scroll
  horizontal ni de la página de atrás mientras está abierto. En pantallas chicas el botón *Download*
  queda solo con el ícono.
- Accesible: `role="dialog"` con `aria-modal` y `aria-label`, el foco adentro (Tab y Shift+Tab dan la
  vuelta), el contador se anuncia al cambiar, los botones con `aria-label`, y al cerrar el foco vuelve a
  donde estaba (salvo al editor con el dedo, ver arriba). Mientras está abierto, lo de atrás (la app)
  queda `inert` (ni el foco ni los lectores de pantalla llegan), y los atajos de la app (Ctrl+K) no
  actúan debajo. Sin animaciones si el sistema pide menos movimiento.
- Encima de la barra del editor y debajo de los tooltips.

## Pendiente de probar a mano

- **Memoria en el iPhone con originales grandes:** abrir y recorrer varias fotos de 24 a 48 MP (y HEIC de
  48 MP del iPhone Pro), ampliarlas y cambiar de una a otra muchas veces, en Safari y en la app
  instalada. Safari descarta la pestaña si se pasa de memoria; si pasa, mostrar en el carrete una versión
  reducida en vez del original entero.
