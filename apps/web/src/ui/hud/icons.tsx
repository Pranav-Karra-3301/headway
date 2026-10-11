// Owner: T3b. Tiny inline icons (currentColor, rounded strokes) so nothing looks like default browser UI.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
});

export const BusIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="4" y="3.5" width="16" height="14" rx="3.5" />
    <path d="M4 10.5h16M8 21v-3.5M16 21v-3.5" />
    <circle cx="8.5" cy="14" r=".6" fill="currentColor" />
    <circle cx="15.5" cy="14" r=".6" fill="currentColor" />
  </svg>
);
export const TrainIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="5" y="3" width="14" height="14" rx="4" />
    <path d="M5 10h14M8.5 21l2-4M15.5 21l-2-4" />
    <circle cx="9" cy="13.5" r=".6" fill="currentColor" />
    <circle cx="15" cy="13.5" r=".6" fill="currentColor" />
  </svg>
);
export const StopIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 21V11" />
    <rect x="6" y="3" width="12" height="8" rx="4" />
    <path d="M9 7h6" />
  </svg>
);
export const PersonIcon = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="6.5" r="3" />
    <path d="M6.5 20.5v-3a5.5 5.5 0 0 1 11 0v3" />
  </svg>
);
export const CloseIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M7 7l10 10M17 7L7 17" /></svg>
);
export const PlayIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
);
export const PauseIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth={3.4} /></svg>
);
export const AlertIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 7.5v6" strokeWidth={2.8} /><circle cx="12" cy="17.5" r="1.2" fill="currentColor" stroke="none" /></svg>
);
export const TransferIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 9h12l-3.5-3.5M19 15H7l3.5 3.5" /></svg>
);
export const MissedIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="7.5" /><path d="M12 8v4l2.5 2.5" /></svg>
);
export const WalkIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="13" cy="4.5" r="2" /><path d="M9.5 21l2.5-6.5 3 3V21M12 14.5l-1-5 4 2 2.5-1M11 9.5l-3 2.5" /></svg>
);
export const InfoIcon = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 11v6" strokeWidth={2.8} /><circle cx="12" cy="7" r="1.2" fill="currentColor" stroke="none" /></svg>
);
