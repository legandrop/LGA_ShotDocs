import { useId, type SVGProps } from 'react';

// Íconos de la interfaz: grilla de 20 px, trazo de 1.5.
function icon(d: string, extra: SVGProps<SVGSVGElement> = {}) {
  return ({ size = 18 }: { size?: number }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...extra}
    >
      <path d={d} />
    </svg>
  );
}

export const PageIcon = icon('M6 2.75h5.5L15 6.25v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-12.5a1 1 0 0 1 1-1zM11.5 2.75v3.5H15');
export const PlusIcon = icon('M10 4.5v11M4.5 10h11', { strokeWidth: 1.6 });
export const ExpandIcon = icon('M8 5.5l4.5 4.5L8 14.5', { strokeWidth: 1.8 });
export const CollapseIcon = icon('M5.5 8l4.5 4.5L14.5 8', { strokeWidth: 1.8 });
export const ChevronUpIcon = icon('M5.5 12l4.5-4.5 4.5 4.5', { strokeWidth: 1.8 });
export const RenameIcon = icon('M12.5 4.5l3 3L8 15H5v-3z');
export const MoveIcon = icon('M3.75 6.25h4l1.5 1.5h7v7.5a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1zM8.5 12h5M11.5 10l2 2-2 2');
// Importar: una carpeta con una flecha que entra.
export const ImportIcon = icon('M3.75 6.25h4l1.5 1.5h7v7.5a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1zM10 9.5v4.5M8 12l2 2 2-2');
export const TrashIcon = icon(
  'M3.75 5.5h12.5M8 5.5V3.75h4V5.5M5.5 5.5l.7 10.5a1 1 0 0 0 1 .95h5.6a1 1 0 0 0 1-.95l.7-10.5',
);
export const RestoreIcon = icon('M4 10a6 6 0 1 0 1.8-4.3M4 3.5v3h3');
// El historial de versiones (P.18): la flecha de volver atrás con las agujas de un reloj.
export const HistoryIcon = icon('M4 10a6 6 0 1 0 1.8-4.3M4 3.5v3h3M10 6.75V10l2.25 1.5');
// Archivar y desarchivar un proyecto (P.14): una caja con su tapa; desarchivar, con una flecha que sale.
export const ArchiveIcon = icon('M3.25 4.25h13.5v3H3.25zM4.5 7.25v8a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-8M8.25 10.5h3.5');
export const UnarchiveIcon = icon('M3.25 4.25h13.5v3H3.25zM4.5 7.25v8a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-8M10 14V9.75M8 11.5l2-2 2 2');
// "Available offline" (P.10): un círculo con una flecha que baja al dispositivo.
export const OfflineMarkIcon = icon('M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM10 6.75v6M7.5 10.5l2.5 2.5 2.5-2.5');
// "Storage on this device": un disco.
export const StorageIcon = icon('M3.25 11.5h13.5v3.75a1 1 0 0 1-1 1H4.25a1 1 0 0 1-1-1zM3.25 11.5l2-6.75h9.5l2 6.75M13.25 14h.5');
export const SyncedIcon = icon('M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM7.25 10.25l1.9 1.9 3.6-4', {
  strokeWidth: 1.7,
});
export const UploadingIcon = icon('M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM10 13V7.25M7.5 9.5L10 7l2.5 2.5', {
  strokeWidth: 1.7,
});
export const OfflineIcon = icon('M6.5 15h7a3 3 0 0 0 .5-5.96A4.5 4.5 0 0 0 6 7.5 3.75 3.75 0 0 0 6.5 15zM3.5 3.5l13 13', {
  strokeWidth: 1.6,
});
export const DriveIcon = icon('M6.5 15h7a3 3 0 0 0 .5-5.96A4.5 4.5 0 0 0 6 7.5 3.75 3.75 0 0 0 6.5 15z');
export const WarningIcon = icon('M10 3.5l7 12.25H3zM10 8.5v3.25M10 13.9v.1', { strokeWidth: 1.6 });
export const ErrorIcon = icon('M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM10 6.75v3.75M10 13.2v.1', {
  strokeWidth: 1.6,
});
export const SystemIcon = icon(
  'M4.25 4h11.5c.7 0 1.25.55 1.25 1.25v7c0 .7-.55 1.25-1.25 1.25H4.25C3.55 13.5 3 12.95 3 12.25v-7C3 4.55 3.55 4 4.25 4zM7.5 16.5h5M10 13.5v3',
);
export const LightIcon = icon(
  'M10 6.75a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5zM10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1.05 1.05M14.25 14.25l1.05 1.05M4.7 15.3l1.05-1.05M14.25 5.75l1.05-1.05',
);
export const DarkIcon = icon('M15.5 12.25A6 6 0 0 1 7.75 4.5a6 6 0 1 0 7.75 7.75z');
// Instalar la app: un teléfono con una flecha que baja.
export const InstallIcon = icon(
  'M6.75 2.75h6.5a1 1 0 0 1 1 1v12.5a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1zM10 6.5v5.25M8 9.75l2 2 2-2M9 14.75h2',
);
export const MenuIcon = icon('M3.5 6h13M3.5 10h13M3.5 14h8', { strokeWidth: 1.6 });
export const AccountIcon = icon('M6.5 8L10 4.5 13.5 8M6.5 12L10 15.5 13.5 12', { strokeWidth: 1.6 });
export const SignOutIcon = icon('M8 3.75H5a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h3M11.5 6.5L15 10l-3.5 3.5M15 10H8');
export const ArrowRightIcon = icon('M4 10h12M11 5l5 5-5 5', { strokeWidth: 1.6 });
export const ArrowLeftIcon = icon('M16 10H4M9 5l-5 5 5 5', { strokeWidth: 1.6 });
export const MailIcon = icon('M4.5 5h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13.5v-7A1.5 1.5 0 0 1 4.5 5zM3.5 6l6.5 5 6.5-5');
export const SearchIcon = icon('M9 3.75a5.25 5.25 0 1 1 0 10.5 5.25 5.25 0 0 1 0-10.5zM13 13l3.5 3.5', { strokeWidth: 1.6 });
export const ScriptIcon = icon('M5.5 3h9v14h-9zM8 6.5h4M7.5 9.5h1.5M11 9.5h1.5M8 12.5h4');
export const CommentIcon = icon('M4.75 4h10.5c.7 0 1.25.55 1.25 1.25v7c0 .7-.55 1.25-1.25 1.25H9l-3.5 2.75V13.5h-.75c-.7 0-1.25-.55-1.25-1.25v-7C3.5 4.55 4.05 4 4.75 4z');
export const QuestionIcon = icon('M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM8 8.1a2 2 0 1 1 2.9 1.8c-.55.3-.9.8-.9 1.4v.2M10 13.6v.1', {
  strokeWidth: 1.6,
});
/** La ayuda: un signo de pregunta en un círculo, más liviano que el de las preguntas. */
export const HelpIcon = icon('M10 3.25a6.75 6.75 0 1 1 0 13.5 6.75 6.75 0 0 1 0-13.5zM8.1 8.2a1.95 1.95 0 1 1 2.75 1.78c-.5.25-.85.7-.85 1.27v.35M10 13.75v.1', {
  strokeWidth: 1.5,
});
// El salto de hoja: el pie de una hoja y el comienzo de la siguiente, con la línea punteada entre las dos.
export const PageBreakIcon = icon('M5.5 2.75v4.5h9v-4.5M5.5 17.25v-4.5h9v4.5M3 10h2M7 10h2M11 10h2M15 10h2');
export const SheetIcon = icon('M5.5 2.75h9v14.5h-9zM7.75 5.5h4.5M7.75 8h4.5M7.75 10.5h3');
export const PrintIcon = icon(
  'M5.5 7.5V3.25h9V7.5M5.5 14H3.75a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1h12.5a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H14.5M5.5 11.5h9v5.25h-9z',
);
// Colapsar / abrir todos los títulos (P.11): renglones con un triángulo a la izquierda.
export const CollapseAllIcon = icon('M4 5.5l2.5 1.75L4 9M9 7.25h7M4 12.25l2.5 1.75L4 15.75M9 14h7');
export const ExpandAllIcon = icon('M3.75 5.75h5L6.25 8.5zM11 7h5M3.75 12.25h5l-2.5 2.75zM11 13.5h5');
export const CloseIcon = icon('M5 5l10 10M15 5L5 15', { strokeWidth: 1.7 });
export const ChevronLeftIcon = icon('M12 4.5L6.5 10l5.5 5.5', { strokeWidth: 1.8 });
export const ChevronRightIcon = icon('M8 4.5l5.5 5.5L8 15.5', { strokeWidth: 1.8 });
export const DownloadIcon = icon('M10 3.5v9M6.25 9L10 12.75 13.75 9M4 16.25h12', { strokeWidth: 1.6 });
/** Abrir en otra pestaña (un adjunto en el carrete). */
export const OpenIcon = icon('M11 3.75h5.25V9M16 4l-6.5 6.5M14.25 11.5v3.75a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1H8.5', { strokeWidth: 1.6 });
export const HeaderIcon = icon('M4 6h12M4 10h7M4 14h9');
export const ShareIcon = icon('M10 12.5V3.75M6.75 7L10 3.75 13.25 7M5.5 10.5H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-.5');
export const MembersIcon = icon(
  'M7.5 9.25a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5zM2.75 16.25a4.75 4.75 0 0 1 9.5 0M13.25 4a2.5 2.5 0 0 1 0 5M14.5 11.75a4.25 4.25 0 0 1 2.75 4.5',
);

