import { describe, expect, it } from 'vitest';
import { isPublicRoute, pagePath, parseRoute, PRIVACY_PATH, TERMS_PATH } from './router';

// Las direcciones de la app: la política de privacidad y las condiciones son las únicas públicas (se ven sin
// sesión ni workspace); todas las demás pasan por el login.

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('parseRoute', () => {
  it('reconoce /privacy y /terms, con o sin barra al final', () => {
    expect(parseRoute('/privacy')).toEqual({ name: 'privacy' });
    expect(parseRoute('/privacy/')).toEqual({ name: 'privacy' });
    expect(parseRoute('/terms')).toEqual({ name: 'terms' });
    expect(parseRoute('/terms/')).toEqual({ name: 'terms' });
    expect(PRIVACY_PATH).toBe('/privacy');
    expect(TERMS_PATH).toBe('/terms');
  });

  it('lo parecido no es una página pública: va al inicio', () => {
    for (const path of ['/Privacy', '/privacy-policy', '/privacy/x', '/terms.html', '/p/privacy']) {
      expect(parseRoute(path)).toEqual({ name: 'home' });
    }
  });

  it('las demás direcciones siguen igual', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute(pagePath(ID))).toEqual({ name: 'page', id: ID });
    expect(parseRoute('/trash')).toEqual({ name: 'trash' });
    expect(parseRoute('/media-test')).toEqual({ name: 'media-test' });
  });
});

describe('isPublicRoute', () => {
  it('solo privacidad y condiciones no piden sesión', () => {
    expect(isPublicRoute(parseRoute('/privacy'))).toBe(true);
    expect(isPublicRoute(parseRoute('/terms'))).toBe(true);
    for (const path of ['/', pagePath(ID), '/trash', '/media-test', '/nada']) {
      expect(isPublicRoute(parseRoute(path))).toBe(false);
    }
  });
});
