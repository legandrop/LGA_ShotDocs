# Exportar una página o un proyecto entero (P.22)

**Estado: entregas 0 (v0.115), 1 (v0.122: el PDF de una rama o de un proyecto), 2 (v0.129: el zip), 1b (v0.134: los
cambios de Lega al PDF, D84, D85 y D88: fotos en resolución completa, el PDF en partes y la lista de las que fallaron)
y 3 (v0.135: volver a Shot Docs desde el zip, con su migración sin aplicar) hechas; la 4, pendiente** (roadmap P.22;
pedido de Lega del 2026-10-02). Se diseñó contra `main` v0.108. Cómo quedaron, al final:
"Cómo quedó la entrega 0" (el editor de exportación medido con 300 páginas), "Cómo quedó la entrega 1" (el PDF, medido
con la impresión real de Chrome y Edge) y "Cómo quedó la entrega 2" (el zip, abierto con `file://` en Chromium y
Firefox), "Cómo quedó la entrega 1b" (las fotos originales y las partes, medido con `page.pdf`) y "Cómo quedó la
entrega 3" (volver, con las decisiones EX16 a EX22, tomadas sin Lega). **Cambiado por Lega
(2026-10-02):** el PDF lleva las fotos como se tomaron, en resolución completa, con *Smaller file* para achicarlas
(D85); si no entra en un PDF del dispositivo, sale en varios por páginas enteras (D84, en vez de ofrecer ramas); y al
terminar lista las páginas que fallaron con su link y *Export again* (D88). El zip lo exportan solo el dueño y los admins (D60), nunca desde un
teléfono o una tableta (D63), y el `.md` lleva rutas relativas que cualquier visor de Markdown abre (D57). Las decisiones EX1 a EX15 (sección 11) son propuestas con la recomendación tomada: Lega no estaba y quedan a
confirmar. Lo medido está en un prototipo fuera del repo ("Cómo se midió", al final). **Auditado el 2026-10-02
("aprobado con condiciones") y corregido:** los dos bloqueantes (ningún correo en el zip, la vista JPEG en el HTML) y
las doce observaciones están aplicados en el texto; la tabla está en "Correcciones de la auditoría", al final.

## En corto

- **El pedido.** Exportar una página (con lo de adentro) o un proyecto entero, como PDF y/o como zip con las páginas y
  las fotos, para **entregarle al cliente** (el reporte de rodaje de una película) o **archivar un proyecto terminado**.
- **Dos salidas, cada una con su propósito (EX1):**
  - **PDF para entregar:** un solo PDF con toda la rama en el orden del árbol, con un índice al principio que dice en
    qué hoja empieza cada página (EX2). Cada página sale con su hoja (A4, A5, Carta…) y los mismos cortes que marca la
    pantalla: es la impresión de la fase 4 (`Doc_Hojas_PDF.md`), repetida página por página en una sola vista. Sin
    comentarios por defecto.
  - **Zip para archivar:** una carpeta por página con su `.html` (se abre en cualquier navegador, sin red, con una
    **vista JPEG** de cada foto que lleva al original: un HEIC del iPhone no se ve en Chrome ni en Firefox), su `.md`
    (texto plano para buscar y para backups, D-03), los originales de sus fotos y archivos bajados del Drive, los
    comentarios (con nombres, **nunca correos**), y una carpeta `_shotdocs/` con los bloques en JSON para **volver a
    Shot Docs** (EX4, EX5, EX8).
    Se arma igual que *Download all* de una carpeta (`Doc_Carpetas.md`, D24): sin comprimir, con Zip64, escrito a
    medida que llega en Chrome y Edge de computadora, en memoria con tope en Safari, Firefox y el teléfono.
- **Volver (EX6):** *Import Shot Docs archive…* en el selector de proyectos crea un **proyecto nuevo** con las
  páginas, el orden, los formatos de hoja, los bloques tal cual (Script, saltos de hoja, fotos en línea, fotos en las
  celdas, preguntas), los comentarios con su autor y su fecha, y los archivos subidos al Drive del workspace donde se
  importa. Nunca pisa un proyecto que existe. No vuelven el historial, la papelera ni los permisos.
- **Quién exporta (EX7):** quien **ve** (nivel 1 o más, también los invitados), y sale **exactamente lo que ve**: su
  rama, nunca lo de arriba ni lo del costado; nunca lo que está en la papelera ni lo borrado (D14). Ver ya incluye bajar
  los originales (`Plan_Workspaces.md`, sección 4): exportar no abre nada nuevo en la base ni en el portero.
- **Lo borrado no sale nunca porque no se exporta el documento Yjs** (EX5): se exportan los bloques que se ven
  (`yXmlFragmentToBlocks`), sin lápidas. Un editor que exporta tampoco se lleva lo que escribió y borró.
- **Medido en Chromium** (prototipo): un PDF con hojas A4, A5 horizontal y Carta mezcladas sale con cada hoja de su
  tamaño, y los links del índice quedan como links internos del PDF (600 de 600). Un árbol de 300 páginas con 10 fotos
  de 480 px cada una: 506 hojas, 43 MB, 0,8 s para generar el PDF ya armada la vista (1,5 s en la repetición de la
  auditoría; armar y decodificar las 3000 fotos, unos 10 s aparte). Medido con `page.pdf`, no con el diálogo real.
- **Sin red (EX13):** el texto de todo lo que la persona ve ya está en el dispositivo (`Doc_Buscar.md`, sección 1), así
  que el PDF y el zip se arman sin red con la mejor foto que haya en el dispositivo; lo que falta se dice antes de
  empezar y queda en `MISSING_FILES.txt`.
- **UI (EX14):** *Export…* en el menú de la página (esta página, o con las de adentro) y *Export project…* en el menú
  de cada proyecto del selector (también en los archivados). *Export PDF / Print* y Ctrl/⌘+P siguen como están.
- **Entregas:** 0 (el editor de exportación medido con un proyecto grande), 1 (PDF de una rama o de un proyecto), 2
  (zip), 3 (volver a Shot Docs, con una migración chica para los comentarios), 4 (después: carpetas de Drive, reusar
  archivos sin volver a subirlos, el link público).

**En términos simples:** el menú de la página y el del proyecto suman *Export…*, que ofrece dos cosas. Un **PDF**
prolijo para mandarle al cliente: todas las páginas en orden, cada una en su tamaño de hoja, con un índice al principio
donde se puede tocar cada título y saltar a esa página. Y un **zip** para guardar el proyecto terminado: adentro hay una
carpeta por página, con la página para abrir en el navegador como se ve en la app, el texto suelto, las fotos y los
archivos originales y los comentarios. Ese zip, además, se puede volver a meter en Shot Docs y queda un proyecto igual
al que se exportó. Quien exporta se lleva solo lo que puede ver en la app, nunca lo que se borró ni lo que está en la
papelera, y el zip no lleva el correo de nadie del equipo.

## Qué se pide

Lega, 2026-10-02: exportar una página o un proyecto entero (PDF y/o zip con páginas y fotos) para entregar al cliente
o archivar un proyecto terminado.

Dos casos que guían todo el diseño:

1. **Entregar.** Termina el rodaje y hay que mandarle al cliente el reporte: 40 páginas de escenas con fotos de set,
   notas y planillas. El cliente quiere un archivo que se abra en cualquier lado y se pueda imprimir: un PDF.
2. **Archivar.** Un proyecto terminado (ERSO: unas 2459 fotos y archivos, 5,7 GB en el Drive) se quiere guardar fuera
   de la app, completo, con los originales, y poder volver a abrirlo en Shot Docs dentro de dos años.

## Reglas que no se rompen

1. **Exportar no cambia nada.** Ni el documento (Y.Doc), ni el árbol, ni los comentarios, ni el Drive. Se trabaja
   sobre copias en memoria; un editor de exportación sin colaboración nunca se ata al documento de la página.
2. **Nunca lo de arriba ni lo del costado.** Sale la rama que la persona ve desde la página elegida para abajo (o el
   proyecto, si lo ve entero). El índice y los encabezados empiezan en la raíz de lo exportado.
3. **Nunca lo borrado ni la papelera (D14).** Ni el texto borrado, ni las fotos sacadas, ni las páginas en la papelera,
   ni los comentarios borrados, ni el historial.
4. **Nada nuevo en los permisos.** Lo que se baja pasa por los mismos caminos y permisos de siempre (`pull_page_updates`
   o la base limpia, `list_comments`, `POST /pass` y `/m/` del portero). Ningún permiso, rol ni ruta del portero nuevo.
5. **Volver nunca pisa.** Importar un archivo crea siempre un proyecto nuevo; nada de "restaurar encima".
6. **Nada de tipos de bloque nuevos** ni cambios en el documento: el importador escribe solo bloques del esquema.
7. **Cada workspace es una isla:** se exporta desde el Supabase y el portero del workspace, y se importa al Drive del
   workspace de destino. Ningún servicio central.

## 1. Qué hay hoy y qué se reusa

| Pieza | Dónde | Qué se reusa |
|---|---|---|
| La vista de impresión de una página | `src/ui/printView.ts`, `printPage.ts`, `pagination.ts` (`Doc_Hojas_PDF.md`) | La copia del DOM sin tiradores ni menús, el cálculo de los cortes, los saltos de hoja, el ancho fijo de las fotos, el achique de los originales a 2400 px, la espera de las imágenes, `@page` y `afterprint`. |
| *Download all* de una carpeta | `src/media/folderZip.ts`, `zipWriter.ts`, `crc32.ts`, `zipNames.ts`, `src/ui/FolderDownload.tsx` (`Doc_Carpetas.md`, D24) | El zip sin comprimir con Zip64 y CRC32 en un Worker, los destinos (`showSaveFilePicker`, `showDirectoryPicker`, en memoria con `BlobSink` y su tope), los nombres limpios, `MISSING_FILES.txt`, reintentos con `Range`, el pase vencido, sin red y cancelar. |
| Los pesos de una rama | `src/media/offlinePlan.ts` (`branchPages`, `FileFacts`, `weigh`), `projectSizes.ts` (`Doc_Copias_Locales.md`, `Doc_Peso_Proyectos.md`) | Qué archivos usa una rama, de qué tipo, cuánto pesan y qué está ya en el dispositivo (originales propios, `off:`, `offview:`). |
| Leer una página sin abrirla | `docs.snapshot(pageId)` (`src/sync/docs.ts`), como la búsqueda y la papelera de archivos | El Y.Doc de cada página guardada, con su estado (completa, ilegible, versión más nueva). |
| La importación de Coda | `src/import/codaImport.ts`, `codaComments.ts`, `importJob.ts` (`Doc_Importar_Coda.md`) | El formato inverso: crear las páginas primero y después escribirlas, `media.add`, escribir con un editor sin pantalla, seguir donde quedó (`meta`), los links entre páginas, `import_comment` con autor y fecha. |
| Copiar lo que se ve como Markdown | `src/ui/historyMarks.ts` (`cleanClipboard`, el `text/plain` de copiar en el historial) | La conversión de BlockNote a Markdown con el esquema de la app. |

