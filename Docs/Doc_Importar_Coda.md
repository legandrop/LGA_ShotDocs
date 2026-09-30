# Importar de Coda

Cómo se pasa un doc de Coda (con sus páginas, subpáginas, fotos y videos) a un proyecto de Shot Docs. Son
dos pasos: un comando que baja el doc a una carpeta de la PC, y la app, que importa esa carpeta.

## 1. Bajar el doc (`scripts/coda-export.mjs`)

```
node scripts/coda-export.mjs "MGTZD"
```

- **Token.** Usa la API de Coda con un token personal (*Account settings → API settings*, conviene de solo
  lectura). Se lee de la variable `CODA_API_TOKEN` o del archivo `%USERPROFILE%\.coda-token` (en Mac,
  `~/.coda-token`). Nunca va en el repo.
- **Qué baja.** Para cada página, `POST /docs/{doc}/pages/{página}/export` en **HTML**: el Markdown de Coda
  descarta las fotos pegadas en la página. Cada foto, video o adjunto (`codahosted.io`) se baja a `media/`
  con el nombre de su blob (`bl-….jpg`).
- **Qué deja** (por defecto en `%USERPROFILE%\Coda_Export\<doc>`):
  - `manifest.json`: el árbol (padre y orden de cada página, título, subtítulo, ícono) y qué archivo es cada
    dirección de Coda.
  - `pages/<n>_<id>.html`: el HTML tal cual lo da Coda; `pages/<n>_<id>.local.html`, el mismo con las fotos
    apuntando a `media/` (para mirarlo en el navegador).
  - `media/`: los archivos.
- **Se puede cortar y volver a correr**: lo que ya está en la carpeta no se vuelve a pedir. Cada archivo se
  escribe primero como `.part` y se renombra al terminar (y se compara con el tamaño que dijo el servidor),
  así un corte nunca deja uno a medias que la corrida siguiente dé por bueno. Los archivos se bajan en
  streaming (un video grande no pasa entero por la memoria). Ante un corte de red, un 429 (límite de pedidos)
  o un error del servidor, espera y reintenta hasta 8 veces. Si algo igual falla, termina con error y lo lista:
  se vuelve a correr y trae solo lo que falta.
- La misma foto usada en dos páginas se baja una vez, pero en la app entra una vez por página.
- Una página que no es texto (una página embebida o sincronizada de otro doc) no se exporta: queda anotada en
  `problems` del manifest y en la app entra vacía.

## 2. Importar la carpeta (la app)

Selector de proyectos → **Import from Coda…** (quien puede crear proyectos). Se elige la carpeta y todo entra
a un **proyecto nuevo**; con el Drive sin conectar no empieza, porque las fotos no tendrían adónde ir. El
código está en `src/import/` y el diálogo en `src/ui/ImportCodaDialog.tsx`.

Va por los mismos caminos que usa la app al escribir, así que funciona sin red y nada se pierde si se corta.
Una página que falla (un archivo que no se puede leer, por ejemplo) queda creada y anotada en la lista del
final, y las demás siguen:

1. **Páginas**: `tree.create(padre, título, proyecto)`, en el orden del árbol (cada padre antes que sus hijas,
   las hermanas en su orden de Coda).
2. **Archivos**: `media.add(página, archivo)`, lo mismo que soltar una foto en el editor. Quedan en el
   dispositivo y la sincronización los sube al Drive por el portero, a
   `LGA_ShotDocs/<Proyecto>/<día de la importación>`. La app tiene que quedar abierta hasta que el estado
   diga que se subió todo.
3. **Contenido**: el HTML se convierte en bloques (`src/import/codaHtml.ts`) y se escribe en el documento de
   la página con un editor sin pantalla, sobre la estructura inicial de siempre.

### La conversión

BlockNote convierte texto, títulos, listas, checklists, tablas, citas y código. Lo demás lo resuelve
`codaHtml.ts`:

- **Fotos.** BlockNote descarta una `<img>` adentro de un párrafo o de un ítem de lista (Coda las pone
  siempre así) y todo `<video>`. Antes de convertir, cada archivo se cambia por una marca de texto y después
  cada marca pasa a ser un bloque `image` con su `sdmedia://`. Una foto adentro de un ítem queda adentro del
  ítem (con el texto que sigue), como se veía en Coda; una en una tabla va debajo de la tabla.
- **Ancho.** El ancho con que se veía en Coda pasa a `previewWidth` si es menor que 700 px; más ancho, la foto
  va sin ancho propio (a lo ancho de la página).
- **Nombre.** El de Coda si es un nombre de archivo; si Coda solo sabe el blob, `bl-….<ext>`.
- **Colores.** Coda escribe `rgb(...)`; se pasa al color con nombre más parecido del editor (por tono). El
  gris del texto de cuerpo de Coda se saca.
- **Guion.** Los párrafos debajo de un título "Guion" (o "Script") pasan a texto Script; los fondos que en
  Coda se ponían a mano en INT/EXT y DÍA/NOCHE se sacan, porque Script ya los marca.
- **Una foto adentro de un link** sale del link y queda como foto; el link sigue si tenía texto.
- **Videos de Coda** (`<video><source>`): igual que una foto, un bloque `image` con su `sdmedia://`.
- **Red de seguridad.** Una foto ya guardada que la conversión no llegó a ubicar va al final de la página y
  queda anotada: nunca se pierde en silencio.
- **Videos embebidos** (YouTube, Vimeo): quedan como link.
- **Subtítulo** de la página de Coda: un párrafo en cursiva arriba de todo.

### Lo que no pasa

- **El ícono de la página** de Coda (en MGTZD, el estado de cada escena: ok, importante, cancelada): queda en
  el manifest pero la app todavía no muestra íconos de página.
- **Tablas y vistas de Coda** (bases de datos): la API las da aparte (`/tables`); falta el paso para docs con
  tablas.
- **Una importación a medias** no se retoma: se manda el proyecto a la papelera y se importa de nuevo.

## Prueba

`src/import/codaImport.test.ts`: la conversión con HTML con la forma del de Coda (sin datos de clientes:
fotos en párrafos, ítems, links, títulos y tablas, videos, párrafos con solo un link, colores, guion) y la
importación entera contra el servidor y el portero en memoria, con un segundo dispositivo que ve las fotos y
un documento que la app abre (sin contenido desconocido y con una sola raíz); una página que falla no corta
el resto.
Con MGTZD real (35 páginas, 32 fotos, 28 MB) se probó igual, fuera del repo, el 2026-09-30.
