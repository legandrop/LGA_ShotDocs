# Contraste del texto y escala de encabezados

Actualizado en v0.209. La preferencia conserva sus valores guardados `none`, `contrast` y `more`.

## 1. Qué hace

En el panel de la cuenta, **Normal contrast / Contraste normal** conserva el cuerpo que antes tenía *More contrast*: claro `#5a5750`, oscuro `#b0aba1`. La negrita queda más próxima al encabezado. **More contrast / Más contraste** marca todavía más la jerarquía: apaga algo más el cuerpo y acerca la negrita al encabezado, sin igualarla. **No contrast / Sin contraste** mantiene una sola tinta.

Los encabezados conservan `#1b1a17` en claro y `#ece9e2` en oscuro. Los colores elegidos, los links, las citas y los resaltados conservan sus reglas; el cambio no escribe en el documento. Pantalla e historial usan la misma hoja de estilos. PDF, impresión y páginas HTML del zip usan los tonos claros.

## 2. Tokens y legibilidad

| Tono | Claro | Oscuro |
|---|---|---|
| Encabezado, todos los niveles | `#1b1a17` | `#ece9e2` |
| Negrita, Normal contrast | `#282621` | `#e0ddd5` |
| Cuerpo, Normal contrast | `#5a5750` | `#b0aba1` |
| Negrita, More contrast | `#24231f` | `#e5e2da` |
| Cuerpo, More contrast | `#646058` | `#aaa59b` |

Todos los tonos por defecto llegan a WCAG AA de 4,5:1 contra la página y el papel. En las marcas oscuras de Script, el cuerpo de *More* usa un piso local `#b0aba1` para conservar AA sobre DAY. Un color elegido sigue siendo `currentColor`; la vista de impresión redefine el token con el cuerpo claro. Las marcas y sus fondos no cambian.

## 2.1. H1–H5 y H6 existente

Los menús ofrecen H1–H5. Con texto normal de 16 px, sus tamaños nominales son 32 / 24 / 21 / 18 / 16 px; todos usan peso 700. H1–H4 crecen sobre H5 en pasos progresivos. El incremento de H1 es el menor entre el 100 % del cuerpo y el espacio disponible hasta un píxel por debajo del título de página (D775, v0.272; antes 75 %); H2, H3 y H4 usan respectivamente 2/3, 5/12 y 1/6 de un paso que es el menor entre el 75 % del cuerpo y ese mismo espacio. Así se conserva la jerarquía en una pantalla angosta sin agrandar el título ni reducir H5. Por ejemplo, cuerpo de 18 px y título de 28 px dan 27 / 24 / 21,75 / 19,5 / 18 px. Editorial mantiene su familia serif en H1–H4, con peso 700 sintetizado desde la cara disponible de Instrument Serif. El título de página conserva su tamaño y peso propios, incluido Editorial 400. Pantalla y PDF aplican el límite con su propio tamaño real de título.

H5 y H6 comparten tamaño, fuente heredada del párrafo, peso 700, tracking normal y altura de línea 1,5 con el texto normal en negrita. H6 conserva esquema, importación, contenido, plegado y atajos existentes: solo deja de ofrecerse en los dos menús. No se convierte ni reescribe al abrir.

Las comprobaciones históricas de las siguientes secciones describen la entrega original; los tokens vigentes son los de arriba.
## 3. Cómo se aplica sin tocar los colores elegidos

```css
.bn-container .bn-default-styles { color: var(--ink-body); }
.bn-container .bn-default-styles [data-content-type='heading'] { color: var(--ink-heading); }
.bn-container .bn-default-styles strong { color: var(--ink-bold); }
.bn-container .bn-default-styles [data-content-type='heading'] strong { color: inherit; }
```