export const MoreIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <circle cx="4.5" cy="10" r="1.4" />
    <circle cx="10" cy="10" r="1.4" />
    <circle cx="15.5" cy="10" r="1.4" />
  </svg>
);

// Ícono de la app: un anotador con una claqueta arriba. Mismo dibujo que public/icons/icon.svg.
const STRIPES = [-3, 5, 13, 21, 29];

export function AppIcon({ size = 26 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" className="app-icon">
      <defs>
        <clipPath id={`${id}-c`}>
          <rect width="36" height="36" rx="8.5" />
        </clipPath>
        <linearGradient id={`${id}-s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.22" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}-c)`}>
        <rect width="36" height="36" fill="#FFFFFF" />
        <rect y="8.58" width="36" height="2.2" fill={`url(#${id}-s)`} />
        <rect width="36" height="8.58" fill="#FBFAF8" />
        <rect width="36" height="4.29" fill="#1B1A17" />
        {STRIPES.map((x) => (
          <path key={`t${x}`} d={`M${x} 0h4l1.95 4.29h-4z`} fill="#FBFAF8" />
        ))}
        <rect y="4.59" width="36" height="3.99" fill="#1B1A17" />
        {STRIPES.map((x) => (
          <path key={`b${x}`} d={`M${x} 8.58l1.95-3.99h4l-1.95 3.99z`} fill="#FBFAF8" />
        ))}
        <rect y="8.58" width="36" height="0.45" fill="#8A857B" />
        <path d="M7 14.88h22M7 19.38h22M7 23.88h22M7 28.38h14" stroke="#D2CCC0" strokeWidth="1.4" strokeLinecap="round" />
      </g>
      <rect x="0.5" y="0.5" width="35" height="35" rx="8" fill="none" stroke="#DDD8CE" />
    </svg>
  );
}

