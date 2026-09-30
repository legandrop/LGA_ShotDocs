// Marcas (`meta` de ProseMirror) que ponen unas partes de la app en sus transacciones para que otras las
// reconozcan. Van en un archivo aparte, sin dependencias, para que las importen el editor y las ramas que
// suman funciones (la búsqueda de P.12 usa la misma clave).

/**
 * Reemplazos de la búsqueda (P.12, Docs/Doc_Buscar.md): la transacción lleva esta clave y la entrada de la pila
 * de deshacer también (`stackItem.meta`). Colapsar (Docs/Doc_Colapsar.md) no abre secciones por esos cambios
 * ni por deshacerlos.
 */
export const FIND_REPLACE_META = 'sd-find-replace';

/**
 * Cambios que hace la app sola, sin que la persona haya tocado ese bloque: pasar una imagen `data:` a archivo,
 * sacar el bloque de una subida que falló, guardar el ancho de una foto en fila. Colapsar no abre secciones por
 * ellos.
 */
export const BACKGROUND_META = 'sd-background';
