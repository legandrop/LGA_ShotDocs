# LGA Shot Docs: plan

Plan de arranque, escrito el 2026-09-29 antes de escribir código. Es la especificación de partida: lo que
dice acá manda hasta que `Doc_Decisiones.md` lo reemplace. Lo que se cierra pasa a ese documento o a un
`Doc_<Tema>.md` y se borra de acá.

## 1. Qué es

Una app de documentación para VFX al estilo de Notion o Coda, pero simple. Sirve para dos cosas:

- **Preproducción:** las notas de VFX de cada escena (qué se necesita, referencias, plan de rodaje).
- **Rodaje:** los reportes en set (datos de cámara, lentes, referencias, fotos, notas por toma).

Un supervisor la usa para sus shows y la comparte con su equipo y sus clientes. Es una sola app que se
conecta a varios workspaces, cada uno con las cuentas de su dueño: otro supervisor no instala su copia,
crea su workspace (D-18, `Plan_Workspaces.md`).

## 2. Requisitos

1. Barra lateral con un árbol de páginas y subpáginas, sin límite de profundidad.
2. Editor visual por bloques. El Markdown nunca se ve (D-03).
3. Plantillas para crear páginas con una estructura fija (sección 7).
4. Mac, Windows e iPhone.
5. Offline y online, **sin perder nunca información al sincronizar** (sección 5).
6. Compartir cualquier página por link público o con usuarios puntuales. Compartir una página comparte
   todo lo que tiene debajo y **nunca** lo que tiene arriba (sección 6).
7. Cada workspace es una isla: su propia base de datos, su Drive y su equipo; nada se comparte entre
   workspaces (sección 8).
8. Colaboración en tiempo real, al final (D-04).
9. **Formato de página real.** Una página puede ser libre o tener el tamaño de una hoja (A5, A4, A3,
   Carta), y lo que se ve al editarla es exactamente lo que sale en el PDF (sección 10).
10. **Asistente con la clave de cada usuario.** Cada usuario carga la API key de su modelo preferido y el
    asistente puede revisar y corregir textos, dar formato y ajustar imágenes (sección 11).

## 3. Arquitectura

| Pieza | Elección | Por qué |
|---|---|---|
| Frontend | App web React instalable como PWA | Un solo código para Mac, Windows y iPhone. Más adelante se empaqueta con Tauri (escritorio) y Capacitor (iOS) sin reescribirla. |
| Hosting | Cloudflare (Workers con archivos estáticos) | Deploy automático desde GitHub, gratis y con uso comercial (D-05). Antes, Vercel. |
| Backend | Supabase: Postgres, login, archivos y tiempo real | Un solo servicio. Los permisos se aplican dentro de la base con Row Level Security. Se puede autohostear con Docker (D-02). |
| Archivos grandes | Drive del dueño del workspace, con un portero (Worker de Cloudflare, `portero/`) | Supabase gratis trae 1 GB de archivos y 5 GB de transferencia al mes; Cloudflare no cobra la transferencia (D-17). En producción desde el paso 8 de `Plan_Workspaces.md` (v0.031). |
| Editor | BlockNote, editor por bloques sobre ProseMirror | Se siente como Notion, soporta Yjs y exporta a Markdown. |
| Contenido de cada página | Un documento Yjs (CRDT) | Dos ediciones offline se fusionan: nunca gana "el último". |
| Árbol de páginas | Filas de Postgres | Si el árbol fuera un documento Yjs único, cualquiera con acceso a una página recibiría el árbol entero. |
| Guardado local | IndexedDB | Toda edición se guarda primero en el dispositivo. |

La sincronización se hace por HTTP (subir lo pendiente, bajar lo nuevo desde el último punto conocido).
No hace falta un servidor propio con websockets: alcanza con Supabase y un Worker de Cloudflare (el
portero de archivos), y eso simplifica el autohosteo. El tiempo real se suma después con Supabase Realtime
como aviso de "hay cambios nuevos".

## 4. Modelo de datos

Hecho (detalle en `Doc_Supabase.md`):

```
workspaces     (id, owner_id, name, created_at)            -- proyectos: cada usuario tiene varios
pages          (id, workspace_id, parent_id, title, icon, sort_key, settings JSONB, template_id,
                update_seq, deleted_at, created_by, created_at, updated_at)
page_updates   (id, page_id, seq, client_update_id, update BYTEA, created_by, created_at)  -- solo agregado
user_settings  (user_id, prefs JSONB, updated_at)            -- tema, fuente, tamaño y ancho: por cuenta
workspace_settings (id, generation, min_app_version, schema_version, owner_id, media_url, updated_at)
               -- una fila: generación, versión mínima de la app, versión de la base, dueño, portero
storage: page-files/<page_id>/<file_id>.<ext>                -- imágenes, con los permisos de su página
```

