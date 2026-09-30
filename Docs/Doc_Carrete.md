# Carrete de fotos y videos

El carrete es el visor a pantalla completa de las fotos y los videos de una página (paso 7 de
`Plan_Workspaces.md`, sección 5 y D-17). Un clic o un toque en una foto o un video de la página abre
**todas** las de esa página, en el orden en que aparecen, empezando por la tocada. Pensado primero para el
teléfono.

El código está en `src/ui/`: `carrete.ts` (la lógica, sin pantalla: qué elementos hay y en qué orden, la
navegación, el zoom y los gestos), `carreteLoader.ts` (de dónde sale cada foto o video) y `Carrete.tsx`
(la pantalla). Las pruebas: `carrete.test.ts`, `carreteLoader.test.ts` (con la cola de archivos de verdad y
el servidor en memoria) y `Carrete.test.tsx` (la pantalla en jsdom, más la foto tocada en un editor real).

## Qué entra

Los bloques `image` de la página, de arriba abajo (también los que están adentro de otro bloque), con una
dirección que se pueda mostrar:

- `sdmedia://<id>`: fotos y videos del Drive del dueño (ver "Archivos grandes" en `Doc_Sincronizacion.md`).
- `sdfile://`: las imágenes de antes, en Supabase.
- `https://`, `http://` y `data:image/…`: imágenes pegadas de la web o embebidas.

Un bloque a medio subir (sin dirección) o con otra dirección no entra. **No hay tipos de bloque nuevos ni
cambia nada de lo que se guarda en el documento**: el carrete solo lee la página.

## Cómo se usa

| | Teléfono | Computadora |
|---|---|---|
| Abrir | Tocar la foto o el video | Clic en la foto o el video |
| Anterior / siguiente | Deslizar de costado, o los botones ‹ › | Flechas ← →, los botones, o arrastrar con el mouse |
| Primero / último | | Inicio / Fin |
| Zoom (fotos) | Pellizco; doble toque para ampliar ahí o volver | Rueda del mouse o pellizco del trackpad (con o sin Ctrl); doble clic |
| Mover la foto ampliada | Arrastrar | Arrastrar |
| Cerrar | Deslizar hacia abajo, o la X | Escape, o la X |
| Bajar el original | *Download* (arriba) | *Download* (arriba) |

- **Contador** "3 / 12" arriba, con el nombre del archivo (cortado si no entra; el nombre entero aparece
  en un tooltip solo si está cortado). Abajo, la leyenda del bloque (*caption*) si tiene.
- **En los extremos** no da la vuelta: el botón se oculta y el deslizamiento se resiste.
- **Zoom y deslizar no chocan:** con la foto ampliada, arrastrar mueve la foto y nunca cambia de elemento
  ni cierra; para pasar a la siguiente se vuelve a la foto entera (doble toque o pellizco) o se usan los
  botones o las flechas (al cambiar de elemento, el zoom vuelve a cero). La rueda amplía donde está el cursor (en un
  visor a pantalla completa no hay nada que desplazar, así que no hace falta Ctrl). Hasta 5×.
- **Videos:** el reproductor del navegador (`<video controls playsinline>`), sin arrancar solo. Con el
  dedo, deslizar sobre la franja de abajo del video (sus controles) no cambia de elemento; con el mouse,
  el video es solo del reproductor. Las flechas cambian de elemento aunque el foco esté en el video.
  Cambiar de elemento o cerrar pausa el video.
- **Tooltips** (D-15) solo donde suman algo: el atajo de teclado en los botones de anterior, siguiente y
  cerrar, y el nombre cortado. Nunca `title=`.

## Qué se ve y de dónde sale

Primero lo que ya está a mano y después lo grande:

1. **La miniatura** guardada en el dispositivo (`MediaQueue.thumbnail`, sin la marca de "play" de la
   página; se baja del bucket `thumbs` si faltaba, igual que en la página). Sin miniatura, lo mismo que
   muestra la página (la foto local entera, o un ícono con el nombre).
