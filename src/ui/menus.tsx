import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { prefs, usePrefs, type Prefs } from '../prefs';
import { navigate } from '../router';
import { usePermissions, useServices, useSyncStatus, useTree } from '../services';
import { PAGE_SIZES, pageFormat } from './pageFormat';
import { ownSplit, splitEnabled } from './titles';
import {
  DarkIcon,
  DriveIcon,
  FilmIcon,
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
    <div ref={ref} className="menu" role="menu" aria-label="Page actions" style={props.position}>
      {props.onShare && item('Share…', <ShareIcon />, props.onShare)}
      {item('New page inside', <PlusIcon />, props.onNewChild, false, canManage)}
      {item('Rename', <RenameIcon />, props.onRename, false, canEdit)}
      {item('Move to…', <MoveIcon />, props.onMove, false, canManage)}
      <button
        role="menuitem"
        disabled={!canEdit}
        onClick={() => {
          props.onClose();
          props.onFormat();
        }}
      >
        <SheetIcon />
        Page size
        <span className="check">
          {format.size === 'free' ? 'Free' : `${PAGE_SIZES[format.size].label}${format.landscape ? ' ↔' : ''}`}
        </span>
      </button>
      {/* La impresión del navegador con la vista de impresión (se baja aparte; Docs/Doc_Hojas_PDF.md). */}
      <button
        role="menuitem"
        data-tip={'Opens the print dialog with this page size.\nChoose **Save as PDF** to export.'}
        onClick={() => {
          props.onClose();
          const page = { format: { size: format.size, landscape: format.landscape }, media: media.enabled ? media : null };
          void import('./printPage')
            .then((m) => m.printPage(props.pageId, page))
            .catch(() => notify('Printing could not start. Try again.'));
        }}
      >
        <PrintIcon />
        Export PDF / Print
      </button>
      <hr />
      <button
        role="menuitemcheckbox"
        aria-checked={split}
        disabled={!canEdit}
        data-tip={'Pages inside show **064 | Name | Place**\nas a short code and a name'}
        onClick={() => void tree.setSetting(props.pageId, 'split', !split)}
      >
        <span className="split-sample" aria-hidden="true">
          |
        </span>
        Short titles inside
        <span className="check">{split ? 'On' : 'Off'}</span>
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
          Short titles: use the setting from above
        </button>
      )}
      <hr />
      {item('Move to trash', <TrashIcon />, props.onTrash, true, canManage)}
      {!canEdit && perms.known && <p className="menu-note">You can view this page. Ask for edit access to change it.</p>}
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
  const { user, docs, client } = useServices();
  const status = useSyncStatus();
  const pending = usePendingCount();
  const isOwner = !!status.mediaUrl && !!status.ownerId && status.ownerId === user.id;
  const ref = useRef<HTMLDivElement>(null);
  useFloating(ref, onClose, anchor);

  async function signOut() {
    if (docs.hasUnsavedEdits()) {
      alert('Some of your latest edits are not saved on this device yet. Wait until the red warning goes away, then sign out.');
      return;
    }
    if (
      pending > 0 &&
      !confirm(
        `${pending} changes are not uploaded yet. They stay saved on this device and upload the next time you sign in with this account. Sign out anyway?`,
      )
    ) {
      return;
    }
    await client.auth.signOut({ scope: 'local' });
  }

  return (
    <div ref={ref} className="menu account-menu" role="dialog" aria-label="Account" style={position}>
      <div className="account-head">
        <span className="avatar large">{user.email.charAt(0) || '?'}</span>
        <div className="who">
          <strong data-tip={user.email} data-tip-plain data-tip-overflow>
            {user.email}
          </strong>
          <span className="mono-label">Synced to your account</span>
        </div>
      </div>
      <Segmented
        label="Appearance"
        pref="theme"
        tall
        options={[
          { value: 'system', label: 'System', icon: <SystemIcon /> },
          { value: 'light', label: 'Light', icon: <LightIcon /> },
          { value: 'dark', label: 'Dark', icon: <DarkIcon /> },
        ]}
      />
      <Segmented
        label="Text"
        pref="font"
        tall
        options={[
          { value: 'default', label: 'Default', sample: <span className="sample sans">Aa</span> },
          { value: 'editorial', label: 'Editorial', sample: <span className="sample serif">Aa</span> },
        ]}
      />
      <Segmented
        label="Text size"
        pref="textSize"
        options={[
          { value: 'small', label: 'Small' },
          { value: 'normal', label: 'Normal' },
          { value: 'large', label: 'Large' },
        ]}
      />
      <Segmented
        label="Page width"
        pref="pageWidth"
        options={[
          { value: 'normal', label: 'Normal' },
          { value: 'wide', label: 'Wide' },
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
          Members
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
      <button
        className="menu-row"
        onClick={() => {
          onClose();
          navigate('/media-test');
        }}
      >
        <FilmIcon />
        Media test
      </button>
      <button className="menu-row" onClick={() => void signOut()}>
        <SignOutIcon />
        Sign out
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
