import { useSyncExternalStore } from 'react';

// Instalar la app (Docs/Doc_Instalar.md): saber si esta pestaña ya es la app instalada, en qué plataforma está
// (para mostrar los pasos justos) y guardar el pedido de instalar que dan Chrome y Edge (`beforeinstallprompt`)
// para el botón "Install". Es parte de la primera carga y pesa poco: la ventana con los pasos se baja aparte.
//
// Por qué importa: en el iPhone y el iPad, Safari puede borrar lo que una web guarda en el dispositivo después
// de unos días sin abrirla; la app agregada a la pantalla de inicio tiene su propio almacenamiento y no.

/**
 * Dónde se abrió la app:
 * - `ios-safari`: iPhone o iPad con Safari (se instala con Compartir → Agregar a pantalla de inicio).
 * - `ios-browser`: iPhone o iPad con Chrome, Edge o Firefox (desde iOS 16.4 también pueden; si no, Safari).
 * - `ios-inapp`: un navegador adentro de otra app (Instagram, Gmail, el de Google...): no puede instalar.
 * - `android`: Android (Chrome y casi todos los demás instalan).
 * - `android-inapp`: un navegador adentro de otra app en Android (Instagram, Facebook, un WebView): no instala.
 * - `desktop-chromium`: Chrome, Edge, Brave u Opera en una computadora.
 * - `mac-safari`: Safari en la Mac (Archivo → Agregar al Dock, macOS Sonoma o más nuevo).
 * - `desktop-other`: Firefox u otro navegador de computadora que no instala apps web.
 */
export type InstallPlatform =
  | 'ios-safari'
  | 'ios-browser'
  | 'ios-inapp'
  | 'android'
  | 'android-inapp'
  | 'desktop-chromium'
  | 'mac-safari'
  | 'desktop-other';

/** Las pestañas de la ventana de pasos. */
export type InstallTab = 'iphone' | 'android' | 'computer';

export interface DeviceInfo {
  userAgent: string;
  /** Los puntos táctiles: el iPad con iPadOS se presenta como una Mac, pero tiene pantalla táctil. */
  maxTouchPoints: number;
}

function currentDevice(): DeviceInfo {
  if (typeof navigator === 'undefined') return { userAgent: '', maxTouchPoints: 0 };
  return { userAgent: navigator.userAgent ?? '', maxTouchPoints: navigator.maxTouchPoints ?? 0 };
}

