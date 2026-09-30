# Roadmap

Lo que falta, por importancia. El orden de trabajo lo manda `Plan_Workspaces.md` (secciones 10 y 11); las
fases originales están en `Plan_ShotDocs.md`, sección 9.

## Regla para todo lo que se haga: cada workspace es una isla

Un **workspace** es de un dueño y tiene varios proyectos. Es su Supabase (login, textos, permisos), el
Drive del dueño (fotos, videos, PDFs) y un portero de archivos del dueño. El dueño invita a su equipo:
cada miembro ve los proyectos o las páginas que le comparta, y si puede editar, sube y borra en el
Supabase y el Drive del dueño. La misma persona puede estar en workspaces ajenos y tener el suyo. Una
sola app se conecta a varios workspaces; nada de un workspace pasa por los servidores de otro (ni por
los de Lega). Se hace por partes (ver pendientes), pero **nada de lo que se haga puede complicarlo:**

- **Nada fijo en el código.** La dirección de Supabase, el dominio, el correo y los ids de Google salen
  de la configuración del workspace. El código recibe el cliente del workspace activo, nunca uno global,
  y todo lo que se guarda en el dispositivo (sesión, base local, preferencias locales) lleva el workspace
  en el nombre. Hecho en el paso 5 (v0.030): el cliente sale del workspace (`src/workspace.ts`) y los
  nombres salen de su clave local; los de Wanka siguen siendo los de siempre.
- **Los permisos pasan por membresías**, aunque hoy haya un solo miembro: nada de "el dueño es el
  único usuario".
- **Todo lo del servidor está en el repo** y se aplica igual en cualquier workspace: migraciones,
  políticas, el portero. Lo que hoy se configura en el panel de Supabase (correo, plantillas, registro
  cerrado, direcciones de redirect) tiene que pasar a `supabase/config.toml` o estar entero en
  `Doc_Supabase.md`.
- **Cada workspace dice qué versión de la base tiene** (`workspace_settings.schema_version`), y la app
  avisa claro si el dueño tiene que actualizarla (desde v0.030).
- **Ningún servicio central.** Ni proxy, ni licencias, ni estadísticas. Lo que cueste por uso lo paga el
  dueño de cada workspace con sus cuentas.
- **El plan gratis de Supabase es el techo por defecto:** nada pesado en la base ni en Storage (egress:
  5 GB al mes).
- **Los miembros nunca reciben las claves del dueño** (ni el token de Google): los archivos pasan por el
  portero, que pregunta los permisos.

## Pendientes

Ordenados en tres grupos: el plan de workspaces (primero), lo que se puede hacer sin que Lega decida
nada, y lo que espera una decisión o una acción de Lega.

### A. Plan de workspaces (D-17, D-18)

1. **Los pasos 5 a 13 de `Plan_Workspaces.md`** (sección 10, y sección 11 para cómo se hace cada uno).
   Hechos los pasos 1 a 5: copias de seguridad, guarda contra lo desconocido, hosting en Cloudflare, la
   prueba de media en la computadora y el iPhone, y la preparación (workspace en el código, miembros,
   permisos e invitaciones en la base, restaurar sobre el mismo proyecto). Absorbe la vieja fase 2 (compartir un proyecto, una
   página o una subpágina con usuarios y con links legibles, D-13) y los que figuran abajo en "Resueltos
   adentro del plan".

### B. Sin decisiones pendientes

2. **Hecho: subir solo lo propio después de bajar.** Lo bajado avanza `syncedSV` en la misma transacción
   que lo guarda, solo con lo que el servidor mandó (tramos sin huecos desde lo ya confirmado) y sin pasar
   de lo que el documento del dispositivo integró; lo propio sin confirmar nunca entra. Las pruebas
   (`src/sync/docs.test.ts`) revisan en cada paso que el vector no diga más de lo que tiene el servidor:
   ediciones sin subir mezcladas con lo bajado, updates que dependen de algo que falta, lo propio que
   vuelve del servidor, una subida en vuelo, cerrar la app a la mitad, restaurar una copia y corridas al
   azar. Ver `Doc_Sincronizacion.md`, "Contenido de las páginas", punto 4.
