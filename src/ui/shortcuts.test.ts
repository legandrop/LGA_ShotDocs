// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { getExtensionField, type AnyExtension } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { translate } from '../i18n';
import { entryShortcuts, HELP_ENTRIES } from '../help/entries';
import { PLACE_TEXTS, SHORTCUT_TEXTS } from '../help/shortcutTexts';
import { isCommentShortcut, isSendShortcut } from './commentsUi';
import { isSelectAllKey } from './collapseEditor';
import { pageEditorExtensions } from './editorExtensions';
import { editorSchemaOptions } from './editorSchema';
import { isFindShortcut, isStepShortcut } from './findUi';
import { isPrintShortcut } from './printPage';
import { isSearchShortcut } from './projectSearchUi';
import { SHORTCUT_FILES, SHORTCUT_RULES } from './shortcutSources';
import { keyLabel, shortcut, shortcutLabel, SHORTCUT_PLACES, SHORTCUTS, slashBadge, type Shortcut } from './shortcuts';

// El registro único de atajos (Docs/Doc_Tutorial.md, sección 6) contra lo que hace la app de verdad: el editor
// real (BlockNote, Tiptap y nuestras extensiones), las funciones `is…Shortcut`, los archivos que escuchan teclas
// y la ayuda. Un atajo nuevo que no se suma al registro (y por lo tanto a la ayuda) hace fallar estas pruebas:
// así la regla "cada función nueva suma su ayuda" se cumple sola.

/** `Mod-Shift-z`, `Shift-Mod-z` y `Mod-Z` son lo mismo: modificadores ordenados y la letra en minúscula. */
function norm(keys: string): string {
  const parts = keys === '-' ? ['-'] : keys.split(/-(?!$)/);
  const key = parts.pop()!;
  const mods = ['Mod', 'Ctrl', 'Alt', 'Shift'].filter((m) => parts.includes(m));
  return [...mods, key.length === 1 ? key.toLowerCase() : key].join('-');
}

