# Anotar sobre las fotos (P.20)

**Estado: diseño, sin código** (pedido de Lega del 2026-10-02). Se diseñó contra `main` v0.108. Las decisiones
(AN1 a AN10, sección 12) son propuestas con la recomendación elegida: el número final lo pone quien las cierre con Lega.
Sin auditoría todavía.

## En corto

- **El pedido.** Dibujar encima de una foto de set (flechas, círculos, rectángulos, texto, lápiz) **sin tocar el
  original**. Quien usa **LGA FrameRev** (la app de escritorio de Lega para anotar capturas) tiene que sentirse en casa:
  mismas letras para las herramientas, mismos colores y grosores por defecto, mismos modificadores.
- **Dónde viven (AN1): en el documento de la página, afuera del contenido**, en un `Y.Map` propio (`photoMarkup`) al lado
  del fragmento del editor, como el mapa de "colapsar para todos" (`collapsedHeadings`, `Doc_Colapsar.md`). La clave es
  el id del archivo (`sdmedia://<id>`). **Ningún tipo de bloque ni propiedad nueva**: una versión vieja de la app no ve
  el mapa, no lo toca y lo deja pasar; la foto se ve limpia y no se pierde nada.
- **Por eso se hereda todo lo que ya anda:** se guarda primero en el dispositivo, sube a `page_updates` (solo agregado),
  se fusiona sin red y entre dos personas (Yjs), llega en vivo a los demás, entra en el historial y en la base limpia de
  quien solo ve (D14), y la base ya exige poder editar la página para escribir (`push_page_update` →
  `can_edit_page`).
- **Cómo se ven:** un dibujo vectorial (SVG) encima de la foto, en la página, la celda, el carrete y el PDF. La
  miniatura y el original del Drive no cambian. **Bajar con anotaciones** arma una copia "quemada" en el dispositivo en
  el momento (AN4); nada se guarda dos veces en Drive.
- **Entregas:** 0 prueba técnica, 1 ver, 2 anotar en la compu, 3 anotar con el dedo y el Apple Pencil, 4 bajar y
  copiar con anotaciones (y exportar a FrameRev), 5 historial, copiar entre páginas y buscar, 6 (opcional) dibujar en un
  comentario.

## Reglas que no se rompen

- **El original no se toca nunca**: ni el archivo del Drive ni la miniatura del bucket `thumbs`.
- **Nada de tipos de bloque nuevos ni propiedades en la foto.** Lo nuevo va en un `Y.Map` aparte del contenido.
- **Una versión vieja degrada:** ve la foto limpia y no borra las anotaciones.
- **Nunca perder datos:** dos personas anotando a la vez conservan las dos cosas; sin red se guarda en el dispositivo y
  sube después; borrar una forma se deshace y queda en el historial.
- **Cada workspace es una isla:** las anotaciones viven en la base del dueño (como el texto) y la copia quemada se arma
  en el dispositivo; no pasa nada por servidores de nadie más.
- En la Mac, ⌘ y nunca Ctrl (`modPressed`/`isLetter` de `src/ui/findUi.ts`); tooltips con `data-tip` que no repiten lo
  obvio; UI en inglés con sus traducciones; ayuda y atajos en el registro (`src/ui/shortcuts.ts`) en la misma tanda.

## 1. Qué hace FrameRev (la referencia)

LGA FrameRev (`C:\Portable\LGA_FrameRev`, Qt 6 / C++) es un editor de anotaciones sobre una imagen: captura de
pantalla o archivo abierto, se dibuja encima y se guarda la imagen aplanada o el proyecto editable (`.frproj`). Lo que
importa para Shot Docs, con dónde está en ese repo:

