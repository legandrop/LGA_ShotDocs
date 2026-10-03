// La memoria de leer un archivo *deflate* grande de un zip (O2 de la auditoría de la entrega 3). Solo para desarrollo:
// el build no la incluye. Se elige el zip en el `<input>` y se lee su primer archivo con `zipReader.ts`.
import { openZip } from '../zipReader';

const input = document.getElementById('zip') as HTMLInputElement;
input.addEventListener('change', async () => {
  const t0 = performance.now();
  try {
    const src = await openZip(input.files![0]);
    const path = src.paths()[0];
    const blob = await src.blob(path);
    (window as unknown as { __done: unknown }).__done = { size: blob.size, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    (window as unknown as { __done: unknown }).__done = { error: String(err) };
  }
});
