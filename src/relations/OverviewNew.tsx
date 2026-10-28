import { useState, type KeyboardEvent } from 'react';
import { useT } from '../i18n';
import { navigate, pagePath } from '../router';
import { useServices, useTree, type Services } from '../services';
import type { PageRow } from '../sync/types';
import { existingRelationsSession } from '../ui/relationsUi';
import { folderChoices, type CreateWant } from './createEntity';
import { createEnv, reasonText, runCreate } from './EntityActions';
import { markFolderHolds } from './entitySync';
import { sceneCode } from './kind';
import type { FichaPart } from './overviewPlaces';

// El «+» de una parte del *Overview* (Plan_Fichas_Cuaderno.md, parte 1, punto 4; D813): pide el número o el nombre y
// crea la ficha con las guardas de siempre (`createEntity.ts`: red, índice completo, ver el proyecto entero, que no
// exista). Así una ficha nunca nace sin número o sin nombre, que es lo que el *Overview* necesita para mostrarla. Sin
// carpeta de ese tipo, la crea en la raíz con su tipo; con dos posibles, pregunta en cuál.

const PLACEHOLDER = { scenes: 'sidebar.newScenePlaceholder', locations: 'sidebar.newLocationPlaceholder', sets: 'sidebar.newSetPlaceholder' } as const;
export const FOLDER = { scenes: 'type.scenes', locations: 'type.locations', sets: 'type.sets' } as const;
const KIND = { scenes: 'scene', locations: 'location', sets: 'set' } as const;

/**
 * El número de escena que se escribió, canónico (`059`, `105_120`), o `null`. En un largo, `59` o `Escena 59`; en una
 * serie, el número completo (`105-120`, `105_120`).
 */
export function typedSceneCode(text: string, flat: boolean): string | null {
  const t = text.trim();
  const short = /^(\d{1,3})([A-Za-z]{0,2})$/.exec(t);
  if (flat && short) return `${short[1].padStart(3, '0')}${short[2].toUpperCase()}`;
  return sceneCode(t, null, flat);
}

/** Espera a que el índice del proyecto termine de leer (como mucho `ms`). */
export function indexReady(services: Parameters<typeof existingRelationsSession>[0], projectId: string, ms = 5000): Promise<void> {
  const relations = existingRelationsSession(services)?.relations;
  if (!relations) return Promise.resolve();
  return new Promise((resolve) => {
    let stop = () => undefined as void;
    const done = () => {
      clearTimeout(timer);
      stop();
      resolve();
    };
    const timer = setTimeout(done, ms);
    const check = () => {
      if (relations.snapshot(projectId)?.complete) done();
    };
    stop = relations.subscribe(check);
    // Recién creada la carpeta, la foto vieja todavía puede decir «completa»: se mira después de que el índice la vea.
    setTimeout(check, 50);
  });
}

/**
 * Una carpeta en la raíz del proyecto con su tipo («Scenes», «Locations», «Sets»), para cuando no hay ninguna: la crean el
 * «+» del *Overview* y el `/e` / `/l` (simulación de D813). Espera a que el índice la vea antes de volver.
 */
export async function createTypedFolder(services: Pick<Services, 'tree'> & Parameters<typeof existingRelationsSession>[0], projectId: string, part: FichaPart, label: string): Promise<void> {
  const folder = await services.tree.create(null, label, projectId);
  await markFolderHolds(services.tree, folder, KIND[part]);
  // El índice vuelve a leer con la carpeta nueva: las guardas esperan a que termine (G2).
  await indexReady(services, projectId);
}

/**
 * `ep`: el «+» de un episodio (`105`): alcanza con el número de la escena (`27` → `105_027`). En un largo o con el número
 * completo, el de la parte.
 */
export function NewFicha({ part, ep, projectId, onDone }: { part: FichaPart; ep?: string; projectId: string; onDone: () => void }) {
  const tr = useT();
  const services = useServices();
  const tree = useTree();
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const [choices, setChoices] = useState<{ want: CreateWant; folders: PageRow[] } | null>(null);
  const env = createEnv(services, projectId, tr.lang);
  const title = (id: string) => tree.get(id)?.title;

  const wantOf = (text: string): CreateWant | null => {
    if (part !== 'scenes') return text.trim() ? { kind: KIND[part], name: text } : null;
    const reg = existingRelationsSession(services)?.relations.snapshot(projectId)?.registry;
    const short = ep ? /^(\d{1,3})([A-Za-z]{0,2})$/.exec(text.trim()) : null;
    const code = short ? `${ep}_${short[1].padStart(3, '0')}${short[2].toUpperCase()}` : typedSceneCode(text, !reg || reg.flat || reg.eps.size === 0);
    // Desde acá se crea también una escena con letra (`027A` con la `027` ya creada): se pide a propósito, no es un error de tipeo.
    return code ? { kind: 'scene', code, letters: true } : null;
  };

  const run = async (want: CreateWant) => {
    setBusy(true);
    setWhy(null);
    try {
      let guard = env.guard(want);
      // Mientras el índice lee (recién abierto el proyecto, o justo después de crear otra), se espera en vez de pedir
      // que se vuelva a intentar.
      if (!guard.ok && guard.reason === 'reading') {
        await indexReady(services, projectId);
        guard = env.guard(want);
      }
      // Sin carpeta de ese tipo, una en la raíz («Scenes», «Locations», «Sets») con su tipo.
      if (!guard.ok && guard.reason === 'noFolder') {
        await createTypedFolder(services, projectId, part, tr(FOLDER[part]));
        guard = env.guard(want);
      }
      if (!guard.ok && guard.reason === 'twoFolders' && !want.in) {
        const folders = folderChoices(services.tree, projectId, want);
        // Con menos de dos para elegir (escenas marcadas a mano en carpetas sin tipo), se dice por qué no se crea.
        if (folders.length >= 2) {
          setChoices({ want, folders });
          return;
        }
      }
      if (!guard.ok) {
        setWhy(reasonText(tr, guard, want, title));
        return;
      }
      // Lo que salga mal lo avisa `runCreate`; el campo queda con lo escrito.
      const res = await runCreate(services, env, want, { tr });
      if (res.ok) {
        onDone();
        navigate(pagePath(res.pageId));
      }
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onDone();
      return;
    }
    if (e.key !== 'Enter' || busy) return;
    e.preventDefault();
    const want = wantOf(e.currentTarget.value);
    if (!want) {
      setWhy(e.currentTarget.value.trim() ? tr('create.why.invalid') : null);
      return;
    }
    void run(want);
  };

  return (
    <li className="ov-new" role="none">
      <input
        className="rename"
        autoFocus
        disabled={busy}
        placeholder={ep ? tr('sidebar.newScenePlaceholderEp') : tr(PLACEHOLDER[part])}
        aria-label={ep ? tr('sidebar.newSceneIn', { ep }) : tr(PLACEHOLDER[part])}
        onKeyDown={onKey}
        onChange={() => {
          setWhy(null);
          setChoices(null);
        }}
        onBlur={(e) => {
          // Sin nada escrito, irse del campo lo cierra; con algo, queda (no se pierde lo escrito).
          if (!e.currentTarget.value.trim() && !choices) onDone();
        }}
      />
      {why && <div className="ov-new-why">{why}</div>}
      {choices && (
        <div className="ov-new-where">
          <span>{tr('sidebar.newWhere')}</span>
          {choices.folders.map((f) => (
            <button key={f.id} disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void run({ ...choices.want, in: f.id })}>
              {f.title || tr('common.untitled')}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
