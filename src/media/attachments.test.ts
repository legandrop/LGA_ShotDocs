// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import {
  attachmentCardUrl,
  attachmentFamily,
  cleanFileName,
  extensionLabel,
  fileKind,
  inlineType,
  mimeFromName,
  safeBlob,
} from './attachments';
import { deletedLabel } from './probe';

// Qué es cada archivo, qué se abre y qué se baja, los nombres limpios y la tarjeta que se ve en la página.

/** El SVG de la tarjeta, ya leído como XML. */
function parseCard(url: string): Document {
  expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1));
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc;
}

const texts = (doc: Document) => [...doc.querySelectorAll('text')].map((n) => n.textContent ?? '');
/** Los renglones del nombre y el de abajo (sin la etiqueta del ícono). */
const lines = (doc: Document) => [...doc.querySelectorAll('text[x="88"]')].map((n) => n.textContent ?? '');

async function bytes(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('fileKind', () => {
  it('foto o video si el navegador lo muestra; lo demás, adjunto', () => {
    expect(fileKind('image/jpeg')).toBe('image');
    expect(fileKind('Image/PNG; charset=binary')).toBe('image');
    expect(fileKind('image/heic', 'IMG_1.HEIC')).toBe('image');
    expect(fileKind('image/x-adobe-dng')).toBe('image');
    expect(fileKind('video/quicktime')).toBe('video');
    expect(fileKind('video/x-matroska')).toBe('video');
    for (const mime of [
      'image/svg+xml',
      'image/vnd.adobe.photoshop',
      'image/x-photoshop',
      'image/x-exr',
      'image/x-dpx',
      'image/x-tga',
      'image/vnd.dwg',
    ]) {
      expect(fileKind(mime), mime).toBe('file');
    }
    expect(fileKind('application/pdf', 'notas.pdf')).toBe('file');
    expect(fileKind('audio/mpeg')).toBe('file');
    expect(fileKind('text/html')).toBe('file');
  });

  it('sin tipo (o con el genérico), por la extensión del nombre', () => {
    expect(fileKind('', 'IMG_0001.HEIC')).toBe('image');
    expect(fileKind(null, 'clip.MOV')).toBe('video');
    expect(fileKind(undefined, 'foto.jpeg')).toBe('image');
    expect(fileKind('application/octet-stream', 'plano.jpg')).toBe('image');
    expect(fileKind('', 'arte.psd')).toBe('file');
    expect(fileKind('', 'logo.svg')).toBe('file');
    expect(fileKind('', 'render.exr')).toBe('file');
    expect(fileKind('', 'comp.nk')).toBe('file');
    expect(fileKind('', 'sin-extension')).toBe('file');
    expect(fileKind(null, null)).toBe('file');
    // El tipo manda sobre la extensión.
    expect(fileKind('application/pdf', 'truco.jpg')).toBe('file');
  });

  it('el tipo por la extensión', () => {
    expect(mimeFromName('a.PDF')).toBe('application/pdf');
    expect(mimeFromName('shot_010.blend')).toBe('application/x-blender');
    expect(mimeFromName('a')).toBeNull();
    expect(mimeFromName('a.desconocida')).toBeNull();
  });
});

describe('inlineType', () => {
  it('solo lo que se puede abrir sin riesgo: imágenes menos SVG, video, audio, PDF y texto plano', () => {
    for (const mime of ['image/png', 'image/heic', 'video/mp4', 'audio/mpeg', 'application/pdf', 'Application/PDF', 'text/plain; charset=utf-8']) {
      expect(inlineType(mime), mime).toBe(true);
    }
    for (const mime of [
      'image/svg+xml',
      'text/html',
      'application/xhtml+xml',
      'text/xml',
      'application/xml',
      'text/javascript',
      'application/javascript',
      'text/csv',
      'application/json',
      'application/zip',
      'application/vnd.microsoft.portable-executable',
      'application/octet-stream',
      'image/',
      '',
    ]) {
      expect(inlineType(mime), mime).toBe(false);
    }
  });
});

describe('familia y etiqueta', () => {
  it('la familia por el tipo o por la extensión', () => {
    expect(attachmentFamily('application/pdf', 'a.pdf')).toBe('pdf');
    expect(attachmentFamily('application/octet-stream', 'a.pdf')).toBe('pdf');
    expect(attachmentFamily('application/zip', 'a.zip')).toBe('archive');
    expect(attachmentFamily('', 'a.rar')).toBe('archive');
    expect(attachmentFamily('audio/x-aiff', 'a.aif')).toBe('audio');
    expect(attachmentFamily('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe('doc');
    expect(attachmentFamily('text/plain', 'a.txt')).toBe('doc');
    expect(attachmentFamily('text/csv', 'a.csv')).toBe('sheet');
    expect(attachmentFamily('', 'a.numbers')).toBe('sheet');
    expect(attachmentFamily('application/vnd.apple.keynote', 'a.key')).toBe('slides');
    expect(attachmentFamily('application/vnd.microsoft.portable-executable', 'a.exe')).toBe('exec');
    expect(attachmentFamily('', 'a.dmg')).toBe('exec');
    expect(attachmentFamily('application/x-nuke', 'comp.nk')).toBe('project');
    expect(attachmentFamily('image/vnd.adobe.photoshop', 'arte.psd')).toBe('project');
    expect(attachmentFamily('model/vnd.usdz+zip', 'a.usdz')).toBe('project');
    expect(attachmentFamily('application/octet-stream', 'a.xyz')).toBe('other');
    expect(attachmentFamily('image/svg+xml', 'logo.svg')).toBe('other');
  });

  it('la etiqueta: hasta 5 letras, del nombre o del tipo', () => {
    expect(extensionLabel('notas.pdf', 'application/pdf')).toBe('PDF');
    expect(extensionLabel('comp_v012.nk', '')).toBe('NK');
    expect(extensionLabel('shot.blend', '')).toBe('BLEND');
    expect(extensionLabel('cuentas.numbers', '')).toBe('NUM');
    expect(extensionLabel('proyecto.muylarga', '')).toBe('MUYLA');
    expect(extensionLabel('sin-extension', 'application/pdf')).toBe('PDF');
    expect(extensionLabel('', 'application/x-nuke')).toBe('NK');
    expect(extensionLabel('', 'application/x-houdini')).toBe('');
    expect(extensionLabel('', 'application/x-hip')).toBe('HIP');
    expect(extensionLabel('', 'application/octet-stream')).toBe('');
    expect(extensionLabel('', 'application/vnd.something-very-long')).toBe('');
  });
});

describe('cleanFileName', () => {
  it('saca los caracteres que dan vuelta el texto (un .exe que se ve como .pdf)', () => {
    expect(cleanFileName('factura‮fdp.exe')).toBe('facturafdp.exe');
    expect(cleanFileName('⁦a⁧b⁨c⁩‎‏.txt')).toBe('abc.txt');
    expect(cleanFileName('‪‫‬‭x.pdf')).toBe('x.pdf');
  });

  it('saca los de control y los que XML no admite', () => {
    expect(cleanFileName('a\u0000b\nc\td\u007f\u0085.txt')).toBe('abcd.txt');
    expect(cleanFileName('x￾￿.pdf')).toBe('x.pdf');
    // Un par sustituto suelto (medio emoji) tampoco.
    expect(cleanFileName('\uD83Dplano.pdf')).toBe('plano.pdf');
    expect(cleanFileName('plano\uDE00.pdf')).toBe('plano.pdf');
    expect(cleanFileName('🎬 rodaje.pdf')).toBe('🎬 rodaje.pdf');
  });

  it('recorta por puntos de código sin partir un emoji, conservando la extensión', () => {
    const name = `${'🎬'.repeat(300)}.pdf`;
    const clean = cleanFileName(name);
    expect(Array.from(clean)).toHaveLength(250);
    expect(clean.endsWith('.pdf')).toBe(true);
    for (let i = 0; i < clean.length; i++) {
      const c = clean.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = clean.charCodeAt(i + 1);
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
        i++;
      } else {
        expect(c >= 0xdc00 && c <= 0xdfff).toBe(false);
      }
    }
    expect(cleanFileName('a'.repeat(260))).toHaveLength(250);
  });

  it('vacío, file.bin', () => {
    expect(cleanFileName('')).toBe('file.bin');
    expect(cleanFileName('   ')).toBe('file.bin');
    expect(cleanFileName('‮\u0000')).toBe('file.bin');
  });
});

describe('safeBlob', () => {
  it('para bajar, siempre application/octet-stream y el mismo contenido', async () => {
    const html = new Blob(['<script>alert(1)</script>'], { type: 'text/html' });
    const out = safeBlob(html, 'download');
    expect(out.type).toBe('application/octet-stream');
    expect(await bytes(out)).toBe('<script>alert(1)</script>');
    expect(safeBlob(new Blob(['x'], { type: 'image/png' }), 'download').type).toBe('application/octet-stream');
  });

  it('para abrir, su tipo solo si está en la lista', () => {
    const pdf = new Blob(['%PDF'], { type: 'application/pdf' });
    expect(safeBlob(pdf, 'open')).toBe(pdf);
    expect(safeBlob(new Blob(['x'], { type: 'text/plain' }), 'open').type).toBe('text/plain');
    expect(safeBlob(new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'open').type).toBe('application/octet-stream');
    expect(safeBlob(new Blob(['<p>'], { type: 'text/html' }), 'open').type).toBe('application/octet-stream');
    expect(safeBlob(new Blob(['x']), 'open').type).toBe('application/octet-stream');
  });
});

describe('la tarjeta', () => {
  it('es un SVG de 360×96 sin scripts ni nada de afuera, con el nombre escapado', () => {
    const url = attachmentCardUrl({ name: '<script>alert("x")</script>&.pdf', mime: 'application/pdf', size: 2.4 * 1024 * 1024 });
    const doc = parseCard(url);
    const svg = doc.documentElement;
    expect(svg.getAttribute('width')).toBe('360');
    expect(svg.getAttribute('height')).toBe('96');
    expect(doc.getElementsByTagName('script')).toHaveLength(0);
    expect(doc.getElementsByTagName('foreignObject')).toHaveLength(0);
    expect(doc.querySelectorAll('[href]')).toHaveLength(0);
    expect(decodeURIComponent(url)).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    expect(doc.getElementsByTagName('clipPath')).toHaveLength(1);
    const all = texts(doc);
    expect(all).toContain('PDF');
    expect(all.join('\n')).toContain('<script>alert("x")</script>&.pdf');
    expect(all.some((x) => /^PDF · 2[.,]4 MB$/.test(x))).toBe(true);
    expect(svg.getAttribute('font-family') ?? doc.querySelector('g')?.getAttribute('font-family')).toContain('system-ui');
  });

  it('un nombre largo va en dos renglones y, si no entra, se corta en el medio conservando la extensión', () => {
    const two = parseCard(attachmentCardUrl({ name: 'Plano general de la escena final del rodaje.pdf', mime: 'application/pdf' }));
    const [a, b] = lines(two);
    expect(`${a} ${b}`).toBe('Plano general de la escena final del rodaje.pdf');

    const name = `Plano_general_${'muy_largo_'.repeat(15)}version_final_DEFINITIVA.pdf`;
    const cut = parseCard(attachmentCardUrl({ name, mime: 'application/pdf', size: 1000 }));
    const [first, second, meta] = lines(cut);
    expect(name.startsWith(first)).toBe(true);
    expect(second.startsWith('…')).toBe(true);
    expect(second.endsWith('DEFINITIVA.pdf')).toBe(true);
    expect(name.endsWith(second.slice(1))).toBe(true);
    expect(meta).toMatch(/^PDF · 1 KB$/);
  });

  it('el nombre se limpia (sin caracteres que den vuelta el texto)', () => {
    const doc = parseCard(attachmentCardUrl({ name: 'factura‮fdp.exe', mime: 'application/x-msdownload' }));
    expect(texts(doc)).toContain('facturafdp.exe');
    expect(texts(doc)).toContain('EXE');
  });

  it('las variantes tienen la misma forma', () => {
    const base = { name: 'plano.zip', mime: 'application/zip', size: 5000 };
    const pending = parseCard(attachmentCardUrl({ ...base, state: 'pending' }));
    const foreign = parseCard(attachmentCardUrl({ ...base, state: 'foreign' }));
    const deleted = parseCard(attachmentCardUrl({ ...base, state: 'deleted' }));
    expect(texts(pending)).toContain(t('queue.notYet'));
    expect(texts(foreign)).toContain(t('attachment.foreign'));
    expect(texts(deleted)).toContain(deletedLabel());
    expect(deleted.querySelector('[text-decoration="line-through"]')?.textContent).toBe('plano.zip');
    for (const doc of [pending, foreign, deleted]) {
      expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 360 96');
      expect(texts(doc)).toContain('plano.zip');
    }
    // Sin nombre todavía: el aviso va en lugar del nombre.
    expect(texts(parseCard(attachmentCardUrl({ name: '', mime: '', state: 'pending' })))).toContain(t('queue.notYet'));
  });
});
