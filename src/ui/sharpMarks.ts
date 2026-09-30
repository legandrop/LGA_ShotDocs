// Las marcas que deja la imagen nítida de la página en su `<img>` (sharpImages.ts): `data-sd-sharp` y
// `data-sd-sharp-h` son las medidas naturales de la miniatura que reemplazó. Lo que mide una foto (la vista de
// impresión, "Acomodar en filas") usa esas, así da lo mismo en un dispositivo con la nítida que en otro sin ella.

/** Las medidas naturales de la miniatura, aunque la imagen ya muestre la nítida (las que ve la página). */
export function thumbSize(img: HTMLImageElement): { width: number; height: number } {
  const w = Number(img.dataset.sdSharp);
  const h = Number(img.dataset.sdSharpH);
  if (w > 0 && h > 0) return { width: w, height: h };
  return { width: img.naturalWidth, height: img.naturalHeight };
}
