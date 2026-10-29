import { useState, type MouseEvent, type ReactNode } from 'react';
import { useT, type Key } from '../i18n';
import { navigate, pagePath } from '../router';
import { useCurrentProject } from '../ui/project';
import { CreateEntityButton } from './EntityActions';
import { shortDate, useGo } from './LiveHeader';
import type { Place } from './liveView';
import type { RowId, StageId, StageLine, StageLink, StageRow } from './sceneStageRows';
import './sceneStages.css';

// Los renglones «Etapa | Tipo: links» de una escena (Docs/Doc_Relaciones.md, sección 23; D783, D784): en la vista de una
// escena del Overview y en la cabecera viva de la página de la escena. Un solo estilo de link para todo: una escena, una
// locación o un día en su color; cualquier otra página en el acento (D774). Solo lee.

const STAGE: Record<StageId, Key> = {
  pre: 'live.preproduction',
  scouting: 'stages.scouting',
  tests: 'stages.tests',
  plan: 'stages.plan',
  shoot: 'live.shoot',
  other: 'stages.other',
};

const TYPE: Record<RowId, Key> = {
  breakdown: 'live.breakdown',
  set: 'stages.set',
  location: 'stages.location',
  question: 'stages.questions',
  scouting: 'stages.reports',
  tests: 'stages.reports',
  plan: 'stages.dayPlan',
  shoot: 'stages.reports',
  other: 'stages.alsoNamed',
};

/** Lo que dice un renglón vacío, por renglón (quien ve una parte del proyecto lee «you can see», D401). */
const NONE: Partial<Record<RowId, [Key, Key]>> = {
  breakdown: ['stages.none.breakdown', 'stages.none.breakdown'],
  location: ['stages.none.location', 'stages.none.locationSeen'],
  scouting: ['stages.none.scouting', 'stages.none.scoutingSeen'],
  plan: ['stages.none.plan', 'stages.none.planSeen'],
  shoot: ['live.noReport', 'live.noReportSeen'],
};

/** Un link: con el clic va (a la página o al bloque exacto, resaltado); con ⌘/Ctrl o el medio, el navegador lo abre aparte. */
function StageA({ link, children }: { link: StageLink; children?: ReactNode }) {
  const go = useGo();
  const tr = useT();
  const t = link.target;
  const text = children ?? (link.label || tr('common.untitled'));
  if (!t) {
    return (
      <>
        <span className="ss-txt">{text}</span>
        {link.create && <CreateHere want={link.create} />}
      </>
    );
  }
  const place: Place | null = t.kind === 'place' ? t.place : null;
  const pageId = t.kind === 'place' ? t.place.pageId : t.pageId;
  const cls = t.kind === 'scene' || t.kind === 'loc' || t.kind === 'day' ? `ss-a ${t.kind}` : 'ss-a';
  return (
    <a
      className={cls}
      href={pagePath(pageId)}
      onClick={(e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        if (place) go(place);
        else navigate(pagePath(pageId));
      }}
    >
      {text}
    </a>
  );
}

/** *Create page* al lado de una locación o un decorado escrito sin página (solo en la cabecera de la escena). */
function CreateHere({ want }: { want: NonNullable<StageLink['create']> }) {
  const tr = useT();
  const projectId = useCurrentProject();
  // El ancla de los recorridos (src/tour/catalog.ts): crear la locación o el decorado desde la escena.
  return (
    <span data-tour={want.kind === 'set' ? 'scene-create-set' : 'scene-create-location'}>
      <CreateEntityButton want={want} projectId={projectId} className="ss-create" label={tr('create.page')} />
    </span>
  );
}

function DayA({ link }: { link: StageLink }) {
  const date = shortDate(link.date ?? null);
  return (
    <StageA link={link}>
      {link.label}
      {date && <span className="ss-date"> · {date}</span>}
    </StageA>
  );
}

const joined = (links: StageLink[]) =>
  links.map((l, i) => (
    <span key={i}>
      {i > 0 && ', '}
      <StageA link={l} />
    </span>
  ));

function Line({ line }: { line: StageLine }) {
  const tr = useT();
  const go = useGo();
  const [open, setOpen] = useState(false);
  if (line.kind === 'links') {
    return (
      <div className="ss-line">
        {joined(line.links)}
        {line.via && <span className="ss-n"> · {tr('live.ofLoc', { loc: line.via })}</span>}
        {line.shots !== undefined && line.shots > 0 && <span className="ss-n"> · {tr('stages.shots', { count: line.shots })}</span>}
        {line.photos !== undefined && line.photos > 0 && <span className="ss-n"> · {tr('live.photoCount', { count: line.photos })}</span>}
      </div>
    );
  }
  if (line.kind === 'path') {
    return (
      <div className="ss-line">
        <DayA link={line.lead} />
        <span className="ss-gt" aria-hidden="true">
          {' › '}
        </span>
        {line.named ? <StageA link={line.links[0]}>{tr('live.namedInText')}</StageA> : joined(line.links)}
        {line.photos !== undefined && line.photos > 0 && <span className="ss-n"> · {tr('live.photoCount', { count: line.photos })}</span>}
      </div>
    );
  }
  if (line.kind === 'question') {
    const where = line.cards > 1 ? tr('live.inCards', { count: line.cards }) : line.shot ?? tr('live.questionOnScene');
    return (
      <div className="ss-line">
        <button className="ss-q" onClick={() => go(line.place)} data-tip={tr('live.questionTip')}>
          <span className="ss-qm" aria-hidden="true">
            ?{' '}
          </span>
          {line.text}
        </button>
        <span className="ss-n">
          {' '}
          · {where}
          {line.more > 0 && <> · +{line.more}</>}
        </span>
      </div>
    );
  }
  return (
    <div className="ss-line">
      <button className="ss-more" aria-expanded={open} onClick={() => setOpen(!open)} data-tip={tr('live.indexPagesTip')}>
        {tr('live.indexPages', { count: line.links.length })} {open ? '▴' : '▾'}
      </button>
      {open && <div className="ss-idx">{joined(line.links)}</div>}
    </div>
  );
}

/** Los renglones. `partial`: quien ve una parte del proyecto (las ausencias dicen «you can see»). */
export function SceneStages({ rows, partial, className }: { rows: StageRow[]; partial: boolean; className?: string }) {
  const tr = useT();
  return (
    <dl className={`ss${className ? ` ${className}` : ''}`}>
      {rows.map((r) => (
        <div key={r.id} className="ss-row" data-row={r.id}>
          <dt className="ss-label">
            <span className="ss-stage">{tr(STAGE[r.stage])}</span>
            <span className="ss-bar" aria-hidden="true">
              {' | '}
            </span>
            <span className="ss-type">{tr(TYPE[r.id])}</span>
          </dt>
          <dd className="ss-val">
            {r.empty === 'reading' ? (
              <span className="ss-none" data-tip={tr('live.readingTip')}>
                {tr('live.reading')}
              </span>
            ) : r.empty === 'none' ? (
              <span className="ss-none">{tr((NONE[r.id] ?? ['stages.none.generic', 'stages.none.generic'])[partial ? 1 : 0])}</span>
            ) : (
              r.lines.map((l, i) => <Line key={i} line={l} />)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
