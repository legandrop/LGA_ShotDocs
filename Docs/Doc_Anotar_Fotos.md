# Anotar sobre las fotos (P.20)

**Estado: entregas 0, 1 y 2 hechas (v0.116: el mapa, sus pruebas y ver las anotaciones; v0.0XX: el anotador en la
compu y la poda; ver "Cómo quedó" al final); el dedo y el lápiz (entrega 3) siguen en diseño.** Pedido de Lega del 2026-10-02. Se diseñó contra `main` v0.108. Las decisiones
(AN1 a AN11, sección 12) son propuestas con la recomendación elegida: el número final lo pone quien las cierre con Lega.
Auditado el 2026-10-02 (aprobado con condiciones): las correcciones ya están en el texto y resumidas al final
("Correcciones de la auditoría").

## En corto

- **El pedido.** Dibujar encima de una foto de set (flechas, círculos, rectángulos, texto, lápiz) **sin tocar el
  original**. Quien usa **LGA FrameRev** (la app de escritorio de Lega para anotar capturas) tiene que sentirse en casa:
  mismas letras para las herramientas, mismos colores y grosores por defecto, mismos modificadores.
- **Dónde viven (AN1): en el documento de la página, afuera del contenido**, en un `Y.Map` propio (`photoMarkup`) al lado
  del fragmento del editor, como el mapa de "colapsar para todos" (`collapsedHeadings`, `Doc_Colapsar.md`). **Una clave
  por forma**, `<id del archivo>/<id de la forma>`, para que dos anotando a la vez sin red no pierdan nada. **Ningún tipo
  de bloque ni propiedad nueva**: una versión vieja de la app no ve
  el mapa, no lo toca y lo deja pasar; la foto se ve limpia y no se pierde nada.
- **Por eso se hereda todo lo que ya anda:** se guarda primero en el dispositivo, sube a `page_updates` (solo agregado),
  se fusiona sin red y entre dos personas (Yjs), llega en vivo a los demás, entra en el historial y en la base limpia de
  quien solo ve (D14), y la base ya exige poder editar la página para escribir (`push_page_update` →
  `can_edit_page`).
- **Cómo se ven:** un dibujo vectorial (SVG) encima de la foto, en la página, la celda, el carrete y el PDF. La
  miniatura y el original del Drive no cambian. **Bajar con anotaciones** arma una copia "quemada" en el dispositivo en
  el momento (AN4); nada se guarda dos veces en Drive.
- **Una foto sacada se lleva sus anotaciones** (AN11): un dispositivo que edita las poda, para que no le lleguen a
  quien solo ve (D14). Quedan en las filas y en el historial.
- **Entregas:** 0 prueba técnica, 1 ver, 2 anotar en la compu, 3 anotar con el dedo (y con lápiz en el iPad), 4 bajar y
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
| Lápiz | Puntos suavizados (gaussiano con detección de esquinas); el suavizado viene en 0 por defecto (`smoothing = 0`, campo `smoothingStrength`) | `src/editor/FreehandAnnotation.cpp`, `include/framerev/editor/ToolProperties.h` |
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
| Valores de fábrica (3, Marker 18/50 %, texto 24, número 16) | **Sí**; el grosor y la letra contra una referencia fija de 1920 px (AN7) | |
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
   `AnnotationFactory.cpp`, los `type`: `rectangle`, `ellipse`, `arrow`, `line`, `text`, `freehand_pencil`,
   `freehand_marker`, `numbered_marker`; `TwoPointAnnotation.cpp`, `FreehandAnnotation.cpp`, `TextAnnotation.cpp`,
   `ArrowAnnotation.cpp`). Shot Docs usa **los mismos nombres y los mismos ordinales** (`fillMode`: 0 None, 1 Stroke,
   2 StrokeAndFill, 3 Fill; `headStyle`: 0 Normal, 1 Open, 2 Banner; `headPosition`: 0 Start, 1 Both, 2 End), el
   orden de apilado en `zValue` y **el mismo sistema de coordenadas**: `posX/posY` de la forma más sus coordenadas
   locales (`startX…endY`, `points`, `rect*`, relativas a `posX/posY`), así pasar de uno a otro es copiar campos. Dos diferencias, que convierte la exportación: los puntos del lápiz van en una
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
- **Los demás** que editan y tienen la página abierta ven aparecer cada forma al soltarla. Quien recibe la base limpia
  (Ver, Comentar, invitados, link) la ve con la demora de D14 (de 20 s a 2 min).

### En el teléfono (con el dedo) y en el iPad

- **Abrir:** en el carrete, *Annotate*; o en la barra de la foto elegida.
- **La pantalla:** la foto arriba; abajo, una tira con las herramientas (se desliza si no entran), el punto de color y
  el grosor; al tocar el punto de color se abre una hoja con los colores, el grosor y la opacidad. Deshacer, rehacer y
  *Done* arriba (no hay teclado para ⌘Z). Controles de 44 px, márgenes de la muesca (`env(safe-area-inset-*)`).
- **Gestos (AN8):** **un dedo dibuja** con la herramienta elegida; **dos dedos** amplían y mueven (nunca dibujan). Con
  Select, un dedo elige y mueve. En el iPhone es siempre así (el Apple Pencil no anda en el iPhone). **En un iPad o una
  tableta con lápiz**, apenas se usa un lápiz (el navegador lo dice: `pointerType: 'pen'`), el lápiz dibuja y el dedo
  mueve, como en Notas. Sin animaciones si el sistema pide menos movimiento.
- **Texto:** al tocar con Text se abre el teclado sobre una caja de texto común (no el SVG), que al terminar se vuelve
  la forma.
- La página de atrás no se desplaza ni amplía mientras el anotador está abierto (`touch-action: none` en la foto).

### Atajos (registro único)

Un lugar nuevo del registro, `annotate`, con contexto propio para que no choquen con el editor: V R E A L P M T N, `[`
`]`, `Mod-[` `Mod-]`, `Mod-z`, `Mod-Shift-z` y `Mod-y`, Delete y Backspace, Escape, F, Space (mantener), `Mod-s` (solo el
aviso). En el carrete, **A** (*Annotate*). Las letras sueltas solo valen con el anotador abierto y sin una caja de texto
con el foco. Ojo: en la Mac, ⌘[ y ⌘] son "atrás" y "adelante" del navegador; con el anotador abierto se frenan con
`preventDefault`, y hay que probarlo en Safari y Chrome (entrega 2).