**No existe todavía:** exportar a Markdown (el doc de hojas lo deja pedido: "el salto tiene que ir como una línea
propia"), un PDF de varias páginas, ni importar algo que no sea de Coda.

## 2. Qué sale

### 2.1 Las dos salidas (EX1)

La ventana *Export* pregunta primero **para qué**, y eso elige los valores por defecto:

| | **PDF** (*To share*) | **Zip** (*To archive*) |
|---|---|---|
| Para | Mandarle al cliente, imprimir | Guardar el proyecto fuera de la app, volver a abrirlo |
| Qué lleva | Las páginas como se ven, con un índice | Cada página como HTML, Markdown y JSON, los originales, los comentarios |
| Comentarios | No (casilla destildada) | Sí (casilla tildada) |
| Fotos | La mejor que haya en el dispositivo, o nítidas pedidas al Drive (casilla) | Los originales del Drive |
| Se vuelve a importar | No | Sí |

Las dos se pueden pedir sobre **esta página**, **esta página y las de adentro** o **el proyecto entero**.

### 2.2 El PDF de una rama o de un proyecto (EX2, EX3)

- **Un solo PDF, por la impresión del navegador** (sin librerías de PDF, como la fase 4): una vista de impresión con
  todas las páginas una detrás de otra, cada una empezando en una hoja nueva, y un solo `window.print()`. El nombre del
  PDF es el título de la raíz y la fecha (`Reporte de rodaje 2026-10-02`).
- **Primero el índice:** el título de la raíz (el nombre del proyecto si se exporta el proyecto; si es una rama, solo el
  título de su página, nunca el del proyecto: regla 2), la fecha, y la lista de páginas con sangría por nivel y **la
  hoja donde empieza cada una**. Cada renglón es un link interno: en el PDF se toca y salta (medido en Chromium: los
  600 links del índice y de las páginas quedan como destinos internos).
- **Los números de hoja son ciertos** porque la app ya sabe cuántas hojas ocupa cada página: es el mismo cálculo que
  pone las marcas en la pantalla. Se pagina primero cada página, después el índice (que sabe cuántos renglones tiene),
  y recién ahí se escriben los números. El PDF no lleva números al pie (los márgenes de `@page` con contenido solo
  andan en Chromium nuevo); el visor de PDF ya muestra el número de cada hoja, que coincide con el del índice.
  **Respaldo:** el número es tan cierto como la coincidencia entre los cortes de la app y los del motor de impresión (los
  bloques más altos que una hoja los parte el navegador). Si la medición de la entrega 1 encuentra un navegador donde no
  coinciden, ahí el índice sale **sin números**, solo con los links internos, que andan igual. La ventana avisa que
  cambiar los márgenes o la escala en el diálogo de imprimir descuadra los números.
- **Cada página con su hoja (EX3).** El formato se hereda por rama (D-08, D-10): una escena en A4 y un desglose en A3
  horizontal en el mismo proyecto. Cada página de la vista lleva una "página con nombre" de CSS
  (`@page sd-a4 { size: 210mm 297mm; margin: 20mm }` y `page: sd-a4` en su contenedor). **Medido en Chromium:** 6
  páginas en A4, A5 horizontal y Carta dieron 9 hojas con los tres tamaños, cada una en el suyo. Una página libre sale
  en A4, como hoy. **Se decide por una lista de navegadores probados, no por `CSS.supports('page', …)`**: que el
  navegador entienda la propiedad (Firefox desde la 110) no prueba que su diálogo respete cada tamaño, y si el PDF sale
  con uno solo no hay cómo enterarse. La lista arranca con Chrome y Edge de computadora, **después de medirlos con
  `window.print()` y *Save as PDF* reales** en la entrega 1 (el prototipo usó `page.pdf`). En los demás, todo sale con
  el formato de la raíz, se vuelve a paginar con ese tamaño (así el índice sigue siendo cierto) y la ventana lo dice
  antes: "This browser prints every page at A4. Chrome or Edge keep each page size." Un navegador entra a la lista
  recién con su medición.
- **Cortes y saltos:** los de la fase 4, página por página. Lo colapsado sale abierto (como el PDF de siempre; "Print
  as shown" sigue siendo de una página sola).
- **Links entre páginas:** a una página que está en el PDF, link interno a su primera hoja; a una que no está (afuera
  de la rama o sin acceso), **el texto visible del link, sin link** (sin `/p/<id>`). Ojo: no es lo que hace la app hoy
  (en la app el texto de un link es contenido y se ve igual, con su dirección); es una regla propia de lo exportado,
  para que no salga ningún id de afuera.
- **Fotos:** como en el PDF de una página, cada foto con su ancho fijo en px (el mismo que en la pantalla) y la mejor
  imagen que hay **en el dispositivo**: el original propio o bajado, la nítida de 2048 (`offview:`), la de la página
  (`view1024:`) o la miniatura. **Toda foto, venga de donde venga, se achica a su ancho impreso a 200 ppp** (como mucho
  2400 px) antes de entrar a la vista, y se suelta la fuente. Medido por la auditoría en Chromium (300 fotos que ocupan
  160 px en la hoja): con fuente de 480 px la vista suma 261 MB y el PDF pesa 6 MB; con 2048 px, 368 MB y 30 MB, cinco
  veces más sin ganar nada en el papel. Con la casilla *Sharp photos* (destildada; tildada si todas las fotos ya están
  nítidas en el dispositivo), las que solo tienen miniatura se piden al Drive y pasan por el mismo achique. Topes en la
  sección 5.
- **Comentarios** (casilla *Comments*, destildada): al final de cada página, cada hilo con el texto del bloque al que
  está anclado (las primeras 80 letras), quién (el nombre, nunca el correo), cuándo, las respuestas y si está resuelto.
  Un hilo cuyo primer comentario se borró y tiene respuestas vivas sale con "(deleted comment)" arriba y las respuestas.
  Las respuestas a las preguntas son hilos: van con la misma casilla.
- **Videos, adjuntos y tarjetas de Drive:** como en el PDF de hoy: el cuadro con su miniatura y el link (al portero
  para lo del workspace; al Drive de afuera para una tarjeta de un link de Drive). Un link al portero en un PDF que se
  le manda a un cliente pide sesión para abrirse: es lo que pasa hoy con el PDF de una página.

### 2.3 El zip (EX4, EX9, EX10, EX11)

Un ejemplo (el proyecto `Reporte ERSO`, exportado el 2026-10-02). **Corregido por la auditoría (O1):** el zip ya no lleva la carpeta `Reporte_ERSO/` de arriba (el Explorador la crea al descomprimir), una rama deja su página raíz arriba de todo, y los nombres se acortan para que ninguna ruta pase 180 caracteres (ver "Correcciones de la auditoría de la entrega 2", al final):

```
Reporte_ERSO/
  index.html                    el árbol con links a cada página, el nombre y la fecha
  style.css                     los estilos de la página (los de la vista de impresión, en claro)
  01_Preproduccion/
    01_Preproduccion.html
    01_Preproduccion.md
    01_Desglose/
      01_Desglose.html
      01_Desglose.md
      Files/
        plano_set.pdf
  02_Rodaje/
    02_Rodaje.html
    02_Rodaje.md
    01_Dia_1/
      01_Dia_1.html
      01_Dia_1.md
      Files/
        IMG_0412.jpg
        IMG_0413.HEIC           el original, como está en el Drive
        clip_001.mov
        _view/
          IMG_0412.jpg          la vista JPEG que muestra el .html (lado 2048 o la miniatura)
          IMG_0413.jpg          la del HEIC: Chrome y Firefox no abren HEIC
          clip_001.jpg          el cuadro del video
  _shotdocs/
    manifest.json               formato, versión de la app, el árbol, los formatos de hoja, los archivos
    pages/<n>.json              los bloques de cada página
    comments.json               los hilos de todas las páginas
  MISSING_FILES.txt             solo si falta algo
```

- **Una carpeta por página**, anidadas como el árbol, con el número de orden adelante (`01_`, `02_`… con los ceros que
  hagan falta para ordenar bien: `001_` con más de 99 hermanas) y el título limpio con `zipNames.ts`, **sin espacios:
  guiones bajos** (EX11), como las carpetas de la app en el Drive. Una página sin subpáginas también tiene su carpeta (así
  sus archivos tienen dónde ir y el orden es uno solo). **Cada carpeta de página se topa en 60 letras** (por grafema,
  con `cutText`; el `.html` y el `.md` llevan el mismo nombre topado): con 200 letras por parte, tres o cuatro niveles
  de títulos largos pasan los 260 caracteres de ruta del Explorador de Windows. Dos hermanas que quedan iguales al
  topar se distinguen por el número de orden, que ya va adelante.
- **`<página>.html`:** la página como se ve, en claro: la misma copia del DOM de la vista de impresión (encabezado,
  título y contenido, sin tiradores, menús, `id` ni reproductores), sin una línea de JavaScript, con `style.css` de la
  raíz. **Cada foto se muestra siempre con su vista JPEG** (`Files/_view/IMG_0413.jpg`), que cualquier navegador abre,
  y la vista es un link al original si el original está en el zip (`Files/IMG_0413.HEIC`); si no está (casilla
  destildada, sin red, no se pudo bajar), la vista sola, con el nombre del archivo debajo. Un video, su cuadro con un
  link al archivo; un adjunto, su tarjeta con el link. Todo con rutas relativas (`../01_Dia_1/Files/…` para un archivo
  que guarda otra página), así se abre con doble clic y sin red. Los links entre páginas van al `.html` de la otra
  página; afuera de lo exportado, el texto visible sin link. Arriba, el camino desde la raíz de lo exportado; abajo, los comentarios
  (si la casilla está tildada). Se imprime con la hoja de la página (`@page` en el mismo archivo).
- **`<página>.md`:** el texto en Markdown (la conversión de BlockNote con el esquema de la app), las fotos como
  `[![IMG_0413.HEIC](Files/_view/IMG_0413.jpg)](Files/IMG_0413.HEIC)` en su renglón (la vista con link al original; sin
  original, la vista sola), los links de afuera como texto, el salto de hoja como una línea propia
  `<!-- shotdocs:page-break -->` (no se confunde con la línea divisoria `---` y vuelve si algún día se importa `.md`), y
  los comentarios al final como citas. Sirve para buscar con cualquier herramienta y como respaldo legible.
- **`Files/`:** los originales que pidió cada casilla (EX9), con su nombre del Drive limpio. **Un archivo usado en varias
  páginas va una sola vez** (EX10), en la carpeta de la primera página que lo usa en el orden del árbol; las demás lo
  apuntan con su ruta relativa.
- **`Files/_view/`:** siempre, aunque los originales estén destildados: una JPEG por foto y por video, la mejor que haya
  sin pedir originales (la nítida de 2048 si está en el dispositivo; si no, la miniatura de la app, que se baja de
  Storage si falta), con el nombre del original y `.jpg`. Pesa unas decenas de KB por foto con la miniatura (40 KB de
  estimado, `THUMB_ESTIMATE`) y unos cientos con la nítida: la ventana lo suma al total ("Previews · 98 MB"). Un HEIC
  que solo está como original se pasa a JPEG en el dispositivo con el convertidor de v0.075.
- **`_shotdocs/`:** lo que necesita Shot Docs para volver (sección 3). `manifest.json` lleva `format: 1`, un id del
  archivo al azar, la versión de la app que exportó, la fecha de la exportación y **la de la última sincronización del
  dispositivo**, el árbol (id viejo, padre, orden, título, ajustes de hoja y de títulos cortos), por cada archivo su id
  viejo, nombre, tipo, peso, MD5 si el Drive lo dio, fecha, la ruta del original en el zip (o `null` si no se incluyó) y
  la de su vista. `pages/<n>.json` son los bloques de BlockNote de cada página (las direcciones `sdmedia://` quedan con
  el id viejo; el manifest dice dónde está cada uno) y, aparte, **los títulos colapsados para todos** (sección 2.4).
  `comments.json`, los hilos con los ids viejos de página, bloque e hilo, con el **nombre** de cada autor y **ningún
  correo** (sección 4).
- **Lo que no se escribe en una rama** (regla 2): si lo exportado es una rama y no el proyecto, el manifest no lleva el
  nombre ni el id del proyecto, ni el `parent` de la raíz exportada (va nulo), ni el id de ninguna página de afuera. Los
  links a páginas de afuera quedan como texto sin `/p/<id>` **en el `.html`, el `.md` y el JSON** (en los bloques, el
  link se cambia por su texto). El `index.html` y el nombre del zip llevan el título de la raíz exportada.
- **`MISSING_FILES.txt`:** como el de *Download all* (en inglés el nombre, en el idioma de la app el texto), una línea
  por cosa que falta: un archivo que el Drive no dio, uno sin red, una página que no estaba completa en el dispositivo.
- **Escribirlo:** Chrome y Edge de computadora, `showSaveFilePicker` (zip, sin tope) o `showDirectoryPicker` (el árbol
  en una carpeta, sin zip). Firefox, Safari y los teléfonos, en memoria hasta 1 GB (500 MB en un teléfono), con
  *Save Reporte_ERSO.zip* al terminar (D24). Pasado el tope, EX12.
- **"Como estaba en este dispositivo":** `index.html`, cada `.html` (al pie), la primera hoja del PDF y el manifest dicen
  la fecha de la última sincronización del dispositivo. Sin red, el árbol local puede incluir una página cuyo permiso se
  sacó después (lo corrige la sincronización al volver la red): es lo mismo que la persona ve en su barra lateral, y la
  fecha lo deja dicho.

### 2.4 Cómo se arma cada página sin tocar nada

- **El contenido sale de los bloques, no del documento Yjs.** Para cada página: `docs.snapshot(pageId)` (una copia en
  memoria, la misma que usan la búsqueda y la papelera de archivos), `yXmlFragmentToBlocks` del fragmento
  `document-store`, y la copia se descarta. Los bloques son lo que se ve: sin lápidas, sin lo escrito y borrado
  (comprobado por la auditoría con el editor real, con las filas crudas y con la base limpia de D14: ningún texto
  borrado, y los dos JSON idénticos).
- **El colapsado para todos no está en los bloques:** vive en el mapa `collapsedHeadings` del Y.Doc
  (`SHARED_COLLAPSE_MAP_NAME`, `src/search/replaceDoc.ts`), al lado del fragmento. Se exportan las claves con valor
  `true` cuyo id de bloque existe en los bloques exportados (el mapa da solo los valores vigentes: no lleva nada
  borrado). En el PDF y el HTML todo sale abierto, como siempre; el dato es para volver.
- **Un editor de exportación:** un BlockNote con el esquema y las extensiones de la app, fuera de pantalla, en solo
  lectura y **sin colaboración** (no se ata a ningún Y.Doc). Por cada página se le ponen los bloques
  (`replaceBlocks`), se espera a que se pongan las imágenes (hasta 8 s, como `printPage`), se copia el DOM con
  `buildPrintView` y se pagina. El mismo editor sirve para todas las páginas (en la importación de Coda, el que
  convierte el HTML ya es uno solo). Como no está atado a nada, nada de lo que haga puede subir un cambio.
- **El PDF** junta las copias de todas las páginas en una sola vista; **el zip** serializa cada copia a HTML (sin
  atributos `on*`, sin `javascript:` en los links, con cada foto cambiada por su vista JPEG y su link al original) y la
  suelta.
- **Las páginas que no están completas en el dispositivo** (con `contentGap` = `missing` o `preparing`, ilegibles o de
  una versión más nueva): con red se baja lo que falta antes de empezar (la sincronización de siempre); sin red, o si no
  llega, salen con lo que hay y una línea arriba ("This page may be out of date on this device") y en
  `MISSING_FILES.txt`. Una página en preparación (D14, sin base todavía) sale vacía con esa línea.
- **Lo que no se subió todavía** (ediciones de este dispositivo) sí sale: se exporta lo que la persona ve.

## 3. Volver a Shot Docs (EX5, EX6)

- **Dónde:** selector de proyectos → *Import Shot Docs archive…*, para quien puede crear proyectos (dueño y admins). Se
  elige **el zip** con un selector de archivo común (anda también en el iPhone, que no elige carpetas enteras), o la
  carpeta descomprimida en Chrome y Edge. El zip se lee por partes (`Blob.slice` sobre el índice del final): no se
  carga entero en memoria.
- **Antes de empezar, el espacio:** `media.add` guarda cada archivo en el dispositivo (IndexedDB) antes de subirlo, así
  que importar ERSO pide 5,7 GB más en el disco del navegador hasta que suba. La ventana muestra el peso de los
  originales del zip al lado de `navigator.storage.estimate()` (como la importación de Coda) y, si no entra, lo dice
  sin empezar. En el iPhone, pasado 1 GB, recomienda importar desde una computadora.
- **Qué hace:** lo mismo que la importación de Coda, con el formato propio. Crea un proyecto nuevo con el nombre de la
  raíz (editable), crea todas las páginas primero en el orden del manifest (`tree.create`), les pone los ajustes de
  hoja y de títulos cortos, sube los archivos con `media.add` (van al Drive del workspace de destino, a
  `LGA_ShotDocs/<Proyecto>/<día>`), y escribe cada página con un editor sin pantalla con los bloques de su JSON, con los
  ids viejos de archivos cambiados por los nuevos y los links entre páginas cambiados a las páginas nuevas. Después de
  los bloques, escribe en el mapa `collapsedHeadings` de cada página las claves de colapsado para todos que trae el JSON
  (solo las de ids de bloques que existen en esa página). Los ids de los bloques se conservan (solo tienen que ser
  únicos dentro de la página); un JSON con ids repetidos en una página recibe uno nuevo en el repetido, anotado.
- **Comentarios:** entran con `import_comment` (autor por nombre, fecha, hilo y resuelto), anclados al mismo id de
  bloque. **Cada comentario recibe un id nuevo y estable**, con el mismo patrón que Coda (`codaCommentId`,
  `src/import/codaComments.ts`): el uuid de `SHA-256("shotdocs-comment:" + proyectoNuevo + ":" + idViejo)`. Con los ids
  viejos, en el mismo Supabase chocarían con los originales (`comment_conflict`); con estos, reintentar no duplica. Las
  respuestas apuntan al id nuevo de su hilo. **Un hilo cuyo primer comentario se borró** (la base lo da con el texto
  vacío y `import_comment` no acepta un texto vacío): la primera respuesta viva pasa a abrir el hilo, con su autor y su
  fecha, y queda anotado en la lista del final.
- **Sigue donde quedó**, como la de Coda: anotación en `meta`, páginas terminadas, archivos ya guardados; nunca pisa lo
  que la persona escribió mientras tanto. **La clave es el id del archivo más el SHA-256 de su `manifest.json`**
  (`shotdocsImport:<id>:<huella>`): un zip editado o armado a mano con el mismo id no ofrece seguir sobre el proyecto de
  otra importación.
- **Lo que vuelve igual:** el árbol y su orden, los títulos, los formatos de hoja, los bloques con todas sus
  propiedades (Script, preguntas, saltos de hoja, fotos en línea con su tamaño, fotos en las celdas), el colapsado para
  todos (del mapa aparte), los comentarios y sus respuestas, los originales incluidos.
- **Lo que no vuelve:** el historial y las versiones con nombre (nunca salen: llevarían lo borrado), la papelera, los
  permisos (el proyecto nuevo es privado de quien importa, como cualquier proyecto nuevo), las marcas sin conexión, los
  autores como cuentas: un comentario de otra persona vuelve con su **nombre** como autor importado y **sin correo**
  (`imported_author_email` nulo); uno de quien exportó vuelve a nombre de quien importa solo si es la misma persona
  (sección 4). Los comentarios de un compañero que importa él mismo un zip ajeno quedan con su nombre, como importados:
  es el precio de no llevar correos.
- **Un archivo que no está en el zip** (un video que se destildó): el bloque queda como un párrafo con el nombre del
  archivo y "(not in the archive)", y va a la lista del final. Nunca un bloque roto que apunte a un id de otro
  workspace.
- **Validación (el zip puede venir de cualquiera):** el JSON con tope de tamaño por archivo, cada bloque contra el
  esquema de la app (un tipo que no se conoce, de una versión más nueva, pasa a párrafo con su texto y queda anotado;
  una **propiedad** que el esquema no conoce también se anota, porque BlockNote la tira sin avisar; nunca se descarta
  nada en silencio), ningún correo aceptado en `comments.json` (un zip armado a mano que traiga uno lo ignora), solo direcciones `sdmedia://` del manifest, `https:` y `mailto:` en los links, nunca se
  lee ni se ejecuta el HTML del zip. Un `format` más nuevo que el que conoce la app se rechaza con "Update the app to
  import this archive".
- **En la base, una migración chica:** `comments.imported_from` acepta `'coda'`; se suma `'shotdocs'` (la restricción
  `check` ya prevé que "uno nuevo se suma con su migración"). Nada más. Los comentarios nunca se marcan como `'coda'`
  para salir del paso: la entrega 3 se publica después de aplicar la migración.

## 4. Quién puede exportar y qué nunca sale (EX7, EX8, EX15)

- **El zip, solo dueño y admins (D60, Lega 2026-10-02); el PDF, quien ve.** Ver EX7.
- **Quien ve, exporta lo que ve.** Nivel 1 o más sobre la página: Ver, Comentar, Editar, Editar y crear páginas, también
  los invitados. Ver ya incluye bajar los originales (decisión de Lega en `Plan_Workspaces.md`, sección 4): el zip solo
  junta lo que la persona ya puede abrir de a uno. *Export project…* aparece solo si la persona ve el proyecto entero
  (dueño, admin, o un permiso sobre el proyecto); un invitado con páginas sueltas exporta cada rama desde su página.
- **La rama se calcula del árbol local**, que ya pasó por Row Level Security: solo las páginas que la persona tiene en
  la barra lateral, sin las de la papelera (`tree.isTrashed`, que mira también los padres). Las páginas que la base no
  le da no están en su dispositivo.
- **Lo borrado:** no sale porque se exportan bloques (2.4). Quien recibe bases limpias (D14) tiene en su dispositivo la
  base, sin lo borrado; quien edita tiene las filas con lápidas, pero los bloques no las llevan. **Prueba de aceptación
  de la entrega 2:** un editor escribe un texto secreto, lo borra, sube una foto y la saca; el zip y el PDF no tienen
  el texto en ningún byte ni la foto.
- **Fotos sacadas, archivos en la papelera de archivos:** no están en los bloques, no salen. El portero, además, no le da
  pase a quien no ve lo sacado (D14).
- **Comentarios:** los que devuelve `list_comments` a la persona, sin los borrados (`deleted_at`, el cuerpo ya viene
  vacío). Con el nombre de cada autor (la parte del correo antes de la `@` para el equipo, `imported_author` para los
  importados), **ningún correo en ningún archivo** de lo exportado: ni en el HTML, el Markdown y el PDF, ni en
  `_shotdocs/comments.json` (EX8). Por qué también en el JSON: `import_comment` guarda el correo de un autor ajeno en
  `imported_author_email`, y `list_comments` lo devuelve a cualquiera con nivel 1 en la página, también a los
  invitados; volver en otro workspace dejaría los correos del equipo de A a la vista de los invitados de B, y el zip
  viaja (se manda, se guarda en un disco compartido).
- **Reconocer a quien exportó, sin su correo:** cada comentario lleva `mine: true` si lo escribió quien exporta, y el
  manifest lleva una sal al azar de ese archivo y `exporter = SHA-256("shotdocs-author:" + sal + ":" + correo en
  minúsculas)`. Al importar se calcula lo mismo con el correo de quien importa: si coincide, los `mine` quedan a su
  nombre (`p_author_name` nulo, como un comentario propio de Coda); si no, todos entran con el nombre y
  `p_author_email` nulo. Del resto del equipo no viaja ni el correo ni su huella. La huella de quien exporta se puede
  probar contra un correo que alguien ya sospecha (es lo único que revela), y la sal por archivo impide comparar
  archivos entre sí o usar tablas armadas de antemano.
- **Los visitantes de un link público** (P.19, cuando exista): no exportan en las primeras entregas (EX15). Después, si
  hace falta, solo el PDF de la página, con los topes del link.
- **Proyectos archivados** (P.14): se exportan igual (es el caso de archivar uno terminado). **Proyectos en la
  papelera:** no; se restauran primero.
- **Lo que se lleva quien exporta es suyo:** un zip no se puede "desbajar" (como el original de una foto). Por eso no
  hay un permiso nuevo: es la misma confianza que ya da Ver.

## 5. Tamaño, memoria y tiempos

**El texto:** cada página es chica (en Wanka, 7 KB de mediana y 64 KB el p95; `Doc_Link_Publico.md`). Ponerle los
bloques al editor, esperar las imágenes y copiar la vista: a medir en la entrega 0 con el esquema real (la copia y el
cálculo son unos 5 ms por página de cinco hojas, `Doc_Hojas_PDF.md`). **Objetivo de aceptación:** 300 páginas en menos
de 60 s en una computadora, con la barra de progreso y *Cancel*.

**El PDF (medido en Chromium, prototipo con hojas de tres tamaños):**

| Árbol | Hojas | PDF | Generar el PDF (vista ya armada) |
|---|---|---|---|
| 6 páginas, 2 fotos cada una | 9 | 0,2 MB | 61 ms |
| 100 páginas, 10 fotos de 480 px | 168 | 14 MB | 0,3 s |
| 300 páginas, 10 fotos de 480 px | 506 | 43 MB | 0,8 s |

Los tiempos son solo `page.pdf` con la vista ya armada; armar y decodificar las 3000 fotos del prototipo fueron unos
10 s aparte, y la repetición de la auditoría dio 1,4 a 1,9 veces más lento (la máquina tenía otros procesos).

El costo grande no es generar el PDF sino **tener en una sola vista todas las imágenes decodificadas**: una miniatura de
480×360 son 0,7 MB en memoria. Medido por la auditoría en Chromium, 300 fotos que ocupan 160 px en la hoja suman a la
vista 261 MB con fuente de 480 px, 346 MB con 1024 y 368 MB con 2048, y el PDF pesa 6, 17 y 30 MB. Por eso **toda foto
se achica a su ancho impreso a 200 ppp** antes de entrar a la vista (sección 2.2), y el tope se cuenta en **píxeles
decodificados** (ancho × alto de cada foto ya achicada), no en cantidad de fotos: una foto de 1/4 de hoja cuesta un
cuarto que una de hoja entera. El diálogo de impresión de Chrome además dibuja la vista previa de cada hoja. Topes
provisorios (constantes, a ajustar con lo medido en la entrega 1):

| | Páginas por PDF | Píxeles de fotos por PDF | Nítidas pedidas al Drive |
|---|---|---|---|
| Computadora | 500 | 800 millones (unas 2400 fotos de media hoja a 200 ppp) | 1000 |
| Teléfono o tableta | 60 | 50 millones (unas 300 miniaturas de 480 px) | 100 |

Pasado un tope, la ventana lo dice antes de empezar y ofrece exportar una rama (las de primer nivel, con su peso) o el
zip. **Reemplazado en la entrega 1b (D84, Lega):** pasado un tope, el PDF sale en partes por páginas enteras; con las
fotos originales manda además un tope de peso ("Cómo quedó la entrega 1b"). El tope de hoy del PDF de una página en un táctil (12 originales o 60 MB) se reemplaza por el de píxeles para los
originales achicados, porque lo que pesa en la vista es lo decodificado y no el archivo. En el iPhone (WebKit) nada de
esto está medido: se mide a mano en la entrega 1 antes de fijar los números.

**El zip:** lo que pesa son los originales. Con todas las casillas, ERSO son 5,7 GB y 2459 archivos. **Pedidos al
portero:** un `/pass` y un `/m/` por archivo (*Download all* pide el archivo entero y usa `Range` solo si se corta; la
cuenta de "uno cada 16 MiB" es la de "Available offline"): unos **4900 pedidos al Worker, el 4,9 % de los 100 000 por
día** de la cuenta. **El cupo que manda es el del Durable Object:** el portero de `main` crea un `Portero` por pedido
y guarda el secreto del pase y el token de Google en el Durable Object (`portero/src/core.ts`, `secret()` y `token()`),
así que cada `/m/` le hace unos 2 llamados y cada `/pass` otros 2 (`file:<id>` y el secreto): **unos 9800 llamados,
cerca del 10 % de su cupo diario de 100 000**. Cinco exportaciones enteras de ERSO en un día gastarían la mitad, y el
cupo es compartido con todo lo demás del portero (ver, subir, las carpetas). La ventana muestra antes de empezar los
dos números estimados ("≈ 4,900 file server requests · 10% of today's limit") y la entrega 2 los mide con ERSO en el
panel de Cloudflare. El "cero llamados con la instancia caliente" de `Doc_Carpetas.md` (sección 4) no está
implementado: si se implementa, el número baja y se ajusta el texto. Las miniaturas que falten para las vistas JPEG
salen de Storage, no del portero: 3000 de 40 KB son unos 120 MB de los 5 GB por mes de salida de Supabase.

El tiempo lo pone la bajada desde el Drive por el portero: a 20 MB/s, unos 5 minutos; a 5 MB/s, unos 20 (a medir con
ERSO en la entrega 2). El CRC32 en el Worker del navegador no es el cuello (slice-by-8).

| Navegador | Zip | PDF |
|---|---|---|
| Chrome y Edge de computadora | Escrito a medida que llega, sin tope (o a una carpeta) | Cada página con su hoja (medido) |
| Firefox | En memoria, hasta 1 GB | A medir: si no toma las páginas con nombre, todo con la hoja de la raíz |
| Safari de la Mac | En memoria, hasta 1 GB | A medir (`@page size` depende de la versión, `Doc_Hojas_PDF.md`) |
| iPhone, iPad, Android | En memoria, hasta 500 MB; *Save* con un toque nuevo | Con los topes del teléfono; el diálogo desde un toque (a probar a mano) |

En el iPhone, el texto de un proyecto entero sí entra; los originales casi nunca. La ventana lo dice con el peso antes
de empezar y ofrece el zip liviano (EX12). Un zip grande se arma desde una computadora.

## 6. Sin red (EX13)

- **El texto siempre está:** cada dispositivo baja todas las páginas que la persona ve (`Doc_Buscar.md`, sección 1).
  Sin red se exporta igual, con lo que haya; las páginas incompletas salen marcadas (2.4).
- **"Como estaba en este dispositivo el <fecha>":** lo exportado lleva la fecha de la última sincronización (2.3), no
  solo la de los comentarios. Sin red, el árbol puede tener todavía una página cuyo permiso se sacó después (lo
  reemplaza `setSnapshot` recién al volver la red); la persona la ve igual en su barra lateral, y la fecha lo dice.
- **Los comentarios:** los que bajó el dispositivo (la cola de comentarios guarda lo último bajado y lo pendiente). Sin
  red, una línea en `MISSING_FILES.txt`: "Comments as of <fecha> on this device".
- **Las fotos y archivos:** lo que hay en el dispositivo (originales propios, copias sin conexión, nítidas, miniaturas).
  **Antes de empezar** la ventana dice cuántos originales no están ("120 originals are not on this device; they will be
  missing until you are online") y deja elegir: *Export now* o esperar la red. Si la red se corta a mitad, la bajada
  espera como *Download all* ("No connection: it continues when it comes back") y se puede cancelar.
- Con "Available offline" (P.10) marcado con *Original photos*, *Attachments* y *Videos*, un proyecto se exporta entero
  sin red.

## 7. La interfaz (EX14)

- **Menú de la página** (arriba y en la barra lateral): *Export…* debajo de *Export PDF / Print*, que sigue igual (un
  clic, Ctrl/⌘+P). **Menú de cada proyecto** en el selector (al lado de *Available offline…*): *Export project…*,
  también en *Archived projects*. **Selector de proyectos:** *Import Shot Docs archive…* (dueño y admins), al lado de
  *New project*.
- **La ventana *Export "<título>"*:**
  1. *What*: *This page* / *This page and the pages inside (12)* / (desde el proyecto) *The whole project (240 pages)*.
  2. *Format*: *PDF — to share* / *Zip — to archive*.
  3. Las casillas: en PDF, *Sharp photos* y *Comments*; en zip, *Original photos*, *Attachments*, *Videos*, *Comments*
     (y *Drive folders* cuando exista, entrega 4), cada una con su peso, como "Available offline".
  4. El resumen: "240 pages · 2459 files · 5.7 GB · previews 98 MB", los pedidos al portero estimados (sección 5) y lo
     que no va a estar (sin red, topes, navegador). En el PDF, el aviso de no cambiar márgenes ni escala en el diálogo.
  5. El botón: *Export PDF* (abre el diálogo de imprimir; elegir *Save as PDF*) o *Download .zip…* / *Download to a
     folder…* (Chrome y Edge de computadora).
- **Mientras trabaja:** "Preparing page 34 of 240: <título>", después "1.2 of 5.7 GB", *Cancel* (Escape no cierra
  mientras baja). La app pide confirmar antes de cerrar la pestaña con un zip en curso (el `beforeunload` de siempre).
- **Al terminar:** dónde quedó y cuántas cosas faltan (con *Show list*).
- **Ayuda:** dos entradas nuevas (*Export pages and projects*, *Import a Shot Docs archive*) en `src/help/entries.ts`
  con sus textos en `src/i18n/lazy/help.ts`. **Sin atajos nuevos** (Ctrl/⌘+P sigue siendo el PDF de una página). La
  recorrida no cambia. `README.md` suma la función.

## 8. Lo que no cambia

- **El documento y el editor:** nada; el importador escribe bloques del esquema. No hace falta subir `min_app_version`.
- **El portero:** nada; `POST /pass` y `/m/` con `?offline=1` (para no pasar por la caché del arranque de los videos),
  como *Download all*.
- **La base:** nada para exportar; para volver, la migración de `imported_from` (sección 3).
- **Versiones viejas de la app:** no se enteran. Un archivo exportado por una versión nueva (`format` mayor) lo rechaza
  la vieja con su aviso; uno viejo lo importa la nueva.

## 9. Entregas y pruebas de aceptación

| Entrega | Qué | Riesgo | Prueba de aceptación |
|---|---|---|---|
| **0** | El editor de exportación con el esquema real: poner bloques, esperar imágenes, copiar y paginar, página por página | Bajo | Con un proyecto de prueba de 300 páginas (texto, Script, fotos en línea y en celdas, tablas, saltos, preguntas): menos de 60 s en la computadora; el Y.Doc de cada página byte por byte igual antes y después; las hojas de cada página iguales a las marcas de la pantalla |
| **1** | PDF de una rama o de un proyecto: índice con hojas, cada página con su formato, links internos, fotos, comentarios opcionales, topes | Medio | En Chromium: hojas = índice + suma de las marcas; cada página empieza en la hoja que dice el índice (si en algún navegador no, ahí el índice sale sin números); los tamaños del PDF (pdf.js) son los de cada página; los links del índice son internos; toda foto entra achicada a su ancho impreso (medir memoria de la vista y peso del PDF); sin páginas de la papelera; un invitado con dos ramas exporta solo la suya y el índice no nombra el proyecto. **Con `window.print()` y *Save as PDF* reales en Chrome y Edge** (hojas mezcladas y links internos), que arman la lista de navegadores probados. A mano: Safari de la Mac, Firefox y el iPhone (memoria y topes de píxeles) |
| **2** | Zip: HTML, Markdown, JSON, originales, comentarios, `MISSING_FILES.txt`; los destinos de *Download all*; sin red; cancelar | Medio | El zip lo abre Python (`testzip`); cada `.html` abre con `file://` sin red y **muestra cada foto en Chromium y Firefox, también las HEIC y con *Original photos* destildada** (la vista JPEG), con link al original cuando está; el texto del `.md` es el de la página; **el texto secreto escrito y borrado y la foto sacada no están en ningún byte del zip ni del PDF**; **ningún byte del zip contiene el correo de nadie del equipo**; las claves de colapsado para todos están en el JSON; en una rama, ni el nombre ni el id del proyecto ni ids de afuera; un archivo de dos páginas va una vez; nombres sin espacios y carpetas de página de 60 letras como mucho; sin red, la lista de lo que falta y la fecha de la última sincronización. ERSO entero en Chrome, medido (tiempo, pedidos al Worker y llamados al Durable Object en el panel) |
| **3** | *Import Shot Docs archive…*: proyecto nuevo, archivos al Drive, comentarios, seguir donde quedó; migración de `imported_from` | Medio | Ida y vuelta: los bloques de cada página iguales (salvo ids de archivos y links, cambiados), el colapsado para todos igual, los hilos con su autor, fecha y resuelto, los archivos con el mismo peso y MD5, el árbol en el mismo orden; importar dos veces el mismo zip en el mismo Supabase no choca (ids de comentarios derivados del proyecto nuevo); un comentario ajeno vuelve con `imported_author_email` nulo y uno propio a nombre de quien importa solo si la huella coincide; un hilo con el primero borrado entra con la primera respuesta viva; un zip cortado o con un JSON roto avisa sin crear nada a medias; un bloque de un tipo desconocido o con una propiedad desconocida queda en la lista; un manifest editado con el mismo id no ofrece seguir; sin espacio en el dispositivo, avisa sin empezar; cortar a mitad y seguir no duplica páginas |
| **4** | Después: el contenido de las carpetas de Drive (P.9) en el zip, volver al mismo workspace sin subir de nuevo los archivos que ya están, el PDF para un link público | — | Se diseña aparte |

Cada entrega con su auditoría independiente antes de pasar a `main`, su entrada en la ayuda y sus pruebas en
`src/ui/` y `src/media/` (sin red, con el servidor falso de `src/sync/testing.ts`).

## 10. Riesgos

- **La vista de un proyecto enorme cuelga la pestaña** (miles de fotos decodificadas, la vista previa del diálogo). Lo
  frenan los topes de la sección 5 y la entrega 1 los mide; si no alcanza, el PDF se parte por ramas de primer nivel
  (varios diálogos, uno por rama).
- **Un nodo del editor que no se dibuja igual fuera de la página** (las tarjetas de Drive, las fotos en línea, el
  colapsado necesitan su contexto de React). La entrega 0 existe para eso: si alguno no anda en el editor de
  exportación, se dibuja abriendo cada página en el editor de verdad (más lento, de a una).
- **Safari y Firefox con hojas mezcladas:** sin las páginas con nombre, todo sale con la hoja de la raíz (EX3), avisado.
- **El zip en el iPhone:** el guardado de un archivo armado en memoria en la app instalada es lo menos probado (igual
  que en *Download all*, pendiente de prueba a mano).
- **Un zip de otro como puerta de entrada:** el importador valida todo contra el esquema y nunca usa el HTML (sección
  3). Los archivos entran por `media.add`, el mismo camino que soltar una foto.
- **El link al portero dentro de un PDF entregado** pide sesión: el cliente sin cuenta no lo abre. Por eso el zip lleva
  los originales; el PDF lo dice en su ayuda.
- **Gastar el día del portero:** un proyecto como ERSO es el 4,9 % de los pedidos del día al Worker y cerca del 10 % de
  los llamados al Durable Object, que es el que manda; cinco exportaciones enteras en un día, la mitad de ese cupo,
  compartido con todo el equipo. La ventana muestra los dos números antes de empezar.
- **El índice descuadrado:** si alguien cambia márgenes o escala en el diálogo, los números de hoja del índice dejan de
  coincidir (los links internos siguen andando). La ventana lo avisa; no se puede impedir.
- **La huella del correo de quien exporta** (B1): con la sal por archivo no se compara entre archivos, pero alguien que
  sospecha un correo puede probarlo contra la huella de ese zip. Es lo único que revela, y solo de quien exportó.
- **Rutas largas en Windows:** con carpetas de 60 letras, unos 8 niveles de títulos largos siguen pasando los 260
  caracteres del Explorador (el zip es válido; lo que falla es descomprimir con el Explorador). Se mide con el árbol más
  hondo de ERSO en la entrega 2; si hace falta, se baja el tope en los niveles hondos.
- **El JSON de los bloques depende de la versión de BlockNote:** el manifest lleva `format` y la versión de la app; un
  cambio de BlockNote que cambie los bloques pide un conversor del `format` viejo, con su prueba.

## 11. Decisiones propuestas (EX1 a EX15, a confirmar por Lega)

### EX1 · Para qué es cada salida

- **Qué pasaba:** "PDF y/o zip" puede ser una sola cosa con todo o dos cosas distintas. Ejemplo: al cliente de la
  película le mandás el reporte de rodaje; no quiere un zip con 400 fotos de 40 MB y carpetas `_shotdocs`, quiere un PDF.
  Y para guardar ERSO un PDF no alcanza: no tiene los originales ni vuelve a Shot Docs.
- **Las opciones:** A) dos salidas con propósito: PDF para entregar (sin comentarios), zip para archivar (con todo y
  reimportable). B) Una sola: un zip que adentro trae también el PDF. C) Solo el zip, y el PDF se saca página por
  página como hoy.
