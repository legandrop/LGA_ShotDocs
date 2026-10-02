# Documentación de LGA Shot Docs

Punto de entrada de la documentación. Todo lo de `Docs/` está en castellano, salvo las guías para usuarios
(`Guide_*.md`), en inglés; el `README.md` de la raíz, en inglés.

## Documentos

| Documento | Qué tiene |
|---|---|
| [`Plan_ShotDocs.md`](Plan_ShotDocs.md) | El plan de arranque: qué es la app, la arquitectura, el modelo de datos, la sincronización offline, los permisos para compartir, las plantillas, el autohosteo y las fases. Lo que se cierra pasa a los otros documentos. |
| [`Plan_Workspaces.md`](Plan_Workspaces.md) | El plan de workspaces, equipo, invitados, archivos en Drive, copia de seguridad y hosting, con su orden de trabajo (sección 10) y cómo se hace cada paso (sección 11). |
| [`Doc_Decisiones.md`](Doc_Decisiones.md) | Las decisiones tomadas y las que siguen abiertas, numeradas `D-XX`. |
| [`Doc_Roadmap.md`](Doc_Roadmap.md) | Lo que falta, por orden de importancia. |
| [`Doc_Supabase.md`](Doc_Supabase.md) | Cómo está armado el backend: configuración del proyecto, migraciones, pruebas de permisos y login. |
| [`Doc_Portero.md`](Doc_Portero.md) | El portero de archivos (Worker de Cloudflare del dueño): cómo guarda la conexión con Drive, sube y devuelve archivos, y cómo publicarlo y conectarlo paso a paso. |
| [`Doc_Hojas_PDF.md`](Doc_Hojas_PDF.md) | Hojas y PDF: cómo se calculan y se marcan los cortes entre hojas en el editor (sin tocar el documento) y cómo sale el PDF con la misma hoja y los mismos cortes; el salto de hoja (un párrafo con `pageBreak`): diseño y cómo quedó. |
| [`Doc_Fotos_En_Linea.md`](Doc_Fotos_En_Linea.md) | **Diseño y entregas (P.15; prototipo, entrega 1 en v0.076, entrega 2 en v0.078: crear, dar tamaño, acomodar las elegidas, hojas; la marca del renglón para las versiones viejas; entrega 3 en v0.078: convertir las fotos-bloque de una página; entrega 4 en v0.078: importar de Coda con los renglones):** la foto como un carácter del renglón, como en Coda (cursor al lado, escribir y pegar en su renglón, fluir y bajar de renglón, elegir varias con Shift y acomodar las elegidas). Qué se pide, la prueba técnica, por qué un nodo en línea nuevo, qué pasa con una versión vieja, qué cambia en cada parte de la app, las fotos que ya existen, las entregas, lo que dejó el prototipo, cómo quedaron la entrega 1a (el nodo, el parche de los huecos, los huecos estables y lo medido con dos editores) y la 1b (lo que se ve y se toca, medido en Chromium) y las preguntas para Lega. |
| [`Doc_Imagenes.md`](Doc_Imagenes.md) | Fotos en la página: el primer clic elige, tamaños rápidos, fotos en fila, acomodar en filas, la opción del teléfono, la calidad en la página (v0.058: la imagen nítida que reemplaza a la miniatura) y las fotos HEIC, que se pasan a JPEG al agregarlas (v0.075). |
| [`Doc_Adjuntos.md`](Doc_Adjuntos.md) | Adjuntar cualquier archivo (PDF, zip…): la tarjeta, abrir y bajar, lo que sirve el portero y la seguridad; la vista previa de los PDF (por qué pdf.js en el dispositivo y no la miniatura de Drive) y los adjuntos en el carrete (entrega 2). |
| [`Doc_Peso_Proyectos.md`](Doc_Peso_Proyectos.md) | Cuánto ocupa cada proyecto en el Drive (P.7, primera entrega hecha en v0.050) y el diseño de la lista de media por peso (P.8). |
| [`Doc_Colapsar.md`](Doc_Colapsar.md) | Colapsar secciones por sus títulos (P.11; entrega 1a, para vos, hecha en v0.053; "Imprimir como se ve", v0.067; mover la sección entera y para todos, v0.084, con la medición de mover con dos editores): qué esconde cada título, el triángulo, para vos y para todos (Shift+clic), editar con secciones colapsadas, las marcas de hoja y el PDF; el margen del bloque (tres puntos, [puntos] [triángulo] [texto], la barra al hacer clic, sin "Borrar") y deshacer un borrado en un paso (v0.059). |
| [`Doc_Buscar.md`](Doc_Buscar.md) | Buscar y reemplazar en la página (Ctrl/⌘+F; entrega 1, v0.051; desde v0.053 abre las secciones colapsadas) y buscar en todo el proyecto (Ctrl/⌘+K; entrega 2, v0.054): en el dispositivo, permisos, qué se busca, el índice, ir al resultado (P.12); ajustes de v0.057 (llegar a la coincidencia en páginas largas, el campo enfocado, la barra con hojas anchas); **reemplazar en todo el proyecto** (entrega 3, v0.094): el diseño auditado (escribir en el Y.Doc sin editor, qué páginas, el registro para deshacer, la regla de no perder datos) y cómo quedó. |
| [`Doc_Tutorial.md`](Doc_Tutorial.md) | **La ayuda, la recorrida y la página de práctica (P.13; entregas 1 y 2 hechas, v0.082; "Mostrame" y novedades, pendientes).** La página de práctica en memoria que no se guarda ni sincroniza, la recorrida con globitos (motor propio, pasos, teléfono, dónde se guarda que ya se vio), la ayuda con todas las funciones y el registro único de atajos (`src/ui/shortcuts.ts`) con las pruebas que lo comparan con el código, la regla de que cada función nueva suma su ayuda y cómo quedó. |
| [`Doc_Carpetas.md`](Doc_Carpetas.md) | Arrastrar una carpeta entera (P.9; **entrega 1 hecha en v0.081**, ver "Cómo quedó"): la ventana de qué se sube, la cola propia, el visor, el portero y la regla de no salir del árbol; y el diseño: el bloque de carpeta (el mismo `image` con `sdmedia://`), una vista en vivo de la carpeta de Drive, la subida directa del navegador a Google, el portero como portero, cuánto entra en el plan gratis, el visor adentro de la app, permisos, papelera y versiones viejas. |
| [`Doc_Proyectos_Borrar.md`](Doc_Proyectos_Borrar.md) | **Archivar y borrar proyectos (P.14): entrega 1 implementada (v0.077); Drive y *Delete forever*, en diseño.** Cómo quedó la entrega 1, y el diseño completo: Tres estados (activo, archivado, borrado), la papelera de proyectos con 30 días para restaurar sin borrar ninguna fila, los permisos en cero con el proyecto borrado, quién puede, la carpeta del proyecto en la papelera de Drive (portero), *Delete forever*, los demás dispositivos y las versiones viejas, la interfaz (íconos por renglón, la ventana con la palabra `delete` / `borrar`), las tres migraciones con sus pruebas SQL (corridas en rollback contra la base), las decisiones de Lega y las correcciones de la auditoría. |
| [`Doc_Compactar.md`](Doc_Compactar.md) | Diseño de compactar el contenido en el servidor (`page_snapshots`, roadmap B.9, sin implementar): el problema medido en la base y en una simulación, quién compacta y por qué, el snapshot (las filas aplicadas en orden, sin perder lo borrado) y cómo se comprueba, cómo baja un dispositivo nuevo o atrasado, las versiones viejas, las copias de seguridad, qué no se borra nunca, la migración en borrador, las pruebas y las entregas. |
| [`Doc_Copias_Locales.md`](Doc_Copias_Locales.md) | Diseño del espacio de la app en el dispositivo y de "Available offline" (P.10, D-25; entregas 0 y 1 implementadas, con "Cómo quedó" y la medición del iPhone): qué se guarda y dónde, el tope automático de 2 GB, marcar una página o un proyecto para usarlo sin red (la ventana con los pesos, la descarga, mantenerlo al día), cómo se comprueba que algo está en Drive antes de liberarlo y "Espacio en este dispositivo". |
| [`Doc_Instalar.md`](Doc_Instalar.md) | Instalar la app (v0.079): cómo se sabe si está instalada, *Install app* en el menú de la cuenta y en la pantalla de entrar, el aviso del teléfono (30 días con *Not now*), la ventana con los pasos dibujados de iPhone, Android y computadora, el botón *Install* directo de Chrome y Edge, el manifiesto y lo que falta probar en teléfonos reales. |
| [`Doc_Carrete.md`](Doc_Carrete.md) | El carrete: el visor a pantalla completa de las fotos y los videos de una página (qué entra, gestos, zoom, qué se ve sin red o si el navegador no puede reproducirlo, y cómo convive con la edición). |
| [`Doc_Historial.md`](Doc_Historial.md) | **Diseño y entregas 1 y 2 (P.18, v0.098: la lista con quién y cuándo, ver una versión y restaurarla; la migración, sin aplicar; v0.103: Show changes por persona, el texto huérfano, el Worker y la lista que se actualiza sola):** el historial de versiones de una página, como el de Google Docs. Lo que ve la persona (la lista por sesión, ver una versión con los cambios de cada persona, restaurar, copiar, en el teléfono, con hojas y fotos), cómo se arma desde `page_updates` aplicando las filas en orden (y por qué `mergeUpdates` pierde texto borrado, medido con filas reales), quién hizo cada cambio, restaurar sin perder datos (prototipo con el editor real), permisos, rendimiento con 10 000 subidas, la migración, las pruebas, las entregas, las decisiones de Lega y cómo quedaron las entregas 1 y 2. |
| [`Doc_Privacidad_Borrado.md`](Doc_Privacidad_Borrado.md) | **Diseño y entregas 0 y 1 (D14, roadmap B.18; v0.104, migración aplicada e interruptor apagado):** que lo borrado de una página no llegue a quien solo la ve, la comenta o es invitado. Qué viaja hoy (medido con filas reales, también fotos sacadas), quién recibe lo borrado (el criterio del historial), las alternativas, la base limpia (la última página entera con lo borrado como hueco, armada por un editor y servida por `pull_page_updates` a quien no edita; "solo bases", D20), el reinicio al compartir, los permisos de los archivos sacados, por qué se descartó el GC selectivo en la subida (D19), cómo convive con el historial, compactar, sin red, versiones viejas y cambios de permiso, lo que no se puede garantizar, la migración, las pruebas, las entregas, la pregunta para Lega y cómo quedó (qué cambió al implementar y qué falta para prender el interruptor). |
| [`Doc_Colaboracion.md`](Doc_Colaboracion.md) | Editar a la vez: qué puede pasar cuando dos personas cambian el mismo bloque (lo inherente de y-prosemirror), qué se arregló en v0.052, los parches de y-prosemirror y cómo revisarlos al actualizar, la semilla con texto y la reparación de bloques; desde v0.074, el texto de los huecos y los huecos estables de las fotos en línea, con su tabla medida. |
| [`Doc_Importar_Coda.md`](Doc_Importar_Coda.md) | Importar un doc de Coda con sus fotos: el comando que lo baja a una carpeta (`scripts/coda-export.mjs`, API de Coda en HTML) y la importación en la app (*Import from Coda…*, solo para la cuenta de Lega), el paso a paso, cómo se convierte el HTML, lo que todavía no pasa, los comentarios (la API no los da: se capturan con el servidor MCP de Coda a `comments.json` y entran con la importación, también los de personas sin cuenta), los links entre páginas del doc y el mismo archivo en varias páginas (v0.061), las tablas de Coda como páginas (v0.063), las fotos HEIC como JPEG (v0.072) y la migración definitiva. |
| [`Doc_Sincronizacion.md`](Doc_Sincronizacion.md) | Cómo funciona la sincronización offline sin pérdidas: contenido, árbol, imágenes, estado visible y la versión mínima de la app (también para la cola de archivos, v0.090). La subida sin GC y el aviso de lo escrito en algo que otro borró a la vez (B.16, v0.095). |
| [`Doc_Investigacion_Intermitente.md`](Doc_Investigacion_Intermitente.md) | Investigación del caso intermitente de la prueba de punta a punta (roadmap B.5) y de los dos cortes de `e2e.mjs` y `features.mjs`: qué se probó, tiempos, causas y correcciones propuestas sin aplicar. |
| [`Guide_Create_Workspace.md`](Guide_Create_Workspace.md) | **En inglés** (es para usuarios): la guía paso a paso para crear un workspace propio (dominio, Supabase y el comando `scripts/setup-workspace.mjs`, Resend, Google Cloud, Cloudflare, copias en GitHub, conectar la app y probar) y lo que las copias no cubren. |
| [`Changelog.md`](Changelog.md) | El historial de cambios. Cada entrada sube `+0.001`. |

