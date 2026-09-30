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
export const RenameIcon = icon('M12.5 4.5l3 3L8 15H5v-3z');
export const MoveIcon = icon('M3.75 6.25h4l1.5 1.5h7v7.5a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1zM8.5 12h5M11.5 10l2 2-2 2');
export const TrashIcon = icon(
  'M3.75 5.5h12.5M8 5.5V3.75h4V5.5M5.5 5.5l.7 10.5a1 1 0 0 0 1 .95h5.6a1 1 0 0 0 1-.95l.7-10.5',
);
export const RestoreIcon = icon('M4 10a6 6 0 1 0 1.8-4.3M4 3.5v3h3');
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
export const MenuIcon = icon('M3.5 6h13M3.5 10h13M3.5 14h8', { strokeWidth: 1.6 });
export const AccountIcon = icon('M6.5 8L10 4.5 13.5 8M6.5 12L10 15.5 13.5 12', { strokeWidth: 1.6 });
export const SignOutIcon = icon('M8 3.75H5a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h3M11.5 6.5L15 10l-3.5 3.5M15 10H8');
export const ArrowRightIcon = icon('M4 10h12M11 5l5 5-5 5', { strokeWidth: 1.6 });
export const ArrowLeftIcon = icon('M16 10H4M9 5l-5 5 5 5', { strokeWidth: 1.6 });
export const MailIcon = icon('M4.5 5h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13.5v-7A1.5 1.5 0 0 1 4.5 5zM3.5 6l6.5 5 6.5-5');
export const SearchIcon = icon('M9 3.75a5.25 5.25 0 1 1 0 10.5 5.25 5.25 0 0 1 0-10.5zM13 13l3.5 3.5', { strokeWidth: 1.6 });
export const ScriptIcon = icon('M5.5 3h9v14h-9zM8 6.5h4M7.5 9.5h1.5M11 9.5h1.5M8 12.5h4');
export const SheetIcon = icon('M5.5 2.75h9v14.5h-9zM7.75 5.5h4.5M7.75 8h4.5M7.75 10.5h3');
export const FilmIcon = icon(
  'M4.75 4.5h10.5c.7 0 1.25.55 1.25 1.25v8.5c0 .7-.55 1.25-1.25 1.25H4.75c-.7 0-1.25-.55-1.25-1.25v-8.5c0-.7.55-1.25 1.25-1.25zM8.5 7.75v4.5l3.75-2.25z',
);
export const CloseIcon = icon('M5 5l10 10M15 5L5 15', { strokeWidth: 1.7 });
export const ChevronLeftIcon = icon('M12 4.5L6.5 10l5.5 5.5', { strokeWidth: 1.8 });
export const ChevronRightIcon = icon('M8 4.5l5.5 5.5L8 15.5', { strokeWidth: 1.8 });
export const DownloadIcon = icon('M10 3.5v9M6.25 9L10 12.75 13.75 9M4 16.25h12', { strokeWidth: 1.6 });
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
