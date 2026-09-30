# Importar de Coda

Cómo se pasa un doc de Coda (con sus páginas, subpáginas, fotos y videos) a un proyecto de Shot Docs. Son
dos pasos: un comando que baja el doc a una carpeta de la PC, y la app, que importa esa carpeta.

## 1. Bajar el doc (`scripts/coda-export.mjs`)

```
node scripts/coda-export.mjs "MGTZD" [carpeta] [--refresh]
```

- **Token.** Usa la API de Coda con un token personal (*Account settings → API settings*, conviene de solo
  lectura). Se lee de la variable `CODA_API_TOKEN` o del archivo `%USERPROFILE%\.coda-token` (en Mac,
  `~/.coda-token`). Nunca va en el repo (`.coda-token` y `Coda_Export/` están en `.gitignore`). El token va
  solo a direcciones `https://coda.io/apis/…`: las que devuelve la API (el `href` de una exportación, el
  `nextPageLink` de una lista) se revisan antes de mandarlo, y una que apunta a otro lado corta el comando
  con error. Las bajadas de archivos y del HTML exportado van sin token.
- **Qué baja.** Para cada página, `POST /docs/{doc}/pages/{página}/export` en **HTML**: el Markdown de Coda
  descarta las fotos pegadas en la página. Cada foto, video o adjunto (`codahosted.io`) se baja a `media/`
  con el nombre de su blob (`bl-….jpg`); una dirección sin blob, con `url-` y un hash de la dirección entera
  (dos direcciones distintas nunca comparten nombre).
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
- **Lo ya bajado no se actualiza.** Como vuelve a usar lo que está en la carpeta, una página que cambió en
  Coda después de bajarla queda como estaba. `--refresh` vuelve a pedir el HTML de todas las páginas (los
  archivos no: un blob de Coda es siempre el mismo archivo); borrar la carpeta también sirve.
- La misma foto usada en dos páginas se baja una vez, pero en la app entra una vez por página.
- Una página que no es texto (una página embebida o sincronizada de otro doc) no se exporta: queda anotada en
  `problems` del manifest y en la app entra vacía.

## 2. Importar la carpeta (la app)

Selector de proyectos → **Import from Coda…** (quien puede crear proyectos). Se elige la carpeta y todo entra
a un **proyecto nuevo**. El código está en `src/import/` y el diálogo en `src/ui/ImportCodaDialog.tsx`.

- **De entrada** el diálogo dice lo que impide importar, antes de elegir nada: con el Drive sin conectar (sin
  portero) las fotos no tendrían adónde ir; en el iPad y el iPhone Safari no elige carpetas enteras (hay que
  importar desde una computadora; después el proyecto se sincroniza).
- **Al elegir la carpeta** se revisa el manifest (ver abajo) y se muestran las páginas, los archivos y cuánto
  pesan, con el espacio que el navegador le deja a la app (`navigator.storage.estimate`): los archivos quedan
  en el dispositivo hasta que se suben, y si no entran lo avisa.
- **Mientras importa**: "Página 3 de 35: <título>", y la app pide confirmación antes de cerrarse o recargarse
  (el mismo `beforeunload` que cuida lo que no llegó a IndexedDB, en `Workspace.tsx`) y no deja cambiar de
  workspace. Entre página y página le da un respiro al navegador (`setTimeout(0)`), así el progreso se dibuja.
- **El estado vive afuera del diálogo** (`src/import/importJob.ts`, uno por workspace abierto) y el diálogo lo
  dibuja el Shell (`ImportCodaHost`), no el selector de proyectos: si el selector se desmonta (se cierra la
  barra lateral en el celular), la importación y su resultado siguen a la vista.
- **Al terminar**: cuántas páginas y archivos, la lista de lo que no se pudo traer y, aparte, lo que anotó el
  comando al bajar el doc (`manifest.problems`).

Va por los mismos caminos que usa la app al escribir, así que funciona sin red y lo guardado en el
dispositivo se sube solo. Una página que falla (un archivo que no se puede leer, por ejemplo) queda creada y
anotada en la lista del final, y las demás siguen:

1. **Páginas**: `tree.create(padre, título, proyecto)`, en el orden del árbol (cada padre antes que sus hijas,
   las hermanas en su orden de Coda).
2. **Archivos**: `media.add(página, archivo)`, lo mismo que soltar una foto en el editor. Quedan en el
   dispositivo y la sincronización los sube al Drive por el portero, a
   `LGA_ShotDocs/<Proyecto>/<día de la importación>`. La app tiene que quedar abierta hasta que el estado
   diga que se subió todo.
3. **Contenido**: el HTML se convierte en bloques (`src/import/codaHtml.ts`) y se escribe en el documento de
   la página con un editor sin pantalla, sobre la estructura inicial de siempre.

### Si se corta: seguir donde quedó