## Convenciones

- Los documentos nuevos van en esta carpeta y se suman a esta tabla en la misma pasada.
- Un documento describe cómo está la app hoy. La historia de por qué cambió algo va al changelog.
- Nombres: `Doc_<Tema>.md` para documentos de referencia, `Plan_<Tema>.md` para planes que se van
  vaciando a medida que se implementan, `Guide_<Tema>.md` para guías paso a paso para usuarios (en inglés).
- Cada tanda de cambios suma una entrada **arriba** en `Changelog.md` (`+0.001`) con el título del commit
  entre corchetes. Las entradas viejas no se reescriben.

## Reglas de trabajo

- **Auditoría antes de cerrar una fase o un paso.** Ninguna fase de `Plan_ShotDocs.md` (sección 9) ni
  ningún paso de `Plan_Workspaces.md` (sección 10) se da por cerrado sin una auditoría independiente
  contra lo que pide el plan: funcionalidad, permisos y Row Level Security, la regla de no perder datos
  al sincronizar y la documentación. Lo que encuentre se corrige antes de cerrarlo.
- **Atajos de teclado.** En la Mac, siempre ⌘ y nunca Ctrl; en Windows y Linux, Ctrl (regla de Lega). Se
  comparan con `modPressed` e `isLetter` de `src/ui/findUi.ts`, con la plataforma como parámetro para probar las
  dos (`src/ui/macShortcuts.test.ts`). Todos están en el registro único `src/ui/shortcuts.ts`, de donde salen los
  rótulos (⌘⌥M / Ctrl+Alt+M) y la tabla de la ayuda.