- **Elegí A porque** cada caso pide valores por defecto opuestos (comentarios, originales, peso) y separarlos evita
  mandarle al cliente lo interno por error. B obliga al cliente a descomprimir; C no resuelve la entrega.
- **Si preferís otra:** B es sumar el PDF como una casilla del zip (en Chrome se arma aparte igual: el PDF sale del
  diálogo de imprimir, no se puede meter en un zip sin una librería de PDF).

### EX2 · El PDF de varias páginas

- **Qué pasaba:** el PDF de hoy es de una página por vez. Para entregar un reporte de 40 escenas habría que imprimir 40
  veces y juntar los archivos a mano.
- **Las opciones:** A) un solo PDF con todo el árbol en orden y un índice con la hoja de cada página, por la impresión
  del navegador. B) Un PDF por página dentro del zip (cada uno pide su diálogo de imprimir: 40 diálogos). C) Generar el
  PDF con una librería en la app (sin diálogo, pero hay que redibujar todo a mano o pasar a imagen: texto no
  seleccionable, otra manera de cortar que la pantalla).
- **Elegí A porque** reusa la fase 4 (lo que se ve es lo que sale) y está medido: 300 páginas, 506 hojas, links del
  índice que andan. B y C rompen "lo que se ve es lo que sale" o son inusables.
