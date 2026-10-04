// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://shotdocs.lega.com.ar/"}
import { afterEach, describe, expect, it } from 'vitest';
import { resetWorkspaceHashForTests, takeWorkspaceHash } from './fileLink';

// El `#ws=` al abrir la app publicada (P.30, O4 de la auditoría de E1): con la app fuera de la computadora, un
// `http://localhost` en el `#` no se acepta (lo armaría un PDF para mandar al visitante a un servidor de su máquina).

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const enc = (o: unknown) => `#ws=${btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
const WS = { u: 'https://abcdefghij.supabase.co', k: 'sb_publishable_abcdefgh1234', l: 'wanka_1' };

afterEach(() => {
  history.replaceState(null, '', '/');
  resetWorkspaceHashForTests();
});

describe('takeWorkspaceHash en la web publicada', () => {
  it('un http://localhost en el # queda roto y se saca de la barra', () => {
    expect(location.hostname).toBe('shotdocs.lega.com.ar');
    history.replaceState(null, '', `/f/wanka_1/${ID}${enc({ ...WS, u: 'http://localhost:54321' })}`);
    expect(takeWorkspaceHash()).toEqual({ payload: null, broken: true });
    expect(location.hash).toBe('');
    expect(location.pathname).toBe(`/f/wanka_1/${ID}`);
  });

  it('uno https se lee una sola vez', () => {
    history.replaceState(null, '', `/f/wanka_1/${ID}${enc(WS)}`);
    expect(takeWorkspaceHash()).toEqual({ payload: WS, broken: false });
    history.replaceState(null, '', `/f/wanka_1/${ID}${enc(WS)}`);
    expect(takeWorkspaceHash()).toEqual({ payload: null, broken: false });
  });
});
