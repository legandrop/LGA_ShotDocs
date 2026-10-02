import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useT, type Translate } from '../i18n';
import '../i18n/lazy/assistant';
import { navigate, pagePath } from '../router';
import { usePermissions, useServices, useSyncStatus } from '../services';
import { writeNewPage } from '../templates/dayReportCreate';
import { CloseIcon, SettingsIcon } from '../ui/icons';
import { IS_MAC, modPressed } from '../ui/findUi';
import { shortcutLabel } from '../ui/shortcuts';
import { appliedDoc, applySuggestion, retakeSnapshot, takeSnapshot, type ApplyOutcome, type Snapshot } from './apply';
import { closeAssistant, openAssistantSettings, useAssistantTarget, useAssistantUi } from './assistantUi';
import { applyFormat, formatSnapshotFrom, FORMATS, planFormat, takeFormatSnapshot, type FormatOutcome, type FormatPlan, type FormatSnapshot, type FormatTarget } from './format';
import { loadSettings, readKey, rememberLanguage, type AssistantSettings } from './keyStore';
import { cleanAnswer, diffKeys, parseAnswer, plainNew, type NewUnit, type OldUnit, type Parsed } from './markup';
import { parseSummary, plainBlocks, toPartialBlocks, type MdBlock, type MdParsed } from './mdBlocks';
import { insertSummary, parsePageTranslation, subpageBlocks, takePageSnapshot } from './pageActions';
import { fetchPolicy, policyAllows, type AssistantPolicy } from './policy';
import { buildRequest, EDIT_ONLY, LANGUAGES, PAGE_ACTIONS, type Action } from './prompt';
import { complete, isLocalProvider, PROVIDER_NAMES, ProviderError, type Usage } from './providers';
import './assistant.css';

// El panel del asistente (Docs/Doc_Asistente.md, entregas A1 y A2, secciones 6 y 11): las acciones sobre lo elegido,
// *Format as…*, las de la página entera (*Summarize page*, *Translate page*), la respuesta por partes, la vista previa y
// *Apply* / *Discard* / *Try again* / *Copy* / *Stop*. A la derecha, como los comentarios; en el teléfono, una hoja
// desde abajo. No es un diálogo: la página sigue a mano mientras el modelo piensa.
//
// La vista previa se dibuja con lo ya convertido y validado (markup.ts, mdBlocks.ts), nunca con el Markdown como HTML:
// sin imágenes, sin links, sin nada que el navegador vaya a buscar afuera (6.1, paso 4).

/** Lo que llegó, ya convertido y validado, según la acción. */
type Result =
  /** A1: lo elegido con otro texto (cada pedazo en su bloque). */
  | { type: 'text'; parsed: Parsed }
  /** *Translate page*: el título y cada bloque de la página, traducidos. */
  | { type: 'page'; title: string; parsed: Parsed }
  /** *Summarize page*: bloques nuevos. */
  | { type: 'summary'; md: MdParsed }
  /** *Format as…*: los bloques elegidos con otra forma. */
  | { type: 'format'; plan: FormatPlan };

type Phase =
  | { kind: 'idle'; note?: string }
  | { kind: 'running'; action: Action; text: string }
  /** `retake`: lo elegido cambió; *Try again* pide sobre lo que hay hoy en el mismo lugar. */
  | { kind: 'error'; action: Action; message: string; text?: string; retake?: boolean }
  | { kind: 'preview'; action: Action; result: Result; warnings: string[] }
  /** Creando la subpágina traducida (sin red, igual: es local). */
  | { kind: 'busy'; action: Action };

interface Run {
  action: Action;
  snapshot: Snapshot;
  /** *Format as…*: los bloques elegidos (con sus tipos, para la guarda). */
  format?: FormatSnapshot;
  target?: FormatTarget;
  language?: string;
  /** El nombre propio del idioma (para el título de la subpágina si el modelo no lo trajo). */
  languageName?: string;
  instruction?: string;
  /** El título de la página, en las acciones de la página entera. */
  title?: string;
}

/** El nombre de la clave CSS de lo elegido resaltado en la página (la API de resaltados: no toca el documento). */
const HIGHLIGHT = 'sd-assistant';

/** Resalta lo elegido en la página mientras se ve la vista previa (si el navegador sabe). Devuelve cómo sacarlo. */
function highlight(view: { domAtPos: (pos: number) => { node: Node; offset: number } } | null, from: number, to: number): () => void {
  const css = globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined;
  const H = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!view || !css?.highlights || !H) return () => undefined;
  try {
    const a = view.domAtPos(from);
    const b = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    css.highlights.set(HIGHLIGHT, new H(range));
  } catch {
    return () => undefined;
  }
  return () => css.highlights?.delete(HIGHLIGHT);
}

