# Contraste del texto y escala de encabezados

Actualizado en v0.201. La preferencia conserva sus valores guardados `none`, `contrast` y `more`.

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

Los menús ofrecen H1–H5. Con texto normal de 16 px, sus tamaños son 25,6 / 22,4 / 19,2 / 17,6 / 16 px; todos usan peso 700. Los tres tamaños de texto conservan esas proporciones. Editorial mantiene su familia serif en H1–H4, con peso 700 sintetizado desde la cara disponible de Instrument Serif. El título de página conserva su tamaño y peso propios, incluido Editorial 400.

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

## 5. Los resaltados en oscuro (v0.165)

El texto por defecto sobre un resaltado va con la tinta plena del encabezado en los tres niveles (`#ece9e2` en oscuro).
Con los fondos de BlockNote tres no llegaban a 4,5:1; medido en Chromium sobre la página real (el texto «fondo …» de cada
color) y calculado con WCAG 2.x:

| Resaltado (oscuro) | Fondo de BlockNote | Razón antes | Fondo ahora | Razón ahora |
|---|---|---|---|---|
| gris | `#9b9a97` | 2,32 | `#676663` | 4,74 |
| amarillo | `#b58b00` | 2,60 | `#806200` | 4,73 |
| naranja | `#b7600a` | 3,69 | `#9d5209` | 4,75 |

Los otros seis (marrón 6,92; rojo 4,64; verde 5,23; azul 4,68; violeta 6,02; rosa 5,47) ya llegaban y no se tocan. Cada
tono nuevo es el de BlockNote con **la misma tonalidad y saturación y menos luz** (HSL), buscando el más claro que pase
4,5:1 con margen (4,7 en vez de 4,5 por el redondeo), así el gris sigue gris, el amarillo mostaza y el naranja anaranjado, y
cada uno se distingue de la página (3,1:1 contra `#171716`). El cambio está en `src/styles.css`
(`.bn-container[data-color-scheme='dark']` redefine `--bn-colors-highlights-{gray,yellow,orange}-background`): vale en los
tres niveles de contraste (el texto resaltado no depende del nivel) y **solo en el esquema oscuro**: el modo claro y el PDF
(que arma siempre el claro) conservan los fondos de BlockNote. También cambia el color de esas muestras en el selector de
colores del modo oscuro (usa las mismas variables).

Queda sin cambio, a propósito: un texto con un color elegido **y** un resaltado a la vez (rojo sobre amarillo: 1,24 antes y
1,47 ahora en oscuro; 3,84 en claro) es una combinación que elige la persona, y la cita con un resaltado dentro (1,48), que
ya estaba así en `main`. Pruebas: dos en `src/contrast.test.ts` (los nueve resaltados de BlockNote en oscuro a 4,5:1 o más
con los tres niveles, solo esos tres tocados, y que ninguna regla de resaltados cuelga del modo claro ni de `.print-view`).
