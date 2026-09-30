import type { BlockNoteEditor } from '@blocknote/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView, ViewMutationRecord } from '@tiptap/pm/view';
import { t } from '../i18n';
import { driveOpenUrl, drivePreviewUrl, parseDriveLink, sameDriveLink, type DriveLink } from './driveLinks';

// --- Tarjeta de Drive --------------------------------------------------------------------------------
//
// Un link de Drive que se ve como una tarjeta con el reproductor de Drive (paso 13 de
// Docs/Plan_Workspaces.md). NO es un tipo de bloque nuevo: es un párrafo con el link y `driveCard: true`.
// Una versión de la app que no conoce la propiedad muestra el párrafo con el link; si alguien edita esa
// línea en la versión vieja, se pierde solo la propiedad y queda el link (Docs/Doc_Sincronizacion.md,
// "Links de Drive").
//
// El reproductor sale del link del párrafo (el primero que sea de Drive y tenga un id válido); si no hay
// ninguno, el párrafo se ve común. El texto del párrafo (el link) es el pie de la tarjeta y se sigue
// editando como cualquier texto. El reproductor anda si quien mira tiene acceso al archivo con su cuenta de
// Google (Drive lo resuelve adentro del iframe; la app no ve nada de eso).

export const DRIVE_CARD_PROP = 'driveCard';

/** El primer link de Drive válido del contenido de un bloque (formato de BlockNote). */
export function driveLinkInContent(content: unknown): DriveLink | null {
  if (!Array.isArray(content)) return null;
  for (const item of content as { type?: string; href?: string }[]) {
    if (item?.type !== 'link') continue;
    const link = parseDriveLink(item.href);
    if (link) return link;
  }
  return null;
}

/** El primer link de Drive válido de un párrafo (formato de ProseMirror). */
export function driveLinkInNode(node: PMNode): DriveLink | null {
  let found: DriveLink | null = null;
  node.forEach((child) => {
    if (found) return;
    const href = child.marks.find((m) => m.type.name === 'link')?.attrs.href as string | undefined;
    found = parseDriveLink(href);
  });
  return found;
}

/**
 * Los permisos del iframe: lo justo para que el reproductor de Drive ande con la sesión de Google.
 * - `allow-scripts` y `allow-same-origin`: el reproductor es una página de Google que necesita sus scripts
 *   y su sesión (el iframe es de otro origen, así que no ve nada de la app).
 * - `allow-popups`: el botón del reproductor que abre el archivo en Drive. Sin
 *   `allow-popups-to-escape-sandbox`: esa pestaña queda con las mismas restricciones; para abrirlo en una
 *   pestaña normal está "Open in Drive" en el pie.
 * - `allow-storage-access-by-user-activation`: deja que el reproductor, después de un toque, le pida al
 *   navegador su propia sesión de Google (API Storage Access) donde las cookies de terceros están
 *   bloqueadas (Safari, iPhone). Solo sirve si Drive la pide; no le da nada de la app.
 * Sin `allow-forms`: los formularios de Google no se muestran como tarjeta (driveLinks.ts).
 */
export const DRIVE_FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-storage-access-by-user-activation';

/**
 * El navegador bloquea las cookies de terceros (Safari en la Mac y cualquier navegador del iPhone o el
 * iPad, que usan el motor de Safari): el reproductor no tiene la sesión de Google y un archivo privado pide
 * iniciar sesión; solo suelen andar los compartidos por link.
 */
export function blocksThirdPartyCookies(ua: string = navigator.userAgent, touchMac = navigator.maxTouchPoints > 1): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  if (/Macintosh/.test(ua) && touchMac) return true; // iPad con "sitio de escritorio"
  return /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|EdgiOS\/|Edg\/|OPR\/|Android/.test(ua);
}

/** Cuánto se espera a que el reproductor cargue (ya en pantalla) antes de ofrecer abrirlo en Drive. */
export const PLAYER_TIMEOUT_MS = 15_000;

interface CardViewOptions {
  link: DriveLink;
  node: PMNode;
  editor: BlockNoteEditor<any, any, any>;
  view: EditorView;
  getPos: () => number | undefined;
}

// El mismo ícono de Drive que el resto de la app (DriveIcon en icons.tsx).
const DRIVE_ICON =
  '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 15h7a3 3 0 0 0 .5-5.96A4.5 4.5 0 0 0 6 7.5 3.75 3.75 0 0 0 6.5 15z"/></svg>';