| Qué | Cómo es en FrameRev | Dónde |
|---|---|---|
| Herramientas (14) | Select, Rectangle, Ellipse, Arrow, Line, Ruler (Measure), Pencil, Marker, Text, Number, Color Sampler, Censor, Loupe, Icon (Stamp) | `include/framerev/editor/EditorTool.h`, `src/editor/EditorToolbar.cpp` |
| Atajos de herramienta | Una letra sin modificador: V, R, E, A, L, U, P, M, T, N, S, C, Z, I | `src/utils/ShortcutManager.cpp` (líneas 51-69) |
| Grosor | `[` y `]` de a 1 px (lo elegido si el mouse está sobre sus tiradores; si no, la próxima forma); Ctrl/⌘+`[` `]` siempre la próxima; barra de 0 a 40, número hasta 999; cursor de pincel con el diámetro real | `docs/Doc_Ancho_De_Trazo.md` |
| Modificadores | Shift: cuadrado, círculo, ángulo de a 45°; Alt: desde el centro (como Photoshop) | `docs/Doc_Modificadores_Photoshop.md` |
| Color por defecto | Verde `#85DC53` en todas las herramientas | `include/framerev/editor/AnnotationDefaults.h` |
| Estilo por herramienta | Cada herramienta recuerda el suyo (elegir rojo en Arrow no tiñe Ellipse), persistente; lo que se cambia en una forma elegida queda como el de la próxima | `include/framerev/editor/ToolProperties.h`, `src/editor/ToolProperties.cpp` |
| Valores de fábrica | Trazo 3; Marker 18 al 50 % de opacidad; relleno apagado salvo Text (D-44); texto 24; número 16 | `src/editor/ToolProperties.cpp` (`defaultToolProperties`) |
| Flecha | Cabeza Normal, Open, Banner (+ invertida); en End, Start o Both; tamaño de cabeza 25-300 % | `include/framerev/editor/ArrowAnnotation.h` |
| Texto | Tinta automática por contraste (luminancia BT.601, umbral 128) si la caja tiene fondo | `include/framerev/editor/TextContrast.h` |
| Número | Círculo con número que se autoincrementa (el más alto + 1) | `src/editor/EditorScene.cpp` (`nextNumberedMarkerNumber`) |
| Lápiz | Puntos suavizados (gaussiano con detección de esquinas) | `src/editor/FreehandAnnotation.cpp` |
| Paleta del selector | 8 presets (tonos apagados de interfaz), 8 recientes, *Custom* con HSV y hex | `src/ui/components/LgaColorPickerDialog.cpp` |
| Guardar | Ctrl+S imagen aplanada (PNG/JPEG); Shift+clic o Ctrl+Alt+S el proyecto `.frproj`; Ctrl+C copia la imagen | `docs/Doc_GuardadoImagenProyecto.md` |
| Formato `.frproj` (v2) | JSON: `version`, `backgroundImagePng` (base64), `canvasWidth/Height`, `annotations[]` de abajo hacia arriba; cada una con `type` y campos comunes (`posX/Y`, `rectX/Y/W/H`, `rotation`, `strokeColor` `#AARRGGBB`, `strokeWidth`, `strokeOpacity`, `fillColor`, `fillOpacity`, `fillMode`…) más los suyos (`startX…endY`, `points[{x,y}]`, `text`, `fontSize`…). Un `type` desconocido se ignora sin romper | `src/editor/EditorScene.cpp` (`serializeProject`), `src/editor/AnnotationItem.cpp`, `src/editor/AnnotationFactory.cpp` |
| Entrada desde otra herramienta | `--edit-image <ruta>`: abre un JPG, se anota y Save lo pisa (lo usa Review Pic de HieroTools) | `docs/Doc_GuardadoImagenProyecto.md` |

### Qué se lleva a la web y qué no

| De FrameRev | En Shot Docs | Por qué |
|---|---|---|
| Select, Rectangle, Ellipse, Arrow, Line, Pencil, Marker, Text, Number | **Sí, entrega 2** (AN5) | Lo que se usa en set: señalar, encerrar, escribir, numerar puntos |
| Las mismas letras (V R E A L P M T N) | **Sí**, iguales | La mano que usa una app usa la otra |
| `[` `]` y ⌘/Ctrl+`[` `]`, cursor de pincel | **Sí** | Igual que FrameRev |
| Shift y Alt al dibujar | **Sí** (Alt es ⌥ en la Mac, sin ⌘: no es un atajo de texto) | Igual que FrameRev y Photoshop |
| Verde `#85DC53` por defecto, estilo recordado por herramienta | **Sí**, por dispositivo (como el INI de FrameRev) | |
| Valores de fábrica (3, Marker 18/50 %, texto 24, número 16) | **Sí**; el grosor medido en pantalla (AN7) | |
| Cabezas de flecha Normal y Open, en End o Both | **Sí**; Banner, después | Las dos que se leen en una foto chica |
| Tinta automática del texto, número que se autoincrementa | **Sí** (misma fórmula, mismo umbral) | |
| Icon (tilde, cruz, estrella) y Censor (tapar una cara o una marca) | **Después** (entrega 2b si Lega lo pide) | Útiles para un reporte al cliente, pero no para el primer uso |
| Ruler, Loupe, Color Sampler, Crop, rotar | **No** | En una foto de set no hay escala; la lupa ya la da el zoom; el original no se recorta |
| Paleta de presets apagada del selector | **No** (AN6) | Son tonos de interfaz: sobre una foto se pierden |
| Save, Save As, `.frproj` como archivo de trabajo | **No: se guarda solo** cada trazo; ⌘/Ctrl+S en el anotador muestra *Saved automatically* (y no abre el "guardar página" del navegador) | En Shot Docs nada tiene botón de guardar |
| Imagen aplanada | **Al bajar o copiar** (entrega 4, AN4) | |
| `.frproj` | **Exportar para FrameRev** (entrega 4) | Para seguir en la app de escritorio |
| Captura de pantalla, dibujar en pantalla, actualizaciones | No aplica | |

### Lo reutilizable (anotado para quien lo programe)

