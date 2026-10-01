import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
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