## 3. Dónde viven las anotaciones (AN1, AN2, AN11)

En el `Y.Doc` de la página, afuera del contenido, **un solo mapa raíz con claves planas** (nada de mapas creados "a
demanda" adentro de otro; ver B1 en "Correcciones de la auditoría"):

```
doc.getMap('photoMarkup')                    // al lado de CONTENT_FRAGMENT y de 'collapsedHeadings'
  '<fileId>'           → { v: 1, w: 6000, h: 4000 }       // valor plano: versión del formato y marco (tamaño de la foto)
  '<fileId>/<shapeId>' → Y.Map {                         // una forma; shapeId: un uuid que pone el dispositivo
      type: 'arrow', zValue: 3.5,                        // zValue fraccionario; empate: se ordena por shapeId
      posX: 2210, posY: 1340,                            // dónde está la forma (mover escribe solo esto)
      startX: 0, startY: 0, endX: 640, endY: -220,       // coordenadas locales, relativas a posX/posY
      strokeColor: '#85DC53', strokeWidth: 9, strokeOpacity: 100,
      headStyle: 0, headPosition: 2, arrowHeadSize: 100  // los nombres y ordinales del .frproj v2
  }
```

- **Por qué claves planas.** En Yjs, si dos dispositivos crean a la vez un `Y.Map` bajo la misma clave, gana uno y el del
  otro se borra con todo lo que tiene adentro: con una entrada por foto que contuviera las formas, dos personas que
  anotan por primera vez la misma foto sin red perderían las de una (medido en la auditoría: de 3 formas quedaban 2).
  Con una clave por forma no hay carrera (el id es único), y la entrada `<fileId>` es un valor plano: si dos la
  escriben, gana una con los mismos números y no se pierde nada (medido: 3 de 3).
- **Coordenadas en el marco de la foto** (sus píxeles, como FrameRev). El SVG usa `viewBox="0 0 w h"` sobre la foto, así
  que lo mismo sirve para el original, la imagen nítida, la miniatura de 480 px o una celda de 96 px.
- **Tipos y campos de FrameRev:** `rectangle`, `ellipse`, `arrow`, `line`, `text`, `freehand_pencil`,
  `freehand_marker`, `numbered_marker`, con `posX/posY` más coordenadas locales y los nombres de campo del `.frproj` v2
  (sección 1).
- **Una propiedad por clave.** Mover una forma escribe solo `posX`/`posY`; cambiar el color, solo `strokeColor`. Así dos
  personas que cambian cosas distintas de la misma forma conservan las dos, y **una versión futura que sume un campo no
  lo pierde** cuando una vieja mueve la forma (la vieja nunca reescribe la forma entera). Un `type` desconocido no se
  dibuja, no se elige y no se borra.
- **El texto** de una forma `text` es un valor plano: dos que lo editan a la vez se quedan con uno entero (el otro queda
  en las filas). Alcanza para rótulos.
- **El lápiz** guarda sus puntos en una lista plana, relativos a `posX/posY`, redondeados al píxel del marco y
  simplificados al soltar (Douglas-Peucker a medio píxel de pantalla); los puntos de un trazo no cambian después.
- **Por qué funciona con una versión vieja:** `y-prosemirror` solo se ata a `CONTENT_FRAGMENT`; el resguardo de
  versiones viejas (`src/ui/unknownContent.ts`) revisa solo ese fragmento; el resto del `Y.Doc` viaja intacto en cada
  subida y bajada. La auditoría lo probó con dos esquemas viejos, la librería publicada y la sincronización de v0.029.
- **La clave es el archivo, dentro de la página** (AN2): la misma foto dos veces en la página (o en una celda y como
  bloque) comparte las anotaciones (se dice en la ayuda); la misma foto en otra página sale limpia (hasta que se copie
  con sus anotaciones, entrega 5). Convertir una foto-bloque en foto en línea (`convertPhotos.ts`) no cambia la `url`,
  así que las anotaciones siguen. **Reemplazar** la foto (barra de la foto) cambia el archivo: si la nueva tiene la misma
  proporción, se pregunta *Keep annotations?* y se copian a las claves nuevas; las del archivo viejo quedan huérfanas y
  las saca la poda.
- **Una foto sacada de la página: la poda (AN11).** Un dispositivo que edita la página borra, como una edición normal,
  las claves `<fileId>` y `<fileId>/*` de un archivo que ya no está en el contenido (`mediaIdsInDoc`,
  `src/media/usage.ts`) desde hace más de 10 minutos (así no la dispara un cortar y pegar). Nunca se hace mientras se
  arma la base limpia (cambiaría `update_seq`) y la hace solo quien puede editar. Con las claves planas es segura: si
  otro dispositivo sin red anotó esa foto, sus formas son claves nuevas que no se pierden; quedan huérfanas y las saca
  la próxima poda. No se pierde nada: lo podado sigue en `page_updates` y el historial lo devuelve (entrega 5). Deshacer
  el borrado de la foto después de la poda la trae limpia (se dice en la ayuda).
  Tres condiciones para programarla (re-verificación del diseño): (1) los 10 minutos los mide el dispositivo con la
  página abierta y sincronizada, con su reloj local, nunca con una hora guardada en el documento; (2) **nunca se poda si
  la página no terminó de bajar** (bajada completa confirmada y el contenido ya cargado: un documento todavía vacío vería
  todas las fotos como sacadas), con su prueba de documento vacío y filas por llegar; (3) como la base limpia, la poda
  corre solo cuando alguien que edita abre la página: si nadie la abre, las notas siguen en la última base. Esto último se
  suma a «lo que no garantiza» de `Doc_Privacidad_Borrado.md` en la entrega 2.
- **El deshacer del anotador** es un `Y.UndoManager` sobre el mapa raíz con un origen propio por foto
  (`sd-markup:<fileId>` en `trackedOrigins`): deshace solo lo de esa foto en esa sesión.

## 4. Cómo se ven en cada lugar

| Lugar | Qué se ve | Cómo |
|---|---|---|
| Página (foto en línea, foto-bloque, foto en celda) | La foto con sus anotaciones | Un `<svg>` en **la misma caja que el `<img>`**, con `preserveAspectRatio` por defecto (`xMidYMid meet`, que es exactamente `object-fit: contain`; nunca `none`) y `pointer-events: none`. Lee las claves de esa foto y se redibuja cuando cambian (un observador del mapa raíz filtrado por `<fileId>`). No depende de la `src`: el cambio a la imagen nítida (`sharpImages.ts`) no lo toca. **Toda foto con anotaciones tiene su SVG montado siempre**, esté donde esté en la página; una foto sin anotaciones no tiene SVG |
| Miniatura en una celda (96 px) | Igual, en chico | El grosor se escala con la foto; por debajo de 1 px de pantalla se dibuja a 1 px para que no desaparezca |
| Carrete | Con anotaciones; botón *Hide annotations* (solo para quien mira, no se guarda) | El mismo SVG, con el zoom del carrete |
| PDF | Con anotaciones, vectoriales (nítidas aunque la foto sea la miniatura) | La vista de impresión copia `.bn-editor` con `cloneNode` (`printView.ts`, `cleanCopy`): como el SVG de una foto anotada está montado siempre, sale aunque la foto esté lejos de la pantalla al imprimir. El ancho fijo en px de la foto no cambia, así que los cortes de hoja tampoco |
| Original en Drive y miniatura de `thumbs` | Limpios, siempre | No se tocan |
| *Download* | Menú: *Original* o *With annotations* (entrega 4) | Sección 5 |
| Historial | Cada versión con las anotaciones de entonces (entrega 5) | El `Y.Doc` de la versión ya trae el mapa |
| Versión vieja de la app | La foto limpia | No conoce el mapa |

Una marca chica (ícono de lápiz en una esquina) avisa en la página que la foto tiene anotaciones solo si están
escondidas en el carrete; en la página siempre se ven, no hace falta marca (AN9). Ninguna vista con `object-fit: cover`
lleva anotaciones (hoy solo la papelera y las carpetas, que no las muestran): ahí el dibujo no coincidiría con la foto.

**El mapa es entrada no confiable.** Lo escribe cualquiera que edita, también un link *Can edit* sin cuenta
(`Doc_Link_Publico.md`). El dibujo acepta colores solo con `/^#[0-9a-f]{6}$/i`, números finitos y acotados (al marco y a
los topes de grosor y letra), texto solo como `textContent` (nunca `innerHTML` ni atributos armados con texto), ningún
`href` ni `style` que salga del mapa, ignora los campos desconocidos y corta un trazo en 5000 puntos al dibujar (un mapa
malicioso no cuelga la página). Con prueba en la entrega 1.

## 5. Bajar con anotaciones: la copia quemada (AN4)

- Se arma **en el dispositivo, al bajar**: el original (del dispositivo o con un pase del portero, que ya manda
  `Access-Control-Allow-Origin` a la app; sin eso el `canvas` queda "manchado" y no se puede leer, así que se prueba con
  las dos fuentes, también el `blob:` del dispositivo), un `canvas` del tamaño de la foto, las formas dibujadas con la API
  del `canvas` (no el SVG pasado a imagen: así no cargaría la letra de la app y el texto saldría con otra), y JPEG
  (calidad 92) o PNG si el original es PNG. Nombre: `<nombre>_annotated.jpg`. Nunca se sube ni se guarda en Drive.
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

- Cada forma es una clave propia del mapa raíz: dos personas dibujando en la misma foto conservan todo lo de las dos,
  también la primera vez y sin red (sección 3).
- Dos que cambian la misma forma: cada propiedad queda con el último cambio que llegó (por ejemplo, uno cambia el
  color y otro la mueve: queda movida y con el color nuevo).
- Uno la borra mientras otro la mueve: queda borrada. Se recupera con el historial (entrega 5).
- Se escribe **al soltar** (no en cada cuadro del arrastre): los demás ven la forma terminada y las filas no se llenan de
  posiciones intermedias. Mientras se arrastra, solo lo ve quien arrastra.
- El deshacer del anotador es un `Y.UndoManager` con el origen propio de esa foto (`sd-markup:<fileId>`): nunca deshace
  lo de otro ni el texto de la página; el ⌘/Ctrl+Z de la página nunca deshace anotaciones.
- **Número (Number) a la vez:** el siguiente es "el más alto + 1", como en FrameRev; dos que ponen números a la vez
  pueden repetir uno. Se renumera a mano (doble clic en el número).
- **Orden de apilado a la vez:** dos formas con el mismo `zValue` se ordenan por su `shapeId`, igual en todos los
  dispositivos.

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
  borradas siguen en las filas). Y como una sesión de solo anotar se junta con la versión anterior (`touchesContent` mira
  solo el fragmento), esa versión muestra anotaciones hechas horas después; lo arregla la misma entrega 5.