1. **El formato de cada forma:** los nombres de campo y de tipo del `.frproj` v2 (`AnnotationItem.cpp`, `kField*`;
   `AnnotationFactory.cpp`, los `type`; `TwoPointAnnotation.cpp`, `FreehandAnnotation.cpp`, `TextAnnotation.cpp`,
   `ArrowAnnotation.cpp`). Shot Docs usa **los mismos nombres y los mismos ordinales** (`fillMode`: 0 None, 1 Stroke,
   2 StrokeAndFill, 3 Fill; `headStyle`: 0 Normal, 1 Open, 2 Banner; `headPosition`: 0 Start, 1 Both, 2 End), así
   pasar de uno a otro es copiar campos. Dos diferencias, que convierte la exportación: los puntos del lápiz van en una
   lista plana `[x0, y0, x1, y1…]` (FrameRev: `[{x, y}]`) y el color va `#RRGGBB` (FrameRev: `#AARRGGBB`, siempre
   opaco).
2. **La política de compatibilidad de `AnnotationFactory`:** un tipo que no se conoce se ignora, nunca rompe. Shot Docs
   suma: tampoco se borra (sección 3).
3. **Los valores de fábrica** de `defaultToolProperties()` y los atajos de `ShortcutManager.cpp`.
4. **La tinta por contraste** (`TextContrast.h`): `0.299 R + 0.587 G + 0.114 B ≥ 128` → negro, si no blanco.
5. **El suavizado del lápiz** (`FreehandAnnotation.cpp`): la idea se porta tal cual (sigma gaussiano según la fuerza,
   esquinas que no se redondean).
6. Lo que **no** se reutiliza: el código (C++ y Qt; la web lo escribe en TypeScript y SVG).

## 2. Cómo se usa

### En la compu

- **Abrir:** con la foto elegida, *Annotate* en su barra (ícono de lápiz sobre la foto), o en el carrete el botón
  *Annotate* o la tecla **A**. Solo fotos del Drive (`sdmedia://`, imagen; no videos ni adjuntos) y solo quien puede
  editar la página (AN3). Sin permiso, el botón no está.
- **La pantalla:** a pantalla completa con fondo oscuro, como el carrete. Arriba, la barra de herramientas en el orden
  de FrameRev (Select, Rectangle, Ellipse, Arrow, Line, Pencil, Marker, Text, Number), deshacer y rehacer, y *Done*.
  Debajo, la franja de propiedades de la herramienta o de lo elegido: color (8 colores, recientes y *Custom*), grosor
  (barra de 0 a 40 y número), opacidad, relleno, cabeza de flecha, tamaño de letra. La foto entra entera (**F** vuelve a
  encuadrar); la rueda o el pellizco del trackpad amplían, la barra espaciadora apretada mueve.
- **Dibujar:** arrastrar crea la forma; Shift y Alt como en FrameRev. Text: clic, se escribe, Esc o clic afuera
  termina. Number: cada clic pone el siguiente.
- **Editar:** Select (V) elige con clic o recuadro; arrastrar mueve; tiradores para el tamaño y los extremos de la
  flecha; Supr/Backspace borra; ⌘/Ctrl+Z y ⌘/Ctrl+Shift+Z (o Ctrl+Y en Windows) deshacen y rehacen **solo lo de esta
  foto en esta sesión** (lo de otros no se deshace).
- **Salir:** Esc deselecciona; con nada elegido, cierra. *Done* cierra. No hay nada sin guardar: cada forma se guarda al
  soltar.
- **Los demás** que tienen la página abierta ven aparecer cada forma al soltarla.

### En el iPhone (con el dedo)

- **Abrir:** en el carrete, *Annotate*; o en la barra de la foto elegida.
- **La pantalla:** la foto arriba; abajo, una tira con las herramientas (se desliza si no entran), el punto de color y
  el grosor; al tocar el punto de color se abre una hoja con los colores, el grosor y la opacidad. Deshacer, rehacer y
  *Done* arriba (no hay teclado para ⌘Z). Controles de 44 px, márgenes de la muesca (`env(safe-area-inset-*)`).
- **Gestos (AN8):** **un dedo dibuja** con la herramienta elegida; **dos dedos** amplían y mueven (nunca dibujan). Con
  Select, un dedo elige y mueve. Si se usa un **Apple Pencil** (el navegador lo dice: `pointerType: 'pen'`), desde ese
  momento el lápiz dibuja y el dedo mueve, como en Notas. Sin animaciones si el sistema pide menos movimiento.
- **Texto:** al tocar con Text se abre el teclado sobre una caja de texto común (no el SVG), que al terminar se vuelve
  la forma.
- La página de atrás no se desplaza ni amplía mientras el anotador está abierto (`touch-action: none` en la foto).

### Atajos (registro único)

Un lugar nuevo del registro, `annotate`, con contexto propio para que no choquen con el editor: V R E A L P M T N, `[`
`]`, `Mod-[` `Mod-]`, `Mod-z`, `Mod-Shift-z` y `Mod-y`, Delete y Backspace, Escape, F, Space (mantener), `Mod-s` (solo el
aviso). En el carrete, **A** (*Annotate*). Las letras sueltas solo valen con el anotador abierto y sin una caja de texto
con el foco.

## 3. Dónde viven las anotaciones (AN1, AN2)

En el `Y.Doc` de la página, afuera del contenido:

