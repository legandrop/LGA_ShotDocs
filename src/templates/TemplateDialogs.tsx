import { useEffect, useRef, useState } from 'react';
import { t, useT } from '../i18n';
import '../i18n/lazy/templates';
import { navigate, pagePath } from '../router';
import { usePermissions, useServices, useTree } from '../services';
import { notify } from '../ui/notice';
import { dayReportFolderOf } from './dayReport';
import { DESCRIPTION_MAX, saveTemplateSettings, templateInfo } from './own';
import { saveAsTemplate, suggestedTemplateName, TemplateReadError, TemplateTooLarge } from './ownCopy';
import type { OwnTemplatesRequest } from './ownTemplatesUi';
import './templates.css';

// Las ventanas de las plantillas propias (Docs/Doc_Plantillas.md, 5.1 y 5.2): *Save as template* (copia la página a la
// carpeta *Templates*, sin tocarla) y *Template settings* (la descripción y *Use for day reports*). Se bajan aparte.

export function TemplateDialogs({ request, onClose }: { request: OwnTemplatesRequest; onClose: () => void }) {
  return request.kind === 'save' ? (
    <SaveTemplateDialog key={request.pageId} pageId={request.pageId} onClose={onClose} />
  ) : (
    <TemplateSettingsDialog key={request.pageId} pageId={request.pageId} onClose={onClose} />
  );
}

function useEscape(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

/** *Save as template…* (5.1). */
export function SaveTemplateDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const tree = useTree();
  const perms = usePermissions();
  const { docs, engine } = useServices();
  const tr = useT();
  const row = tree.get(pageId);
  const reportFolder = dayReportFolderOf(tree, pageId);
  const [name, setName] = useState(() => suggestedTemplateName(row, tr.lang));
  const [description, setDescription] = useState('');
  const [dayReport, setDayReport] = useState(() => !!reportFolder);
  const [clear, setClear] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const save = async () => {
    if (busy || !row) return;
    setBusy(true);
    setError(null);
    try {
      const id = await saveAsTemplate(
        { tree, docs, engine },
        pageId,
        { name, description, dayReport, clear },
        { canMarkFolder: (folder) => perms.canEditPage(folder) },
      );
      onClose();
      notify(t('saveTemplate.saved'), { label: t('saveTemplate.open'), run: () => navigate(pagePath(id)) });
    } catch (err) {
      setBusy(false);
      if (err instanceof TemplateReadError) {
        setError(err.status === 'newer' ? tr('saveTemplate.newer') : err.status === 'missing' ? tr('saveTemplate.notDownloaded') : tr('saveTemplate.failed'));
        return;
      }
      if (err instanceof TemplateTooLarge) {
        setError(tr('saveTemplate.tooLong'));
        return;
      }
      console.error('Guardar como plantilla: no se pudo', err);
      setError(tr('saveTemplate.failed'));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal template-form"
        role="dialog"
        aria-modal="true"
        aria-label={tr('saveTemplate.title')}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2>{tr('saveTemplate.title')}</h2>
        <div className="template-form-body">
          <label className="template-form-field">
            <span className="pref-label">{tr('saveTemplate.name')}</span>
            <input type="text" value={name} maxLength={200} autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="template-form-field">
            <span className="pref-label">{tr('saveTemplate.description')}</span>
            <textarea value={description} maxLength={DESCRIPTION_MAX} rows={2} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="template-form-check" data-tip={tr('saveTemplate.dayReportTip')}>
            <input type="checkbox" checked={dayReport} onChange={(e) => setDayReport(e.target.checked)} />
            <span>{tr('saveTemplate.dayReport')}</span>
          </label>
          <label className="template-form-check" data-tip={tr('saveTemplate.clearTip')}>
            <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
            <span>{tr('saveTemplate.clear')}</span>
          </label>
          <p className="muted small">{tr('saveTemplate.note')}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            {tr('common.cancel')}
          </button>
          <button type="submit" className="button primary" disabled={busy || !row}>
            {tr('saveTemplate.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

/** *Template settings…* (5.2): la descripción y *Use for day reports*. El nombre es el título de la página. */
export function TemplateSettingsDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const tree = useTree();
  const tr = useT();
  const info = templateInfo(tree.get(pageId));
  const [description, setDescription] = useState(info.description);
  const [dayReport, setDayReport] = useState(info.dayReport);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  const save = async () => {
    const ok = await saveTemplateSettings(tree, pageId, { description, dayReport });
    if (ok) onClose();
    else setError(tr('saveTemplate.tooLong'));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal template-form"
        role="dialog"
        aria-modal="true"
        aria-label={tr('templateSettings.title')}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2>{tr('templateSettings.title')}</h2>
        <div className="template-form-body">
          <label className="template-form-field">
            <span className="pref-label">{tr('saveTemplate.description')}</span>
            <textarea value={description} maxLength={DESCRIPTION_MAX} rows={3} autoFocus onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="template-form-check" data-tip={tr('saveTemplate.dayReportSettingsTip')}>
            <input type="checkbox" checked={dayReport} onChange={(e) => setDayReport(e.target.checked)} />
            <span>{tr('saveTemplate.dayReport')}</span>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            {tr('common.cancel')}
          </button>
          <button type="submit" className="button primary">
            {tr('saveTemplate.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
