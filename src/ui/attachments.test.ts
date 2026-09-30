// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetAttachment, prepareAndGet, preparedFor, prepareAttachment } from './attachmentOpen';
import { isAttachment } from './attachments';

// Adjuntos en el editor (Docs/Doc_Adjuntos.md): cuándo un bloque es un adjunto y cómo se prepara la dirección
// para abrirlo o bajarlo.

describe('qué bloque es un adjunto', () => {
  const none = { fileInfo: () => null };

  it('lo que sabe la cola manda', () => {
    const info = (kind: 'file' | 'image') => ({ fileInfo: () => ({ kind, mime: '', name: 'x', size: 1, local: false }) });
    expect(isAttachment(info('file'), 'id', 'foto.jpg')).toBe(true);
    expect(isAttachment(info('image'), 'id', 'plano.pdf')).toBe(false);
  });

  it('sin la info, solo por una extensión conocida que no es de fotos ni videos', () => {
    expect(isAttachment(none, 'id', 'plano.pdf')).toBe(true);
    expect(isAttachment(none, 'id', 'obra.zip')).toBe(true);
    expect(isAttachment(none, 'id', 'IMG_1.HEIC')).toBe(false);
    // Sin extensión o con una rara puede ser una foto: no se marca todavía.
    expect(isAttachment(none, 'id', '')).toBe(false);
    expect(isAttachment(none, 'id', 'foto')).toBe(false);
    expect(isAttachment(none, 'id', 'algo.desconocida')).toBe(false);
  });
});

describe('preparar la dirección de un adjunto', () => {
  afterEach(() => {
    forgetAttachment('a');
    vi.restoreAllMocks();
  });

  const pdf = { kind: 'file' as const, mime: 'application/pdf', name: 'plano.pdf', size: 3, local: false };

  it('con el portero: abrir con el pase, bajar con ?download=1', async () => {
    const media = {
      fileInfo: () => pdf,
      source: vi.fn(async () => ({ kind: null, name: 'plano.pdf', mime: 'application/pdf', original: null })),
      pass: vi.fn(async () => 'https://portero.test/m/p'),
      passInfo: vi.fn(async () => ({ url: 'https://portero.test/m/p', named: true })),
      mediaUrl: 'https://portero.test',
    };
    const got = await prepareAndGet(media as never, 'a');
    expect(got.open?.url).toBe('https://portero.test/m/p');
    expect(got.download?.url).toBe('https://portero.test/m/p?download=1');
    expect(preparedFor('a')).toBeDefined();
  });

  it('lo que falla (sin red, todavía subiendo) no se guarda: el próximo pedido vuelve a probar', async () => {
    let online = false;
    const media = {
      fileInfo: () => pdf,
      source: vi.fn(async () => ({ kind: null, name: 'plano.pdf', mime: 'application/pdf', original: null })),
      pass: vi.fn(async () => {
        if (!online) throw new TypeError('Failed to fetch');
        return 'https://portero.test/m/p';
      }),
      passInfo: vi.fn(async () => {
        if (!online) throw new TypeError('Failed to fetch');
        return { url: 'https://portero.test/m/p', named: true };
      }),
      mediaUrl: 'https://portero.test',
    };
    const failed = await prepareAndGet(media as never, 'a');
    expect(failed).toEqual({ open: null, download: null });
    expect(preparedFor('a')).toBeUndefined();
    online = true;
    await prepareAttachment(media as never, 'a');
    expect(preparedFor('a')?.download?.url).toBe('https://portero.test/m/p?download=1');
  });
});