/** La plataforma según el navegador (sin pedirle nada a nadie: solo lo que dice el propio navegador). */
export function detectPlatform(device: DeviceInfo = currentDevice()): InstallPlatform {
  const ua = device.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && device.maxTouchPoints > 1);
  if (ios) {
    // Los navegadores de otras apps (y la app de Google, `GSA`) no tienen "Agregar a pantalla de inicio".
    // Un WebView suelto tampoco dice `Safari/`.
    if (/FBAN|FBAV|Instagram|Line\/|GSA\/|Twitter|LinkedInApp|Snapchat|TikTok|MicroMessenger/.test(ua)) return 'ios-inapp';
    if (!/Safari\//.test(ua)) return 'ios-inapp';
    if (/CriOS|EdgiOS|FxiOS|OPiOS|OPT\//.test(ua)) return 'ios-browser';
    return 'ios-safari';
  }
  if (/Android/.test(ua)) {
    // Los WebView de Android dicen `; wv)`; las apps conocidas se nombran solas.
    if (/; wv\)|FBAN|FBAV|FB_IAB|Instagram|Line\/|GSA\/|LinkedInApp|Snapchat|TikTok|musical_ly|MicroMessenger/.test(ua)) return 'android-inapp';
    return 'android';
  }
  if (/Firefox\//.test(ua)) return 'desktop-other';
  if (/Edg\/|Chrome\/|Chromium\//.test(ua)) return 'desktop-chromium';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return 'mac-safari';
  return 'desktop-other';
}

/** La pestaña que se abre primero. */
export function tabFor(platform: InstallPlatform): InstallTab {
  if (platform.startsWith('ios')) return 'iphone';
  if (platform.startsWith('android')) return 'android';
  return 'computer';
}

/** Un teléfono o una tableta: ahí va el aviso de arriba (en la computadora queda solo el menú de la cuenta). */
export function isMobilePlatform(platform: InstallPlatform): boolean {
  return platform.startsWith('ios') || platform.startsWith('android');
}

// Sin `fullscreen`: es también la pantalla completa del navegador de la computadora (F11), que no es la app
// instalada (el manifiesto pide `standalone`).
const DISPLAY_MODES = ['standalone', 'minimal-ui', 'window-controls-overlay'];

/** Esta pestaña es la app instalada (abierta desde la pantalla de inicio, el Dock o su propia ventana). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // Safari del iPhone, antes de entender `display-mode`.
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  if (typeof matchMedia !== 'function') return false;
  return DISPLAY_MODES.some((mode) => matchMedia(`(display-mode: ${mode})`).matches);
}

// --- El pedido de instalar de Chrome y Edge ------------------------------------------------------------------

/** El evento de Chrome y Edge (no está en los tipos de TypeScript). */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallState {
  /** Esta pestaña ya es la app instalada, o se acaba de instalar desde acá. */
  installed: boolean;
  /** El navegador ofreció instalar: el botón "Install" lo hace directo. */
  canPrompt: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;
let justInstalled = false;
let state: InstallState = { installed: false, canPrompt: false };
const subscribers = new Set<() => void>();

function refresh(): void {
  const next = { installed: justInstalled || isStandalone(), canPrompt: !!deferred };
  if (next.installed === state.installed && next.canPrompt === state.canPrompt) return;
  state = next;
  subscribers.forEach((fn) => fn());
}

/**
 * Se llama una sola vez al arrancar, antes de dibujar: Chrome manda `beforeinstallprompt` enseguida y, si nadie
 * lo guarda, no lo vuelve a mandar hasta recargar. Se cancela su barrita propia del teléfono: el aviso de la app
 * hace lo mismo y se puede cerrar por un mes.
 */
export function listenForInstallPrompt(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onPrompt = (e: Event) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    refresh();
  };
  const onInstalled = () => {
    deferred = null;
    justInstalled = true;
    // El aviso del teléfono no vuelve a salir en esta pestaña del navegador (la app ya está en el teléfono).
    snoozeBanner();
    refresh();
  };
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  const queries = typeof matchMedia === 'function' ? DISPLAY_MODES.map((m) => matchMedia(`(display-mode: ${m})`)) : [];
  queries.forEach((q) => q.addEventListener?.('change', refresh));
  refresh();
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
    queries.forEach((q) => q.removeEventListener?.('change', refresh));
  };
}

export function installState(): InstallState {
  return state;
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, installState, installState);
}

/**
 * Muestra el pedido de instalar del navegador. `unavailable` si el navegador no lo ofreció (o ya se usó: Chrome
 * da uno solo por carga).
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  refresh();
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } catch {
    return 'unavailable';
  }
}

// --- El aviso del teléfono -------------------------------------------------------------------------------

const BANNER_KEY = 'shotdocs-install-banner';
/** Cerrado con "Not now", el aviso no vuelve a salir por un mes. */
export const BANNER_SNOOZE_DAYS = 30;

/** Si toca mostrar el aviso según cuándo se cerró la última vez (`stored`: lo guardado, o `null`). */
export function bannerDue(stored: string | null, now = Date.now()): boolean {
  const at = Number(stored);
  if (!stored || !Number.isFinite(at)) return true;
  return now - at >= BANNER_SNOOZE_DAYS * 24 * 60 * 60 * 1000 || at > now;
}

export function readBannerStamp(): string | null {
  try {
    return localStorage.getItem(BANNER_KEY);
  } catch {
    return null;
  }
}

/** "Not now": se anota cuándo. Sin almacenamiento, se esconde solo hasta recargar. */
export function snoozeBanner(now = Date.now()): void {
  try {
    localStorage.setItem(BANNER_KEY, String(now));
  } catch {
    // Sin localStorage (modo privado viejo): el aviso se esconde igual en esta pestaña (lo maneja quien llama).
  }
}

// --- La ventana de pasos -------------------------------------------------------------------------------

let dialogOpen = false;
const dialogSubscribers = new Set<() => void>();

function setDialog(open: boolean): void {
  if (dialogOpen === open) return;
  dialogOpen = open;
  dialogSubscribers.forEach((fn) => fn());
}

/** Abre la ventana con los pasos (la dibuja `InstallHost`, que va en la pantalla principal y en la de entrar). */
export function openInstallDialog(): void {
  setDialog(true);
}

export function closeInstallDialog(): void {
  setDialog(false);
}

export function useInstallDialogOpen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      dialogSubscribers.add(fn);
      return () => dialogSubscribers.delete(fn);
    },
    () => dialogOpen,
    () => false,
  );
}

/** Solo para las pruebas: vuelve al estado de recién cargada la app. */
export function resetInstallForTests(): void {
  deferred = null;
  justInstalled = false;
  state = { installed: false, canPrompt: false };
  dialogOpen = false;
}
