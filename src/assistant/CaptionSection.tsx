import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useT, type Translate } from '../i18n';
import '../i18n/lazy/assistant';
import { mediaIdOf } from '../media/queue';
import { useServices } from '../services';
import { IS_MAC, modPressed } from '../ui/findUi';
import { porteroDownload } from '../ui/sharpImages';
import { shortcutLabel } from '../ui/shortcuts';
import { asAction, tipRows } from '../ui/tipRows';
import type { AssistantTarget } from './assistantUi';
import { applyCaption, buildCaptionRequest, captionPlace, cleanCaption } from './caption';
import { captionImage, CaptionImageError, type CaptionImage } from './captionImage';
import { errorText } from './errorText';
import { readRequestKey, useNvidiaTransport, type NvidiaContext } from './nvidiaTransport';
import { nvidiaProfile } from './nvidiaModels';
import { isKeyRejected, SyncedKeyHint } from './SyncedKeyHint';
import type { PhotoRef } from './photoRef';
import { LANGUAGES } from './prompt';
import { complete, ProviderError, type ProviderConfig, type Usage } from './providers';

// *Suggest caption* en el panel del asistente (Docs/Doc_Asistente.md, entrega A3 y 10.5): primero el aviso de que la
// foto sale hacia el proveedor (*Send this photo to <proveedor>?*, en cada pedido), después la respuesta por partes, y
// la vista previa con el pie en un campo que se puede retocar; *Apply* lo pone en la página como una edición que se
// deshace (caption.ts dice dónde). *Try again* sobre la misma foto no vuelve a preguntar: ya se dijo que sí para esa
// foto y ese proveedor.

type Phase =
  | { kind: 'confirm' }
  | { kind: 'preparing' }
  | { kind: 'running'; text: string }
  | { kind: 'preview'; text: string; linksRemoved: boolean }
  /** `again`: *Try again* tiene sentido (la foto sigue ahí); `keyRejected`: el 401, con el botón de la copia sincronizada (S2). */
  | { kind: 'error'; message: string; again: boolean; keyRejected?: boolean };

/** Dónde se recuerda el idioma del pie (en este dispositivo; una comodidad, no un dato). */
const LANGUAGE_KEY = 'shotdocs.assistant.captionLanguage';

function savedLanguage(fallback: string): string {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY);
    if (v && LANGUAGES.some((l) => l.id === v)) return v;
  } catch {
    // Sin almacenamiento (una ventana privada): el idioma de la app.
  }
  return LANGUAGES.some((l) => l.id === fallback) ? fallback : 'en';
}

function keepLanguage(id: string): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, id);
  } catch {
    // Nada: la próxima vez arranca con el idioma de la app.
  }
}

/** El texto de un error de *Suggest caption*: los de la foto, un modelo que no mira fotos, y los de siempre. */
export function captionErrorText(err: unknown, provider: string, tr: Translate): string {
  if (err instanceof CaptionImageError) return tr(err.kind === 'unreadable' ? 'assistant.caption.unreadable' : 'assistant.caption.unavailable');
  if (err instanceof ProviderError && err.kind === 'badRequest' && /image|vision|multimodal|modalit|picture/i.test(err.message))
    return tr('assistant.caption.noVision');
  return errorText(err, provider, tr);
}

interface Props {
  pageId?: string;
  photo: PhotoRef;
  config: ProviderConfig;
  email: string;
  /** El nombre del proveedor o, con uno compatible, su dirección (adonde va la foto). */
  destination: string;
  providerName: string;
  /** Sin clave, la política o sin red: no se puede pedir. */
  blocked: boolean;
  /** El permiso de editar, mirado otra vez al aplicar. */
  canEdit: () => boolean;
  target: AssistantTarget | null;
  onUsage: (usage: Usage | null) => void;
  /** Termina (con lo que dice la lista de acciones al volver, si algo). */
  onClose: (note?: string) => void;
}

