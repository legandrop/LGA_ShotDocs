# Atrás y adelante, tabs y pestañas (v0.259, v0.300)

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

## Tabs (v0.300, D811)

Solo en la app instalada (`isStandalone()`) y fuera del teléfono (más de 760 px): en un navegador, Ctrl/⌘+T, W y Tab son
del navegador y la página no los recibe; ahí se usan sus pestañas (sección siguiente). En una ventana de app instalada
(Chrome, Edge) esas teclas sí llegan a la página.

- **Qué ve el usuario** (`src/ui/TabStrip.tsx`): la barra de tabs arriba de la columna de la página, afuera de lo que se
  desplaza (`.main-col`, que sin tabs es `display: contents` y no cambia nada). Aparece recién con dos tabs. Ctrl/⌘+T
  abre un tab con la página que se ve; Ctrl/⌘+clic o la rueda en una fila del árbol o en un link de la app, y *Open in
  new tab* del menú de página, abren de fondo; Ctrl/⌘+W cierra el de ahora (con uno solo hace lo de siempre: cerrar la
  ventana); Ctrl+Tab / Ctrl+Shift+Tab pasan (⌘⇧] / ⌘⇧[ en la Mac). La rueda sobre un tab lo cierra. Hasta 20 tabs.
- **Un tab por vez** (`src/ui/tabs.ts`): el de ahora es la dirección de la ventana y todo lo demás de la app sigue
  leyendo la ruta como siempre. Los otros son solo `{ history, project, scroll }`.
- **Atrás y adelante por tab:** `navHistory.ts` guarda la dirección de cada posición del tramo (`paths`, también en
  `sessionStorage`; una capa queda sin dirección). Al dejar un tab se guarda `historyStack()` (hasta 20 posiciones); al
  volver, `rebuildHistory()` vuelve al principio del tramo **de este documento** (`docStart`: después de recargar, las
  entradas de antes son de la carga anterior y volver a ellas recargaría la app) y arma ahí las entradas del tab en un
  tramo nuevo, mientras `holdRoute()` del router deja la ruta quieta (las vueltas de en el medio no abren páginas). Así
  los botones, los atajos y los botones del mouse recorren solo ese tab. Con una sola entrada se empuja una copia y se
  vuelve, para cortar lo de adelante del tab anterior. Safari no acepta más de 100 cambios del historial en 30 s:
  pasados 80, el tab vuelve con su página nada más.
- **Proyecto:** el inicio, el mapa y la papelera muestran el proyecto elegido; un tab que estaba ahí lo vuelve a elegir
  (`storeProject`). **Desplazamiento:** vuelve cuando el editor ya está armado (hasta 2 s; un gesto lo corta).
- **Se recuerdan** (`shotdocs.tabs.<base local>`, por workspace y cuenta) en `sessionStorage` (los de esta ventana: con
  dos ventanas de la app, cada una vuelve con los suyos al recargar o al salir de la pausa) y en `localStorage` (los de
  la última ventana usada: los que vuelven al abrir la app). Al abrir, el tab de ahora es el que tiene la dirección de la
  ventana; si ninguno la tiene (se llegó con un link), va uno nuevo al principio.
- Un link a otro workspace o con la autoridad de un link público no se abre en un tab (`appPath`): se abre como siempre.

## Varias pestañas del navegador (v0.300, D812)

Escribe una sola pestaña por base local (el lock `lock:<base>` de `services.ts`, de siempre). Lo nuevo es que la que se
usa lo toma sola, por el canal `shotdocs-handoff:<base>`:

1. La pestaña nueva (o la que vuelve a usarse) no consigue el lock: si no es la que se usa (de fondo, o visible sin el
   foco: una ventana al costado que reintenta sola) queda en pausa sin hacer fila; si es, manda `release`
   (`askForHandoff`).
2. La que lo tiene contesta `ack`, pasa a la pantalla de pausa (lo de adentro se desmonta primero), y el efecto de
   arranque se limpia: `shutdown` guarda lo pendiente y suelta el lock. La que pidió lo recibe y arranca.
3. Si la que lo tiene está en algo que no se corta (`blockHandoff` en `Workspace.tsx`: importar, reemplazar en el
   proyecto, subir una carpeta, un comentario a medio escribir) contesta `refuse`: aparece *Take over* como antes.
4. Sin respuesta en 3 s aparece *Take over* (puede estar ocupada, con su `refuse` todavía sin salir); sin respuesta en
   15 s está congelada o colgada y se le saca el lock (`steal`): lo suyo ya está en el dispositivo (docs.ts lo escribe
   al instante). Contestó y no soltó en 15 s: *Take over*. Cortada a mitad del arranque, suelta el lock recién cuando el
   arranque frena; sin proyectos («No projects yet») suelta el lock y deja de contestar.
5. La pestaña en pausa («Open in another tab») retoma sola con el foco, un toque o una tecla, y pide el control de vuelta.

Medido en el servidor de desarrollo (2026-10-27, VLLF): la otra copia tomó el control y mostró su página en ~0,8 s;
volver a la primera, ~0,2 s. Arreglado de paso: después de *Take over* la pestaña quedaba también en la fila del lock y,
al soltarlo, la fila se lo volvía a dar y no lo soltaba nunca (`acquireTabLock`, `inLine`).

## Pruebas

`src/navHistory.test.tsx`: registro, recarga, vuelta desde otro sitio, tramo nuevo, `replaceState`, `#`, doble
clic (dos clics a 150 ms), tecla mantenida, carrete, «Show me», atajos, capas abiertas y los botones.
`src/tutorial/showMeBack.test.tsx`: la copia del ‹ en «Show me» (aparece, cajón abierto, globito encima, vuelve). `src/ui/shortcuts.test.ts`: rótulos por plataforma,
choques por plataforma y las funciones `isNavBackShortcut` / `isNavForwardShortcut`.
`src/ui/tabs.test.tsx`: el historial de cada tab (atrás y adelante recorren solo sus páginas), abrir de fondo, cerrar el
de ahora, el proyecto de un tab que no está en una página, lo guardado que vuelve y lo guardado roto.
`src/handoff.test.ts`: el traspaso entre pestañas (suelta, dice que no, congelada, lenta, respuestas para otra).