## 10. Tamaño y plan gratis

Medido en la auditoría (Yjs 13.6, codificación V1, como sube la app):

| Qué | Bytes |
|---|---|
| Flecha (12 campos con los nombres del `.frproj`) | 320 |
| Texto corto | 210 |
| Trazo con el dedo, 2 s a 60 Hz, simplificado (73 puntos) | 724 |
| Trazo con el dedo, 2 s a 120 Hz (128 puntos) | 1132 |
| Trazo con lápiz a 240 Hz en un iPad (239 puntos; sin simplificar, 3208) | 1707 |
| Mover una forma (`posX` y `posY`) | 39 |
| Una foto de set típica (10 formas y 5 trazos) | 7,5 KB |
| La misma flecha movida 100 veces: en las filas / en la base limpia | 6,7 KB / 3,8 KB |

- **Lo pisado no desaparece de la base limpia:** cada campo pisado deja un hueco de unos 9 bytes para siempre. Por eso
  **escribir al soltar es obligatorio** (nunca en cada cuadro de un arrastre).
- **Topes, en bytes codificados** (no en cantidad de formas): por foto, 96 KB del contenido vivo de sus claves
  codificado; por página, 512 KB de anotaciones vivas; y anotar se apaga si la base de la página (`encodeStateAsUpdate`
  de una copia con GC, como la base limpia) pasa 2,5 MB, que cubre también los huecos. Se miden al abrir el anotador y
  después de cada escritura. 2000 letras por texto. Al 80 % se avisa; al tope, las herramientas de crear se apagan con
  *This photo has too many annotations* (o *This page…*). Los números se ajustan con lo medido en la entrega 2.
- **Por qué 512 KB por página y no más:** con la cadencia de la base limpia de D14 (`f = tamaño / 100 KB`), una página
  de 2 MB se rearma cada pocos minutos y cada lector la baja entera cada vez (el egress del plan gratis es de 5 GB por
  mes).
