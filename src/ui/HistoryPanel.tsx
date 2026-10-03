import type { BlockNoteEditor } from '@blocknote/core';
import type { EditorView } from '@tiptap/pm/view';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import * as Y from 'yjs';
import { t, useT } from '../i18n';
import '../i18n/lazy/history';
import { mediaIdsInDoc } from '../media/usage';
import { isDeletedRow } from '../media/queue';
import { ServicesContext, usePermissions, useServices, useSyncStatus, useTree } from '../services';
import {
  linkAuthorName,
  MAX_RESTORE_BYTES,
  NAMED_VERSIONS_SCHEMA_VERSION,
  versionBreaks,
  versionBytes,
  type HistoryOrphan,
  type HistoryRow,
  type HistorySession,
  type PageVersionRow,
} from '../sync/history';
import { historyCacheFor, type HistoryCache } from '../sync/historyCache';
import { createHistoryEngine, type HistoryEngine } from '../sync/historyClient';
import { fetchVersions, loadHistory, markRestoreLater, settleRestores } from '../sync/historyLoad';
import type { HistorySummary } from '../sync/historyCore';
import type { BlockKind, ChangeLabel, HistoryMark } from '../sync/historyDiff';
import type { HistoryRemote, MediaRemote, NamedVersionsRemote } from '../sync/remote';
import { errorMessage, isNetworkError, RemoteError } from '../sync/types';
import { Permissions } from '../sync/access';
import { versionNode } from './historyRestore';
import { cleanClipboard, type HistoryMarksInput, type MarkLook } from './historyMarks';
import { MoreIcon } from './icons';
import { historyServices } from './historyServices';
import { closeHistory, requestRestore, restoreTargetSettled } from './historyUi';
import { dismissNotice, notify } from './notice';
import { BlockEditor } from './PageEditor';
import { ErrorBarrier } from './ErrorBarrier';
import type { FindEditor } from './FindBar';
import type { Schema } from '@tiptap/pm/model';
import { mm, pageFormat, SHEET_MARGIN_MM, sheetSize } from './pageFormat';
import { findUnknownContent } from './unknownContent';
import './history.css';

// El historial de versiones de una página (P.18, Docs/Doc_Historial.md): la lista de versiones agrupadas por sesión de
// edición con quién y cuándo, ver una versión tal como era (el editor de verdad, en solo lectura, sobre un documento en
// memoria) y restaurarla (una edición nueva por el editor de la página, que se deshace). Entrega 2: "Show changes"
// (prendido por defecto) marca lo agregado y lo borrado contra la versión anterior de la lista, con el color de cada
// persona (decoraciones, historyMarks.ts); el texto huérfano va en una franja aparte; el historial se arma en un Worker
// (historyClient.ts) y la lista se actualiza sola cuando llegan cambios nuevos.
//
// Entrega 3: versiones con nombre (nombrar, renombrar, sacar el nombre; *Only named versions*; *Restored from…* después
// de restaurar; `page_versions`, solo con la base migrada) y la caché (historyCache.ts): se baja solo lo nuevo y sin red
// se ve lo último bajado, con su aviso; restaurar y nombrar piden red.
//
// Todo se calcula en el dispositivo, con las filas de `page_history`. Nada de esta pantalla escribe en la base local de
// la página, en el servidor ni en el Drive, salvo los nombres de versión (`page_versions`, no el contenido) y la caché
// del historial: lo único que escribe en la página es restaurar, y lo hace el editor de la página.

/** Cuánto antes de restaurar se avisa que otra persona estuvo editando. */
const RECENT_OTHERS_MS = 2 * 60_000;

/** Lo bajado: las filas (en orden), los correos de los autores y la lista que armó el Worker. */
interface Ready {
  state: 'ready';
  rows: HistoryRow[];
  emails: Map<string, string>;
  summary: HistorySummary;
  /** Los nombres y las marcas de restauración; `null` si la base no los tiene: no se ofrece nombrar. */
  versions: PageVersionRow[] | null;
  /** Sin red: lo guardado en el dispositivo, bajado en ese momento. */
  offlineAt: number | null;
}

/** Nombrar o renombrar: la versión (por el `seq` de su última fila), el nombre que había y lo escrito. */
interface NameEdit {
  seq: number;
  /** El nombre que se cambia, o `null` para uno nuevo. */
  versionId: string | null;
  /** El id del nombre nuevo (lo crea el dispositivo: reintentar no duplica). */
  newId: string;
  value: string;
}

type Loading =
  | { state: 'loading'; count: number }
  | Ready
  | { state: 'offline' }
  | { state: 'denied' }
  | { state: 'trash' }
  | { state: 'failed'; reason: string };

/** Por qué no se puede restaurar (las claves enteras: la prueba del diccionario las busca literales). */
type Blocker =
  | 'history.why.offline'
  | 'history.why.pending'
  | 'history.why.missing'
  | 'history.why.shape'
  | 'history.why.unknown'
  | 'history.why.size'
  | 'history.why.outdated'
  | 'history.why.cantEdit'
  | 'history.why.notOpen';

/** Las claves de los tipos de bloque (enteras: la prueba del diccionario las busca literales). */
const KIND_KEYS = {
  paragraph: 'history.kind.paragraph',
  heading: 'history.kind.heading',
  bulletListItem: 'history.kind.bulletListItem',
  numberedListItem: 'history.kind.numberedListItem',
  checkListItem: 'history.kind.checkListItem',
  toggleListItem: 'history.kind.toggleListItem',
  quote: 'history.kind.quote',
  codeBlock: 'history.kind.codeBlock',
  table: 'history.kind.table',
  image: 'history.kind.image',
  script: 'history.kind.script',
  question: 'history.kind.question',
  pageBreak: 'history.kind.pageBreak',
  driveCard: 'history.kind.driveCard',
} as const;

type Tr = ReturnType<typeof useT>;

/** El nombre de un tipo de bloque ("Heading 2", "Script"); uno que no se conoce, por su nombre interno. */
export function kindName(kind: BlockKind, tr: Tr): string {
  const key = KIND_KEYS[(kind.prop ?? kind.type) as keyof typeof KIND_KEYS];
  return key ? tr(key, { level: kind.level ?? 1 }) : kind.type;
}

/** El rótulo de un bloque que cambió: "Changed to Heading 2", "Formatting changed", "Moved". */
export function labelText(label: ChangeLabel, tr: Tr): string {
  if (label.kind === 'type') return tr('history.changedTo', { kind: kindName(label.to, tr) });
  return label.kind === 'format' ? tr('history.formatChanged') : tr('history.moved');
}

