import type { BlockNoteEditor } from '@blocknote/core';
import { SuggestionMenu } from '@blocknote/core/extensions';
import type { DefaultReactSuggestionItem } from '@blocknote/react';
import type { Translate } from '../i18n';
import type { Services } from '../services';
import { existingRelationsSession } from '../ui/relationsUi';
import { pickerOptions, reasonText, runCreate, createEnv } from './EntityActions';
import type { CreateWant } from './createEntity';
import { planOf } from './dayLive';
import { dayRef } from './liveView';
import { fold, scan, type Registry } from './reader';
import { anchorOf, linkTextInBlock } from './relLink';
import { setSlashDraft } from './slashDraft';
import type { RelationSnapshot } from './relationIndex';
import { searchLocations, searchScenes, type SearchSource } from './sceneSearch';

// El `/` de escenas y locaciones (Docs/Doc_Relaciones.md, sección 15; E7, D506–D511): el mismo menú `/` de siempre, cuya
// lista cambia según lo escrito. `/e 027`, `/e5027`, `/escena 105-027` o `/e cami` muestran escenas; `/l cen`,
// locaciones. ↵ deja un link común (`/p/<id>`, marca `link`) con el número canónico o el nombre de la locación, que el
// subrayado dibuja como ficha: nada de tipos de bloque nuevos ni de un segundo menú. Lo que no existe aparece al final:
// *Create scene 105_120* si pasan las guardas, o *Keep 105_120 as text* con el motivo (↵ nunca borra lo escrito).

/** Las palabras que abren escenas y locaciones (sin tildes ni mayúsculas; D508). `s` sola no: empieza demasiados bloques. */
export const SCENE_WORDS = ['e', 'sc', 'esc', 'sce', 'scen', 'scene', 'esce', 'escen', 'escena'];
export const LOCATION_WORDS = ['l', 'lo', 'loc', 'loca', 'locat', 'locati', 'locatio', 'location', 'locac', 'locaci', 'locacio', 'locacion'];

export type SlashQuery = { mode: 'normal' } | { mode: 'scene' | 'location'; q: string };

/**
 * Lo escrito después de `/` (D507): pasa a escenas o locaciones solo con la palabra y un espacio (`e `, `l cen`) o la
 * palabra pegada a cifras (`e027`, `escena5027`). La palabra sola (`/e`, `/sc`) sigue siendo el menú de siempre: `/sc`↵
 * da *Script*.
 */
export function parseSlashQuery(query: string): SlashQuery {
  const m = /^(\p{L}+)(?:\s+([\s\S]*)|(\d[\s\S]*))$/u.exec(query);
  if (!m) return { mode: 'normal' };
  const word = fold(m[1]);
  const q = (m[2] ?? m[3] ?? '').trim();
  if (SCENE_WORDS.includes(word)) return { mode: 'scene', q };
  if (m[2] !== undefined && LOCATION_WORDS.includes(word)) return { mode: 'location', q };
  return { mode: 'normal' };
}

/** El número que no existe que nombra lo escrito (`105_120`, `5120`, `120` en una página del episodio 105), o `null`. */
export function pendingCode(R: Registry, q: string, ep: string | null): string | null {
  for (const text of [q, `Escena ${q}`]) {
    const hit = scan(R, text, { heading: true, ep }).find((h) => h.kind === 'pending' && !h.hidden);
    if (hit && hit.s === (text === q ? 0 : 7)) return hit.ref + hit.part;
  }
  return null;
}

/** La letra de una parte como se escribió en la consulta (`a` de `105_027a`), o la de la opción en minúscula; nada si no hay. */
export function partLetter(q: string, part: string | undefined): string {
  if (!part) return '';
  const typed = /(\p{L})\s*$/u.exec(q)?.[1];
  return typed && typed.toUpperCase() === part ? typed : part.toLowerCase();
}

