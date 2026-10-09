import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { printAsSeen, setPrintAsSeen } from './printAsSeen';
import { t, useT } from '../i18n';
import { linkEditUnavailable } from '../linkMode';
import { importJobFor } from '../import/importJob';
import { prefs, usePrefs, type Prefs } from '../prefs';
import { useOffline, usePermissions, useServices, useSyncStatus, useTree } from '../services';
import { pageFormat, sizeLabel } from './pageFormat';
import { ownSplit, splitEnabled } from './titles';
import {
  AssistantIcon,
  MicIcon,
  CameraIcon,
  DayReportIcon,
  HistoryIcon,
  CollapseAllIcon,
  ContrastIcon,
  DarkIcon,
  ExpandAllIcon,
  ExportIcon,
  DriveIcon,
  HelpIcon,
  InstallIcon,
  LightIcon,
  MembersIcon,
  MoveIcon,
  OfflineMarkIcon,
  PlusIcon,
  PrintIcon,
  RenameIcon,
  SheetIcon,
  ShareIcon,
  SignOutIcon,
  StorageIcon,
  SystemIcon,
  TemplateIcon,
  TrashIcon,
  VideoIcon,
} from './icons';
import { requestTemplates, templateTargetFor } from '../templates/templatesUi';
import { isDayReportFolder, isReportPage } from '../templates/dayReport';
import { requestDayReport, useDayReportFolder } from '../templates/dayReportUi';
import { openSaveTemplate, useSaveTemplateOffer } from '../templates/ownTemplatesUi';
import { offlineSupported, openOffline, openStorage } from './SpaceHost';
import { openExport } from './ExportHost';
import { openHelp } from '../help/helpUi';
import { draftCount, isPhoneLayout, leftUncopied, signOutAccepted } from './commentsUi';
import { collapseControlFor } from './collapseControl';
import { pageCameraFor } from './camera';
import { notify } from './notice';
import { replaceBlocksLeaving } from './replaceUi';
import { usePendingCount } from './usePendingCount';
import { LegalLinks } from './Legal';
import { openInstallDialog, useInstallState } from './install';
import { asAction, tipRows } from './tipRows';
import { askSignOut, askSignOutOthers, openAssistantSettings } from '../assistant/assistantUi';
import { hasAssistantKey } from '../assistant/keyStore';
import { voiceLeftovers } from '../dictation/leftovers';
import { LeaveOutItem, TypeMenuItem, TypeSubmenu } from '../relations/TypeMenu';
import { markFolderHolds } from '../relations/entitySync';

/**
 * Comportamiento común de menús y paneles flotantes: se cierran con Escape o tocando afuera (tocar el
 * botón que los abre lo maneja ese botón), no se salen de la pantalla, llevan el foco adentro al abrirse
 * y lo devuelven al botón al cerrarse. Con `arrows`, las flechas recorren los ítems.
 */