- **Base (500 MB gratis):** 1000 fotos típicas son unos 7,5 MB. Lo borrado queda en `page_updates` (la subida va sin
  GC, para el historial) hasta que exista compactar (`Doc_Compactar.md`).
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

- **Qué pasaba:** un trazo de 3 px en FrameRev, sobre una captura de pantalla de 1920 px, se ve bien. En una foto de
  cámara de 6000 px, 3 px de la foto es un pelo invisible. Y si el número fuera "en pantalla", el mismo 3 dibujado en el
  iPhone (la foto entera en unos 390 px) guardaría un trazo 3,5 veces más grueso que dibujado en la compu.
- **Las opciones:**
  - **A.** El número son píxeles **con el lado largo de la foto llevado a 1920 px** (una referencia fija), y se guarda
    en píxeles de la foto: en una foto de 6000 px, un 3 guarda unos 9 px. Sobre una captura de 1920 px es idéntico a
    FrameRev, y no depende del dispositivo ni del zoom. Lo mismo para el tamaño de letra y el del número.
  - **B.** El número es el grosor en pantalla con la foto entera a la vista (la primera propuesta): depende de dónde se
    dibujó.
  - **C.** El número son píxeles de la foto original, como en FrameRev.
- **Elegí A porque** el mismo número da el mismo trazo en el iPhone y en la compu, y en una foto del tamaño de una captura
  es exactamente FrameRev.
- **Si preferís otra:** C es la cuenta directa, pero en fotos de cámara obliga a grosores de 20 o 30 para ver algo; la
  referencia de 1920 es una constante que se cambia fácil.

### AN8 · El dedo, y el lápiz en el iPad

- **Qué pasaba:** en el set, con el iPhone, se dibuja con un dedo, pero también se quiere ampliar para marcar un detalle
  chico. (El Apple Pencil no funciona en el iPhone: solo en el iPad.)
- **Las opciones:**
  - **A.** Un dedo dibuja y dos dedos amplían y mueven. En un iPad o una tableta con lápiz, apenas se usa el lápiz, el
    lápiz dibuja y el dedo mueve (como Notas).
  - **B.** Un botón para pasar de "dibujar" a "mover".
- **Elegí A porque** no hay que cambiar de modo en el medio del set, y es lo que ya hace la app Notas.
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

### AN11 · Las anotaciones de una foto sacada

- **Qué pasaba:** en el reporte que ve el cliente, el supervisor anotó una foto con "este plano no se cobra" y después
  sacó la foto de la página. La foto ya no se ve, pero sus anotaciones seguirían viajando a todos los que abren la
  página, también al cliente que solo mira (D14 promete que lo borrado no le llega).
