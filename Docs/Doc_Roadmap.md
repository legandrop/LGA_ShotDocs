# Roadmap

Lo que falta, por importancia. Las fases están en `Plan_ShotDocs.md`, sección 9.

1. **Servidor de correo (SMTP).** Sin él, Supabase manda muy pocos mails por hora, solo a miembros del
   proyecto y sin código en el mail. Hace falta para invitar gente y para entrar desde la app instalada en
   el iPhone. Opción indicada: Resend.
2. **Fase 2.** Compartir por usuario y por link, con las pruebas de permisos.
3. **Fase 3.** Plantillas: definir con Lega los campos de *Pre-production Notes*, *On-Set Report* y
   *Shot Breakdown*.
4. **Fase 4.** Formato de página real (A5, A4, A3, Carta) y PDF igual a lo que se ve.
5. **Fase 5.** Asistente con la clave de cada usuario y MCP (D-06, D-07).
6. **D-09.** Decidir si el registro queda abierto antes de configurar el SMTP.
7. **Compactar en el servidor** los updates de contenido (`page_snapshots`).
8. **Subir solo lo propio después de bajar.** Hoy, la primera subida de un dispositivo después de bajar
   cambios de otro reenvía también lo bajado (no se pierde nada, pero pesa más). Hay que avanzar el vector
   de estado confirmado con lo que se baja, con una prueba que demuestre que nunca se saltea nada propio.
9. **Abrir una página vacía crea un cambio** (la semilla) aunque no se escriba nada. No pierde ni duplica
    nada; solo figura un momento como pendiente.
10. **Tamaño de la app.** El editor pesa unos 450 KB comprimidos; cargarlo aparte acelera la primera
    apertura. Después de la primera, la app queda en caché.
11. **D-05.** Decidir el hosting antes de usar la app en un show pago.