Falta:

```
page_snapshots (page_id, state BYTEA, up_to_seq, created_at)                 -- compactar en el servidor
page_versions  (id, page_id, state BYTEA, label, created_by, created_at)     -- historial (fase 6)
members, grants, invitations                                  -- equipo y permisos (Plan_Workspaces)
```

- **Proyectos.** Un proyecto (lo que en Coda es un *doc*) es una fila de `workspaces` con su propio árbol
  de páginas; cada usuario tiene los que quiera. Una página nunca cambia de proyecto.
- **Todo es una página.** Una "carpeta" es una página sin contenido.
- `sort_key` es un índice fraccionario: mover una página cambia una sola fila.
- `deleted_at` es la papelera. No hay borrado duro desde la app.
- `client_update_id` lo genera el dispositivo: un reintento con el mismo id no duplica nada.
- `seq` es correlativo por página y `pages.update_seq` guarda el último: cada dispositivo baja "lo
  posterior a su último `seq`" sin saltearse nada.
- Los archivos no tienen tabla propia: la ruta en Storage empieza con el id de la página, y de ahí salen
  sus permisos.
- `pages.settings` guarda ajustes que valen para la página y las de adentro, salvo que alguna defina los
  suyos: cuántos contenedores muestra el encabezado, si los títulos con "|" se dividen (D-10) y el
  formato de hoja, `format = { size, landscape }` (`src/ui/pageFormat.ts`, sección 10). No hay
  `pages.format` ni un formato guardado en el proyecto.
- La tabla `shares` del plan original queda reemplazada por `members` (persona y rol), `grants` (permiso
  sobre un proyecto o una página) e `invitations` (`Plan_Workspaces.md`, sección 1 y paso 5 de la
  sección 11). El link público sin login queda para después.

## 5. Sincronización offline sin pérdidas

Implementada en la fase 1: cómo funciona está en `Doc_Sincronizacion.md`. Falta:

- **Compactar en el servidor.** Fusionar los updates viejos de una página en `page_snapshots` sin borrar
  nada hasta que el snapshot esté confirmado. Hoy solo se compacta en el dispositivo.
- **Historial de versiones** por página (fase 6).

**Riesgo conocido: el iPhone.** Safari puede borrar el almacenamiento de una web que no está instalada y
no se usa por varios días. Mitigación: instalar la PWA en la pantalla de inicio, pedir almacenamiento
persistente (`navigator.storage.persist()`) y avisar si hay cambios sin subir. Si hace falta blindarlo del
todo, la versión Capacitor guarda en SQLite nativo.

## 6. Compartir sin exponer lo de arriba

Con workspaces (D-18), compartir pasa a ser dentro del workspace, con roles y permisos: ver
`Plan_Workspaces.md`, secciones 3 y 4. La regla de esta sección sigue valiendo.

**Regla:** se puede ver la página P si existe un permiso sobre P **o sobre algún ancestro de P**. La
búsqueda va de P hacia arriba, así que un permiso nunca da acceso a los padres de la página compartida ni
a sus ramas hermanas.

- **Se aplica en la base**, con Row Level Security. Si el frontend tiene un bug, la base igual no devuelve
  lo que no corresponde: ni en el árbol, ni en la búsqueda, ni en lo que se guarda offline.
- **Links públicos:** pasan por una función del servidor que valida el token y devuelve solo ese
  subárbol, en modo lectura.
- **Usuarios puntuales:** se invitan por correo con un permiso: ver, comentar, editar o editar y crear
  páginas (`Plan_Workspaces.md`, sección 3).
- **Qué se comparte:** un proyecto entero, una página madre o cualquier subpágina. Compartir un proyecto
  es compartir todas sus raíces. Dónde aparece lo compartido queda por revisar: con varios workspaces el
  selector pasa a ser **Workspace › Proyecto** (`Plan_Workspaces.md`, sección 2), y una lista aparte
  "Shared with you" puede no hacer falta.
- **Lo compartido llega por su propio camino:** hoy el árbol se pide por proyecto propio
  (`workspace_id in (...)`). Lo que otros comparten con el usuario va en otra consulta, y la app lo
  muestra como proyecto ajeno: no se crean páginas en la raíz de un proyecto que no es propio.
- **Links legibles:** `/p/064-cubiertos-pegados-3f9c2a` (el título más un pedazo del id). Lo que manda
  es el id: renombrar la página no rompe el link (D-13).
