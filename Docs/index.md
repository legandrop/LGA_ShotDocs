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
| [`Doc_Hojas_PDF.md`](Doc_Hojas_PDF.md) | Hojas y PDF: cómo se calculan y se marcan los cortes entre hojas en el editor (sin tocar el documento) y cómo sale el PDF con la misma hoja y los mismos cortes. |
| [`Doc_Imagenes.md`](Doc_Imagenes.md) | Fotos en la página: el primer clic elige, tamaños rápidos, fotos en fila, acomodar en filas y la opción del teléfono. |
| [`Doc_Adjuntos.md`](Doc_Adjuntos.md) | Adjuntar cualquier archivo (PDF, zip…): la tarjeta, abrir y bajar, lo que sirve el portero y la seguridad. |
| [`Doc_Peso_Proyectos.md`](Doc_Peso_Proyectos.md) | Cuánto ocupa cada proyecto en el Drive (P.7, primera entrega hecha en v0.050) y el diseño de la lista de media por peso (P.8). |
| [`Doc_Colapsar.md`](Doc_Colapsar.md) | Colapsar secciones por sus títulos (P.11; entrega 1a, para vos, hecha en v0.053): qué esconde cada título, el triángulo, para vos y para todos (Shift+clic), editar con secciones colapsadas, las marcas de hoja y el PDF. |
| [`Doc_Buscar.md`](Doc_Buscar.md) | Buscar y reemplazar en la página (Ctrl/⌘+F; entrega 1, v0.051; desde v0.053 abre las secciones colapsadas) y buscar en todo el proyecto (Ctrl/⌘+K; entrega 2, v0.054): en el dispositivo, permisos, qué se busca, el índice, ir al resultado (P.12); ajustes de v0.057 (llegar a la coincidencia en páginas largas, el campo enfocado, la barra con hojas anchas). |
| [`Doc_Carrete.md`](Doc_Carrete.md) | El carrete: el visor a pantalla completa de las fotos y los videos de una página (qué entra, gestos, zoom, qué se ve sin red o si el navegador no puede reproducirlo, y cómo convive con la edición). |
| [`Doc_Colaboracion.md`](Doc_Colaboracion.md) | Editar a la vez: qué puede pasar cuando dos personas cambian el mismo bloque (lo inherente de y-prosemirror), qué se arregló en v0.052, los parches de y-prosemirror y cómo revisarlos al actualizar, la semilla con texto y la reparación de bloques. |
| [`Doc_Importar_Coda.md`](Doc_Importar_Coda.md) | Importar un doc de Coda con sus fotos: el comando que lo baja a una carpeta (`scripts/coda-export.mjs`, API de Coda en HTML) y la importación en la app (*Import from Coda…*), cómo se convierte el HTML y lo que todavía no pasa. |
| [`Doc_Sincronizacion.md`](Doc_Sincronizacion.md) | Cómo funciona la sincronización offline sin pérdidas: contenido, árbol, imágenes y estado visible. |
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
  dos (`src/ui/macShortcuts.test.ts`).
- **Claves.** Nunca se versionan. La app solo lee `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` (o sus
  variantes `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`), nunca una clave secreta.
- **Base de datos.** Las migraciones están en `supabase/migrations/` y las pruebas de permisos en
  `supabase/tests/`. `node scripts/db-migrate.mjs --test` aplica lo pendiente y corre las pruebas (ver
  `Doc_Supabase.md`).
- **Pruebas de la app.** `npm test` corre las 1101 pruebas (v0.057): sincronización (`src/sync/`, algunas con el
  editor real, en jsdom), interfaz (`src/ui/`; las de editar a la vez son `src/ui/collab*.test.ts`, ver
  `Doc_Colaboracion.md`), el cliente del portero (`src/media/`), el portero
  (`portero/src/`), el importador de Coda (`src/import/`) y los comandos que preparan un workspace y exportan de Coda (`scripts/*.test.mjs`, sin red). `npm run typecheck`
  revisa los tipos de la app pero no los del portero: esos van con `npx tsc -p portero --noEmit`.

## Direcciones de la app

La app resuelve la dirección en el navegador (`src/router.ts`); Cloudflare devuelve `index.html` para
cualquier dirección que no sea un archivo, y sin red lo hace el service worker.

| Dirección | Qué muestra |
|---|---|
| `/` | El inicio: salta a la última página abierta del proyecto elegido en ese dispositivo. |
| `/p/<uuid>` | Una página, por su id. |
| `/trash` | La papelera de páginas. |
| `/media-test` | Ya no existe (v0.042): abre la app, como `/`. Queda por si está en un link guardado o en la vuelta de Google de un portero viejo. |
| `/privacy` | La política de privacidad, en inglés (`src/ui/Legal.tsx`). **Pública:** se ve sin sesión ni workspace. |
| `/terms` | Las condiciones de uso, en inglés (`src/ui/Legal.tsx`). **Pública:** se ve sin sesión ni workspace. |

`/privacy` y `/terms` (también con barra al final) son las únicas que no pasan por el login: `App.tsx` las
muestra antes de crear el cliente del workspace. Están enlazadas en el login, la bienvenida y el menú de la
cuenta, y son las que se cargan en Google Cloud (*Branding*, ver `Doc_Roadmap.md`, punto 13).

Cualquier otra dirección (también `/p/` con algo que no es un id) se trata como el inicio.
