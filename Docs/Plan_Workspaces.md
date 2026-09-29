# Plan: workspaces, equipo, invitados y archivos

Todo lo que se va decidiendo sobre cómo se organiza la app para trabajar en equipo. Es la base de las
fases que siguen: se lee antes de tocar login, permisos, archivos o compartir. Lo que se implementa pasa
a los documentos de referencia y sale de acá. Decisiones: D-17 (archivos) y D-18 (workspaces).

## 1. Qué es un workspace

- Un **workspace** es de un dueño, tiene un nombre (el de Lega: **Wanka**, su estudio) y varios
  proyectos adentro.
- Usa las cuentas de su dueño: **su Supabase** (login, textos, permisos), **su Drive** (fotos, videos,
  PDFs), **su correo** (Resend, para el código de entrada) y **su portero de archivos** (sección 6).
- **Cada workspace es una isla:** nada de uno pasa por los servidores de otro ni por los de Lega.
- La misma persona puede estar en varios workspaces (el de su estudio, el de un cliente) y tener el suyo.
  La cuenta es aparte en cada uno: se entra con el correo en cada workspace.
- **La app es una sola** (la dirección pública de Lega) y se conecta a cualquier workspace: nadie
  necesita publicar su propia copia. Quien quiera, puede. Los datos van directo del navegador al
  workspace; quien publica la app sirve el código, así que hay que confiar en esa publicación.
- El workspace de hoy (el Supabase de Lega, con el proyecto MGTZD) pasa a ser **Wanka**, sin migrar nada.

## 2. Primera vez que se abre la app

Pantalla de bienvenida con dos caminos:

1. **Unirme a un workspace.** Se entra con el link que mandó el dueño (o se lo pega). El link trae la
   dirección del workspace; la app pide el correo, manda el código y entra directo a lo compartido.
   Solo entra quien fue invitado: el registro está cerrado y el correo tiene que estar en la lista de
   invitaciones de ese workspace.
2. **Crear mi workspace.** Una guía paso a paso, con capturas, en inglés (con castellano cuando la app
   sea bilingüe, D-16):
   1. Cuenta y proyecto en Supabase (gratis). Aplicar la configuración de la app (hoy con un comando;
      más adelante un botón "Conectar Supabase" que crea el proyecto y lo configura solo).
   2. Cuenta en Resend con un dominio propio, para mandar los códigos de entrada. Sin dominio no se puede
      crear un workspace (decisión de Lega: es lo que importa para su uso).
   3. Google Cloud: un cliente OAuth para que la app use el Drive del dueño.
   4. Cloudflare (gratis): el portero de archivos.
   5. Pegar en la app la dirección del Supabase nuevo y entrar como dueño.
   - **No hace falta Vercel ni publicar la app.**
   - Los pasos se arman con lo que se hizo para el workspace de Lega (Doc_Supabase: correo, dominio,
     login con código).

Después de la primera vez, el selector de arriba muestra **Workspace › Proyecto**, y "Unirme" o
"Crear" quedan en ese menú.

## 3. Personas y roles

**Roles en el workspace:**

| Rol | Qué puede |
|---|---|
| Dueño | Todo. Paga las cuentas. Conecta Drive. |
| Admin | Crear proyectos, invitar y sacar gente, dar permisos, vaciar papeleras. |
| Miembro | Solo lo que se le comparta, con el permiso que se le dé. No crea proyectos. |
| Invitado | Alguien de afuera (un cliente): solo las páginas que se le compartan. |

**Permiso sobre un proyecto o una página** (vale para lo que tiene debajo, nunca para lo de arriba):

| Permiso | Qué puede |
|---|---|
| Ver | Leer y bajar archivos. |
| Comentar | Ver + dejar comentarios y responder preguntas. |
| Editar | Comentar + escribir y subir o borrar archivos. |
| Editar y crear páginas | Editar + crear, mover y borrar páginas adentro. |

**Proyectos privados:** un proyecto nuevo es privado; solo lo ven su creador y quien reciba permiso.
Los admins no ven los proyectos privados de otros (decisión a confirmar con Lega). Así Lega puede tener
proyectos personales dentro de Wanka sin que el equipo los vea.

## 4. Compartir con un cliente (invitado)

Caso típico: Lega arma un brief o un desglose, y se lo manda al cliente con preguntas.

- Lega elige una o varias páginas (cada una con sus subpáginas y nunca lo de arriba), escribe el correo
  del cliente y el permiso (por ejemplo, Comentar, o Editar para que suba archivos). Puede sumarle más
  páginas después.
- El cliente recibe un correo con el link. Lo abre **en el navegador, sin instalar nada**, entra con el
  código que le llega y cae directo en lo compartido. No ve nada más del workspace.
- Puede comentar, responder preguntas y subir archivos (según el permiso). Los archivos van al Drive de
  Lega, como todo lo del workspace.
