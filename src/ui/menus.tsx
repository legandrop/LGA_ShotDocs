import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { printAsSeen, setPrintAsSeen } from './printAsSeen';
import { t, useT } from '../i18n';
import { importJobFor } from '../import/importJob';
import { prefs, usePrefs, type Prefs } from '../prefs';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import { pageFormat, sizeLabel } from './pageFormat';
import { ownSplit, splitEnabled } from './titles';
import {
  CollapseAllIcon,
  ConvertPhotosIcon,
  DarkIcon,
  ExpandAllIcon,
  DriveIcon,
  LightIcon,
  MembersIcon,
  MoveIcon,
  PlusIcon,
  PrintIcon,
  RenameIcon,
  SheetIcon,
  ShareIcon,
  SignOutIcon,
  SystemIcon,
  TrashIcon,
} from './icons';
import { isPhoneLayout } from './commentsUi';
import { collapseControlFor } from './collapseControl';
import { convertControlFor } from './convertControl';
import { notify } from './notice';
import { usePendingCount } from './usePendingCount';
import { LegalLinks } from './Legal';

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
}) {
  const tree = useTree();
  const perms = usePermissions();
  // Lo que el servidor rechazaría no se ofrece: editar pide 3; crear, mover y la papelera, 4.
  const canEdit = perms.canEditPage(props.pageId);
  const canManage = perms.canManagePage(props.pageId);
  const format = pageFormat(tree, props.pageId);
  const { media } = useServices();
  const ref = useRef<HTMLDivElement>(null);
  useFloating(ref, props.onClose, props.anchor, true);
  const split = splitEnabled(tree, props.pageId);
  const own = ownSplit(tree, props.pageId);
  const tr = useT();
  const collapse = collapseControlFor(props.pageId);
  const counts = collapse?.counts() ?? { headings: 0, collapsed: 0 };
  const [asSeen, setAsSeen] = useState(printAsSeen);
  const convert = canEdit ? convertControlFor(props.pageId) : null;
  const toConvert = convert?.count() ?? 0;

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
      {item(tr('pageMenu.newInside'), <PlusIcon />, props.onNewChild, false, canManage)}
      {item(tr('common.rename'), <RenameIcon />, props.onRename, false, canEdit)}
      {item(tr('pageMenu.move'), <MoveIcon />, props.onMove, false, canManage)}
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
      {/* Colapsar todos los títulos, o abrirlos, para vos: solo la página abierta (P.11, Doc_Colapsar.md). */}
      {collapse && counts.headings > 0 && item(tr('pageMenu.collapseAll'), <CollapseAllIcon />, () => collapse.setAll(true))}
      {collapse &&
        counts.headings > 0 &&
        item(tr('pageMenu.expandAll'), <ExpandAllIcon />, () => collapse.setAll(false), false, counts.collapsed > 0)}
      {/* Las fotos-bloque de la página pasan a ser fotos en línea (entrega 3, Doc_Fotos_En_Linea.md): solo si hay. */}
      {convert && toConvert > 0 && (
        <button
          role="menuitem"
          data-tip={tr('pageMenu.convertPhotosTip', { count: toConvert })}
          onClick={() => {
            props.onClose();
            convert.convert();
          }}
        >
          <ConvertPhotosIcon />
          {tr('pageMenu.convertPhotos')}
        </button>
      )}
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
  const { user, docs, client, tree } = useServices();
  const status = useSyncStatus();
  const pending = usePendingCount();
  const isOwner = !!status.mediaUrl && !!status.ownerId && status.ownerId === user.id;
  const ref = useRef<HTMLDivElement>(null);
  const tr = useT();
  useFloating(ref, onClose, anchor);

  async function signOut() {
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
