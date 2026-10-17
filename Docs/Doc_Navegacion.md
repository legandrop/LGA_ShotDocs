# Atrás y adelante adentro de la app (v0.259)

Pedido de Lega (2026-10-17): botones ‹ › para volver a las páginas anteriores y, después de volver, ir otra vez a las
siguientes. En la app instalada (escritorio y iPhone) no hay botones del navegador. Decisiones D738 a D743
([Doc_Decisiones.md](Doc_Decisiones.md)).

## Qué ve el usuario

- ‹ y › en la barra de arriba, a la izquierda del breadcrumb, como en un navegador o en Notion (`src/ui/NavButtons.tsx`).
  En el teléfono van después del botón de menú. También en la página de práctica (`PracticeView.tsx`).
- Apagados (deshabilitados) cuando no hay a dónde ir **sin salir de la app**.
- Atajos (`src/ui/shortcuts.ts`, `navBack` y `navForward`): **Alt+←** y **Alt+→** en Windows y Linux; **⌘[** y **⌘]**
  en la Mac. Tooltip «**atajo**: back / forward» (D226); en táctil, sin tooltip.
- Entrada de la ayuda `navButtons` (sección *Pages*).

## Cómo sabe la app si hay atrás o adelante (`src/navHistory.ts`)

El navegador no dice si la entrada de atrás es de la app o del sitio de antes. La app lleva su registro:

- `installNavHistory()` (en `main.tsx`, antes de cualquier `replaceState`) envuelve `history.pushState` y
  `history.replaceState`. Cada entrada lleva en su `state` la marca `sdNav = { s, i }`: el tramo y la posición. Un
  `replaceState(null, …)` conserva la marca; un `state` propio (el del carrete) se conserva entero.
- **Tramo:** empieza cada vez que la app arranca en una entrada sin marca (un link de afuera, una dirección escrita).
  Atrás vale con `i > 0`: la entrada de atrás es la `i - 1` del mismo tramo. Adelante vale con `i < max`.
- `max` y la posición de ahora van a `sessionStorage` (`shotdocs.navHistory`, por pestaña). Al **recargar** se
  conservan atrás y adelante. Al volver con atrás a un documento del tramo después de salir a otro sitio, adelante
  llega solo hasta donde se salió. Un tramo viejo, o una página restaurada de la caché del navegador, deja adelante
  apagado: ante la duda, apagado.
- Un link con `#` dentro de la página suma una posición, como un `pushState`.
- **Capas:** el carrete y «Show me» de la recorrida suman una entrada con `overlayState(…)`. Atrás de la barra las
  cierra igual que el del navegador; al volver de una, lo de adelante se olvida (› no reabre un carrete cerrado).
  Durante «Show me» el bloqueador de la recorrida tapa la barra: `src/tutorial/ShowMeBack.tsx` pone una copia del ‹
  encima, en el mismo lugar, que llama a `goBack` y termina el paso al volver a la página. Solo si el ‹ de verdad se
  vería ahí: no con el cajón abierto ni si su lugar se cruza con el globito o la barra lateral. Se vuelve a medir con
  `ResizeObserver` (barra y globito), al cambiar la ventana, al terminar una transición (el cajón) y en cada dibujo
  del paso. Recorridos los 18 «Show me» de la ayuda a 375 y 1440 px: la copia nunca pisa el globito ni el cajón.
- Después de un atrás o adelante, otro no se acepta hasta que llegó su vuelta y pasaron 500 ms desde el clic (D742):
  un doble clic va una sola página.

## Atajos y el editor

- Ni BlockNote ni Tiptap usan ⌘[ / ⌘] ni Alt+← / Alt+→ (lo revisa `shortcuts.test.ts` contra el editor real). ⌘← y
  ⌘→ no se usan: en la Mac mueven el cursor al principio y al final del renglón.
- El atajo se escucha en `window`, en burbuja: lo que ya tomó otro (el carrete mueve de foto con ←, el anotador usa
  ⌘[ para el grosor) no llega. Con una capa abierta (`aria-modal`, el carrete, un `dialog`) no actúa.
- Sin a dónde ir dentro de la app, el atajo no se frena: el navegador hace lo suyo, como antes.
- La tecla mantenida va una sola página: las repeticiones (`repeat`) se frenan siempre y no navegan.

## Pruebas

`src/navHistory.test.tsx`: registro, recarga, vuelta desde otro sitio, tramo nuevo, `replaceState`, `#`, doble
clic (dos clics a 150 ms), tecla mantenida, carrete, «Show me», atajos, capas abiertas y los botones.
`src/tutorial/showMeBack.test.tsx`: la copia del ‹ en «Show me» (aparece, cajón abierto, globito encima, vuelve). `src/ui/shortcuts.test.ts`: rótulos por plataforma,
choques por plataforma y las funciones `isNavBackShortcut` / `isNavForwardShortcut`.