/** La franja de la claqueta: dos palos con rayas cruzadas, blanco y negro. */
export function SlateBand({ height = 12 }: { height?: number }) {
  return (
    <div className="slate-band" style={{ ['--band-h' as string]: `${height}px` }} aria-hidden="true">
      <div className="stick top" />
      <div className="line" />
      <div className="stick bottom" />
      <div className="line" />
    </div>
  );
}

/**
 * Los tres puntos verticales del bloque (el tirador, BlockSideMenu.tsx): círculos llenos y gruesos, como en Coda.
 * 4 px de diámetro, 6,5 px de centro a centro.
 */
export function BlockDotsIcon() {
  return (
    <svg className="sd-dots" width={4} height={17} viewBox="0 0 4 17" fill="currentColor" aria-hidden="true">
      <circle cx={2} cy={2} r={2} />
      <circle cx={2} cy={8.5} r={2} />
      <circle cx={2} cy={15} r={2} />
    </svg>
  );
}
// La barra de las fotos (MediaBar.tsx): alinear el renglón y reemplazar el archivo.
export const AlignLeftIcon = icon('M4 5.5h12M4 9h8M4 12.5h12M4 16h8', { strokeWidth: 1.6 });
export const AlignCenterIcon = icon('M4 5.5h12M6 9h8M4 12.5h12M6 16h8', { strokeWidth: 1.6 });
export const AlignRightIcon = icon('M4 5.5h12M8 9h8M4 12.5h12M8 16h8', { strokeWidth: 1.6 });
export const ReplaceIcon = icon('M4.5 8.5a5.5 5.5 0 0 1 10-2.5M15.5 3.5v3h-3M15.5 11.5a5.5 5.5 0 0 1-10 2.5M4.5 16.5v-3h3');
