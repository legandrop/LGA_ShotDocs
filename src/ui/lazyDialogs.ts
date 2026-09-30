import { lazyPart } from './lazyPart';

// Los diálogos que no hacen falta para la primera pantalla se bajan la primera vez que se abren (roadmap
// B.4). Cada uno va adentro de `<Part>` donde se usa.

export const ShareDialog = lazyPart(() => import('./ShareDialog').then((m) => m.ShareDialog));
export const MembersDialog = lazyPart(() => import('./MembersDialog').then((m) => m.MembersDialog));
export const DriveDialogHost = lazyPart(() => import('./DriveDialog').then((m) => m.DriveDialogHost));
/** La página de prueba de fotos y videos (`/media-test`). */
export const MediaTest = lazyPart(() => import('./MediaTest').then((m) => m.MediaTest));
