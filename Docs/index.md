# Documentación de LGA Shot Docs

Punto de entrada de la documentación. Todo lo de `Docs/` está en castellano; el `README.md` de la raíz,
en inglés.

## Documentos

| Documento | Qué tiene |
|---|---|
| [`Plan_ShotDocs.md`](Plan_ShotDocs.md) | El plan de arranque: qué es la app, la arquitectura, el modelo de datos, la sincronización offline, los permisos para compartir, las plantillas, el autohosteo y las fases. Lo que se cierra pasa a los otros documentos. |
| [`Plan_Workspaces.md`](Plan_Workspaces.md) | El plan de workspaces, equipo, invitados, archivos en Drive, copia de seguridad y hosting, con su orden de trabajo (sección 10) y cómo se hace cada paso (sección 11). |
| [`Doc_Decisiones.md`](Doc_Decisiones.md) | Las decisiones tomadas y las que siguen abiertas, numeradas `D-XX`. |
| [`Doc_Roadmap.md`](Doc_Roadmap.md) | Lo que falta, por orden de importancia. |
| [`Doc_Supabase.md`](Doc_Supabase.md) | Cómo está armado el backend: configuración del proyecto, migraciones, pruebas de permisos y login. |
| [`Doc_Portero.md`](Doc_Portero.md) | El portero de archivos (Worker de Cloudflare del dueño): cómo guarda la conexión con Drive, sube y devuelve archivos, y cómo publicarlo y conectarlo paso a paso. |
| [`Doc_Sincronizacion.md`](Doc_Sincronizacion.md) | Cómo funciona la sincronización offline sin pérdidas: contenido, árbol, imágenes y estado visible. |
| [`Changelog.md`](Changelog.md) | El historial de cambios. Cada entrada sube `+0.001`. |

## Convenciones

- Los documentos nuevos van en esta carpeta y se suman a esta tabla en la misma pasada.
- Un documento describe cómo está la app hoy. La historia de por qué cambió algo va al changelog.
- Nombres: `Doc_<Tema>.md` para documentos de referencia, `Plan_<Tema>.md` para planes que se van
  vaciando a medida que se implementan.
- Cada tanda de cambios suma una entrada **arriba** en `Changelog.md` (`+0.001`) con el título del commit
  entre corchetes. Las entradas viejas no se reescriben.

## Reglas de trabajo

- **Auditoría antes de cerrar una fase o un paso.** Ninguna fase de `Plan_ShotDocs.md` (sección 9) ni
  ningún paso de `Plan_Workspaces.md` (sección 10) se da por cerrado sin una auditoría independiente
  contra lo que pide el plan: funcionalidad, permisos y Row Level Security, la regla de no perder datos
  al sincronizar y la documentación. Lo que encuentre se corrige antes de cerrarlo.
- **Claves.** Nunca se versionan. La app solo lee `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` (o sus
  variantes `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`), nunca una clave secreta.
- **Base de datos.** Las migraciones están en `supabase/migrations/` y las pruebas de permisos en
  `supabase/tests/`. `node scripts/db-migrate.mjs --test` aplica lo pendiente y corre las pruebas (ver
  `Doc_Supabase.md`).
- **Pruebas de la app.** `npm test` corre las 85 pruebas: sincronización (`src/sync/`, algunas con el
  editor real, en jsdom), interfaz (`src/ui/`), el cliente del portero (`src/media/`) y el portero
  (`portero/src/`). `npm run typecheck` revisa los tipos de la app pero no los del portero: esos van con
  `npx tsc -p portero --noEmit`.

## Direcciones de la app

La app resuelve la dirección en el navegador (`src/router.ts`); Cloudflare devuelve `index.html` para
cualquier dirección que no sea un archivo, y sin red lo hace el service worker.

| Dirección | Qué muestra |
|---|---|
| `/` | El inicio: salta a la última página abierta del proyecto elegido en ese dispositivo. |
| `/p/<uuid>` | Una página, por su id. |
| `/trash` | La papelera de páginas. |
| `/media-test` | La prueba de media del portero (menú de la cuenta → *Media test*, ver `Doc_Portero.md`). |

Cualquier otra dirección (también `/p/` con algo que no es un id) se trata como el inicio.