export function errorText(err: unknown, provider: string, tr: Translate): string {
  if (!(err instanceof ProviderError)) return tr('assistant.error.other', { provider, message: String((err as Error)?.message ?? err) });
  switch (err.kind) {
    case 'auth':
      return tr('assistant.error.auth', { provider });
    case 'forbidden':
      return tr('assistant.error.forbidden', { provider, message: err.message });
    case 'rateLimit':
      return err.retryAfter !== null ? tr('assistant.error.rateLimitIn', { seconds: err.retryAfter }) : tr('assistant.error.rateLimit');
    case 'spendTier':
      return tr('assistant.error.spendTier', { provider });
    case 'spendOwn':
      return tr('assistant.error.spendOwn', { provider });
    case 'model':
      return tr('assistant.error.model', { message: err.message });
    case 'network':
      return tr('assistant.error.network', { provider });
    case 'server':
      return tr('assistant.error.server', { provider, message: err.message });
    case 'aborted':
      return tr('assistant.stopped');
    default:
      return tr('assistant.error.other', { provider, message: err.message });
  }
}

const ACTION_LABELS: Record<Action, Parameters<Translate>[0]> = {
  fix: 'assistant.fix',
  improve: 'assistant.improve',
  shorter: 'assistant.shorter',
  translate: 'assistant.translate',
  ask: 'assistant.ask',
  summarize: 'assistant.summarize',
  translatePage: 'assistant.translatePage',
  format: 'assistant.format',
};

const actionLabel = (a: Action, tr: Translate) => tr(ACTION_LABELS[a]);

const FORMAT_LABELS: Record<FormatTarget, Parameters<Translate>[0]> = {
  bullets: 'assistant.format.bullets',
  checklist: 'assistant.format.checklist',
  table: 'assistant.format.table',
  headings: 'assistant.format.headings',
};

/** Una unidad dibujada con su formato (sin links ni imágenes de verdad). */
function Unit({ u }: { u: { text: string; marks: string[]; link: number | null; atom?: string } }) {
  if (u.atom === 'photo') return <span className="assistant-chip">▣</span>;
  if (u.atom === 'br' || u.text === '\n') return <br />;
  const cls = [...u.marks.map((m) => `md-${m}`), u.link !== null ? 'md-link' : ''].filter(Boolean).join(' ');
  return cls ? <span className={cls}>{u.text}</span> : <>{u.text}</>;
}

const asView = (u: NewUnit) => {
  const first = u.atoms[0];
  if (!first || first.t === 'photo') return { text: '', marks: [], link: null, atom: 'photo' };
  if (first.t === 'br') return { text: '\n', marks: [], link: null, atom: 'br' };
  return { text: u.text, marks: first.marks as string[], link: first.link };
};

/** Lo de antes y lo de después de un pedazo, con lo sacado tachado y lo agregado subrayado (por palabras). */
function PieceDiff({ before, after }: { before: OldUnit[]; after: NewUnit[] }) {
  // Para leer, dos cambios separados solo por un espacio se muestran juntos ("el kamara" → "La cámara"); aplicar
  // igual deja ese espacio como estaba.
  const hunks: { a0: number; a1: number; b0: number; b1: number }[] = [];
  const space = (u: { text: string }) => u.text.trim() === '' && u.text !== '\n';
  for (const h of diffKeys(
    before.map((u) => u.key),
    after.map((u) => u.key),
  )) {
    const prev = hunks[hunks.length - 1];
    if (prev && before.slice(prev.a1, h.a0).every(space) && after.slice(prev.b1, h.b0).every(space)) {
      prev.a1 = h.a1;
      prev.b1 = h.b1;
    } else hunks.push({ ...h });
  }
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (const h of [...hunks, { a0: before.length, a1: before.length, b0: after.length, b1: after.length }]) {
    for (; i < h.a0; i++) out.push(<Unit key={`e${k++}`} u={before[i]} />);
    if (h.a1 > h.a0) out.push(<del key={`d${k++}`}>{before.slice(h.a0, h.a1).map((u, n) => <Unit key={n} u={u} />)}</del>);
    if (h.b1 > h.b0) out.push(<ins key={`i${k++}`}>{after.slice(h.b0, h.b1).map((u, n) => <Unit key={n} u={asView(u)} />)}</ins>);
    i = h.a1;
  }
  return <p className="assistant-diff-block">{out}</p>;
}

/**
 * Lo nuevo de un pedazo, sin la diferencia (una traducción entera sería todo tachado y todo agregado), con la forma de
 * su bloque (el prefijo que viajó como contexto: el tipo no cambia).
 */
