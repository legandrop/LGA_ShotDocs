// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { resetWorkspaceHashForTests, workspaceHash } from '../fileLink';
import { takeArrivalNotice } from '../invite';
import { t } from '../i18n';
import { readWorkspaces, writeWorkspaces, type DeviceWorkspace, type WorkspaceList } from '../workspaces';
import { fileStart } from './App';

// A qué workspace va la dirección de un archivo al abrir la app (P.30, Docs/Doc_Links_PDF.md, 2.2, con O2 y O3): manda
// el dispositivo; un servidor nuevo se confirma; lo que no cierra vuelve al inicio con un aviso y nunca abre otra isla.

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OWN: DeviceWorkspace = { id: 'wanka_1', url: 'https://aaaaaaaaaa.supabase.co', publishableKey: 'sb_publishable_aaaaaaaa', localKey: 'wanka_1', name: 'Wanka' };
const OTHER: DeviceWorkspace = { id: 'otro_2', url: 'https://bbbbbbbbbb.supabase.co', publishableKey: 'sb_publishable_bbbbbbbb', localKey: 'otro_2', name: 'Otro' };

function arrive(path: string, hash = ''): void {
  resetWorkspaceHashForTests();
  history.replaceState(null, '', path + hash);
}

function start(list: WorkspaceList, localKey: string, fallback: DeviceWorkspace | null = list.workspaces[0] ?? null) {
  writeWorkspaces(list);
  return fileStart(readWorkspaces(), { name: 'file', localKey, id: ID }, fallback);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  takeArrivalNotice();
});

describe('fileStart', () => {
  it('el dispositivo tiene la clave: se abre ese (sin # o con la misma dirección) y queda como el abierto', () => {
    arrive(`/f/wanka_1/${ID}`);
    expect(start({ active: 'otro_2', workspaces: [OTHER, OWN] }, 'wanka_1')).toEqual({ kind: 'open', entry: OWN });
    expect(readWorkspaces().active).toBe('wanka_1');
    arrive(`/f/wanka_1/${ID}`, workspaceHash({ u: OWN.url, k: OWN.publishableKey, l: 'wanka_1' }));
    expect(start({ active: null, workspaces: [OWN] }, 'wanka_1')).toEqual({ kind: 'open', entry: OWN });
    // El # se borra de la barra.
    expect(location.hash).toBe('');
    expect(location.pathname).toBe(`/f/wanka_1/${ID}`);
  });

  it('la misma clave con otra dirección: el aviso del choque, al inicio, sin abrir el del dispositivo', () => {
    arrive(`/f/wanka_1/${ID}`, workspaceHash({ u: 'https://zzzzzzzzzz.supabase.co', k: OWN.publishableKey, l: 'wanka_1' }));
    const result = start({ active: 'otro_2', workspaces: [OTHER, OWN] }, 'wanka_1', OTHER);
    expect(result).toEqual({ kind: 'open', entry: OTHER });
    expect(location.pathname).toBe('/');
    expect(takeArrivalNotice()).toBe(t('wsError.localKeyClash', { name: 'Wanka' }));
  });

  it('un workspace nuevo se confirma antes (como una invitación, sin página)', () => {
    arrive(`/f/nuevo_3/${ID}`, workspaceHash({ u: 'https://cccccccccc.supabase.co', k: 'sb_publishable_cccccccc', l: 'nuevo_3' }));
    const result = start({ active: 'wanka_1', workspaces: [OWN] }, 'nuevo_3');
    expect(result).toMatchObject({ kind: 'confirm', target: null, file: true, entry: { url: 'https://cccccccccc.supabase.co', localKey: 'nuevo_3' } });
    // Todavía no se agregó nada.
    expect(readWorkspaces().workspaces.map((w) => w.id)).toEqual(['wanka_1']);
  });

  it('la dirección conocida con otra clave: se abre esa y el camino pasa a su clave', () => {
    arrive(`/f/viejo_9/${ID}`, workspaceHash({ u: OTHER.url, k: OTHER.publishableKey, l: 'viejo_9' }));
    expect(start({ active: 'wanka_1', workspaces: [OWN, OTHER] }, 'viejo_9')).toEqual({ kind: 'open', entry: OTHER });
    expect(location.pathname).toBe(`/f/otro_2/${ID}`);
  });

  it('roto, sin #, o con otra clave en el #: incompleto, al inicio', () => {
    const cases: [string, string][] = [
      [`/f/nuevo_3/${ID}`, '#ws=roto'],
      [`/f/nuevo_3/${ID}`, ''],
      [`/f/nuevo_3/${ID}`, workspaceHash({ u: 'https://cccccccccc.supabase.co', k: 'sb_publishable_cccccccc', l: 'otra_4' })],
    ];
    for (const [path, hash] of cases) {
      arrive(path, hash);
      expect(start({ active: 'wanka_1', workspaces: [OWN] }, 'nuevo_3')).toEqual({ kind: 'open', entry: OWN });
      expect(location.pathname).toBe('/');
      expect(takeArrivalNotice()).toBe(t('file.incomplete'));
    }
  });

  it('sin workspaces: la bienvenida con el aviso', () => {
    arrive(`/f/nuevo_3/${ID}`);
    expect(start({ active: null, workspaces: [] }, 'nuevo_3', null)).toEqual({ kind: 'welcome' });
    expect(takeArrivalNotice()).toBe(t('file.incomplete'));
  });
});