Las tres reglas de color (encabezado, negrita, resaltado) van detrás de `:root:not([data-contrast='none'])`.
Lo que pone su propio color (`[data-style-type='textColor']`, `[data-text-color]`, el `.bn-block:has(...)` con el que
BlockNote pinta un bloque y sus hijos, `a`, `blockquote`, `.hist-del`) redefine `--ink-heading` y `--ink-bold` como
`currentColor`. Lo resaltado (`[data-style-type='backgroundColor']`, `[data-background-color]` y su `.bn-block:has(...)`),
salvo que además tenga un color de texto elegido, pinta con `--ink-heading` y pasa ese tono a su negrita.
En la propiedad `color`, `currentColor` es el color heredado: así una negrita o un encabezado adentro de algo pintado
siguen con ese color. Medido en Chromium (getComputedStyle y los colores de relleno del PDF con pdf.js): el rojo, el azul,
el verde y el violeta elegidos, los nueve resaltados y la cita dan el mismo valor en los tres niveles y que en `main`, en
la página, el historial y el PDF. Con *Contrast* y *More* cambian solo los 15 textos con el color por defecto (común,
negrita, listas, itálica, código en línea); todo lo que queda debajo de 4,5:1 es lo mismo que ya lo estaba en `main`
(colores y fondos de la paleta de BlockNote, la cita).

Ningún cambio al esquema del editor ni al documento: es solo CSS y una preferencia.

## 4. El panel de la cuenta

- *Appearance*, *Font* y *Contrast* son solo íconos (*Font*: la muestra «Aa» en cada fuente; *Contrast*: un encabezado y
  dos renglones con la opacidad de cada nivel). El nombre de cada opción va en el tooltip (`data-tip`) y en `aria-label`;
  el rótulo queda a la izquierda en el mismo renglón y los tres selectores tienen el mismo ancho. En castellano, el
  rótulo de *Font* es «Fuente».
- Los demás selectores siguen con su texto, un poco más bajos.
- El panel tiene su propio desplazamiento: su alto máximo es lo que queda en la ventana arriba del botón de la cuenta
  (`accountMaxHeight`, menus.tsx); antes el tope era la ventana entera y en una ventana baja la cabecera quedaba
  afuera por arriba. En 1280 × 600 mide 528 px y se recorre hasta *Sign out*; en el teléfono (375 × 812), 740.
- *Sign out other devices* (y cualquier renglón largo) baja a dos líneas alineado a la izquierda, como los demás.

Pruebas: `src/ui/accountPrefs.test.tsx` (solo íconos con tooltip y `aria-label`, sin `title`, *Contrast* de fábrica, se
guarda y marca el documento, los rótulos en castellano, el alto del panel, y en el CSS el desplazamiento propio y los
renglones a la izquierda) y `src/prefs.test.ts` (de fábrica, valores
desconocidos, guardar y subir, una cuenta sin la clave).

## 5. La paleta de colores (v0.313, D827; antes, los resaltados en oscuro de v0.165)

Los nueve colores de texto y de fondo del editor son de la app, no los de BlockNote. Lega (2026-10-29) migró de Coda,
donde un texto verde sobre un fondo verde se leía, y acá no: en oscuro BlockNote pinta el fondo con el tono del texto
apagado (verde `#6b8b87` sobre `#4d6461`, 1,6:1; rojo `#ec4040` sobre `#be3434`, 1,4:1). Además su «verde» era un gris
azulado (`#4d6461`, matiz 172°), que se veía celeste.

`src/styles.css` redefine las 18 variables `--bn-colors-highlights-<color>-{text,background}` en
`.bn-container[data-color-scheme='light']` y en `[data-color-scheme='dark']`. Cada fondo es un tinte apagado del color
(claro en el modo claro, oscuro en el oscuro) y cada texto, el mismo matiz con la luz justa para leerse en los tres
lugares donde va, todo a 4,5:1 o más (WCAG AA, con margen por el redondeo):