- Hace falta sumar **comentarios** a la app (en un bloque o en un texto elegido, con respuestas y
  resuelto/no resuelto) y un tipo de bloque o marca para **preguntas** que el cliente contesta.
- Un link público (sin login) es otra cosa y queda para después; para material sensible, siempre con
  login.

## 5. Archivos (D-17)

- Los originales van al **Drive del dueño del workspace**, también lo que suben miembros e invitados.
- Carpetas: `<carpeta de Wanka> / <proyecto> / <día de calendario> / IMG_1234.HEIC`. Renombrar el
  proyecto renombra su carpeta (si el dueño no la renombró a mano). Las páginas apuntan al id del
  archivo, así que moverlo o renombrarlo en Drive no rompe nada. Lo que se agregue a mano en Drive la app
  no lo ve: el Drive es el respaldo, no una carpeta que la app lea.
- En la página: una miniatura chica guardada en Supabase. La foto grande y el video vienen del Drive por
  el portero.
- **Carrete:** clic en una foto o video abre todas las de la página, en orden, con siguiente/anterior,
  zoom y play. Es parte central de la app.
- **Video:** se reproduce en la app lo que el navegador del dispositivo pueda (H.264 en todos lados;
  HEVC del iPhone en Apple y en la mayoría de las computadoras con Windows). Lo que no, siempre muestra la
  miniatura y ofrece bajarlo. ProRes no se ve en navegadores.
- **Pegar un link de Drive:** como link, texto o tarjeta reproducible (el reproductor de Drive, que anda
  si quien mira tiene acceso con su Google, como en Coda).
- **Papelera de archivos** por proyecto: un archivo que ninguna página usa aparece en la pestaña
  Archivos de la papelera (con miniatura, peso y fecha). A los **30 días** se puede vaciar; vacían el
  dueño y los admins. Recién ahí va a la papelera de Drive (30 días más para recuperarlo desde Drive).
- Sin red (en rodaje): la foto o el video se guarda en el dispositivo y sube por partes cuando hay red,
  con la app abierta.

## 6. El portero de archivos

- Un programa chico en la cuenta de Cloudflare del dueño (gratis). Guarda la conexión con el Drive del
  dueño; nadie más recibe esa llave (con ella se abre todo lo que la app subió, de todos los proyectos).
- Para cada archivo, la app pide en Supabase un pase firmado que solo se da si la persona tiene permiso;
  el portero lo verifica y recién ahí sube o pasa el archivo en streaming.
- Cloudflare y no Supabase porque Supabase gratis solo deja 5 GB de transferencia al mes; Cloudflare no
  la cobra.
- Hace también la copia de seguridad diaria (sección 7).

## 7. Copia de seguridad

El plan gratis de Supabase no hace copias. Con material sensible hace falta una:

- **Diaria y automática:** el portero, una vez por día, baja todo el contenido del workspace (páginas,
  textos, permisos, lista de archivos) y lo guarda comprimido en el Drive del dueño, en
  `<carpeta de Wanka> / _Backups /`. Se guardan las últimas 30 diarias y una por mes. La app trae cómo
  restaurarla.
- Más adelante, una copia legible (PDF o texto de cada página) al lado de sus archivos.
- La alternativa paga es Supabase Pro (25 USD/mes), que hace copias diarias propias.
- Los dispositivos que abrieron una página tienen además su copia local, pero no es un backup.

## 8. Sacar a alguien

Deja de tener acceso en el momento. Lo que tenga bajado en su dispositivo se borra la próxima vez que la
app se conecte (decisión de Lega: alcanza).

## 9. Hosting de la app

La app es solo archivos estáticos: no usa funciones de servidor de Vercel. Vercel gratis no permite uso
comercial. Propuesta: pasarla a **Cloudflare Pages** (gratis, permite uso comercial, el dominio ya está
en Cloudflare y el portero vive ahí). Pendiente de que Lega decida (D-05).

## 10. Orden de trabajo

1. Guarda contra bloques desconocidos (una versión vieja nunca borra un video o un PDF).
2. Prueba en el iPhone (uno o dos días): qué entrega el selector de fotos y videos, subir 1 GB por el
   portero, reproducir con la app instalada, en Safari, Chrome y Windows.
3. Preparación: todo por workspace en el código y en el dispositivo, tablas de miembros y permisos,
   versión de la base por workspace. Sin cambios visibles.
4. Copia de seguridad diaria (el portero con solo esa función, si llega antes que el resto).
5. Cola de archivos nueva (por partes, sin red) y miniaturas.
6. Carrete de fotos.
7. Drive y portero; videos en el carrete.
8. Invitar al equipo a Wanka: roles, permisos por proyecto y página, proyectos privados.
9. Compartir con invitados (clientes) por correo, y comentarios y preguntas.
10. Papelera de archivos.
11. Varios workspaces: pantalla de bienvenida, selector, guía para crear uno.
12. Pegar links de Drive; copia liviana de video si hace falta.
