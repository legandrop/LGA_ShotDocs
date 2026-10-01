// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prefs } from '../prefs';
import { TOUR_STEPS, stepsFor } from './steps';
import {
  decideStart,
  endTour,
  getTourUi,
  readDeviceTour,
  setAccountMarker,
  startTour,
  syncAccountMark,
  TOUR_VERSION,
  writeDeviceTour,
  type DeviceTour,
  type StartFacts,
} from './tourState';

// Cuándo arranca la recorrida y dónde se guarda que ya se vio (Docs/Doc_Tutorial.md, sección 4, correcciones 5, 12
// y 22), y que cada ancla de los pasos exista en el código.

afterEach(() => {
  localStorage.clear();
  setAccountMarker(null);
});

const fresh: DeviceTour = { v: TOUR_VERSION, done: false, step: null };
const facts = (over: Partial<StartFacts> = {}): StartFacts => ({ firstLoad: true, atHome: true, invite: false, device: fresh, accountSeen: false, ...over });

describe('cuándo arranca', () => {
  it('nueva en todo, en su primera carga y en el inicio: arranca sola', () => {
    expect(decideStart(facts())).toBe('running');
  });

  it('la cuenta dice que ya la vio (otro dispositivo): no arranca', () => {
    expect(decideStart(facts({ accountSeen: true }))).toBe('off');
  });

  it('el dispositivo dice que ya la vio (otro workspace) y la cuenta no: no arranca', () => {
    expect(decideStart(facts({ device: { ...fresh, done: true } }))).toBe('off');
  });

  it('quien ya usaba la app (no es la primera carga): no arranca, le queda el punto en el "?"', () => {
    expect(decideStart(facts({ firstLoad: false }))).toBe('off');
  });

  it('con un link de invitación, o entrando por un link a una página: la tarjeta, no la práctica', () => {
    expect(decideStart(facts({ invite: true }))).toBe('invite');
    expect(decideStart(facts({ atHome: false }))).toBe('invite');
  });

  it('se recargó a mitad: se ofrece retomarla, también fuera de la primera carga', () => {
    expect(decideStart(facts({ firstLoad: false, device: { ...fresh, step: 3 } }))).toBe('resume');
  });

  it('una versión nueva de la recorrida cuenta como no vista; lo que no se entiende, como nuevo', () => {
    localStorage.setItem('shotdocs-tour', JSON.stringify({ v: TOUR_VERSION - 1, done: true, step: null }));
    expect(readDeviceTour().done).toBe(false);
    localStorage.setItem('shotdocs-tour', '{roto');
    expect(readDeviceTour()).toEqual(fresh);
  });
});

describe('"ya la vi"', () => {
  it('terminar o saltar la deja vista en el dispositivo y en la cuenta, sin tocar las preferencias de la cuenta', async () => {
    const before = JSON.stringify(prefs.get());
    const unsynced = prefs.hasUnsynced();
    const calls: number[] = [];
    setAccountMarker(async () => {
      calls.push(1);
      return true;
    });
    startTour();
    expect(getTourUi().mode).toBe('running');
    expect(readDeviceTour()).toMatchObject({ done: false, step: 0 });
    endTour();
    expect(getTourUi().mode).toBe('off');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.length).toBe(1);
    expect(readDeviceTour()).toEqual({ v: TOUR_VERSION, done: true, step: null, account: true });
    // Nada en `user_settings.prefs` (corrección 12).
    expect(JSON.stringify(prefs.get())).toBe(before);
    expect(prefs.hasUnsynced()).toBe(unsynced);
  });

  it('sin red queda para después, y se anota al volver a probar', async () => {
    let online = false;
    setAccountMarker(async () => {
      if (!online) throw new Error('offline');
      return true;
    });
    endTour();
    await new Promise((r) => setTimeout(r, 0));
    expect(readDeviceTour()).toMatchObject({ done: true, account: false });
    online = true;
    await syncAccountMark();
    expect(readDeviceTour()).toMatchObject({ done: true, account: true });
  });

  it('la cuenta que responde con error no cuenta como anotada', async () => {
    setAccountMarker(async () => false);
    writeDeviceTour({ v: TOUR_VERSION, done: true, step: null, account: false });
    await syncAccountMark();
    expect(readDeviceTour().account).toBe(false);
  });
});

describe('los pasos', () => {
  it('diez en la computadora, nueve en el teléfono, con ids únicos', () => {
    expect(stepsFor(false)).toHaveLength(10);
    expect(stepsFor(true)).toHaveLength(9);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });

  it('cada `data-tour` de un paso existe en el código de la interfaz (renombrar o borrar un ancla hace fallar esto)', () => {
    const src = resolve(__dirname, '..');
    const code: string[] = [];
    for (const dir of ['ui', 'tutorial', 'help']) {
      for (const name of readdirSync(join(src, dir))) {
        const path = join(src, dir, name);
        if (statSync(path).isFile() && /\.tsx$/.test(name) && !/\.test\./.test(name)) code.push(readFileSync(path, 'utf8'));
      }
    }
    const all = code.join('\n');
    for (const step of TOUR_STEPS) {
      if (!step.anchor || !('tour' in step.anchor)) continue;
      expect(all, `data-tour="${step.anchor.tour}"`).toContain(`data-tour="${step.anchor.tour}"`);
    }
  });
});
