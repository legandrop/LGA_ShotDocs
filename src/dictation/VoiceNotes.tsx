import { useState } from 'react';
import { useT } from '../i18n';
import { navigate, pagePath } from '../router';
import { useServices, useTree } from '../services';
import { requestQueuedNote } from './dictationUi';
import { removeNote, useQueuedNotes, type QueuedNote } from './queue';

// El aviso de las notas guardadas en el indicador de sincronización (Docs/Doc_Dictado.md, 8; entrega V2): *N voice notes
// to place*, y al tocarlo la lista. Cada nota se abre en su página, donde la hoja la ubica de a una con su vista previa
// (o la pega como texto). Desde acá también se copia o se descarta, con confirmación. Va en la primera carga y es chico.

/** El texto corto de una nota para una lista (la primera parte, en un renglón). */
export function noteSnippet(text: string, max = 90): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export function noteTime(at: number, lang: string): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const loc = lang === 'es' ? 'es-AR' : 'en-US';
  return sameDay ? d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function VoiceNotesNotice() {
  const { user, workspace } = useServices();
  const tree = useTree();
  const tr = useT();
  const notes = useQueuedNotes(user.email, workspace.config.localKey || workspace.config.url);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  if (notes.length === 0) return null;

  /** Se puede abrir en su página: existe en el árbol y no está en la papelera. */
  const reachable = (n: QueuedNote) => !!tree.get(n.pageId) && !tree.isTrashed(n.pageId);
  const openNote = (n: QueuedNote) => {
    requestQueuedNote(n.pageId, n.id);
    navigate(pagePath(n.pageId));
    setOpen(false);
  };

  return (
    <>
      <button className="sync-voice" aria-expanded={open} onClick={() => setOpen(!open)}>
        {tr('sync.voiceNotes', { count: notes.length })}
      </button>
      {open && (
        <div className="sync-details voice-notes" role="region" aria-label={tr('sync.voiceNotesTitle')}>
          <p className="muted">{tr('sync.voiceNotesHint')}</p>
          <ul>
            {notes.map((n) => {
              const ok = reachable(n);
              const title = tree.get(n.pageId)?.title || n.pageTitle || tr('common.untitled');
              return (
                <li key={n.id}>
                  <strong>{ok ? title : tr('sync.voiceNotePageGone', { title })}</strong> · {noteTime(n.createdAt, tr.lang)}
                  <br />
                  <span className="voice-note-text">{n.text ? `“${noteSnippet(n.text)}”` : tr(n.state === 'failed' ? 'sync.voiceNoteFailed' : 'sync.voiceNoteAudio')}</span>
                  {confirm === n.id ? (
                    <span className="row voice-note-actions" role="alertdialog" aria-label={tr('sync.voiceNoteDiscardQ')}>
                      {tr('sync.voiceNoteDiscardQ')}{' '}
                      <button
                        className="link danger"
                        onClick={() => {
                          setConfirm(null);
                          void removeNote(n.id).catch((err) => console.error('Dictado: no se pudo descartar la nota', err));
                        }}
                      >
                        {tr('common.discard')}
                      </button>
                      <button className="link" onClick={() => setConfirm(null)}>
                        {tr('sync.voiceNoteKeep')}
                      </button>
                    </span>
                  ) : (
                    <span className="row voice-note-actions">
                      {ok && (
                        <button className="link" onClick={() => openNote(n)}>
                          {tr('sync.voiceNoteOpen')}
                        </button>
                      )}
                      {n.text && (
                        <button className="link" onClick={() => void navigator.clipboard?.writeText(n.text).catch(() => undefined)}>
                          {tr('sync.copyText')}
                        </button>
                      )}
                      <button className="link danger" onClick={() => setConfirm(n.id)}>
                        {tr('common.discard')}
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="row">
            <button className="link" onClick={() => setOpen(false)}>
              {tr('common.close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