- **Condiciones de la auditoría (aplicadas):** toda foto achicada a su ancho impreso a 200 ppp (sección 2.2) y, si
  los cortes no coinciden en algún navegador, el índice sin números (los links andan igual).
- **Si preferís otra:** C se puede evaluar más adelante solo para el iPhone, si el diálogo no aguanta un PDF grande.

### EX3 · Hojas de tamaños distintos en el mismo PDF

- **Qué pasaba:** el formato se hereda por rama: el desglose puede ser A3 horizontal y las escenas A4. Un PDF del
  proyecto entero tiene que decidir qué hace.
- **Las opciones:** A) cada página con su hoja (páginas con nombre de CSS) en los navegadores de una lista probada con
  el diálogo real; en los demás, todo con la hoja de la raíz y repaginado, avisado antes. B) Todo con la hoja de la raíz
  siempre. C) Un PDF por formato.
- **Elegí A porque** en Chromium funciona (medido con `page.pdf`: A4, A5 horizontal y Carta en el mismo PDF) y es lo que
  el cliente espera ver; el respaldo de B solo aparece donde no está probado. La lista se arma midiendo `window.print()`
  y *Save as PDF* reales (entrega 1), no con `CSS.supports`, que no prueba lo que hace el diálogo.
- **Si preferís otra:** B es una línea (sin `page:` en cada contenedor).

### EX4 · Qué lleva el zip por cada página

- **Qué pasaba:** el zip tiene que servir a una persona (abrir y mirar dentro de dos años, sin la app) y a Shot Docs
  (volver a importarlo). Ejemplo: el supervisor que busca "lente 35" en todo el archivo de una película terminada.
- **Las opciones:** A) `.html` (como se ve, sin red) + `.md` (texto para buscar) + JSON en `_shotdocs/` (para volver),
  y **cada foto con una vista JPEG en `Files/_view/` que el `.html` y el `.md` muestran siempre, con link al original**
  cuando está en el zip. B) Solo `.md` y las fotos (simple, pero pierde Script, fotos en línea con su tamaño, tablas con
  fotos, saltos de hoja, preguntas). C) Solo `.html`.
- **Elegí A porque** cada pieza tiene un lector distinto y las tres salen de lo mismo (los bloques y la vista de
  impresión); el `.md` es lo que D-03 prevé para exportar y respaldar. La vista JPEG la pidió la auditoría (B2): las
  fotos del iPhone son HEIC, que Chrome y Firefox no abren (`printPage.ts` ya lo resuelve igual, con la miniatura), y
  con *Original photos* destildada el `<img>` quedaba roto. Cuesta unas decenas de KB por foto.
- **Si preferís otra:** sacar el `.md` es una casilla menos; sacar el JSON deja el zip sin vuelta.
- **Cambiada por Lega (2026-10-02, D57):** el `.md` de cada página referencia las fotos, sus vistas, los originales y
  las otras páginas con rutas **relativas** (codificadas, sin `<…>`: `../01_Dia_1/Files/_view/IMG_0412.jpg`), así se
  ven al abrir el `.md` en un visor de Markdown común. Probado: cada link del `.md` existe en el zip.

### EX5 · Qué se guarda para volver: los bloques, no el documento Yjs

- **Qué pasaba:** el documento Yjs de una página es la copia más fiel, pero adentro lleva todo lo que se escribió y
  se borró (`Doc_Privacidad_Borrado.md`: 158 elementos borrados legibles en la página más editada). Un zip de archivo
  que se le pasa a alguien llevaría las notas internas borradas.
- **Las opciones:** A) los bloques de BlockNote en JSON (lo que se ve, sin lo borrado). B) El Y.Doc binario (fiel,
  con el historial adentro, pero con lo borrado). C) Solo el `.md` (pierde formato).
- **Elegí A porque** cumple D14 sin excepciones y conserva todas las propiedades de los bloques; el historial no se
  exporta en ningún caso.
- **Si preferís otra:** B solo tendría sentido para un respaldo privado del dueño; para eso ya están las copias de la
  base (`z_shotdocs_backup`).

### EX6 · Cómo se vuelve a Shot Docs

- **Qué pasaba:** archivar un proyecto y volver a abrirlo dentro de un año, quizás en otro workspace (otro dueño, otro
  Drive).
- **Las opciones:** A) *Import Shot Docs archive…* siempre a un proyecto nuevo, para quien puede crear proyectos, con
  los archivos subidos al Drive de destino. B) Restaurar encima del proyecto original. C) Sin vuelta por ahora.
- **Elegí A porque** nunca pisa nada (regla 5), reusa la importación de Coda (crear, escribir, seguir donde quedó) y
  anda entre workspaces. B puede pisar trabajo nuevo.
- **Si preferís otra:** C deja el JSON escrito igual, para importarlo cuando haga falta.

### EX7 · Quién puede exportar

- **Qué pasaba:** un cliente invitado con Ver sobre el reporte de rodaje, ¿puede bajarse el PDF o el zip? Hoy ya puede
  abrir y bajar cada foto de a una.
- **Las opciones:** A) quien ve (nivel 1 o más, invitados incluidos), solo su rama. B) Solo quien edita. C) Solo dueño y
  admins.
- **Elegí A porque** Ver ya incluye bajar los originales (decisión de Lega en el plan): negarlo solo obliga a bajar de a
  uno, y el PDF es justo lo que el cliente necesita.