Mientras importa, la app anota en el dispositivo (`meta` de la base local, clave `codaImport:<id del doc>`;
la tabla ya existía, la base no cambia) qué página de la app es cada página de Coda, cuáles ya tienen su
contenido escrito y la dirección `sdmedia://` de cada archivo apenas queda guardado. Si la importación se
corta (se cerró la app, se cortó la luz), al volver a elegir la misma carpeta el diálogo lo dice ("no
terminó: 12 de 35 páginas") y ofrece **Seguir**, que continúa en el mismo proyecto: no crea otra vez las
páginas ya creadas, saltea las terminadas y usa los archivos ya guardados en vez de guardarlos (y subirlos al
Drive) de nuevo. **Importar a un proyecto nuevo** empieza de cero (el proyecto a medias queda; se puede mandar
a la papelera). La anotación se borra al terminar.

Si el contenido de una página no se puede escribir después de guardar sus archivos, queda anotado en la
lista ("3 archivos quedaron guardados pero la página no se pudo escribir"): se suben igual, y al seguir la
importación se ubican en la página. Queda un hueco chico: un archivo guardado justo antes del corte, antes de
anotarlo, se guarda de nuevo al seguir (entra dos veces al Drive).

### El manifest

Sin `pages` (o si no es JSON) es un error claro antes de mostrar nada. Lo que falta en una página toma un
valor por defecto: sin nombre entra como "Untitled", sin orden va por orden de llegada, sin `media` sin
archivos, sin id (o con el id repetido) recibe uno propio. Una página cuyo padre no está en el manifest, o que
forma un círculo con otras (A dentro de B dentro de A), va al primer nivel y queda anotada: ninguna se pierde.

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
- **Una foto adentro de un link** sale del link y queda como foto; el link sigue si tenía texto. Si el link
  apunta al mismo archivo de Coda (Coda envuelve así la foto para abrirla grande), queda solo el texto: si
  no, la foto entraría dos veces.
- **El mismo archivo dos veces en una página** (el mismo blob) se guarda una vez; los dos bloques usan la
  misma dirección.
- **Las marcas** son caracteres de uso privado (U+E000, U+E001). Antes de marcar se sacan del texto y de los
  atributos que trae Coda, así nada escrito se confunde con una marca.
- **Fotos que no están en Coda** (una dirección de otro sitio): no hay archivo que subir. Una `https` queda
  enlazada a su sitio y anotada; cualquier otra (`http`, `data:`, una ruta suelta) se saca y se anota. Vale
  también para las que BlockNote convierte por su cuenta: después de convertir se revisa cada bloque `image`
  que no quedó con `sdmedia://`.
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
- **Una página que no es texto** (embebida o sincronizada de otro doc): entra vacía y queda anotada.
- **Un editor por página.** Cada página se escribe con un editor sin pantalla atado a su documento; la atadura
  (colaboración) se fija al crear el editor, así que no se puede reusar uno para todas. El que convierte el
  HTML sí es uno solo para toda la importación.

## Cómo quedó

- `scripts/coda-export.mjs` y `scripts/lib/codaExport.mjs` (lo que decide sin red: a qué dirección va el
  token, el nombre de cada archivo, las opciones), probado en `scripts/coda-export.test.mjs`.
- `src/import/codaHtml.ts`: la conversión del HTML. `src/import/codaImport.ts`: el manifest, el orden del
  árbol, la importación y su anotación para seguirla. `src/import/importJob.ts`: el estado de la importación
  afuera del diálogo (primera carga, sin lo que pesa).
- `src/ui/ImportCodaDialog.tsx` (se baja aparte, con sus textos en `src/i18n/lazy/importCoda.ts`); la entrada
  del menú (`import.menu`, con su ícono propio) está en la primera carga.

### Correcciones de la auditoría (2026-09-30)

Sobre la primera entrega, una auditoría pidió (con su numeración):

2. **Importación cortada**: quedaba el proyecto a medias y archivos sin usar, y volver a importar duplicaba
   todo en el Drive. Ahora la app avisa antes de cerrarse mientras importa y la importación se sigue donde
   quedó, sin repetir páginas ni archivos (ver "Si se corta"). En vez de escribir primero la página y después
   los archivos (dos escrituras por página), la anotación guarda cada archivo apenas queda guardado: al seguir
   se reusa, y si la página no se pudo escribir queda anotado en la lista.
3. **Textos en inglés** en los errores y la lista del final: todo pasa por `t()`, en castellano e inglés. Sin
   portero, el diálogo lo dice de entrada.
4. **Marcas**: se sacan del texto antes de marcar.
5. **Fotos de otros sitios**: enlazadas si son https (anotadas), afuera si no (anotadas).
6. **Manifest**: revisado al elegir la carpeta; nombre por defecto; padres que faltan y círculos al primer
   nivel, anotados.
7. **Páginas que no son texto**: anotadas; lo que anotó el comando se muestra al final.
8. **Mismo archivo dos veces**: se guarda una vez, también cuando un link de Coda envuelve la misma foto.
9. **Respiro entre páginas** y progreso "Página 1 de N" (antes decía "0 de N"). Reusar el editor que escribe
   no se puede (ver "Lo que no pasa").
10. **Diálogo**: su estado vive afuera y lo dibuja el Shell; peso y espacio libre antes de empezar; mensaje
    en el iPad; ícono propio en el menú.
11. **Comando**: token solo a la API de Coda, `--refresh`, nombres sin choques para direcciones sin blob,
    `.coda-token` y `Coda_Export/` en `.gitignore`.

## Prueba

`src/import/codaImport.test.ts`: la conversión con HTML con la forma del de Coda (sin datos de clientes:
fotos en párrafos, ítems, links, títulos y tablas, videos, párrafos con solo un link, colores, guion) y la
importación entera contra el servidor y el portero en memoria, con un segundo dispositivo que ve las fotos y
un documento que la app abre (sin contenido desconocido y con una sola raíz); una página que falla no corta
el resto. Y cada corrección de la auditoría: una importación cortada que se sigue sin duplicar nada en el
Drive, los textos en castellano, las marcas escritas en el texto, fotos de otros sitios, un manifest con
faltantes y círculos, páginas que no son texto, el mismo archivo dos veces, el respiro entre páginas y el
progreso. `src/ui/importCodaDialog.test.tsx`: el diálogo sin Drive, en el iPad y con el resultado que sigue
ahí después de desmontarlo.
Con MGTZD real (35 páginas, 32 fotos, 28 MB) se probó igual, fuera del repo, el 2026-09-30.
