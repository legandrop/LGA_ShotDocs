import { describe, expect, it, vi } from 'vitest';
import { base64Of, CAPTION_SIDE, captionImage, CaptionImageError, captionSource, fitSide, type CaptionImageDeps } from './captionImage';

// La foto que se le manda al modelo en *Suggest caption* (Docs/Doc_Asistente.md, entrega A3 y 10.5): de dónde sale (la
// imagen nítida de 1024 px, la miniatura, o lo que da el editor), nunca el original tal cual, y siempre vuelta a armar
// a 1024 px como mucho.

const ID = '0F8FAD5B-D9CB-469F-A165-708677289501';
const blob = (text: string, type = 'image/jpeg') => new Blob([text], { type });

function deps(over: Partial<CaptionImageDeps> & { files?: Record<string, Blob> } = {}) {
  const files = over.files ?? {};
  const fetcher = vi.fn(async (url: string) => (files[url] ? new Response(files[url]) : new Response('', { status: 404 })));
  const encode = vi.fn(async (b: Blob, side: number) => ({ blob: blob(`jpeg(${await b.text()})@${side}`), width: 1024, height: 683 }));
  const media = {
    view: vi.fn(async () => null as { url: string; side: number } | null),
    thumbnail: vi.fn(async () => null as string | null),
  };
  return { media, fetcher, encode, ...over } as CaptionImageDeps & { media: typeof media; fetcher: typeof fetcher; encode: typeof encode };
}

describe('de dónde sale la foto', () => {
  it('una del Drive: la imagen nítida de 1024 px (bajando por el portero si hace falta), nunca el original', async () => {
    const download = vi.fn(async () => blob('ORIGINAL'));
    const d = deps({ files: { 'blob:view': blob('VISTA') }, download });
    d.media.view.mockResolvedValue({ url: 'blob:view', side: 1024 });
    const out = await captionSource(`sdmedia://${ID}`, d);
    expect(await out.text()).toBe('VISTA');
    expect(d.media.view).toHaveBeenCalledWith(ID.toLowerCase(), { side: CAPTION_SIDE, download });
    expect(download).not.toHaveBeenCalled();
  });

  it('sin nada mejor (una foto chica, una HEIC sin convertir, sin red): la miniatura; sin miniatura, no hay foto', async () => {
    const d = deps({ files: { 'blob:thumb': blob('MINI') } });
    d.media.thumbnail.mockResolvedValue('blob:thumb');
    expect(await (await captionSource(`sdmedia://${ID}`, d)).text()).toBe('MINI');
    const none = deps();
    await expect(captionSource(`sdmedia://${ID}`, none)).rejects.toEqual(new CaptionImageError('unavailable'));
  });

  it('otra dirección: la que da el editor para mostrarla; si no se puede bajar, no hay foto', async () => {
    const resolve = vi.fn(async (u: string) => `${u}?firmada`);
    const d = deps({ resolve, files: { 'https://x.supabase.co/a.jpg?firmada': blob('STORAGE') } });
    expect(await (await captionSource('https://x.supabase.co/a.jpg', d)).text()).toBe('STORAGE');
    await expect(captionSource('https://otro/b.jpg', d)).rejects.toBeInstanceOf(CaptionImageError);
    await expect(captionSource('', d)).rejects.toBeInstanceOf(CaptionImageError);
  });
});

describe('lo que se manda', () => {
  it('siempre vuelta a armar a 1024 px como mucho, en JPEG y en base64', async () => {
    const d = deps({ files: { 'blob:view': blob('VISTA') } });
    d.media.view.mockResolvedValue({ url: 'blob:view', side: 2048 });
    const img = await captionImage(`sdmedia://${ID}`, d);
    expect(d.encode).toHaveBeenCalledWith(expect.any(Blob), CAPTION_SIDE);
    expect(img.mime).toBe('image/jpeg');
    expect(atob(img.data)).toBe('jpeg(VISTA)@1024');
    expect(img.bytes).toBe('jpeg(VISTA)@1024'.length);
    expect([img.width, img.height]).toEqual([1024, 683]);
  });

  it('un archivo que no es una imagen no se manda', async () => {
    const d = deps({ files: { 'https://a/b.pdf': blob('%PDF', 'application/pdf') } });
    await expect(captionImage('https://a/b.pdf', d)).rejects.toEqual(new CaptionImageError('unreadable'));
    expect(d.encode).not.toHaveBeenCalled();
  });

  it('el tamaño: lado mayor de 1024 sin agrandar; base64 de bytes grandes', async () => {
    expect(fitSide(4032, 3024)).toEqual({ width: 1024, height: 768 });
    expect(fitSide(3024, 4032)).toEqual({ width: 768, height: 1024 });
    expect(fitSide(640, 480)).toEqual({ width: 640, height: 480 });
    expect(fitSide(0, 0)).toEqual({ width: 0, height: 0 });
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(atob(await base64Of(new Blob([bytes]))).length).toBe(100_000);
  });
});
