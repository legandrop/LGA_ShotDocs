import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { printAsSeen, setPrintAsSeen } from './printAsSeen';
import { t, useT } from '../i18n';
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
import { isPhoneLayout } from './commentsUi';
import { collapseControlFor } from './collapseControl';
import { pageCameraFor } from './camera';
import { notify } from './notice';
import { replaceBlocksLeaving } from './replaceUi';
import { usePendingCount } from './usePendingCount';
import { LegalLinks } from './Legal';
import { openInstallDialog, useInstallState } from './install';
import { shortcutLabel } from './shortcuts';
import { askSignOut, askSignOutOthers, openAssistantSettings } from '../assistant/assistantUi';
import { hasAssistantKey } from '../assistant/keyStore';

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

function items(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('input, button:not(:disabled), select, [href]')];
}

export interface MenuPosition {
  top?: number;
  bottom?: number;
  left: number;
}

/** Posición de un menú de `width` px abajo de `anchor`; si no entra, `useFloating` lo sube. */
export function menuBelow(anchor: Element, width = 240): MenuPosition {
  const r = anchor.getBoundingClientRect();
  return { top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) };
}

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
  const canManage = perms.canManagePage(props.pageId);
  const format = pageFormat(tree, props.pageId);
  const { media, mediaDb, offline } = useServices();
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

  return (
    <div ref={ref} className="menu" role="menu" aria-label={tr('pageMenu.label')} style={props.position}>
      {props.onShare && item(tr('pageMenu.share'), <ShareIcon />, props.onShare)}
      {camera?.kinds.includes('photo') && item(tr('camera.takePhoto'), <CameraIcon />, () => camera.open('photo'))}
      {camera?.kinds.includes('video') && item(tr('camera.recordVideo'), <VideoIcon />, () => camera.open('video'))}
      {item(tr('pageMenu.newInside'), <PlusIcon />, props.onNewChild, false, canManage)}
      {item(tr('common.rename'), <RenameIcon />, props.onRename, false, canEdit)}
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
      {saveOffer.reuse && item(tr('pageMenu.useAsTemplate'), <TemplateIcon />, () => void tree.setSetting(props.pageId, 'template', {}))}
      {reportFolder &&
        item(tr('dayReport.new'), <DayReportIcon />, () => requestDayReport(props.pageId))}
      <button
        role="menuitem"
        disabled={!canEdit}
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
          data-tip={shortcutLabel('assistant')}
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
          data-tip={shortcutLabel('dictate')}
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
          data-tip={shortcutLabel('history')}
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
        disabled={!canEdit}
        data-tip={tr('pageMenu.shortTitlesTip')}
        onClick={() => void tree.setSetting(props.pageId, 'split', !split)}
      >
        <span className="split-sample" aria-hidden="true">
          |
        </span>
        {tr('pageMenu.shortTitles')}
        <span className="check">{split ? tr('common.on') : tr('common.off')}</span>
      </button>
      {own && canEdit && (
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
      {canEdit && offerReportFolder && (
        <button
          role="menuitem"
          data-tip={isReportFolder ? undefined : tr('pageMenu.useForDayReportsTip')}
          onClick={() => {
            props.onClose();
            void tree.setSetting(props.pageId, 'dayReports', isReportFolder ? false : {});
          }}
        >
          <DayReportIcon />
          {isReportFolder ? tr('pageMenu.stopDayReports') : tr('pageMenu.useForDayReports')}
        </button>
      )}
      <hr />
      {item(tr('pageMenu.trash'), <TrashIcon />, props.onTrash, true, canManage)}
      {!canEdit && perms.known && <p className="menu-note">{tr('page.viewOnly')}</p>}
    </div>
  );
}

function Segmented<K extends keyof Prefs>(props: {
  label: string;
  pref: K;
  options: { value: Prefs[K]; label: string; icon?: ReactNode; sample?: ReactNode }[];
  tall?: boolean;
}) {
  const current = usePrefs()[props.pref];
  const id = `pref-${props.pref}`;
  return (
    <div className="pref">
      <span className="pref-label" id={id}>
        {props.label}
      </span>
      <div className="segmented" role="group" aria-labelledby={id}>
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={props.tall ? 'tall' : undefined}
            aria-pressed={current === o.value}
            onClick={() => prefs.set({ [props.pref]: o.value } as Partial<Prefs>)}
          >
            {o.icon}
            {o.sample}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
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
    if (
      pending > 0 &&
      !confirm(t('account.signOutPending', { count: pending }))
    ) {
      return;
    }
    // Con una clave del asistente guardada en este dispositivo, la ventana de salir ofrece olvidarla (Doc_Asistente.md, 4).
    if (await hasAssistantKey(user.email)) {
      onClose();
      askSignOut(user.email, () => client.auth.signOut({ scope: 'local' }));
      return;
    }
    await client.auth.signOut({ scope: 'local' });
  }

  return (
    <div ref={ref} className="menu account-menu" role="dialog" aria-label={tr('account.label')} style={position}>
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
        tall
        options={[
          { value: 'system', label: tr('account.theme.system'), icon: <SystemIcon /> },
          { value: 'light', label: tr('account.theme.light'), icon: <LightIcon /> },
          { value: 'dark', label: tr('account.theme.dark'), icon: <DarkIcon /> },
        ]}
      />
      <Segmented
        label={tr('account.font')}
        pref="font"
        tall
        options={[
          { value: 'default', label: tr('account.font.default'), sample: <span className="sample sans">Aa</span> },
          { value: 'editorial', label: tr('account.font.editorial'), sample: <span className="sample serif">Aa</span> },
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
          askSignOutOthers(workspace?.config.name || '', () => client.auth.signOut({ scope: 'others' }));
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
