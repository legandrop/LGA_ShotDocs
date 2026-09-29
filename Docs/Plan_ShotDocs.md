# LGA Shot Docs: plan

Plan de arranque, escrito el 2026-09-29 antes de escribir código. Es la especificación de partida: lo que
dice acá manda hasta que `Doc_Decisiones.md` lo reemplace. Lo que se cierra pasa a ese documento o a un
`Doc_<Tema>.md` y se borra de acá.

## 1. Qué es

Una app de documentación para VFX al estilo de Notion o Coda, pero simple. Sirve para dos cosas:

- **Preproducción:** las notas de VFX de cada escena (qué se necesita, referencias, plan de rodaje).
- **Rodaje:** los reportes en set (datos de cámara, lentes, referencias, fotos, notas por toma).

Un supervisor la usa para sus shows y la puede compartir con otros supervisores, que la instalan en su
propia cuenta.

## 2. Requisitos

1. Barra lateral con un árbol de páginas y subpáginas, sin límite de profundidad.
2. Editor visual por bloques. El Markdown nunca se ve (D-03).
3. Plantillas para crear páginas con una estructura fija (sección 7).
4. Mac, Windows e iPhone.
5. Offline y online, **sin perder nunca información al sincronizar** (sección 5).
6. Compartir cualquier página por link público o con usuarios puntuales. Compartir una página comparte
   todo lo que tiene debajo y **nunca** lo que tiene arriba (sección 6).
7. Autohosteable: cada instalación tiene su propia base de datos y nada se comparte entre instalaciones
   (sección 8).
8. Colaboración en tiempo real, al final (D-04).
9. **Formato de página real.** Una página puede ser libre o tener el tamaño de una hoja (A5, A4, A3, Carta),
   y lo que se ve al editarla es exactamente lo que sale en el PDF (sección 10).
10. **Asistente con la clave de cada usuario.** Cada usuario carga la API key de su modelo preferido y el
    asistente puede revisar y corregir textos, dar formato y ajustar imágenes (sección 11).

## 3. Arquitectura

| Pieza | Elección | Por qué |
|---|---|---|
| Frontend | App web React instalable como PWA | Un solo código para Mac, Windows y iPhone. Más adelante se empaqueta con Tauri (escritorio) y Capacitor (iOS) sin reescribirla. |
| Hosting | Vercel | Deploy automático desde GitHub. |
| Backend | Supabase: Postgres, login, archivos y tiempo real | Un solo servicio. Los permisos se aplican dentro de la base con Row Level Security. Se puede autohostear con Docker (D-02). |
| Editor | Editor por bloques sobre ProseMirror (TipTap o BlockNote) | Se siente como Notion, soporta Yjs y exporta a Markdown. |
| Contenido de cada página | Un documento Yjs (CRDT) | Dos ediciones offline se fusionan: nunca gana "el último". |
| Árbol de páginas | Filas de Postgres | Si el árbol fuera un documento Yjs único, cualquiera con acceso a una página recibiría el árbol entero. |
| Guardado local | IndexedDB | Toda edición se guarda primero en el dispositivo. |

La sincronización se hace por HTTP (subir lo pendiente, bajar lo nuevo desde el último punto conocido).
No hace falta un servidor propio con websockets: alcanza con Supabase y las funciones de Vercel, y eso
simplifica el autohosteo. El tiempo real se suma después con Supabase Realtime como aviso de "hay cambios
nuevos".

## 4. Modelo de datos

Hecho en la fase 1 (detalle en `Doc_Supabase.md`):

```
workspaces     (id, owner_id, name, created_at)
pages          (id, workspace_id, parent_id, title, icon, sort_key, template_id, update_seq,
                deleted_at, created_by, created_at, updated_at)
page_updates   (id, page_id, seq, client_update_id, update BYTEA, created_by, created_at)  -- solo agregado
storage: page-files/<page_id>/<file_id>.<ext>                -- imágenes, con los permisos de su página
```

Falta:

```
page_snapshots (page_id, state BYTEA, up_to_seq, created_at)                 -- compactar en el servidor
page_versions  (id, page_id, state BYTEA, label, created_by, created_at)     -- historial (fase 6)
templates      (id, workspace_id, name, description, content BYTEA, created_at, updated_at)   -- fase 3
shares         (id, page_id, kind, user_email, token_hash, role, expires_at, created_by, created_at)
-- fase 4: pages.format (null = hereda del padre), pages.orientation, workspaces.default_format
```

