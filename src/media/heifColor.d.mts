// Tipos de `heifColor.mjs` (JavaScript puro: también lo usa el comando que baja un doc de Coda).

/** Lo que declara una caja `colr` de tipo `nclx`: primarios, curva y matriz (números de ISO/IEC 23091-2). */
export interface Nclx {
  primaries: number;
  transfer: number;
  matrix: number;
  fullRange: boolean;
}

/** El color de la imagen principal: un perfil ICC, los números `nclx`, ninguno (`{}`), o `undefined` si no se pudo leer. */
export function primaryColor(bytes: Uint8Array): { icc?: Uint8Array; nclx?: Nclx } | undefined;

/** El perfil ICC que lleva el JPEG de un HEIC, o `null` (sRGB). */
export function heicColorProfile(bytes: Uint8Array): Uint8Array | null;

/** Un perfil ICC estándar equivalente a lo que dice `nclx`, o `null` (sRGB, o algo que no se sabe armar). */
export function profileFromNclx(nclx: Partial<Nclx> | null | undefined): Uint8Array | null;

/** La matriz de RGB lineal a XYZ (D50) y la de adaptación (D65 → D50), para unos primarios (x, y de R, G y B). */
export function profileMatrices(xy: number[], white?: number[]): { toXYZ: number[][]; chad: number[][] };
