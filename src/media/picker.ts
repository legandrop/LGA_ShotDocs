import { t } from '../i18n';
import '../i18n/lazy/drive';
import type { PickerConfig } from './portero';

// El selector de carpetas de Google (Google Picker), para que el dueño elija dónde va la carpeta
// `LGA_ShotDocs` en su Drive (paso 8 del plan). Con el permiso `drive.file`, elegir una carpeta en este
// selector le da a la app (el mismo proyecto de Google, `appId`) acceso a esa carpeta para crear adentro.
// El script de Google se carga recién cuando se abre el selector.

const PICKER_SCRIPT = 'https://apis.google.com/js/api.js';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

interface PickedDoc {
  id: string;
  name?: string;
}

interface PickerData {
  action: string;
  docs?: PickedDoc[];
}

/** Lo que se usa de `google.picker` (el script no trae tipos). */
interface PickerApi {
  Action: { PICKED: string; CANCEL: string };
  ViewId: { FOLDERS: string };
  DocsViewMode: { LIST: string };
  DocsView: new (viewId: string) => {
    setSelectFolderEnabled(on: boolean): PickerView;
    setIncludeFolders(on: boolean): PickerView;
    setMimeTypes(types: string): PickerView;
    setMode(mode: string): PickerView;
  };
  PickerBuilder: new () => PickerBuilder;
}
type PickerView = InstanceType<PickerApi['DocsView']>;
interface PickerBuilder {
  addView(view: PickerView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  /** El idioma del selector de Google (el de la app). */
  setLocale(locale: string): PickerBuilder;
  setCallback(callback: (data: PickerData) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

declare global {
  interface Window {
    gapi?: { load(name: string, options: { callback: () => void; onerror?: () => void; timeout?: number; ontimeout?: () => void }): void };
    google?: { picker?: PickerApi };
  }
}

let loading: Promise<PickerApi> | null = null;

function loadPicker(): Promise<PickerApi> {
  if (window.google?.picker) return Promise.resolve(window.google.picker);
  loading ??= new Promise<PickerApi>((resolve, reject) => {
    const failed = () => {
      loading = null;
      reject(new Error(t('picker.loadFailed')));
    };
    const ready = () => (window.google?.picker ? resolve(window.google.picker) : failed());
    const load = () => window.gapi?.load('picker', { callback: ready, onerror: failed, timeout: 15_000, ontimeout: failed });
    if (window.gapi) return load();
    const script = document.createElement('script');
    script.src = PICKER_SCRIPT;
    script.async = true;
    script.onload = load;
    script.onerror = failed;
    document.head.appendChild(script);
  });
  return loading;
}

/** Abre el selector de carpetas. Devuelve la carpeta elegida, o `null` si se cerró sin elegir. */
export async function pickFolder(config: PickerConfig): Promise<{ id: string; name: string } | null> {
  const picker = await loadPicker();
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true)
      .setMimeTypes(FOLDER_MIME)
      .setMode(picker.DocsViewMode.LIST);
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(config.token)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setTitle(t('picker.title'))
      .setLocale(t.lang)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name ?? '' } : null);
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build()
      .setVisible(true);
  });
}