describe('el registro', () => {
  it('ids únicos, lugares conocidos y cada atajo con su texto en los dos idiomas', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHORTCUTS) {
      expect(SHORTCUT_PLACES, s.id).toContain(s.place);
      expect(s.keys.length, s.id).toBeGreaterThan(0);
      const key = SHORTCUT_TEXTS[s.id];
      expect(key, `${s.id} sin texto en shortcutTexts.ts`).toBeTruthy();
      expect(translate('en', key)).not.toBe(key);
      expect(translate('es', key)).not.toBe(key);
      if (s.source === 'window' || s.source === 'dom') expect(SHORTCUT_FILES[s.id]?.length, `${s.id} sin archivos`).toBeGreaterThan(0);
      if (s.source === 'typed' && s.id !== 'mdSlash') expect(SHORTCUT_RULES[s.id]?.length, `${s.id} sin reglas`).toBeGreaterThan(0);
    }
    for (const place of SHORTCUT_PLACES) expect(translate('es', PLACE_TEXTS[place])).not.toBe(PLACE_TEXTS[place]);
    // Nada de textos que sobren.
    for (const id of [...Object.keys(SHORTCUT_TEXTS), ...Object.keys(SHORTCUT_FILES), ...Object.keys(SHORTCUT_RULES)]) expect(() => shortcut(id)).not.toThrow();
  });

  it('rótulos de la Mac (con ⌘, nunca Ctrl) y del resto', () => {
    const both = (id: string) => [shortcutLabel(id, true), shortcutLabel(id, false)];
    expect(both('find')).toEqual(['⌘F', 'Ctrl+F']);
    expect(both('search')).toEqual(['⌘K', 'Ctrl+K']);
    expect(both('print')).toEqual(['⌘P', 'Ctrl+P']);
    expect(both('comment')).toEqual(['⌘⌥M', 'Ctrl+Alt+M']);
    expect(both('question')).toEqual(['⌘⌥P', 'Ctrl+Alt+P']);
    expect(both('collapse')).toEqual(['⌘⌥↩', 'Ctrl+Alt+Enter']);
    expect(both('commentsSend')).toEqual(['⌘↩', 'Ctrl+Enter']);
    expect(both('heading')).toEqual(['⌘⌥1…6', 'Ctrl+Alt+1…6']);
    expect(both('redo')).toEqual(['⌘⇧Z / ⌘Y', 'Ctrl+Shift+Z / Ctrl+Y']);
    expect(both('moveUp')).toEqual(['⌘⇧↑', 'Ctrl+Shift+↑']);
    expect(both('findNext')).toEqual(['Enter / F3 / ⌘G', 'Enter / F3 / Ctrl+G']);
    expect(both('findPrev')).toEqual(['⇧↩ / ⇧F3 / ⌘⇧G', 'Shift+Enter / Shift+F3 / Ctrl+Shift+G']);
    expect(shortcutLabel('treeEnds', false, 'es')).toBe('Inicio / Fin');
    expect(shortcutLabel('mdHeading')).toBe('#  ##  ###');
    for (const s of SHORTCUTS) {
      if (s.source === 'typed') continue;
      const mac = shortcutLabel(s.id, true);
      expect(mac, s.id).not.toMatch(/Ctrl/);
      expect(keyLabel('Mod-x', true)).toBe('⌘X');
    }
  });

  it('los rótulos del menú "/" salen del registro, y "Bloque de código" queda sin el ⌘⌥C que no existe', () => {
    expect(slashBadge('heading_2', false)).toBe('Ctrl+Alt+2');
    expect(slashBadge('heading', true)).toBe('⌘⌥1');
    expect(slashBadge('numbered_list', false)).toBe('Ctrl+Shift+7');
    expect(slashBadge('paragraph', true)).toBe('⌘⌥0');
    expect(slashBadge('code_block', false)).toBeUndefined();
    expect(slashBadge(undefined)).toBeUndefined();
  });

  it('sin choques: las mismas teclas en lugares que se pisan solo con distinto contexto', () => {
    const overlap = (a: Shortcut, b: Shortcut) => a.place === b.place || a.place === 'global' || b.place === 'global';
    const clashes: string[] = [];
    for (const [i, a] of SHORTCUTS.entries()) {
      for (const b of SHORTCUTS.slice(i + 1)) {
        if (a.source === 'typed' || b.source === 'typed' || !overlap(a, b) || (a.context ?? '') !== (b.context ?? '')) continue;
        // `global` solo choca con un atajo con modificador (Enter en el editor no es Enter en la barra de buscar).
        const keysA = new Set(a.keys.map(norm));
        for (const k of b.keys.map(norm)) {
          if (!keysA.has(k)) continue;
          if (a.place !== b.place && !/^(Mod|Ctrl|Alt)-/.test(k)) continue;
          clashes.push(`${a.id} y ${b.id}: ${k}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it('la ayuda nombra atajos que existen, con los mismos {valores} que sus textos', () => {
    for (const entry of HELP_ENTRIES) {
      for (const id of entryShortcuts(entry)) expect(() => shortcut(id), `${entry.id}: ${id}`).not.toThrow();
      const names = Object.keys(entry.keys ?? {}).sort();
      for (const lang of ['en', 'es'] as const) {
        const text = translate(lang, entry.text);
        const used = [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
        expect(used, `${entry.id} (${lang})`).toEqual(names);
      }
    }
  });
});

// --- El editor real ---------------------------------------------------------------------------------------

/**
 * Teclas de edición que no se documentan como atajos (escribir, borrar, moverse con las flechas): las maneja el
 * editor en todos los programas igual. Cualquier otra que aparezca en el editor tiene que estar en el registro.
 */
const UNDOCUMENTED = new Set(['Backspace', 'Delete', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift-ArrowDown', 'Shift-ArrowRight']);
/**
 * Extensiones de BlockNote que no vemos: los bloques con vista previa (LaTeX, diagramas) no están en el esquema
 * de la app. Si BlockNote los suma al esquema por defecto, hay que revisar.
 */
const NOT_IN_APP = new Set(['sourceBlockWithPreview', 'sourceInlineContentWithPreview']);

describe('el editor real contra el registro', () => {
  const doc = new Y.Doc();
  const editor = BlockNoteEditor.create(
    withCollaboration({
      ...editorSchemaOptions,
      collaboration: { fragment: doc.getXmlFragment('x'), user: { name: 'u', color: '#000' } },
      extensions: pageEditorExtensions({}),
    } as never),
  ) as unknown as BlockNoteEditor & { _tiptapEditor: { extensionManager: { extensions: AnyExtension[] } } };
  editor.mount(document.createElement('div'));
  afterAll(() => editor.unmount());

  /** Cada atajo del editor: de qué extensión es y qué teclas. */
  function editorKeys(): { from: string; keys: string }[] {
    const out: { from: string; keys: string }[] = [];
    for (const [key, ext] of editor.extensions as Map<string, { keyboardShortcuts?: Record<string, unknown> }>) {
      if (NOT_IN_APP.has(key)) continue;
      for (const k of Object.keys(ext.keyboardShortcuts ?? {})) out.push({ from: key, keys: k });
    }
    const tiptap = editor._tiptapEditor;
    for (const ext of tiptap.extensionManager.extensions) {
      const fn = getExtensionField<(() => Record<string, unknown>) | undefined>(ext, 'addKeyboardShortcuts', {
        name: ext.name,
        options: ext.options,
        storage: ext.storage,
        editor: tiptap,
        type: null,
        parent: undefined,
      } as never);
      for (const k of Object.keys(fn?.() ?? {})) out.push({ from: ext.name || 'blocknote-keyboard', keys: k });
    }
    return out;
  }

  it('cada atajo del editor está en el registro (o es una tecla de edición)', () => {
    const registered = new Set(SHORTCUTS.filter((s) => s.source === 'keymap').flatMap((s) => s.keys.map(norm)));
    const missing = editorKeys()
      .filter(({ keys }) => !registered.has(norm(keys)) && !UNDOCUMENTED.has(norm(keys)))
      .map(({ from, keys }) => `${from}: ${keys}`);
    expect(missing, 'atajos del editor que faltan en src/ui/shortcuts.ts').toEqual([]);
  });

  it('cada atajo de ProseMirror del registro existe en el editor (si BlockNote saca uno, la ayuda no miente)', () => {
    const present = new Set(editorKeys().map(({ keys }) => norm(keys)));
    const gone = SHORTCUTS.filter((s) => s.source === 'keymap').flatMap((s) => s.keys.filter((k) => !present.has(norm(k))).map((k) => `${s.id}: ${k}`));
    expect(gone).toEqual([]);
    // El de los bloques de código que nombraba un diseño viejo no existe en esta versión de BlockNote.
    expect(present.has(norm('Mod-Alt-c'))).toBe(false);
  });

  it('las reglas de lo que se escribe ("# ", "- ", "> "…) son las del registro', () => {
    const withRules = [...(editor.extensions as Map<string, { inputRules?: unknown[] }>)]
      .filter(([key, ext]) => !NOT_IN_APP.has(key) && (ext.inputRules?.length ?? 0) > 0)
      .map(([key]) => key)
      .sort();
    const listed = Object.values(SHORTCUT_RULES).flat().sort();
    expect(listed).toEqual(withRules);
  });
});

// --- Las funciones que toman atajos en `window` -------------------------------------------------------------

type Fn = (e: never, mac?: boolean) => boolean;
/** Cada función `is…Shortcut` de la app con su entrada del registro. Una función nueva tiene que sumarse acá. */
const FUNCTIONS: Record<string, { fn: Fn; id: string; keys?: string[] }> = {
  isFindShortcut: { fn: isFindShortcut as Fn, id: 'find' },
  isSearchShortcut: { fn: isSearchShortcut as Fn, id: 'search' },
  isPrintShortcut: { fn: isPrintShortcut as Fn, id: 'print' },
  isCommentShortcut: { fn: isCommentShortcut as Fn, id: 'comment' },
  isSendShortcut: { fn: isSendShortcut as Fn, id: 'commentsSend' },
  // F3 / Shift+F3 y Ctrl/⌘+G (con Shift, la anterior): la barra decide la dirección con Shift.
  isStepShortcut: { fn: isStepShortcut as Fn, id: 'findNext', keys: ['F3', 'Mod-g', 'Shift-F3', 'Mod-Shift-g'] },
  isSelectAllKey: { fn: isSelectAllKey as Fn, id: 'selectAll' },
};

/** Un evento de teclado sintético para esas teclas, en la Mac (⌘) o en Windows (Ctrl). */
function eventFor(keys: string, mac: boolean, flip = false) {
  const parts = keys.split(/-(?!$)/);
  const key = parts.pop()!;
  const mod = parts.includes('Mod');
  const useMeta = mac !== flip;
  return {
    key,
    code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : key,
    ctrlKey: (mod && !useMeta) || parts.includes('Ctrl'),
    metaKey: mod && useMeta,
    altKey: parts.includes('Alt'),
    shiftKey: parts.includes('Shift'),
    getModifierState: () => false,
  };
}

describe('las funciones is…Shortcut dicen lo mismo que el registro', () => {
  it('cada función acepta sus teclas en la Mac (⌘) y en Windows (Ctrl), y no con la tecla de la otra plataforma', () => {
    for (const [name, { fn, id, keys }] of Object.entries(FUNCTIONS)) {
      for (const k of (keys ?? shortcut(id).keys).filter((k) => /^(Mod|F\d)/.test(k) || k.includes('Mod'))) {
        for (const mac of [true, false]) {
          expect(fn(eventFor(k, mac) as never, mac), `${name} ${k} mac=${mac}`).toBe(true);
          if (k.includes('Mod')) expect(fn(eventFor(k, mac, true) as never, mac), `${name} ${k} al revés, mac=${mac}`).toBe(false);
        }
      }
    }
  });

  it('no hay funciones de atajos sin registrar', () => {
    const found = new Set<string>();
    for (const [, code] of sourceFiles()) {
      for (const m of code.matchAll(/export function (is\w+Shortcut)\b/g)) found.add(m[1]);
    }
    const unknown = [...found].filter((name) => !(name in FUNCTIONS));
    expect(unknown, 'funciones is…Shortcut sin su entrada en FUNCTIONS (y en el registro)').toEqual([]);
  });
});

// --- El código que escucha teclas ---------------------------------------------------------------------------

const SRC = resolve(__dirname, '..');

/** Los archivos de la app (todo `src`, sin las pruebas ni los diccionarios). */
function sourceFiles(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== 'i18n' && name !== 'fixtures') walk(path);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
        out.set(path, readFileSync(path, 'utf8'));
      }
    }
  };
  walk(SRC);
  return out;
}

/** Las teclas que un archivo compara con las de un evento: `e.key === 'Enter'`, `case 'Home':`, `isLetter(e, 'k')`. */
function comparedKeys(code: string): string[] {
  const found = [
    ...[...code.matchAll(/\b(?:e|ev|event|evt)\.key\s*(?:===|!==)\s*'([^']*)'/g)].map((m) => m[1]),
    ...[...code.matchAll(/\b(?:e|ev|event|evt)\.key\.toLowerCase\(\)\s*(?:===|!==)\s*'([^']*)'/g)].map((m) => m[1]),
    ...[...code.matchAll(/\b(?:e|ev|event|evt)\.code\s*(?:===|!==)\s*'Key([A-Z])'/g)].map((m) => m[1]),
    ...[...code.matchAll(/\bisLetter\(\w+,\s*'(\w)'\)/g)].map((m) => m[1]),
    // Un `switch` sobre la tecla (treeNav.ts).
    ...(/switch\s*\(\s*(?:e\.)?key\s*\)/.test(code) ? [...code.matchAll(/case '([^']*)':/g)].map((m) => m[1]) : []),
  ];
  return found.map(keyName);
}

/** Una tecla como en el registro: la barra espaciadora es `Space`, las letras en minúscula. */
const keyName = (key: string) => (key === ' ' ? 'Space' : key.length === 1 ? key.toLowerCase() : key);

/** Teclas que se miran sin ser atajos: escribir con un IME, el foco atrapado de un diálogo, los modificadores solos. */
const NOT_SHORTCUTS = new Set(['Tab', 'Dead', 'Process', 'Shift', 'Control', 'Meta', 'Alt', 'AltGraph', 'OS']);

describe('el código contra el registro', () => {
  it('cada combinación escrita en el código ("Mod-…", "Shift-…") está en el registro', () => {
    const registered = new Set(SHORTCUTS.flatMap((s) => s.keys.map(norm)));
    const loose: string[] = [];
    for (const [path, code] of sourceFiles()) {
      if (basename(path) === 'shortcuts.ts') continue;
      for (const m of code.matchAll(/['"`]((?:Mod|Shift|Alt|Ctrl)-[A-Za-z0-9-]+)['"`]/g)) {
        if (!registered.has(norm(m[1])) && !UNDOCUMENTED.has(norm(m[1]))) loose.push(`${basename(path)}: ${m[1]}`);
      }
    }
    expect(loose).toEqual([]);
  });

  it('cada tecla que el código compara con un evento es de un atajo del registro de ese archivo', () => {
    // Las teclas de los atajos de cada archivo (shortcutSources.ts), como las escribe el evento.
    const byFile = new Map<string, Set<string>>();
    for (const [id, files] of Object.entries(SHORTCUT_FILES)) {
      for (const file of files) {
        const set = byFile.get(file) ?? new Set<string>();
        for (const k of shortcut(id).keys) set.add(keyName(k.split(/-(?!$)/).pop()!));
        byFile.set(file, set);
      }
    }
    const missing: string[] = [];
    for (const [path, code] of sourceFiles()) {
      const keys = comparedKeys(code).filter((k) => !NOT_SHORTCUTS.has(k));
      const known = byFile.get(basename(path));
      for (const k of new Set(keys)) if (!known?.has(k)) missing.push(`${basename(path)}: ${k}`);
    }
    // Una tecla nueva en un archivo (aunque el archivo ya tenga otros atajos) tiene que sumarse al registro, con
    // su archivo en shortcutSources.ts y su texto en la ayuda.
    expect(missing, 'teclas del código sin su atajo en shortcuts.ts / shortcutSources.ts').toEqual([]);
  });

  it('nada de `keymap()` sueltos de ProseMirror: los atajos del editor van por las extensiones (las ve la prueba)', () => {
    const loose = [...sourceFiles()].filter(([, code]) => /\bkeymap\(/.test(code)).map(([path]) => basename(path));
    expect(loose).toEqual([]);
  });
});