export function CaptionSection({ pageId, photo, config, email, destination, providerName, blocked, canEdit, target, onUsage, onClose }: Props) {
  const captureNvidia = useNvidiaTransport(pageId);
  const tr = useT();
  const { media } = useServices();
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });
  const [stopping, setStopping] = useState(false);
  const [language, setLanguage] = useState(() => savedLanguage(tr.lang));
  const [caption, setCaption] = useState('');
  const [thumb, setThumb] = useState<string | null>(null);
  const [sent, setSent] = useState<CaptionImage | null>(null);
  const image = useRef<CaptionImage | null>(null);
  const abort = useRef<AbortController | null>(null);
  const activeNvidia = useRef<NvidiaContext | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // Cortar el pedido al cerrar.
  useEffect(() => () => abort.current?.abort(), []);

  // La miniatura de la foto, para que se vea cuál se va a mandar (solo una del Drive: ya está en el dispositivo).
  useEffect(() => {
    const id = mediaIdOf(photo.url);
    if (!id) return;
    let live = true;
    void media
      .thumbnail(id)
      .then((url) => live && setThumb(url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [media, photo.url]);

  // El foco: al pedir confirmación, en *Send photo*; con la respuesta, en el campo del pie.
  // (Después del foco que el panel se pone al abrirse: por eso en la vuelta siguiente.)
  useEffect(() => {
    const t = setTimeout(() => {
      if (phase.kind === 'preview') field.current?.focus({ preventScroll: true });
      else root.current?.querySelector<HTMLButtonElement>('button.primary:not(:disabled)')?.focus({ preventScroll: true });
    });
    return () => clearTimeout(t);
  }, [phase.kind]);

  const send = async () => {
    if (blocked || stopping) return;
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    onUsage(null);
    const lang = LANGUAGES.find((l) => l.id === language) ?? LANGUAGES[0];
    keepLanguage(lang.id);
    let nvidia: NvidiaContext | undefined;
    try {
      nvidia = captureNvidia(config, controller, (state) => {
        if (abort.current !== controller) return;
        setStopping(state === 'stopping');
        setPhase({ kind: 'error', message: tr(state === 'stopping' ? 'assistant.nvidia.stopping' : state === 'confirmed' ? 'assistant.nvidia.stopped' : 'assistant.nvidia.stopUnconfirmed'), again: state !== 'stopping' });
      });
      activeNvidia.current = nvidia;
      if (config.provider === 'nvidia' && (!pageId || !canEdit())) throw new ProviderError('workspace', 'workspace_page');
      if (config.provider === 'nvidia' && !nvidiaProfile(config.model)?.vision) { setPhase({ kind: 'error', message: tr('assistant.nvidia.noVision'), again: false }); return; }
      nvidia?.check();
      if (!image.current) {
        setPhase({ kind: 'preparing' });
        const editor = target?.editor?.() as { resolveFileUrl?: (u: string) => Promise<string> } | null | undefined;
        image.current = await captionImage(photo.url, {
          media,
          download: porteroDownload(media),
          resolve: editor?.resolveFileUrl ? (u) => editor.resolveFileUrl!(u) : undefined,
        });
        if (abort.current !== controller) return;
        setSent(image.current);
      }
      nvidia?.check();
      if (config.provider === 'nvidia' && !canEdit()) throw new ProviderError('workspace', 'workspace_page');
      setPhase({ kind: 'running', text: '' });
      // La clave se descifra recién acá y queda solo en esta llamada.
      const answer = await complete(config, await readRequestKey(config, email, nvidia), buildCaptionRequest(lang.english, image.current), {
        nvidia,
        signal: controller.signal,
        onText: (text) => {
          if (abort.current === controller) setPhase({ kind: 'running', text });
        },
      });
      if (abort.current !== controller) return;
      onUsage(answer.usage);
      const clean = cleanCaption(answer.text);
      if (answer.cut || !clean.text) {
        setPhase({ kind: 'error', message: tr('assistant.cutOff'), again: true });
        return;
      }
      setCaption(clean.text);
      setPhase({ kind: 'preview', text: clean.text, linksRemoved: clean.linksRemoved });
    } catch (err) {
      if (abort.current !== controller) return;
      if (controller.signal.aborted && nvidia) return;
      setPhase({ kind: 'error', message: captionErrorText(err, providerName, tr), again: true, keyRejected: isKeyRejected(err) });
    } finally { await nvidia?.close(); }
  };

  const stop = () => {
    abort.current?.abort();
    if (activeNvidia.current) return;
    abort.current = null;
    setPhase({ kind: 'error', message: tr('assistant.stopped'), again: true });
  };

  const close = (note?: string) => {
    abort.current?.abort();
    abort.current = null;
    onClose(note);
  };

  const apply = () => {
    if (phase.kind !== 'preview') return;
    const view = target?.view() ?? null;
    const editor = target?.editor?.() ?? null;
    // El permiso se mira otra vez al aplicar (7.1): pudo cambiar mientras se veía la sugerencia.
    const outcome = applyCaption(editor, view, photo, caption, canEdit() && (target?.editable() ?? false));
    if (!outcome.ok) {
      const message =
        outcome.reason === 'changed' ? tr('assistant.caption.changed') : outcome.reason === 'readOnly' ? tr('assistant.readOnly') : tr('assistant.failed');
      setPhase({ kind: 'error', message, again: outcome.reason !== 'changed' && outcome.reason !== 'readOnly' });
      return;
    }
    if (outcome.changed === 0) {
      close(tr('assistant.nothingChanged'));
      return;
    }
    // El cursor al final del pie, para seguir escribiendo ahí.
    if (outcome.blockId && editor) {
      try {
        (editor as unknown as { setTextCursorPosition?: (id: string, at: 'end') => void }).setTextCursorPosition?.(outcome.blockId, 'end');
      } catch {
        // El bloque ya no está: el cursor queda donde estaba.
      }
    }
    close(tr('assistant.caption.applied', { undo: shortcutLabel('undo') }));
    view?.focus();
  };

  const copy = () => {
    const text = phase.kind === 'preview' ? caption : '';
    if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (phase.kind === 'running' || phase.kind === 'preparing') stop();
      else close();
      return;
    }
    if (e.key === 'Enter' && phase.kind === 'preview') {
      // El pie es un renglón: Enter no parte el campo; Ctrl/⌘+Enter aplica.
      e.preventDefault();
      e.stopPropagation();
      if (modPressed(e, IS_MAC) && canEdit()) apply();
    }
  };

  const place = captionPlace(target?.view() ?? null, photo);

  return (
    <div className="assistant-result assistant-caption" ref={root} onKeyDown={onKeyDown}>
      <p className="mono-label">{tr('assistant.caption')}</p>
      {thumb && <img className="assistant-caption-thumb" src={thumb} alt="" />}
      {phase.kind === 'confirm' && (
        <>
          <p className="assistant-caption-ask">{tr('assistant.caption.confirm', { provider: destination })}</p>
          {config.provider === 'nvidia' && <p className="muted assistant-hint">{tr('assistant.nvidia.route')}</p>}
          <p className="muted assistant-hint">{tr('assistant.caption.confirmText')}</p>
          <div className="assistant-row">
            <span className="assistant-small">{tr('assistant.caption.language')}</span>
            <select aria-label={tr('assistant.caption.language')} value={language} onChange={(e) => setLanguage(e.target.value)} disabled={blocked}>
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.native}
                </option>
              ))}
            </select>
          </div>
          <div className="assistant-buttons">
            <button className="primary" disabled={blocked || !canEdit()} onClick={() => void send()}>
              {tr('assistant.caption.send')}
            </button>
            <button onClick={() => close()} data-tip={tipRows([{ shortcut: 'menusClose', action: asAction(tr('assistant.caption.cancel')) }])}>
              {tr('assistant.caption.cancel')}
            </button>
          </div>
        </>
      )}
      {phase.kind === 'preparing' && (
        <>
          <p className="muted assistant-hint" role="status">
            {tr('assistant.caption.preparing')}
          </p>
          <div className="assistant-buttons">
            <button onClick={stop}>{tr('assistant.stop')}</button>
          </div>
        </>
      )}
      {phase.kind === 'running' && (
        <>
          <p className="muted assistant-hint">{tr('assistant.thinking', { action: tr('assistant.caption') })}</p>
          {/* Lo que llega, como texto: nada se interpreta. */}
          <div className="assistant-stream">{phase.text}</div>
          <div className="assistant-buttons">
            <button onClick={stop}>{tr('assistant.stop')}</button>
          </div>
        </>
      )}
      {phase.kind === 'preview' && (
        <>
          <textarea
            ref={field}
            className="assistant-caption-field"
            aria-label={tr('assistant.caption.field')}
            value={caption}
            rows={3}
            maxLength={600}
            onChange={(e) => setCaption(e.target.value.replace(/\s*\n\s*/g, ' '))}
          />
          <p className="muted assistant-hint">{tr(place === 'cell' ? 'assistant.caption.whereCell' : 'assistant.caption.whereBelow')}</p>
          {phase.linksRemoved && <p className="assistant-warning">{tr('assistant.linksRemoved')}</p>}
          <div className="assistant-buttons">
            <button className="primary" disabled={!canEdit() || !caption.trim()} data-tip={tipRows([{ shortcut: 'assistantApply', action: asAction(tr('assistant.apply')) }])} onClick={apply}>
              {tr('assistant.apply')}
            </button>
            <button onClick={() => close()} data-tip={tipRows([{ shortcut: 'menusClose', action: asAction(tr('assistant.discard')) }])}>
              {tr('assistant.discard')}
            </button>
            <button disabled={blocked} onClick={() => void send()}>
              {tr('assistant.tryAgain')}
            </button>
            <button onClick={copy}>{tr('assistant.copy')}</button>
          </div>
        </>
      )}
      {phase.kind === 'error' && (
        <>
          <p className="assistant-error" role="alert">
            {phase.message}
          </p>
          <div className="assistant-buttons">
            {phase.again && (
              <button className="primary" disabled={blocked} onClick={() => void send()}>
                {tr('assistant.tryAgain')}
              </button>
            )}
            <SyncedKeyHint show={!!phase.keyRejected} />
            <button className="link" onClick={() => close()}>
              {tr('assistant.back')}
            </button>
          </div>
        </>
      )}
      {sent && (phase.kind === 'running' || phase.kind === 'preview') && (
        <p className="muted assistant-small">
          {tr('assistant.caption.sent', { width: sent.width, height: sent.height, kb: Math.max(1, Math.round(sent.bytes / 1024)) })}
          {sent.fromThumbnail && <> · {tr('assistant.caption.fromThumbnail')}</>}
        </p>
      )}
    </div>
  );
}