- **Si preferís otra:** B o C son una condición en el menú (la base no cambia, porque no hay nada nuevo que proteger).
- **Cambiada por Lega (2026-10-02, D60):** el **zip** lo exportan **solo el dueño y los admins** del workspace; el
  **PDF**, cualquiera que vea la página (como en la entrega 1). En la ventana, el círculo *Zip — to archive* queda apagado
  con su porqué (`data-tip`). **Qué protege cada lado:** la guarda es de la interfaz; el zip no tiene un camino propio en
  el portero ni en la base (baja cada original con el mismo `POST /pass` + `/m/` con que se ve una foto, que pide nivel
  1). Del lado del servidor no se puede distinguir "bajar para el zip" de "abrir una foto": un miembro con Ver sigue
  pudiendo bajar cada original de a uno, como hoy (`Plan_Workspaces.md`, sección 4). Cerrar eso del lado del servidor
  sería quitarle a Ver la bajada de originales, una decisión aparte.

### EX8 · Comentarios y correos

- **Qué pasaba:** los comentarios son internos muchas veces ("el cliente no se va a dar cuenta"). Mandarlos en el PDF
  por error es grave; perderlos al archivar, también.
- **Las opciones:** A) casilla en las dos salidas: destildada en el PDF, tildada en el zip; con el nombre del autor y
  **ningún correo en ningún archivo**, tampoco en el JSON para volver: quien exportó se reconoce por una huella con sal
  de su correo, y los demás vuelven solo con su nombre. B) Nunca en el PDF. C) Siempre, con correos.
- **Elegí A porque** cada salida arranca con lo seguro para su caso y se puede cambiar. La primera versión llevaba los
  correos en el JSON; la auditoría (B1) mostró que al reimportar quedan en `imported_author_email` y `list_comments` se
  los da a cualquier invitado del workspace de destino: los correos del equipo de A a la vista de los clientes de B.
- **Si preferís otra:** B es sacar la casilla del PDF.

### EX9 · Qué archivos van en el zip

- **Qué pasaba:** un proyecto de rodaje puede tener 5 GB de fotos y 40 GB de videos. Ejemplo: archivar la película
  entera con los clips de referencia, o mandarle al cliente las fotos de set sin los videos.
- **Las opciones:** A) casillas con su peso, como "Available offline": *Original photos*, *Attachments* y *Videos*
  tildadas, *Drive folders* destildada (entrega 4); las tarjetas de un Drive ajeno, solo como link. B) Siempre todo.
  C) Solo fotos.
- **Elegí A porque** el peso a la vista antes de empezar deja decidir, y para archivar lo normal es todo; las carpetas de
  Drive pueden ser cientos de GB y ya tienen su *Download all*. La ventana muestra además los pedidos al portero que va a
  gastar (Worker y Durable Object, sección 5), y las vistas JPEG van siempre, tildado o no.
- **Si preferís otra:** cambiar qué arranca tildado es una línea.

### EX10 · Dónde va un archivo usado en varias páginas

- **Qué pasaba:** la misma foto de referencia puede estar en el desglose y en tres escenas.
- **Las opciones:** A) una sola vez, en `Files/` de la primera página que la usa (en el orden del árbol), y las demás la
  apuntan. B) Todo en una carpeta `media/` global. C) Una copia por página.
- **Elegí A porque** el que abre la carpeta de una escena encuentra ahí sus fotos, sin duplicar gigas.
- **Si preferís otra:** B simplifica el código; C duplica el peso.

### EX11 · Nombres de las carpetas

- **Qué pasaba:** el orden del árbol se pierde si las carpetas se ordenan por nombre ("Día 10" antes que "Día 2"), y los
  títulos tienen espacios, barras y tildes.
- **Las opciones:** A) número de orden + título limpio con guiones bajos (`02_Rodaje/01_Dia_1`). B) El título tal cual.
  C) Los ids.
- **Elegí A porque** conserva el orden en cualquier explorador y sigue tu regla de carpetas sin espacios del Drive; los
  nombres de los archivos quedan como están en el Drive. Cada carpeta de página se topa en 60 letras (condición de la
  auditoría: el Explorador de Windows no pasa de 260 caracteres por ruta).
- **Si preferís otra:** B es sacar el número y el cambio de espacios.

### EX12 · Pasado el tope de memoria (Safari, Firefox, teléfono)

- **Qué pasaba:** en el iPhone el zip se arma en memoria hasta 500 MB; un reporte con videos pasa eso enseguida.
- **Las opciones:** A) ofrecer el zip liviano (fotos a 2048 en vez de originales, sin videos), o una rama, o hacerlo
  desde una computadora con Chrome o Edge. B) No dejar. C) Partir en varios zips de 500 MB.
- **Elegí A porque** es lo mismo que decidió D24 para *Download all*, sumando una salida útil desde el teléfono.
- **Si preferís otra:** C se puede sumar después (varios zips, cada uno con su `_shotdocs` parcial).
- **Cambiada por Lega (2026-10-02, D63 → B):** desde un teléfono **no se exporta zip**, solo el PDF. Se detecta con el
  mismo criterio que el tope de *Download all* para "teléfono" (`isMobilePlatform(detectPlatform())`, `install.ts`):
  iPhone, iPad y Android, con la app instalada, Safari o Chrome del teléfono (el iPad con Safari de escritorio se
  reconoce por el táctil). Una computadora con pantalla táctil sí exporta. Pasado el tope de memoria en Safari y
  Firefox de computadora queda lo de A: *Lighter zip* (sin fotos originales ni videos), una rama, o Chrome y Edge.

### EX13 · Sin red

- **Qué pasaba:** estás en el set sin señal y el cliente pide el PDF del día.
- **Las opciones:** A) exportar con lo que hay en el dispositivo, avisando antes lo que falta y anotándolo. B) Pedir red
  siempre. C) Esperar la red automáticamente.
- **Elegí A porque** el texto ya está siempre en el dispositivo y la app es offline primero; el aviso evita creer que
  un zip incompleto es un archivo completo. Lo exportado dice "como estaba en este dispositivo el <fecha de la última
  sincronización>" (condición de la auditoría).
- **Si preferís otra:** B es apagar el botón sin red (como *Download all*).

### EX14 · Dónde está en la interfaz

- **Qué pasaba:** ya existe *Export PDF / Print* (un clic, Ctrl/⌘+P) para una página.
- **Las opciones:** A) *Export…* nuevo debajo, en el menú de la página, y *Export project…* en el menú de cada proyecto;
  *Export PDF / Print* sigue igual. B) Reemplazar *Export PDF / Print* por *Export…*. C) Solo en el proyecto.
- **Elegí A porque** no le cambia nada a lo que ya usás y lo nuevo está donde se busca.
- **Si preferís otra:** B es renombrar y que la ventana tenga "Esta página, PDF" como primera opción (un clic más).

### EX15 · El link público y la papelera

- **Qué pasaba:** con P.19 alguien sin cuenta puede abrir una página; y un proyecto en la papelera de proyectos se puede
  restaurar.
- **Las opciones:** A) el visitante de un link no exporta en las primeras entregas; un proyecto archivado sí, uno en la
  papelera no. B) El visitante exporta el PDF de su página desde la primera. C) Exportar también desde la papelera.
- **Elegí A porque** el link tiene topes de bajada por día que un zip se come de un tirón, y la papelera ya se resuelve
  restaurando.
- **Si preferís otra:** B es la entrega 4 adelantada, con los topes del link.

## 12. Lo que no se pudo comprobar

- Safari (Mac e iPhone) y Firefox con las páginas con nombre de CSS (`page:`): solo se midió Chromium.
- La memoria real de una vista con miles de fotos y la vista previa del diálogo de imprimir de Chrome (el prototipo usa
  `page.pdf`, el mismo motor sin la vista previa).
- ~~Cuánto tarda el editor de exportación por página con el esquema real~~: medido en la entrega 0 (al final).
- La velocidad de bajada del Drive por el portero con un proyecto entero, y los llamados reales al Durable Object (la
  cuenta de unos 4 por archivo sale de leer el código, no del panel).
- La memoria de la vista y los topes de píxeles en el iPhone (WebKit).

## Cómo se midió

Prototipo en Chromium sin ventana (Playwright, `page.pdf` con `preferCSSPageSize`), fuera del repo: una vista con un
índice de links internos y N páginas, cada una con `page:` de uno de tres formatos (`@page sd-a4`, `sd-a5l`,
`sd-letter`, margen de 20 mm), texto y fotos JPEG de 480×360 hechas en un canvas. El PDF se leyó con pdf.js
(`pdfjs-dist` del repo): tamaño de cada hoja y anotaciones de link con destino interno.

- 6 páginas: 9 hojas (3 A4, 4 A5 horizontal, 2 Carta), 12 de 12 links internos, 61 ms.
- 100 páginas × 10 fotos: 168 hojas, 200 de 200 links internos, 14,3 MB, 285 ms.
- 300 páginas × 10 fotos: 506 hojas, 600 de 600 links internos, 42,9 MB, 783 ms.

La auditoría repitió el prototipo (mismas hojas, tamaños, links y pesos; tiempos 1,4 a 1,9 veces más lentos con la
máquina ocupada) y midió aparte la memoria de la vista según el tamaño de la foto (sección 5). El prototipo no imprime
los números de hoja del índice, solo los links; esos números se prueban en la entrega 1.

## Correcciones de la auditoría (2026-10-02)

Auditoría independiente del diseño en `6dd06b1`: **aprobado con condiciones**, 2 bloqueantes y 12 observaciones. Todo
quedó aplicado en el texto de arriba; esta tabla dice dónde.

| Hallazgo | Corrección |
|---|---|
| **B1** · Los correos del equipo en `comments.json` quedaban, al reimportar en otro workspace, en `imported_author_email`, que `list_comments` da a cualquier invitado | Ningún correo en ningún archivo exportado. Cada comentario de quien exporta lleva `mine: true`, y el manifest una sal al azar y la huella `SHA-256("shotdocs-author:" + sal + ":" + correo)` de quien exporta; al importar, si coincide con quien importa, esos quedan a su nombre; si no, todos entran con el nombre y el correo nulo. Del resto del equipo no viaja ni la huella (secciones 2.3, 3 y 4; EX8) |
| **B2** · El `.html` del zip no mostraba los HEIC (Chrome y Firefox no los abren) ni nada con *Original photos* destildada | `Files/_view/` siempre, con una JPEG por foto y por video (la nítida de 2048 o la miniatura; un HEIC se convierte en el dispositivo); el `.html` y el `.md` muestran la vista con link al original cuando está; el peso de las vistas se suma en la ventana (sección 2.3; EX4) |
| 1 · El colapsado para todos no está en los bloques (mapa `collapsedHeadings`) | Se exportan las claves `true` de ids que existen y se escriben al importar (secciones 2.3, 2.4 y 3) |
| 2 · El cupo que manda es el del Durable Object (~9800 llamados para ERSO, ~10 % del día); un `/m/` por archivo, no uno cada 16 MiB | Sección 5 con las dos cuentas; la ventana muestra los dos números; la entrega 2 los mide en el panel; riesgos y EX9 |
| 3 · Los ids de los comentarios al reimportar chocan en el mismo Supabase | uuid de `SHA-256("shotdocs-comment:" + proyectoNuevo + ":" + idViejo)`, como `codaCommentId` (sección 3) |
| 4 · Hilo con el primer comentario borrado y respuestas vivas | La primera respuesta viva abre el hilo, anotado; en el PDF y el HTML, "(deleted comment)" arriba (secciones 2.2 y 3) |
| 5 · El diario de "seguir donde quedó" se podía cruzar con un zip editado | Clave `shotdocsImport:<id>:<SHA-256 del manifest>` (sección 3) |
| 6 · Importar guarda cada archivo en el dispositivo antes de subirlo | `navigator.storage.estimate()` y el aviso antes de empezar; en el iPhone, desaconsejado pasado 1 GB (sección 3) |
| 7 · Fotos del PDF: achicar todas al tamaño impreso, y el tope del teléfono en píxeles | Toda foto a su ancho impreso a 200 ppp; topes en píxeles decodificados, con lo medido por la auditoría (secciones 2.2 y 5; EX2) |
| 8 · Los números de hoja del índice dependen de que coincidan los cortes | Respaldo: índice sin números donde no coincidan; aviso de márgenes y escala (sección 2.2, riesgos, prueba de la entrega 1) |
| 9 · `CSS.supports('page', …)` no prueba que el diálogo respete las hojas | Lista de navegadores probados con `window.print()` y *Save as PDF* reales (sección 2.2; EX3; entrega 1) |
| 10 · Lo que se escribe en el zip de una rama; el doc remitía a un comportamiento de la app que no existe | Sin nombre ni id del proyecto, sin `parent` de la raíz ni ids de afuera; links de afuera como texto en `.html`, `.md` y JSON; corregida la frase sobre la app (secciones 2.2 y 2.3) |
| 11 · Rutas de más de 260 caracteres en Windows | Carpeta de página topada en 60 letras (sección 2.3, EX11); lo que queda, a riesgos |
| 12 · Sin red, el árbol puede tener páginas cuyo permiso se sacó | "Como estaba en este dispositivo el <fecha de la última sincronización>" en el PDF, el HTML y el manifest (secciones 2.3 y 6; EX13) |
| (5) de las comprobaciones · BlockNote tira sin avisar una propiedad desconocida; ids de bloque repetidos en un JSON a mano | Las dos se anotan al importar; el repetido recibe un id nuevo (sección 3) |
| Medidas: el tiempo es solo `page.pdf` y el índice del prototipo no lleva números | Aclarado en "En corto", la sección 5 y "Cómo se midió" |

## Cómo quedó la entrega 0 (v0.115)

**Qué hay.** El editor de exportación y su medición, en archivos nuevos de `src/export/`, sin nada que vea un usuario
(ni menú ni ruta de la app):

- `pageContent.ts`: los bloques de una página leídos de una **copia** (`docs.snapshot` → `yXmlFragmentToBlocks`) y el
  colapsado para todos (las claves `true` del mapa `collapsedHeadings` con ids de bloques que existen). Nunca del
  documento abierto: convertir un documento con algo que la versión no conoce lo saca del documento convertido.
- `exportEditor.tsx`: un BlockNote con el esquema y las extensiones de la página (sin colapsar), montado afuera de la
  pantalla en un `article.page` como el de `PageView` (sin `data-page-id`), en solo lectura y sin colaboración. Por
  página: `replaceBlocks`, espera las imágenes (8 s), copia con `buildPrintView` y pagina con `paginateView` y
  `applyBreaks`, sin tocar `printView.ts`. Las imágenes pasan por el mismo `resolveFileUrl` que la página
  (`media.resolve`) y los adjuntos se marcan igual (`markAttachments`).