export function useFloating(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  anchor?: HTMLElement | null,
  arrows = false,
  focusFirst = true,
) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onEvent = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') close.current();
        return;
      }
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor?.contains(target)) close.current();
    };
    document.addEventListener('pointerdown', onEvent);
    document.addEventListener('keydown', onEvent);
    return () => {
      document.removeEventListener('pointerdown', onEvent);
      document.removeEventListener('keydown', onEvent);
    };
  }, [ref, anchor]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Solo los menús fijos a la ventana: si no entran abajo del botón, van arriba.
    if (getComputedStyle(el).position === 'fixed' && r.bottom > window.innerHeight - 8) {
      const above = (anchor?.getBoundingClientRect().top ?? window.innerHeight) - 4 - r.height;
      el.style.top = `${Math.max(8, Math.min(above, window.innerHeight - 8 - r.height))}px`;
      el.style.bottom = 'auto';
    }
    // Y si con su ancho real no entra a la derecha (un renglón más largo que el ancho con que se colocó, como «Dejar
    // fuera de las relaciones» con «POR CARPETA», D668), se corre a la izquierda hasta entrar.
    // Una hoja del teléfono (de borde a borde, con `left`/`right` fijados en la hoja de estilos) no se toca. Al correrlo se
    // ensancha (tiene más lugar a su derecha, hasta su tope): si con eso vuelve a pasarse, va pegado al margen (D710).
    if (getComputedStyle(el).position === 'fixed' && r.right > window.innerWidth - 8 && r.width <= window.innerWidth - 16) {
      el.style.left = `${Math.max(8, window.innerWidth - 8 - r.width)}px`;
      if (el.getBoundingClientRect().right > window.innerWidth - 8) el.style.left = '8px';
    }
    if (focusFirst) items(el)[0]?.focus({ preventScroll: true });
    return () => {
      // Si el foco quedó en el menú (o se perdió al desmontarlo), vuelve al botón que lo abrió.
      const active = document.activeElement;
      if (anchor?.isConnected && (!active || active === document.body || el.contains(active))) anchor.focus();
    };
  }, [ref, anchor]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !arrows) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      const list = items(el);
      if (!list.length) return;
      e.preventDefault();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      list[next].focus();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [ref, arrows]);
}

/** El nombre del workspace para mostrar: el suyo o, si no tiene, el host de su dirección (como la lista de workspaces). */
function workspaceLabel(config: { name?: string; url?: string } | undefined): string {
  if (config?.name) return config.name;
  try {
    return new URL(config?.url ?? '').host;
  } catch {
    return config?.url ?? '';
  }
}

function items(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('input, button:not(:disabled), select, [href]')];
}

export interface MenuPosition {
  top?: number;
  bottom?: number;
  left: number;
}

/**
 * El ancho con el que se coloca el menú ⋯ de una página: el renglón más largo es «Dejar fuera de las relaciones» con su
 * estado (unos 280 px en castellano), que va en un solo renglón (D668).
 */
export const PAGE_MENU_WIDTH = 290;

/**
 * Posición de un menú de `width` px abajo de `anchor`; si no entra, `useFloating` lo sube. En una pantalla más angosta que el
 * menú (320 px con el renglón largo de «Dejar fuera de las relaciones», D710), va pegado al margen izquierdo y el menú no pasa
 * del ancho de la pantalla (`PAGE_MENU_MAX`).
 */
export function menuBelow(anchor: Element, width = 240): MenuPosition {
  const r = anchor.getBoundingClientRect();
  const w = Math.min(width, window.innerWidth - 16);
  return { top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) };
}

/** El tope del ancho de un menú de página: nunca más ancho que la pantalla menos sus márgenes. */
export const PAGE_MENU_MAX = 'calc(100vw - 16px)';

