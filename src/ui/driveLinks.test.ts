import { describe, expect, it } from 'vitest';
import { driveOpenUrl, drivePreviewUrl, parseDriveLink, sameDriveLink } from './driveLinks';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

describe('reconocer links de Drive', () => {
  it('archivos: /file/d/, con cuenta elegida, /open?id= y /uc?id=', () => {
    for (const url of [
      `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
      `https://drive.google.com/file/d/${ID}/view`,
      `https://drive.google.com/file/d/${ID}`,
      `https://drive.google.com/file/d/${ID}/preview`,
      `https://drive.google.com/file/u/1/d/${ID}/view`,
      `https://drive.google.com/open?id=${ID}`,
      `https://drive.google.com/uc?id=${ID}&export=download`,
      `https://docs.google.com/file/d/${ID}/edit`,
      `  https://drive.google.com/file/d/${ID}/view  `,
    ]) {
      expect(parseDriveLink(url), url).toEqual({ kind: 'file', id: ID });
    }
  });

  it('carpetas', () => {
    for (const url of [
      `https://drive.google.com/drive/folders/${ID}`,
      `https://drive.google.com/drive/folders/${ID}?usp=sharing`,
      `https://drive.google.com/drive/u/0/folders/${ID}`,
      `https://drive.google.com/drive/mobile/folders/${ID}`,
    ]) {
      expect(parseDriveLink(url), url).toEqual({ kind: 'folder', id: ID });
    }
  });

  it('documentos de docs.google.com', () => {
    expect(parseDriveLink(`https://docs.google.com/document/d/${ID}/edit?usp=sharing`)).toEqual({ kind: 'doc', id: ID, docType: 'document' });
    expect(parseDriveLink(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toEqual({ kind: 'doc', id: ID, docType: 'spreadsheets' });
    expect(parseDriveLink(`https://docs.google.com/presentation/u/2/d/${ID}/edit`)).toEqual({ kind: 'doc', id: ID, docType: 'presentation' });
    // Un formulario publicado (/d/e/…) no tiene el id del archivo.
    expect(parseDriveLink(`https://docs.google.com/forms/d/e/${ID}/viewform`)).toBeNull();
  });

  it('guarda la clave de recurso de los links compartidos', () => {
    expect(parseDriveLink(`https://drive.google.com/file/d/${ID}/view?resourcekey=0-AbC_d-9`)).toEqual({
      kind: 'file',
      id: ID,
      resourceKey: '0-AbC_d-9',
    });
    // Una clave con caracteres raros se ignora (el link igual sirve).
    expect(parseDriveLink(`https://drive.google.com/file/d/${ID}/view?resourcekey=a%22b`)).toEqual({ kind: 'file', id: ID });
  });

  it('no reconoce otras direcciones, ids con otro formato ni texto alrededor', () => {
    for (const text of [
      '',
      'hola',
      `drive.google.com/file/d/${ID}/view`,
      `http://drive.google.com/file/d/${ID}/view`,
      `https://drive.google.com.evil.example/file/d/${ID}/view`,
      `https://evil.example/drive.google.com/file/d/${ID}`,
      `https://user@drive.google.com/file/d/${ID}/view`,
      `https://drive.google.com:8443/file/d/${ID}/view`,
      `https://drive.google.com/file/d/short/view`,
      `https://drive.google.com/file/d/${ID}%22onload%3D/view`,
      `https://drive.google.com/open?id=${ID}"><script>`,
      `https://drive.google.com/drive/my-drive`,
      `https://drive.google.com/`,
      `https://docs.google.com/document/${ID}`,
      `Mirá https://drive.google.com/file/d/${ID}/view`,
      `https://drive.google.com/file/d/${ID}/view https://drive.google.com/file/d/${ID}/view`,
      `javascript:alert(1)//https://drive.google.com/file/d/${ID}`,
    ]) {
      expect(parseDriveLink(text), text).toBeNull();
    }
  });
});

describe('direcciones del reproductor', () => {
  it('siempre de Drive, armadas solo con el id', () => {
    expect(drivePreviewUrl({ kind: 'file', id: ID })).toBe(`https://drive.google.com/file/d/${ID}/preview`);
    expect(drivePreviewUrl({ kind: 'file', id: ID, resourceKey: '0-x' })).toBe(`https://drive.google.com/file/d/${ID}/preview?resourcekey=0-x`);
    expect(drivePreviewUrl({ kind: 'folder', id: ID })).toBe(`https://drive.google.com/embeddedfolderview?id=${ID}#grid`);
    expect(drivePreviewUrl({ kind: 'doc', id: ID, docType: 'document' })).toBe(`https://docs.google.com/document/d/${ID}/preview`);
    expect(drivePreviewUrl({ kind: 'doc', id: ID, docType: 'forms' })).toBe(`https://docs.google.com/forms/d/${ID}/viewform?embedded=true`);
    expect(driveOpenUrl({ kind: 'file', id: ID })).toBe(`https://drive.google.com/file/d/${ID}/view`);
    expect(driveOpenUrl({ kind: 'folder', id: ID })).toBe(`https://drive.google.com/drive/folders/${ID}`);
  });

  it('se niega a armar una dirección con un id inválido', () => {
    expect(() => drivePreviewUrl({ kind: 'file', id: '../../evil' })).toThrow();
    expect(() => drivePreviewUrl({ kind: 'file', id: `${ID}?x=1` })).toThrow();
    expect(() => driveOpenUrl({ kind: 'file', id: 'x"y' })).toThrow();
  });

  it('compara links', () => {
    expect(sameDriveLink({ kind: 'file', id: ID }, parseDriveLink(`https://drive.google.com/open?id=${ID}`))).toBe(true);
    expect(sameDriveLink({ kind: 'file', id: ID }, { kind: 'folder', id: ID })).toBe(false);
    expect(sameDriveLink(null, null)).toBe(true);
    expect(sameDriveLink(null, { kind: 'file', id: ID })).toBe(false);
  });
});
