// El título de una escena partido en dos (D818): el número en gris adelante y el nombre en el campo. En la base sigue
// siendo un solo título (`029 | Plaza`); esto solo decide qué se ve y qué se escribe.

/** El nombre de una escena en su título (`029 | Plaza` → `Plaza`, `029` → ``), o `null` si no empieza con su número. */
export function sceneTitleName(title: string, code: string): string | null {
  if (title === code) return '';
  if (!title.startsWith(code)) return null;
  const m = /^\s*\|\s?/.exec(title.slice(code.length));
  return m ? title.slice(code.length + m[0].length) : null;
}

/** El título entero con el nombre escrito: sin nombre, el número solo. */
export function sceneTitleJoin(code: string, name: string): string {
  return name === '' ? code : `${code} | ${name}`;
}