```
doc.getMap('photoMarkup')                 // al lado de CONTENT_FRAGMENT y de 'collapsedHeadings'
  '<id del archivo>' → Y.Map {
      v: 1,                               // versión del formato
      w: 6000, h: 4000,                   // el marco: el tamaño de la foto (files.width/height)
      shapes: Y.Map {
        '<id de la forma>' → Y.Map {      // un uuid que pone el dispositivo
          type: 'arrow', z: 3.5,          // z: el orden de apilado (fraccionario: insertar no mueve a los demás)
          startX, startY, endX, endY, strokeColor: '#85DC53', strokeWidth, strokeOpacity,
          headStyle, headPosition, arrowHeadSize …   // los nombres del .frproj v2
        }
      }
  }
```

- **Coordenadas en el marco de la foto** (sus píxeles, como FrameRev). El SVG usa `viewBox="0 0 w h"` sobre la foto, así
  que lo mismo sirve para el original, la imagen nítida, la miniatura de 480 px o una celda de 96 px.
- **Una forma por clave, una propiedad por clave.** Mover una forma escribe solo `posX`/`posY` (o los extremos). Así dos
  personas que cambian cosas distintas de la misma forma conservan las dos, y **una versión futura que sume un campo no
  lo pierde** cuando una vieja mueve la forma (la vieja nunca reescribe la forma entera). Un `type` desconocido no se
  dibuja, no se elige y no se borra.
- **El lápiz** guarda sus puntos en una lista plana, redondeados al píxel del marco y simplificados al soltar
  (Douglas-Peucker a medio píxel de pantalla); los puntos de un trazo no se cambian después (mover escribe un
  desplazamiento).
