# Contraste del texto y el panel de la cuenta

Pedido de Lega del 2026-10-03 (v0.0XX). Cómo está hoy.

## 1. Qué hace

*Contrast*, en el panel de la cuenta (clic en el nombre), le da al texto del documento con el **color por defecto** una
jerarquía de tres tonos:

| Nivel | Encabezados | Negrita fuera de un encabezado | Texto común |
|---|---|---|---|
| *No contrast* | el de siempre | igual al encabezado | igual al encabezado |
| *Contrast* (de fábrica) | el de siempre | un poco menos blanca o negra | un poco menos que la negrita |
| *More contrast* | el de siempre | más apagada que en *Contrast* | más apagado que en *Contrast* |

- El **texto con un color elegido** (unas letras o un bloque entero, que BlockNote pinta también en sus hijos) no cambia,
  ni la negrita ni los encabezados de adentro: siguen con ese color. Tampoco los links ni lo borrado que marca el
  historial con *Show changes*.
- La negrita adentro de un encabezado va con el encabezado.
- Vale en la página, en la vista de una versión del historial (usa el mismo editor) y en el PDF y la impresión, que
  siempre usan los tonos del **modo claro** (`.print-view`), también con la app en oscuro.
- No cambia el resto de la interfaz (árbol, menús, diálogos) ni el título de la página, que ya es el tono del encabezado.
- Se guarda como *Appearance*: en las preferencias de la cuenta (`user_settings.prefs.contrast`, `src/prefs.ts`), con la
  copia local del dispositivo, y sigue a la persona en todos sus dispositivos. Una versión anterior de la app no conoce
  la clave: la descarta y, si sube sus preferencias, la borra de la cuenta; los dispositivos con esta versión siguen con
  la que tenían (lo mismo que `language` y `phoneImages`).

**El zip de exportar** no lleva la preferencia (tampoco lleva la fuente): su HTML sale con *Contrast*.

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
tono y que el PDF tiene los del modo claro.

## 3. Cómo se aplica sin tocar los colores elegidos

```css
.bn-container .bn-default-styles { color: var(--ink-body); }
.bn-container .bn-default-styles [data-content-type='heading'] { color: var(--ink-heading); }
.bn-container .bn-default-styles strong { color: var(--ink-bold); }
.bn-container .bn-default-styles [data-content-type='heading'] strong { color: inherit; }
```

Lo que pone su propio color (`[data-style-type='textColor']`, `[data-text-color]`, el `.bn-block:has(...)` con el que
BlockNote pinta un bloque y sus hijos, `a`, `.hist-del`) redefine `--ink-heading` y `--ink-bold` como `currentColor`.
En la propiedad `color`, `currentColor` es el color heredado: así una negrita o un encabezado adentro de algo pintado
siguen con ese color. Medido en Chromium (getComputedStyle y los colores de relleno del PDF con pdf.js): el rojo, el azul,
el verde y el violeta elegidos dan el mismo valor en los tres niveles, en la página, el historial y el PDF.

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
guarda y marca el documento, los rótulos en castellano, el alto del panel) y `src/prefs.test.ts` (de fábrica, valores
desconocidos, guardar y subir, una cuenta sin la clave).