function NewText({ units, prefix }: { units: NewUnit[]; prefix: string }) {
  const p = prefix.trim();
  const heading = /^#+$/.test(p) ? Math.min(3, p.length) : 0;
  const lead = p === '-' ? '•' : /^\d/.test(p) ? '#' : p === '[ ]' ? '☐' : p === '[x]' ? '☑' : null;
  const cls = `assistant-diff-block${heading ? ` md-heading md-h${heading}` : ''}${p === '>' ? ' md-quote' : ''}`;
  return (
    <p className={cls}>
      {lead && <span className="assistant-lead">{lead}</span>}
      {units.map((u, n) => (
        <Unit key={n} u={asView(u)} />
      ))}
    </p>
  );
}

/** Unas letras nuevas con su formato (sin links ni fotos de verdad). */
function Atoms({ atoms }: { atoms: Extract<MdBlock, { kind: 'text' }>['atoms'] }) {
  const out: ReactNode[] = [];
  atoms.forEach((a, n) => {
    if (a.t === 'photo') out.push(<span key={n} className="assistant-chip">▣</span>);
    else if (a.t === 'br') out.push(<br key={n} />);
    else {
      const cls = [...a.marks.map((m) => `md-${m}`), a.link !== null ? 'md-link' : ''].filter(Boolean).join(' ');
      out.push(cls ? <span key={n} className={cls}>{a.ch}</span> : a.ch);
    }
  });
  return <>{out}</>;
}

/** Los bloques nuevos (*Summarize page*, *Format as…*), dibujados con su forma: nada de links ni imágenes de verdad. */
function BlocksPreview({ blocks, tr }: { blocks: MdBlock[]; tr: Translate }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'marker')
          return (
            <p key={i} className="assistant-diff-block">
              <span className="assistant-chip">{tr('assistant.blockChip')}</span>
            </p>
          );
        if (b.kind === 'table')
          return (
            <table key={i} className="assistant-table">
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) =>
                      b.header && j === 0 ? (
                        <th key={k}>
                          <Atoms atoms={c} />
                        </th>
                      ) : (
                        <td key={k}>
                          <Atoms atoms={c} />
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        const lead =
          b.type === 'bulletListItem' ? '•' : b.type === 'numberedListItem' ? '#' : b.type === 'checkListItem' ? (b.checked ? '☑' : '☐') : null;
        const cls = `assistant-diff-block md-${b.type}${b.type === 'heading' ? ` md-h${b.level ?? 2}` : ''}`;
        return (
          <p key={i} className={cls}>
            {lead && <span className="assistant-lead">{lead}</span>}
            <Atoms atoms={b.atoms} />
          </p>
        );
      })}
    </>
  );
}

