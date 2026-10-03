# Contraste del texto y el panel de la cuenta

Pedido de Lega del 2026-10-03 (v0.161). Cómo está hoy.

## 1. Qué hace

*Contrast*, en el panel de la cuenta (clic en el nombre), le da al texto del documento con el **color por defecto** una
jerarquía de tres tonos:

| Nivel | Encabezados | Negrita fuera de un encabezado | Texto común |
|---|---|---|---|
| *No contrast* | el de siempre | igual al encabezado | igual al encabezado |
| *Contrast* (de fábrica) | el de siempre | un poco menos blanca o negra | un poco menos que la negrita |
| *More contrast* | el de siempre | más apagada que en *Contrast* | más apagado que en *Contrast* |

- El **texto con un color elegido** (unas letras o un bloque entero, que BlockNote pinta también en sus hijos) no cambia,
  ni la negrita ni los encabezados de adentro: siguen con ese color. Tampoco los links, la cita (gris, también su
  negrita) ni lo borrado que marca el historial con *Show changes*.
- Lo **resaltado** (un color de fondo elegido, en unas letras o en un bloque y sus hijos) queda afuera de la jerarquía:
  su texto y su negrita van con la tinta plena de siempre. En oscuro los fondos de BlockNote son claros o saturados y
  un tono más apagado bajaba de 4,5:1 (rojo 4,64 → 3,20 con *Contrast*; amarillo 1,38 con *More*). Además, en oscuro
  tres fondos (gris, amarillo, naranja) ya no llegaban ni con la tinta plena: ver «Los resaltados en oscuro» (sección 5).
- *No contrast* es **exactamente lo de antes**: las reglas de los encabezados, la negrita y el resaltado no corren
  (`:root:not([data-contrast='none'])`) y el texto común resuelve a `--text`. Medido en Chromium contra `main`, elemento
  por elemento (44 textos, claro y oscuro, página y PDF): cero diferencias.
- La negrita adentro de un encabezado va con el encabezado.
- Vale en la página, en la vista de una versión del historial (usa el mismo editor) y en el PDF y la impresión, que
  siempre usan los tonos del **modo claro** (`.print-view`), también con la app en oscuro.
- No cambia el resto de la interfaz (árbol, menús, diálogos) ni el título de la página, que ya es el tono del encabezado.
- Se guarda como *Appearance*: en las preferencias de la cuenta (`user_settings.prefs.contrast`, `src/prefs.ts`), con la
  copia local del dispositivo, y sigue a la persona en todos sus dispositivos. Una versión anterior de la app no conoce
  la clave: la descarta y, si sube sus preferencias, la borra de la cuenta; los dispositivos con esta versión siguen con
  la que tenían (lo mismo que `language` y `phoneImages`).

**El zip de exportar** lleva la preferencia (v0.165): cada página `.html` sale con `<html data-contrast="…">` y las
reglas de su `style.css` (las mismas de la app) la aplican igual que en el PDF, siempre con los tonos claros. Antes salía
siempre con *Contrast*. Decisión: el PDF ya seguía el nivel de quien exporta, y un zip que sale distinto del PDF de la
misma persona sorprendería; el archivo no es una copia fija para comparar sino la página como la ve quien la exporta.
No lleva la fuente (sigue la normal). `buildZip` toma `options.contrast` o, sin él, `prefs.contrast`. El `index.html` del
zip no lleva texto del documento y no cambia.

## 2. Los tokens

En `src/styles.css`, al principio: un token por modo y por nivel (`--ink-light-*`, `--ink-dark-*`), y tres tonos que
los eligen según `data-contrast` en `<html>` (`--ink-heading`, `--ink-bold`, `--ink-body`). Sin el atributo (antes de
que carguen las preferencias) vale *Contrast*.

Razones de contraste WCAG 2.x (la peor contra los fondos donde va el texto: `--bg` de la página y la hoja, y blanco de
`--surface` y del papel; en oscuro, `#171716` y `#1f1e1c`):

| Token | Valor | Claro: página / blanco | Oscuro: página / superficie |
|---|---|---|---|
| encabezado claro (todos los niveles) | `#1b1a17` | 16,68 / 17,40 | — |
| negrita claro, *Contrast* | `#33312c` | 12,45 / 12,99 | — |
| texto común claro, *Contrast* | `#46433d` | 9,45 / 9,86 | — |
| negrita claro, *More* | `#3a3833` | 11,23 / 11,71 | — |
| texto común claro, *More* | `#5a5750` | 6,91 / 7,21 | — |
| encabezado oscuro (todos los niveles) | `#ece9e2` | — | 14,80 / 13,74 |
| negrita oscuro, *Contrast* | `#dad6cd` | — | 12,37 / 11,49 |
| texto común oscuro, *Contrast* | `#c8c3b8` | — | 10,21 / 9,48 |
| negrita oscuro, *More* | `#cfcac0` | — | 10,99 / 10,20 |
| texto común oscuro, *More* | `#b0aba1` | — | 7,85 / 7,29 |

Por qué estos valores:

- **El encabezado es el `--text` de siempre** (`#1b1a17` / `#ece9e2`): Lega pidió los encabezados como hoy.
- **Los pasos son de tono, no de color:** los grises salen de la misma familia cálida de la paleta (papel y tinta), así
  el texto no se ve azulado ni verdoso al lado de los encabezados.
- **Cada paso baja entre 2 y 4 puntos de razón en *Contrast* y entre 3 y 5,5 en *More*** (el ojo nota menos la misma
  diferencia cerca del negro o del blanco): se nota al leer sin que el texto común parezca deshabilitado. El texto común más apagado (*More*) queda en 6,9:1 en claro y 7,3:1 en oscuro, por
  encima de WCAG AAA (7:1) en oscuro y de AA (4,5:1) en todos.
- **El texto común oscuro de *More* es `#b0aba1` y no algo más bajo** porque el texto de un bloque Script va sobre sus
  marcas (lugar, día, noche, hora dorada): sobre la marca de día en oscuro (`#4a3e16`), `#b0aba1` da 4,61:1; un tono
  más apagado (`#aca79d`) daba 4,40:1. En claro, el peor caso sobre una marca es 5,39:1.
- El texto común queda siempre más marcado que `--muted` de la interfaz (`#5e5a52` / `#a29d93`, lo apagado de los
  menús y los rótulos), también en *More*.

`src/contrast.test.ts` resuelve los tokens con la cascada (especificidad y orden de las reglas, también la de
`.print-view` adentro de `:root`) para cada modo, nivel y destino, y comprueba 4,5:1 contra los fondos y las marcas de
Script, el orden encabezado > negrita > texto común, que *More* marca más que *Contrast*, que *No contrast* es un solo
tono (y que toda regla que pinta con el tono del encabezado o de la negrita está apagada con *No contrast*), que sobre
los nueve resaltados de BlockNote, en claro y oscuro, el texto da lo mismo que antes, y que el PDF tiene los del modo
claro.

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
