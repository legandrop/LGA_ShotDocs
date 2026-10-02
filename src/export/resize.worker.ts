// Achicar las fotos del PDF fuera del hilo principal (P.22, Docs/Doc_Exportar.md, "Cómo quedó la entrega 1"; la
// auditoría midió el 75-80 % del tiempo de exportar en abrir y achicar fotos). Este Worker abre una imagen (la guarda
// con un número), la dibuja más chica en un `OffscreenCanvas` y devuelve el JPEG. Nada más: no ve la página ni la base.

type ResizeRequest =
  | { id: number; kind: 'open'; blob: Blob }
  | { id: number; kind: 'draw'; handle: number; width: number; height: number }
  | { id: number; kind: 'close'; handle: number };

const bitmaps = new Map<number, ImageBitmap>();
let next = 1;

interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ResizeRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', async (e) => {
  const req = e.data;
  try {
    if (req.kind === 'open') {
      const bitmap = await createImageBitmap(req.blob);
      const handle = next++;
      bitmaps.set(handle, bitmap);
      scope.postMessage({ id: req.id, ok: true, handle, width: bitmap.width, height: bitmap.height });
    } else if (req.kind === 'draw') {
      const bitmap = bitmaps.get(req.handle);
      if (!bitmap) throw new Error('imagen cerrada');
      const canvas = new OffscreenCanvas(req.width, req.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('sin contexto 2d');
      // Sobre blanco: una PNG con transparencia no sale negra en el JPEG.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, req.width, req.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, req.width, req.height);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      scope.postMessage({ id: req.id, ok: true, blob });
    } else {
      bitmaps.get(req.handle)?.close();
      bitmaps.delete(req.handle);
      scope.postMessage({ id: req.id, ok: true });
    }
  } catch (err) {
    scope.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
export {};