/** Lo que el `/` necesita saber de la página: la foto del índice, su episodio y lo que está cerca. */
export interface SlashPlace {
  snap: RelationSnapshot;
  src: SearchSource;
  projectId: string;
  ep: string | null;
  /** Escenas cerca: las del día (sus secciones y su plan) o las que nombra la página. */
  near: string[];
  /** Locaciones cerca: las que nombra la página (o el día). */
  nearLocs: string[];
}

export function slashPlace(snap: RelationSnapshot, title: (id: string) => string | undefined, children: (id: string) => { id: string }[], pageId: string): SlashPlace {
  const role = snap.registration.roles.get(pageId);
  const dayId = role?.entity?.kind === 'day' ? pageId : role?.partOf?.kind === 'day' ? role.partOf.pageId : null;
  const near: string[] = [];
  const nearLocs: string[] = [];
  const take = (id: string) => {
    for (const m of snap.pages.get(id)?.mentions ?? []) {
      if (m.kind === 'scene' && !near.includes(m.ref)) near.push(m.ref);
      if (m.kind === 'loc' && !nearLocs.includes(m.ref)) nearLocs.push(m.ref);
    }
  };
  take(dayId ?? pageId);
  if (dayId) {
    for (const c of children(dayId)) take(c.id);
    // El plan del día también cuando sale del desglose (las fichas con esa fecha, D570): no lo nombra ninguna página suya.
    const live = { snap, title, content: () => undefined };
    for (const code of planOf(live, dayRef(live, dayId)).codes) if (!near.includes(code)) near.push(code);
  }
  return { snap, src: { snap, title }, projectId: snap.projectId, ep: role?.ep ?? null, near, nearLocs };
}

const SceneIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l3-4h4l-3 4M10 7l3-4h4l-3 4" />
  </svg>
);
const LocIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
  </svg>
);
const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const TextIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <path d="M5 6h14M12 6v13M9 19h6" />
  </svg>
);

type Editor = BlockNoteEditor<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Los editores cuyo menú ya se mira (para borrar la consulta anotada al cerrarse). */
const watched = new WeakSet<object>();

/** Un espacio antes si lo de antes del cursor es una letra o una cifra (`la/e 027` no deja «la105_027»). */
function spaceBefore(editor: Editor): string {
  const view = editor.prosemirrorView;
  const before = view?.state.selection.$from.nodeBefore;
  const ch = before?.isText ? (before.text ?? '').slice(-1) : '';
  return /[\p{L}\p{N}]/u.test(ch) ? ' ' : '';
}

/** Deja en el cursor un link a la página, con el texto dado, y un espacio después (D509). */
export function insertPageLink(editor: Editor, text: string, pageId: string): void {
  const pre = spaceBefore(editor);
  editor.insertInlineContent([...(pre ? [pre] : []), { type: 'link', href: `/p/${pageId}`, content: text }, ' '] as never, { updateSelection: true });
}

/** Deja el texto en el cursor (queda subrayado como pendiente si es un número que no existe). Devuelve dónde quedó. */
function insertText(editor: Editor, text: string): { blockId: string; offset: number } | null {
  const pre = spaceBefore(editor);
  const view = editor.prosemirrorView;
  const at = view ? anchorOf(view.state, view.state.selection.from + pre.length, '') : null;
  editor.insertInlineContent(`${pre}${text} `, { updateSelection: true });
  return at?.blockId ? { blockId: at.blockId, offset: at.offset } : null;
}

export interface RelationSlash {
  /** *Scene* y *Location* para el menú de siempre (con sus alias: `/scene`, `/locación`). */
  root(group: string): DefaultReactSuggestionItem[];
  /** La lista de escenas o locaciones para lo escrito, o `null` si es el menú de siempre. */
  items(query: string): DefaultReactSuggestionItem[] | null;
}

/**
 * El `/` de las relaciones para un editor. Lee todo al momento de cada consulta (la foto del índice, los permisos, la
 * red): nada queda viejo mientras el menú está abierto más que lo que tarda en volver a escribir una letra.
 */
