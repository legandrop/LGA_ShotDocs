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

```
workspaces     (id, owner_id, name, created_at)
pages          (id, workspace_id, parent_id, title, icon, sort_key, template_id,
                deleted_at, created_by, created_at, updated_at)
page_updates   (id, page_id, client_update_id, update BYTEA, created_by, created_at)   -- solo agregado
page_snapshots (page_id, state BYTEA, up_to_update_id, created_at)
page_versions  (id, page_id, state BYTEA, label, created_by, created_at)             -- historial
templates      (id, workspace_id, name, description, content BYTEA, created_at, updated_at)
shares         (id, page_id, kind, user_email, token_hash, role, expires_at, created_by, created_at)
files          (id, page_id, storage_path, mime, size, created_by, created_at)
```

- **Todo es una página.** Una "carpeta" es una página sin contenido.
- `sort_key` es un índice fraccionario: mover una página cambia una sola fila.
- `deleted_at` es la papelera. No hay borrado duro desde la app.
- `client_update_id` lo genera el dispositivo: un reintento con el mismo id no duplica nada.
- `shares.kind` es `link` o `user`; `role` es `view` o `edit`. El token de un link se guarda en hash.

## 5. Sincronización offline sin pérdidas

Es el punto más delicado. Reglas duras:

1. **Primero el dispositivo.** Cada edición se guarda en IndexedDB antes de intentar subirla. La app nunca
   depende de la red para guardar.
2. **Fusión, no pisada.** El contenido es Yjs: dos ediciones hechas offline sobre la misma página, en dos
   dispositivos, se combinan al sincronizar.
3. **Solo agregado en el servidor.** Las ediciones entran en `page_updates` y nunca se sobrescriben.
   Compactar en `page_snapshots` no borra nada hasta que el snapshot está confirmado.
4. **Cola de salida con confirmación.** Lo pendiente se borra del dispositivo solo cuando el servidor
   confirma que lo guardó. Los reintentos son seguros porque aplicar dos veces un update de Yjs no cambia
   el resultado.
5. **Sin borrado duro.** Eliminar manda a la papelera; cada página tiene historial de versiones.
6. **Estado visible.** La app muestra siempre cuántos cambios faltan subir.
7. **Estructura del árbol.** Crear, renombrar y mover páginas también pasa por la cola de salida. Si dos
   dispositivos mueven la misma página offline, gana el último movimiento, pero nunca se pierde la página
   ni su contenido. Un movimiento que armaría un ciclo se rechaza y la página queda donde estaba.

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

1. **MVP.** Login por email, árbol de páginas en la barra lateral (crear, renombrar, mover, papelera),
   editor visual con autoguardado, offline con sincronización segura y PWA instalable.
2. **Compartir.** Por usuario y por link público, con Row Level Security, visor público y las pruebas de
   la sección 6.
3. **Plantillas.** Las plantillas iniciales definidas con Lega y la opción de guardar cualquier página
   como plantilla.
4. **Pulido.** Imágenes y fotos de set (con compresión en el dispositivo), historial de versiones,
   exportar e importar Markdown y búsqueda.
5. **Distribución.** Guía de autohosteo, deploy con un clic y apps de escritorio e iOS si hacen falta.
6. **Tiempo real.** Dos personas editando la misma página a la vez.

## 10. Preguntas abiertas

- **Hosting para trabajos pagos (D-05).** El plan gratis de Vercel es solo para uso no comercial.
- **Campos de las plantillas iniciales.** Se definen con Lega antes de la fase 3.