- `exportPages.ts`: `exportPlan` (la rama o el proyecto en el orden del árbol con `branchPages`, sin la papelera, con la
  hoja heredada y el encabezado sin nada de arriba de la raíz exportada) y `renderPages` (página por página, con avance,
  *Cancel* por `AbortSignal` y `onPage` para quien junta las vistas: el PDF de la entrega 1).
- `testProject.ts`: el proyecto de prueba, siempre el mismo para la misma semilla: cinco ramas en A4, A5 horizontal,
  Carta, A3 horizontal y A4; escenas con Script, preguntas, listas, tarjetas de Drive y fotos en línea en renglones;
  reportes con tablas, fotos en las celdas, salto de hoja y fotos-bloque en filas; notas con fotos de ancho propio; una
  carpeta de cada diez y una página muy larga de cada 25.
- `export.test.tsx` (8 pruebas, jsdom) y `bench/` (la medición en el navegador, solo con el servidor de desarrollo:
  `npx vite --port 5295 --strictPort` y `/src/export/bench/index.html?pages=300&photos=8`; el build no la incluye).

**La prueba de aceptación, medida en Chromium** (Playwright, sin ventana, 1440 × 900; servidor falso de
`src/sync/testing.ts`, sin login ni red; fotos JPEG de 1600 × 1200 hechas en un canvas y guardadas con la cola de la
app, que hace sus miniaturas de 480):

| | Corrida final | Las cuatro corridas |
|---|---|---|
| Proyecto | 300 páginas, 2219 fotos, 1,8 MB de bloques | 2130 a 2219 fotos |
| Hojas | 1590 | 1569 a 1590 |
| Exportar las 300 páginas | **14,5 s** (por página: 50 ms la mediana, 81 ms el p95, 124 ms la peor) | 14,5 a 38,9 s |
| Leer la copia / poner bloques / esperar imágenes / copiar / paginar | 2,6 / 4,8 / 6,5 / 0,2 / 0,4 s | |
| Lo guardado de cada página antes y después (SHA-256 de sus filas, su estado y el documento armado) | 0 de 300 distintas | 0 de 300 |
| Una página abierta en el editor mientras tanto | 0 cambios recibidos, el mismo documento | igual |
| Cambios del árbol en cola | 0 antes, 0 después | igual |
| Hojas de cada página contra las marcas de la pantalla (`PageView` real con `SheetBreaks`) | 300 de 300 iguales: las mismas hojas y el mismo bloque (y altura) donde empieza cada una; el encabezado, igual | igual en las dos corridas con la pantalla |
| Imágenes que no llegaron a tiempo | 0 | 0 |

El objetivo era menos de 60 s. Los tiempos cambian con la carga de la máquina (había otros procesos): la peor corrida
fue 38,9 s. La pantalla tardó unos 0,8 s por página en abrir y dejar quietas sus marcas: exportar es unas 15 veces más
rápido que abrir cada página.

**Lo que se aprendió (propuestas para la entrega 1; el diseño de arriba no se cambió):**

1. **El editor de exportación muestra la misma imagen que la pantalla (la miniatura), y la mejor va después en la
   copia.** La copia toma el ancho de cada foto sin ancho propio del `naturalWidth` de la imagen del editor
   (`fixMediaWidth`, `inlineNaturalWidth`): si el editor mostrara una imagen más grande, la foto saldría más ancha y los
   cortes ya no serían los de la pantalla. La sección 2.2 ("toda foto se achica a su ancho impreso a 200 ppp") se cumple
   cambiando el `src` en la copia, como hace hoy `useOriginals` en `printPage.ts`.
2. **El encabezado cuenta en las hojas.** Exportado el proyecto entero, cada página lleva el mismo encabezado que en
   la pantalla (medido: 300 de 300). Exportada una rama, la raíz pierde los contenedores de arriba (regla 2), tiene un
   renglón menos y sus cortes pueden correrse respecto de las marcas de la pantalla. Los números del índice salen de la
   paginación de lo exportado (lo que se imprime), así que siguen siendo ciertos; la prueba de "iguales a las marcas de
   la pantalla" vale para el proyecto entero y para las páginas cuyo encabezado no cambia.
3. **Abrir una página puede escribir** (la reparación de la estructura al abrir, `normalizeStructure`). La primera
   corrida sin la pantalla dio una página "cambiada": era la página que la medición abría en el editor, no lo exportado.
   Por eso exportar lee solo copias (`docs.snapshot`) y nunca llama a `docs.open`.
4. **La memoria.** Soltando cada vista apenas se pagina, la memoria de JavaScript no crece (358 → 357 MB, con el
   proyecto entero en la base en memoria). Con las 300 vistas juntas (3643 imágenes, lo que hará el PDF), los procesos de
   Chromium pasaron de 1653 a 2106 MB (+453 MB) con las vistas afuera de la pantalla, sin dibujar; el diálogo de
   imprimir las decodifica todas y eso lo mide la entrega 1 (sección 5).
5. **Las tarjetas de Drive** se dibujan igual en el editor de exportación (la copia lleva la tarjeta y el link, sin el
   reproductor) y su `iframe` es `loading="lazy"` y está afuera de la pantalla, así que no se carga.
6. **Lo que no se midió:** (corregido en la auditoría de la entrega 1: la base local de la medición fue `fake-indexeddb`,
   que `src/sync/testing.ts` pone también en el arnés del navegador, no el IndexedDB de Chromium; los 14,5 s son una cota
   pesimista; leer la copia fue el 18 % del tiempo) el iPhone (WebKit) y
   Firefox, a mano en la entrega 1; videos y adjuntos (necesitan el portero y la vista previa de PDF; se dibujan con el
   mismo bloque `image` y la misma marca que la página).

## Cómo quedó la entrega 1 (v0.122)

**Qué ve el usuario.** *Export…* en el menú ⋯ de la página (debajo de *Export PDF / Print*, que sigue igual) y *Export
project…* en cada proyecto del selector (ícono en la computadora, renglón en el menú del teléfono), solo para quien ve
el proyecto entero (`projectLevel ≥ 1`). La ventana *Export "<título>"* ofrece *This page* / *This page and the pages
inside (N)* (o *The whole project (N pages)*), el PDF para compartir, las casillas *Sharp photos* y *Comments*
(destildadas), los avisos (navegador fuera de la lista, márgenes y escala) y *Export PDF*. Mientras arma: "Preparing
page 34 of 240: <título>" con *Cancel* (Escape no cierra). Al terminar abre el diálogo de imprimir (en un táctil, con el
botón *Open the print dialog*, que pide el toque); la vista queda armada hasta cerrar la ventana y Ctrl/⌘+P vuelve a
abrir ese PDF. La ayuda suma *Export pages and projects as one PDF*; sin atajos nuevos.

**Cómo está hecho** (`src/export/`):

- `exportPdf.ts`: arma la vista del PDF con el editor de la entrega 0 y le suma, por página, los avisos arriba del
  título, los links entre páginas (adentro: `#sd-x-<id>`, link interno del PDF; afuera: solo el texto; `javascript:`
  nunca), los comentarios y las fotos achicadas; la vuelve a paginar (`paginateExport`, las unidades de siempre más las
  de la exportación, **en el orden del documento**) y la pone con su hoja de CSS (`page: sd-A4`, `@page sd-A4 {…}`). El
  índice se pagina al final con la hoja de la raíz y recién ahí lleva los números. `printBook` pone las reglas `@page`,
  las clases `sd-printing` y `sd-export-printing` (sin esta, el libro no se imprime: el Imprimir del navegador mientras
  la ventana arma imprime la página de siempre) y el nombre del PDF (título de la raíz y fecha), y lo deja todo como
  estaba al cerrar el diálogo. Las anotaciones de las fotos (P.20) se dibujan en el editor de exportación con el mismo
  `attachMarkupOverlay` de la página, desde el mapa `photoMarkup` de la copia, antes de copiar la vista.
- `exportImages.ts`: cada foto, la mejor del dispositivo (original, nítida de 2048 o la miniatura que se ve; con *Sharp
  photos*, la nítida pedida al Drive por el portero, hasta 1000), abierta una vez y achicada a su ancho impreso a
  200 ppp (tope 2400 px), de a cuatro a la vez **en Workers** (`resize.worker.ts`, `OffscreenCanvas`; donde no hay, en
  el hilo principal). El tope cuenta los píxeles ya achicados.
- `exportComments.ts`: con *Comments*, antes de dibujar baja los comentarios de cada página del plan (`comments.refresh`,
  lo mismo que abrir la página; "Fetching comments: page N of M", cancelable), así salen los de los demás en las páginas
  que el dispositivo no abrió; sin red, salen los del dispositivo y el índice y la ventana lo dicen. Después, los hilos
  guardados más lo que la cola tiene sin subir; el autor por nombre (la parte del correo antes de la `@`, también si
  alguien escribió su correo como nombre en el link público), nunca un correo; "(deleted comment)" arriba de un hilo
  con el primero borrado.
- `printSupport.ts`: la lista medida (Chrome y Edge de computadora, por `userAgentData` o el `userAgent`) y si es un
  táctil (puntero grueso o teléfono; una computadora con pantalla táctil no cuenta).
- `exportPages.ts`: una página que no se puede leer o dibujar se saltea con su aviso en el PDF y siguen las demás.
- `bench/pdf.tsx` + `pdf.html`: el arnés de la medición (espera a que la cola de fotos no tenga subidas pendientes;
  ojo: corre sobre `fake-indexeddb`, ver abajo).

**Las observaciones de la auditoría de la entrega 0:** O3, una foto que no carga ya no se espera dos veces (si las del
editor vencieron, las de la copia no se esperan) y después de tres páginas seguidas con vencimiento la espera baja a 1 s
(probado: 6 páginas con fotos que no llegan nunca, las tres primeras en ~200 ms con el tope en 200, las demás por
debajo de 150); el rechazo de `resolveFileUrl` se atrapa. O4, los bloques se ponen fuera del historial de deshacer
(`undoDepth` 0 después de exportar). O5, la prueba de "iguales a las marcas de la pantalla" queda para el proyecto
entero; en una rama, los números del índice salen de lo que se pagina (medido abajo, también con una rama). O6, una
página con contenido de una versión más nueva sale con "Part of this page needs a newer version of the app…" arriba y
la ventana lo cuenta; una página que falla se saltea marcada. O7, la quinta rama del proyecto de prueba es libre (sale
en A4).

**Primera medición (con la impresión real, antes de la regla de no abrir navegadores instalados):** Chrome 154 con
`--kiosk-printing` y Edge 154 (el documento de la vista previa de *Save as PDF*) imprimieron el proyecto de 300 páginas
(299 sin la de la papelera, 2219 fotos, comentarios en 43): **1618 hojas de 1618** que dice la app, ninguna de otro
tamaño que su página, el título de las 299 en la hoja que dice el índice y los 299 links del índice a esa hoja; PDF de
56,5 MB, 882 millones de píxeles, memoria del navegador de 3,6 GB (4,7 GB en Edge con la vista previa); ningún correo,
nada guardado cambiado. También una rama (67 de 67 hojas) y todo con la hoja de la raíz (272 de 272 en A4). Esa
medición encontró un error: la paginación ordenaba las unidades por altura y un salto de hoja vacío (mide 0) quedaba
arriba de todo; la página empezaba con su encabezado solo en una hoja. Se ordena por el documento, con su prueba.
**Desde entonces solo se mide con el Chromium de Playwright sin ventana y `page.pdf`.**

**El tiempo (corregido por la auditoría de la entrega 1).** Los "197 s" de la primera medición eran del arnés, no de
exportar: (1) `media.idle()` espera las miniaturas, no las subidas, y al empezar quedaban 2187 de 2219 fotos subiéndose
al servidor falso, en el mismo hilo; (2) `src/sync/testing.ts` importa `fake-indexeddb/auto`, que reemplaza también en
el navegador el IndexedDB por uno en JavaScript. Con el IndexedDB del navegador y la cola quieta la auditoría midió
39 a 54 s (mediana 49 s), el 75-80 % en achicar fotos en el hilo principal. **Con el achique en Workers** (esta entrega)
y *Comments* tildada (bajar los comentarios de las 300 páginas incluido): **32,8 y 29,3 s**, con 15,1 y 13,2 s de CPU
del hilo principal (antes, ~44 s), 1621 hojas, 882 millones de píxeles (Chromium de Playwright sin ventana,
`correcciones/perf-desglose.mjs` de la auditoría con `NATIVE_IDB=1`). Objetivo: menos de 60 s.

**El recorrido de la auditoría, repetido después de las correcciones** (la app de verdad sobre el servidor falso,
Chromium sin ventana, PDF con `page.pdf`): **45 de 45 pasos bien**: la ventana con los círculos y las casillas en su
línea (computadora y teléfono), los comentarios de otra persona en una página que el dispositivo no abrió salen en el
PDF, ninguno se pierde ni cambia (solo se suman los del servidor), Ctrl+P mientras arma no imprime el libro, el índice
cierto en los 6 PDFs (rama, proyecto, invitado, fuera de la lista, teléfono, Mac), *Cancel* sin dejar nada.

**Los topes.** Computadora: 500 páginas y 1000 millones de píxeles (el proyecto de 300 páginas son 882 millones);
**con menos de 8 GB según `navigator.deviceMemory` (Chrome y Edge), 400 millones**: el diálogo de imprimir decodifica
todas las fotos a la vez (1000 millones son unos 4 GB). El tope de píxeles se descubre mientras arma: la ventana lo dice
y ofrece las ramas de primer nivel. Teléfono: 60 páginas y 50 millones, sin medir.

**Lo que no se midió (para Lega, a mano):** Chrome y Edge guardando de verdad con *Save as PDF*, Safari de la Mac,
Firefox, el iPhone y el iPad (hojas mezcladas, memoria, el toque para abrir el diálogo), una compu de 8 GB con el
proyecto más grande, *Sharp photos* con el portero real, las anotaciones en el PDF con fotos reales, videos y adjuntos.

## Cómo quedó la entrega 2 (v0.129)

