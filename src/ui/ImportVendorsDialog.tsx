import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { useT, type Key } from '../i18n';
import '../i18n/lazy/teamDialogs';
import '../i18n/lazy/importVendors';
import { ColorPicker } from './ColorPicker';
import { CheckIcon, CloseIcon, InfoIcon, WarningIcon } from './icons';
import { loadRecentColors, PROJECT_PRESETS, rememberRecentColor } from './projectColor';
import {
  analyze,
  columnLetters,
  defaultMappings,
  detectLayout,
  diff,
  pickSheet,
  proposeCode,
  readSpreadsheet,
  resolveShot,
  sameVendor,
  sceneIndex,
  SheetError,
  shotRows,
  shotShare,
  sourcesOf,
  targetOf,
  type Layout,
  type Mapping,
  type Sheet,
} from './vendorImport';

// *Import from spreadsheet…* (Docs/Doc_Compartir_Escenas.md, sección 13, D855): desde la ventana de vendors, un
// breakdown en Excel o CSV asigna escenas a vendors. Tres pasos: el archivo (la hoja y las columnas, que se encuentran
// solas, con una muestra), los vendors (cada nombre de la planilla se une a uno del proyecto, se crea o se omite) y
// revisar (lo que se suma, lo que cambia de vendor con confirmación, lo que se resolvió por la letra del clip, lo que no
// tiene página). Aplicar no guarda nada: lo deja marcado en la ventana de vendors, que lo guarda con *Save*. La planilla
// se lee en el dispositivo (`vendorImport.ts`).

/** Una escena del proyecto, como la muestra la importación. */
export interface ImportScene {
  pageId: string;
  code: string;
  /** El número como se ve (`1016A`). */
  label: string;
  /** El nombre sin el número. */
  name: string;
}

/** Un vendor del proyecto (el borrador de la ventana de vendors). */
export interface ImportVendor {
  key: string;
  name: string;
  code: string;
  color: string;
  scenes: string[];
}

/** Lo que se aplica en la ventana de vendors. */
export interface ImportResult {
  create: { name: string; code: string; color: string; scenes: string[] }[];
  add: Map<string, string[]>;
  remove: Map<string, string[]>;
  summary: { adds: number; replaced: number; created: number };
}

/** Lo más que un *Save* cambia de escenas (`save_scene_vendors`, `too_many_pages`). */
const MAX_SCENE_CHANGES = 1000;

type Step = 1 | 2 | 3;
type ReviewView = 'all' | 'change' | 'letter' | 'noPage';

const READ_ERRORS: Record<string, Key> = {
  format: 'scenes.import.errFormat',
  too_big: 'scenes.import.errTooBig',
  empty: 'scenes.import.errEmpty',
};

const vendorLabel = (v: { code: string; name: string }) => {
  if (v.code) return v.code;
  const words = v.name.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words.length > 1 ? words.map((w) => w[0]).join('') : words[0]).slice(0, 3);
};

