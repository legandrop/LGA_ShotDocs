import { describe, expect, it } from 'vitest';
import { legacyStorageNames, localDbName, storageNamesFor, WANKA_LOCAL_KEY } from './workspace';

// Lo guardado en los dispositivos de Wanka NUNCA cambia de nombre: renombrarlo desloguea a Lega en todos
// sus dispositivos y, sin red, lo deja sin su base local (Plan_Workspaces.md, sección 11).
describe('nombres de lo guardado en el dispositivo', () => {
  it('Wanka conserva los nombres de siempre', () => {
    expect(WANKA_LOCAL_KEY).toBe('znlvpuddswymxpffgvbz');
    const names = legacyStorageNames(WANKA_LOCAL_KEY);
    expect(names.auth).toBe('shotdocs-auth');
    expect(names.lastUser).toBe('shotdocs-last-user');
    expect(names.project).toBe('shotdocs-project');
    expect(names.lastPages).toBe('shotdocs-last-pages');
    expect(names.db('u1')).toBe('shotdocs:znlvpuddswymxpffgvbz:u1');
    expect(localDbName(WANKA_LOCAL_KEY, 'u1')).toBe('shotdocs:znlvpuddswymxpffgvbz:u1');
  });

  it('un workspace nuevo lleva su clave local en cada nombre y no choca con Wanka', () => {
    const names = storageNamesFor('k9x2');
    const wanka = legacyStorageNames(WANKA_LOCAL_KEY);
    for (const key of ['auth', 'lastUser', 'project', 'lastPages'] as const) {
      expect(names[key]).toContain('k9x2');
      expect(names[key]).not.toBe(wanka[key]);
    }
    expect(names.db('u1')).toBe('shotdocs:k9x2:u1');
  });
});