3. **Hecho: abrir una página vacía ya no crea un cambio.** La semilla queda en memoria y se guarda (y
   sube) junto con la primera edición, en la misma transacción; la semilla no cambió, así que dos
   dispositivos que empiezan la misma página siguen compartiendo la raíz. Ver `Doc_Sincronizacion.md`,
   "Contenido de las páginas", punto 5.
4. **Hecho: tamaño de la app.** El editor (BlockNote con ProseMirror, Tiptap y Mantine), el carrete, el
   panel de comentarios, los diálogos de miembros, compartir y Drive y la página de prueba de media se
   bajan aparte (`src/ui/lazyPart.tsx`); la primera pantalla (login, barra lateral, árbol) sale sin
   esperarlos y el editor se baja apenas el navegador queda libre. Mientras baja, el cuerpo de la página
   muestra un esqueleto (el título ya se ve). Lo que se baja al abrir, comprimido: de 591 KB (JS 542 KB,
   CSS 48 KB, HTML 1 KB) a 276 KB (JS 227 KB, CSS 48 KB, HTML 1 KB). Aparte: el editor 302 KB, el carrete
   5 KB, el panel de comentarios 4 KB, la prueba de media 5 KB, cada diálogo 2 KB (y los emojis del editor,
   110 KB, que ya se bajaban aparte). Los estilos del editor siguen en la primera carga para no cambiar el
   orden en que se aplican; las páginas de privacidad y condiciones también (son chicas y se ven sin
   sesión). El service worker precachea todo, así que sin red el editor abre igual; si después de publicar
   una versión nueva falta un archivo viejo, la app avisa y recarga una sola vez sin perder nada. Ver
   `Doc_Sincronizacion.md`, "Sin red al abrir".
5. **Hecho: el caso intermitente de la prueba de punta a punta** (`Doc_Investigacion_Intermitente.md`).
   La vista del editor nunca se atrasó. Los más de 40 s eran un dispositivo que abrió la página en solo
   lectura ("still downloading") y escribió sin que entrara, o una consulta que no respondía nunca y
   colgaba el ciclo. Y la investigación encontró una pérdida real: una recarga o un cierre a pocos
   milisegundos de la última tecla perdía el final de lo escrito. Arreglado en la app: cada edición se
   guarda en una transacción sin lecturas que se confirma en el acto, con una marca de "sin subir" en
   `meta` (la base no cambia de versión, y la "versión guardia" hace que una versión anterior que la abra
   vea pendiente todo lo que esta tuvo abierto); cada consulta a la base tiene un tope de tiempo (30 s
   más lo que tardaría a 16 KB/s, y una página que vence no frena a las demás); la barra de formato ya no se vuelve a montar (y cerrar su menú) con
   cada cambio del estado; y en solo lectura por "still downloading" se revisa cada segundo si llegó lo que
   faltaba. Ver `Doc_Sincronizacion.md`, "Contenido de las páginas" (puntos 1, 3 y 7) y "Ciclo de
   sincronización". Las correcciones de las pruebas de punta a punta (`e2e.mjs`, `features.mjs`) están en
   la investigación.
6. **Hecho: páginas de privacidad y de condiciones** (`/privacy`, `/terms`, en `src/ui/Legal.tsx`), en
   inglés y públicas: se ven sin sesión ni workspace, también sin red, con links en el login, la bienvenida
   y el menú de la cuenta. Son las que pide el punto 13: `https://shotdocs.lega.com.ar/privacy` y
   `https://shotdocs.lega.com.ar/terms`. Si cambia qué datos usa la app o dónde van, se cambia el texto y
   su fecha (`LEGAL_UPDATED`).