- **Filtraciones a evitar:**
  - El breadcrumb de quien recibe el share arranca en la página compartida.
  - Un link interno a una página sin acceso se muestra sin título.
  - Mover una página adentro de una compartida avisa que va a quedar compartida.
  - Los archivos adjuntos siguen los permisos de su página.
- **Pruebas obligatorias:** un set de pruebas contra la base que verifique que ningún usuario ve un
  padre, un hermano ni un archivo de una rama que no le compartieron.

## 7. Plantillas

- Una plantilla es un contenido de página guardado con nombre y descripción.
- Al crear una página se elige una plantilla o "en blanco". La página recibe una **copia** del contenido:
  cambiar la plantilla después no toca las páginas ya creadas.
- Cualquier página se puede guardar como plantilla.
- Plantillas iniciales: *Pre-production Notes* (por escena), *On-Set Report* (por día de rodaje) y *Shot
  Breakdown*.
- **Diseño en `Doc_Plantillas.md`** (P.23): el contenido de las tres, las plantillas propias como páginas marcadas
  (reemplaza la tabla `templates` que figuraba en la sección 4) y el botón para crear el reporte del día.

## 8. Autohosteo

**Objetivo: cada workspace es una isla** (D-18). Un workspace es de un dueño, tiene varios proyectos y
su equipo de miembros invitados; usa el Supabase, el Drive y el portero de archivos de ese dueño. Una
sola app se conecta a varios workspaces y nada de uno pasa por los servidores de otro ni por los de Lega.
Se hace por partes, pero **todo lo que se hace desde ya tiene que respetarlo y no complicarlo**: ver las
reglas del principio de `Doc_Roadmap.md`.

- Cada workspace tiene su propio Supabase (login, tablas, permisos, secretos), el Drive del dueño para
  los originales (D-17) y su portero de archivos. El correo o el login con Google son del dueño.
- El repo trae las migraciones con las tablas y las políticas de seguridad, las funciones del servidor y
  el portero (`portero/`). La guía paso a paso y el comando que prepara un Supabase nuevo no existen
  todavía: son el paso 12 de `Plan_Workspaces.md`.
- No hace falta publicar la app: una sola app se conecta a cualquier workspace (`Plan_Workspaces.md`).
- Opción 100 % privada, más adelante: Supabase autohosteado con Docker.
- Las claves nunca se versionan.
- El plan gratis de Supabase es el techo por defecto: 500 MB de base, 1 GB de archivos, subidas de hasta
  50 MB y se pausa tras una semana sin uso (la app sigue andando sin red, pero no sincroniza).

## 9. Fases

1. **MVP (cerrada en v0.009, con auditoría y re-auditoría).** Login por email, árbol de páginas en la
   barra lateral (crear, renombrar, mover, papelera), editor visual con autoguardado, offline con
   sincronización segura y PWA instalable. Incluye pegar imágenes (se guardan en el dispositivo y se
   suben cuando hay red). Publicada en Vercel (hoy en Cloudflare, D-05), con correo propio (Resend) para
   entrar con código desde la app instalada en el iPhone y registro cerrado (D-09).
   Después de la fase 1, **diseño (hecho, v0.011):** login nuevo con la claqueta, ícono de anotador
   con claqueta, paleta papel y tinta con tema oscuro, menú de cuenta con tema, fuente (Default o
   Editorial), tamaño del texto y ancho de página, títulos divididos por "|" en la barra lateral y
   encabezado con los contenedores.
   **Proyectos (hecho, v0.013):** cada usuario tiene varios proyectos, cada uno con su árbol; se cambia de
   uno a otro con el selector de arriba de la barra (Ctrl+K), que también crea y renombra, con o sin red.
   **Editor (hecho, v0.015):** barra lateral de ancho ajustable, tooltips propios con el estilo de las
   apps LGA, bloque **Script** para guiones y tamaño de hoja por rama (sección 10).
   **Plan de workspaces, pasos 1 a 4 (hecho, v0.016 a v0.028):** D-17 y D-18, copias de seguridad cuatro
   veces por día, generación de la base, guarda contra lo desconocido y versión mínima de la app, hosting
   en Cloudflare, portero de archivos con Drive y la prueba de media en el iPhone.
2. **Compartir.** Absorbida por los pasos 9 (equipo) y 10 (invitados) de `Plan_Workspaces.md`: permisos
   por proyecto y página con Row Level Security, links legibles y las pruebas de la sección 6. El link
   público sin login queda para después.
3. **Plantillas.** Las plantillas iniciales definidas con Lega y la opción de guardar cualquier página
   como plantilla.
