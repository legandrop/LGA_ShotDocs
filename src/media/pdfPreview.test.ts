import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { PDF_PREVIEW_MAX_BYTES, previewable } from './pdfPreview';

// La vista previa de los PDF adjuntos (Docs/Doc_Adjuntos.md, entrega 2). Qué tiene vista previa, y pdf.js de
// verdad dibujando la primera página de un PDF hecho acá (con el canvas de @napi-rs/canvas, el que usa pdf.js en
// Node; en el navegador es el canvas de la página).

/** Un PDF mínimo de una página de 200×100 puntos con un rectángulo negro abajo a la izquierda (sin fuentes). */
export function tinyPdf(): Uint8Array {
  const content = '0 0 0 rg 0 0 100 50 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe('previewable', () => {
  it('solo un PDF, por tipo o por extensión, y hasta el tope', () => {
    expect(previewable('application/pdf', 'guion.pdf', 1000)).toBe(true);
    expect(previewable('application/octet-stream', 'GUION.PDF')).toBe(true);
    expect(previewable('', 'plan.pdf')).toBe(true);
    expect(previewable('application/pdf', 'grande.pdf', PDF_PREVIEW_MAX_BYTES + 1)).toBe(false);
    expect(previewable('application/zip', 'todo.zip')).toBe(false);
    expect(previewable('image/jpeg', 'foto.jpg')).toBe(false);
    expect(previewable('image/svg+xml', 'logo.svg')).toBe(false);
    expect(previewable('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'notas.docx')).toBe(false);
  });
});

const require = createRequire(import.meta.url);
let canvasLib: { createCanvas: (w: number, h: number) => { width: number; height: number; getContext(t: '2d'): unknown } } | null = null;
try {
  canvasLib = require('@napi-rs/canvas');
} catch {
  canvasLib = null;
}

// @napi-rs/canvas viene con pdf.js (dependencia opcional): sin él no hay canvas en Node para dibujar.
describe.skipIf(!canvasLib)('renderFirstPage (pdf.js de verdad)', () => {
  const setup = async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')).href;
    return import('./pdfLib');
  };

  it('dibuja la primera página con el lado mayor pedido, sobre blanco', async () => {
    const { renderFirstPage } = await setup();
    const canvas = await renderFirstPage(tinyPdf(), 480, (w, h) => canvasLib!.createCanvas(w, h), 10_000);
    expect([canvas.width, canvas.height]).toEqual([480, 240]);
    const ctx = canvas.getContext('2d') as { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } };
    // El rectángulo negro ocupa la mitad izquierda de abajo (el PDF tiene el origen abajo); arriba a la derecha, blanco.
    const dark = ctx.getImageData(60, 200, 1, 1).data;
    const light = ctx.getImageData(400, 40, 1, 1).data;
    expect(dark[0]).toBeLessThan(40);
    expect(light[0]).toBeGreaterThan(230);
  });

  it('un PDF dañado tira (la cola lo toma como "sin vista previa")', async () => {
    const { renderFirstPage } = await setup();
    const broken = new TextEncoder().encode('%PDF-1.4\nesto no es un pdf');
    await expect(renderFirstPage(broken, 480, (w, h) => canvasLib!.createCanvas(w, h), 10_000)).rejects.toThrow();
  });
});

// El Worker de pdf.js se corta siempre, también si se pasó del tiempo, y un PDF con contraseña no queda esperando.
describe.skipIf(!canvasLib)('renderFirstPage: topes y Worker', () => {
  const setup = async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')).href;
    const lib = await import('./pdfLib');
    return { pdfjs, lib };
  };
  const make = (w: number, h: number) => canvasLib!.createCanvas(w, h);

  it('una página que nunca llega: tira "took too long" al llegar al tope y corta el Worker', async () => {
    const { pdfjs, lib } = await setup();
    // En Node pdf.js analiza en el mismo hilo: para simular un PDF que lo traba, `getPage` no contesta nunca.
    const first = pdfjs.getDocument({ data: tinyPdf() });
    const opened = await first.promise;
    const proto = Object.getPrototypeOf(opened) as { getPage: (n: number) => Promise<unknown> };
    await first.destroy();
    const hang = vi.spyOn(proto, 'getPage').mockImplementation(() => new Promise(() => undefined));
    const destroy = vi.spyOn(pdfjs.PDFWorker.prototype, 'destroy');
    try {
      const t0 = Date.now();
      await expect(lib.renderFirstPage(tinyPdf(), 480, make, 300)).rejects.toThrow(/too long/);
      expect(Date.now() - t0).toBeLessThan(2500);
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      destroy.mockRestore();
      hang.mockRestore();
    }
  });

  it('bien o dañado, el Worker se corta en los dos casos', async () => {
    const { pdfjs, lib } = await setup();
    const destroy = vi.spyOn(pdfjs.PDFWorker.prototype, 'destroy');
    try {
      await lib.renderFirstPage(tinyPdf(), 100, make, 10_000);
      await expect(lib.renderFirstPage(new TextEncoder().encode('%PDF-1.4\nroto'), 100, make, 10_000)).rejects.toThrow();
      expect(destroy).toHaveBeenCalledTimes(2);
    } finally {
      destroy.mockRestore();
    }
  });

  it('un PDF con contraseña tira enseguida (no pide la contraseña ni se queda esperando)', async () => {
    const { lib } = await setup();
    // Un PDF cifrado mínimo (RC4 de 40 bits, con contraseña de usuario): pdf.js lo rechaza con PasswordException.
    const content = 'q Q';
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Filter /Standard /V 1 /R 2 /O <' + '00'.repeat(32) + '> /U <' + '11'.repeat(32) + '> /P -4 >>',
    ];
    let out = '%PDF-1.4\n';
    const offs: number[] = [];
    objs.forEach((b, i) => {
      offs.push(out.length);
      out += `${i + 1} 0 obj\n${b}\nendobj\n`;
    });
    const x = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 5 0 R /ID [<00112233445566778899aabbccddeeff><00112233445566778899aabbccddeeff>] >>\nstartxref\n${x}\n%%EOF\n`;
    const t0 = Date.now();
    await expect(lib.renderFirstPage(new TextEncoder().encode(out), 100, make, 5_000)).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});
