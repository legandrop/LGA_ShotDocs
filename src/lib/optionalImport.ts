// Un `import()` opcional: lo que se baja puede no estar (sin red, y este dispositivo nunca lo bajó) sin que eso
// sea un problema de la app. Hoy, el decodificador de fotos HEIC (Docs/Doc_Imagenes.md, "Fotos HEIC").
//
// Hace falta marcarlo porque Vite avisa de todo `import()` que falla con el evento `vite:preloadError`, y la app
// lo toma como "se publicó una versión nueva y este archivo ya no está": recarga con el aviso *A new version is
// available* (`listenForMissingFiles`, ui/lazyPart.tsx). Para un import opcional eso sería una recarga con un
// aviso falso: mientras uno está en curso, ese oyente no hace nada y el error le llega solo a quien lo pidió.

let pending = 0;

/** Corre el `import()` marcado como opcional. El resultado y el error son los del import, sin cambios. */
export async function optionalImport<T>(load: () => Promise<T>): Promise<T> {
  pending++;
  try {
    return await load();
  } finally {
    pending--;
  }
}

/** Hay un import opcional en curso: un `vite:preloadError` de ahora no es una versión nueva. */
export function optionalImportPending(): boolean {
  return pending > 0;
}
