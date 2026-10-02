import { describe, expect, it } from 'vitest';
import { folders } from '../i18n/lazy/folders';
import { memoryCap, tooBigNote } from './FolderDownload';

// La ventana de "Download all" (P.9, entrega 2): los topes del zip en memoria y su aviso.

describe('Download all: el aviso de demasiado grande', () => {
  it('O5: dice el tope una sola vez (pasado por poco, peso y tope redondeaban igual: "1 GB; up to 1 GB")', () => {
    for (const mobile of [false, true]) {
      const cap = memoryCap(mobile);
      const note = tooBigNote(cap);
      const sizes = note.match(/\d[\d.,]* [KMGT]?B/g) ?? [];
      expect(sizes).toEqual([mobile ? '500 MB' : '1 GB']);
    }
    expect(folders['folders.zipTooBig'].en).not.toContain('{size}');
    expect(folders['folders.zipTooBig'].es).not.toContain('{size}');
  });
});
