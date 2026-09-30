import { lazyPart } from './lazyPart';

// Los diálogos que no hacen falta para la primera pantalla se bajan la primera vez que se abren (roadmap
// B.4). Cada uno va adentro de `<Part>` donde se usa.

export const ShareDialog = lazyPart(() => import('./ShareDialog').then((m) => m.ShareDialog));
export const MembersDialog = lazyPart(() => import('./MembersDialog').then((m) => m.MembersDialog));
export const DriveDialogHost = lazyPart(() => import('./DriveDialog').then((m) => m.DriveDialogHost));
export const ProjectSearch = lazyPart(() => import('./ProjectSearch').then((m) => m.ProjectSearch));
