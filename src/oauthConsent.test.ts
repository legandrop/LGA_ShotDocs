import { describe, expect, it } from 'vitest';
import {
  authorizationIdFrom,
  consentErrorDetail,
  consentErrorKind,
  redirectTarget,
  safeRedirect,
  scopeList,
  workspaceForRef,
} from './oauthConsent';
import type { DeviceWorkspace, WorkspaceList } from './workspaces';

// Lo de la pantalla de permiso de un asistente que no es interfaz: qué workspace elige el ref, qué se muestra de la
// dirección de vuelta, los permisos pedidos y qué mensaje sale para cada error.

const wanka: DeviceWorkspace = {
  id: 'znlvpuddswymxpffgvbz',
  url: 'https://znlvpuddswymxpffgvbz.supabase.co',
  publishableKey: 'sb_publishable_x',
  localKey: 'znlvpuddswymxpffgvbz',
  name: 'Wanka',
  legacy: true,
};
const otro: DeviceWorkspace = {
  id: 'otroworkspace0000001',
  url: 'https://abcdefghijklmnopqrst.supabase.co',
  publishableKey: 'sb_publishable_y',
  localKey: 'otroworkspace0000001',
  name: 'Otro',
};
const propio: DeviceWorkspace = {
  id: 'reftercero0000000001',
  url: 'https://api.estudio.example',
  publishableKey: 'sb_publishable_z',
  localKey: 'reftercero0000000001',
  name: 'Dominio propio',
};
const pendiente: DeviceWorkspace = {
  id: 'pending.x',
  url: 'https://pendientependiente01.supabase.co',
  publishableKey: 'sb_publishable_w',
  localKey: '',
  name: '',
  pending: true,
};
const list: WorkspaceList = { active: wanka.id, workspaces: [wanka, otro, propio, pendiente] };

describe('workspaceForRef', () => {
  it('con varios workspaces, el ref de la dirección elige: por la dirección de Supabase o por la clave local', () => {
    expect(workspaceForRef(list, 'znlvpuddswymxpffgvbz')).toBe(wanka);
    expect(workspaceForRef(list, 'abcdefghijklmnopqrst')).toBe(otro);
    expect(workspaceForRef(list, 'reftercero0000000001')).toBe(propio);
  });

  it('un ref que no está, o uno pendiente, no elige ninguno (tampoco el activo)', () => {
    expect(workspaceForRef(list, 'nadanadanadanadanada')).toBeNull();
    expect(workspaceForRef(list, 'pendientependiente01')).toBeNull();
    expect(workspaceForRef({ active: null, workspaces: [] }, 'znlvpuddswymxpffgvbz')).toBeNull();
  });
});

describe('redirectTarget', () => {
  it('muestra el host (con el puerto) y marca lo que vuelve a esta computadora', () => {
    expect(redirectTarget('https://claude.ai/api/mcp/auth_callback')).toEqual({ host: 'claude.ai', local: false });
    expect(redirectTarget('https://evil.example:8443/claude/callback?x=1')).toEqual({ host: 'evil.example:8443', local: false });
    expect(redirectTarget('http://127.0.0.1:33418/callback')).toEqual({ host: '127.0.0.1:33418', local: true });
    expect(redirectTarget('http://localhost:6274/oauth/callback')).toEqual({ host: 'localhost:6274', local: true });
    expect(redirectTarget('http://[::1]:9000/cb')).toEqual({ host: '[::1]:9000', local: true });
  });

  it('un esquema propio va con el esquema; lo que no se entiende, tal cual y cortado', () => {
    expect(redirectTarget('cursor://anysphere.cursor-retrieval/oauth/callback')).toEqual({
      host: 'cursor://anysphere.cursor-retrieval',
      local: false,
    });
    expect(redirectTarget('com.example.app:/oauth')).toEqual({ host: 'com.example.app:', local: false });
    expect(redirectTarget('no es una dirección')).toEqual({ host: 'no es una dirección', local: false });
    expect(redirectTarget('x'.repeat(200)).host).toHaveLength(80);
  });

  it('un nombre que imita otro no se disfraza: se ve el host entero', () => {
    expect(redirectTarget('https://claude.ai.evil.example/cb').host).toBe('claude.ai.evil.example');
    expect(redirectTarget('https://claude.ai@evil.example/cb').host).toBe('evil.example');
  });
});

describe('scopeList', () => {
  it('separa por espacios y no repite', () => {
    expect(scopeList('email')).toEqual(['email']);
    expect(scopeList(' openid  email email offline_access ')).toEqual(['openid', 'email', 'offline_access']);
    expect(scopeList('')).toEqual([]);
    expect(scopeList(null)).toEqual([]);
  });
});

describe('consentErrorKind y el detalle', () => {
  it('sin sesión, sin red, el servidor apagado, vencida (y el 400 de #2820) u otra cosa', () => {
    expect(consentErrorKind({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })).toBe('session');
    expect(consentErrorKind({ name: 'AuthRetryableFetchError', message: 'x', status: 0 })).toBe('offline');
    expect(consentErrorKind({ message: 'Failed to fetch' })).toBe('offline');
    expect(consentErrorKind({ status: 404, code: 'feature_disabled', message: 'OAuth server is disabled' })).toBe('disabled');
    expect(consentErrorKind({ status: 400, code: 'validation_failed', message: 'authorization request cannot be processed' })).toBe('expired');
    expect(consentErrorKind({ status: 404, code: 'oauth_authorization_not_found', message: 'not found' })).toBe('expired');
    expect(consentErrorKind({ status: 500, message: 'boom' })).toBe('other');
    expect(consentErrorKind({ message: 'raro' })).toBe('other');
  });

  it('el detalle lleva el estado y el código, sin el texto del servidor', () => {
    expect(consentErrorDetail({ status: 400, code: 'validation_failed', message: 'texto largo del servidor' })).toBe('400 · validation_failed');
    expect(consentErrorDetail({ status: 500 })).toBe('500');
    expect(consentErrorDetail({ message: 'x' })).toBe('');
  });
});

describe('authorizationIdFrom', () => {
  it('lee authorization_id y rechaza lo que podría cambiar la dirección del pedido', () => {
    expect(authorizationIdFrom('?authorization_id=abc_DEF-123')).toBe('abc_DEF-123');
    expect(authorizationIdFrom('?x=1&authorization_id=7f0c1d2e-0000-4000-8000-000000000001')).toBe('7f0c1d2e-0000-4000-8000-000000000001');
    for (const bad of [
      '',
      '?authorization_id=',
      '?authorization_id=../user',
      '?authorization_id=a/b',
      '?authorization_id=a%3Fb',
      '?authorization_id=a%23b',
      '?authorization_id=' + 'a'.repeat(201),
    ]) {
      expect(authorizationIdFrom(bad), bad).toBeNull();
    }
  });
});

describe('safeRedirect', () => {
  it('vuelve a https, a esta computadora y a un esquema de app; nunca a javascript:, data: y parecidos', () => {
    for (const ok of ['https://claude.ai/api/mcp/auth_callback?code=x', 'http://127.0.0.1:33418/cb?code=x', 'cursor://anysphere.cursor-retrieval/cb?code=x']) {
      expect(safeRedirect(ok), ok).toBe(true);
    }
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', 'blob:https://a/b', 'file:///c:/x', 'about:blank', 'no es una dirección', '']) {
      expect(safeRedirect(bad), bad).toBe(false);
    }
  });
});
