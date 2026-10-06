// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pageLink, qualifyPageLink, workspaceSelector } from './pageLink';
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const origin = { appOrigin: 'https://app.test', localKey: 'isla_a' };
describe('identidad de enlaces de página', () => {
  it('legacy propio conserva query/hash al calificar y UUID ajeno idéntico queda literal', () => {
    expect(qualifyPageLink(`/p/${ID}?x=1#part`, origin)).toBe(`https://app.test/p/${ID}?x=1&w=isla_a#part`);
    const other = `/p/${ID}?w=isla_b&x=1#part`;
    expect(pageLink(other, origin)?.own).toBe(false); expect(qualifyPageLink(other, origin)).toBe(other);
  });
  it('w vacía/duplicada/malformada nunca adquiere el dueño local', () => {
    for (const query of ['?w=', '?w=isla_a&w=isla_a', '?w=bad.', '?w=Aaaa']) {
      expect(workspaceSelector(query).kind).toBe('invalid');
      const href = `/p/${ID}${query}`; expect(pageLink(href, origin)?.own).toBe(false); expect(qualifyPageLink(href, origin)).toBe(href);
    }
  });
  it('otras autoridades, orígenes, credenciales y esquemas nunca se convierten en página propia', () => {
    for (const href of [`https://other.test/p/${ID}`, `https://u@app.test/p/${ID}`, `javascript:/p/${ID}`, `//evil.test/p/${ID}`, 'x'.repeat(4001)]) expect(pageLink(href, origin)).toBeNull();
    for (const hash of ['#link=cap', '#invite=cap', '#ws=cap']) {
      const href = `/p/${ID}${hash}`; expect(pageLink(href, origin)?.own).toBe(false); expect(qualifyPageLink(href, origin)).toBe(href);
    }
  });
});