export function ImportVendorsDialog({
  projectName,
  scenes,
  vendors,
  canAssign,
  onApply,
  onClose,
}: {
  projectName: string;
  scenes: ImportScene[];
  vendors: ImportVendor[];
  /** Si una escena se le puede dar a un vendor del proyecto (`null`: uno nuevo). */
  canAssign: (pageId: string, vendorKey: string | null) => boolean;
  onApply: (result: ImportResult) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [layout, setLayout] = useState<Layout>({ header: 0, shot: -1, vendor: -1, letter: -1 });
  const [maps, setMaps] = useState<Record<string, Mapping>>({});
  const [suggested, setSuggested] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<ReadonlySet<string>>(new Set());
  const [view, setView] = useState<ReviewView>('all');
  const [picking, setPicking] = useState<null | { key: string; before: string }>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || picking) return;
      e.stopPropagation();
      onClose();
    };
    // En captura: el Escape cierra esta ventana y no la de vendors de abajo.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, picking]);

  const sheet = sheets?.[sheetIdx] ?? null;
  const rows = useMemo(() => (sheet && layout.shot >= 0 ? shotRows(sheet.rows, layout) : []), [sheet, layout]);
  const sources = useMemo(() => (layout.vendor >= 0 ? sourcesOf(rows) : []), [rows, layout.vendor]);
  const index = useMemo(() => sceneIndex(scenes), [scenes]);
  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.pageId, s])), [scenes]);
  const vendorByKey = useMemo(() => new Map(vendors.map((v) => [v.key, v])), [vendors]);
  const headerCells = sheet?.rows[layout.header] ?? [];
  const width = Math.max(headerCells.length, ...(sheet?.rows.slice(layout.header, layout.header + 50).map((r) => r.length) ?? [0]));
  const shotOk = rows.length > 0 && shotShare(rows) >= 0.5;
  const vendorOk = sources.length > 0;
  const ready = !!sheet && shotOk && vendorOk;

  async function choose(f: File) {
    const id = ++reqId.current;
    setFile({ name: f.name, size: f.size });
    setSheets(null);
    setError(null);
    setReading(true);
    try {
      const got = await readSpreadsheet(f, f.name);
      if (id !== reqId.current) return;
      const i = pickSheet(got);
      setSheets(got);
      pickSheetAt(got, i);
    } catch (err) {
      if (id !== reqId.current) return;
      const key = err instanceof SheetError ? READ_ERRORS[err.message] : undefined;
      setError(tr(key ?? 'scenes.import.errFormat'));
    } finally {
      if (id === reqId.current) setReading(false);
    }
  }
  function pickSheetAt(list: Sheet[], i: number) {
    setSheetIdx(i);
    const found = detectLayout(list[i]?.rows ?? []);
    const first = Math.max(0, (list[i]?.rows ?? []).findIndex((r) => r.some(Boolean)));
    setLayout(found ?? { header: first, shot: -1, vendor: -1, letter: -1 });
  }

  /** Al pasar a los vendors: lo propuesto para cada nombre (uno del proyecto, unido a otro, o nuevo). */
  function toVendors() {
    const next = defaultMappings(
      sources,
      vendors.map((v) => ({ key: v.key, name: v.name, code: v.code })),
      { presets: PROJECT_PRESETS, used: vendors.map((v) => v.color) },
    );
    // Lo que ya se había elegido para un nombre que sigue estando, se respeta.
    for (const s of sources) if (maps[s.key]) next[s.key] = maps[s.key];
    setMaps(next);
    // Sugerido: una unión con otro nombre, o un vendor del proyecto que se escribe parecido pero no igual. Lo que ya
    // estaba marcado sigue marcado al volver a este paso, mientras nadie lo cambie.
    const guessed = (src: (typeof sources)[number]) => {
      const m = next[src.key];
      if (m?.mode === 'merge') return true;
      if (m?.mode !== 'existing') return false;
      const v = vendorByKey.get(m.vendor);
      return !!v && !sameVendor(v, src.name);
    };
    setSuggested(new Set(sources.filter((src) => (maps[src.key] ? suggested.has(src.key) : guessed(src))).map((src) => src.key)));
    setStep(2);
  }

  const newOnes = sources.filter((s) => maps[s.key]?.mode === 'new');
  const unnamed = newOnes.some((s) => {
    const m = maps[s.key];
    return m.mode === 'new' && !m.name.trim();
  });

  // El análisis y lo que cambia contra lo asignado.
  const canAssignTarget = (pageId: string, t: string) => {
    if (t.startsWith('v:')) {
      const key = t.slice(2);
      if (vendorByKey.get(key)?.scenes.includes(pageId)) return true;
      return canAssign(pageId, key);
    }
    return canAssign(pageId, null);
  };
  const analysis = useMemo(() => (step === 3 ? analyze(rows, scenes, maps, canAssignTarget) : null), [step, rows, scenes, maps]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const v of vendors) for (const id of v.scenes) out.set(id, (out.get(id) ?? new Set<string>()).add(`v:${v.key}`));
    return out;
  }, [vendors]);
  const changes = useMemo(() => (analysis ? diff(analysis.assign, current) : null), [analysis, current]);
  const replaced = changes ? changes.changes.filter((c) => confirm.has(c.pageId)) : [];
  const sceneChanges = changes ? changes.adds.length + replaced.reduce((n, c) => n + c.gone.length, 0) : 0;

  /** El vendor de un destino (`v:<vendor>` o `n:<nombre>`), para los chips. */
  const targetVendor = (t: string): { name: string; code: string; color: string } | null => {
    if (t.startsWith('v:')) return vendorByKey.get(t.slice(2)) ?? null;
    const m = maps[t.slice(2)];
    return m?.mode === 'new' ? { name: m.name || tr('scenes.share.unnamed'), code: m.code, color: m.color } : null;
  };
  const chip = (t: string, cls = '') => {
    const v = targetVendor(t);
    if (!v) return null;
    return (
      <span key={t + cls} className={`share-vchip ${cls}`} style={{ '--vc': v.color } as CSSProperties} data-tip={v.name}>
        <i />
        {vendorLabel(v)}
      </span>
    );
  };
  const sceneLabel = (pageId: string) => sceneById.get(pageId)?.label ?? '?';

  function apply() {
    if (!analysis || !changes) return;
    const create: ImportResult['create'] = [];
    const add = new Map<string, string[]>();
    const remove = new Map<string, string[]>();
    const newScenes = new Map<string, string[]>();
    for (const [pageId, t] of changes.adds) {
      if (t.startsWith('v:')) add.set(t.slice(2), [...(add.get(t.slice(2)) ?? []), pageId]);
      else newScenes.set(t, [...(newScenes.get(t) ?? []), pageId]);
    }
    for (const s of newOnes) {
      const m = maps[s.key];
      if (m.mode !== 'new') continue;
      create.push({ name: m.name.trim(), code: m.code, color: m.color, scenes: newScenes.get(`n:${s.key}`) ?? [] });
    }
    for (const c of replaced) for (const t of c.gone) remove.set(t.slice(2), [...(remove.get(t.slice(2)) ?? []), c.pageId]);
    onApply({ create, add, remove, summary: { adds: changes.adds.length, replaced: replaced.length, created: create.length } });
  }

  /* ---------- Pasos ---------- */

  const stepNames: Key[] = ['scenes.import.stepFile', 'scenes.import.stepVendors', 'scenes.import.stepReview'];
  const steps = (
    <nav className="vimport-steps" aria-label={tr('scenes.import.steps')}>
      {stepNames.map((name, i) => {
        const n = (i + 1) as Step;
        return (
          <span key={name} className="vimport-step-wrap">
            {i > 0 && <span className="vimport-step-sep" aria-hidden />}
            <button type="button" className={`vimport-step${step > n ? ' done' : ''}`} aria-current={step === n ? 'step' : undefined} disabled={n > step} onClick={() => setStep(n)}>
              <b>{step > n ? <CheckIcon size={12} /> : n}</b>
              {tr(name)}
            </button>
          </span>
        );
      })}
    </nav>
  );

  const colSelect = (which: 'shot' | 'vendor' | 'letter', label: Key) => (
    <select
      value={layout[which]}
      aria-label={tr(label)}
      onChange={(e) => {
        setLayout((l) => ({ ...l, [which]: +e.target.value }));
        // Solo la columna de vendor cambia los nombres; la del plano y la de la letra dejan lo elegido como está.
        if (which === 'vendor') setMaps({});
      }}
    >
      <option value={-1}>{which === 'letter' ? tr('scenes.import.none') : tr('scenes.import.pick')}</option>
      {Array.from({ length: width }, (_, i) => (
        <option key={i} value={i}>
          {columnLetters(i)}
          {headerCells[i] ? ` · ${headerCells[i]}` : ''}
        </option>
      ))}
    </select>
  );

  // La muestra: unos planos distintos (el primero, uno con dos vendors, uno resuelto por la letra, uno sin página).
  const sample = useMemo(() => {
    if (!ready) return [];
    const picked: typeof rows = [];
    const take = (pred: (r: (typeof rows)[number]) => boolean) => {
      const r = rows.find((x) => pred(x) && !picked.includes(x));
      if (r) picked.push(r);
    };
    take((r) => r.vendors.length > 0 && resolveShot(r, index).kind === 'exact');
    take((r) => r.vendors.length > 1);
    take((r) => resolveShot(r, index).kind === 'letter');
    take((r) => r.vendors.length > 0 && resolveShot(r, index).kind === 'none');
    take((r) => r.vendors.length > 0);
    return picked.slice(0, 5);
  }, [ready, rows, index]);

  function stepFile() {
    return (
      <>
        <input
          ref={input}
          type="file"
          hidden
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void choose(f);
          }}
        />
        {file ? (
          <div className="vimport-file">
            <div className="vimport-file-text">
              <b>{file.name}</b>
              <span className="muted small">
                {reading ? tr('scenes.import.reading') : sheets ? `${tr('scenes.import.sheetCount', { count: sheets.length })} · ${formatSize(file.size)}` : formatSize(file.size)}
              </span>
            </div>
            <button type="button" onClick={() => input.current?.click()} disabled={reading}>
              {tr('scenes.import.chooseOther')}
            </button>
          </div>
        ) : (
          <div
            className={`vimport-drop${dragging ? ' over' : ''}`}
            onDragOver={(e: DragEvent) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void choose(f);
            }}
          >
            <p>{tr('scenes.import.drop')}</p>
            <button type="button" className="primary" onClick={() => input.current?.click()}>
              {tr('scenes.import.choose')}
            </button>
            <p className="muted small">{tr('scenes.import.formats')}</p>
          </div>
        )}
        {error && (
          <p className="warn small" role="alert">
            {error}
          </p>
        )}
        {sheets && sheet && (
          <>
            <div className="vimport-cols vimport-cols-sheet">
              <label className="vimport-field">
                <span className="vimport-label">{tr('scenes.import.sheet')}</span>
                <select
                  value={sheetIdx}
                  onChange={(e) => {
                    pickSheetAt(sheets, +e.target.value);
                    setMaps({});
                  }}
                >
                  {sheets.map((s, i) => (
                    <option key={i} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {ready && <span className="vimport-why">{tr('scenes.import.sheetMeta', { row: layout.header + 1, count: rows.length })}</span>}
              </label>
              <label className="vimport-field">
                <span className="vimport-label">{tr('scenes.import.headerRow')}</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, sheet.rows.length)}
                  value={layout.header + 1}
                  onChange={(e) => {
                    const n = Math.min(Math.max(1, Math.round(+e.target.value) || 1), Math.max(1, sheet.rows.length));
                    setLayout((l) => ({ ...l, header: n - 1 }));
                    setMaps({});
                  }}
                />
              </label>
            </div>
            {layout.shot < 0 && layout.vendor < 0 && <p className="vimport-note">{tr('scenes.import.noHeader')}</p>}
            <div className="vimport-cols">
              <label className="vimport-field">
                <span className="vimport-label">
                  <b>{tr('scenes.import.colShot')}</b> · {tr('scenes.import.colShotHint')}
                </span>
                {colSelect('shot', 'scenes.import.colShot')}
                {layout.shot >= 0 && !shotOk && (
                  <span className="vimport-why err">
                    <WarningIcon size={13} />
                    {tr('scenes.import.shotBad')}
                  </span>
                )}
              </label>
              <label className="vimport-field">
                <span className="vimport-label">
                  <b>{tr('scenes.import.colVendor')}</b>
                </span>
                {colSelect('vendor', 'scenes.import.colVendor')}
                {layout.vendor >= 0 && shotOk && (
                  <span className={`vimport-why${vendorOk ? '' : ' err'}`}>
                    {vendorOk ? tr('scenes.import.vendorNames', { count: sources.length }) : tr('scenes.import.vendorEmpty')}
                  </span>
                )}
              </label>
              <label className="vimport-field">
                <span className="vimport-label">
                  <b>{tr('scenes.import.colLetter')}</b> · {tr('scenes.import.optional')}
                </span>
                {colSelect('letter', 'scenes.import.colLetter')}
                <span className="vimport-why">{layout.letter >= 0 ? tr('scenes.import.letterHint') : tr('scenes.import.letterNone')}</span>
              </label>
            </div>
            {sample.length > 0 && (
              <table className="vimport-sample">
                <thead>
                  <tr>
                    <th>{tr('scenes.import.colShot')}</th>
                    <th>{tr('scenes.import.sampleScene')}</th>
                    <th>{tr('scenes.import.samplePage', { project: projectName })}</th>
                    <th>{tr('scenes.import.colVendor')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sample.map((r, i) => {
                    const found = resolveShot(r, index);
                    const scene = 'scene' in found ? sceneById.get(found.scene.pageId) : undefined;
                    return (
                      <tr key={i}>
                        <td className="mono">{r.shot}</td>
                        <td className="mono">
                          <b>{scene?.label ?? ('base' in found ? found.base : '—')}</b>
                          {found.kind === 'letter' && <span className="muted small"> {tr('scenes.import.fromClip')}</span>}
                        </td>
                        <td className={scene ? '' : 'warn'}>{scene ? scene.name : found.kind === 'ambiguous' ? tr('scenes.import.whichOne') : tr('scenes.import.noPage')}</td>
                        <td>{r.vendors.join(', ') || <span className="muted">{tr('scenes.import.noVendorCell')}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </>
    );
  }

  function setMap(key: string, value: string) {
    const s = sources.find((x) => x.key === key);
    if (!s) return;
    setMaps((all) => {
      const next = { ...all };
      // Si otro nombre estaba unido a este y este deja de ser destino, ese pasa a crearse.
      if (value === 'skip' || value.startsWith('merge:'))
        for (const o of sources)
          if (next[o.key]?.mode === 'merge' && (next[o.key] as { into: string }).into === key) next[o.key] = freshNew(o.name, next);
      if (value === 'new') next[key] = all[key]?.mode === 'new' ? all[key] : freshNew(s.name, next);
      else if (value === 'skip') next[key] = { mode: 'skip' };
      else if (value.startsWith('merge:')) next[key] = { mode: 'merge', into: value.slice(6) };
      else if (value.startsWith('existing:')) next[key] = { mode: 'existing', vendor: value.slice(9) };
      return next;
    });
    setSuggested((s2) => {
      const n = new Set(s2);
      n.delete(key);
      return n;
    });
  }
  function freshNew(name: string, all: Record<string, Mapping>): Mapping {
    const used = new Set([...vendors.map((v) => v.color), ...Object.values(all).flatMap((m) => (m.mode === 'new' ? [m.color] : []))]);
    const color = PROJECT_PRESETS.find((c) => !used.has(c)) ?? PROJECT_PRESETS[used.size % PROJECT_PRESETS.length];
    return { mode: 'new', name, code: proposeCode(name), color };
  }
  const patchNew = (key: string, change: Partial<{ name: string; code: string; color: string }>) =>
    setMaps((all) => {
      const m = all[key];
      return m?.mode === 'new' ? { ...all, [key]: { ...m, ...change } } : all;
    });

  function stepVendors() {
    return (
      <>
        <p className="muted small vimport-lead">{tr('scenes.import.vendorsLead')}</p>
        <div className="vimport-vmap" role="table">
          <div className="vimport-vm head" role="row">
            <span role="columnheader">{tr('scenes.import.colName')}</span>
            <span role="columnheader" />
            <span role="columnheader">{tr('scenes.import.colIn', { project: projectName })}</span>
          </div>
          {sources.map((s) => {
            const m = maps[s.key];
            if (!m) return null;
            const value = m.mode === 'existing' ? `existing:${m.vendor}` : m.mode === 'merge' ? `merge:${m.into}` : m.mode;
            const t = targetOf(maps, s.key);
            return (
              <div key={s.key} className={`vimport-vm${m.mode === 'skip' ? ' skip' : ''}`} role="row">
                <span className="vimport-src" role="cell">
                  <b>{s.name}</b>
                  <span className="muted small">
                    {tr('scenes.import.shotCount', { count: s.shots })} · {tr('scenes.share.sceneCount', { count: s.scenes })}
                  </span>
                </span>
                <span role="cell" />
                <span className="vimport-dst" role="cell">
                  <select value={value} aria-label={tr('scenes.import.whatFor', { name: s.name })} onChange={(e) => setMap(s.key, e.target.value)}>
                    <option value="new">{tr('scenes.import.optNew')}</option>
                    {vendors.map((v) => (
                      <option key={v.key} value={`existing:${v.key}`}>
                        {tr('scenes.import.optExisting', { name: v.name || tr('scenes.share.unnamed') })}
                      </option>
                    ))}
                    {sources
                      .filter((o) => o !== s && maps[o.key] && maps[o.key].mode !== 'skip' && maps[o.key].mode !== 'merge')
                      .map((o) => (
                        <option key={o.key} value={`merge:${o.key}`}>
                          {tr('scenes.import.optSame', { name: o.name })}
                        </option>
                      ))}
                    <option value="skip">{tr('scenes.import.optSkip')}</option>
                  </select>
                  {m.mode === 'new' && (
                    <>
                      <span className="share-vendor-swatch-wrap">
                        <button
                          type="button"
                          className="share-vendor-swatch"
                          style={{ '--vc': m.color } as CSSProperties}
                          aria-label={tr('scenes.import.color', { name: m.name || s.name })}
                          aria-expanded={picking?.key === s.key}
                          onClick={() => setPicking(picking?.key === s.key ? null : { key: s.key, before: m.color })}
                        >
                          <i />
                        </button>
                        {picking?.key === s.key && (
                          <div className="share-vendor-pop" role="dialog" aria-label={tr('scenes.import.color', { name: m.name || s.name })}>
                            <ColorPicker
                              initial={m.color}
                              defaultColor={picking.before}
                              presets={PROJECT_PRESETS}
                              recents={loadRecentColors()}
                              onChange={(color) => patchNew(s.key, { color })}
                              onCancel={() => {
                                patchNew(s.key, { color: picking.before });
                                setPicking(null);
                              }}
                              onAccept={(color) => {
                                rememberRecentColor(color);
                                patchNew(s.key, { color });
                                setPicking(null);
                              }}
                            />
                          </div>
                        )}
                      </span>
                      <input
                        className="vimport-name"
                        value={m.name}
                        maxLength={80}
                        aria-label={tr('scenes.import.newName')}
                        onChange={(e) => patchNew(s.key, { name: e.target.value })}
                      />
                      <input
                        className="share-vendor-code mono"
                        value={m.code}
                        maxLength={4}
                        aria-label={tr('scenes.import.code')}
                        onChange={(e) => patchNew(s.key, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) })}
                      />
                      <span className="vimport-tag new">{tr('scenes.import.tagNew')}</span>
                    </>
                  )}
                  {m.mode === 'existing' && t && (
                    <>
                      {chip(t)}
                      {suggested.has(s.key) && <span className="vimport-tag merge">{tr('scenes.import.tagSuggested')}</span>}
                    </>
                  )}
                  {m.mode === 'merge' && t && (
                    <>
                      {chip(t)}
                      {suggested.has(s.key) && <span className="vimport-tag merge">{tr('scenes.import.tagSuggested')}</span>}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <p className="vimport-note">
          <InfoIcon size={14} />
          {tr('scenes.import.newHint')}
        </p>
      </>
    );
  }

  function stepReview() {
    if (!analysis || !changes) return null;
    const scenesAdded = new Set(changes.adds.map((a) => a[0])).size;
    const show = (v: ReviewView) => view === 'all' || view === v;
    const card = (v: ReviewView, cls: string, n: string, label: string) => (
      <button type="button" className={`vimport-card ${cls}`} aria-pressed={view === v} onClick={() => setView(view === v || v === 'all' ? 'all' : v)}>
        <span className="n mono">{n}</span>
        <span className="l">{label}</span>
      </button>
    );
    const byVendor = new Map<string, string[]>();
    for (const [pageId, t] of changes.adds) byVendor.set(t, [...(byVendor.get(t) ?? []), pageId]);
    const all = changes.changes.length > 0 && changes.changes.every((c) => confirm.has(c.pageId));
    const names = (ts: string[]) => ts.map((t) => targetVendor(t)?.name ?? '?').join(', ');
    return (
      <>
        <div className="vimport-cards">
          {card('all', 'add', `+${changes.adds.length}`, tr('scenes.import.cardAdd', { count: scenesAdded }))}
          {card('change', 'change', String(changes.changes.length), tr('scenes.import.cardChange', { count: changes.changes.length }))}
          {card('letter', '', String(analysis.viaLetter.size), tr('scenes.import.cardLetter', { count: analysis.viaLetter.size }))}
          {card('noPage', 'skip', String(analysis.noPage.size), tr('scenes.import.cardNoPage', { count: analysis.noPage.size }))}
        </div>

        {show('change') && changes.changes.length > 0 && (
          <section className="vimport-group">
            <h3>
              <WarningIcon size={15} />
              {tr('scenes.import.changeTitle')} <span className="n mono">{changes.changes.length}</span>
            </h3>
            <p>{tr('scenes.import.changeLead', { project: projectName })}</p>
            <div className="vimport-list">
              <label className="vimport-allrow">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(e) => setConfirm(e.target.checked ? new Set(changes.changes.map((c) => c.pageId)) : new Set())}
                />
                {tr('scenes.import.replaceAll')}
                <span className="muted small vimport-spacer">{tr('scenes.import.ofTotal', { count: replaced.length, total: changes.changes.length })}</span>
              </label>
              {changes.changes.map((c) => {
                const on = confirm.has(c.pageId);
                return (
                  <label key={c.pageId} className={`vimport-li${on ? ' on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setConfirm((s) => {
                          const n = new Set(s);
                          if (on) n.delete(c.pageId);
                          else n.add(c.pageId);
                          return n;
                        })
                      }
                    />
                    <span className="num mono">{sceneLabel(c.pageId)}</span>
                    <span className="tt">
                      {sceneById.get(c.pageId)?.name}
                      <small>{on ? tr('scenes.import.removedFrom', { names: names(c.gone) }) : tr('scenes.import.staysIn', { names: names(c.gone) })}</small>
                    </span>
                    <span className="vimport-flow">
                      {c.gone.map((t) => chip(t, on ? 'rm' : ''))}
                      <span className="ar" aria-hidden>
                        →
                      </span>
                      {[...c.keep, ...c.add].map((t) => chip(t, c.add.includes(t) ? 'add' : ''))}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        )}

        {show('all') && (
          <section className="vimport-group">
            <h3>
              {tr('scenes.import.addTitle')} <span className="n mono">{changes.adds.length}</span>
            </h3>
            <p>
              {tr('scenes.import.addLead')}
              {changes.untouched > 0 && ` ${tr('scenes.import.untouched', { count: changes.untouched, project: projectName })}`}
            </p>
            {byVendor.size === 0 ? (
              <p className="muted small">{tr('scenes.import.nothingToAdd')}</p>
            ) : (
              <div className="vimport-byv">
                {[...byVendor]
                  .sort((a, b) => b[1].length - a[1].length)
                  .map(([t, ids]) => {
                    const v = targetVendor(t);
                    return (
                      <div key={t} className="vimport-bv">
                        <div className="hd">
                          {chip(t)}
                          <b>{v?.name}</b>
                          <span className="muted small">{tr('scenes.share.sceneCount', { count: ids.length })}</span>
                        </div>
                        <div className="codes mono">
                          {ids
                            .map((id) => sceneById.get(id))
                            .filter((s): s is ImportScene => !!s)
                            .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
                            .map((s) => (
                              <span key={s.pageId} data-tip={s.name}>
                                {s.label}
                              </span>
                            ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        )}

        {show('letter') && analysis.viaLetter.size > 0 && (
          <section className="vimport-group">
            <h3>
              {tr('scenes.import.letterTitle')} <span className="n mono">{analysis.viaLetter.size}</span>
            </h3>
            <p>{tr('scenes.import.letterLead', { project: projectName })}</p>
            <div className="vimport-list">
              {[...analysis.viaLetter].flatMap(([base, per]) =>
                [...per].map(([pageId, ts]) => (
                  <div key={pageId} className="vimport-li nocb">
                    <span className="num mono">
                      {base} → {sceneLabel(pageId)}
                    </span>
                    <span className="tt">{sceneById.get(pageId)?.name}</span>
                    <span className="vimport-flow">{[...ts].map((t) => chip(t))}</span>
                  </div>
                )),
              )}
            </div>
          </section>
        )}

        {view === 'all' && analysis.ambiguous.size > 0 && (
          <section className="vimport-group">
            <h3>
              {tr('scenes.import.ambTitle')} <span className="n mono">{analysis.ambiguous.size}</span>
            </h3>
            <p>{tr('scenes.import.ambLead')}</p>
            <div className="vimport-tags">
              {[...analysis.ambiguous].map(([base, ts]) => (
                <span key={base} className="mono">
                  {base} {[...ts].map((t) => chip(t))}
                </span>
              ))}
            </div>
          </section>
        )}

        {view === 'all' && analysis.blocked.size > 0 && (
          <section className="vimport-group">
            <h3>
              {tr('scenes.import.blockedTitle')} <span className="n mono">{analysis.blocked.size}</span>
            </h3>
            <p>{tr('scenes.import.blockedLead')}</p>
            <div className="vimport-tags">
              {[...analysis.blocked].map(([pageId, ts]) => (
                <span key={pageId} className="mono" data-tip={sceneById.get(pageId)?.name}>
                  {sceneLabel(pageId)} {[...ts].map((t) => chip(t))}
                </span>
              ))}
            </div>
          </section>
        )}

        {show('noPage') && analysis.noPage.size > 0 && (
          <section className="vimport-group">
            <h3>
              {tr('scenes.import.noPageTitle', { project: projectName })} <span className="n mono">{analysis.noPage.size}</span>
            </h3>
            <p>{tr('scenes.import.noPageLead')}</p>
            <div className="vimport-tags">
              {[...analysis.noPage]
                .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
                .map(([base, ts]) => (
                  <span key={base} className="mono">
                    {base} {[...ts].map((t) => chip(t))}
                  </span>
                ))}
            </div>
          </section>
        )}

        {view === 'all' && (
          <section className="vimport-group">
            <h3>{tr('scenes.import.noVendorTitle')}</h3>
            <p>{tr('scenes.import.noVendorLead', { shots: analysis.shotsNoVendor, scenes: analysis.scenesNoVendor })}</p>
            {analysis.badShots > 0 && <p>{tr('scenes.import.badShots', { count: analysis.badShots })}</p>}
          </section>
        )}
      </>
    );
  }

  /* ---------- Pie ---------- */

  const nothing = !!changes && changes.adds.length === 0 && replaced.length === 0 && newOnes.length === 0;
  const tooMany = sceneChanges > MAX_SCENE_CHANGES;
  let footer;
  if (step === 1)
    footer = (
      <>
        <span className="share-scenes-sum muted">{ready ? tr('scenes.import.shotsRead', { count: rows.length }) : ''}</span>
        <button type="button" onClick={onClose}>
          {tr('scenes.import.cancel')}
        </button>
        <button type="button" className="primary" disabled={!ready || reading} onClick={toVendors}>
          {tr('scenes.import.next')}
        </button>
      </>
    );
  else if (step === 2)
    footer = (
      <>
        <span className="share-scenes-sum">
          {unnamed ? (
            <span className="warn">{tr('scenes.import.needName')}</span>
          ) : (
            newOnes.length > 0 && <span className="plus">{tr('scenes.import.newVendors', { count: newOnes.length })}</span>
          )}
        </span>
        <button type="button" onClick={() => setStep(1)}>
          {tr('scenes.import.back')}
        </button>
        <button
          type="button"
          className="primary"
          disabled={unnamed}
          onClick={() => {
            setConfirm(new Set());
            setView('all');
            setStep(3);
          }}
        >
          {tr('scenes.import.toReview')}
        </button>
      </>
    );
  else
    footer = (
      <>
        <span className="share-scenes-sum">
          {tooMany ? (
            <span className="warn">{tr('scenes.import.tooMany', { count: sceneChanges })}</span>
          ) : nothing ? (
            <span className="muted">{tr('scenes.import.nothing', { project: projectName })}</span>
          ) : (
            <>
              <span className="plus">+{changes?.adds.length ?? 0}</span>
              {!!changes?.changes.length && (
                <span className={replaced.length ? 'minus' : 'muted'}>{tr('scenes.import.replacements', { count: replaced.length, total: changes.changes.length })}</span>
              )}
              <span className="muted small">{tr('scenes.import.nothingShared')}</span>
            </>
          )}
        </span>
        <button type="button" onClick={() => setStep(2)}>
          {tr('scenes.import.back')}
        </button>
        <button type="button" className="primary" disabled={nothing || tooMany} onClick={apply}>
          {tr('scenes.import.apply')}
        </button>
      </>
    );

  return (
    <div className="modal-backdrop vimport-backdrop" onClick={onClose}>
      <div className="modal team-dialog share-scenes vimport" role="dialog" aria-label={tr('scenes.import.title')} onClick={(e) => e.stopPropagation()}>
        <div className="share-vendors-head">
          <div>
            <h2>{tr('scenes.import.title')}</h2>
            <p className="muted team-lead">{tr('scenes.import.lead', { project: projectName })}</p>
          </div>
          <button type="button" className="icon-button" aria-label={tr('common.close')} onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>
        {steps}
        <div className="vimport-body">{step === 1 ? stepFile() : step === 2 ? stepVendors() : stepReview()}</div>
        <div className="team-invite-actions share-scenes-footer">{footer}</div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
