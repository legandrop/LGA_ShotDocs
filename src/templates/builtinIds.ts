// Los ids de las plantillas de fábrica, para `pages.template_id` (Docs/Doc_Plantillas.md, sección 2.6). Van aparte de
// `builtin.ts` (que arrastra el esquema del editor) para que la primera carga los pueda usar: el reporte del día deduce
// la carpeta de reportes por el de *On-Set Report* (6.2). Son uuid fijos: no se cambian nunca.

export const BUILTIN_PREPRO = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e01';
export const BUILTIN_ONSET = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e02';
export const BUILTIN_SHOT = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e03';
// Las de las relaciones (Docs/Doc_Estructura_Proyecto.md, «Tipo de página»): *Scene* y *Location* marcan la página.
export const BUILTIN_SCENE = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e04';
export const BUILTIN_LOCATION = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e05';
export const BUILTIN_TECH_SCOUT = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e06';
export const BUILTIN_CREATIVE_SCOUT = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e07';

/** Todas las de fábrica (exportar e importar conservan el `template_id` de estas). */
export const BUILTIN_ALL: readonly string[] = [
  BUILTIN_PREPRO,
  BUILTIN_ONSET,
  BUILTIN_SHOT,
  BUILTIN_SCENE,
  BUILTIN_LOCATION,
  BUILTIN_TECH_SCOUT,
  BUILTIN_CREATIVE_SCOUT,
];
