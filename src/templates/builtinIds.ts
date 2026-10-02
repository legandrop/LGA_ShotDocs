// Los ids de las plantillas de fábrica, para `pages.template_id` (Docs/Doc_Plantillas.md, sección 2.6). Van aparte de
// `builtin.ts` (que arrastra el esquema del editor) para que la primera carga los pueda usar: el reporte del día deduce
// la carpeta de reportes por el de *On-Set Report* (6.2). Son uuid fijos: no se cambian nunca.

export const BUILTIN_PREPRO = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e01';
export const BUILTIN_ONSET = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e02';
export const BUILTIN_SHOT = '5d1b7a0e-3c4f-4e8a-9b21-0f6c2a7d1e03';
