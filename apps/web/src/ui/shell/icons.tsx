// Small inline icons (T3a). 20 px, currentColor, rounded strokes to match the toy look.
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const SunIcon = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5L7 17M17 7l1.5-1.5" />
  </svg>
);

export const MoonIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6Z" />
  </svg>
);

export const InfoIcon = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.1" />
  </svg>
);

export const NextIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const RestartIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4.5V9h4.5" />
  </svg>
);
