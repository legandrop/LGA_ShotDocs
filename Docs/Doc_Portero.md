# Portero de archivos

El portero es un Worker de Cloudflare en la cuenta del dueño del workspace (código en `portero/`). Guarda la
conexión con el Google Drive del dueño, sube los archivos a su Drive y los devuelve en streaming. Nadie
más recibe la conexión con Drive: con ella se abre todo lo que la app subió, de todos los proyectos. El
plan está en `Plan_Workspaces.md`, secciones 5 y 6.

Hoy sirve para la **prueba de media** (paso 4 del plan): solo el dueño conecta Drive, sube y reproduce, y
lo subido va a la carpeta `LGA Shot Docs / Media test` de su Drive. La pantalla de prueba está en la app,
en el menú de la cuenta → *Media test*.

## Cómo funciona

- **Quién pide.** Cada pedido trae la sesión de Supabase de la persona. El portero le pregunta a
  `media_whoami()` del Supabase del workspace, con esa misma sesión: el propio Supabase la valida y dice
  quién es y si es el dueño. El portero no tiene ninguna clave de la base.
- **Conectar Drive** (una vez por workspace, lo hace el dueño): la app pide al portero la dirección de
  Google, el dueño acepta, Google vuelve al portero (`/drive/callback`) y el portero guarda la conexión
  (refresh token). Permiso `drive.file`: la app solo ve lo que ella misma sube, nada más del Drive.
- **Subir** por partes de 8 MiB: la app pide una subida (`POST /upload`), el portero abre una subida
  reanudable en Drive y la app manda las partes (`PUT /upload/<id>`) que el portero pasa a Drive. Si se
  corta, la app pregunta cuánto llegó y sigue desde ahí. Las partes pasan por el portero para que la app
  nunca tenga la conexión con Drive.
- **Ver**: la app pide un pase (`POST /pass`) y lo usa como dirección del video o la foto
  (`/m/<pase>`). El pase está firmado por el portero con una clave que genera él mismo la primera vez y
  que no sale de ahí, y vence a las 8 horas. El portero pide a Drive solo la parte que pide el navegador
  (Range), así un video se reproduce sin bajarlo entero.
- **Dónde guarda**: en un Durable Object con almacenamiento SQLite (lo trae el plan gratis de Workers): la
  conexión con Drive, las carpetas, las subidas en curso y la clave de los pases. No hay que crear nada a
  mano.
- **Por qué Cloudflare y no Supabase**: Supabase gratis deja 5 GB de transferencia al mes; Cloudflare no
  cobra la transferencia.

Direcciones que la app conoce: la del portero está en `workspace_settings.media_url` (la carga el dueño
de la base, ver abajo). Quién es el dueño: `workspace_settings.owner_id`.

## Publicarlo y conectarlo (una vez por workspace)

Hace falta la app ya publicada y la migración `20260930120000_portero.sql` aplicada.

### 1. Publicar el portero en Cloudflare

1. En Cloudflare: **Compute → Workers & Pages → Create → Import a repository**, el mismo repo de la app.
2. Nombre: `shotdocs-portero` (tiene que ser exactamente ese). En las opciones avanzadas: **Root
   directory / Path: `portero`**, y **Build watch paths: `portero/*`** (así los cambios de la app no vuelven
   a publicar el portero). Build command: vacío. Deploy command: `npx wrangler deploy`.
3. Deploy. Queda en una dirección `https://shotdocs-portero.<tu-subdominio>.workers.dev`: anotarla.
4. En el Worker → **Settings → Variables and Secrets** (las del Worker, no las del build), agregar:
   - `SUPABASE_URL` (texto): la dirección del Supabase del workspace (en Supabase: el proyecto → botón
     **Connect**, o *Project Settings → API*; es la que termina en `.supabase.co`).
   - `SUPABASE_PUBLISHABLE_KEY` (texto): la clave publicable (*Project Settings → API Keys*, la que empieza
     con `sb_publishable_`). Las dos son las mismas que usa la app al publicarse.
   - `APP_ORIGINS` (texto): las direcciones de la app separadas por comas, sin barra al final (por ejemplo
     `https://shotdocs.lega.com.ar,https://shotdocs.<tu-subdominio>.workers.dev`).

### 2. Crear el cliente de Google (Google Cloud)

1. En https://console.cloud.google.com, crear un proyecto (por ejemplo `LGA Shot Docs`).
2. **APIs & Services → Library → Google Drive API → Enable.**
3. **Google Auth Platform** (antes "OAuth consent screen") **→ Get started**: nombre de la app, correo de
   soporte, público **External**, correo de contacto → Create.
4. **Data Access → Add or remove scopes**: marcar `openid`, `.../auth/userinfo.email` y
   `https://www.googleapis.com/auth/drive.file` (si no aparece en la lista, pegarlo en *Manually add
   scopes*). Guardar.
5. **Audience → Publish app** para que quede **In production**. En "Testing" la conexión con Drive vence a
   los 7 días.
6. **Clients → Create client → Web application.** En *Authorized redirect URIs* poner
   `https://shotdocs-portero.<tu-subdominio>.workers.dev/drive/callback` (la del paso 1.3). Create.
7. Copiar el **Client ID** y el **Client secret** en ese momento (o tocar *Download JSON*): Google muestra
   el secreto **una sola vez**. Si se pierde, se crea otro secreto en el mismo cliente.
8. De vuelta en el Worker → Variables and Secrets: `GOOGLE_CLIENT_ID` (texto) y `GOOGLE_CLIENT_SECRET`
   (**Secret**). Guardar.

### 3. Decirle a la app dónde está el portero

En Supabase → SQL Editor (lo hace el dueño de la base):

```sql
update public.workspace_settings set media_url = 'https://shotdocs-portero.<tu-subdominio>.workers.dev';
```

### 4. Conectar Drive

En la app, con la cuenta del dueño: menú de la cuenta → **Media test → Connect Google Drive**. Elegir la
cuenta de Google cuyo Drive va a usar el workspace. Si Google avisa que la app no está verificada:
*Advanced → Go to …* (es tu propia app). Al aceptar, vuelve a la app con "Connected".

Mejor hacerlo desde la computadora: la conexión queda en el portero y vale para todos los dispositivos.

## Si algo falla

- *"The connection with Google Drive stopped working"*: el dueño revocó el acceso, cambió la contraseña o
  pasaron 6 meses sin uso. Volver a conectar desde *Media test*.
- *"This app address is not allowed"*: la dirección desde la que se abrió la app no está en `APP_ORIGINS`.
- Google dice `redirect_uri_mismatch`: la dirección del paso 2.6 no coincide con la del portero.
- Vuelve con *"drive-permission-missing"*: en la pantalla de permisos de Google quedó destildado el acceso
  a Drive. Conectar de nuevo y dejarlo marcado.
- Otro workspace (otro dueño) publica su portero importando su propia copia del repo (un fork).
- Los registros del portero están en Cloudflare → el Worker → **Logs**.
