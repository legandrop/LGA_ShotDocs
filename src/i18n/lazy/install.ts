import { register } from '../index';
import type { Dict } from '../types';

// La ventana con los pasos para instalar la app (Docs/Doc_Instalar.md; se carga aparte). Los **asteriscos**
// marcan en negrita lo que se ve escrito en el teléfono o el navegador. Las palabras de los dibujos
// (`installDialog.ui.*`) son las mismas que nombran los pasos.

export const installDialog = {
  'installDialog.title': { en: "Install Shot Docs", es: "Instalar Shot Docs" },
  'installDialog.why': {
    en: "Installed, Shot Docs opens from the home screen in its own window, like any app. On iPhone and iPad it also keeps its own storage: Safari can erase what a website keeps on the device after a few days without use, but not an installed app's.",
    es: "Instalada, Shot Docs se abre desde la pantalla de inicio en su propia ventana, como cualquier app. En el iPhone y el iPad además tiene su propio almacenamiento: Safari puede borrar lo que una web guarda en el dispositivo después de unos días sin usarla, pero no lo de una app instalada.",
  },
  'installDialog.optional': {
    en: "It's optional: the web version keeps working the same.",
    es: "Es opcional: la versión web sigue andando igual.",
  },
  'installDialog.direct': {
    en: "Your browser can install it right now.",
    es: "Tu navegador la puede instalar ahora mismo.",
  },
  'installDialog.install': { en: "Install", es: "Instalar" },
  'installDialog.tabs': { en: "Device", es: "Dispositivo" },
  'installDialog.tab.iphone': { en: "iPhone · iPad", es: "iPhone · iPad" },
  'installDialog.tab.android': { en: "Android", es: "Android" },
  'installDialog.tab.computer': { en: "Computer", es: "Computadora" },
  'installDialog.thisDevice': { en: "This device", es: "Este dispositivo" },
  'installDialog.words': {
    en: "The words can change a little with the version and the language of the device.",
    es: "Las palabras pueden cambiar un poco según la versión y el idioma del dispositivo.",
  },

  // iPhone y iPad (Safari).
  'installDialog.ios.share': { en: "Tap the **Share** button", es: "Tocá el botón **Compartir**" },
  'installDialog.ios.shareNote': {
    en: "At the bottom of Safari (at the top on iPad). If you only see the address bar, tap **⋯** first.",
    es: "Abajo en Safari (arriba en el iPad). Si solo ves la barra de la dirección, tocá primero **⋯**.",
  },
  'installDialog.ios.add': { en: "Tap **Add to Home Screen**", es: "Tocá **Agregar a pantalla de inicio**" },
  'installDialog.ios.addNote': {
    en: "Scroll down the list to find it. If it isn't there, tap **Edit Actions** at the end and add it.",
    es: "Bajá en la lista para encontrarlo. Si no está, tocá **Editar acciones** al final y sumalo.",
  },
  'installDialog.ios.confirm': {
    en: "Leave **Open as Web App** on and tap **Add**",
    es: "Dejá prendido **Abrir como app web** y tocá **Agregar**",
  },
  'installDialog.ios.confirmNote': {
    en: "Older iPhones don't show the switch: just tap **Add**.",
    es: "En los iPhone más viejos no aparece el interruptor: tocá **Agregar** y listo.",
  },
  'installDialog.ios.open': {
    en: "Open **Shot Docs** from the home screen and sign in",
    es: "Abrí **Shot Docs** desde la pantalla de inicio y entrá con tu mail",
  },
  'installDialog.ios.openNote': {
    en: "The app keeps its own data, apart from Safari, so it asks you to sign in once. Before switching, wait until this page says **All synced**: changes not uploaded yet stay in Safari until you open it again.",
    es: "La app guarda sus datos aparte de Safari, así que pide entrar una vez. Antes de pasarte, esperá a que esta página diga **Todo sincronizado**: lo que falta subir queda en Safari hasta que lo vuelvas a abrir.",
  },
  'installDialog.ios.otherBrowser': {
    en: "In Chrome, Edge or Firefox on iPhone (iOS 16.4 or later) the **Share** button is in the address bar or in the menu. If **Add to Home Screen** isn't there, open this page in Safari.",
    es: "En Chrome, Edge o Firefox del iPhone (iOS 16.4 o más nuevo) el botón **Compartir** está en la barra de la dirección o en el menú. Si no aparece **Agregar a pantalla de inicio**, abrí esta página en Safari.",
  },
  'installDialog.ios.inApp': {
    en: "This browser runs inside another app and can't install apps. Open this page in **Safari**: look for **Open in Safari** or **Open in browser** in its menu, or copy the link and paste it in Safari.",
    es: "Este navegador corre adentro de otra app y no puede instalar apps. Abrí esta página en **Safari**: buscá **Abrir en Safari** o **Abrir en el navegador** en su menú, o copiá el link y pegalo en Safari.",
  },
  'installDialog.copyLink': { en: "Copy link", es: "Copiar el link" },
  'installDialog.linkCopied': { en: "Link copied", es: "Link copiado" },

  // Android (Chrome).
  'installDialog.android.menu': { en: "Tap the **⋮** menu", es: "Tocá el menú **⋮**" },
  'installDialog.android.menuNote': { en: "Top right in Chrome.", es: "Arriba a la derecha en Chrome." },
  'installDialog.android.install': { en: "Tap **Install app**", es: "Tocá **Instalar app**" },
  'installDialog.android.installNote': {
    en: "On some phones it says **Add to Home screen**: tap it and then **Install**.",
    es: "En algunos teléfonos dice **Agregar a la pantalla principal**: tocalo y después **Instalar**.",
  },
  'installDialog.android.confirm': { en: "Confirm with **Install**", es: "Confirmá con **Instalar**" },
  'installDialog.android.open': {
    en: "Open **Shot Docs** from the home screen or the app list",
    es: "Abrí **Shot Docs** desde la pantalla principal o la lista de apps",
  },
  'installDialog.android.openNote': {
    en: "It uses Chrome's data, so you stay signed in.",
    es: "Usa los datos de Chrome, así que seguís con tu sesión.",
  },
  'installDialog.android.other': {
    en: "Samsung Internet: menu **≡** → **Add page to** → **Home screen**. Firefox: menu **⋮** → **Install**.",
    es: "Samsung Internet: menú **≡** → **Agregar página a** → **Pantalla de inicio**. Firefox: menú **⋮** → **Instalar**.",
  },

  // Computadora.
  'installDialog.pc.chrome': { en: "Chrome or Edge", es: "Chrome o Edge" },
  'installDialog.pc.icon': {
    en: "Click the **Install** icon at the right of the address bar",
    es: "Hacé clic en el ícono de **Instalar** a la derecha de la barra de la dirección",
  },
  'installDialog.pc.iconNote': {
    en: "If it isn't there: in Chrome, menu **⋮** → **Cast, save and share** → **Install page as app…**; in Edge, menu **⋯** → **Apps** → **Install this site as an app**.",
    es: "Si no está: en Chrome, menú **⋮** → **Transmitir, guardar y compartir** → **Instalar página como app…**; en Edge, menú **⋯** → **Aplicaciones** → **Instalar este sitio como una aplicación**.",
  },
  'installDialog.pc.confirm': { en: "Click **Install**", es: "Hacé clic en **Instalar**" },
  'installDialog.pc.confirmNote': {
    en: "Shot Docs opens in its own window and shows up in the Start menu or in Applications, like any app.",
    es: "Shot Docs se abre en su propia ventana y aparece en el menú Inicio o en Aplicaciones, como cualquier app.",
  },
  'installDialog.pc.safari': { en: "Safari on Mac", es: "Safari en la Mac" },
  'installDialog.mac.dock': { en: "Choose **File** → **Add to Dock…**", es: "Elegí **Archivo** → **Agregar al Dock…**" },
  'installDialog.mac.dockNote': {
    en: "Needs macOS Sonoma or later. It's also under the **Share** button.",
    es: "Hace falta macOS Sonoma o más nuevo. También está en el botón **Compartir**.",
  },
  'installDialog.mac.confirm': {
    en: "Click **Add**, open Shot Docs from the Dock and sign in",
    es: "Hacé clic en **Agregar**, abrí Shot Docs desde el Dock y entrá con tu mail",
  },
  'installDialog.mac.confirmNote': {
    en: "Like on the iPhone, it keeps its own data apart from Safari.",
    es: "Como en el iPhone, guarda sus datos aparte de Safari.",
  },
  'installDialog.pc.firefox': {
    en: "Firefox can't install web apps: use Chrome, Edge or Safari.",
    es: "Firefox no instala apps web: usá Chrome, Edge o Safari.",
  },

  // Las palabras de los dibujos.
  'installDialog.ui.addHome': { en: "Add to Home Screen", es: "Agregar a pantalla de inicio" },
  'installDialog.ui.webApp': { en: "Open as Web App", es: "Abrir como app web" },
  'installDialog.ui.add': { en: "Add", es: "Agregar" },
  'installDialog.ui.cancel': { en: "Cancel", es: "Cancelar" },
  'installDialog.ui.installApp': { en: "Install app", es: "Instalar app" },
  'installDialog.ui.file': { en: "File", es: "Archivo" },
  'installDialog.ui.addDock': { en: "Add to Dock…", es: "Agregar al Dock…" },
} satisfies Dict;

register(installDialog);