export function PageMenu(props: {
  pageId: string;
  position: MenuPosition;
  anchor: HTMLElement | null;
  onClose: () => void;
  onNewChild: () => void;
  onRename: () => void;
  onMove: () => void;
  onFormat: () => void;
  onTrash: () => void;
  /** "Share…": solo si la persona puede compartir esta página. */
  onShare?: () => void;
  /** "Version history" (P.18): solo si la persona lo puede ver (`canSeeHistory`). */
  onHistory?: () => void;
  /** "Assistant" (Doc_Asistente.md, A1): con la página abierta en el editor. */
  onAssistant?: () => void;
  /** *Dictate to report* (Doc_Dictado.md, V1): con la página abierta en el editor. */
  onDictate?: () => void;
}) {
  const tree = useTree();
  const perms = usePermissions();
  // Lo que el servidor rechazaría no se ofrece: editar pide 3; crear, mover y la papelera, 4.
  const canEdit = perms.canEditPage(props.pageId);
  // La fila (título, hoja, títulos cortos, carpeta de reportes): un link con Can edit escribe solo el contenido (E2.4).
  const canEditRow = perms.canEditRow(props.pageId);
  const canManage = perms.canManagePage(props.pageId);
  const format = pageFormat(tree, props.pageId);
  const { media, mediaDb, offline, remote } = useServices();
  // "Available offline" (P.10): marcada ella o una de arriba.
  useOffline();
  const canOffline = !!mediaDb && offlineSupported();
  const offlineMark = canOffline && offline ? offline.markFor('page', props.pageId) : null;
  const ref = useRef<HTMLDivElement>(null);
  useFloating(ref, props.onClose, props.anchor, true);
  const split = splitEnabled(tree, props.pageId);
  const own = ownSplit(tree, props.pageId);
  const tr = useT();
  const collapse = collapseControlFor(props.pageId);
  const counts = collapse?.counts() ?? { headings: 0, collapsed: 0 };
  const [asSeen, setAsSeen] = useState(printAsSeen);
  // Sacar una foto o filmar (camera.ts): en el teléfono, con la página abierta y editable.
  const camera = pageCameraFor(props.pageId);
  // *Apply template…* (Docs/Doc_Plantillas.md, 4.1): solo con la página vacía. Si no está abierta, se abre y se ve allá.
  const templateTarget = templateTargetFor(props.pageId);
  const templateBlocked = !!templateTarget && !templateTarget.empty();
  // El reporte del día (Docs/Doc_Plantillas.md, 6.1 y 6.2): *New day report* en la carpeta de reportes y en sus
  // reportes (con permiso para crear ahí), y marcar o dejar de usar una página como carpeta de reportes.
  const reportFolder = useDayReportFolder(props.pageId);
  const isReportFolder = isDayReportFolder(tree, props.pageId);
  // En un reporte no se ofrece marcarlo como carpeta (casi nadie lo quiere y suma un renglón en cada reporte).
  const thisRow = tree.get(props.pageId);
  const offerReportFolder = isReportFolder || !(thisRow && isReportPage(thisRow, tree));
  // Las plantillas propias (Doc_Plantillas.md, 5.1): guardar esta página como plantilla (una copia en *Templates*).
  const saveOffer = useSaveTemplateOffer(props.pageId);
  // *Type* (Doc_Estructura_Proyecto.md): se elige en el mismo menú, en lugar de sus ítems.
  const [typeOpen, setTypeOpen] = useState(false);

  const item = (label: string, icon: ReactNode, action: () => void, danger = false, enabled = true) => (
    <button
      role="menuitem"
      disabled={!enabled}
      className={danger ? 'danger' : undefined}
      onClick={() => {
        props.onClose();
        action();
      }}
    >
      {icon}
      {label}
    </button>
  );

  if (typeOpen) {
    return (
      <div ref={ref} className="menu" role="menu" aria-label={tr('type.menu')} style={{ ...props.position, maxWidth: PAGE_MENU_MAX }}>
        <TypeSubmenu pageId={props.pageId} onBack={() => setTypeOpen(false)} onClose={props.onClose} />
      </div>
    );
  }

  return (
    <div ref={ref} className="menu" role="menu" aria-label={tr('pageMenu.label')} style={{ ...props.position, maxWidth: PAGE_MENU_MAX }}>
      {props.onShare && item(tr('pageMenu.share'), <ShareIcon />, props.onShare)}
      {camera?.kinds.includes('photo') && item(tr('camera.takePhoto'), <CameraIcon />, () => camera.open('photo'))}
      {camera?.kinds.includes('video') && item(tr('camera.recordVideo'), <VideoIcon />, () => camera.open('video'))}
      {item(tr('pageMenu.newInside'), <PlusIcon />, props.onNewChild, false, canManage)}
      {item(tr('common.rename'), <RenameIcon />, props.onRename, false, canEditRow)}
      {item(tr('pageMenu.move'), <MoveIcon />, props.onMove, false, canManage)}
      {canEdit && (
        <button
          role="menuitem"
          aria-disabled={templateBlocked || undefined}
          data-tip={templateBlocked ? tr('pageMenu.applyTemplateEmpty') : undefined}
          onClick={() => {
            if (templateBlocked) return;
            props.onClose();
            requestTemplates(props.pageId);
          }}
        >
          <TemplateIcon />
          {tr('pageMenu.applyTemplate')}
        </button>
      )}
      {saveOffer.save && (
        <button
          role="menuitem"
          aria-disabled={saveOffer.blocked || undefined}
          data-tip={saveOffer.blocked ? tr('pageMenu.saveAsTemplateBlocked') : undefined}
          onClick={() => {
            if (saveOffer.blocked) return;
            props.onClose();
            openSaveTemplate(props.pageId);
          }}
        >
          <TemplateIcon />
          {tr('pageMenu.saveAsTemplate')}
        </button>
      )}
      {saveOffer.reuse && canEditRow && item(tr('pageMenu.useAsTemplate'), <TemplateIcon />, () => void tree.setSetting(props.pageId, 'template', {}))}
      {reportFolder &&
        item(tr('dayReport.new'), <DayReportIcon />, () => requestDayReport(props.pageId))}
      <button
        role="menuitem"
        disabled={!canEditRow}
        onClick={() => {
          props.onClose();
          props.onFormat();
        }}
      >
        <SheetIcon />
        {tr('pageMenu.pageSize')}
        <span className="check">
          {`${sizeLabel(format.size, tr)}${format.size !== 'free' && format.landscape ? ' ↔' : ''}`}
        </span>
      </button>
      {/* La impresión del navegador con la vista de impresión (se baja aparte; Docs/Doc_Hojas_PDF.md). */}
      <button
        role="menuitem"
        data-tip={tr('pageMenu.printTip')}
        onClick={() => {
          props.onClose();
          const page = { format: { size: format.size, landscape: format.landscape }, media: media.enabled ? media : null };
          void import('./printPage')
            .then((m) => m.printPage(props.pageId, page))
            .catch(() => notify(t('pageMenu.printFailed')));
        }}
      >
        <PrintIcon />
        {tr('pageMenu.print')}
      </button>
      {/* Un solo PDF con esta página y las de adentro, con índice (P.22, Docs/Doc_Exportar.md). Quien ve, exporta. */}
      <button
        role="menuitem"
        data-tip={tr('pageMenu.exportTip')}
        onClick={() => {
          props.onClose();
          openExport('page', props.pageId);
        }}
      >
        <ExportIcon />
        {tr('pageMenu.export')}
      </button>
      {/* El asistente (Docs/Doc_Asistente.md, A1): corregir, mejorar, acortar o traducir lo elegido. */}
      {props.onAssistant && (
        <button
          role="menuitem"
          data-tip={tipRows([{ shortcut: 'assistant', action: asAction(tr('pageMenu.assistant')) }])}
          onClick={() => {
            props.onClose();
            props.onAssistant?.();
          }}
        >
          <AssistantIcon />
          {tr('pageMenu.assistant')}
        </button>
      )}
      {/* Dictar al reporte (Docs/Doc_Dictado.md, V1): una nota informal que el asistente ubica en la página. */}
      {props.onDictate && (
        <button
          role="menuitem"
          data-tip={tipRows([{ shortcut: 'dictate', action: asAction(tr('pageMenu.dictate')) }])}
          onClick={() => {
            props.onClose();
            props.onDictate?.();
          }}
        >
          <MicIcon />
          {tr('pageMenu.dictate')}
        </button>
      )}
      {/* El historial de versiones (P.18, Docs/Doc_Historial.md): quién cambió la página, cuándo, y restaurar. */}
      {props.onHistory && (
        <button
          role="menuitem"
          data-tip={tipRows([{ shortcut: 'history', action: asAction(tr('pageMenu.history')) }])}
          onClick={() => {
            props.onClose();
            props.onHistory?.();
          }}
        >
          <HistoryIcon />
          {tr('pageMenu.history')}
        </button>
      )}
      {/* El PDF sale con todo abierto; con esto, como se ve (solo con algo colapsado; Doc_Colapsar.md, sección 7). */}
      {collapse && counts.collapsed > 0 && (
        <button
          role="menuitemcheckbox"
          aria-checked={asSeen}
          data-tip={tr('pageMenu.printAsSeenTip')}
          onClick={() => {
            setPrintAsSeen(!asSeen);
            setAsSeen(!asSeen);
          }}
        >
          <CollapseAllIcon />
          {tr('pageMenu.printAsSeen')}
          <span className="check">{asSeen ? tr('common.on') : tr('common.off')}</span>
        </button>
      )}
      {/* Bajar la página con sus subpáginas para usarla sin conexión (P.10, Docs/Doc_Copias_Locales.md). */}
      {canOffline && (
        <button
          role="menuitem"
          onClick={() => {
            props.onClose();
            openOffline('page', props.pageId);
          }}
        >
          <OfflineMarkIcon />
          {tr('pageMenu.offline')}
          {offlineMark && <span className="check">{tr('common.on')}</span>}
        </button>
      )}
      {/* Colapsar todos los títulos, o abrirlos, para vos: solo la página abierta (P.11, Doc_Colapsar.md). */}
      {collapse && counts.headings > 0 && item(tr('pageMenu.collapseAll'), <CollapseAllIcon />, () => collapse.setAll(true))}
      {collapse &&
        counts.headings > 0 &&
        item(tr('pageMenu.expandAll'), <ExpandAllIcon />, () => collapse.setAll(false), false, counts.collapsed > 0)}
      <hr />
      <button
        role="menuitemcheckbox"
        aria-checked={split}
        disabled={!canEditRow}
        data-tip={tr('pageMenu.shortTitlesTip')}
        onClick={() => void tree.setSetting(props.pageId, 'split', !split)}
      >
        <span className="split-sample" aria-hidden="true">
          |
        </span>
        {tr('pageMenu.shortTitles')}
        <span className="check">{split ? tr('common.on') : tr('common.off')}</span>
      </button>
      {own && canEditRow && (
        <button
          role="menuitem"
          onClick={() => {
            props.onClose();
            void tree.setSetting(props.pageId, 'split', undefined);
          }}
        >
          <span className="split-sample" aria-hidden="true" />
          {tr('pageMenu.shortTitlesInherit')}
        </button>
      )}
      {/* La carpeta de reportes a mano (6.2): puede haber varias (una por unidad). Dejarla gana sobre lo deducido. */}
      {canEditRow && offerReportFolder && (
        <button
          role="menuitem"
          data-tip={isReportFolder ? undefined : tr('pageMenu.useForDayReportsTip')}
          onClick={() => {
            props.onClose();
            // Lo mismo que *Type* → *Shoot days* / *Nothing in particular*: una sola marca (D369, D372).
            void markFolderHolds(tree, props.pageId, isReportFolder ? null : 'day');
          }}
        >
          <DayReportIcon />
          {isReportFolder ? tr('pageMenu.stopDayReports') : tr('pageMenu.useForDayReports')}
        </button>
      )}
      {canEditRow && <TypeMenuItem pageId={props.pageId} onOpen={() => setTypeOpen(true)} />}
      {canEditRow && <LeaveOutItem pageId={props.pageId} onClose={props.onClose} />}
      <hr />
      {item(tr('pageMenu.trash'), <TrashIcon />, props.onTrash, true, canManage)}
      {!canEdit && perms.known && (
        <p className="menu-note">{tr(!perms.viaLink ? 'page.viewOnly' : linkEditUnavailable(remote) ? 'link.readOnlyEditOff' : 'link.readOnly')}</p>
      )}
    </div>
  );
}

