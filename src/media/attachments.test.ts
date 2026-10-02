// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import {
  attachmentCardUrl,
  attachmentFamily,
  blobToDataUrl,
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
    // Un subtipo XML se muestra como documento: adjunto.
    expect(fileKind('image/x-foo+xml')).toBe('file');
    expect(fileKind('video/x-bar+xml')).toBe('file');
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
  it('solo lo que el navegador sabe mostrar sin riesgo: fotos y audio comunes, video, PDF y texto plano', () => {
    for (const mime of ['image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'application/pdf', 'Application/PDF', 'text/plain; charset=utf-8']) {
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
      // Lo que el navegador no muestra: se baja con su nombre (en una pestaña se bajaría sin extensión).
      'image/heic',
      'image/vnd.adobe.photoshop',
      'image/x-exr',
      'audio/aiff',
      // Nunca un subtipo XML, aunque diga imagen.
      'image/x-foo+xml',
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
    // Los de ancho cero, la marca árabe y los separadores de renglón (los mismos que saca el portero).
    expect(cleanFileName('a\u200bb\u200cc\u200dd\u2060e\u061cf\u2028g\u2029.pdf')).toBe('abcdefg.pdf');
  });

  it('O4: el ZWJ entre dos emojis se queda (una familia sigue siendo una); entre letras o suelto, no', () => {
    const family = '👨\u200D👩\u200D👧\u200D👦';
    expect(cleanFileName(`${family} Familia.jpg`)).toBe(`${family} Familia.jpg`);
    // Con tono de piel, con el selector de variante y la bandera del arcoíris.
    expect(cleanFileName('👩🏽\u200D💻.png')).toBe('👩🏽\u200D💻.png');
    expect(cleanFileName('❤️\u200D🔥 ok.txt')).toBe('❤️\u200D🔥 ok.txt');
    expect(cleanFileName('🏳️\u200D🌈.pdf')).toBe('🏳️\u200D🌈.pdf');
    // Entre letras, al principio, al final o junto a una letra: afuera.
    expect(cleanFileName('rep\u200Dort.pdf')).toBe('report.pdf');
    expect(cleanFileName('\u200D👨.pdf')).toBe('👨.pdf');
    expect(cleanFileName('👨\u200D.pdf')).toBe('👨.pdf');
    expect(cleanFileName('a\u200D👩 👩\u200Da.pdf')).toBe('a👩 👩a.pdf');
    // Dos seguidos: queda uno solo, el que está entre los dos emojis.
    expect(cleanFileName('👨\u200D\u200D👩.pdf')).toBe('👨\u200D👩.pdf');
    // El ZWNJ (U+200C) sigue afuera siempre.
    expect(cleanFileName('👨\u200C👩.pdf')).toBe('👨👩.pdf');
    // Cortar en 250 no parte la familia: se va entera.
    const long = `${'x'.repeat(240)}${family}.jpg`;
    expect(cleanFileName(long)).toBe(`${'x'.repeat(240)}.jpg`);
    expect(cleanFileName(`${'x'.repeat(239)}${family}.jpg`)).toBe(`${'x'.repeat(239)}${family}.jpg`);
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
    // El nombre puede ocupar dos renglones: se compara el texto de los dos juntos.
    expect(lines(doc).join('')).toContain('<script>alert("x")</script>&.pdf');
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

describe('la tarjeta con vista previa (entrega 2)', () => {
  const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

  it('es más alta (360×268): la vista previa arriba, adentro del SVG, y el nombre escapado y el peso abajo', () => {
    const url = attachmentCardUrl({ name: '<script>x</script>&.pdf', mime: 'application/pdf', size: 2.4 * 1024 * 1024, preview: JPEG });
    const doc = parseCard(url);
    const svg = doc.documentElement;
    expect(svg.getAttribute('width')).toBe('360');
    expect(svg.getAttribute('height')).toBe('268');
    expect(doc.getElementsByTagName('script')).toHaveLength(0);
    expect(doc.getElementsByTagName('foreignObject')).toHaveLength(0);
    const images = doc.getElementsByTagName('image');
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('href')).toBe(JPEG);
    expect(images[0].getAttribute('preserveAspectRatio')).toBe('xMidYMin slice');
    // Lo único con dirección es la vista previa, y no hay nada de afuera.
    expect(doc.querySelectorAll('[href]')).toHaveLength(1);
    expect(decodeURIComponent(url)).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    const all = texts(doc);
    expect(all).toContain('<script>x</script>&.pdf');
    expect(all).toContain('PDF');
    expect(all.some((x) => /^2[.,]4 MB$/.test(x))).toBe(true);
  });

  it('un nombre largo va en un renglón, cortado con "…"', () => {
    const name = `Storyboard_${'secuencia_'.repeat(12)}final.pdf`;
    const doc = parseCard(attachmentCardUrl({ name, mime: 'application/pdf', preview: JPEG }));
    const title = texts(doc).find((x) => x.startsWith('Storyboard_'))!;
    expect(title.endsWith('…')).toBe(true);
    expect(name.startsWith(title.slice(0, -1))).toBe(true);
  });

  it('solo una foto en base64: cualquier otra cosa se ignora y queda la tarjeta de siempre', () => {
    for (const preview of [
      'data:image/svg+xml;base64,PHN2Zz4=',
      'https://example.com/x.jpg',
      'data:image/jpeg;base64,abc" onload="x',
      'javascript:alert(1)',
    ]) {
      const doc = parseCard(attachmentCardUrl({ name: 'a.pdf', mime: 'application/pdf', preview }));
      expect(doc.documentElement.getAttribute('height')).toBe('96');
      expect(doc.getElementsByTagName('image')).toHaveLength(0);
    }
  });

  it('de otro proyecto o borrado: sin vista previa, con la forma de siempre', () => {
    for (const state of ['foreign', 'deleted'] as const) {
      const doc = parseCard(attachmentCardUrl({ name: 'a.pdf', mime: 'application/pdf', preview: JPEG, state }));
      expect(doc.documentElement.getAttribute('height')).toBe('96');
      expect(doc.getElementsByTagName('image')).toHaveLength(0);
    }
    // Todavía sin llegar a Drive: con la vista previa y el aviso.
    const pending = parseCard(attachmentCardUrl({ name: 'a.pdf', mime: 'application/pdf', preview: JPEG, state: 'pending' }));
    expect(pending.documentElement.getAttribute('height')).toBe('268');
    expect(texts(pending)).toContain(t('queue.notYet'));
  });

  it('blobToDataUrl: la foto guardada como `data:` en base64, con su tipo', async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x10])], { type: 'image/jpeg' });
    expect(await blobToDataUrl(blob)).toBe('data:image/jpeg;base64,/9j/ABA=');
    // Un tipo raro se toma como JPEG (lo que guarda la app siempre es una foto).
    expect(await blobToDataUrl(new Blob([new Uint8Array([1])], { type: 'text/html' }))).toBe('data:image/jpeg;base64,AQ==');
  });
});
