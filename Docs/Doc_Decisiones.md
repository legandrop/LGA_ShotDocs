# Decisiones

Lo que solo Lega decide. Las abiertas siguen con la opción indicada en `Plan_ShotDocs.md` hasta que Lega
diga otra cosa.

## Tomadas

- **D-01 · Nombre: LGA Shot Docs** (2026-09-29). Repo `legandrop/LGA_ShotDocs`; se llamaba
  `LGA_VFX_Docs` y se renombró antes del primer commit.
- **D-02 · Backend: Supabase, frontend en Vercel** (2026-09-29). Lega ya tiene cuentas de Aiven y de
  Neon, pero las dos son solo base de datos: con cualquiera de ellas habría que sumar un servicio de
  login, uno de archivos (los reportes de rodaje llevan muchas fotos) y uno de tiempo real. Supabase trae
  todo junto, aplica los permisos dentro de la base y le pide una sola cuenta a quien la autohostee.
- **D-03 · Editor visual por bloques** (2026-09-29). Nadie ve Markdown: se usa solo para importar,
  exportar y hacer backups.
- **D-04 · Tiempo real al final** (2026-09-29). El modelo de datos lo contempla desde el principio, pero
  se implementa en la última fase.

## Abiertas

- **D-05 · Hosting para trabajos pagos.** El plan Hobby de Vercel es solo para uso no comercial. Para
  usar la app en shows pagos hace falta Vercel Pro u otro hosting. Mientras tanto, se desarrolla en Hobby.