**Qué ve el usuario.** La ventana *Export* suma *Format*: *PDF — to share* (lo de la entrega 1) o *Zip — to archive*.
Con el zip: *Original photos*, *Attachments* y *Videos* tildadas, cada una con su cantidad y su peso, y *Comments*
tildada; el resumen ("3 pages · 5 files · 19.7 KB · previews 200 KB"), los pedidos al portero estimados ("≈ 10 file
server requests · 1% of today's limit", el porcentaje es el del Durable Object, sección 5) y, sin red, cuántos originales
van a faltar. Chrome y Edge de computadora: *Download .zip…* (escrito a medida que se arma) y *Download to a folder…*
(el mismo árbol, sin zip, en una carpeta nueva); los demás: *Prepare .zip* en memoria (1 GB) y al terminar *Save
<nombre>.zip*; pasado el tope, *Lighter zip* (sin fotos originales ni videos). Mientras: "Preparing page 2 of 3: …",
"Downloading files: 4 of 5 (15 KB of 20 KB)", "No connection: it continues when it comes back." y *Cancel*; Escape no
cierra y la pestaña pide confirmar antes de cerrarse. Al terminar: dónde quedó y "2 things are missing" con *Show
list*. Solo el dueño y los admins, y nunca desde un teléfono o una tableta (D60, D63: el círculo del zip apagado con su
porqué). La ayuda suma *Export pages and projects as a zip*; sin atajos nuevos.

**Cómo está hecho** (`src/export/`):

- `exportZip.ts` (`buildZip`): página por página en el orden del árbol, con el editor de exportación de la entrega 0
  (sobre una copia, sin colaboración). De cada página se escriben primero los archivos que usa por primera vez (EX10):
  la vista JPEG (`Files/_view/`: la nítida guardada en el dispositivo o la miniatura; de un video, el cuadro que se ve en
  la página; de un HEIC sin ninguna, su original pasado a JPEG con el convertidor de la app, bajado una vez si hace
  falta) y los originales que piden las casillas: los del dispositivo directo; los demás, por el portero con
  `runDownload` de *Download all* (reintentos, `Range`, el pase que vence, esperar la red, cancelar). Recién después su
  `.html`, su `.md` y su JSON, así cada link apunta a un original que llegó de verdad; uno que no llegó deja la vista
  sin link y su renglón en `MISSING_FILES.txt`. Al final, `_shotdocs/manifest.json`, `_shotdocs/comments.json`,
  `style.css` con las letras de la app en `fonts/`, `index.html` y `MISSING_FILES.txt` si falta algo. `estimateZip`
  pesa por tipo sin bajar nada (lee las copias de las páginas y las fichas de los archivos).
- `archiveHtml.ts`: el `.html` (la copia de la vista de impresión, sin `<script>`, atributos `on…`, `javascript:`,
  reproductores ni atributos del editor; cada foto con su vista y link al original; los links a otra página del zip a
  su `.html`, los de afuera como texto; `@page` con la hoja de la página), el `.md` (la conversión de BlockNote; cada
  foto `[![nombre](vista)](original)` con rutas relativas, D57; el salto de hoja como `<!-- shotdocs:page-break -->`;
  los comentarios como citas) y los bloques para volver (los links de afuera, solo texto, también en las tablas).
- `zipLayout.ts`: las carpetas `02_Rodaje/01_Dia_1` (número con los ceros que hagan falta, sin espacios, sin tildes en
  las letras latinas, 60 letras como mucho), los nombres de `Files/` y `_view/` y las rutas relativas.
- `src/media/folderZip.ts`: `runDownload` suma `part` (escribe en un zip o una carpeta que arma otro, sin cerrarlo ni
  poner `MISSING_FILES.txt`) y `passFor` (el pase recién cuando le toca a cada archivo).
- `src/ui/ExportZip.tsx`: la parte del zip de la ventana (los destinos son los de *Download all*: `dirTarget`,
  `freshFolder`, `BlobSink` con su tope, el CRC en un Worker).
- `bench/zip.tsx` + `zip.html`: el arnés del navegador (solo con el servidor de desarrollo; el build no lo incluye).

**Lo que nunca sale (probado byte por byte en el zip, que va sin comprimir):** el texto escrito y borrado, la foto
sacada (ni su nombre, ni su id, ni sus bytes), la página de la papelera, la rama de afuera (ni su título ni su id), el
id y el nombre del proyecto en una rama, y ningún correo (ni del dueño ni de Ana, la del equipo que comentó). Los
comentarios van con nombre, `mine` para los de quien exporta y la huella con sal (sección 4). Exportar no cambió ninguna
página ni el árbol del dispositivo (comparado byte por byte antes y después).

**Medido en el navegador** (Chromium y Firefox de Playwright sin ventana, perfil temporal; el arnés con el servidor y el
portero en memoria, fotos JPEG de 1600 px hechas en un canvas, un HEIC de verdad sin miniatura, un video con su cuadro,
un PDF, una tabla con una foto en una celda, comentarios): tres zips (armado en Chromium con originales, en Firefox solo
con las vistas, en Firefox con originales), los tres abiertos por Python `testzip` sin errores (56 entradas con originales, 50 sin ellos; 28 son
las letras), y cada `.html` abierto con `file://` y la red cortada en **Chromium y Firefox: 7 de 7 imágenes cargadas en los
dos, también la del HEIC (pasado a JPEG en Chromium y en Firefox) y con *Original photos* destildada**, ningún
`<script>`, ningún pedido afuera de `file:`, ningún link roto en el `.html` ni en el `.md` (14 de 14 en el `.md`). Armar
el zip: 0,4 a 0,9 s para 4 páginas. Nada guardado cambió. Suite: 2839 pruebas (2834 pasan, 5 salteadas), 19 nuevas en
`src/export/exportZip.test.tsx` (jsdom, servidor y portero en memoria, Python `testzip`). La ventana pasa de 35 a 77 KB
(su pedazo se baja aparte, al abrirla).

**Lo que no se midió (para Lega, a mano):** ERSO entero en Chrome con el portero de verdad (tiempo, pedidos al Worker y
llamados al Durable Object en el panel de Cloudflare: la sección 5 sigue siendo una cuenta, no una medición), Safari de
la Mac (el zip en memoria y *Save*), el árbol más hondo de ERSO contra los 260 caracteres del Explorador de Windows, y
un zip de más de 1 GB en Firefox (el tope).

### Correcciones de la auditoría de la entrega 2 (O1 y O6)

- **O1 · Rutas largas de Windows.** Con tres niveles de títulos largos, una ruta del zip llegaba a 442 caracteres y el
  Explorador (tope de 260, contando `C:\Users\<usuario>\Downloads\<zip>\`) no la abría ni la descomprimía. Ahora
  (`zipLayout.ts`): **el zip no tiene carpeta de arriba** (el Explorador ya crea `<nombre del zip>\` al descomprimir; el
  árbol de la sección 2.3 queda igual sin la primera línea), **la página raíz de una rama queda arriba de todo** con el
  nombre del zip (`Rodaje.html` junto a `index.html`; si se llamara `index`, `index_page`), el nombre del zip se topa
  en 40 letras, y cada carpeta de página y cada nombre de archivo se acortan con un **presupuesto**: ninguna ruta pasa
  **180** caracteres (en UTF-16, como cuenta Windows) contando una carpeta de destino típica
  (`C:\Users\` + 20 letras + `\Downloads\` + el nombre del zip). Cada carpeta reparte lo que queda entre ella y los
  niveles que tiene abajo (y entra entera con su `.html`, que repite su nombre); los archivos conservan la extensión y
  van de 12 a 80 letras; nunca se parte un emoji. Dos hermanas no chocan (el número va adelante) y dos archivos que solo
  difieren en mayúsculas siguen separados con « (2)». Los paréntesis de los nombres van codificados en los links
  (`%28`, `%29`): un `)` suelto cortaba el link en el `.md`. El manifest dice dónde quedó cada página y cada archivo,
  así que volver (EX6) no depende de los nombres. Probado con un árbol hostil (títulos de 200 letras con emojis, 6
  niveles, hermanas iguales, fotos de 180 letras con el mismo nombre): la ruta más larga cabe, ninguna entrada repite el
  nombre del zip, sin choques, y cada link del `.html`, del `.md` y del manifest existe en el zip, en una rama y en el
  proyecto entero.
- **O6 · Marcas de plantilla (v0.124).** El manifest guardaba solo `format`, `header` y `split`. Ahora `settingsOf`
  suma `template` (la página es una plantilla propia, o `false`), `templatesFolder` y `dayReports` (la carpeta de
  reportes; su plantilla solo si también se exporta: nunca el id de una página de afuera), y cada página lleva
  `templateId` (de qué plantilla salió: una de fábrica o una de adentro; `null` si quedó afuera). La entrega 3 (volver)
  tiene que escribirlas al crear el proyecto nuevo, cambiando los ids viejos por los nuevos; hasta que exista, la prueba
  es que el manifest las lleve, en el proyecto entero y en una rama.

## Cómo quedó la entrega 1b (v0.134: los cambios de Lega al PDF, D84, D85 y D88)

**Qué ve el usuario.** En la ventana *Export*, la casilla *Sharp photos* se reemplaza por *Smaller file (lower-resolution
photos)*, destildada (D85): sin tildar, cada foto va como se tomó, en resolución completa; tildada, achicada a su ancho
impreso a 200 ppp (lo de la entrega 1, con la nítida de 2048 pedida al Drive si hace falta). Sin red, la ventana avisa que
las fotos cuyo original no está en el dispositivo van en menor resolución. Ya no hay "demasiadas páginas o fotos,
exportá una rama": si lo elegido pasa un tope, el PDF sale **en partes** (D84): "Part 1 ready: pages 1 to 33 of 300 ·
120 PDF pages", el diálogo de imprimir con el nombre `<título> <fecha> Part 1`, y *Prepare part 2*, que arma la siguiente
soltando la anterior ("Save this part first"); en la última, "This is the last part". El índice de cada parte dice
"Part 2 · pages 34 to 55 of 300" y solo lleva sus páginas; un link a una página de otra parte queda como texto. Al
terminar (la última parte o el único PDF), **la lista de las páginas que fallaron** (D88), juntas de todas las partes:
el título como link (cierra la ventana y abre la página; con Ctrl/⌘ o la rueda, en otra pestaña) y *Export again*, que
la exporta sola en un PDF aparte y la saca de la lista si sale bien. La ayuda (*Export pages and projects as PDF*, antes "as one PDF")
lo cuenta; sin atajos nuevos.

**Cómo está hecho:**

- `exportImages.ts`: con `full`, cada foto pide su original (`ImageSource.original`: el del dispositivo, o bajado
  entero del Drive por el portero con `porteroDownload`; nunca de un video ni de un adjunto, y nunca se guarda).
  `jpegInfo` lee la cabecera (medidas, giro de EXIF, canales) sin decodificar: un JPEG derecho de 1 o 3 canales entra
  **tal cual** (como `image/jpeg`); uno girado, CMYK, una PNG o un WebP se pasan a JPEG del mismo tamaño, ya derecho, en
  los Workers; un HEIC que el navegador no abre, con el convertidor de la app (`heicConvert`). La foto sin original a
  mano (sin red) sale achicada como antes y se cuenta (`lowRes`). `PixelBudget` cuenta píxeles y peso. Si se pasa el
  tope, `shrinkImages` deja cada foto con la imagen de antes, suelta sus `blob:` y tira el error.
- `exportPdf.ts`: `buildPdf` arma **una parte**: desde `from`, hasta el tope de páginas o hasta que las fotos de una
  página no entran en lo que le queda a la parte (esa página va primera en la siguiente: nunca se parte una página).
  Una página que sola no entra en resolución completa sale con las fotos achicadas y avisada arriba del título; si ni
  así, se saltea marcada ("too many photos for one PDF"). El libro dice `from`, `to`, `total`, `part` (o `null` si
  entró todo) y `bytes`. Los comentarios se bajan una vez para todas las partes (`appComments` recuerda lo bajado y
  `stale` dice cuáles quedaron con lo del dispositivo).
- `exportPages.ts`: `onPage` puede devolver `'stop'`. `ExportDialog.tsx`: las partes, *Smaller file*, la lista de las
  que fallaron. `bench/parts.tsx` + `parts.html`: el arnés de la medición (solo con el servidor de desarrollo).

**Por qué los originales se pasan antes a JPEG (medido en Chromium 153 sin ventana, `page.pdf`, página suelta con
fotos de 4032 × 3024).** 300 JPEG derechos: el PDF pesa lo mismo que las fotos (280 MB: Chrome los copia sin
decodificar), `page.pdf` tarda 3,8 s y la memoria sube 0,46 GB con 3658 millones de píxeles: **manda el peso, no los
píxeles**. Con perfil de color (Adobe RGB, como el Display P3 del iPhone), igual. Pero 20 JPEG con el giro de EXIF de
una foto vertical: el PDF pesa 123 MB en vez de 19 y tarda 9,8 s (Chrome decodifica y vuelve a codificar cada una); 20
PNG, 12,8 s. Por eso esas se pasan antes a JPEG derecho en los Workers, en paralelo.

**El proyecto de 300 páginas con originales** (300 páginas, 2219 fotos de 4032 × 3024 de 3,75 MB con ruido, una de cada
cuatro giradas; servidor falso, IndexedDB del navegador, Chromium 153 sin ventana, `page.pdf` por parte):

| Tope de peso por parte | Partes | Armar + PDF por parte | Todo | Memoria sobre la app quieta (pico) |
|---|---|---|---|---|
| 800 MB (el primer valor) | 11 de ~780 MB | 7 a 11 s + 7 a 10 s | 188 s | +3,0 a +4,6 GB |
| 500 MB (80 páginas) | 5 de ~500 MB | 6 a 7 s + 6 a 7 s | 57 s | +2,0 a +2,9 GB |
| 400 MB (80 páginas) | 6 de ~390 MB | 3 a 5 s + 3 a 4 s | 47 s | +0,9 a +2,7 GB |
| *Smaller file* (80 páginas) | 1 de 13 MB | 6,3 s + 2,4 s | 10 s | +0,3 GB |

Lo de la parte anterior tarda en soltarse (la memoria de la segunda parte en adelante es más alta que la de la primera,
pero no crece parte tras parte). En ninguna corrida cambió nada guardado (300 de 300 iguales, byte por byte), ninguna
foto salió en menor resolución y ninguna página falló. **Los topes quedan (D84, con la memoria):** por parte, 500 MB y
2000 millones de píxeles en una computadora (unas 130 fotos de teléfono), 200 MB y 800 millones con menos de 8 GB, y
60 MB y 150 millones en un teléfono o una tableta (sin medir); más el de páginas de siempre (500 y 60). El navegador
no distingue una compu de 8 GB de una de 32 (`deviceMemory` llega a 8): 500 MB deja margen en la de 8. El proyecto de
prueba sale en unas 17 partes; con *Smaller file*, en una.

**Lo que no se midió (para Lega, a mano):** el diálogo de imprimir de verdad con *Save as PDF* y su vista previa con
una parte de 500 MB (Chrome y Edge, también en una compu de 8 GB), originales reales de iPhone (HEIC y JPEG con P3) por
el portero de verdad (tiempo de bajada y pedidos al Worker: unos dos por foto), Safari, Firefox y el iPhone con partes.

### Correcciones de la auditoría de la entrega 1b (O1 a O9)

- **O1 · *Cancel* con una bajada colgada.** La señal de cortar llega a cada bajada (`original` y `best` de
  `deviceImages`, `porteroDownload` y su `fetch`), y cada foto corre en carrera con ella: *Cancel* vuelve enseguida
  aunque un `fetch` no termine nunca. Cada bajada tiene un tope de tiempo (`ORIGINAL_TIMEOUT_MS`, 90 s: un original de
  44 MB a 1 MB/s entra); la que vence sale achicada, se cuenta, y su página va a la lista de D88 ("some photos took too
  long to download…") para *Export again*.
- **O2 · Fotos gigantes giradas.** Lo que se pasa a JPEG entero va de a pocas: un semáforo por píxeles
  (`DECODE_PIXELS`, 150 millones en curso: dos fotos de 61 MP, o una sola más grande; una de medidas desconocidas, como
  un HEIC, sola). Más de 100 millones (`MAX_CONVERT_PIXELS`) no se pasa entera: se achica a su ancho impreso desde su
  propio original, sola, y se cuenta. El peso del JPEG nuevo vuelve a chequearse contra el tope. **Medido de nuevo**
  (arnés `parts.tsx`, Chromium sin ventana, todas giradas): 13 fotos de 50 MP, **+2,1 GB** (la auditoría midió +3,4 GB
  de a cuatro); 13 de 108 MP, **+1,1 GB** (antes +6,6 GB), achicadas desde el original; las de teléfono en partes de
  500 MB, +1,4 a +3,1 GB (como antes).
- **O3 · Sin red, las miniaturas no se contaban.** `isPhoto` dice `null` cuando no se sabe (sin red y sin la ficha
  guardada) y eso se cuenta igual; solo un video o un adjunto (con tipo conocido) no cuentan.
- **O4 · README** al día (resolución completa, *Smaller file*, partes, la lista). **O5 · Ayuda:** el título pasa a
  *Export pages and projects as PDF*.
- **O6 · Originales bajados dos veces.** Si una página no entra en una parte, los originales que ya trajo pasan a la
  siguiente (`PhotoLimitError.fetched` → `PdfBook.carry` → `BuildOptions.carry`): como mucho los de una página.
  Probado: 12 fotos en 3 partes, 12 pedidos.
- **O7 · *Export again* en el teléfono.** En un táctil, *Prepare part N* y *Export again* quedan apagados (con su
  `data-tip`) hasta que se abre el diálogo de imprimir de lo que está listo: así nada se suelta sin guardarse.
- **O8 · Prueba de la lista solo al final.** La prueba de las partes hace fallar una página de la parte 1 y comprueba
  que la lista no aparece en las partes 1 y 2 y sí en la 3.
- **O9 · El PDF con originales para quien solo ve.** No es una decisión nueva: Lega ya decidió en D60 que el PDF lo
  saca cualquiera que vea (el zip, solo dueño y admins). Con D85 ese PDF lleva las fotos en su resolución original.
- **O10 y O11** (el margen de 500 MB en una compu de 8 GB; Safari y Firefox sin medir) quedan para la prueba a mano.

## Cómo quedó la entrega 3 (v0.135: volver a Shot Docs desde el zip)

**Qué ve el usuario.** En el selector de proyectos, **dueño y admins** (los que crean proyectos) tienen *Import Shot
Docs archive…*, al lado de *New project*. La ventana pide el zip con un selector de archivo común (anda también en el
iPhone y el iPad) o, en una computadora, *Choose unzipped folder*. Antes de empezar dice qué trae ("“Reporte ERSO”: 240
pages and 2459 files (5.7 GB). It also has 31 comments."), cuántas fotos vuelven solo con su vista y cuántos archivos
no están en el zip, el espacio libre del dispositivo (si no entra, lo dice y *Import* queda apagado), "Connect Google
Drive first" si trae archivos y el Drive no está conectado, y en un teléfono o una tableta, pasado 1 GB, que es más
seguro desde una computadora. El nombre del proyecto nuevo es editable. Mientras: "Page 3 of 9: <título>" y que no se
cierre la ventana (la app pide confirmar antes de cerrarse, con las guardas de la importación de Coda). Al terminar:
"Imported 9 pages and 5 files.", los comentarios que suben con la sincronización, la lista de lo que hay que revisar y
*Open project*. Si se cortó, elegir el mismo zip ofrece *Resume*. La ayuda suma *Import a Shot Docs archive*; sin atajos
nuevos. Un comentario que volvió se ve "from an archive".

**Cómo está hecho:**

- `src/export/zipReader.ts`: lee el zip por partes (`Blob.slice`): el final y el directorio central (Zip64 incluido),
  y cada archivo recién cuando se pide, con su **CRC32** comprobado. Sin comprimir (el de la app) es un pedazo del mismo
  `Blob`; con *deflate* (el Explorador o el Finder al volver a comprimir), por `DecompressionStream`, cortado si
  descomprime más de lo que dice (una bomba). Un nombre con `..`, absoluto (`/`, `C:`, una ruta de red), con caracteres
  de control o partes vacías no se ofrece y queda anotado; también uno cifrado, con otro método o repetido. Un zip
  cortado (sin su final) o algo que no es zip es un error claro. `folderSource` hace lo mismo con la carpeta
  descomprimida; `subSource`, con un zip que alguien volvió a comprimir con su carpeta de arriba. Nada se escribe en el
  disco: lo que sale del zip va a la base del navegador por `media.add`, como soltar una foto.
- `src/import/shotdocsImport.ts`: `openArchive` busca `_shotdocs/manifest.json` (arriba o dentro de una sola carpeta) y
  lo revisa (`format` mayor que 1: "Update the app to import this archive"; sin `format`: no es un archivo de Shot
  Docs; páginas sin uuid o repetidas, salteadas y anotadas). `importArchive` crea el proyecto, todas las páginas en el
  orden del árbol (`treePlan` de la importación de Coda: un padre que no está o un círculo, al primer nivel y anotado),
  después por página: los ajustes (hoja, encabezado, títulos cortos), el ícono y las **marcas de plantilla** con los ids
  nuevos (`template_id`, `template`, `templatesFolder`, `dayReports.template`; una de fábrica queda igual, una de
  afuera no se escribe), los archivos que usa por primera vez (`media.add`), los bloques y, en el mismo documento, el
  colapsado para todos y las **anotaciones** (`carryMarkup` de pegar una foto anotada, con el id de archivo nuevo y
  dentro de los topes). Los comentarios, con `import_comment`.
- `src/import/archiveBlocks.ts`: cada bloque contra el esquema de la app (tipos, propiedades y su tipo, estilos), los
  `sdmedia://` al archivo nuevo, los links a páginas del archivo a la página nueva y los ids de bloque conservados (los
  usan los comentarios y el colapsado). Todo lo que cambia queda anotado por página.