/** Suma a las filas conocidas las que todavía no estaban (por `seq`, una vez cada una), en orden. */
export function mergeRows(known: readonly HistoryRow[], fresh: readonly HistoryRow[]): HistoryRow[] {
  const last = known.length ? known[known.length - 1].seq : 0;
  const added = fresh.filter((r) => r.seq > last).sort((a, b) => a.seq - b.seq);
  return [...known, ...added.filter((r, i) => i === 0 || r.seq !== added[i - 1].seq)];
}

/** Show changes queda como lo dejó la persona mientras la app está abierta (prendido por defecto). */
let showChangesMemory = true;
/** Only named versions, igual (apagado por defecto). */
let onlyNamedMemory = false;

/** Los nombres y las marcas en orden de fila. */
const bySeq = (a: PageVersionRow, b: PageVersionRow) => a.seq - b.seq || a.createdAt.localeCompare(b.createdAt);

/** El nombre de la versión de una sesión (el primero, si hubiera más de uno) y las restauraciones que trae. */
export function sessionLabels(
  session: HistorySession,
  rows: readonly HistoryRow[],
  versions: readonly PageVersionRow[] | null,
): { named: PageVersionRow | null; restores: PageVersionRow[] } {
  if (!versions?.length) return { named: null, restores: [] };
  const from = rows[session.first]?.seq ?? session.seq;
  const inside = versions.filter((v) => v.seq >= from && v.seq <= session.seq);
  return { named: inside.find((v) => v.kind === 'named') ?? null, restores: inside.filter((v) => v.kind === 'restore') };
}

function dayLabel(iso: string, lang: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return t('history.today');
  if (days === 1) return t('history.yesterday');
  if (days > 1 && days < 7) return d.toLocaleDateString(lang, { weekday: 'long' });
  return d.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function timeLabel(iso: string, lang: string): string {
  return new Date(iso).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

/** La fecha y la hora de una versión, para el aviso y la barra. */
export function whenLabel(iso: string, lang: string): string {
  return `${dayLabel(iso, lang)}, ${timeLabel(iso, lang)}`;
}

/** Lo mismo en medio de una frase ("Restored from yesterday, 14:05"): hoy y ayer en minúscula. */
export function whenInline(iso: string, lang: string): string {
  const day = dayLabel(iso, lang);
  const lower = day === t('history.today') || day === t('history.yesterday') ? day.charAt(0).toLocaleLowerCase(lang) + day.slice(1) : day;
  return `${lower}, ${timeLabel(iso, lang)}`;
}

/**
 * Quién (que no sea `me`) cambió la página en los últimos 2 minutos (con el reloj del dispositivo; `undefined` si nadie).
 * Es el aviso de antes de confirmar; lo que de verdad ataja es volver a mirar el servidor al confirmar (`restore`): si
 * llegó algo de otra persona desde que se mostró la confirmación, se vuelve a preguntar.
 */
export function recentOther(rows: readonly HistoryRow[], me: string, now = Date.now()): string | null | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (now - Date.parse(row.createdAt) >= RECENT_OTHERS_MS) break;
    if (row.createdBy !== me) return row.createdBy;
  }
  return undefined;
}

