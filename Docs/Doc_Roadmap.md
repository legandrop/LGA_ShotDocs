# Roadmap

Lo que falta, por importancia. Las fases están en `Plan_ShotDocs.md`, sección 9.

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
  en el nombre.
- **Los permisos pasan por membresías**, aunque hoy haya un solo miembro: nada de "el dueño es el
  único usuario".
- **Todo lo del servidor está en el repo** y se aplica igual en cualquier workspace: migraciones,
  políticas, el portero. Lo que hoy se configura en el panel de Supabase (correo, plantillas, registro
  cerrado, direcciones de redirect) tiene que pasar a `supabase/config.toml` o estar entero en
  `Doc_Supabase.md`.
- **Cada workspace dice qué versión de la base tiene**, y la app avisa claro si el dueño tiene que
  actualizarla.
- **Ningún servicio central.** Ni proxy, ni licencias, ni estadísticas. Lo que cueste por uso lo paga el
  dueño de cada workspace con sus cuentas.
- **El plan gratis de Supabase es el techo por defecto:** nada pesado en la base ni en Storage (egress:
  5 GB al mes).
- **Los miembros nunca reciben las claves del dueño** (ni el token de Google): los archivos pasan por el
  portero, que pregunta los permisos.

## Pendientes

1. **Workspaces, equipo, invitados y archivos (D-17, D-18).** El orden está en `Plan_Workspaces.md`,
   sección 10. Lo primero: la copia de seguridad diaria de Wanka y la guarda para que una versión vieja
   nunca borre lo que no conoce (bloques, marcas o contenido nuevos).
2. **Fase 2** (ahora parte del punto 1: equipo e invitados). Compartir un proyecto, una página o una subpágina, por usuario y por link, con links
   legibles (D-13) y las pruebas de permisos. Sumar ahí archivar o borrar un proyecto.
3. **Fase 3.** Plantillas: definir con Lega los campos de *Pre-production Notes*, *On-Set Report* y
   *Shot Breakdown*.
4. **Fase 4.** Cortes reales entre hojas y PDF igual a lo que se ve (el tamaño de hoja ya se elige).
5. **Castellano e inglés (D-16).** Toda la interfaz en los dos idiomas, con el idioma en las preferencias
   de la cuenta, y las plantillas y los tipos de texto con nombre en cada idioma (Script/Guion,
   Questions/Dudas…).
6. **Fase 5.** Asistente con la clave de cada usuario y MCP (D-06, D-07).
7. **Compactar en el servidor** los updates de contenido (`page_snapshots`).
8. **Subir solo lo propio después de bajar.** Hoy, la primera subida de un dispositivo después de bajar
   cambios de otro reenvía también lo bajado (no se pierde nada, pero pesa más). Hay que avanzar el vector
   de estado confirmado con lo que se baja, con una prueba que demuestre que nunca se saltea nada propio.
9. **Abrir una página vacía crea un cambio** (la semilla) aunque no se escriba nada. No pierde ni duplica
   nada; solo figura un momento como pendiente.
10. **Tamaño de la app.** El editor pesa unos 450 KB comprimidos; cargarlo aparte acelera la primera
   apertura. Después de la primera, la app queda en caché.
11. **D-05.** Decidir el hosting antes de usar la app en un show pago.
12. **Investigar un caso intermitente de la prueba de punta a punta.** Dos dispositivos escriben sin red en
    la misma página nueva; en 1 de 7 corridas (v0.015), uno de los dos tardó más de 40 segundos en mostrar
    la línea del otro aunque los dos decían "All synced". No se confirmó pérdida y no se repitió en las
    corridas siguientes ni en las pruebas con el editor real; hay que ver si es la vista del editor o la
    sincronización.
13. **Una foto HEIC del iPhone se ve rota en Chrome de Windows**: hoy se muestra el original. Se arregla con
    las miniaturas del punto 1.
14. **Una imagen copiada a otra página sigue apuntando a la primera** (`sdfile://<página A>/...`). Hoy no
    molesta, pero al compartir (fase 2) quien ve solo la página B no la vería. Al pegar en otra página hay
    que registrar el archivo también para la página nueva.