2. **Lo grande:** el original si está en el dispositivo (anda sin red), o el archivo entero con un pase del
   portero (`POST /pass`). Una foto grande aparece encima de la miniatura recién cuando terminó de
   dibujarse (con un indicador de carga mientras tanto), así nunca queda un hueco. Un video muestra la
   miniatura de póster hasta que arranca.

Lo pedido se guarda mientras el carrete está abierto (ir y volver no pide otro pase) y se suelta al
cerrarlo. Una imagen `sdfile://` sale de su copia en el dispositivo o de Supabase; una de la web, de su
dirección.

**Precarga:** con el elemento actual listo, se precargan las **fotos** de al lado (el siguiente y el
anterior, nada más). Los videos nunca se precargan, ni siquiera se pide su pase. Sin red, o si el
navegador pide ahorrar datos (`Save-Data`), no se precarga nada.

## Lo que no se puede mostrar

- **Un video que el navegador no reproduce** (HEVC donde no hay soporte, ProRes): evento `error` del
  video, o un video que abre sin imagen (sin ancho ni alto, pasa con HEVC en algunos navegadores). Queda la
  miniatura, el aviso *This video can't be played in this browser* y un botón para bajarlo.
- **Una foto que el navegador no abre** (HEIC en Chrome de Windows, RAW): queda la miniatura y el aviso con
  el botón para bajarla.
- **Sin red:** lo que está en el dispositivo se ve igual (originales propios, miniaturas ya bajadas,
  imágenes `sdfile://` guardadas). Lo demás muestra la miniatura con un aviso (*You're offline…*) y, al
  volver la red, pide lo grande solo. Un archivo que nunca llegó al dispositivo muestra el ícono.
- **Otro error del portero** (el archivo todavía se está subiendo desde otro dispositivo, sin permiso): la
  miniatura y el mensaje, con el botón para bajarlo si hay dirección.

## Bajar el original

*Download* baja el archivo tal como se subió, con su nombre (el de `files`, o el del bloque):

- Si está en el dispositivo (o es `sdfile://` o `data:`), se baja con su nombre.
- Si viene del portero, **se abre en otra pestaña**: el navegador no deja ponerle nombre a un archivo de
  otro sitio (el portero no manda `Content-Disposition` ni CORS en `/m/`), así que se guarda desde ahí.
  Mejora pendiente para el paso 8: que el pase pueda pedir `Content-Disposition: attachment` con el
  nombre.
- Sin red y sin copia en el dispositivo, el botón queda deshabilitado.

## En el editor

- **Un clic o un toque en la foto abre el carrete.** El editor igual elige el bloque debajo (el evento no
  se corta), así que la edición sigue como siempre:
  - **Computadora:** al cerrar (Escape o la X) el foco vuelve al editor y la foto queda elegida con su
    barra (reemplazar, leyenda, nombre, bajar, borrar). Los tiradores para cambiar el tamaño y el de
    arrastrar el bloque son otros elementos: nunca abren el carrete.
  - **Teléfono:** al cerrar el foco **no** vuelve al editor (abriría el teclado). La foto queda elegida:
    **otro toque sobre la foto elegida no abre el carrete**, la edita (aparece la barra). Tocar en otro
    lado y después la foto la vuelve a abrir.
- Funciona igual en una página de solo lectura (ahí no hay barra).
- La foto muestra el cursor de lupa (*zoom-in*) con el mouse.

## Pantalla

- A pantalla completa, fondo oscuro en los dos temas (como cualquier visor de fotos), respetando la
  muesca y la barra de inicio del iPhone (`env(safe-area-inset-*)`). Controles de 44 a 48 px. Sin scroll
  horizontal ni de la página de atrás mientras está abierto. En pantallas chicas el botón *Download* queda
  solo con el ícono.
- Accesible: `role="dialog"` con `aria-modal` y `aria-label`, el foco adentro (Tab y Shift+Tab dan la
  vuelta), el contador se anuncia al cambiar, los botones con `aria-label`, y al cerrar el foco vuelve a
  donde estaba (salvo al editor con el dedo, ver arriba). Mientras está abierto, los atajos de la app
  (Ctrl+K) no actúan debajo. Sin animaciones si el sistema pide menos movimiento.
- Encima de la barra del editor y debajo de los tooltips.