4. **Formato de página y PDF.** Cortes reales entre hojas y exportar a PDF igual a lo que se ve (sección
   10). La elección del tamaño y la vista como hoja ya están (v0.015); los cortes y el PDF también
   (`Doc_Hojas_PDF.md`), y el salto de hoja (un párrafo con `pageBreak`).
5. **Asistente.** Clave propia de cada usuario, revisar y editar textos, dar formato y ajustar imágenes,
   y acceso por MCP (sección 11).
6. **Pulido.** Compresión de fotos de set en el dispositivo, historial de versiones, exportar e importar
   Markdown y búsqueda.
7. **Distribución.** No hace falta publicar la app: una sola app se conecta a cualquier workspace, y un
   comando con su guía prepara el Supabase de uno nuevo (`Plan_Workspaces.md`, sección 2 y paso 12).
   Apps de escritorio e iOS si hacen falta.
8. **Tiempo real.** Dos personas editando la misma página a la vez.

## 10. Formato de página y PDF

En Notion y en Coda lo que se ve al editar no es lo que sale en el PDF. Acá sí.

- **Libre o con hoja.** Cada página es *libre* (ancho fluido, sin cortes) o tiene formato de hoja: A5,
  A4, A3 o Carta, vertical u horizontal, con márgenes.
- **Herencia.** El formato se puede fijar en una página y lo heredan todas las de abajo; para todo un
  proyecto ("todo este proyecto es A4") se fija en sus páginas raíz. Una página puede pisar lo heredado.
- **Lo que se ve es lo que sale.** Una página con hoja se edita con el ancho imprimible real y muestra
  dónde corta cada hoja. El PDF se genera con el mismo motor de render y la misma hoja (`@page`), así que
  los cortes, los anchos y el tamaño de las imágenes coinciden.
- **Control de cortes.** Bloque de salto de hoja; las imágenes y las tablas no se parten entre hojas; una
  imagen nunca pasa del ancho imprimible.
- Datos: `pages.settings.format` (`{ size, landscape }`, vacío = hereda), como los demás ajustes por
  rama. El formato "de todo el proyecto" se logra fijándolo en sus páginas raíz.
- **Hecho en v0.015:** elegir Libre, A5, A4, A3 o Carta, vertical u horizontal, por rama; la página se ve
  como una hoja con su ancho real (a 96 puntos por pulgada), márgenes de 20 mm y una línea donde termina
  el texto de cada hoja (su alto menos los márgenes). En el teléfono se ve libre.
- **Hecho en la fase 4 (`Doc_Hojas_PDF.md`):** los cortes reales entre hojas, calculados sobre una vista de
  impresión con el ancho real del área de texto y marcados en el editor como una capa (el documento no
  cambia); imágenes, tablas y párrafos que entran en una hoja no se parten, lo más alto que una hoja se
  parte entre renglones o filas, y una imagen nunca pasa del ancho ni del alto imprimible. La exportación a
  PDF es la impresión del navegador con la misma vista, la misma hoja (`@page`) y los mismos cortes; una
  página libre sale en A4. En el teléfono la página sigue libre, con las marcas antes de los mismos bloques.
  **Hecho después:** el salto de hoja, un párrafo con `pageBreak` (menú "/" o Ctrl/⌘+Enter; `Doc_Hojas_PDF.md`).

## 11. Asistente

- **La clave es de cada usuario.** En Ajustes, cada usuario carga la API key de su proveedor (Anthropic,
  OpenAI, Google u otro) y elige el modelo. La app no trae una clave propia ni cobra por uso. Dónde se
  guarda la clave es D-06.
- **Qué hace.** Sobre una página, una selección o una rama: revisar y corregir textos, resumir, pasar a
  formato de plantilla, reordenar y dar formato, y ajustar imágenes (tamaño, recorte, compresión).
- **Cómo edita.** Sus cambios entran como ediciones normales del documento: se sincronizan, quedan en el
  historial y se deshacen como cualquier otra. Antes de aplicar, muestra qué va a cambiar.
- **Permisos.** Actúa con los permisos del usuario: no ve ni toca nada que el usuario no pueda ver o
  editar.
- **MCP.** Además del asistente de la app, un servidor MCP para que un cliente externo lea y edite las
  páginas con los permisos del usuario (D-07).

## 12. Preguntas abiertas

- **Campos de las plantillas iniciales.** Se definen con Lega antes de la fase 3.
- **Dónde se guarda la clave del asistente (D-06)** y **cómo se expone el MCP (D-07).**
- **Formato por defecto de un proyecto nuevo (D-08).**
