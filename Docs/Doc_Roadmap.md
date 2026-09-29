# Roadmap

Lo que falta, por importancia. Las fases están en `Plan_ShotDocs.md`, sección 9.

1. **Fase 2.** Compartir un proyecto, una página o una subpágina, por usuario y por link, con links
   legibles (D-13) y las pruebas de permisos. Sumar ahí archivar o borrar un proyecto.
2. **Fase 3.** Plantillas: definir con Lega los campos de *Pre-production Notes*, *On-Set Report* y
   *Shot Breakdown*.
3. **Fase 4.** Cortes reales entre hojas y PDF igual a lo que se ve (el tamaño de hoja ya se elige).
4. **Castellano e inglés (D-16).** Toda la interfaz en los dos idiomas, con el idioma en las preferencias
   de la cuenta, y las plantillas y los tipos de texto con nombre en cada idioma (Script/Guion,
   Questions/Dudas…).
5. **Fase 5.** Asistente con la clave de cada usuario y MCP (D-06, D-07).
6. **Compactar en el servidor** los updates de contenido (`page_snapshots`).
7. **Subir solo lo propio después de bajar.** Hoy, la primera subida de un dispositivo después de bajar
   cambios de otro reenvía también lo bajado (no se pierde nada, pero pesa más). Hay que avanzar el vector
   de estado confirmado con lo que se baja, con una prueba que demuestre que nunca se saltea nada propio.
8. **Abrir una página vacía crea un cambio** (la semilla) aunque no se escriba nada. No pierde ni duplica
   nada; solo figura un momento como pendiente.
9. **Tamaño de la app.** El editor pesa unos 450 KB comprimidos; cargarlo aparte acelera la primera
   apertura. Después de la primera, la app queda en caché.
10. **D-05.** Decidir el hosting antes de usar la app en un show pago.
11. **Investigar un caso intermitente de la prueba de punta a punta.** Dos dispositivos escriben sin red en
    la misma página nueva; en 1 de 7 corridas (v0.015), uno de los dos tardó más de 40 segundos en mostrar
    la línea del otro aunque los dos decían "All synced". No se confirmó pérdida y no se repitió en las
    corridas siguientes ni en las pruebas con el editor real; hay que ver si es la vista del editor o la
    sincronización.