- **Ayuda y atajos.** Toda función nueva que ve un usuario suma en la misma tanda: su entrada en la ayuda
  (`src/help/entries.ts` y sus textos en los dos idiomas, `src/i18n/lazy/help.ts`), sus atajos en el registro
  (`src/ui/shortcuts.ts`, con su texto en `src/help/shortcutTexts.ts`), y si cambia algo que señala la recorrida, el
  paso (`src/tutorial/steps.ts`). La auditoría de cierre lo revisa como parte de la documentación. Lo sostienen
  pruebas: `src/ui/shortcuts.test.ts` falla si el editor real, una función `is…Shortcut` o un archivo que escucha
  teclas tienen un atajo que no está en el registro, y `src/tutorial/tourState.test.ts` si un ancla `data-tour` de
  los pasos desaparece.
- **Claves.** Nunca se versionan. La app solo lee `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` (o sus
  variantes `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`), nunca una clave secreta.
- **Base de datos.** Las migraciones están en `supabase/migrations/` y las pruebas de permisos en
  `supabase/tests/`. `node scripts/db-migrate.mjs --test` aplica lo pendiente y corre las pruebas (ver
  `Doc_Supabase.md`).
- **Pruebas de la app.** `npm test` corre las 2349 pruebas (v0.104): sincronización (`src/sync/`, algunas con el
  editor real, en jsdom), interfaz (`src/ui/`; las de editar a la vez son `src/ui/collab*.test.ts`, ver
  `Doc_Colaboracion.md`; las de fotos en línea corren 300 agendas al azar por caso y suman alrededor de un
  minuto y medio), el cliente del portero (`src/media/`), el portero
  (`portero/src/`), la ayuda (`src/help/`), la recorrida y la página de práctica (`src/tutorial/`), el importador de Coda (`src/import/`) y los comandos que preparan un workspace y exportan de Coda (`scripts/*.test.mjs`, sin red). `npm run typecheck`
  revisa los tipos de la app pero no los del portero: esos van con `npx tsc -p portero --noEmit`.

