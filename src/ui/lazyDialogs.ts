import { lazyPart } from './lazyPart';

// Los diálogos que no hacen falta para la primera pantalla se bajan la primera vez que se abren (roadmap
// B.4). Cada uno va adentro de `<Part>` donde se usa.

export const ShareDialog = lazyPart(() => import('./ShareDialog').then((m) => m.ShareDialog));
export const MembersDialog = lazyPart(() => import('./MembersDialog').then((m) => m.MembersDialog));
export const ImportCodaDialog = lazyPart(() => import('./ImportCodaDialog').then((m) => m.ImportCodaDialog));
// Volver a Shot Docs desde un zip exportado (P.22, entrega 3).
export const ImportArchiveDialog = lazyPart(() => import('./ImportArchiveDialog').then((m) => m.ImportArchiveDialog));
export const DriveDialogHost = lazyPart(() => import('./DriveDialog').then((m) => m.DriveDialogHost));
export const ProjectSearch = lazyPart(() => import('./ProjectSearch').then((m) => m.ProjectSearch));
// Borrar un proyecto y la papelera de proyectos (P.14).
export const DeleteProjectDialog = lazyPart(() => import('./ProjectStatesPart').then((m) => m.DeleteProjectDialog));
// La ayuda (P.13, Docs/Doc_Tutorial.md).
export const HelpDialog = lazyPart(() => import('../help/HelpDialog').then((m) => m.HelpDialog));
export const DeletedProjectsList = lazyPart(() => import('./ProjectStatesPart').then((m) => m.DeletedProjectsList));
// "Available offline" y "Storage on this device" (P.10).
export const OfflineDialog = lazyPart(() => import('./OfflinePart').then((m) => m.OfflineDialog));
export const StorageDialog = lazyPart(() => import('./OfflinePart').then((m) => m.StorageDialog));
export const LookForFilesButton = lazyPart(() => import('./ProjectStatesPart').then((m) => m.LookForFilesButton));
// Los pasos para instalar la app (Doc_Instalar.md).
export const InstallDialog = lazyPart(() => import('./InstallDialog').then((m) => m.InstallDialog));
// Exportar una rama o un proyecto como PDF (P.22, Docs/Doc_Exportar.md).
export const ExportDialog = lazyPart(() => import('./ExportDialog').then((m) => m.ExportDialog));