/** La tarjeta en el editor (una vista de ProseMirror para el párrafo). */
export function createDriveCardView({ link, node, editor, view, getPos }: CardViewOptions) {
  let current = node;
  const card = document.createElement('div');
  card.className = 'drive-card';
  card.dataset.driveKind = link.kind;

  // Arriba: el reproductor (o el aviso sin red). No es parte del texto.
  const frame = document.createElement('div');
  frame.className = 'drive-card-frame';
  frame.contentEditable = 'false';

  // En el teléfono, una tapa transparente evita que el iframe se quede con el scroll de la página: el
  // dedo desliza la página; un toque la saca y deja usar el reproductor hasta tocar afuera.
  const shield = document.createElement('button');
  shield.type = 'button';
  shield.className = 'drive-card-shield';
  const shieldText = document.createElement('span');
  shieldText.textContent = t('driveCard.tap');
  shield.append(shieldText);

  // Abajo: el pie, con el link (el texto del párrafo, editable) y "Open in Drive".
  const foot = document.createElement('div');
  foot.className = 'drive-card-foot';
  const icon = document.createElement('span');
  icon.className = 'drive-card-icon';
  icon.contentEditable = 'false';
  icon.innerHTML = DRIVE_ICON;
  const text = document.createElement('p');
  text.className = 'drive-card-text';
  const actions = document.createElement('span');
  actions.className = 'drive-card-actions';
  actions.contentEditable = 'false';
  const open = document.createElement('a');
  open.className = 'drive-card-open';
  open.href = driveOpenUrl(link);
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = t('driveCard.open');
  // Volver a un link común (solo con permiso de edición; en solo lectura no se ve).
  const unembed = document.createElement('button');
  unembed.type = 'button';
  unembed.className = 'drive-card-unembed';
  unembed.textContent = t('driveCard.showAsLink');
  actions.append(open, unembed);
  foot.append(icon, text, actions);

  // Entre el reproductor y el pie: un aviso discreto con "Open in Drive" si el reproductor puede no andar
  // (Safari, iPhone) o si no cargó a tiempo.
  const hint = document.createElement('div');
  hint.className = 'drive-card-hint';
  hint.contentEditable = 'false';
  hint.hidden = true;
  const hintText = document.createElement('span');
  const hintOpen = document.createElement('a');
  hintOpen.className = 'drive-card-hint-open';
  hintOpen.href = open.href;
  hintOpen.target = '_blank';
  hintOpen.rel = 'noopener noreferrer';
  hintOpen.textContent = t('driveCard.open');
  hint.append(hintText, hintOpen);
  const showHint = (message: string, strong = false) => {
    hintText.textContent = message;
    hint.classList.toggle('drive-card-hint-strong', strong);
    hint.hidden = false;
  };
  const cookieHint = blocksThirdPartyCookies()
    ? t('driveCard.cookies')
    : null;
  if (cookieHint) showHint(cookieHint);

  card.append(frame, hint, foot);

  const chrome = [frame, icon, actions, hint];

  // Si el reproductor no carga (ya en pantalla) en PLAYER_TIMEOUT_MS, el aviso se vuelve visible. Un
  // reproductor que carga pero pide iniciar sesión no se puede detectar (es de otro origen): para eso está
  // el aviso de Safari y "Open in Drive" en el pie.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let observer: IntersectionObserver | null = null;
  const stopWatching = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    observer?.disconnect();
    observer = null;
  };
  const watch = (iframe: HTMLIFrameElement) => {
    stopWatching();
    iframe.addEventListener('load', () => {
      stopWatching();
      if (cookieHint) showHint(cookieHint);
      else hint.hidden = true;
    });
    if (typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer?.disconnect();
      observer = null;
      timer = setTimeout(() => showHint(t('driveCard.notLoaded'), true), PLAYER_TIMEOUT_MS);
    });
    observer.observe(frame);
  };

  const showPlayer = () => {
    if (frame.querySelector('iframe')) return;
    const iframe = playerFrame(link);
    frame.replaceChildren(iframe, shield);
    watch(iframe);
  };
  const showOffline = () => {
    const notice = document.createElement('div');
    notice.className = 'drive-card-offline';
    notice.setAttribute('role', 'status');
    notice.textContent = t('driveCard.offline');
    frame.replaceChildren(notice);
  };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) showOffline();
  else showPlayer();
  const onOnline = () => showPlayer();
  // Si se corta la red con el reproductor abierto, se deja: puede tener el video ya cargado.
  window.addEventListener('online', onOnline);

  // La tapa del teléfono: se saca con un toque y vuelve al tocar afuera de la tarjeta.
  const onOutside = (e: Event) => {
    if (card.contains(e.target as Node)) return;
    card.classList.remove('drive-card-live');
    document.removeEventListener('pointerdown', onOutside, true);
  };
  shield.addEventListener('click', () => {
    card.classList.add('drive-card-live');
    document.addEventListener('pointerdown', onOutside, true);
  });

  unembed.addEventListener('click', () => {
    if (!editor.isEditable) return;
    const pos = getPos();
    if (pos === undefined) return;
    const container = view.state.doc.resolve(pos).parent;
    if (container.type.name !== 'blockContainer') return;
    editor.updateBlock(container.attrs.id as string, { props: { [DRIVE_CARD_PROP]: false } } as never);
    editor.focus();
  });

  return {
    dom: card,
    contentDOM: text,
    // Mientras el link no cambie, la tarjeta sigue (el reproductor no se recarga al editar el texto). Si
    // cambian las propiedades o el link, se vuelve a dibujar.
    update: (next: PMNode) => {
      if (next.type !== current.type || !next.sameMarkup(current)) return false;
      if (!sameDriveLink(driveLinkInNode(next), link)) return false;
      current = next;
      return true;
    },
    // Lo que cambia en el reproductor, la tapa o los botones no es parte del documento.
    ignoreMutation: (m: ViewMutationRecord) => {
      if (m.type === 'selection') return false;
      const target = m.target as Node;
      if (chrome.some((el) => el.contains(target))) return true;
      return m.type === 'attributes' && target === card;
    },
    // Los toques y clics en el reproductor y los botones los maneja el navegador, no el editor.
    stopEvent: (e: Event) => chrome.some((el) => el.contains(e.target as Node)),
    destroy: () => {
      stopWatching();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('pointerdown', onOutside, true);
    },
  };
}

/** El iframe del reproductor. La dirección sale solo del id (ver driveLinks.ts). */
export function playerFrame(link: DriveLink): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.className = 'drive-card-player';
  iframe.src = drivePreviewUrl(link);
  iframe.setAttribute('sandbox', DRIVE_FRAME_SANDBOX);
  iframe.setAttribute('allow', 'fullscreen');
  iframe.setAttribute('allowfullscreen', '');
  // Sin referrer: Drive no se entera de qué página de la app lo muestra. Si el reproductor no cargara por
  // esto (confirmarlo a mano), el cambio es `strict-origin` (manda solo el dominio de la app).
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('aria-label', t('driveCard.player'));
  return iframe;
}