| Color | Claro: texto / fondo | Oscuro: texto / fondo | Texto sobre su fondo (claro · oscuro) |
|---|---|---|---|
| gris | `#64635f` / `#ebeae6` | `#a9a8a3` / `#3b3a37` | 5,00 · 4,78 |
| marrón | `#7d5640` / `#f0e6df` | `#c9a085` / `#4a3628` | 5,21 · 4,79 |
| rojo | `#b82b2b` / `#fbe3e1` | `#f3867e` / `#5e2524` | 5,02 · 4,83 |
| naranja | `#a14e08` / `#fae8d6` | `#ee9a50` / `#5b3716` | 4,87 · 4,68 |
| amarillo | `#836500` / `#faf0c8` | `#e2c04a` / `#514010` | 4,80 · 5,68 |
| verde | `#1a7236` / `#dcf1e1` | `#62c682` / `#1d4a2b` | 5,05 · 4,80 |
| azul | `#1662a8` / `#dde9f8` | `#66acec` / `#1c3c5f` | 5,11 · 4,66 |
| violeta | `#7340b0` / `#ece3f7` | `#b892ec` / `#3f2c60` | 5,47 · 4,80 |
| rosa | `#b0226f` / `#f9e0ec` | `#ea82bd` / `#5b2346` | 5,11 · 4,75 |

- **Un color sobre el fondo del mismo color** (lo que traía Coda): la tabla de arriba.
- **Un color sobre la página** (`--bg` y `--surface` de cada tema): 4,8:1 o más en claro (el amarillo es el más bajo,
  5,26) y 6,2:1 o más en oscuro. El amarillo y el gris de BlockNote en claro no llegaban (`#dfab01`: 1,9:1).
- **El texto por defecto sobre un fondo** (la tinta del encabezado, `#1b1a17` / `#ece9e2`, igual en los tres niveles):
  14:1 o más en claro, 8,2:1 o más en oscuro. Reemplaza el arreglo de v0.165, que oscurecía solo el gris, el amarillo y el
  naranja del oscuro.
- **El verde es verde** (matiz entre 110° y 160°) y el azul, azul (entre 195° y 225°).

El modo claro vale también para el PDF, la impresión y las páginas HTML del zip (la vista de impresión arma siempre el
claro; ninguna regla de la paleta cuelga de `.print-view`). El selector de colores muestra las mismas muestras (usa las
mismas variables). No cambia el documento: se guarda el nombre del color (`green`), así que lo ya escrito y lo importado
de Coda se ven con la paleta nueva, y una versión vieja de la app lo sigue mostrando con la de BlockNote.

Queda sin cambio, a propósito: un texto de un color sobre un fondo de **otro** color (rojo sobre amarillo) es una
combinación que elige la persona, y la cita con un resaltado dentro.

Pruebas: tres en `src/contrast.test.ts` (cada color sobre su fondo, sobre la página y el texto por defecto sobre cada
fondo, a 4,5:1 o más en los dos esquemas y los tres niveles; el matiz del verde y del azul; y que la paleta cuelga solo
del esquema, nunca de `.print-view`).

## 6. Links, botón principal y foco (v0.281, D787)

- Link del texto: el mismo color que el texto que lo rodea (`color: inherit`, D796: el tono del nivel de contraste, el
  de un encabezado o un color elegido; hasta v0.284 era `--text`, más claro que el texto común) y raya `--link-line` de
  1px (#5597a4 en claro, 3,3:1 contra el papel; #218290 en oscuro, 3,7:1); al pasar, la raya en `--accent`. Lo único
  que lo distingue es la raya. Ya no está en la lista de lo que pone su propio color: una negrita dentro de un link va
  con el tono de la negrita.
- Botón principal (`--btn-primary-*`): en claro, tinta rellena (16,7:1); en oscuro, delineado en `--accent` con texto
  `--accent-text` (9,6:1). Las acciones de tarjeta van en gris elevado (`--seg-active`).
- Anillo de foco global: `--accent-text` (#0c6a7d en claro, 5,97:1), porque `--accent` daba 2,8:1 (un control pide 3:1).
- `src/contrast.test.ts` comprueba la raya y el texto del botón delineado.