/**
 * Un selector de una preferencia. Con `icons`, cada opción es solo su ícono (Appearance, Font, Contrast): el nombre va
 * en el tooltip y en `aria-label`, y el rótulo queda a la izquierda en el mismo renglón (así el panel no crece).
 */
function Segmented<K extends keyof Prefs>(props: {
  label: string;
  pref: K;
  options: { value: Prefs[K]; label: string; icon?: ReactNode; sample?: ReactNode }[];
  icons?: boolean;
}) {
  const current = usePrefs()[props.pref];
  const id = `pref-${props.pref}`;
  return (
    <div className={props.icons ? 'pref pref-icons' : 'pref'}>
      <span className="pref-label" id={id}>
        {props.label}
      </span>
      <div className="segmented" role="group" aria-labelledby={id}>
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={current === o.value}
            aria-label={props.icons ? o.label : undefined}
            data-tip={props.icons ? o.label : undefined}
            onClick={() => prefs.set({ [props.pref]: o.value } as Partial<Prefs>)}
          >
            {o.icon}
            {o.sample}
            {!props.icons && o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * El alto del panel de la cuenta: lo que queda en la ventana desde donde se apoya (abajo, el botón de la cuenta) con
 * 8 px de margen. Con más contenido, el panel se recorre adentro (`.account-menu`) en vez de salirse por arriba.
 */
export function accountMaxHeight(position: MenuPosition): string | undefined {
  const edge = position.bottom ?? position.top;
  return edge === undefined ? undefined : `calc(100dvh - ${Math.max(0, Math.round(edge)) + 8}px)`;
}

/**
 * La pregunta antes de cerrar la sesión con algo que solo está en este dispositivo. `pending`: lo que falta subir.
 * `rejected`: lo que el servidor rechazó (cambios del árbol, archivos, comentarios) y las ediciones de comentarios
 * apartadas por un conflicto. `writing`: los cuadros de comentarios con algo escrito sin mandar, que al salir se
 * pierden (viven solo en su cuadro), y lo que quedó sin copiar en el cartel de `LeftDrafts.tsx` (ver `unsentCount`).
 * Solo con lo pendiente, el texto de siempre.
 */
export function signOutQuestion(pending: number, rejected: number, writing = 0): string {
  if (rejected === 0 && writing === 0) return t('account.signOutPending', { count: pending });
  const parts: string[] = [];
  if (pending > 0) parts.push(t('account.signOutNotUploaded', { count: pending }));
  if (rejected > 0) parts.push(t('account.signOutRejected', { count: rejected }));
  if (writing > 0) parts.push(t('comments.draftUnsent', { count: writing }));
  parts.push(t('account.signOutAnyway'));
  return parts.join(' ');
}

/**
 * Lo que se pierde al salir de la cuenta sin estar en ningún lado: los cuadros con algo escrito y lo que quedó en el
 * cartel sin copiar (LeftDrafts.tsx). La misma oración en la pregunta de salir, para las dos cosas.
 */
export function unsentCount(): number {
  return draftCount() + leftUncopied();
}

/**
 * Salir de la cuenta desde una pantalla sin la app (el error del arranque, la de «sacaron a la persona»): con lo que
 * quedó sin copiar en el cartel de lo que se cerró solo (LeftDrafts.tsx), pregunta antes, con la oración de un
 * comentario a medio escribir; con el «sí», el cartel se descarta (después podría entrar otra cuenta).
 */
export function signOutHere(run: () => Promise<unknown>): void {
  const writing = unsentCount();
  if (writing > 0 && !confirm(signOutQuestion(0, 0, writing))) return;
  void signOutAccepted(run);
}

export function AccountMenu({
  position,
  anchor,
  onClose,
  onDrive,
  onMembers,
}: {
  position: MenuPosition;
  anchor: HTMLElement | null;
  onClose: () => void;
  /** Abre "Google Drive" (la conexión y la carpeta); solo se ofrece al dueño de un workspace con portero. */
  onDrive?: () => void;
  /** Abre "Members"; solo se ofrece al dueño y a los admins. */
  onMembers?: () => void;
}) {
  const perms = usePermissions();
  const { user, docs, client, tree, mediaDb, workspace } = useServices();
  const status = useSyncStatus();
  const pending = usePendingCount();
  const isOwner = !!status.mediaUrl && !!status.ownerId && status.ownerId === user.id;
  const { installed } = useInstallState();
  const ref = useRef<HTMLDivElement>(null);
  const tr = useT();
  useFloating(ref, onClose, anchor);

  async function signOut() {
    if (replaceBlocksLeaving()) return;
    if (importJobFor(tree).get().running) {
      alert(t('import.running'));
      return;
    }
    if (docs.hasUnsavedEdits()) {
      alert(t('account.signOutUnsaved'));
      return;
    }
    // También lo que el servidor rechazó y las ediciones de comentarios que esperan decisión (cuentan con lo
    // rechazado): quedan en este dispositivo, y la persona se entera antes de salir.
    const rejected = status.failedOps + status.failedMedia + status.failedComments;
    // Y un comentario a medio escribir: vive solo en su cuadro y al salir se pierde sin dónde avisarlo (la pantalla que
    // muestra los avisos se desmonta). Va en la misma pregunta, una sola.
    // Lo mismo con lo que quedó sin copiar en el cartel de lo que se cerró solo: otra cuenta podría entrar después.
    const writing = unsentCount();
    if ((pending > 0 || rejected > 0 || writing > 0) && !confirm(signOutQuestion(pending, rejected, writing))) return;
    // El «sí» se anota y el cartel se descarta recién cuando la salida se ejecuta (`signOutAccepted`): cancelar la
    // ventana de salir de abajo deja todo como estaba.
    const leave = () => signOutAccepted(() => client.auth.signOut({ scope: 'local' }));
    // Con una clave del asistente o de *Voice* guardada en este dispositivo, la ventana de salir ofrece olvidarla
    // (Doc_Asistente.md, 4); con notas de voz sin ubicar, las cuenta y ofrece borrarlas (Doc_Dictado.md, 8).
    const wsKey = workspace.config.localKey || workspace.config.url;
    const left = await voiceLeftovers(user.email, wsKey).catch(() => ({ notes: 0, voiceKey: false }));
    if ((await hasAssistantKey(user.email)) || left.notes > 0 || left.voiceKey) {
      onClose();
      askSignOut(user.email, leave, wsKey);
      return;
    }
    await leave();
  }

  return (
    <div ref={ref} className="menu account-menu" role="dialog" aria-label={tr('account.label')} style={{ ...position, maxHeight: accountMaxHeight(position) }}>
      <div className="account-head">
        <span className="avatar large">{user.email.charAt(0) || '?'}</span>
        <div className="who">
          <strong data-tip={user.email} data-tip-plain data-tip-overflow>
            {user.email}
          </strong>
          <span className="mono-label">{tr('account.synced')}</span>
        </div>
      </div>
      <Segmented
        label={tr('account.appearance')}
        pref="theme"
        icons
        options={[
          { value: 'system', label: tr('account.theme.system'), icon: <SystemIcon /> },
          { value: 'light', label: tr('account.theme.light'), icon: <LightIcon /> },
          { value: 'dark', label: tr('account.theme.dark'), icon: <DarkIcon /> },
        ]}
      />
      <Segmented
        label={tr('account.font')}
        pref="font"
        icons
        options={[
          { value: 'default', label: tr('account.font.default'), sample: <span className="sample sans">Aa</span> },
          { value: 'editorial', label: tr('account.font.editorial'), sample: <span className="sample serif">Aa</span> },
        ]}
      />
      {/* El contraste del texto del documento (Docs/Doc_Contraste.md): encabezado, negrita y texto común. */}
      <Segmented
        label={tr('account.contrast')}
        pref="contrast"
        icons
        options={[
          { value: 'none', label: tr('account.contrast.none'), icon: <ContrastIcon level="none" /> },
          { value: 'contrast', label: tr('account.contrast.contrast'), icon: <ContrastIcon level="contrast" /> },
          { value: 'more', label: tr('account.contrast.more'), icon: <ContrastIcon level="more" /> },
        ]}
      />
      <Segmented
        label={tr('account.textSize')}
        pref="textSize"
        options={[
          { value: 'small', label: tr('account.textSize.small') },
          { value: 'normal', label: tr('account.textSize.normal') },
          { value: 'large', label: tr('account.textSize.large') },
        ]}
      />
      <Segmented
        label={tr('account.pageWidth')}
        pref="pageWidth"
        options={[
          { value: 'normal', label: tr('account.pageWidth.normal') },
          { value: 'wide', label: tr('account.pageWidth.wide') },
        ]}
      />
      {/* Solo en el teléfono: las fotos en fila se ven en fila o una debajo de la otra (Doc_Imagenes.md). */}
      {isPhoneLayout() && (
        <Segmented
          label={tr('account.phoneImages')}
          pref="phoneImages"
          options={[
            { value: 'rows', label: tr('account.phoneImages.rows') },
            { value: 'stacked', label: tr('account.phoneImages.stacked') },
          ]}
        />
      )}
      <Segmented
        label={tr('account.expandSubpages')}
        pref="expandSubpages"
        options={[
          { value: 'manual', label: tr('account.expandSubpages.manual') },
          { value: 'onClick', label: tr('account.expandSubpages.onClick') },
        ]}
      />
      {/* Cada idioma con su propio nombre, así se encuentra aunque la app esté en el otro. */}
      <Segmented
        label={tr('account.language')}
        pref="language"
        options={[
          { value: 'en', label: 'English' },
          { value: 'es', label: 'Español' },
        ]}
      />
      <div className="pref-divider" />
      {perms.canManageMembers && onMembers && (
        <button
          className="menu-row"
          onClick={() => {
            onClose();
            onMembers();
          }}
        >
          <MembersIcon />
          {tr('members.title')}
        </button>
      )}
      {isOwner && onDrive && (
        <button
          className="menu-row"
          onClick={() => {
            onClose();
            onDrive();
          }}
        >
          <DriveIcon />
          Google Drive
        </button>
      )}
      {mediaDb && offlineSupported() && (
        <button
          className="menu-row"
          onClick={() => {
            onClose();
            openStorage();
          }}
        >
          <StorageIcon />
          {tr('account.storage')}
        </button>
      )}
      {/* El asistente (Docs/Doc_Asistente.md, A1): el proveedor, la clave (solo en este dispositivo) y el modelo. */}
      <button
        className="menu-row"
        onClick={() => {
          onClose();
          openAssistantSettings();
        }}
      >
        <AssistantIcon />
        {tr('account.assistant')}
      </button>
      {/* La ayuda (Docs/Doc_Tutorial.md, sección 5): el foco vuelve al botón de la cuenta al cerrarla. */}
      <button
        className="menu-row"
        onClick={() => {
          onClose();
          openHelp(null, anchor);
        }}
      >
        <HelpIcon />
        {tr('help.open')}
      </button>
      {/* Instalar la app: solo mientras esta pestaña no es la app instalada (Doc_Instalar.md). */}
      {!installed && (
        <button
          className="menu-row"
          data-tip={tr('install.menuTip')}
          onClick={() => {
            onClose();
            openInstallDialog();
          }}
        >
          <InstallIcon />
          {tr('install.menu')}
        </button>
      )}
      {/* Para un dispositivo perdido (Docs/Doc_Clave_Sincronizada.md, S1): esta sesión sigue, las otras se cierran. */}
      <button
        className="menu-row"
        onClick={() => {
          onClose();
          askSignOutOthers(workspaceLabel(workspace?.config), () => client.auth.signOut({ scope: 'others' }));
        }}
      >
        <SignOutIcon />
        {tr('account.signOutOthers')}
      </button>
      <button className="menu-row" onClick={() => void signOut()}>
        <SignOutIcon />
        {tr('common.signOut')}
      </button>
      {/* La versión de la app (así se ve enseguida si este dispositivo ya tiene la última) y los links a la
          política de privacidad y las condiciones, en otra pestaña. */}
      <div className="menu-foot">
        {__APP_VERSION__ && <p className="mono-label menu-version">v{__APP_VERSION__}</p>}
        <LegalLinks />
      </div>
    </div>
  );
}