export function AssistantPanel({ pageId }: { pageId: string }) {
  const services = useServices();
  const { user, workspace, client, tree, docs } = services;
  const status = useSyncStatus();
  const perms = usePermissions();
  const target = useAssistantTarget(pageId);
  const { settings: settingsOpen } = useAssistantUi();
  const tr = useT();
  const [settings, setSettings] = useState<AssistantSettings | null | undefined>(undefined);
  const [policy, setPolicy] = useState<AssistantPolicy | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [usage, setUsage] = useState<Usage | null>(null);
  const [language, setLanguage] = useState('en');
  const [formatTarget, setFormatTarget] = useState<FormatTarget>('bullets');
  const [instruction, setInstruction] = useState('');
  const run = useRef<Run | null>(null);
  const abort = useRef<AbortController | null>(null);
  const root = useRef<HTMLElement>(null);

  // Los ajustes se vuelven a leer al cerrar la ventana de ajustes (pudo cambiar el proveedor o la clave).
  useEffect(() => {
    if (settingsOpen) return;
    let live = true;
    void loadSettings(user.email)
      .then((s) => {
        if (!live) return;
        setSettings(s);
        if (s?.translateTo) setLanguage(s.translateTo);
      })
      .catch(() => live && setSettings(null));
    return () => {
      live = false;
    };
  }, [user.email, settingsOpen]);

  // La política, al abrir y otra vez al cerrar los ajustes (el dueño o un admin la pudo cambiar ahí, A2).
  useEffect(() => {
    if (settingsOpen) return;
    let live = true;
    void fetchPolicy(client, workspace.config.localKey || workspace.config.url).then((p) => live && setPolicy(p));
    return () => {
      live = false;
    };
  }, [client, workspace.config.localKey, workspace.config.url, settingsOpen]);

  // Cerrar el panel, cambiar de página o recargar descarta la sugerencia y corta el pedido (6.5).
  useEffect(() => () => abort.current?.abort(), []);

  // Lo elegido, resaltado en la página mientras se ve la sugerencia (no en las de la página entera: es toda).
  const snapshotRange = run.current && !PAGE_ACTIONS.has(run.current.action) ? run.current.snapshot.selected : undefined;
  const showing = phase.kind === 'preview' || phase.kind === 'running';
  useEffect(() => {
    if (!showing || !snapshotRange) return;
    return highlight(target?.view() ?? null, snapshotRange.from, snapshotRange.to);
  }, [showing, snapshotRange, target]);

  const canEdit = perms.canEditPage(pageId) && (target?.editable() ?? false);
  const row = tree.get(pageId);
  const canCreate = !!row && perms.canCreateIn(pageId, row.workspace_id) && canEdit;
  const hasEditor = !!target?.editor?.();
  const config = settings ? { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model } : null;
  const ready = !!settings && (settings.hasKey || settings.provider === 'compatible') && !!settings.model;
  const local = config ? isLocalProvider(config) : false;
  const allowed = policy === null || !config ? true : policyAllows(policy, config);
  const offline = !status.online && !local;
  const providerName = settings ? PROVIDER_NAMES[settings.provider] : '';
  const busy = phase.kind === 'running' || phase.kind === 'busy';

  /** Lo que no se pudo pedir, como aviso en la lista de acciones. */
  const idleNote = (reason: string, action: Action) =>
    tr(
      reason === 'inTable'
        ? 'assistant.format.inTable'
        : PAGE_ACTIONS.has(action)
          ? reason === 'empty'
            ? 'assistant.pageEmpty'
            : 'assistant.pageTooLong'
          : reason === 'empty'
            ? 'assistant.nothingSelected'
            : 'assistant.tooLong',
    );

  const start = useCallback(
    async (action: Action, again?: Run, retake = false) => {
      if (!settings || !config || busy) return;
      const view = target?.view();
      if (!view) return;
      const editor = target?.editor?.() ?? null;
      let next: Run;
      if (again && retake) {
        // Lo elegido cambió: se pide de nuevo sobre lo que hay hoy en el mismo lugar (la página entera, otra vez).
        const snapshot = PAGE_ACTIONS.has(again.action) ? takePageSnapshot(view.state) : retakeSnapshot(view.state, again.snapshot);
        const format = typeof snapshot !== 'string' && again.action === 'format' ? formatSnapshotFrom(snapshot, editor) : undefined;
        if (typeof snapshot === 'string' || format === null) {
          run.current = null;
          setPhase({ kind: 'idle', note: idleNote(typeof snapshot === 'string' ? snapshot : 'empty', again.action) });
          return;
        }
        next = { ...again, snapshot, format, title: PAGE_ACTIONS.has(again.action) ? (tree.get(pageId)?.title ?? '') : again.title };
      } else if (again) next = again;
      else {
        const lang = LANGUAGES.find((l) => l.id === language) ?? LANGUAGES[0];
        let snapshot: Snapshot;
        let format: FormatSnapshot | undefined;
        if (action === 'format') {
          const fs = takeFormatSnapshot(view.state, editor);
          if (typeof fs === 'string') {
            setPhase({ kind: 'idle', note: idleNote(fs, action) });
            return;
          }
          format = fs;
          snapshot = fs.snapshot;
        } else {
          const s = PAGE_ACTIONS.has(action) ? takePageSnapshot(view.state) : takeSnapshot(view.state);
          if (typeof s === 'string') {
            setPhase({ kind: 'idle', note: idleNote(s, action) });
            return;
          }
          snapshot = s;
        }
        next = {
          action,
          snapshot,
          format,
          target: action === 'format' ? formatTarget : undefined,
          language: lang.english,
          languageName: lang.native,
          instruction: action === 'ask' ? instruction : undefined,
          title: PAGE_ACTIONS.has(action) ? (tree.get(pageId)?.title ?? '') : undefined,
        };
        if (action === 'translate' || action === 'translatePage') void rememberLanguage(user.email, lang.id).catch(() => undefined);
      }
      run.current = next;
      const controller = new AbortController();
      abort.current?.abort();
      abort.current = controller;
      setUsage(null);
      setPhase({ kind: 'running', action: next.action, text: '' });
      const request = buildRequest(next.action, next.snapshot.selected, {
        language: next.language,
        instruction: next.instruction,
        format: next.target,
        title: next.title,
      });
      try {
        // La clave se descifra recién acá y queda solo en esta llamada.
        const answer = await complete(config, await readKey(user.email, config), request, {
          signal: controller.signal,
          onText: (text) => {
            if (abort.current === controller) setPhase({ kind: 'running', action: next.action, text });
          },
        });
        if (abort.current !== controller) return;
        setUsage(answer.usage);
        if (answer.cut || !cleanAnswer(answer.text)) {
          setPhase({ kind: 'error', action: next.action, message: tr('assistant.cutOff'), text: answer.text });
          return;
        }
        const result = readAnswer(next, answer.text);
        if (typeof result === 'string') {
          // Quien no puede editar igual solo copia: no se le habla de fotos o bloques que no se aplicarían.
          const message = !canEdit
            ? tr('assistant.copyOnly')
            : result === 'marker'
              ? tr('assistant.invalid.marker')
              : result === 'structure'
                ? tr('assistant.invalid.structure')
                : tr('assistant.cutOff');
          setPhase({ kind: 'error', action: next.action, message, text: answer.text });
          return;
        }
        setPhase({ kind: 'preview', action: next.action, result, warnings: warningsOf(next, result, tr) });
      } catch (err) {
        if (abort.current !== controller) return;
        setPhase({ kind: 'error', action: next.action, message: errorText(err, providerName, tr) });
      }
    },
    [settings, config, busy, target, language, formatTarget, instruction, user.email, tr, providerName, canEdit, tree, pageId],
  );

  const stop = () => {
    abort.current?.abort();
    abort.current = null;
    setPhase((p) => (p.kind === 'running' ? { kind: 'error', action: p.action, message: tr('assistant.stopped'), text: p.text } : p));
  };

  const discard = () => {
    abort.current?.abort();
    abort.current = null;
    run.current = null;
    setPhase({ kind: 'idle' });
  };

  /** Lo que dice el panel cuando aplicar no se pudo. */
  const failure = (action: Action, outcome: ApplyOutcome | FormatOutcome) => {
    if (outcome.ok) return;
    const message =
      outcome.reason === 'changed'
        ? tr('assistant.changed')
        : outcome.reason === 'readOnly'
          ? tr('assistant.readOnly')
          : outcome.reason === 'nested'
            ? tr('assistant.format.nested')
            : tr('assistant.failed');
    setPhase({ kind: 'error', action, message, retake: outcome.reason === 'changed' });
  };

  /**
   * Aplica lo de la vista previa. `how`: en *Translate page*, `replace` o `subpage`; en *Summarize page*, `top` o
   * `below`. El permiso se mira otra vez al aplicar (7.1): pudo cambiar mientras se veía la sugerencia.
   */
  const apply = async (how?: 'replace' | 'subpage' | 'top' | 'below') => {
    if (phase.kind !== 'preview' || !run.current) return;
    const current = run.current;
    const view = target?.view() ?? null;
    const editor = target?.editor?.() ?? null;
    const writable = perms.canEditPage(pageId) && (target?.editable() ?? false);
    const { result, action } = phase;
    if (!view) {
      setPhase({ kind: 'error', action, message: tr('assistant.readOnly') });
      return;
    }
    if (result.type === 'page' && how === 'subpage') {
      await createSubpage(current, result.title, result.parsed);
      return;
    }
    let outcome: ApplyOutcome | FormatOutcome;
    if (result.type === 'text' || result.type === 'page') outcome = applySuggestion(view, current.snapshot, result.parsed, writable);
    else if (result.type === 'summary')
      outcome = insertSummary(editor, view, toPartialBlocks(result.md.blocks, { photos: new Map(), links: new Map(), blocks: new Map() }), how === 'below' ? 'below' : 'top', writable);
    else outcome = current.format ? applyFormat(editor, view, current.format, result.plan, writable) : { ok: false, reason: 'failed' };
    if (!outcome.ok) {
      failure(action, outcome);
      return;
    }
    run.current = null;
    const undo = shortcutLabel('undo');
    const note =
      outcome.changed === 0
        ? tr(result.type === 'format' ? 'assistant.format.nothing' : 'assistant.nothingChanged')
        : tr(result.type === 'summary' ? 'assistant.inserted' : 'assistant.applied', { undo });
    setPhase({ kind: 'idle', note });
    view.focus();
  };

  /** *Create translated subpage*: una página nueva adentro de esta, con la traducción, por el camino de siempre. */
  const createSubpage = async (current: Run, title: string, parsed: Parsed) => {
    const view = target?.view() ?? null;
    const page = tree.get(pageId);
    if (!view || !page || !perms.canCreateIn(pageId, page.workspace_id) || !(target?.editable() ?? false)) {
      setPhase({ kind: 'error', action: current.action, message: tr('assistant.subpage.denied') });
      return;
    }
    // La guarda: la copia se arma sobre la página de hoy solo si sigue como cuando se pidió.
    const doc = appliedDoc(view.state, current.snapshot, parsed);
    if (!doc) {
      setPhase({ kind: 'error', action: current.action, message: tr('assistant.changed'), retake: true });
      return;
    }
    const blocks = subpageBlocks(doc);
    const name = title || `${page.title || tr('assistant.subpage.untitled')} (${current.languageName ?? current.language ?? ''})`;
    setPhase({ kind: 'busy', action: current.action });
    let id: string;
    try {
      id = await tree.create(pageId, name, page.workspace_id);
    } catch (err) {
      console.error('Asistente: no se pudo crear la subpágina', err);
      setPhase({ kind: 'error', action: current.action, message: tr('assistant.failed') });
      return;
    }
    try {
      await writeNewPage(docs, id, blocks as never);
    } catch (err) {
      console.error('Asistente: la subpágina se creó pero no se pudo escribir', err);
      setPhase({ kind: 'error', action: current.action, message: tr('assistant.subpage.failed') });
      return;
    }
    run.current = null;
    setPhase({ kind: 'idle', note: tr('assistant.subpage.created') });
    navigate(pagePath(id));
  };

  const copy = () => {
    let text = '';
    if (phase.kind === 'preview') {
      const r = phase.result;
      text =
        r.type === 'text'
          ? plainNew(r.parsed.blocks)
          : r.type === 'page'
            ? [r.title, plainNew(r.parsed.blocks)].filter(Boolean).join('\n\n')
            : plainBlocks(r.type === 'summary' ? r.md.blocks : r.plan.blocks);
    } else if (phase.kind === 'error' || phase.kind === 'running') {
      text = cleanAnswer(phase.text ?? '').replace(/⟦\/?(?:photo|link|block|title)(?::\d+)?⟧/g, '');
    }
    if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  /** La vista previa tiene un solo *Apply* (Ctrl/⌘+Enter): lo elegido de A1 y *Format as…*. */
  const singleApply = phase.kind === 'preview' && (phase.result.type === 'text' || phase.result.type === 'format');

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (phase.kind === 'idle') closeAssistant();
      else if (phase.kind === 'running') stop();
      else if (phase.kind !== 'busy') discard();
      return;
    }
    if (e.key === 'Enter' && modPressed(e, IS_MAC) && singleApply && canEdit) {
      e.preventDefault();
      void apply();
    }
  };

  // Al abrir, el foco va al panel (Esc lo cierra); la página sigue a mano.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  // El botón que se tocó desaparece al pedir (y otra vez con la respuesta) y el foco queda en la nada: vuelve al panel,
  // así Esc y Ctrl/⌘+Enter andan sin hacer clic. Si la persona siguió escribiendo en la página, el foco queda donde está.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) root.current?.focus({ preventScroll: true });
  }, [phase.kind]);

  const notice = !allowed
    ? tr(policy === 'off' ? 'assistant.policyOff' : 'assistant.policyLocal')
    : offline
      ? tr('assistant.offline')
      : null;
  const blocked = !ready || !allowed || offline;

  const languageSelect = (label: 'assistant.language' | 'assistant.pageLanguage') => (
    <select aria-label={tr(label)} value={language} onChange={(e) => setLanguage(e.target.value)} disabled={blocked}>
      {LANGUAGES.map((l) => (
        <option key={l.id} value={l.id}>
          {l.native}
        </option>
      ))}
    </select>
  );

  const previewBody = (p: Extract<Phase, { kind: 'preview' }>, r: Run) => {
    const result = p.result;
    if (result.type === 'text')
      return r.snapshot.selected.pieces.map((piece, i) =>
        piece.kind === 'block' ? (
          <p key={i} className="assistant-diff-block">
            <span className="assistant-chip">{tr('assistant.blockChip')}</span>
          </p>
        ) : (
          <PieceDiff key={i} before={piece.units} after={result.parsed.blocks[i] ?? []} />
        ),
      );
    if (result.type === 'page')
      return [
        <p key="t" className="assistant-diff-block md-heading md-h1">
          {result.title}
        </p>,
        ...r.snapshot.selected.pieces.map((piece, i) =>
          piece.kind === 'block' ? (
            <p key={i} className="assistant-diff-block">
              <span className="assistant-chip">{tr('assistant.blockChip')}</span>
            </p>
          ) : (
            <NewText key={i} units={result.parsed.blocks[i] ?? []} prefix={piece.prefix} />
          ),
        ),
      ];
    return <BlocksPreview blocks={result.type === 'summary' ? result.md.blocks : result.plan.blocks} tr={tr} />;
  };

  const previewButtons = (p: Extract<Phase, { kind: 'preview' }>, r: Run) => {
    const result = p.result;
    const again = (
      <button disabled={blocked} onClick={() => void start(p.action, r)}>
        {tr('assistant.tryAgain')}
      </button>
    );
    const copyButton = <button onClick={copy}>{tr('assistant.copy')}</button>;
    const discardButton = (
      <button onClick={discard} data-tip={shortcutLabel('menusClose')}>
        {tr('assistant.discard')}
      </button>
    );
    if (result.type === 'summary')
      return (
        <>
          <button className="primary" disabled={!canEdit || !hasEditor} onClick={() => void apply('top')}>
            {tr('assistant.insertTop')}
          </button>
          <button disabled={!canEdit || !hasEditor} onClick={() => void apply('below')}>
            {tr('assistant.insertBelow')}
          </button>
          {copyButton}
          {discardButton}
          {again}
        </>
      );
    if (result.type === 'page')
      return (
        <>
          <button className="primary" disabled={!canEdit} onClick={() => void apply('replace')}>
            {tr('assistant.replacePage')}
          </button>
          <button disabled={!canCreate} onClick={() => void apply('subpage')}>
            {tr('assistant.createSubpage')}
          </button>
          {copyButton}
          {discardButton}
          {again}
        </>
      );
    return (
      <>
        <button className="primary" disabled={!canEdit || (result.type === 'format' && !hasEditor)} data-tip={shortcutLabel('assistantApply')} onClick={() => void apply()}>
          {tr('assistant.apply')}
        </button>
        {discardButton}
        {again}
        {copyButton}
      </>
    );
  };

  return (
    <aside
      ref={root}
      className="assistant-panel"
      role="complementary"
      aria-label={tr('assistant.title')}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="assistant-head">
        <h2>{tr('assistant.title')}</h2>
        <button className="icon-button" aria-label={tr('assistant.settings')} data-tip={tr('assistant.settings')} onClick={openAssistantSettings}>
          <SettingsIcon size={18} />
        </button>
        <button className="icon-button" aria-label={tr('assistant.close')} onClick={closeAssistant}>
          <CloseIcon size={18} />
        </button>
      </header>
      <div className="assistant-body">
        {settings === undefined ? null : !ready ? (
          <div className="assistant-setup">
            <p>{tr('assistant.setupText')}</p>
            <button className="primary" onClick={openAssistantSettings}>
              {tr('assistant.setup')}
            </button>
          </div>
        ) : (
          <>
            {notice && (
              <p className="assistant-notice" role="status">
                {notice}
              </p>
            )}
            {!canEdit && (perms.known || target?.editable() === false) && <p className="assistant-notice">{tr('assistant.readOnly')}</p>}
            {phase.kind === 'idle' && (
              <div className="assistant-actions">
                {(['fix', 'improve', 'shorter'] as Action[]).map((a) => (
                  <button key={a} className="assistant-action" disabled={blocked || (EDIT_ONLY.has(a) && !canEdit)} onClick={() => void start(a)}>
                    {actionLabel(a, tr)}
                  </button>
                ))}
                <div className="assistant-row">
                  <button className="assistant-action" disabled={blocked} onClick={() => void start('translate')}>
                    {tr('assistant.translate')}
                  </button>
                  {languageSelect('assistant.language')}
                </div>
                <div className="assistant-row">
                  <button className="assistant-action" disabled={blocked || !canEdit || !hasEditor} onClick={() => void start('format')}>
                    {tr('assistant.format')}
                  </button>
                  <select aria-label={tr('assistant.formatShape')} value={formatTarget} onChange={(e) => setFormatTarget(e.target.value as FormatTarget)} disabled={blocked || !canEdit || !hasEditor}>
                    {FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {tr(FORMAT_LABELS[f])}
                      </option>
                    ))}
                  </select>
                </div>
                <form
                  className="assistant-ask"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (instruction.trim()) void start('ask');
                  }}
                >
                  <input
                    type="text"
                    value={instruction}
                    placeholder={tr('assistant.askPlaceholder')}
                    aria-label={tr('assistant.ask')}
                    maxLength={500}
                    disabled={blocked}
                    onChange={(e) => setInstruction(e.target.value)}
                  />
                  <button type="submit" disabled={blocked || !instruction.trim()}>
                    {tr('assistant.send')}
                  </button>
                </form>
                <p className="muted assistant-hint">{phase.note ?? tr('assistant.hint')}</p>
                <p className="mono-label assistant-section">{tr('assistant.pageSection')}</p>
                <button className="assistant-action" disabled={blocked} onClick={() => void start('summarize')}>
                  {tr('assistant.summarize')}
                </button>
                <div className="assistant-row">
                  <button className="assistant-action" disabled={blocked} onClick={() => void start('translatePage')}>
                    {tr('assistant.translatePage')}
                  </button>
                  {languageSelect('assistant.pageLanguage')}
                </div>
                <p className="muted assistant-hint">{tr('assistant.pageHint')}</p>
              </div>
            )}
            {phase.kind === 'running' && (
              <div className="assistant-result">
                <p className="mono-label">{tr('assistant.thinking', { action: actionLabel(phase.action, tr) })}</p>
                {/* Lo que llega, como texto: nada se interpreta hasta el final. */}
                <div className="assistant-stream">{phase.text}</div>
                <div className="assistant-buttons">
                  <button onClick={stop}>{tr('assistant.stop')}</button>
                </div>
              </div>
            )}
            {phase.kind === 'busy' && (
              <div className="assistant-result">
                <p className="mono-label" role="status">
                  {tr('assistant.subpage.creating')}
                </p>
              </div>
            )}
            {phase.kind === 'error' && (
              <div className="assistant-result">
                <p className="assistant-error" role="alert">
                  {phase.message}
                </p>
                {phase.text && <div className="assistant-stream">{cleanAnswer(phase.text)}</div>}
                <div className="assistant-buttons">
                  {run.current && (
                    <button className="primary" disabled={blocked} onClick={() => void start(run.current!.action, run.current!, phase.retake)}>
                      {tr('assistant.tryAgain')}
                    </button>
                  )}
                  {phase.text && <button onClick={copy}>{tr('assistant.copy')}</button>}
                  <button className="link" onClick={discard}>
                    {tr('assistant.back')}
                  </button>
                </div>
              </div>
            )}
            {phase.kind === 'preview' && run.current && (
              <div className="assistant-result">
                <p className="mono-label">
                  {actionLabel(phase.action, tr)}
                  {run.current.target ? ` · ${tr(FORMAT_LABELS[run.current.target])}` : ''}
                </p>
                <div className="assistant-diff" aria-label={tr('assistant.preview')}>
                  {previewBody(phase, run.current)}
                </div>
                {phase.warnings.map((w) => (
                  <p key={w} className="assistant-warning">
                    {w}
                  </p>
                ))}
                <div className="assistant-buttons">{previewButtons(phase, run.current)}</div>
              </div>
            )}
          </>
        )}
      </div>
      {settings && ready && (
        <footer className="assistant-foot mono-label">
          {providerName} · {settings.model}
          {usage && (usage.input !== null || usage.output !== null) && (
            <> · {tr('assistant.tokens', { input: (usage.input ?? 0).toLocaleString(tr.lang === 'es' ? 'es-AR' : 'en-US'), output: (usage.output ?? 0).toLocaleString(tr.lang === 'es' ? 'es-AR' : 'en-US') })}</>
          )}
        </footer>
      )}
    </aside>
  );
}

