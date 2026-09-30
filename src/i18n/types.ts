/** Un texto, o sus dos formas según la cantidad (`count`): "1 page" / "3 pages". */
export type Plural = { one: string; other: string };
export type Entry = string | Plural;
/** Cada clave con sus dos idiomas, uno al lado del otro. */
export type Dict = Record<string, { en: Entry; es: Entry }>;
