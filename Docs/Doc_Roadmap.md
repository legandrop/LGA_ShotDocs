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

2. **Subir solo lo propio después de bajar.** Hoy, la primera subida de un dispositivo después de bajar
   cambios de otro reenvía también lo bajado (no se pierde nada, pero pesa más). Hay que avanzar el vector
   de estado confirmado con lo que se baja, con una prueba que demuestre que nunca se saltea nada propio.
3. **Abrir una página vacía crea un cambio** (la semilla) aunque no se escriba nada. No pierde ni duplica
   nada; solo figura un momento como pendiente.
4. **Tamaño de la app.** El editor pesa unos 450 KB comprimidos; cargarlo aparte acelera la primera
   apertura. Después de la primera, la app queda en caché.
5. **Investigar un caso intermitente de la prueba de punta a punta.** Dos dispositivos escriben sin red en
   la misma página nueva; en 1 de 7 corridas (v0.015), uno de los dos tardó más de 40 segundos en mostrar
   la línea del otro aunque los dos decían "All synced". No se confirmó pérdida y no se repitió en las
   corridas siguientes ni en las pruebas con el editor real; hay que ver si es la vista del editor o la
   sincronización.
6. **Páginas de privacidad y de condiciones** en la app (`/privacy`, `/terms`), en inglés: Google las pide
   para el punto 13.
7. **Fase 4.** Cortes reales entre hojas y PDF igual a lo que se ve (el tamaño de hoja ya se elige).
8. **Castellano e inglés (D-16).** Toda la interfaz en los dos idiomas, con el idioma en las preferencias
   de la cuenta, y las plantillas y los tipos de texto con nombre en cada idioma (Script/Guion,
   Questions/Dudas…).
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
    privacidad del punto 6 y dominio autorizado `lega.com.ar`), publicar la app (**In production**, así la
    conexión tampoco vence a los 7 días) y pedir la verificación de marca. Hasta entonces, la conexión con
    Drive vence cada 7 días y se reconecta desde la app.

### Resueltos adentro del plan

- Una foto HEIC del iPhone se ve rota en Chrome de Windows: lo arreglan las miniaturas (paso 6).
- Una imagen copiada a otra página sigue apuntando a la primera (`sdfile://<página A>/...`): al pegar en
  otra página se registra el archivo también para la nueva (pasos 6 y 9), así quien ve solo esa página
  la ve.
- D-05 (hosting para trabajos pagos): decidido, Cloudflare.