export function relationSlash(env: { editor: Editor; services: Services; pageId: () => string; tr: Translate }): RelationSlash {
  const { editor, services, tr } = env;

  const place = (): SlashPlace | null => {
    const session = existingRelationsSession(services);
    const pageId = env.pageId();
    const projectId = services.tree.get(pageId)?.workspace_id;
    const snap = session && projectId ? session.relations.snapshot(projectId) : null;
    if (!snap) return null;
    return slashPlace(snap, (id) => services.tree.get(id)?.title, (id) => services.tree.children(id), pageId);
  };

  const reopen = (word: 'e' | 'l') => {
    const menu = editor.getExtension(SuggestionMenu);
    if (!menu) return;
    menu.openSuggestionMenu('/', { deleteTriggerCharacter: true });
    editor.transact((t) => t.insertText(`${word} `));
  };

  const createItem = (p: SlashPlace, want: CreateWant, shown: string): DefaultReactSuggestionItem => {
    const env2 = createEnv(services, p.projectId, tr.lang);
    const guard = env2.guard(want);
    const group = tr(want.kind === 'scene' ? 'slash.scenes' : 'slash.locations');
    if (!guard.ok) {
      return {
        title: tr('create.keep', { code: shown }),
        subtext: reasonText(tr, guard, want, (id) => services.tree.get(id)?.title),
        group,
        icon: <TextIcon />,
        onItemClick: () => void insertText(editor, shown),
      };
    }
    const folder = services.tree.get(guard.parentId)?.title ?? '';
    return {
      title: want.kind === 'scene' ? tr('create.scene', { code: want.code }) : tr('create.location', { name: guard.title }),
      subtext: guard.generic ? `${tr('create.in', { folder })} · ${tr('create.generic')}` : tr('create.in', { folder }),
      group,
      icon: <PlusIcon />,
      onItemClick: () => {
        // El texto queda escrito ya (si crear falla, queda pendiente); al crearse la página, se vuelve link.
        const text = want.kind === 'scene' ? want.code : guard.title;
        const at = insertText(editor, text);
        const pageId = env.pageId();
        void runCreate(services, env2, want, {
          tr,
          inPage: pageId,
          onCreated: (id) => {
            const view = editor.prosemirrorView;
            if (view && at && view.editable) linkTextInBlock(view, at, text, `/p/${id}`);
          },
        });
      },
    };
  };

  const sceneItems = (p: SlashPlace, q: string): DefaultReactSuggestionItem[] => {
    const group = tr('slash.scenes');
    const options = q ? searchScenes(p.src, q, { ep: p.ep, near: p.near, loose: true, limit: 7 }).filter((o) => o.pageId) : pickerOptions(p.src, '', { near: p.near, ep: p.ep, limit: 7 });
    const items: DefaultReactSuggestionItem[] = options.map((o) => {
      // Una parte (`/e 105_027a` sin escena `105_027A`): el link va a la escena y el texto conserva la letra como se
      // escribió (O6 de la auditoría de E7, D569).
      const text = o.code + partLetter(q, o.part);
      return {
        title: text,
        subtext: [o.part ? tr('slash.partOf', { code: o.code }) : '', o.title, o.episode && o.episode !== p.ep ? `EP ${o.episode}` : ''].filter(Boolean).join(' · '),
        group,
        icon: <SceneIcon />,
        onItemClick: () => insertPageLink(editor, text, o.pageId!),
      };
    });
    const code = q ? pendingCode(p.snap.registry, q, p.ep) : null;
    if (code && !options.some((o) => o.code === code)) items.push(createItem(p, { kind: 'scene', code }, code));
    return items;
  };

  const locationItems = (p: SlashPlace, q: string): DefaultReactSuggestionItem[] => {
    const group = tr('slash.locations');
    const R = p.snap.registry;
    let options = q ? searchLocations(p.src, q) : [];
    if (!q) {
      const names = [...p.nearLocs, ...[...R.locations.keys()].sort((a, b) => a.localeCompare(b))];
      options = [...new Set(names)].slice(0, 7).map((name) => ({ name, pageId: R.locations.get(name)?.pageId ?? null, why: 'name' as const }));
    }
    const items: DefaultReactSuggestionItem[] = options
      .filter((o) => o.pageId && p.src.title(o.pageId) !== undefined)
      .map((o) => {
        // Todas las formas (D536) pueden ser muchas: hasta dos y cuántas más, para que se lea (D557).
        const aliases = (R.locations.get(o.name)?.aliases ?? []).filter((a) => a !== o.name);
        const more = aliases.length > 2 ? `+${aliases.length - 2}` : '';
        return {
          title: o.name,
          subtext: [tr('slash.locationSub'), ...aliases.slice(0, 2), more].filter(Boolean).join(' · '),
          group,
          icon: <LocIcon />,
          onItemClick: () => insertPageLink(editor, o.name, o.pageId!),
        };
      });
    // Crear solo si nada empieza con lo escrito (mientras se tipea «cen» de CENADE no se ofrece «Create location «Cen»»).
    const fq = fold(q).replace(/\s+/g, ' ').trim();
    const starts = [...R.locations.values()].some((l) => [l.name, ...l.aliases].some((a) => fold(a).startsWith(fq)));
    if (fq.length >= 3 && !starts) items.push(createItem(p, { kind: 'location', name: q }, q));
    return items;
  };

  // La consulta abierta no cuenta como pendiente en el mapa (D568): se anota mientras el menú está abierto y se borra al
  // cerrarse (elegir, Esc, tocar afuera), una sola suscripción por editor.
  const menu = editor.getExtension(SuggestionMenu);
  if (menu && !watched.has(editor)) {
    watched.add(editor);
    menu.store.subscribe(() => {
      if (!menu.shown()) setSlashDraft(null);
    });
  }
  const noteDraft = (p: SlashPlace | null, q: string) => {
    const view = editor.prosemirrorView;
    const blockId = view ? anchorOf(view.state, view.state.selection.from, '').blockId : null;
    if (!p || !blockId || !q) return setSlashDraft(null);
    const R = p.snap.registry;
    // Lo que el índice lee en ese renglón (un párrafo o un título) y lo que el `/` ofrecería crear.
    const codes = new Set<string>();
    for (const heading of [false, true]) for (const h of scan(R, q, { heading, ep: p.ep })) if (h.kind === 'pending') codes.add(h.ref);
    const code = pendingCode(R, q, p.ep);
    if (code) codes.add(code.replace(/[A-Z]$/, ''));
    setSlashDraft({ pageId: env.pageId(), blockId, codes: [...codes] });
  };

  return {
    root: (group) => {
      if (!place()) return [];
      return [
        {
          title: tr('slash.scene'),
          subtext: tr('slash.sceneHint'),
          aliases: ['escena', 'scene', 'sc', 'esc', 'e', 'link scene', 'linkear escena'],
          group,
          icon: <SceneIcon />,
          badge: '/e',
          onItemClick: () => reopen('e'),
        },
        {
          title: tr('slash.location'),
          subtext: tr('slash.locationHint'),
          aliases: ['locacion', 'locación', 'location', 'loc', 'l', 'link location', 'linkear locación'],
          group,
          icon: <LocIcon />,
          badge: '/l',
          onItemClick: () => reopen('l'),
        },
      ];
    },
    items: (query) => {
      const parsed = parseSlashQuery(query);
      if (parsed.mode !== 'scene') setSlashDraft(null);
      if (parsed.mode === 'normal') return null;
      const p = place();
      if (parsed.mode === 'scene') noteDraft(p, parsed.q);
      if (!p || (parsed.mode === 'scene' && p.snap.registry.scenes.size === 0 && !parsed.q)) return null;
      return parsed.mode === 'scene' ? sceneItems(p, parsed.q) : locationItems(p, parsed.q);
    },
  };
}
