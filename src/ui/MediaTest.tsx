import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { openPortero, UploadError, type DriveFile, type DriveStatus, type Portero, type UploadProgress } from '../media/portero';

// Pantalla temporal para probar el portero de archivos desde el teléfono: conectar el Drive del dueño,
// subir un video tal como lo entrega el dispositivo y ver si se reproduce. Arma un informe para copiar.

const ITEMS_KEY = 'shotdocs-media-test';

/** Lo subido en esta prueba, guardado en el dispositivo. */
interface Item {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
}

interface Run {
  phase: 'uploading' | 'done' | 'failed' | 'cancelled';
  attempt: number;
  startedAt: number;
  endedAt: number | null;
  progress: UploadProgress | null;
  /** Con qué subida se puede retomar si falla o se cancela. */
  resume: string | null;
  error: string | null;
  result: DriveFile | null;
}

interface Playback {
  item: Item;
  /** El tipo forzado del pase; `null`: el del archivo. */
  servedAs: string | null;
  openedAt: number;
  url: string | null;
  events: string[];
  readyMs: number | null;
}

function loadItems(): Item[] {
  try {
    const items = JSON.parse(localStorage.getItem(ITEMS_KEY) ?? '[]') as unknown;
    return Array.isArray(items) ? (items as Item[]) : [];
  } catch {
    return [];
  }
}