- `src/export/pageContent.ts` y `exportZip.ts`: el JSON de cada página suma `photoMarkup` (las anotaciones de las fotos
  que están en la página, solo los valores vigentes). Es un campo nuevo del mismo `format: 1`: un zip de v0.129 a v0.134
  vuelve sin anotaciones.
- `src/import/codaImport.ts`: `writePage` se exporta y acepta lo que se escribe después de los bloques; sus editores sin
  pantalla ya no piden las fotos (un `sdmedia://` en un `<img>` era un pedido que fallaba en la consola).
- `src/import/importJob.ts`: la misma importación de Coda con `kind: 'archive'`: una a la vez por workspace, con las
  mismas guardas (cerrar la app, cambiar de workspace, la otra pestaña); los textos de esas guardas pasan a decir "An
  import is running".
- La base: `supabase/migrations/20261021120000_comentarios_archivo.sql` suma `'shotdocs'` a `comments.imported_from` y
  sube `schema_version` a 18 (`ARCHIVE_COMMENTS_SCHEMA_VERSION`). **Sin aplicar.** Su prueba va en
  `supabase/tests/comentarios_importados_permisos.sql` (sin correr: pide la base).

**Lo probado** (suite con Node 22: NUMEROS_SUITE; nuevas: `zipReader.test.ts` 8, `archiveBlocks.test.ts` 6,
`shotdocsImport.test.tsx` 11, `importArchiveDialog.test.tsx` 4; `tsc` y `npm run build` limpios; la ventana va en su
pedazo aparte, de 47 KB):

- **Ida y vuelta** (servidor y portero en memoria): un proyecto de 9 páginas con un título colapsado para todos, Script,
  pregunta, foto en línea, tabla con una foto en una celda, foto anotada (dos formas, una con un campo de una versión
  más nueva) con su ancho, salto de hoja, links adentro y afuera, listas con hijos, una subpágina con la misma foto, la
  plantilla de fábrica del reporte, una carpeta *Templates* con una plantilla propia, una carpeta de reportes que la
  usa, una página de esa plantilla con ícono, video y PDF, y cuatro comentarios (uno resuelto, uno de Ana, un hilo con
  el primero borrado). Exportado e importado por otro dispositivo del dueño: el árbol, los ajustes y las marcas de
  plantilla iguales (por título), **cada página bloque por bloque igual, con los mismos ids de bloque** (más de 20
  bloques), el colapsado y las anotaciones iguales, los 5 archivos una vez cada uno con los mismos bytes y subidos, los
  4 comentarios con su autor, fecha y resuelto, ningún correo, ningún id viejo en el árbol nuevo.
- Dos importaciones del mismo zip en el mismo Supabase: dos proyectos, 8 comentarios con ids distintos, sin choques;
  un admin que no exportó: todo a nombre del autor, ninguno a su nombre.
- Sin los originales: 3 fotos vuelven desde su vista (anotada, con su marco) y avisadas; el video y el PDF quedan como
  "clip 001.mov (not in the archive)", sin ningún id viejo. Una rama: su raíz arriba, el link a la rama de afuera como
  texto.
- **La versión publicada de la app** (`fixtures/editorSchemaMain.ts`) abre una página importada y no cambia nada (ni un
  update, el mismo fragmento y las mismas anotaciones).
- Cortes: un corte justo después de guardar una página y antes de anotarlo; al seguir, 9 páginas, el contenido igual
  (sin una copia abajo), los archivos y los comentarios una vez. Si la persona escribió en una página antes de que la
  importación llegara a escribirla, lo importado va debajo. Sin lugar para un archivo: esa página queda para seguir y al
  seguir se reescribe con el archivo.
- La base sin la migración (versión 17): los comentarios esperan, la importación queda para seguir; con la base al día,
  *Resume* los suma.
- Zips hostiles: uno que no es zip, uno cortado a la mitad o sin sus últimos bytes, uno de una versión más nueva, con el
  manifest roto, sin `format` o sin `id`: el error y ningún proyecto creado. Un manifest editado a mano (rutas con `..`
  y `C:/`, una página repetida, una sin uuid, dos páginas en círculo, un JSON roto, un archivo `../../evil.exe`): las
  cuatro páginas válidas, lo demás anotado, nada leído afuera del archivo. Nombres peligrosos en el zip, CRC cambiado,
  bomba de *deflate*, Zip64 y *deflate* de verdad en `zipReader.test.ts`.
- Mutaciones: sacar el colapsado, las marcas de plantilla, las anotaciones o el "va debajo" hace fallar alguna prueba.
- **El recorrido en Chromium** (Playwright sin ventana, el arnés `src/export/bench/import.html` con el servidor de vite:
  arma un proyecto con fotos JPEG de verdad, otro dispositivo lo exporta y la ventana de verdad importa en un tercero):
  11 de 11 pasos bien. Un archivo que no es zip y el zip cortado avisan con *Import* apagado; el bueno muestra "7 pages
  and 4 files (112 KB). It also has 2 comments."; *Import* tarda 283 ms; las 7 páginas iguales bloque por bloque, con
  el colapsado y las anotaciones; los 4 archivos con los mismos bytes y subidos; los 2 comentarios a nombre de quien
  importa, sin correo; ningún error en la consola.

**Lo que no se midió (para Lega, a mano):** ERSO entero (2459 archivos, 5,7 GB) importado en Chrome con el portero de
verdad: el tiempo, el espacio que pide el navegador mientras sube y la subida al Drive; Safari y el iPhone (elegir un
zip grande desde Archivos); la migración aplicada y su prueba SQL.

### Decisiones de la entrega 3 (tomadas sin Lega, a confirmar)

- **EX16 · Quién importa.** Qué pasaba: D60 dejó el zip para dueño y admins, y volver crea un proyecto. Opciones: A)
  quien crea proyectos (dueño y admins, `canCreateProject`); B) cualquiera que edita; C) solo el dueño. Elegí **A**: es
  el mismo permiso que *New project* y el mismo grupo que exporta el zip; la base ya lo exige al crear el proyecto.
- **EX17 · Los comentarios vuelven, con un origen propio y la base al día.** Qué pasaba: el diseño pide
  `imported_from = 'shotdocs'`, que la base de hoy rechaza. Opciones: A) migración nueva y la app importa los comentarios
  solo con la base en la versión 18 (con una más vieja, los deja para *Resume* y lo avisa); B) marcarlos `'coda'`
  (prohibido por el diseño); C) no traerlos. Elegí **A**: nada se pierde (quedan en el zip y la importación queda para
  seguir) y nada falla a medias. Sin red al empezar (la versión de la base no se sabe), van a la cola como siempre.
- **EX18 · Una foto sin su original.** Qué pasaba: con *Original photos* destildada, el zip trae solo la vista JPEG
  (2048 o la miniatura). Opciones: A) subir la vista como la foto (`IMG_0413.jpg`), avisado por foto; B) dejar un
  marcador. Elegí **A** para las fotos (se ve y se anota: la vista tiene la misma proporción, así las anotaciones caen
  donde estaban) y el marcador para videos y adjuntos (el cuadro de un video no es el video).
- **EX19 · Los links.** El diseño decía `https:` y `mailto:`; quedan también los `http:` (un link de la persona,
  inofensivo). Un `/p/<id>` (también con el dominio de la app) a una página del archivo va a la página nueva; a una de
  afuera, su texto. `javascript:`, `data:` y lo demás, texto, anotado.
- **EX20 · Sin red.** Se puede importar sin red, como la de Coda: todo queda en el dispositivo (páginas, archivos,
  comentarios) y sube al volver. Es lo más seguro para no perder nada: nada depende de la red a mitad.
- **EX21 · Seguir donde quedó sin duplicar.** Antes de escribir una página se anota la huella de lo que se va a escribir
  (probada en un documento aparte): un corte entre escribir y anotar no deja la página "editada por la persona" con una
  copia abajo. Si el editor no acepta los bloques de una página (un zip armado a mano), va su texto en párrafos, anotado.
- **EX22 · La carpeta descomprimida.** Además del zip, *Choose unzipped folder* en una computadora (el diseño lo
  preveía para Chrome y Edge; anda en todos los de escritorio con `webkitdirectory`).