- **Por qué funciona con una versión vieja:** `y-prosemirror` solo se ata a `CONTENT_FRAGMENT`; el resguardo de
  versiones viejas (`src/ui/unknownContent.ts`) revisa solo ese fragmento; el resto del `Y.Doc` viaja intacto en cada
  subida y bajada. Es exactamente lo que ya pasa con `collapsedHeadings` (`Doc_Colapsar.md`: "Versiones viejas ven todo
  abierto… no pierden nada").
- **La clave es el archivo, dentro de la página** (AN2): la misma foto dos veces en la página comparte las anotaciones;
  la misma foto en otra página sale limpia (hasta que se copie con sus anotaciones, entrega 5). Convertir una foto-bloque
  en foto en línea (`convertPhotos.ts`) no cambia la `url`, así que las anotaciones siguen. **Reemplazar** la foto (barra
  de la foto) cambia el archivo: si la nueva tiene la misma proporción, se pregunta *Keep annotations?* y se copian a la
  clave nueva; las viejas quedan donde estaban.
- **Una foto sacada de la página** deja sus anotaciones en el mapa (no se borran): si vuelve (deshacer, pegar), vuelven.
  Lo huérfano no se dibuja en ningún lado.

## 4. Cómo se ven en cada lugar

| Lugar | Qué se ve | Cómo |
|---|---|---|
| Página (foto en línea, foto-bloque, foto en celda) | La foto con sus anotaciones | Un `<svg>` hermano del `<img>` en el mismo contenedor, `pointer-events: none`, que lee el mapa y se redibuja cuando cambia (un observador del `Y.Map` de esa foto). No depende de la `src`: el cambio a la imagen nítida (`sharpImages.ts`) no lo toca |
| Miniatura en una celda (96 px) | Igual, en chico | El grosor se escala con la foto; por debajo de 1 px de pantalla se dibuja a 1 px para que no desaparezca |
| Carrete | Con anotaciones; botón *Hide annotations* (solo para quien mira, no se guarda) | El mismo SVG, con el zoom del carrete |
| PDF | Con anotaciones, vectoriales (nítidas aunque la foto sea la miniatura) | La vista de impresión clona el contenedor con su SVG (`printView.ts`); el ancho fijo en px de la foto no cambia, así que los cortes de hoja tampoco |
| Original en Drive y miniatura de `thumbs` | Limpios, siempre | No se tocan |
| *Download* | Menú: *Original* o *With annotations* (entrega 4) | Sección 5 |
| Historial | Cada versión con las anotaciones de entonces (entrega 5) | El `Y.Doc` de la versión ya trae el mapa |
| Versión vieja de la app | La foto limpia | No conoce el mapa |

Una marca chica (ícono de lápiz en una esquina) avisa en la página que la foto tiene anotaciones solo si están
escondidas en el carrete; en la página siempre se ven, no hace falta marca (AN9).

## 5. Bajar con anotaciones: la copia quemada (AN4)

- Se arma **en el dispositivo, al bajar**: el original (del dispositivo o con un pase del portero, que ya manda
  `Access-Control-Allow-Origin` a la app), un `canvas` del tamaño de la foto, el SVG dibujado encima, y JPEG (calidad
  92) o PNG si el original es PNG. Nombre: `<nombre>_annotated.jpg`. Nunca se sube ni se guarda en Drive.
- **En el iPhone** Safari no deja un `canvas` de más de unos 16,7 millones de píxeles: una foto de 48 MP se achica a
  ese tope (se avisa *Reduced to 16 MP on this device*). En la compu, tamaño completo.
- **Download all** (`Doc_Carpetas.md`) suma la opción *Include annotated copies*: al lado de cada original anotado va su
  `_annotated`. Los originales siempre van.
- **Copiar** (*Copy with annotations*) deja la imagen quemada en el portapapeles, para pegarla en un mail o en
  WhatsApp.
- **Export for FrameRev** (en el menú de la foto, en la compu): un `.frproj` v2 con la foto como fondo y las formas
  convertidas, para seguir en FrameRev. Volver de FrameRev (importar un `.frproj` sobre la foto) queda para después.

## 6. Quién puede anotar (AN3)

| Nivel en la página | Ve las anotaciones | Anota |
|---|---|---|
| Ver (1), invitado que ve | Sí | No |
| Comentar (2), link *Can view* | Sí | No (entrega 6 opcional: dibujar adentro de un comentario) |
| Editar (3), editar y crear páginas (4), link *Can edit* | Sí | **Sí**, también lo que dibujó otro |

La base ya lo cumple: escribir en el `Y.Doc` es subir una fila a `page_updates`, y `push_page_update` pide
`can_edit_page`. Un comentador con una app modificada no puede meter anotaciones. Lo borrado de las anotaciones no llega
a quien solo ve: la base limpia (D14) se arma con GC de **todo** el `Y.Doc` (`buildCleanBase` en `src/sync/clean.ts`), así
que también vacía los trazos borrados.

## 7. Dos anotando a la vez

- Cada forma es una clave propia: dos personas dibujando en la misma foto conservan todo lo de las dos.
- Dos que cambian la misma forma: cada propiedad queda con el último cambio que llegó (por ejemplo, uno cambia el
  color y otro la mueve: queda movida y con el color nuevo).
- Uno la borra mientras otro la mueve: queda borrada. Se recupera con el historial (entrega 5).
- Se escribe **al soltar** (no en cada cuadro del arrastre): los demás ven la forma terminada y las filas no se llenan de
  posiciones intermedias. Mientras se arrastra, solo lo ve quien arrastra.
- El deshacer del anotador es un `Y.UndoManager` limitado al mapa de esa foto y al origen propio (`sd-markup`): nunca
  deshace lo de otro ni el texto de la página; el ⌘/Ctrl+Z de la página nunca deshace anotaciones.

## 8. Sin red

- Se anota igual: todo va al `Y.Doc` de la página guardado en el dispositivo (IndexedDB) y sube con la cola de siempre;
  el contador de cambios sin sincronizar lo cuenta.
- Hace falta ver la foto: el original o, si no está, la miniatura (se avisa *Showing a preview: the original isn't on
  this device*; las coordenadas no cambian porque el marco es el de la foto, no el de lo que se ve). Sin nada de la foto
  en el dispositivo, *Annotate* queda deshabilitado.
- Dos dispositivos que anotaron sin red se fusionan al volver, como el texto.

## 9. Historial

- Las versiones ya traen el mapa (el historial arma cada versión desde las filas; `history.ts` solo vacía el de
  colapsar). La entrega 5 hace tres cosas: que una sesión que **solo** anotó cuente como versión (*Annotated
  IMG_0423.jpg*), que la vista de una versión dibuje sus anotaciones, y que **restaurar** devuelva también las anotaciones
  de las fotos de esa versión (una transacción aparte con su propio deshacer).
- Hasta la entrega 5, restaurar una versión devuelve el texto y deja las anotaciones como están (no se pierde nada: las
  borradas siguen en las filas).

## 10. Tamaño y plan gratis

| Qué | Cuánto (estimado, a medir en la entrega 0) |
|---|---|
| Rectángulo, elipse, línea, flecha, número | 100 a 200 bytes |
| Texto | 150 bytes + el texto |
| Trazo de lápiz (300 puntos tras simplificar) | 1 a 3 KB |
| Una foto de set bien anotada (10 formas, 5 trazos) | 10 a 20 KB |

- **Topes:** 128 KB y 400 formas vivas por foto; 2 MB de anotaciones por página (la base limpia tiene un techo de 8 MB y
  una página de tabla importada de Coda ya pesa hasta 2 MB); 2000 letras por texto. Al 80 % se avisa; al tope, las
  herramientas de crear se apagan con *This photo has too many annotations*.
- **Base (500 MB gratis):** 1000 fotos anotadas son unos 20 MB. Lo borrado queda en `page_updates` (la subida va sin
  GC, para el historial) hasta que exista compactar (`Doc_Compactar.md`); con escribir al soltar, un día de uso intenso
  suma pocos cientos de KB.
- **Drive y portero:** nada nuevo; la copia quemada no se guarda y se arma con el original que ya se baja hoy.

## 11. Versiones viejas y orden de publicación (AN10)

1. **Entrega 1 (ver)** se publica primero: la app conoce el mapa y lo dibuja, pero todavía no deja anotar.
2. Se sube `workspace_settings.min_app_version` a esa versión.
3. Recién después, la entrega 2 (anotar).

No es para no perder datos (una versión vieja no borra nada), sino para que nadie imprima el PDF de un reporte desde una
pestaña vieja y lo mande **sin las flechas**. En etapa de desarrollo (solo Lega) se puede publicar 1 y 2 juntas y subir
la versión mínima enseguida.

Dentro del mapa, `v: 1`. Una versión de la app que encuentra `v` mayor que la suya dibuja lo que conoce y abre el
anotador en solo lectura (*Update the app to edit these annotations*).

## 12. Decisiones

### AN1 · Dónde se guardan las anotaciones

- **Qué pasaba:** en el set, el supervisor marca con una flecha el cable que hay que borrar en una foto del reporte. Eso
  tiene que quedar guardado aunque esté sin señal, verse en la compu de la oficina enseguida, y no romperse si alguien
  tiene una pestaña vieja abierta.
- **Las opciones:**
  - **A.** En el documento de la página, en un mapa aparte del texto (como "colapsar para todos").
  - **B.** Como propiedad de la foto (un atributo del nodo `photo` o del bloque `image`).
  - **C.** Una tabla nueva en Supabase (`photo_annotations`).
  - **D.** Un archivo `.json` al lado del original en el Drive.
- **Elegí A porque** hereda sin programar nada el guardado sin red, la fusión entre dos personas, el vivo, el historial,
  la base limpia y el permiso de editar; y una versión vieja no la ve ni la toca. B se pierde si una versión vieja
  cambia el tamaño de la foto; C y D piden rehacer la cola, la fusión y los permisos.
- **Si preferís otra:** C es viable pero es el trabajo de una entrega entera extra (cola sin red propia, fusión,
  permisos y tiempo real); B no la recomiendo; D no anda sin red ni con dos a la vez.

### AN2 · Las anotaciones, ¿son de la foto o de la página?

- **Qué pasaba:** la misma foto del set está en el reporte interno, con notas para el equipo ("este poste se borra"), y
  en la página que ve el cliente. ¿Las flechas del interno tienen que aparecer en la del cliente?
- **Las opciones:**
  - **A.** De la foto **en esa página**: en otra página la misma foto sale limpia; copiarla con sus anotaciones es una
    acción (entrega 5).
  - **B.** De la foto en todos lados: anotarla en una página la anota en todas.
- **Elegí A porque** lo que ve cada página lo deciden sus permisos, y una nota interna no se cuela en la página del
  cliente. Además sale solo del modelo de AN1.
- **Si preferís otra:** B pide guardar las anotaciones por archivo (una tabla, como la opción C de AN1) y decidir qué
  pasa cuando alguien que solo ve una página anota la foto de otra. Es más trabajo y más riesgo de filtrar.

### AN3 · Quién puede anotar

- **Qué pasaba:** el cliente, invitado con *Can comment*, quiere marcar en una foto qué ventana no le gusta.
- **Las opciones:**
  - **A.** Anota quien puede editar la página (incluido el link *Can edit*). Quien comenta, más adelante, dibuja adentro
    de un comentario (entrega 6): su dibujo se ve en el hilo, no en la foto de la página ni en el PDF.
  - **B.** Quien comenta también anota la foto de la página.
  - **C.** Solo quien edita, nunca dibujos en comentarios.
- **Elegí A porque** la base ya lo cumple (escribir pide editar) y el reporte que sale en PDF no cambia por un
  comentario; el pedido del cliente igual se puede expresar, en su hilo.
- **Si preferís otra:** B pide una tabla aparte con su propio permiso (comentar) y mezclar dos capas en la foto; C es A
  sin la entrega 6 (se decide cuando llegue).

### AN4 · La copia "quemada" para bajar

- **Qué pasaba:** al final del día hay que mandar por WhatsApp la foto con las flechas a producción, que no tiene la app.
- **Las opciones:**
  - **A.** Se arma en el dispositivo al bajar o copiar (*Download → With annotations*, *Copy with annotations*), nunca
    se guarda.
  - **B.** Al cerrar el anotador se sube una copia anotada al Drive, al lado del original.
- **Elegí A porque** no duplica megas en el Drive, no sube nada desde un set con mala señal y nunca queda una copia vieja
  que no coincide con las anotaciones de hoy.
- **Si preferís otra:** B es una subida más por la cola de archivos y la decisión de qué hacer cuando cambian las
  anotaciones (volver a subir y mandar la vieja a la papelera). Factible, más gasto de Drive y de subida.

### AN5 · Qué herramientas en la primera entrega

- **Qué pasaba:** FrameRev tiene 14 herramientas; en un set con el teléfono en una mano se usan pocas.
- **Las opciones:**
  - **A.** Select, Rectangle, Ellipse, Arrow, Line, Pencil, Marker, Text y Number, con las letras de FrameRev. Icon y
    Censor después.
  - **B.** Las 14.
  - **C.** Solo flecha, círculo, texto y lápiz.
- **Elegí A porque** cubre señalar, encerrar, escribir y numerar, que es el reporte de set, y mantiene las letras de
  FrameRev; Ruler, Loupe y Color Sampler no sirven en una foto de set.
- **Si preferís otra:** sumar Icon (tildes y cruces) o Censor (tapar caras) es una entrega chica cada una; C se hace
  apagando botones.

### AN6 · Los colores

- **Qué pasaba:** en una foto de exteriores con mucho verde, la flecha verde de FrameRev no se ve; hay que poder pasar a
  rojo o amarillo de un toque.
- **Las opciones:**
  - **A.** El verde `#85DC53` de FrameRev por defecto, y 8 colores vivos a un toque: rojo `#FF3B30`, amarillo `#FFD60A`,
    verde `#85DC53`, cian `#32D7F0`, azul `#0A84FF`, magenta `#FF2DAA`, blanco y negro; más recientes y *Custom*.
  - **B.** Los 8 presets del selector de FrameRev (azules, violetas y ocres apagados).
  - **C.** Rojo por defecto, como casi todas las apps de anotar.
- **Elegí A porque** respeta el verde que eligió Lega para FrameRev y suma los que se leen sobre cualquier foto; los
  presets de FrameRev son colores de interfaz y sobre una foto se pierden.
- **Si preferís otra:** cambiar el color por defecto o la lista es cambiar una constante.

### AN7 · En qué se mide el grosor

- **Qué pasaba:** un trazo de 3 px en FrameRev, sobre una captura de pantalla, se ve bien. En una foto de 6000 px vista
  entera en el teléfono, 3 px de la foto es un pelo invisible.
- **Las opciones:**
  - **A.** El número es el grosor **en pantalla con la foto entera a la vista**, y se guarda en píxeles de la foto: un 3
  se ve como un 3 de FrameRev al dibujarlo, y crece o se achica con la foto (miniatura, PDF, zoom).
  - **B.** El número son píxeles de la foto original, como en FrameRev.
- **Elegí A porque** el mismo número da el mismo trazo que en FrameRev, sea cual sea la resolución de la cámara.
- **Si preferís otra:** B es la cuenta directa, pero en fotos de cámara obliga a grosores de 20 o 30 para ver algo.

### AN8 · El dedo y el Apple Pencil

- **Qué pasaba:** en el iPhone, con un dedo se dibuja, pero también se quiere ampliar para marcar un detalle chico.
- **Las opciones:**
  - **A.** Un dedo dibuja, dos dedos amplían y mueven; si se usa un Apple Pencil, desde ese momento el lápiz dibuja y el
    dedo mueve (como Notas).
  - **B.** Un botón para pasar de "dibujar" a "mover".
- **Elegí A porque** no hay que cambiar de modo en el medio del set, y es lo que ya hace la app Notas del iPhone.
- **Si preferís otra:** B se suma como botón en la tira de abajo sin sacar A.

### AN9 · Mostrar u ocultar las anotaciones

- **Qué pasaba:** en la reunión con el cliente se quiere mostrar la foto limpia del set en el carrete, sin las notas.
- **Las opciones:**
  - **A.** Siempre visibles en la página y el PDF; en el carrete, *Hide annotations* solo para quien mira, sin guardarse.
  - **B.** Un interruptor por foto, guardado para todos ("mostrar las anotaciones en la página").
  - **C.** A, más una opción en *Export PDF* para sacarlo sin anotaciones.
- **Elegí A porque** es lo más simple y no cambia nada para los demás; ocultar en el carrete alcanza para mostrar la foto
  limpia.
- **Si preferís otra:** C es una casilla en la impresión (fácil); B es una clave más en el mapa (fácil, pero confunde:
  alguien las esconde y otro cree que no hay).

### AN10 · Versión mínima

- **Qué pasaba:** alguien con una pestaña de la versión anterior imprime el reporte del día: las fotos salen sin las
  flechas y nadie se da cuenta.
- **Las opciones:**
  - **A.** Publicar primero la versión que muestra las anotaciones, subir la versión mínima y después la que deja anotar.
  - **B.** Publicar todo junto y no subir la versión mínima (una versión vieja igual no pierde nada).
- **Elegí A porque** el riesgo no es perder datos sino un PDF incompleto, y el orden ya es la costumbre del repo.
- **Si preferís otra:** B es más rápido; mientras seas el único usuario da lo mismo.

## 13. Entregas

| # | Qué | Prueba de aceptación |
|---|---|---|
| **0** | **Prueba técnica, sin publicar:** con el editor de la versión publicada (como `collabPhotosVersions.published.test.ts`), un `Y.Doc` con `photoMarkup` se abre, se edita y vuelve sin perder una clave; la base limpia lo conserva y vacía lo borrado; `version()` del historial lo trae. Medir los bytes de 50 trazos de un Apple Pencil (240 Hz) simplificados y de una foto típica. Comprobar con fotos reales de iPhone (verticales, HEIC pasado a JPEG) que `files.width/height` tienen la proporción de lo que se ve. | Las pruebas pasan; los números reemplazan los estimados de la sección 10; si la proporción falla en algún caso, se corrige el marco antes de seguir |
| **1** | **Ver:** el SVG sobre la foto en línea, la foto-bloque, la celda, el carrete (con *Hide annotations*) y la vista de impresión; el dibujo de las 9 formas; tipos desconocidos ignorados; la ayuda dice qué son. Prueba con el esquema anterior. | Una página con un mapa sembrado en la prueba (flecha, círculo, texto) muestra lo mismo en la página, la celda de 96 px, el carrete y el PDF, alineado con la foto en vertical y horizontal; una versión anterior abre esa página y el mapa sigue intacto |
| **2** | **Anotar en la compu:** el anotador, las 9 herramientas, letras, `[` `]`, Shift y Alt, colores, grosor (AN7), estilo por herramienta, deshacer propio, escribir al soltar, topes; *Annotate* en la barra y A en el carrete; ayuda y atajos en el registro; pruebas de dos editores a la vez y con la versión anterior. | Lega abre una foto de set, pone una flecha roja, un círculo y un texto, cierra: se ven en la página y en el PDF; en otra pestaña aparecen sin recargar; dos pestañas dibujando a la vez conservan todo; con la red cortada anota, y al volver sube |
| **3** | **El dedo y el Apple Pencil:** la tira de abajo, la hoja de propiedades, dos dedos para ampliar, el lápiz, el texto con el teclado del teléfono, sin red. | En el iPhone: anotar una foto con el dedo ampliando para un detalle, en modo avión; al volver la señal aparece en la compu |
| **4** | **Bajar y copiar:** *Download → With annotations*, *Copy with annotations*, la opción en *Download all*, el tope de 16 MP en el iPhone, *Export for FrameRev* (`.frproj` v2). | La foto bajada tiene las flechas donde estaban, al tamaño del original; el `.frproj` abre en FrameRev con las mismas formas y se pueden editar |
| **5** | **Historial, copiar y buscar:** versiones de "solo anotó", ver y restaurar anotaciones, copiar y pegar una foto con sus anotaciones a otra página, *Keep annotations?* al reemplazar, buscar en los textos de las anotaciones. | Borrar una flecha, cerrar todo, volver desde el historial y recuperarla; pegar la foto en otra página con las flechas |
| **6** | **(Opcional, si Lega lo pide) Dibujar en un comentario** (nivel comentar): el dibujo va con el comentario, no con la foto de la página. | Un invitado que comenta marca una ventana; el equipo ve el dibujo al abrir el hilo |

Cada entrega lleva su auditoría independiente antes de pasar a `main`.

## 14. Riesgos

1. **La proporción de la foto.** `files.width/height` salen de `naturalWidth/Height` de la foto al agregarla
   (`imageSize` en `src/media/probe.ts`), que los navegadores actuales dan ya girada según el EXIF. Si algún navegador
   no lo hiciera, las anotaciones saldrían corridas. Se mide en la entrega 0 con fotos reales; y por las dudas el marco
   se guarda en el mapa (`w` y `h`), no se lee de `files` al dibujar.
2. **Bytes del lápiz.** Un Apple Pencil manda 240 puntos por segundo: sin simplificar, un trazo pesa decenas de KB. La
   simplificación al soltar y los topes son obligatorios desde la entrega 2.
3. **PDF de una versión vieja sin anotaciones.** AN10.
4. **La base limpia tiene un techo de 8 MB por página.** El tope de 2 MB de anotaciones por página deja margen; una
   página con cientos de fotos anotadas se avisa antes.
5. **Rendimiento con muchas fotos.** 200 fotos con SVG en una página: los SVG solo se arman cuando la foto está cerca
   de la pantalla y se redibujan solo con cambios en su foto.
6. **Gestos en Safari del iPhone.** El pellizco de la página, el gesto de "atrás" desde el borde y el doble toque pueden
   pelearse con el dibujo; se prueba en un iPhone real (entrega 3).
7. **Borrar contra mover a la vez:** gana borrar; se recupera desde el historial (entrega 5). Hasta entonces, desde las
   filas (no se pierde, pero no hay botón).
8. **Deshacer en dos lugares:** ⌘/Ctrl+Z en la página no deshace anotaciones y en el anotador no deshace texto. Se dice
   en la ayuda.
9. **Canvas del iPhone:** la copia quemada se achica a 16 MP; se avisa.

## 15. Lo que no se pudo comprobar

- No se corrió ningún prototipo: que el mapa sobreviva a una versión vieja se apoya en el precedente de
  `collapsedHeadings` y en el código (`unknownContent.ts` y `buildCleanBase` miran el fragmento y el documento entero,
  respectivamente). La entrega 0 lo prueba.
- Los bytes de la sección 10 son estimados.
- No se miró FrameRev funcionando: lo de la sección 1 sale de su código y sus documentos.
- Que `files.width/height` tengan la medida ya girada en todos los navegadores con los que se suben fotos (el código
  dice que sí; falta verlo con fotos reales, riesgo 1).