7. **Fase 4: hecho lo principal (cortes entre hojas y PDF).** En una página con tamaño de hoja, el editor
   marca dónde empieza cada hoja ("Page 2"…) con el alto real de la hoja menos los márgenes, sin partir un
   bloque que entra en una hoja (pasa entero a la siguiente) y partiendo entre renglones o filas lo que es
   más alto que una hoja; un título de sección pasa con el bloque que sigue. Es solo una capa: el documento
   no cambia. **Export PDF / Print** (menú de la página, o Ctrl/⌘+P) imprime con la impresión del navegador
   la misma hoja (`@page`) y los mismos cortes, sin barra lateral ni controles, con las fotos grandes si el
   original está en el dispositivo, las tarjetas de Drive como link y Script con sus colores; una página
   libre sale en A4. En el teléfono la página se ve libre y las marcas van antes de los mismos bloques. Ver
   `Doc_Hojas_PDF.md`. **Falta:** el bloque de salto de hoja (una propiedad de párrafo, para que degrade en
   una versión vieja) y probar a mano en Safari y en el iPhone.
8. **Hecho: castellano e inglés (D-16).** Toda la interfaz en los dos idiomas: pantallas, menús, diálogos,
   avisos, tooltips, estados de sincronización, errores, el carrete, comentarios, papelera, miembros,
   compartir, workspaces, bienvenida y login. Los textos están en `src/i18n/` (cada clave con los dos
   idiomas juntos, `{valores}` y plurales; `useT()` en los componentes y `t()` en lo demás), y una prueba
   revisa que cada clave tenga los dos idiomas con los mismos valores y que no sobre ninguna. El idioma es
   una preferencia de la cuenta (`language`, en el menú de la cuenta junto al tema y la fuente); de fábrica,
   castellano si el navegador está en castellano. El editor usa el diccionario en castellano de BlockNote,
   pasado a vos. Los tipos de texto se llaman Script/Guion y Question/Pregunta en la interfaz; lo guardado en
   los documentos no cambia. Quedan en inglés, a propósito: las páginas legales (con una nota en
   castellano), la guía para crear un workspace, el informe técnico de *Media test* y los mensajes que
   manda el portero. **Falta:** el correo con el código (su plantilla está en `supabase/`), la guía en
   castellano y las plantillas, que todavía no existen (fase 3), con su nombre en cada idioma.
9. **Compactar en el servidor** los updates de contenido (`page_snapshots`). Toca la regla de no perder
   datos: un snapshot nunca borra nada hasta estar confirmado, con pruebas antes.

### C. Esperan a Lega

10. **Fase 3.** Plantillas: definir con Lega los campos de *Pre-production Notes*, *On-Set Report* y
    *Shot Breakdown*.
11. **Fase 5.** Asistente con la clave de cada usuario y MCP: Lega elige entre las opciones de D-06 y D-07.
12. **Correo automático de invitaciones** (el portero lo manda con Resend): hace falta una clave de Resend
    solo para enviar, cargada por Lega en el portero. Mientras tanto, la app copia el link.
13. **Que la pantalla de Google diga "LGA Shot Docs"** (pedido de Lega). Hoy, al conectar Drive, Google
    muestra `cold-salad-d599.workers.dev` porque la app no tiene la marca verificada. Hace falta: una
    dirección propia para el portero (por ejemplo `media.lega.com.ar`, con su dirección de vuelta en el
    cliente de Google), completar **Branding** en Google Cloud (nombre, logo, página de inicio, política de
    privacidad y condiciones del punto 6 y dominio autorizado `lega.com.ar`), publicar la app (**In
    production**, así la conexión tampoco vence a los 7 días) y pedir la verificación de marca. Hasta entonces, la conexión con
    Drive vence cada 7 días y se reconecta desde la app.

### Resueltos adentro del plan

- Una foto HEIC del iPhone se ve rota en Chrome de Windows: lo arreglan las miniaturas (paso 6).
- Una imagen copiada a otra página sigue apuntando a la primera (`sdfile://<página A>/...`): al pegar en
  otra página se registra el archivo también para la nueva (pasos 6 y 9), así quien ve solo esa página
  la ve.
- D-05 (hosting para trabajos pagos): decidido, Cloudflare.
