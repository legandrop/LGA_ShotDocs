const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const DocIcon = () => (
  <svg {...base}>
    <path d="M4 1.75h5.25L12.25 4.75v9.5H4z" />
    <path d="M9 1.75V5h3.25M6 8h4.25M6 10.75h4.25" />
  </svg>
);

export const PlusIcon = () => (
  <svg {...base}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const MoreIcon = () => (
  <svg {...base} fill="currentColor" stroke="none">
    <circle cx="3.5" cy="8" r="1.25" />
    <circle cx="8" cy="8" r="1.25" />
    <circle cx="12.5" cy="8" r="1.25" />
  </svg>
);

export const TrashIcon = () => (
  <svg {...base}>
    <path d="M2.75 4.25h10.5M6.25 4.25V2.5h3.5v1.75M4.25 4.25l.6 9.25h6.3l.6-9.25" />
  </svg>
);

export const MenuIcon = () => (
  <svg {...base} width={18} height={18}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </svg>
);
