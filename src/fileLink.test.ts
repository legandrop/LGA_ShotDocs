import { describe, expect, it } from 'vitest';
import { fileHref, filePath, linkHash, parseWorkspaceHash, workspaceHash } from './fileLink';
import { parseLinkHash } from './linkMode';
import { parseRoute } from './router';

// La dirección fija de un archivo (P.30, Docs/Doc_Links_PDF.md, 2.1).

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const WS = { u: 'https://abcdefghij.supabase.co', k: 'sb_publishable_abcdefgh1234', l: 'wanka_1' };
const TOKEN = `sdl_${'A'.repeat(43)}`;

describe('la dirección de un archivo', () => {
  it('camino, # del workspace y vuelta', () => {
    expect(filePath('wanka_1', ID.toUpperCase())).toBe(`/f/wanka_1/${ID}`);
    const href = fileHref('https://shotdocs.lega.com.ar/', 'wanka_1', ID, workspaceHash(WS));
    expect(href.startsWith(`https://shotdocs.lega.com.ar/f/wanka_1/${ID}#ws=`)).toBe(true);
    const url = new URL(href);
    expect(parseRoute(url.pathname)).toEqual({ name: 'file', localKey: 'wanka_1', id: ID });
    expect(parseWorkspaceHash(url.hash)).toEqual(WS);
    // Sin nombre del workspace ni página: solo lo necesario para conectarse.
    expect(Object.keys(JSON.parse(atob(url.hash.slice(4).replace(/-/g, '+').replace(/_/g, '/'))))).toEqual(['u', 'k', 'l']);
  });

  it('con un link público, el # es el del link (el mismo de Share)', () => {
    const hash = linkHash({ ...WS, t: TOKEN });
    expect(hash.startsWith('#link=')).toBe(true);
    expect(parseLinkHash(hash)).toEqual({ ...WS, t: TOKEN });
    expect(parseWorkspaceHash(hash)).toBeNull();
  });

  it('un # roto o armado a propósito no se acepta', () => {
    const enc = (o: unknown) => `#ws=${btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    expect(parseWorkspaceHash('#ws=no-es-json')).toBeNull();
    expect(parseWorkspaceHash(enc({ ...WS, u: 'http://abc.supabase.co' }))).toBeNull();
    expect(parseWorkspaceHash(enc({ ...WS, u: 'https://abc.supabase.co/rest?x=1' }))).toBeNull();
    expect(parseWorkspaceHash(enc({ ...WS, k: 'sb_secret_abcdefgh1234' }))).toBeNull();
    expect(parseWorkspaceHash(enc({ ...WS, l: '../x' }))).toBeNull();
    expect(parseWorkspaceHash(enc({ u: WS.u, k: WS.k }))).toBeNull();
    expect(parseWorkspaceHash(`#invite=${enc(WS).slice(4)}`)).toBeNull();
  });

  it('http://localhost solo con la app en la computadora (O4 de la auditoría de E1)', () => {
    const enc = (o: unknown) => `#ws=${btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    const local = enc({ ...WS, u: 'http://localhost:54321' });
    // Sin decirlo, decide dónde corre la app: acá (sin `location`, como en la web publicada) no es localhost.
    expect(typeof location).toBe('undefined');
    expect(parseWorkspaceHash(local)).toBeNull();
    expect(parseWorkspaceHash(local, false)).toBeNull();
    expect(parseWorkspaceHash(enc({ ...WS, u: 'http://127.0.0.1:54321' }), false)).toBeNull();
    expect(parseWorkspaceHash(local, true)).toEqual({ ...WS, u: 'http://localhost:54321' });
    // Ni con la app en la computadora se acepta otro host por http.
    expect(parseWorkspaceHash(enc({ ...WS, u: 'http://abc.supabase.co' }), true)).toBeNull();
  });

  it('la ruta pide clave local y uuid', () => {
    expect(parseRoute(`/f/wanka_1/${ID}/`)).toEqual({ name: 'file', localKey: 'wanka_1', id: ID });
    for (const path of [`/f/${ID}`, `/f/ab/${ID}`, `/f/Wanka/${ID}`, '/f/wanka_1/123', `/f/wanka_1/${ID}/x`, `/f/wa nka/${ID}`]) {
      expect(parseRoute(path)).toEqual({ name: 'home' });
    }
  });
});
