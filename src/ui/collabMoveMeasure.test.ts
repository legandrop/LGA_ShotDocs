// @vitest-environment jsdom
import { afterEach, it } from 'vitest';
import { unmountAll } from './collabHarness';
import { movePage, tallyMoves, type MoveWay } from './moveHarness';
import { writeFileSync, appendFileSync } from 'node:fs';

// Medición exploratoria (no corre en CI): MOVE_MEASURE=<archivo> npx vitest run src/ui/collabMoveMeasure.test.ts
afterEach(unmountAll);

const OUT = process.env.MOVE_MEASURE;
const N = Number(process.env.MOVE_N ?? 300);
const configs = [
  { name: 'bloque suelto (k=1, m=1, párrafos)', k: 1, m: 1, headings: false },
  { name: 'sección de 3 salta un título (k=3, m=1)', k: 3, m: 1, headings: true },
  { name: 'sección de 3 salta una sección de 3 (k=3, m=3)', k: 3, m: 3, headings: true },
  { name: 'sección de 2 arrastrada lejos (k=2, m=6)', k: 2, m: 6, headings: true },
];
const scenarios = [
  { name: 'B escribe en lo que se mueve', alphabet: ['VA', 'TBs', 'TBs', 'dA', 'dB'] },
  { name: 'B escribe en lo que salta', alphabet: ['VA', 'TBg', 'TBg', 'dA', 'dB'] },
  { name: 'B escribe en el destino', alphabet: ['VA', 'TBd', 'TBd', 'dA', 'dB'] },
  { name: 'B escribe arriba (control)', alphabet: ['VA', 'TBo', 'TBo', 'dA', 'dB'] },
  { name: 'B borra un bloque', alphabet: ['VA', 'XBs', 'XBg', 'XBd', 'dA', 'dB'] },
  { name: 'B agrega un bloque', alphabet: ['VA', 'NBs', 'NBg', 'NBd', 'dA', 'dB'] },
  { name: 'los dos mueven', alphabet: ['VA', 'VB', 'TBs', 'TBg', 'dA', 'dB'] },
];
const ways = (process.env.MOVE_WAYS ?? 'blocknote,keyboard,smaller').split(',') as MoveWay[];

it.skipIf(!OUT)('medir', async () => {
  writeFileSync(OUT!, `# mover con dos editores, ${N} agendas por caso\n`);
  let seed = 7000;
  for (const c of configs) {
    for (const s of scenarios) {
      seed++;
      for (const way of ways) {
        if (way === 'keyboard' && c.m > 1 && process.env.MOVE_KB_ALL !== '1') continue;
        const t = await tallyMoves(seed, N, s.alphabet, () => movePage(c.k, c.m, c.headings), { way });
        const line = `${c.name} | ${s.name} | ${way} | perdido ${t.lost} | en otro bloque ${t.displaced} | dos veces ${t.twice} | texto de nadie perdido ${t.baseLost} | dos veces ${t.baseTwice} | borrado que vuelve ${t.resurrected} | distintos ${t.different} | sin aquietarse ${t.unsettled} | sección partida ${t.broken}`;
        appendFileSync(OUT!, `${line}\n`);
        for (const e of t.examples.slice(0, 1)) appendFileSync(OUT!, `    ej: ${e}\n`);
      }
    }
  }
}, 6 * 3600_000);
