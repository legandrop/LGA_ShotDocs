import { useState } from 'react';
import { useT } from '../i18n';
import '../i18n/lazy/help';
import { CATALOG_ERRORS, chaptersOf, stepsOf, TOURS, tourById, tourMinutes, type ChapterDef, type TourDef } from '../tour/catalog';
import { chapterState, clearCursor, cursorOf, readProgress, type Progress } from '../tour/progress';
import { isPhoneLayout } from '../ui/commentsUi';
import { useThinScroll } from './thinScroll';

// La pestaña *Tours* de la ayuda (Docs/Plan_Proyecto_Desde_Cero.md, sección 5; como el Help de las apps LGA de
// escritorio): a la izquierda (arriba en el teléfono) los recorridos con sus capítulos, sus minutos y lo visto; a la
// derecha el elegido, con el índice de capítulos (pendiente, visto, acá quedaste, actualizado, próximamente) y
// *Continue · Ch. N* / *Start* / *Start over* / *Go to chapter*. El progreso es del dispositivo, por id y versión de
// capítulo (src/tour/progress.ts): se lee al abrir la ayuda, porque el documento de práctica pudo escribirlo.

const isSeen = (p: Progress, c: ChapterDef) => !!p.seen[c.id]?.[String(c.version)];

/** Dónde seguir: el cursor guardado, si su capítulo todavía existe y tiene pasos. */
function resumeAt(p: Progress, tour: TourDef): { chapter: ChapterDef; step: string } | null {
  const at = cursorOf(tour.id, p);
  const chapter = at ? chaptersOf(tour).find((c) => c.id === at.chapter) : undefined;
  if (!at || !chapter || chapter.steps.length === 0) return null;
  return { chapter, step: chapter.steps.some((s) => s.id === at.step) ? at.step : '' };
}

export function ToursTab({ onLaunch }: { onLaunch: (tour: string, chapter: string, step: string) => void }) {
  const tr = useT();
  const lang = tr.lang;
  const [progress, setProgress] = useState(readProgress);
  // Abre en el recorrido que quedó a medias, si hay uno; si no, en el primero.
  const [selected, setSelected] = useState(() => TOURS.find((t) => resumeAt(progress, t))?.id ?? TOURS[0].id);
  const [row, setRow] = useState<string | null>(null);
  const listScroll = useThinScroll();
  const detailScroll = useThinScroll();
  const phone = isPhoneLayout();
  const tour = tourById(selected) ?? TOURS[0];
  const chapters = chaptersOf(tour);
  const playable = chapters.filter((c) => stepsOf(c, phone).length > 0);
  const resume = resumeAt(progress, tour);
  const number = (id: string) => tour.chapters.indexOf(id) + 1;
  const broken = CATALOG_ERRORS.length > 0;

  const go = (chapter: string, step = '') => {
    if (!broken) onLaunch(tour.id, chapter, step);
  };
  const startOver = () => {
    clearCursor(tour.id);
    setProgress(readProgress());
    go('');
  };
  // *Go to chapter* solo cuando no repite a *Continue* o a *Start*.
  const first = playable[0]?.id;
  const goTo = row && row !== resume?.chapter.id && !(row === first && !resume) ? row : null;

  return (
    <div className="help-tours">
      <ul className="help-tour-list help-scroll" aria-label={tr('help.tab.tours')} {...listScroll}>
        {TOURS.map((t) => {
          // Sobre todos los capítulos, también los que todavía no tienen pasos: la barra no se llena con lo que falta.
          const list = chaptersOf(t);
          const seen = list.filter((c) => isSeen(progress, c)).length;
          const done = list.length > 0 && seen === list.length;
          return (
            <li key={t.id}>
              <button
                className={`help-tour${t.id === tour.id ? ' selected' : ''}`}
                aria-current={t.id === tour.id ? 'true' : undefined}
                onClick={() => {
                  setSelected(t.id);
                  setRow(null);
                }}
              >
                <strong>{t.title[lang]}</strong>
                <span className="help-tour-meta">
                  {tr('help.tours.chapters', { count: t.chapters.length })} · {tr('help.tours.minutes', { m: tourMinutes(t) })}
                </span>
                <span className={`help-tour-bar${done ? ' done' : ''}`} aria-hidden="true">
                  <span style={{ width: `${list.length ? (100 * seen) / list.length : 0}%` }} />
                </span>
                <span className="help-tour-seen">{tr('help.tours.seenOf', { n: seen, total: list.length })}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <section className="help-tour-detail help-scroll" aria-labelledby="help-tour-title" {...detailScroll}>
        <h3 id="help-tour-title">{tour.title[lang]}</h3>
        <p className="help-tour-summary">{tour.summary[lang]}</p>
        <ol className="help-chapters">
          {chapters.map((c) => {
            const soon = stepsOf(c, phone).length === 0;
            const state = chapterState(progress, tour.id, c);
            const label = soon ? tr('help.tours.state.soon') : state === 'here' ? tr('help.tours.state.here') : state === 'seen' ? tr('help.tours.state.seen') : state === 'updated' ? tr('help.tours.state.updated') : '';
            return (
              <li key={c.id}>
                <button
                  className={`help-chapter ${soon ? 'soon' : state}${row === c.id ? ' chosen' : ''}`}
                  disabled={soon}
                  aria-pressed={row === c.id}
                  data-chapter={c.id}
                  onClick={() => setRow(c.id)}
                  onDoubleClick={() => go(c.id)}
                >
                  <span className={`help-chapter-n${isSeen(progress, c) ? ' seen' : ''}`}>{isSeen(progress, c) ? '✓' : number(c.id)}</span>
                  <span className="help-chapter-text">
                    <span className="help-chapter-title">{c.title[lang]}</span>
                    <span className="help-chapter-summary">{c.summary[lang]}</span>
                  </span>
                  {label && <span className="help-chapter-state">{label}</span>}
                  <span className="help-chapter-min">{tr('help.tours.minutes', { m: c.minutes })}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="help-tour-actions">
          {resume ? (
            <button className="primary" disabled={broken} onClick={() => go(resume.chapter.id, resume.step)}>
              {tr('help.tours.continue', { n: number(resume.chapter.id), title: resume.chapter.title[lang] })}
            </button>
          ) : (
            <button className="primary" disabled={broken || !first} onClick={() => go('')}>
              {tr('help.tours.start')}
            </button>
          )}
          {goTo && (
            <button className="secondary" disabled={broken} onClick={() => go(goTo)}>
              {tr('help.tours.goTo', { n: number(goTo) })}
            </button>
          )}
          {resume && (
            <button className="link" disabled={broken} onClick={startOver}>
              {tr('help.tours.startOver')}
            </button>
          )}
        </div>
        <p className="muted help-tour-note">{tour.where === 'doc' ? tr('help.tours.noteDoc') : tr('help.tours.noteApp')}</p>
        {broken && <p className="help-reason">{tr('help.tours.broken', { reason: CATALOG_ERRORS[0] })}</p>}
      </section>
    </div>
  );
}