function saveItems(items: Item[]): void {
  try {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  } catch {
    // Sin almacenamiento la lista vale solo mientras la pantalla está abierta.
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
const secs = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function isVideo(item: Item): boolean {
  if (item.type.startsWith('image/')) return false;
  return item.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(item.name);
}

const CODECS = ['video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="hvc1"', 'video/quicktime', 'video/mp4'];

function deviceInfo() {
  const video = document.createElement('video');
  const standalone =
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    userAgent: navigator.userAgent,
    installed: standalone,
    codecs: CODECS.map((type) => ({ type, answer: video.canPlayType(type) || 'no' })),
  };
}

/** Vuelve a dibujar cada segundo mientras `active`, para el reloj de la subida. */
function useTicking(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

export function MediaTest() {
  // `undefined`: todavía se está leyendo la dirección del portero; `null`: el workspace no tiene.
  const [portero, setPortero] = useState<Portero | null | undefined>(undefined);
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [checking, setChecking] = useState(0);
  const [connecting, setConnecting] = useState(false);
  // Al volver de Google, el portero deja `?drive=connected` (o el error) en la dirección.
  const [driveReturn] = useState(() => new URLSearchParams(location.search).get('drive'));

  const [file, setFile] = useState<File | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [wake, setWake] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const [items, setItems] = useState(loadItems);
  const [asMp4, setAsMp4] = useState(false);
  const [playback, setPlayback] = useState<Playback | null>(null);

  const [device] = useState(deviceInfo);
  const [copied, setCopied] = useState<string | null>(null);
  const reportRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (driveReturn !== null) history.replaceState(history.state, '', location.pathname + location.hash);
  }, [driveReturn]);

  useEffect(() => {
    let live = true;
    setDriveError(null);
    void (async () => {
      try {
        const p = await openPortero();
        if (!live) return;
        setPortero(p);
        if (p) {
          const s = await p.status();
          if (live) setStatus(s);
        }
      } catch (err) {
        if (!live) return;
        setPortero((p) => (p === undefined ? null : p));
        setDriveError(message(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [checking]);

  // Si se vuelve a esta pantalla sin recargarla después de ir a Google (el botón Atrás, o la app instalada
  // en el iPhone, que puede abrir Google en una hoja aparte), el botón se destraba y se vuelve a preguntar.
  useEffect(() => {
    if (!connecting) return;
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      setConnecting(false);
      setChecking((n) => n + 1);
    };
    window.addEventListener('pageshow', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('pageshow', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [connecting]);

  // Si se sale de la pantalla en medio de una subida, se corta: queda para retomar con "Try again".
  useEffect(() => () => controller.current?.abort(), []);

  const uploading = run?.phase === 'uploading';
  useTicking(uploading);

  // La pantalla no se apaga mientras sube (si el dispositivo deja). El sistema suelta el pedido cuando la
  // app queda en segundo plano: se vuelve a pedir al volver.
  useEffect(() => {
    if (!uploading) return;
    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (!('wakeLock' in navigator)) {
        setWake('Not available on this device');
        return;
      }
      try {
        const s = await navigator.wakeLock.request('screen');
        if (stopped) {
          void s.release();
          return;
        }
        sentinel = s;
        setWake('On: the screen stays on');
        s.addEventListener('release', () => {
          if (!stopped) setWake('Released by the system');
        });
      } catch (err) {
        setWake(`Refused (${message(err)})`);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [uploading]);

  async function connect() {
    if (!portero) return;
    setConnecting(true);
    setDriveError(null);
    try {
      location.href = await portero.connect();
    } catch (err) {
      setDriveError(message(err));
      setConnecting(false);
    }
  }

  async function upload(retry: boolean) {
    if (!portero || !file) return;
    const abort = new AbortController();
    controller.current = abort;
    const attempt = retry && run ? run.attempt + 1 : 1;
    // Si la subida anterior quedó a medias, se retoma desde donde llegó.
    const resume = retry ? (run?.resume ?? null) : null;
    setRun({ phase: 'uploading', attempt, startedAt: Date.now(), endedAt: null, progress: null, resume, error: null, result: null });
    try {
      const result = await portero.upload(file, {
        signal: abort.signal,
        resume,
        onProgress: (progress) => setRun((r) => r && { ...r, progress, resume: progress.uploadId }),
      });
      const item: Item = { id: result.id, name: result.name || file.name, type: result.mimeType || file.type, size: result.size, uploadedAt: Date.now() };
      setItems((list) => {
        const next = [item, ...list.filter((i) => i.id !== item.id)];
        saveItems(next);
        return next;
      });
      setRun((r) => r && { ...r, phase: 'done', endedAt: Date.now(), result, resume: null });
    } catch (err) {
      const failed = err instanceof UploadError;
      setRun(
        (r) =>
          r && {
            ...r,
            phase: failed && err.cancelled ? 'cancelled' : 'failed',
            endedAt: Date.now(),
            error: failed && err.cancelled ? null : message(err),
            resume: failed ? err.uploadId : r.resume,
          },
      );
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }

  async function open(item: Item) {
    if (!portero) return;
    const openedAt = performance.now();
    const servedAs = asMp4 && isVideo(item) ? 'video/mp4' : null;
    setPlayback({ item, servedAs, openedAt, url: null, events: [], readyMs: null });
    try {
      const url = await portero.pass(item.id, servedAs ?? undefined);
      setPlayback((p) => (p?.openedAt === openedAt ? { ...p, url, events: [...p.events, line(openedAt, 'link ready')] } : p));
    } catch (err) {
      const text = line(openedAt, `could not get a link: ${message(err)}`);
      setPlayback((p) => (p?.openedAt === openedAt ? { ...p, events: [...p.events, text] } : p));
    }
  }

  /** Anota un evento. `ready`: ya se puede ver; cuenta solo la primera vez. */
  function log(text: string, ready = false) {
    setPlayback((p) => {
      if (!p || (ready && p.readyMs !== null)) return p;
      const readyMs = ready ? performance.now() - p.openedAt : p.readyMs;
      return { ...p, events: [...p.events, line(p.openedAt, text)], readyMs };
    });
  }

  function onVideoEvent(e: SyntheticEvent<HTMLVideoElement>) {
    const v = e.currentTarget;
    if (e.type === 'loadedmetadata') log(`loadedmetadata: ${v.duration.toFixed(2)} s, ${v.videoWidth}×${v.videoHeight}`);
    // Después de cada salto vuelve a llegar: se anota la primera.
    else if (e.type === 'canplay') log('canplay', true);
    else if (e.type === 'error') {
      const error = v.error;
      log(`error: code ${error?.code ?? '?'} (${MEDIA_ERRORS[error?.code ?? 0] ?? 'unknown'})${error?.message ? `, ${error.message}` : ''}`);
    }
  }

  async function copyReport() {
    const text = reportRef.current?.value ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied');
    } catch {
      // Sin permiso para el portapapeles: queda seleccionado para copiarlo a mano.
      const el = reportRef.current;
      el?.focus();
      el?.setSelectionRange(0, el.value.length);
      setCopied('Selected: copy it from the menu');
    }
    setTimeout(() => setCopied(null), 3000);
  }

  const progress = run?.progress;
  const elapsed = run ? (run.endedAt ?? Date.now()) - run.startedAt : 0;
  const percent = progress && progress.total > 0 ? (progress.sent / progress.total) * 100 : 0;

  const driveLine =
    portero === undefined
      ? 'Checking…'
      : portero === null
        ? driveError
          ? 'Could not read the workspace settings'
          : 'The workspace has no media server yet'
        : !status
          ? driveError
            ? 'Could not reach the media server'
            : 'Checking…'
          : status.connected
            ? `Connected${status.email ? ` as ${status.email}` : ''}`
            : status.broken
              ? 'Needs reconnecting'
              : 'Not connected';

  const report = buildReport({ device, portero, driveLine, status, file, run, wake, elapsed, playback });

  return (
    <article className="page narrow media-test">
      <h1 className="page-heading">Media test</h1>
      <p className="muted">Upload a video from this device to Google Drive and check that it plays back here.</p>

      <section>
        <h2>Google Drive</h2>
        {driveReturn === 'connected' && <p className="media-ok">Google Drive connected.</p>}
        {driveReturn === 'drive-permission-missing' && (
          <p className="error">
            Google Drive was not connected: the Drive permission was left unchecked. Connect again and keep it
            checked.
          </p>
        )}
        {driveReturn !== null && driveReturn !== 'connected' && driveReturn !== 'drive-permission-missing' && (
          <p className="error">Google Drive was not connected ({driveReturn}).</p>
        )}
        <dl className="media-facts">
          <dt className="mono-label">Status</dt>
          <dd className={status?.connected ? 'media-ok' : undefined}>{driveLine}</dd>
          {status?.broken && (
            <>
              <dt className="mono-label">Problem</dt>
              <dd>{status.broken}</dd>
            </>
          )}
          {portero && (
            <>
              <dt className="mono-label">Server</dt>
              <dd>{portero.baseUrl}</dd>
            </>
          )}
        </dl>
        {driveError && <p className="error">{driveError}</p>}
        {status && !status.connected && !status.isOwner && (
          <p className="muted">Only the owner of the workspace can connect Google Drive.</p>
        )}
        <div className="media-actions">
          {portero && status?.isOwner && !status.connected && (
            <button className="primary" disabled={connecting} onClick={() => void connect()}>
              Connect Google Drive
            </button>
          )}
          {portero !== undefined && (
            <button
              onClick={() => {
                setConnecting(false);
                setChecking((n) => n + 1);
              }}
              disabled={uploading}
            >
              Check again
            </button>
          )}
        </div>
      </section>

      <section>
        <h2>Upload</h2>
        <input
          type="file"
          aria-label="Choose a video or a photo"
          accept="video/*,image/*"
          disabled={uploading}
          onChange={(e) => {
            setFile(e.currentTarget.files?.[0] ?? null);
            setRun(null);
          }}
        />
        {file && (
          <dl className="media-facts">
            <dt className="mono-label">Name</dt>
            <dd>{file.name}</dd>
            <dt className="mono-label">Type</dt>
            <dd>{file.type || '(none)'}</dd>
            <dt className="mono-label">Size</dt>
            <dd>
              {mb(file.size)} <span className="muted">({file.size.toLocaleString('en-US')} bytes)</span>
            </dd>
            <dt className="mono-label">Modified</dt>
            <dd>{new Date(file.lastModified).toLocaleString()}</dd>
          </dl>
        )}
        <div className="media-actions">
          <button className="primary" disabled={!portero || !file || file.size === 0 || uploading} onClick={() => void upload(false)}>
            Upload to Drive
          </button>
          {uploading && <button onClick={() => controller.current?.abort()}>Cancel</button>}
          {(run?.phase === 'failed' || run?.phase === 'cancelled') && (
            <button onClick={() => void upload(true)}>Try again</button>
          )}
        </div>
        {run && (
          <div className="media-run">
            <div className="media-progress" aria-hidden="true">
              <span style={{ width: `${percent}%` }} />
            </div>
            <p className="media-stats" aria-live="polite">
              {progress ? `${mb(progress.sent)} / ${mb(progress.total)}` : 'Starting…'}
              {progress && ` · ${mb(progress.bytesPerSecond)}/s`}
              {` · ${progress?.retries ?? 0} ${progress?.retries === 1 ? 'retry' : 'retries'}`}
              {` · ${clock(elapsed)}`}
            </p>
            {uploading && (
              <p className="media-note">
                Keep the app open and the screen on.
                {wake && <span className="muted"> Screen lock: {wake}.</span>}
              </p>
            )}
            {run.phase === 'done' && <p className="media-ok">Uploaded in {clock(elapsed)}.</p>}
            {run.phase === 'cancelled' && <p className="muted">Upload cancelled.</p>}
            {run.phase === 'failed' && <p className="error">{run.error}</p>}
          </div>
        )}
      </section>

      <section>
        <h2>Play</h2>
        {items.length === 0 ? (
          <p className="muted">Nothing uploaded from this device yet.</p>
        ) : (
          <>
            <label
              className="media-check"
              data-tip={'Labels the file as MP4 when it is sent back,\nto test whether a .mov plays that way'}
            >
              <input type="checkbox" checked={asMp4} onChange={(e) => setAsMp4(e.currentTarget.checked)} />
              Serve as video/mp4
            </label>
            <ul className="trash-list">
              {items.map((item) => (
                <li key={item.id}>
                  <span className="title" data-tip={item.name} data-tip-plain data-tip-overflow>
                    {item.name}
                  </span>
                  <span className="when">
                    {mb(item.size)} · {new Date(item.uploadedAt).toLocaleDateString()}
                  </span>
                  <button disabled={!portero} onClick={() => void open(item)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {playback && (
          <div className="media-player">
            <p className="media-stats">
              {playback.item.name} · {playback.item.type || '(no type)'}
              {playback.servedAs && ` · served as ${playback.servedAs}`}
            </p>
            {playback.url &&
              (isVideo(playback.item) ? (
                <video
                  key={playback.url}
                  src={playback.url}
                  controls
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={onVideoEvent}
                  onCanPlay={onVideoEvent}
                  onError={onVideoEvent}
                />
              ) : (
                <img
                  key={playback.url}
                  src={playback.url}
                  alt={playback.item.name}
                  onLoad={(e) => log(`load: ${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`, true)}
                  onError={() => log('error: the image could not be shown')}
                />
              ))}
            <ul className="media-log">
              {playback.readyMs !== null && <li>Ready to play after {secs(playback.readyMs)}</li>}
              {playback.events.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {!playback.url && playback.events.length === 0 && <li>Asking for a link…</li>}
            </ul>
          </div>
        )}
      </section>

      <section>
        <h2>This device</h2>
        <dl className="media-facts">
          <dt className="mono-label">Browser</dt>
          <dd>{device.userAgent}</dd>
          <dt className="mono-label">Installed</dt>
          <dd>{device.installed ? 'Yes' : 'No'}</dd>
        </dl>
        <ul className="media-log">
          {device.codecs.map((c) => (
            <li key={c.type}>
              canPlayType('{c.type}'): <strong>{c.answer}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Report</h2>
        <textarea ref={reportRef} className="media-report" readOnly value={report} rows={16} />
        <div className="media-actions">
          <button className="primary" onClick={() => void copyReport()}>
            Copy report
          </button>
          {copied && <span className="muted">{copied}</span>}
        </div>
      </section>
    </article>
  );
}

const MEDIA_ERRORS: Record<number, string> = {
  1: 'aborted',
  2: 'network',
  3: 'decode',
  4: 'source not supported',
};

function line(openedAt: number, text: string): string {
  return `+${secs(performance.now() - openedAt)} ${text}`;
}

function buildReport(r: {
  device: ReturnType<typeof deviceInfo>;
  portero: Portero | null | undefined;
  driveLine: string;
  status: DriveStatus | null;
  file: File | null;
  run: Run | null;
  wake: string | null;
  elapsed: number;
  playback: Playback | null;
}): string {
  const out: string[] = [`LGA Shot Docs media test · ${new Date().toISOString()}`];
  if (__APP_VERSION__) out.push(`App version: v${__APP_VERSION__}`);

  out.push('', 'DEVICE', `User agent: ${r.device.userAgent}`, `Installed app: ${r.device.installed ? 'yes' : 'no'}`);
  for (const c of r.device.codecs) out.push(`canPlayType ${c.type}: ${c.answer}`);

  out.push('', 'GOOGLE DRIVE', `Media server: ${r.portero ? r.portero.baseUrl : r.portero === null ? 'none' : 'checking'}`);
  out.push(`Status: ${r.status?.connected ? 'connected' : r.driveLine}`);

  out.push('', 'FILE CHOSEN');
  if (r.file) {
    out.push(
      `Name: ${r.file.name}`,
      `Type: ${r.file.type || '(none)'}`,
      `Size: ${mb(r.file.size)} (${r.file.size} bytes)`,
      `Last modified: ${new Date(r.file.lastModified).toISOString()}`,
    );
  } else {
    out.push('None');
  }

  out.push('', 'UPLOAD');
  if (r.run) {
    const p = r.run.progress;
    out.push(`Result: ${r.run.phase}${r.run.error ? `: ${r.run.error}` : ''}`, `Attempt: ${r.run.attempt}`);
    if (p) out.push(`Sent: ${mb(p.sent)} of ${mb(p.total)}`, `Average speed: ${mb(p.bytesPerSecond)}/s`, `Retries: ${p.retries}`);
    out.push(`Time: ${clock(r.elapsed)}`, `Screen lock: ${r.wake ?? 'not requested'}`);
    if (r.run.result) out.push(`Drive file: ${r.run.result.id} (${r.run.result.mimeType})`);
  } else {
    out.push('Not started');
  }

  out.push('', 'PLAYBACK');
  if (r.playback) {
    const { item } = r.playback;
    out.push(
      `File: ${item.name} (${item.type || 'no type'}, ${mb(item.size)})`,
      `Served as: ${r.playback.servedAs ?? 'the file type'}`,
      `Ready to play after: ${r.playback.readyMs === null ? 'not yet' : secs(r.playback.readyMs)}`,
      'Events:',
      ...r.playback.events.map((e) => `  ${e}`),
    );
  } else {
    out.push('Nothing opened');
  }
  return out.join('\n');
}