## Direcciones de la app

La app resuelve la dirección en el navegador (`src/router.ts`); Cloudflare devuelve `index.html` para
cualquier dirección que no sea un archivo, y sin red lo hace el service worker.

| Dirección | Qué muestra |
|---|---|
| `/` | El inicio: salta a la última página abierta del proyecto elegido en ese dispositivo. |
| `/p/<uuid>` | Una página, por su id. |
| `/trash` | La papelera de páginas. |
| `/practice` | La página de práctica (P.13, `Doc_Tutorial.md`): un documento de ejemplo en memoria, con el editor de verdad; no es una página del árbol y no se guarda ni se sincroniza. |
| `/media-test` | Ya no existe (v0.042): abre la app, como `/`. Queda por si está en un link guardado o en la vuelta de Google de un portero viejo. |
| `/privacy` | La política de privacidad, en inglés (`src/ui/Legal.tsx`). **Pública:** se ve sin sesión ni workspace. |
| `/terms` | Las condiciones de uso, en inglés (`src/ui/Legal.tsx`). **Pública:** se ve sin sesión ni workspace. |

`/privacy` y `/terms` (también con barra al final) son las únicas que no pasan por el login: `App.tsx` las
muestra antes de crear el cliente del workspace. Están enlazadas en el login, la bienvenida y el menú de la
cuenta, y son las que se cargan en Google Cloud (*Branding*, ver `Doc_Roadmap.md`, punto 13).

Cualquier otra dirección (también `/p/` con algo que no es un id) se trata como el inicio.