export function HistoryPanel({ pageId }: { pageId: string }) {
  const services = useServices();
  const { remote, engine, docs, user, dbName } = services;
  const status = useSyncStatus();
  const perms = usePermissions();
  const tree = useTree();
  const tr = useT();
  const lang = tr.lang === 'es' ? 'es' : 'en';
  const [loading, setLoading] = useState<Loading>({ state: 'loading', count: 0 });
  const [attempt, setAttempt] = useState(0);
  /** La versión elegida, por el `seq` de su última fila (sobrevive a que lleguen filas nuevas). */
  const [chosen, setChosen] = useState<number | null>(null);
  /** En el teléfono: la lista o la versión. */
  const [pane, setPane] = useState<'list' | 'version'>('list');
  const [unsynced, setUnsynced] = useState(false);
  const [missing, setMissing] = useState(false);
  /** El esquema de ProseMirror del editor de la versión (para la ida y vuelta). */
  const [pmSchema, setPmSchema] = useState<Schema | null>(null);
  const [confirm, setConfirm] = useState<{ photos: number; others: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showChanges, setShowChangesState] = useState(showChangesMemory);
  const setShowChanges = (on: boolean) => {
    showChangesMemory = on;
    setShowChangesState(on);
  };
  const previewServices = useMemo(() => historyServices(services), [services]);
  const historyRemote = remote as unknown as HistoryRemote & MediaRemote & NamedVersionsRemote;
  const [onlyNamed, setOnlyNamedState] = useState(onlyNamedMemory);
  const setOnlyNamed = (on: boolean) => {
    onlyNamedMemory = on;
    setOnlyNamedState(on);
  };
  /** Nombrar o renombrar una versión (el campo en la lista). */
  const [editing, setEditing] = useState<NameEdit | null>(null);
  /** El menú de una versión (por el `seq` de su última fila). */
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [naming, setNaming] = useState(false);
  /** La caché del historial y la generación con que se guardó lo que se muestra. */
  const cacheRef = useRef<HistoryCache | null>(null);
  const generationRef = useRef<number | null>(null);
  /**
   * Donde se arma el historial (un Worker, o la página si no se puede): uno por historial abierto. Se crea en el efecto
   * y se cierra al desmontar: con StrictMode (desarrollo) el efecto corre dos veces y cada vuelta tiene el suyo.
   */
  const [builder, setBuilder] = useState<HistoryEngine | null>(null);
  useEffect(() => {
    const made = createHistoryEngine();
    setBuilder(made);
    return () => made.destroy();
  }, []);
  /** El `seq` de la última fila conocida cuando se mostró la confirmación de restaurar (O1). */
  const confirmSeq = useRef(0);

  /**
   * Cómo estaba la red cuando el historial quedó sin conexión: con el dispositivo sin red, se vuelve a pedir cuando
   * vuelve; con red pero sin respuesta del servidor, recién después de una sincronización (no en cada vuelta).
   */
  const offlineMark = useRef<{ online: boolean; sync: number | null } | null>(null);
  const markOffline = () => {
    const st = engine.getStatus();
    offlineMark.current = { online: st.online, sync: st.lastSyncAt };
  };

  // Bajar el historial (lo guardado en el dispositivo más lo nuevo; sin red, lo guardado) y armarlo en el Worker.
  const servicesTree = services.tree;
  useEffect(() => {
    if (!builder) return;
    let cancelled = false;
    setLoading({ state: 'loading', count: 0 });
    (async () => {
      const cache = await historyCacheFor(dbName);
      const generation = (await servicesTree.knownGeneration().catch(() => undefined)) ?? null;
      cacheRef.current = cache;
      generationRef.current = generation;
      const status0 = engine.getStatus();
      const loaded = await loadHistory({
        remote: historyRemote,
        pageId,
        cache,
        generation,
        online: status0.online,
        namedVersions: (status0.schemaVersion ?? 0) >= NAMED_VERSIONS_SCHEMA_VERSION,
        onProgress: (count) => !cancelled && setLoading({ state: 'loading', count }),
        isCancelled: () => cancelled,
      });
      if (!loaded) return null;
      // Lo que llegue después se guarda con la generación con que quedó guardado esto (la del servidor, si se leyó).
      if (!cancelled) generationRef.current = loaded.generation;
      let versions = loaded.versions;
      // Las restauraciones de antes cuya marca no llegó a guardarse ("Restored from…").
      if (versions && loaded.offlineAt === null) {
        const marked = await settleRestores(historyRemote, cache, pageId, loaded.rows).catch(() => []);
        if (marked.length) {
          versions = [...versions.filter((v) => !marked.some((m) => m.id === v.id)), ...marked].sort(bySeq);
          void cache?.saveVersions(pageId, versions).catch(() => undefined);
        }
      }
      void cache?.touch(pageId).catch(() => undefined);
      let summary = await builder.load(loaded.rows, pageId);
      if (versions?.length) {
        const b = versionBreaks(versions);
        summary = await builder.breaks(b.after, b.before);
      }
      return { ...loaded, versions, summary };
    })().then(
        (got) => {
          if (cancelled) return;
          if (!got || got.offlineAt !== null) markOffline();
          if (!got) setLoading({ state: 'offline' });
          else setLoading({ state: 'ready', rows: got.rows, emails: got.emails, summary: got.summary, versions: got.versions, offlineAt: got.offlineAt });
        },
        (err: unknown) => {
          if (cancelled) return;
          if (err instanceof RemoteError && err.message === 'page_not_found') setLoading({ state: 'denied' });
          else if (err instanceof RemoteError && err.message === 'page_in_trash') setLoading({ state: 'trash' });
          else if (isNetworkError(err)) {
            markOffline();
            setLoading({ state: 'offline' });
          }
          else setLoading({ state: 'failed', reason: errorMessage(err) });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [historyRemote, engine, builder, pageId, attempt, dbName, servicesTree]);

  // Volver la red reintenta si estaba sin red o mostrando lo guardado (lo ya bajado no se vuelve a pedir); lo demás,
  // con "Reintentar".
  const waitingNetwork = loading.state === 'offline' || (loading.state === 'ready' && loading.offlineAt !== null);
  useEffect(() => {
    if (!waitingNetwork || !status.online) return;
    const was = offlineMark.current;
    if (was && was.online && was.sync === status.lastSyncAt) return;
    setAttempt((n) => n + 1);
  }, [waitingNetwork, status.online, status.lastSyncAt]);

  // Lo de este dispositivo que todavía no subió no está en el historial (y restaurar lo pide subido).
  useEffect(() => {
    let live = true;
    void docs.unsyncedPages().then((pages) => live && setUnsynced(pages.includes(pageId)));
    void engine.isMissingContent(pageId).then((m) => live && setMissing(m));
    return () => {
      live = false;
    };
  }, [docs, engine, pageId, status.lastSyncAt, status.pendingPages]);

  const ready = loading.state === 'ready' ? loading : null;
  const sessions = useMemo(() => ready?.summary.sessions ?? [], [ready]);
  const index = useMemo(() => {
    if (!sessions.length || !ready) return -1;
    if (chosen === null) return sessions.length - 1;
    // La elegida sigue elegida aunque lleguen filas nuevas: por su `seq` o, si la sesión creció, la que lo contiene.
    const exact = sessions.findIndex((s) => s.seq === chosen);
    if (exact >= 0) return exact;
    const within = sessions.findIndex((s) => ready.rows[s.first].seq <= chosen && chosen <= s.seq);
    return within >= 0 ? within : sessions.length - 1;
  }, [sessions, chosen, ready]);
  const session: HistorySession | null = index >= 0 ? sessions[index] : null;
  const isCurrent = index === sessions.length - 1;
  const chosenName = session && ready ? (sessionLabels(session, ready.rows, ready.versions).named?.label ?? null) : null;
  const versionKey = session ? String(session.seq) : '';
  const changesKey = session ? `${session.seq}:${index > 0 ? sessions[index - 1].seq : 0}` : '';

  // El documento de la versión elegida (lo arma el Worker): en memoria, nunca se guarda ni se sube.
  const [picked, setPicked] = useState<{ key: string; doc: Y.Doc | null; orphans: HistoryOrphan[]; error: string | null } | null>(null);
  useEffect(() => {
    if (!versionKey || !builder) return;
    let live = true;
    builder.version(Number(versionKey)).then(
      ({ update, orphans }) => {
        if (!live) return;
        const doc = new Y.Doc();
        Y.applyUpdate(doc, update);
        setPicked({ key: versionKey, doc, orphans, error: null });
      },
      (err: unknown) => live && setPicked({ key: versionKey, doc: null, orphans: [], error: errorMessage(err) }),
    );
    return () => {
      live = false;
    };
  }, [builder, versionKey]);
  const current = picked && picked.key === versionKey ? picked : null;
  const version = current?.doc ?? null;
  const orphans = current?.orphans ?? [];
  useEffect(() => () => picked?.doc?.destroy(), [picked]);

  // Los cambios contra la versión anterior de la lista: la unión de las dos (otro documento en memoria) y sus marcas.
  const [changes, setChanges] = useState<{ key: string; doc: Y.Doc | null; marks: HistoryMark[] } | null>(null);
  useEffect(() => {
    if (!changesKey || !showChanges || !builder) return;
    let live = true;
    builder.changes(Number(changesKey.split(':')[0])).then(
      ({ update, marks }) => {
        if (!live) return;
        const doc = new Y.Doc();
        Y.applyUpdate(doc, update);
        setChanges({ key: changesKey, doc, marks });
      },
      // Sin la diferencia se ve la versión limpia: lo que importa es la versión.
      () => live && setChanges({ key: changesKey, doc: null, marks: [] }),
    );
    return () => {
      live = false;
    };
  }, [builder, changesKey, showChanges]);
  useEffect(() => () => changes?.doc?.destroy(), [changes]);
  const changesHere = changes && changes.key === changesKey ? changes : null;
  // Una unión con algo que esta versión de la app no conoce (lo borrado puede traerlo) no se muestra: va la limpia.
  const union = useMemo(
    () => (showChanges && changesHere?.doc && !findUnknownContent(changesHere.doc) ? { doc: changesHere.doc, marks: changesHere.marks } : null),
    [showChanges, changesHere],
  );

  // Sin los cambios, una COPIA de la versión: el editor (y-prosemirror) puede tocar el documento que muestra, y la
  // versión tiene que quedar intacta para comprobarla y restaurarla.
  const clean = useMemo(() => {
    if (!version) return null;
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(version));
    return copy;
  }, [version]);
  useEffect(() => () => clean?.destroy(), [clean]);
  // Con los cambios prendidos se espera la unión (un momento) en vez de mostrar la versión limpia y saltar.
  const waitingUnion = showChanges && !!version && !changesHere;
  const shown = union ? union.doc : waitingUnion ? null : clean;
  const shownKey = union ? `c:${changesKey}` : `v:${versionKey}`;
  const unknown = useMemo(() => (version ? findUnknownContent(version) : null), [version]);
  const tooBig = useMemo(() => (version ? versionBytes(version) > MAX_RESTORE_BYTES : false), [version]);
  // La ida y vuelta (Doc_Historial.md, 6.1): con el esquema del editor que muestra la versión (está desde que se
  // crea, antes de montarse). `null` mientras no se sabe.
  const previewEditor = useRef<FindEditor | null>(null);
  const onPreviewEditor = useCallback((editor: FindEditor | null) => {
    previewEditor.current = editor;
    const ed = editor as unknown as { pmSchema?: Schema; prosemirrorView?: { state: { schema: Schema } } } | null;
    const schema = ed?.pmSchema ?? ed?.prosemirrorView?.state.schema;
    if (schema) setPmSchema(schema);
  }, []);
  const shapeOk = useMemo(() => (version && pmSchema ? versionNode(version, pmSchema).complete : null), [version, pmSchema]);

  // Las personas, con su nombre (el correo; "Vos") y su color (por orden de aparición en el historial de la página).
  const people = useMemo(() => ready?.summary.people ?? [], [ready]);
  const emails = ready?.emails;
  const nameOf = useCallback(
    (id: string | null) => {
      // Una fila que entró por un link público: el nombre del visitante, siempre con "(via link)" (E2.8).
      const viaLink = linkAuthorName(id);
      if (viaLink !== null) return tr('history.viaLink', { name: viaLink });
      return id === user.id ? tr('history.you') : id ? (emails?.get(id) ?? tr('history.formerMember')) : tr('history.formerMember');
    },
    [user.id, emails, tr],
  );
  const colorOf = useCallback(
    (id: string | null) => {
      const i = people.indexOf(id);
      return `var(--hist-${i < 0 ? 8 : (i % 8) + 1})`;
    },
    [people],
  );
  // Cómo se ve cada marca: el color de la persona, quién y cuándo, y el rótulo de un bloque que cambió.
  const rows = ready?.rows;
  const marksInput = useMemo<HistoryMarksInput | undefined>(() => {
    if (!union || !rows) return undefined;
    const look = (m: HistoryMark): MarkLook => {
      const row = rows[m.row];
      const who = row ? row.createdBy : null;
      const name = nameOf(who);
      const when = row ? whenLabel(row.createdAt, lang) : '';
      const color = colorOf(who);
      if (m.type === 'node' && m.kind === 'change' && m.label) {
        const label = labelText(m.label, tr);
        return { color, label, tip: tr('history.changedBy', { label, name, when }) };
      }
      return { color, tip: tr(m.kind === 'del' ? 'history.deletedBy' : 'history.addedBy', { name, when }) };
    };
    return { marks: union.marks, look };
  }, [union, rows, nameOf, colorOf, lang, tr]);

  const blocker: Blocker | null = (() => {
    // Mostrando lo guardado (sin respuesta del servidor): restaurar pide la página al día.
    if (!status.online || ready?.offlineAt != null) return 'history.why.offline';
    if (!perms.canEditPage(pageId)) return 'history.why.cantEdit';
    if (status.outdated) return 'history.why.outdated';
    if (unknown) return 'history.why.unknown';
    if (shapeOk === false) return 'history.why.shape';
    if (tooBig) return 'history.why.size';
    if (unsynced) return 'history.why.pending';
    if (missing) return 'history.why.missing';
    return null;
  })();
  const blockerText: Record<Blocker, string> = {
    'history.why.offline': tr('history.why.offline'),
    'history.why.pending': tr('history.why.pending'),
    'history.why.missing': tr('history.why.missing'),
    'history.why.shape': tr('history.why.shape'),
    'history.why.unknown': tr('history.why.unknown'),
    'history.why.size': tr('history.why.size'),
    'history.why.outdated': tr('history.why.outdated'),
    'history.why.cantEdit': tr('history.why.cantEdit'),
    'history.why.notOpen': tr('history.why.notOpen'),
  };

  // Mientras está abierto, el teclado no puede llegar a la página escondida (B3 de la auditoría): el foco pasa a la
  // pantalla del historial y lo demás de la app queda `inert`. Al cerrar, todo vuelve y el foco a donde estaba.
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const shell = screen.closest('.shell') ?? document.body;
    const hidden = [...shell.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.contains(screen) && !el.hasAttribute('inert'));
    for (const el of hidden) el.setAttribute('inert', '');
    screen.focus({ preventScroll: true });
    return () => {
      for (const el of hidden) el.removeAttribute('inert');
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // Escape cierra (primero la confirmación).
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const menuRef = useRef(menuFor);
  menuRef.current = menuFor;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.carrete')) return;
      e.preventDefault();
      if (confirmRef.current) setConfirm(null);
      else if (menuRef.current !== null) setMenuFor(null);
      else closeHistory();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Las filas nuevas con el historial abierto (O3 de la auditoría de la entrega 1): se piden después de cada
  // sincronización y se suman a la lista sin perder la versión elegida ni el lugar de la lista.
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const refreshing = useRef<Promise<HistoryRow[] | null> | null>(null);
  /**
   * Pide las filas posteriores a la última conocida y, si hay, arma la lista de nuevo. Devuelve todas las filas. Si ya
   * hay una consulta en curso, la devuelve; con `fresh`, la espera y pide otra: al confirmar una restauración hace falta
   * una consulta empezada DESPUÉS de sincronizar (O9 de la auditoría de la entrega 2: la que estaba en curso pudo
   * empezar antes y no ver una fila de otra persona recién llegada).
   */
  const refreshRows = useCallback((fresh = false): Promise<HistoryRow[] | null> => {
    const inFlight = refreshing.current;
    if (inFlight && !fresh) return inFlight;
    // Una que empiece después de esta llamada sirve (también la de otro que esperó a la misma).
    if (inFlight) return inFlight.catch(() => null).then(() => refreshRowsRef.current());
    const run = (async () => {
      const known = readyRef.current;
      if (!known || !builder) return null;
      const fresh: HistoryRow[] = [];
      for (;;) {
        const after = fresh.length ? fresh[fresh.length - 1].seq : (known.rows[known.rows.length - 1]?.seq ?? 0);
        const batch = await historyRemote.pageHistory(pageId, after, 500);
        fresh.push(...batch);
        if (batch.length < 500) break;
      }
      const all = mergeRows(known.rows, fresh);
      if (all.length === known.rows.length) return known.rows;
      const summary = await builder.append(all.slice(known.rows.length));
      // Los correos, si llegó alguien nuevo.
      const stranger = fresh.some((r) => r.createdBy && linkAuthorName(r.createdBy) === null && !known.emails.has(r.createdBy));
      const mails = stranger
        ? await historyRemote.pageHistoryAuthors(pageId).then(
            (list) => new Map(list.map((a) => [a.user_id, a.email])),
            () => known.emails,
          )
        : known.emails;
      setLoading((cur) => (cur.state === 'ready' ? { ...cur, rows: all, emails: mails, summary } : cur));
      // La próxima consulta (la de `fresh`, que puede correr antes de que se vuelva a dibujar) arranca desde acá.
      readyRef.current = { ...known, rows: all, emails: mails, summary };
      const cache = cacheRef.current;
      if (cache) {
        void cache
          .save(pageId, { rows: all, emails: mails, versions: readyRef.current?.versions ?? null, generation: generationRef.current })
          .catch(() => undefined);
      }
      return all;
    })().finally(() => {
      refreshing.current = null;
    });
    refreshing.current = run;
    return run;
  }, [historyRemote, pageId, builder]);
  const refreshRowsRef = useRef(refreshRows);
  refreshRowsRef.current = refreshRows;
  const isReady = !!ready;
  const showingSaved = loading.state === 'ready' && loading.offlineAt !== null;
  useEffect(() => {
    if (!isReady || !status.online || busy || showingSaved) return;
    // Un error acá no importa: la lista sigue como estaba y se vuelve a probar con la próxima sincronización.
    refreshRows().catch(() => undefined);
  }, [isReady, status.lastSyncAt, status.online, busy, showingSaved, refreshRows]);

  // --- Versiones con nombre --------------------------------------------------------------------------------------

  const versions = ready?.versions ?? null;
  /** Se ofrece nombrar solo con la base migrada (la lista de nombres llegó). */
  const namesSupported = versions !== null;
  /** Nombrar, renombrar y sacar piden red (y no estar mostrando lo guardado). */
  const namesOnline = status.online && !showingSaved;
  /** Puede cambiar o sacar ese nombre: quien lo puso o nivel 4 sobre la página (la base lo vuelve a mirar). */
  const canManageName = (v: PageVersionRow) => v.createdBy === user.id || perms.pageLevel(pageId) >= 4;

  /** Cambia los nombres: los cortes de las sesiones, la lista y lo guardado. */
  const applyVersions = useCallback(
    async (next: PageVersionRow[] | null) => {
      if (!builder) return;
      const sorted = next ? [...next].sort(bySeq) : null;
      const b = versionBreaks(sorted ?? []);
      const summary = await builder.breaks(b.after, b.before);
      setLoading((cur) => (cur.state === 'ready' ? { ...cur, summary, versions: sorted } : cur));
      void cacheRef.current?.saveVersions(pageId, sorted).catch(() => undefined);
    },
    [builder, pageId],
  );

  /** El motivo de un error al nombrar, para la línea de aviso. */
  const nameError = (err: unknown): string => {
    if (isNetworkError(err)) return tr('history.nameOffline');
    if (err instanceof RemoteError && err.message === 'app_outdated') return tr('history.why.outdated');
    if (err instanceof RemoteError && err.message === 'not_allowed') return tr('history.nameNotAllowed');
    return tr('history.nameFailed', { reason: errorMessage(err) });
  };

  async function saveName(edit: NameEdit) {
    const label = edit.value.replace(/\s+/g, ' ').trim().slice(0, 100);
    const before = versions?.find((v) => v.id === edit.versionId) ?? null;
    if (!label || label === before?.label) {
      setEditing(null);
      return;
    }
    setNaming(true);
    setMessage(null);
    try {
      const row = edit.versionId
        ? await historyRemote.renamePageVersion(edit.versionId, label)
        : await historyRemote.namePageVersion(edit.newId, pageId, edit.seq, label);
      await applyVersions([...(readyRef.current?.versions ?? []).filter((v) => v.id !== row.id), row]);
      setEditing(null);
    } catch (err) {
      if (err instanceof RemoteError && (err.message === 'version_named' || err.message === 'version_not_found')) {
        // Otro dispositivo la nombró (o le sacó el nombre) mientras tanto: la lista como está en el servidor.
        const fresh = await fetchVersions(historyRemote, pageId, true).catch(() => null);
        if (fresh) await applyVersions(fresh);
        setEditing(null);
        setMessage(tr('history.nameChanged'));
      } else {
        setMessage(nameError(err));
      }
    } finally {
      setNaming(false);
    }
  }

  async function removeName(v: PageVersionRow) {
    setMenuFor(null);
    setNaming(true);
    setMessage(null);
    try {
      await historyRemote.removePageVersion(v.id);
      await applyVersions((readyRef.current?.versions ?? []).filter((x) => x.id !== v.id));
    } catch (err) {
      setMessage(nameError(err));
    } finally {
      setNaming(false);
    }
  }

  // El menú de una versión se cierra al tocar afuera.
  useEffect(() => {
    if (menuFor === null) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest?.('.history-menu, .history-more')) setMenuFor(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menuFor]);

  /** La fecha de una versión por el `seq` de su última fila (para "Restored from…"). */
  const rowTimes = useMemo(() => new Map((rows ?? []).map((r) => [r.seq, r.createdAt])), [rows]);

  // La lista no salta cuando llegan versiones nuevas arriba: si la persona bajó, sigue viendo lo mismo.
  const listRef = useRef<HTMLElement>(null);
  const listHeight = useRef(0);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const grew = list.scrollHeight - listHeight.current;
    if (listHeight.current > 0 && grew !== 0 && list.scrollTop > 0) list.scrollTop += grew;
    listHeight.current = list.scrollHeight;
  }, [sessions]);

  /** Antes de confirmar: cuántas fotos de la versión ya no están en Drive y si otra persona estuvo editando. */
  async function askRestore() {
    if (!ready || !version) return;
    setMessage(null);
    let photos = 0;
    const ids = [...mediaIdsInDoc(version)];
    if (ids.length) {
      try {
        photos = (await historyRemote.fetchMediaFiles(ids)).filter((row) => isDeletedRow(row)).length;
      } catch {
        photos = 0;
      }
    }
    const other = recentOther(ready.rows, user.id);
    confirmSeq.current = ready.rows.length ? ready.rows[ready.rows.length - 1].seq : 0;
    setConfirm({ photos, others: other === undefined ? null : nameOf(other) });
  }

  /** Restaurar (Doc_Historial.md, sección 6.1): sincronizar, comprobar de nuevo y pedírselo al editor de la página. */
  async function restore() {
    if (!version || !session) return;
    // La cuenta de fotos de la confirmación sirve también si hay que volver a preguntar (O1).
    const photos = confirm?.photos ?? 0;
    setConfirm(null);
    setBusy(true);
    setMessage(tr('history.syncing'));
    try {
      await engine.syncNow();
      // Lo que llegó al servidor desde que se mostró la confirmación (O1 de la auditoría; la lista se pudo actualizar
      // sola mientras tanto, O3): si otra persona cambió la página, se vuelve a preguntar con el aviso de quién.
      let afterSeq = ready?.rows[ready.rows.length - 1]?.seq ?? 0;
      if (ready) {
        const all = (await refreshRows(true)) ?? ready.rows;
        afterSeq = all[all.length - 1]?.seq ?? 0;
        const since = all.filter((row) => row.seq > confirmSeq.current);
        const others = since.filter((row) => row.createdBy !== user.id);
        if (others.length > 0) {
          confirmSeq.current = since[since.length - 1].seq;
          setMessage(null);
          setConfirm({ photos, others: nameOf(others[others.length - 1].createdBy) });
          return;
        }
      }
      const [pages, stillMissing] = await Promise.all([docs.unsyncedPages(), engine.isMissingContent(pageId)]);
      const why: Blocker | null = !engine.getStatus().online
        ? 'history.why.offline'
        : pages.includes(pageId)
          ? 'history.why.pending'
          : stillMissing
            ? 'history.why.missing'
            : // Los permisos recién bajados (pueden haber cambiado con el historial abierto).
              !new Permissions(tree, services.access.get(), user.id).canEditPage(pageId)
              ? 'history.why.cantEdit'
              : engine.getStatus().outdated
                ? 'history.why.outdated'
                : null;
      if (why) {
        setMessage(tr('history.restoreFailed', { reason: blockerText[why] }));
        return;
      }
      // El esquema del editor que muestra la versión: con él restaura la barrera de la página si el editor tiró un error
      // (si la barrera todavía se está preparando, se la espera).
      await restoreTargetSettled(pageId);
      const outcome = requestRestore(pageId, version, pmSchema);
      if (!outcome.ok) {
        // `failed`: el editor lo intentó y lo deshizo (la comprobación final no dio): la página quedó como estaba.
        if (outcome.reason === 'failed') setMessage(tr('history.restoreUnchanged'));
        else setMessage(tr('history.restoreFailed', { reason: blockerText[outcome.reason === 'shape' ? 'history.why.shape' : 'history.why.notOpen'] }));
        return;
      }
      const key = `history:${pageId}:${session.seq}:${Date.now()}`;
      const date = whenLabel(session.end, lang);
      // "Restored from…" en la lista: la marca se guarda cuando la restauración llega al servidor (historyLoad.ts).
      // Sin huella (no cambió nada) no hay marca.
      const trace = outcome.trace;
      const mark =
        namesSupported && trace && (trace.ins.length > 0 || trace.del.length > 0)
          ? markRestoreLater(
              { remote: historyRemote, cache: cacheRef.current, engine, docs },
              { id: crypto.randomUUID(), pageId, userId: user.id, fromSeq: session.seq, afterSeq, at: Date.now(), trace },
            )
          : null;
      closeHistory();
      // Restaurada desde la barrera de la página (sin editor): el aviso va sin **Undo** (ErrorBarrier.tsx).
      if (outcome.undoable === false) {
        notify(t('history.restored', { date }));
        return;
      }
      notify(t('history.restored', { date }), {
        key,
        label: t('history.undo'),
        run: () => {
          if (outcome.undo()) {
            notify(t('history.undone'));
            // Deshecha antes de marcarla: no se marca (la fila que suba puede traer la restauración y el deshacer).
            void mark?.cancel();
          }
        },
      });
      // El **Undo** del aviso deshace solo la restauración: con la próxima edición, el aviso se va.
      const off = outcome.onEdit(() => {
        dismissNotice(key);
        off();
      });
      // Deshecha con Ctrl/⌘+Z (no con el aviso), lo mismo: la marca se deja de lado. Se mira hasta que queda marcada
      // (o se deja de lado); después, deshacer ya no cambia el rótulo.
      if (mark && outcome.onUndone) {
        const stop = outcome.onUndone(() => {
          dismissNotice(key);
          void mark.cancel();
        });
        void mark.done.then(stop);
      }
    } catch (err) {
      setMessage(tr('history.restoreFailed', { reason: errorMessage(err) }));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Copiar (o cortar, o arrastrar) con Show changes prendido: lo elegido sin lo marcado como borrado (historyMarks.ts,
   * `cleanClipboard`), como lo copia BlockNote. Se atiende antes que el editor (que en solo lectura deja copiar al
   * navegador, con lo tachado y sus estilos).
   */
  const onClipboard = (e: ReactClipboardEvent<HTMLElement> | ReactDragEvent<HTMLElement>) => {
    const ed = previewEditor.current as unknown as (BlockNoteEditor<any, any, any> & { prosemirrorView?: EditorView }) | null;
    const view = ed?.prosemirrorView;
    const data = 'clipboardData' in e ? e.clipboardData : e.dataTransfer;
    if (!union || !marksInput || !ed || !view || !data) return;
    const out = cleanClipboard(ed, view, marksInput);
    if (!out) return;
    e.preventDefault();
    e.stopPropagation();
    data.clearData();
    data.setData('blocknote/html', out.clipboardHTML);
    data.setData('text/html', out.externalHTML);
    data.setData('text/plain', out.markdown);
  };

  // En el teléfono no hay tooltip: tocar una marca muestra quién y cuándo en un aviso.
  const lastPointer = useRef('mouse');
  const onMarkTap = (e: ReactMouseEvent<HTMLElement>) => {
    if (lastPointer.current === 'mouse' || !union) return;
    const mark = (e.target as HTMLElement | null)?.closest?.('.hist-add, .hist-del, .hist-node, .hist-label');
    const tip = mark?.getAttribute('data-tip');
    if (tip) notify(tip);
  };

  /** Copiar el texto huérfano (si el navegador no deja, queda a la vista para copiarlo a mano). */
  const copyOrphan = (text: string) => {
    if (!navigator.clipboard) {
      notify(tr('history.copyFailed'));
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () => notify(tr('common.copied')),
      () => notify(tr('history.copyFailed')),
    );
  };

  const format = pageFormat(tree, pageId);
  const sheet = sheetSize(format);
  const restoreButton = session && !isCurrent && (
    <button
      className="primary history-restore"
      disabled={!!blocker || busy || shapeOk === null}
      data-tip={blocker ? blockerText[blocker] : undefined}
      onClick={() => void askRestore()}
    >
      <span className="history-wide">{tr('history.restore')}</span>
      <span className="history-narrow">{tr('history.restoreShort')}</span>
    </button>
  );

  return (
    <div ref={screenRef} tabIndex={-1} className={`history-screen pane-${pane}`} role="dialog" aria-modal="true" aria-label={tr('history.title')}>
      <header className="history-bar">
        <button
          className="link history-back"
          onClick={() => {
            if (pane === 'version' && window.matchMedia?.('(max-width: 760px)').matches) setPane('list');
            else closeHistory();
          }}
        >
          ← <span className="history-back-page">{tr('history.back')}</span>
          <span className="history-back-list">{tr('history.versions')}</span>
        </button>
        <h1 className="history-title">
          <span className="history-heading">{tr('history.title')}</span>
          {session && chosenName && <span className="history-version-name">{chosenName}</span>}
          {session && <span className="history-when">{whenLabel(session.end, lang)}</span>}
        </h1>
        {session && (
          <label className="history-changes" data-tip={tr('history.showChangesTip')}>
            <input type="checkbox" checked={showChanges} onChange={(e) => setShowChanges(e.target.checked)} />
            <span className="history-wide">{tr('history.showChanges')}</span>
            <span className="history-narrow">{tr('history.showChangesShort')}</span>
          </label>
        )}
        {restoreButton}
      </header>
      {/* En el teléfono no hay tooltip: el motivo de que no se pueda restaurar, en una línea (O4 de la auditoría). */}
      {session && !isCurrent && blocker && !message && <p className="history-why">{blockerText[blocker]}</p>}
      {message && (
        <p className="history-message" role="status">
          {message}
        </p>
      )}
      <div className="history-body">
        <section className="history-preview" aria-label={session ? whenLabel(session.end, lang) : tr('history.title')}>
          {loading.state === 'loading' && (
            <p className="muted history-state">
              {loading.count ? tr('history.loadingCount', { count: loading.count }) : tr('history.loading')}
            </p>
          )}
          {loading.state === 'offline' && <p className="muted history-state">{tr('history.offline')}</p>}
          {loading.state === 'denied' && <p className="muted history-state">{tr('history.denied')}</p>}
          {loading.state === 'trash' && <p className="muted history-state">{tr('history.inTrash')}</p>}
          {loading.state === 'failed' && (
            <p className="history-state">
              {tr('history.failed', { reason: loading.reason })}{' '}
              <button className="link" onClick={() => setAttempt((n) => n + 1)}>
                {tr('common.tryAgain')}
              </button>
            </p>
          )}
          {ready && sessions.length === 0 && <p className="muted history-state">{tr('history.empty')}</p>}
          {ready && ready.summary.unreadable > 0 && <p className="banner">{tr('history.unreadable', { count: ready.summary.unreadable })}</p>}
          {ready?.offlineAt != null && (
            <p className="banner history-offline-saved">{tr('history.offlineSaved', { when: whenInline(new Date(ready.offlineAt).toISOString(), lang) })}</p>
          )}
          {unsynced && <p className="banner">{tr('history.unsynced')}</p>}
          {(unknown || shapeOk === false) && <p className="banner">{tr('history.partial')}</p>}
          {current?.error && <p className="banner">{tr('history.versionFailed', { reason: current.error })}</p>}
          {/* Mientras se arma la versión, o su unión con los cambios. */}
          {session && (!current || waitingUnion) && <p className="muted history-version-loading">{tr('history.loadingVersion')}</p>}
          {/* El texto huérfano (Doc_Historial.md, 5.4): lo que alguien escribió en algo ya borrado, en la versión de su
              fila. No está en la página ni en ninguna versión: solo acá. */}
          {orphans.map((o, i) => {
            const who = ready?.rows[o.row]?.createdBy ?? null;
            return (
              <div key={`${o.row}:${i}`} className="history-orphan" style={{ '--hc': colorOf(who) } as CSSProperties}>
                <p className="history-orphan-who">{tr('history.orphan', { name: nameOf(who) })}</p>
                <blockquote className="history-orphan-text">{o.text.trim()}</blockquote>
                <button className="link" onClick={() => copyOrphan(o.text.trim())}>
                  {tr('history.copy')}
                </button>
              </div>
            );
          })}
          {shown && !unknown && (
            <article
              className={`page history-page${sheet ? ' sheet' : ''}${union ? ' history-changes-on' : ''}`}
              style={
                sheet
                  ? ({
                      '--sheet-width': `${sheet.width}px`,
                      '--sheet-height': `${sheet.height}px`,
                      '--gutter': `${mm(SHEET_MARGIN_MM)}px`,
                    } as CSSProperties)
                  : undefined
              }
              data-format={format.size}
              data-page-id={pageId}
              onCopyCapture={onClipboard}
              onCutCapture={onClipboard}
              onDragStartCapture={onClipboard}
              onPointerDown={(e) => (lastPointer.current = e.pointerType || 'mouse')}
              onClick={onMarkTap}
            >
              <ServicesContext.Provider value={previewServices}>
                {/* Una versión que el editor no puede mostrar (tira un error) no se lleva el historial: elegir otra la
                    vuelve a intentar (ErrorBarrier.tsx). */}
                <ErrorBarrier
                  resetKey={`${shownKey}:${tr.lang}`}
                  what={`Una versión del historial de la página ${pageId} no se pudo mostrar`}
                  fallback={() => <p className="banner history-version-crash" role="alert">{tr('history.versionCrash')}</p>}
                >
                  <BlockEditor
                    key={`${shownKey}:${tr.lang}`}
                    doc={shown}
                    collapse={new Map()}
                    pageId={pageId}
                    editable={false}
                    permsKnown
                    canComment={false}
                    onEditor={onPreviewEditor}
                    preview
                    marks={marksInput}
                  />
                </ErrorBarrier>
              </ServicesContext.Provider>
            </article>
          )}
        </section>
        <aside className="history-list" aria-label={tr('history.versions')} ref={listRef}>
          {/* En el teléfono la lista va sola (sin la versión): el aviso de lo guardado va también acá. */}
          {ready?.offlineAt != null && (
            <p className="banner history-offline-list">{tr('history.offlineSaved', { when: whenInline(new Date(ready.offlineAt).toISOString(), lang) })}</p>
          )}
          {namesSupported && sessions.length > 0 && (
            <label className="history-filter">
              <input type="checkbox" checked={onlyNamed} onChange={(e) => setOnlyNamed(e.target.checked)} />
              {tr('history.onlyNamed')}
            </label>
          )}
          {namesSupported && onlyNamed && !versions?.some((v) => v.kind === 'named') && sessions.length > 0 && (
            <p className="muted history-no-named">{tr('history.noNamed')}</p>
          )}
          <SessionList
            sessions={sessions}
            index={index}
            lang={lang}
            nameOf={nameOf}
            colorOf={colorOf}
            labelsOf={(s) => {
              const { named, restores } = sessionLabels(s, ready?.rows ?? [], versions);
              return {
                name: named?.label ?? null,
                restored: restores.map((r) => {
                  const at = r.restoredFromSeq === null ? undefined : rowTimes.get(r.restoredFromSeq);
                  return at ? tr('history.restoredFrom', { date: whenInline(at, lang) }) : tr('history.restoredPlain');
                }),
              };
            }}
            onlyNamed={namesSupported && onlyNamed}
            onPick={(i) => {
              setChosen(sessions[i].seq);
              setMessage(null);
              setPane('version');
            }}
            actions={
              namesSupported
                ? (s) => {
                    const { named } = sessionLabels(s, ready?.rows ?? [], versions);
                    // Un nombre ajeno sin nivel 4: nada que hacer.
                    if (named && !canManageName(named)) return null;
                    const open = menuFor === s.seq;
                    const edit = editing && editing.seq === s.seq ? editing : null;
                    return (
                      <>
                        {!edit && (
                          <button
                            className="icon-button history-more"
                            aria-label={tr('history.versionActions')}
                            aria-haspopup="menu"
                            aria-expanded={open}
                            disabled={!namesOnline || naming}
                            data-tip={!namesOnline ? tr('history.nameOffline') : undefined}
                            onClick={() => setMenuFor(open ? null : s.seq)}
                          >
                            <MoreIcon size={16} />
                          </button>
                        )}
                        {open && (
                          <div className="history-menu" role="menu">
                            {!named ? (
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setMenuFor(null);
                                  setEditing({ seq: s.seq, versionId: null, newId: crypto.randomUUID(), value: '' });
                                }}
                              >
                                {tr('history.nameVersion')}
                              </button>
                            ) : (
                              <>
                                <button
                                  role="menuitem"
                                  onClick={() => {
                                    setMenuFor(null);
                                    setEditing({ seq: s.seq, versionId: named.id, newId: crypto.randomUUID(), value: named.label ?? '' });
                                  }}
                                >
                                  {tr('history.renameVersion')}
                                </button>
                                <button role="menuitem" onClick={() => void removeName(named)}>
                                  {tr('history.removeName')}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {edit && (
                          <NameField
                            edit={edit}
                            busy={naming}
                            onChange={(value) => setEditing({ ...edit, value })}
                            onSave={() => void saveName(edit)}
                            onCancel={() => setEditing(null)}
                          />
                        )}
                      </>
                    );
                  }
                : undefined
            }
          />
        </aside>
      </div>
      {confirm && (
        <div className="modal-backdrop history-confirm-backdrop" onClick={() => setConfirm(null)}>
          <div className="modal history-confirm" role="alertdialog" aria-modal="true" aria-label={tr('history.confirmTitle')} onClick={(e) => e.stopPropagation()}>
            <h2>{tr('history.confirmTitle')}</h2>
            <p>{tr('history.confirmText')}</p>
            {confirm.photos > 0 && <p>{tr('history.confirmPhotos', { count: confirm.photos })}</p>}
            {confirm.others && <p>{tr('history.othersEditing', { name: confirm.others })}</p>}
            <div className="modal-actions">
              <button className="secondary" onClick={() => setConfirm(null)}>
                {tr('common.cancel')}
              </button>
              <button className="primary" autoFocus onClick={() => void restore()}>
                {tr('history.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** El campo para nombrar o renombrar una versión: Enter guarda, Escape deja como estaba, salir del campo guarda. */
function NameField({
  edit,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  edit: NameEdit;
  busy: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const cancelled = useRef(false);
  return (
    <input
      className="history-name-input"
      autoFocus
      maxLength={100}
      value={edit.value}
      disabled={busy}
      placeholder={tr('history.namePlaceholder')}
      aria-label={edit.versionId ? tr('history.renameVersion') : tr('history.nameVersion')}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSave();
        } else if (e.key === 'Escape') {
          // Que el historial no se cierre: solo se deja de nombrar.
          e.preventDefault();
          e.stopPropagation();
          cancelled.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!cancelled.current && !busy) onSave();
      }}
    />
  );
}

/** La lista de versiones: por día y, adentro, una por sesión de edición (la más nueva arriba). */
function SessionList({
  sessions,
  index,
  lang,
  nameOf,
  colorOf,
  labelsOf,
  onlyNamed,
  onPick,
  actions,
}: {
  sessions: HistorySession[];
  index: number;
  lang: string;
  nameOf: (id: string | null) => string;
  colorOf: (id: string | null) => string;
  /** El nombre de la versión y sus "Restored from…". */
  labelsOf: (s: HistorySession) => { name: string | null; restored: string[] };
  /** Solo las que tienen nombre (y la actual). */
  onlyNamed: boolean;
  onPick: (index: number) => void;
  /** El botón de acciones de cada versión (nombrar…), si se ofrece. */
  actions?: (s: HistorySession) => ReactNode;
}) {
  const tr = useT();
  const order = sessions
    .map((s, i) => ({ s, i, labels: labelsOf(s) }))
    .filter(({ i, labels }) => !onlyNamed || labels.name !== null || i === sessions.length - 1)
    .reverse();
  let lastDay = '';
  return (
    <ol className="history-sessions">
      {order.map(({ s, i, labels }) => {
        const day = dayLabel(s.end, lang);
        const header = day !== lastDay;
        lastDay = day;
        return (
          // La clave es la primera fila de la sesión: una sesión que crece con filas nuevas sigue siendo el mismo
          // renglón (no se vuelve a crear).
          <li key={s.first} className="history-session-row">
            {header && <h2 className="history-day">{day}</h2>}
            <button className="history-session" aria-current={i === index ? 'true' : undefined} onClick={() => onPick(i)}>
              {labels.name && <span className="history-name">{labels.name}</span>}
              <span className="history-time" data-tip={tr('history.serverTimeTip')}>
                {timeLabel(s.end, lang)}
              </span>
              {i === sessions.length - 1 && <span className="history-current">{tr('history.current')}</span>}
              {labels.restored.map((text, k) => (
                <span key={k} className="history-restored">
                  {text}
                </span>
              ))}
              <span className="history-people">
                {s.authors.map((a) => (
                  <span key={a ?? 'former'} className="history-person">
                    <span className="history-dot" style={{ background: colorOf(a) }} aria-hidden="true" />
                    {nameOf(a)}
                  </span>
                ))}
              </span>
            </button>
            {actions?.(s)}
          </li>
        );
      })}
    </ol>
  );
}