- **Todo es una página.** Una "carpeta" es una página sin contenido.
- `sort_key` es un índice fraccionario: mover una página cambia una sola fila.
- `deleted_at` es la papelera. No hay borrado duro desde la app.
- `client_update_id` lo genera el dispositivo: un reintento con el mismo id no duplica nada.
- `seq` es correlativo por página y `pages.update_seq` guarda el último: cada dispositivo baja "lo
  posterior a su último `seq`" sin saltearse nada.
- Los archivos no tienen tabla propia: la ruta en Storage empieza con el id de la página, y de ahí salen
  sus permisos.
- `shares.kind` es `link` o `user`; `role` es `view` o `edit`. El token de un link se guarda en hash.

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

**Regla:** se puede ver la página P si existe un share sobre P **o sobre algún ancestro de P**. La
búsqueda va de P hacia arriba, así que un share nunca da acceso a los padres de la página compartida ni a
sus ramas hermanas.

- **Se aplica en la base**, con Row Level Security. Si el frontend tiene un bug, la base igual no devuelve
  lo que no corresponde: ni en el árbol, ni en la búsqueda, ni en lo que se guarda offline.
- **Links públicos:** pasan por una función del servidor que valida el token y devuelve solo ese
  subárbol, en modo lectura.
- **Usuarios puntuales:** se invitan por email con rol de lectura o de edición.
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
  Breakdown*. Sus campos se definen con Lega antes de la fase 3.

## 8. Autohosteo

- Cada supervisor tiene su propio proyecto de Supabase y su propio proyecto de Vercel.
- El repo trae un script SQL con las tablas y las políticas de seguridad, y una guía paso a paso.
- Deploy con un clic desde Vercel, cargando dos o tres variables de entorno.
- Opción 100 % privada, más adelante: Supabase autohosteado con Docker.
- Las claves nunca se versionan.

## 9. Fases

1. **MVP (hecha, v0.008, con auditoría y re-auditoría).** Login por email, árbol de páginas en la barra lateral (crear,
   renombrar, mover, papelera), editor visual con autoguardado, offline con sincronización segura y PWA
   instalable. Incluye pegar imágenes (se guardan en el dispositivo y se suben cuando hay red). Para
   entrar desde la app instalada en el iPhone faltan el deploy y un servidor de correo propio (roadmap).
2. **Compartir.** Por usuario y por link público, con Row Level Security, visor público y las pruebas de
   la sección 6.
3. **Plantillas.** Las plantillas iniciales definidas con Lega y la opción de guardar cualquier página
   como plantilla.
4. **Formato de página y PDF.** Páginas libres o con tamaño de hoja, heredado por rama, y exportar a PDF
   igual a lo que se ve (sección 10).
5. **Asistente.** Clave propia de cada usuario, revisar y editar textos, dar formato y ajustar imágenes,
   y acceso por MCP (sección 11).
6. **Pulido.** Compresión de fotos de set en el dispositivo, historial de versiones, exportar e importar
   Markdown y búsqueda.
7. **Distribución.** Guía de autohosteo, deploy con un clic y apps de escritorio e iOS si hacen falta.
8. **Tiempo real.** Dos personas editando la misma página a la vez.

## 10. Formato de página y PDF

En Notion y en Coda lo que se ve al editar no es lo que sale en el PDF. Acá sí.

- **Libre o con hoja.** Cada página es *libre* (ancho fluido, sin cortes) o tiene formato de hoja: A5,
  A4, A3 o Carta, vertical u horizontal, con márgenes.
- **Herencia.** El formato se puede fijar en una página y lo heredan todas las de abajo, o en el espacio
  entero ("todo este proyecto es A4"). Una página puede pisar lo heredado.
- **Lo que se ve es lo que sale.** Una página con hoja se edita con el ancho imprimible real y muestra
  dónde corta cada hoja. El PDF se genera con el mismo motor de render y la misma hoja (`@page`), así que
  los cortes, los anchos y el tamaño de las imágenes coinciden.
- **Control de cortes.** Bloque de salto de hoja; las imágenes y las tablas no se parten entre hojas; una
  imagen nunca pasa del ancho imprimible.
- Datos: `pages.format` y `pages.orientation` (vacío = hereda) y `workspaces.default_format`.

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

- **Hosting para trabajos pagos (D-05).** El plan gratis de Vercel es solo para uso no comercial.
- **Campos de las plantillas iniciales.** Se definen con Lega antes de la fase 3.
- **Dónde se guarda la clave del asistente (D-06)** y **cómo se expone el MCP (D-07).**
- **Formato por defecto de un espacio nuevo (D-08).**
