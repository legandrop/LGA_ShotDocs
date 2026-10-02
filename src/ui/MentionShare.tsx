import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/commentsPanel';
import { useServices, useSyncStatus } from '../services';
import type { MentionCandidate } from '../sync/mentions';
import { ShareGateNotes, useShareGate } from './shareGate';
import { teamErrorText } from './teamText';

// Compartir desde la mención (P.21, entrega 2, ME2; Docs/Doc_Menciones.md): el dueño y los admins que pueden
// compartir la página ven en la lista del `@` también a quien no la ve, en gris. Al elegirlo, esta pregunta: «pedro
// can't see this page. Share it with them (Comment) and mention them?». *Share and mention* la comparte con
// Comentar, solo esa página (`share_for_mention`), por el mismo paso previo que *Share* (useShareGate: sube lo
// pendiente y después prepara la página para quien no ve lo borrado), y recién ahí pone la mención en el texto.
// Pide red. Esc o *Cancel* cierran sin hacer nada.

export function MentionShareArea({
  pageId,
  who,
  onShared,
  onCancel,
}: {
  pageId: string;
  /** A quién se va a compartir; `null`: no hay pregunta abierta (queda solo el progreso de preparar la página). */
  who: MentionCandidate | null;
  onShared: (who: MentionCandidate) => void;
  onCancel: () => void;
}) {
  const { mentions } = useServices();
  const status = useSyncStatus();
  const gate = useShareGate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tr = useT();

  useEffect(() => {
    setError(null);
    gate.clearBlocked();
    if (who) button.current?.focus({ preventScroll: true });
    // Solo cuando cambia a quién se pregunta.
  }, [who?.userId]);

  async function share(anyway: boolean) {
    if (!who || !mentions || busy) return;
    const scope = { pageId };
    setBusy(true);
    setError(null);
    if (anyway) gate.clearBlocked();
    try {
      // Con Comentar no se ve lo borrado: lo pendiente de la página sube antes (o queda el aviso con Retry).
      if (!anyway && !(await gate.ready(scope, true, () => void share(false), () => void share(true)))) return;
      await mentions.shareForMention(pageId, who);
      gate.after(scope, true, who.email);
      onShared(who);
    } catch (err) {
      setError(teamErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!who) return gate.progress ? <ShareGateNotes gate={gate} reader={false} /> : null;
  const offline = !status.online;
  return (
    <div
      className="mention-share"
      role="group"
      aria-label={tr('mentions.shareLabel')}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // Cierra la pregunta sin cancelar el comentario.
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        onCancel();
      }}
    >
      <p>{tr('mentions.shareAsk', { name: who.label })}</p>
      <p className="muted small">{who.email}</p>
      {offline && <p className="muted small">{tr('mentions.shareOffline')}</p>}
      <ShareGateNotes gate={gate} reader />
      {error && <p className="comment-error">{error}</p>}
      <div className="row">
        <button ref={button} type="button" className="primary" disabled={busy || offline} onClick={() => void share(false)}>
          {busy ? tr('mentions.sharing') : tr('mentions.shareAndMention')}
        </button>
        <button type="button" className="link" onClick={onCancel}>
          {tr('common.cancel')}
        </button>
      </div>
    </div>
  );
}
