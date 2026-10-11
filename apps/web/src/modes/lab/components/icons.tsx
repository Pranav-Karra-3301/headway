// Owner: T3d. Tiny inline icons (stroke = currentColor).
const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const IconPlay = () => (
  <svg {...base} aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" /></svg>
);
export const IconSpark = () => (
  <svg {...base} aria-hidden="true"><path d="M8 1.8l1.5 4.2 4.3 1.5-4.3 1.5L8 13.2 6.5 9 2.2 7.5 6.5 6z" fill="currentColor" stroke="none" /></svg>
);
export const IconLock = () => (
  <svg {...base} aria-hidden="true"><rect x="3.2" y="7" width="9.6" height="6.8" rx="1.8" /><path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" /></svg>
);
export const IconCheck = () => (
  <svg {...base} aria-hidden="true"><path d="M3.5 8.4l2.8 2.8 6.2-6.4" /></svg>
);
export const IconX = () => (
  <svg {...base} aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
);
export const IconArrow = () => (
  <svg {...base} aria-hidden="true"><path d="M3 8h9.5M9 4.5L12.5 8 9 11.5" /></svg>
);