/** La respuesta convertida y validada según la acción, o por qué no se puede aplicar. */
function readAnswer(run: Run, text: string): Result | 'empty' | 'structure' | 'marker' {
  if (run.action === 'summarize') {
    const md = parseSummary(text);
    return md ? { type: 'summary', md } : 'empty';
  }
  if (run.action === 'translatePage') {
    const page = parsePageTranslation(text, run.snapshot.selected);
    return typeof page === 'string' ? page : { type: 'page', title: page.title, parsed: page.parsed };
  }
  if (run.action === 'format') {
    if (!run.format) return 'empty';
    const plan = planFormat(text, run.format);
    return typeof plan === 'string' ? plan : { type: 'format', plan };
  }
  const parsed = parseAnswer(text, run.snapshot.selected);
  return typeof parsed === 'string' ? parsed : { type: 'text', parsed };
}

/**
 * Los avisos de la vista previa (6.4): links sacados, un largo muy distinto en *Fix* o *Improve*, y en *Format as…* que
 * lo que otro escriba a la vez puede quedar solo en el historial (6.5).
 */
function warningsOf(run: Run, result: Result, tr: Translate): string[] {
  const out: string[] = [];
  const linksRemoved =
    result.type === 'text' || result.type === 'page' ? result.parsed.linksRemoved : result.type === 'summary' ? result.md.linksRemoved : result.plan.linksRemoved;
  if (linksRemoved) out.push(tr('assistant.linksRemoved'));
  if (result.type === 'text' && (run.action === 'fix' || run.action === 'improve')) {
    const before = run.snapshot.selected.plain.length;
    const after = plainNew(result.parsed.blocks).length;
    if (before > 0 && after > before * 3) out.push(tr('assistant.muchLonger'));
    else if (before > 0 && after * 3 < before) out.push(tr('assistant.muchShorter'));
  }
  if (result.type === 'format') out.push(tr('assistant.format.history'));
  return out;
}