- **Las opciones:**
  - **A.** Una poda: un dispositivo que edita la página borra, como una edición normal, las anotaciones de una foto que
    lleva más de 10 minutos fuera de la página. Quedan en las filas y el historial las devuelve; deshacer el borrado
    de la foto después la trae limpia.
  - **B.** Dejarlas en la página para siempre y sumar a D14 la excepción ("las notas de una foto sacada siguen llegando a
    quien solo ve").
- **Elegí A porque** cumple D14 sin excepciones y no pierde nada (con una clave por forma, lo que alguien anotó sin red
  sobrevive y se poda en la vuelta siguiente).
- **Si preferís otra:** B no tiene código, pero hay que escribir la excepción en D14 y en la ayuda; sin A ni B no se
  habilita la entrega 2.

## 13. Entregas

| # | Qué | Prueba de aceptación |
|---|---|---|
| **0** | **Prueba técnica, sin publicar:** con el editor de la versión publicada (como `collabPhotosVersions.published.test.ts`), un `Y.Doc` con `photoMarkup` se abre, se edita y vuelve sin perder una clave; la base limpia lo conserva y vacía lo borrado; `version()` del historial lo trae. **Carrera:** dos dispositivos anotan por primera vez la misma foto sin red y, al juntarse, están todas las formas. **Foto sacada:** después de la poda, el texto de su anotación no está en los bytes de la base limpia. Medir con el dedo a 60 y 120 Hz en el iPhone. Comprobar con fotos reales de iPhone (verticales, HEIC pasado a JPEG) que `files.width/height` tienen la proporción de lo que se ve. | Las pruebas pasan; si la proporción falla en algún caso, se corrige el marco antes de seguir |
| **1** | **Ver:** el SVG en la misma caja que el `<img>` (`meet`) sobre la foto en línea, la foto-bloque, la celda, el carrete (con *Hide annotations*) y la vista de impresión, montado siempre en las fotos anotadas; el dibujo de las 9 formas; el mapa tratado como entrada no confiable; tipos desconocidos ignorados; la ayuda dice qué son. Prueba con el esquema anterior. | Una página con un mapa sembrado en la prueba (flecha, círculo, texto) muestra lo mismo en la página, la celda de 96 px, el carrete y el PDF, alineado con la foto en vertical y horizontal; **imprimir una página larga con la foto anotada fuera de la pantalla saca las flechas**; un mapa con colores, números y textos maliciosos se dibuja acotado y sin HTML; una versión anterior abre esa página y el mapa sigue intacto |
| **2** | **Anotar en la compu:** el anotador, las 9 herramientas, letras, `[` `]`, Shift y Alt, colores, grosor (AN7), estilo por herramienta, deshacer propio por foto, escribir al soltar, topes en bytes codificados, la poda de huérfanos (AN11); *Annotate* en la barra y A en el carrete; ayuda y atajos en el registro; pruebas de dos editores a la vez y con la versión anterior. | Lega abre una foto de set, pone una flecha roja, un círculo y un texto, cierra: se ven en la página y en el PDF; en otra pestaña aparecen sin recargar; dos pestañas dibujando a la vez conservan todo; con la red cortada anota, y al volver sube; ⌘[ en Safari y Chrome cambia el grosor y no va "atrás"; sacar la foto anotada y, a los 10 minutos, la base limpia ya no trae sus notas |
| **3** | **El dedo (y el lápiz en el iPad):** la tira de abajo, la hoja de propiedades, dos dedos para ampliar, el lápiz en el iPad, el texto con el teclado del teléfono, sin red. | En el iPhone: anotar una foto con el dedo ampliando para un detalle, en modo avión; al volver la señal aparece en la compu. En un iPad con lápiz: el lápiz dibuja y el dedo mueve |
| **4** | **Bajar y copiar:** *Download → With annotations* (formas dibujadas con la API del `canvas`), *Copy with annotations*, la opción en *Download all*, el tope de 16 MP en el iPhone, *Export for FrameRev* (`.frproj` v2). | La foto bajada tiene las flechas donde estaban, al tamaño del original y con la misma letra que en pantalla, desde el portero y desde la copia del dispositivo; el `.frproj` abre en FrameRev con las mismas formas y se pueden editar |
| **5** | **Historial, copiar y buscar:** versiones de "solo anotó", ver y restaurar anotaciones (también las podadas), copiar y pegar una foto con sus anotaciones a otra página, *Keep annotations?* al reemplazar, buscar en los textos de las anotaciones. | Borrar una flecha, cerrar todo, volver desde el historial y recuperarla; pegar la foto en otra página con las flechas |
| **6** | **(Opcional, si Lega lo pide) Dibujar en un comentario** (nivel comentar): el dibujo va con el comentario, no con la foto de la página. | Un invitado que comenta marca una ventana; el equipo ve el dibujo al abrir el hilo |

Cada entrega lleva su auditoría independiente antes de pasar a `main`.

## 14. Riesgos

1. **La proporción de la foto.** `files.width/height` salen de `naturalWidth/Height` de la foto al agregarla
   (`imageSize` en `src/media/probe.ts`), que los navegadores actuales dan ya girada según el EXIF. Si algún navegador
   no lo hiciera, las anotaciones saldrían corridas. Se mide en la entrega 0 con fotos reales; y por las dudas el marco
   se guarda en el mapa (`w` y `h`), no se lee de `files` al dibujar.
2. **Bytes del lápiz.** Un lápiz de iPad manda 240 puntos por segundo (1,7 KB por trazo de 2 s simplificado, 3,2 KB sin
   simplificar). La simplificación al soltar y los topes son obligatorios desde la entrega 2.
3. **PDF de una versión vieja sin anotaciones.** AN10.
4. **El peso de la página para quien recibe bases.** La base limpia tiene un techo de 8 MB y se rearma más seguido cuanto
   más pesa; por eso los topes de 512 KB de anotaciones y 2,5 MB de base (sección 10).
5. **Rendimiento con muchas fotos anotadas.** Toda foto anotada tiene su SVG montado siempre (para que salga en el PDF);
   son livianos y se redibujan solo con cambios en su foto. Se mide en la entrega 1 con 200 fotos anotadas.
6. **Gestos en Safari del iPhone.** El pellizco de la página, el gesto de "atrás" desde el borde y el doble toque pueden
   pelearse con el dibujo; se prueba en un iPhone real (entrega 3).
7. **Borrar contra mover a la vez:** gana borrar; se recupera desde el historial (entrega 5). Hasta entonces, desde las
   filas (no se pierde, pero no hay botón).
8. **Deshacer en dos lugares:** ⌘/Ctrl+Z en la página no deshace anotaciones y en el anotador no deshace texto. Se dice
   en la ayuda.
9. **Canvas del iPhone:** la copia quemada se achica a 16 MP; se avisa.
10. **⌘[ y ⌘] en la Mac** son "atrás" y "adelante" del navegador: si `preventDefault` no los frena en algún navegador,
    se cambian por otra tecla en el registro (entrega 2).
11. **Números repetidos** si dos ponen Number a la vez; y **la misma foto dos veces en la página** comparte el dibujo. Se
    dice en la ayuda.
12. **La poda y deshacer:** deshacer el borrado de una foto después de la poda la trae limpia; sus notas vuelven desde el
    historial (entrega 5). Se dice en la ayuda.

## 15. Lo que no se pudo comprobar

- Que el mapa sobreviva a una versión vieja, a la base limpia y al historial lo probó la auditoría con pruebas propias
  (fuera del repo); la entrega 0 las pasa al repo.
- Los bytes de la sección 10 los midió la auditoría en pruebas, no en un teléfono: falta el dedo real a 60 y 120 Hz.
- La poda (AN11) es diseño: no se probó.
- No se miró FrameRev funcionando: lo de la sección 1 sale de su código y sus documentos.
- Que `files.width/height` tengan la medida ya girada en todos los navegadores con los que se suben fotos (el código
  dice que sí; falta verlo con fotos reales, riesgo 1).

## Correcciones de la auditoría (2026-10-02)

Auditoría independiente: **aprobado con condiciones**. Lo que pedía y dónde quedó:

| Hallazgo | Corrección |
|---|---|
| **B1** La entrada de cada foto (un `Y.Map` con las formas adentro) se crea con carrera: dos que anotan por primera vez la misma foto sin red pierden las formas de uno (3 → 2, medido) | Un solo mapa raíz con **claves planas**: `<fileId>/<shapeId>` para cada forma y `<fileId>` como valor plano `{ v, w, h }`; deshacer con un origen por foto. Prueba de carrera en la entrega 0 (sección 3) |
| **B2** Las anotaciones de una foto sacada siguen vivas y llegan en la base limpia a Ver, Comentar, invitados y links (rompe D14) | **AN11: la poda de huérfanos** por un dispositivo que edita, a los 10 minutos, nunca al armar la base; vale también al reemplazar la foto. Prueba "foto sacada → no está en la base" en la entrega 0 y en la 2 (secciones 3 y 12) |
| **B3** El PDF clona el DOM y el riesgo 5 decía que los SVG se arman solo cerca de la pantalla | **Toda foto anotada tiene su SVG montado siempre**; prueba de imprimir con la foto fuera de pantalla en la entrega 1 (sección 4, riesgo 5) |
| **AN7** "En pantalla" depende del dispositivo (×3,5 entre iPhone y compu) | El número es en píxeles con el lado largo de la foto **llevado a 1920 px**, guardado en píxeles de la foto; igual para letra y número |
| **AN8** El Apple Pencil no anda en el iPhone | iPhone: dedo; el lápiz, en el iPad o una tableta (sección 2, AN8, entrega 3) |
| **C1** El mapa lo escribe cualquiera que edita, también un link sin cuenta | Entrada no confiable: colores con regex, números acotados, texto solo como `textContent`, sin `href`/`style`, tope de puntos (sección 4, entrega 1) |
| **C2** `object-fit: contain` en el carrete y el PDF | SVG en la misma caja que el `<img>` con `xMidYMid meet`; ninguna vista `cover` lleva anotaciones (sección 4) |
| **C3** Topes en formas vivas no ven los huecos | Topes en bytes codificados: 96 KB por foto, 512 KB por página, 2,5 MB de base (sección 10) |
| **O1** Fidelidad con FrameRev | Nombres de tipo, `zValue`, `posX/posY` + locales y suavizado en 0 escritos (secciones 1 y 3) |
| **O2, O3** Número y `zValue` a la vez | Número repetido aceptado (renumerar a mano); empate de `zValue` por `shapeId` (sección 7) |
| **O4** Texto como valor plano | Aceptado para rótulos (sección 3) |
| **O5, O6** Copia quemada: CORS y letras | Probar con portero y `blob:`; formas con la API del `canvas` (sección 5, entrega 4) |
| **O7** Lo pisado deja huecos | Escribir al soltar es obligatorio (sección 10) |
| **O8** 2 MB por página es mucho para D14 y el egress | 512 KB por página (sección 10) |
| **O9** La misma foto dos veces comparte el dibujo | En la ayuda (sección 3, riesgo 11) |
| **O10** Quien recibe bases ve con la demora de D14 | Dicho en la sección 2 |
| **O11** ⌘[ y ⌘] son atrás/adelante en la Mac | `preventDefault` probado en Safari y Chrome (sección 2, entrega 2, riesgo 10) |
| **O12** Una sesión de solo anotar se junta con la versión anterior | Dicho en la sección 9; lo arregla la entrega 5 |

## Cómo quedó (entregas 0 y 1, v0.116)

**Entrega 0, la prueba técnica.** Pasó todo lo que se podía probar sin un teléfono:

- `src/media/markup.ts` es el modelo: el mapa raíz `photoMarkup` con claves planas, la lectura que trata el mapa como
  entrada no confiable (`readShape`, `readFrame`) y el único camino para escribir (`addShape`, `updateShape`,
  `deleteShape`, `removePhotoMarkup`, cada uno una transacción con el origen `sd-markup:<fileId>`). Lo usará el anotador.
- Versiones: el editor publicado (v0.107 a v0.111), el de v0.083 a v0.092 y uno sin la foto en línea abren la página,
  la editan y sacan la foto anotada, y el mapa vuelve con todas sus claves (`src/ui/photoMarkup.test.ts`); lo mismo con la
  librería de verdad de v0.052 a v0.075 (`photoMarkup.published.test.ts`) y con la sincronización de v0.029, que además
  no resucita una forma borrada (`publishedCompat.test.ts`).
- Base limpia: con el motor de verdad, quien solo ve recibe las formas vivas y nunca el texto de una forma borrada ni el
  de una foto podada; con una base armada sin GC (la mutante) sí lo recibiría (`src/sync/markupClean.test.ts`).
- Historial: cada versión trae las anotaciones de entonces, y vaciar lo de colapsar no las toca.
- Carrera: dos que anotan por primera vez la misma foto sin red conservan 3 de 3 formas; con un `Y.Map` por foto (lo que
  descartó la auditoría) se pierden. Color de uno y posición de otro sobre la misma forma: quedan las dos cosas.
- Deshacer: un `Y.UndoManager` con el origen de una foto deshace solo lo de esa foto; el Ctrl/⌘+Z de la página no deshace
  anotaciones.
- La proporción (riesgo 1): en Chromium, una JPEG con EXIF de orientación 1, 3, 6 y 8 da en `files.width/height` y en la
  miniatura la misma medida, ya girada, que muestra el navegador. **Falta**: Safari, fotos HEIC de un iPhone real y el
  dedo a 60 y 120 Hz (no hay teléfono en esta máquina).

**Entrega 1, ver.**

- `src/ui/markupSvg.ts` dibuja las nueve formas con las cuentas de FrameRev a la escala del marco (cabeza de la flecha:
  4 veces el grosor, 22°; tinta del texto por contraste con umbral 128; número con 0,6). Texto solo con `textContent`,
  colores `#RRGGBB`, ningún `href`, `style` ni id; Banner se dibuja como la cabeza llena.
- `src/ui/markupOverlay.ts` pone un `<svg class="sd-markup">` justo después del `<img>` de cada foto anotada (en línea,
  en una celda y foto-bloque), en su misma caja, **montado siempre**; se redibuja cuando cambian las suyas (también de
  otro) y cuando el editor vuelve a dibujar la foto. Lo engancha `PageEditor.tsx` (también en solo lectura y en la vista
  de una versión del historial, que ya trae su mapa). El grosor nunca baja de 1 px de pantalla.
- El carrete (`CarreteMarkup.tsx`) dibuja las de la foto que se ve, con su zoom; *Hide annotations* / *Show annotations*
  (un ojo) solo aparece con una foto anotada, no se guarda, y con las anotaciones ocultas una marca chica en la esquina
  dice que las tiene. La vista de impresión las copia con el editor.
- Ayuda: *Annotations on photos* (sección Fotos). Sin atajos nuevos.

**Medido en el navegador** (Chromium, servidor en memoria, sin login): en la compu y a 375 px de ancho, el aro y la cruz
dibujados en las fotos coinciden con la elipse y la punta de la flecha anotadas (0 px de diferencia; la caja del dibujo
es la de la foto) en la foto-bloque, la vertical en línea, la miniatura de 96 px de la celda y la del final; en el
carrete; y en el PDF, también la foto del final de una página larga que nunca se vio en pantalla. Con 200 fotos anotadas
en la página y 3240 claves en el mapa, un cambio se redibuja en unos 20 ms (antes de leer todas las cajas juntas, 200 ms).

**Decisiones tomadas sin Lega** (cambiables): el ícono de ocultar es un ojo (el lápiz queda para *Annotate*); la letra del
texto es la de la app (se ignora `fontFamily` del mapa: es entrada no confiable y la letra tiene que cargar en la web);
el texto se corta en renglones solo donde el navegador puede medir (`OffscreenCanvas`); una forma sin marco o de un tipo
desconocido no se dibuja ni se borra; se dibujan como mucho 2000 formas por foto (las de más arriba) y las coordenadas se
acotan a 4 veces el lado de la foto.

**Después de la auditoría de las entregas 0 y 1 (2026-10-02).** Bloqueante B1: cortar un texto en renglones medía
`renglón + palabra` en cada palabra, cuadrático en el largo; 200 textos de 2000 letras (un mapa de 477 KB) congelaban la
página unos 6 a 11 s al abrir y en cada cambio de esa foto. Ahora `wrapLines` mide cada palabra distinta una sola vez y
suma, pone la letra una vez por texto, corta cuando los renglones ya no entran en la caja, y una foto dibuja como mucho
20 000 letras (`MAX_DRAWN_CHARS`; lo de más queda guardado). Medido en Chromium con el arnés de la auditoría: 200 textos,
de 7,2 s a 17 ms la primera vez y de 6,1 s a 12 ms por cambio; 2000 textos (4,5 MB), 72 ms y 89 ms. Un texto de 2000
letras en caja ancha pasó de medir 1 001 999 letras a 2. Las pruebas cuentan las letras medidas y caen con el código
anterior. También: no se dibuja sobre la tarjeta de la cola (sin copia en el dispositivo, borrada, de otro proyecto) ni
sobre una imagen que no cargó, en la página y en el carrete (O1); el ojo dice si está apretado (`aria-pressed`, O5). El
grosor mínimo de pantalla que queda en el PDF (O2) pasó al roadmap.

**Falta para publicar:** subir `workspace_settings.min_app_version` a esta versión (AN10) antes de la entrega 2.

## Cómo quedó la entrega 2 (anotar en la compu, v0.0XX)

**El anotador** (`src/ui/Annotator.tsx`, se baja aparte como el carrete y solo lo abre quien puede editar la página):

- **Abrir:** *Annotate* en la barra de la foto elegida (foto en línea y foto-bloque; solo una foto del Drive, nunca un
  video ni un adjunto) o, en el carrete, el botón *Annotate* o la tecla **A** (el carrete se cierra y abre el anotador).
  Sin permiso de editar, no hay botón ni tecla: `PageEditor.tsx` pasa `onAnnotate` solo con la página editable, las
  barras de la foto ya solo se ven así, y la base rechaza la escritura igual (`push_page_update`).
- **Las nueve herramientas** con las letras de FrameRev (V R E A L P M T N), Shift (cuadrado, círculo, 45°) y Alt
  (desde el centro), los valores de fábrica de FrameRev y el estilo **recordado por herramienta en el dispositivo**
  (`annotatorStyles.ts`; lo cambiado en una forma elegida queda como el de la próxima). Franja de propiedades: los 8
  colores de AN6, recientes y *Custom*; grosor (barra de 0 a 40 y número hasta 999, contra la referencia de 1920 px de
  AN7); opacidad; relleno (rectángulo y elipse) o fondo (texto, con tinta automática); punta abierta y en las dos
  puntas (flecha); tamaño (texto y número). Cursor de pincel con el diámetro real en el lápiz y el marcador.
- **Teclado** (`annotatorKeys.ts`, en la captura de `window`: nada de la página actúa debajo): `[` `]` cambian el
  grosor de lo elegido si el cursor está encima y si no el de la próxima; Ctrl/⌘+`[` `]` siempre el de la próxima y se
  frenan con `preventDefault` (⌘[ es "atrás" en la Mac); Ctrl/⌘+Z, Ctrl/⌘+Shift+Z y Ctrl/⌘+Y; Supr y Backspace; Esc
  (termina el texto, deja de elegir y, sin nada elegido, cierra); F encuadra; la barra espaciadora apretada (o la
  rueda apretada) mueve la foto ampliada; la rueda y el pellizco del trackpad amplían; Ctrl/⌘+S solo avisa que se
  guarda solo. Todo en el registro (`shortcuts.ts`, lugar `annotate`, y `carreteAnnotate`) y en la ayuda
  (*Annotate a photo*).
- **Elegir:** clic, Shift+clic, recuadro; arrastrar mueve (escribe solo `posX`/`posY`); tiradores en las esquinas de
  rectángulo, elipse y texto y en las puntas de flecha y línea (el lápiz y el número solo se mueven); doble clic en un
  texto lo edita y en un número lo renumera.
- **Escribir al soltar:** mientras se arrastra (dibujar, mover, un tirador, una barra de la franja) la forma vive solo
  en la pantalla; se escribe una transacción al soltar. Escribir un valor igual al que hay no escribe nada (tocar el
  mismo color dos veces no deja un hueco más). El lápiz se simplifica al soltar (Douglas-Peucker a medio píxel de
  pantalla), relativo a su primer punto y redondeado al píxel del marco, con el tope de 5000 puntos.
- **Deshacer propio:** un `Y.UndoManager` sobre el mapa con el origen `sd-markup:<fileId>`, uno por sesión del
  anotador: lo de otro editor (llega por la red) y lo de otra foto no se deshacen. La poda tiene su propio origen.
- **El marco:** si la foto no tenía anotaciones, el de la primera forma es la **medida del archivo**
  (`files.width/height`, ya girada, del registro del dispositivo, también sin red: `MediaQueue.dimensions`) o, si no
  se sabe, la del original cargado; **nunca la de la vista previa** (corrección B1). Sin ninguna de las dos, se ve la
  foto y las herramientas de crear se apagan (*connect to the internet to annotate this photo for the first time*).
  Nunca se reescribe. Un marco con `v` mayor abre en solo lectura (*Update the app to edit these annotations*).
- **Topes en bytes codificados** (`src/media/markupLimits.ts`, sección 10): por foto, el contenido vivo de sus claves
  (96 KB); por página, el de todas (512 KB); la base de la página con GC (2,5 MB). Se miden al abrir y después de cada
  escritura (6 ms con una foto llena); al 80 % se avisa y al tope las herramientas de crear se apagan (elegir, mover y
  borrar siguen). Medido: una flecha del anotador pesa 389 bytes (el id es un uuid), un rectángulo 391, un texto corto
  496, un número 346, un trazo de 2 s a 60 Hz simplificado (39 puntos) 507; entran 265 flechas por foto.
- **Sin red:** anota igual (todo va al documento de la página en el dispositivo) y sube al volver. Sin nada de la foto en
  el dispositivo, el anotador lo dice (*This photo isn't on this device yet*) y las herramientas de crear se apagan.

**La poda (AN11)** (`src/media/markupPrune.ts`, `startMarkupPrune`, la arranca `PageEditor.tsx`): con la página
editable (que ya exige la página entera bajada), los permisos conocidos, fuera de la vista de una versión y **con la
página sincronizada** (con red, nada propio sin subir y nada del servidor sin bajar; corrección B2: si no, se olvida lo
contado y los 10 minutos vuelven a empezar), mira al abrir y cada minuto qué fotos anotadas no están en el contenido; anota desde cuándo con el reloj del dispositivo y poda las que llevan 10 minutos
afuera (una transacción con su propio origen, `sd-markup-prune`). Una foto que vuelve (pegar, deshacer) deja de
contar. No se arma junto con la base limpia: la base sale de las filas guardadas con el candado de la página y se salta
si hay algo sin subir; la poda es una edición más que sube después. Lo que otro anotó sin red sobre la foto podada
llega como clave nueva y lo saca la vuelta siguiente; todo sigue en `page_updates`.

**El PDF con el grosor mínimo de la hoja** (auditoría O2 de la entrega 1): `fitPrintedMarkup` (`markupOverlay.ts`)
redibuja cada `svg.sd-markup` de la vista de impresión con el mínimo de 1 px de su caja impresa (no el de la pantalla,
que en un teléfono engrosaba los trazos finos en papel), y dibuja también las fotos que en pantalla no tenían dibujo
porque la imagen no había cargado. Es una línea en `printView.ts`, solo para la vista que se imprime.

**Pruebas:** `markupEdit.test.ts` (herramientas, letras, valores de fábrica, AN7, Shift y Alt, el lápiz, qué hay bajo
el cursor, editar escribe solo lo que cambia), `markupLimits.test.ts`, `markupPrune.test.ts` (los 10 minutos, cortar
y pegar, lo anotado sin red sobre una foto podada, el origen propio, la página a medio bajar), `annotatorKeys.test.ts`
(⌘ en la Mac, Ctrl en Windows), `Annotator.test.tsx` (escribir al soltar, deshacer propio, lo de otro en vivo, **dos
anotando a la vez la misma foto con trazos intercalados, también sin red**, solo lectura, el tope, un mapa malicioso,
el mismo color dos veces, el texto a medio escribir al cerrarse solo), `annotatorCompat.test.ts` (**la versión
publicada v0.117 y tres anteriores abren una página anotada con el anotador, la editan, sacan una foto anotada y el mapa
vuelve intacto; una vieja escribiendo mientras alguien anota sin red**), `markupPrint.test.ts` y el carrete
(`Carrete.test.tsx`: *Annotate* y A solo con permiso y solo en una foto).

**En el navegador** (Chromium sin ventana, dos dispositivos con la misma página lado a lado y el servidor en memoria,
sin login): flecha roja, círculo amarillo y texto, con cero escrituras durante el arrastre; el otro los ve sin recargar
(sincronizando cada 400 ms: el servidor en memoria no tiene Realtime) y los dibuja sobre su foto; `[` `]` y Ctrl+`[`
cambian el grosor sin navegar; mover y deshacer; con la red cortada anota, cuenta 1 cambio sin subir y al volver sube;
dos anotadores abiertos dibujando a la vez (trazos intercalados) terminan con las mismas 10 formas y deshacer en uno
saca solo lo suyo; el carrete abre el anotador con A; quien solo ve la página ve la flecha que dibuja otro, no tiene
*Annotate* y la A no hace nada; la vista de impresión lleva las anotaciones con trazos de 1 px o más y `page.pdf()`
las saca.

**Decisiones tomadas sin Lega** (cambiables): la herramienta de la primera vez es Arrow (después, la última usada); el
relleno de rectángulo y elipse es *Fill* con trazo y relleno al 40 % (el 0 % de FrameRev no se vería); el texto
guarda siempre su caja (con 10 % de holgura, para que otra letra no lo corte) y *Background* le pone fondo con tinta
automática y esquinas de 12; el anotador no suma una entrada al historial del navegador (cada forma ya está guardada y
un texto a medio escribir se guarda al cerrarse solo); sin nada de la foto en el dispositivo, *Annotate* abre el
anotador con el aviso en vez de estar apagado (saberlo antes pide preguntar a la cola por cada foto elegida); lo nuevo
se dibuja adentro de la foto; `[` `]` toman lo elegido con el cursor en cualquier parte de su caja, no solo en sus
tiradores.

**Falta (Lega, con una Mac y sesión real):** que ⌘[ y ⌘] en Safari y Chrome cambien el grosor y no vayan "atrás"; la
poda a los 10 minutos con la base limpia real; el anotador con una foto real del Drive (portero) y sin red con la
miniatura. **Para publicar:** `workspace_settings.min_app_version` tiene que estar en 0.116 o más (AN10: la versión que
dibuja las anotaciones); esta entrega no suma tipos de bloque ni propiedades, así que no hace falta subirla a esta.

### Correcciones de la auditoría de la entrega 2 (2026-10-02)

Auditoría independiente: **no aprobado**, con dos bloqueantes de arreglo chico. Lo que pedía y dónde quedó:

| Hallazgo | Corrección |
|---|---|
| **B1** Dos que anotan por primera vez la misma foto a la vez, uno con el original y otro con la miniatura (sin red): el marco salía de lo que se veía, gana uno, y las formas del otro quedaban corridas y 2,5 veces más chicas | El marco de la primera forma es la medida del archivo (`MediaQueue.dimensions`: registro del dispositivo o la base) o la del original cargado; nunca la de la vista previa. Sin medida, no se crea nada (con aviso). Pruebas: dos anotadores sin red, uno con la miniatura, terminan con cada forma donde se dibujó (falla con el código anterior); sin medida no se escribe nada; la medida del registro sin red |
| **B2** La poda corría sin red: un dispositivo sin red podaba las anotaciones de una foto que otro había vuelto a poner (mover, deshacer, cortar y pegar) | `startMarkupPrune` cuenta y poda solo con la página sincronizada (con red, nada sin subir ni sin bajar) y olvida lo contado si deja de estarlo. Pruebas con el editor de verdad: el caso de la auditoría queda con la foto y sus anotaciones; con red poda a los 10 minutos y un corte en el medio reinicia la cuenta; las compuertas (editar, permisos conocidos, historial) |
| O1 La prueba del peso fallaba al azar (4 de 25: el `clientID` al azar cambiaba la cuenta) | `clientID` fijo al medir (12 de 12) |
| O3 Ctrl+[ sin prueba que caiga | Prueba de que se frena (`defaultPrevented`) y de que una letra en el campo del grosor no cambia la herramienta |
| O5 Un texto que otro borra mientras se edita se perdía | Se vuelve a crear con lo escrito, en el mismo lugar y con su letra (con prueba) |
| O2, O3 (*Annotate* de `PageEditor` sin prueba), O4, O6, O7, O8, O9 | Al roadmap (P.20) |
