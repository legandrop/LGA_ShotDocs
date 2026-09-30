import { common } from './common';
import { shell } from './shell';
import { sidebar } from './sidebar';
import { sync } from './sync';

// Todas las claves, por parte de la app. Cada parte usa su propio prefijo (la prueba revisa que ninguna
// clave se repita entre partes y que no sobre ninguna).
export const parts = { common, shell, sidebar, sync };

export const strings = { ...common, ...shell, ...sidebar, ...sync };
