import type { SVGAttributes } from 'preact';

type P = SVGAttributes<SVGSVGElement>;
const base: P = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': true,
  focusable: 'false',
};

export const IconChevron = (p: P) => (
  <svg {...base} {...p}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const IconChevronDown = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 9l7 7 7-7" />
  </svg>
);
export const IconChevronRight = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);
export const IconPencil = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" />
  </svg>
);
export const IconCopy = (p: P) => (
  <svg {...base} {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 012-2h9" />
  </svg>
);
export const IconTrash = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
export const IconPlay = (p: P) => (
  <svg {...base} fill="currentColor" stroke="none" {...p}>
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
);
export const IconStop = (p: P) => (
  <svg {...base} fill="currentColor" stroke="none" {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
export const IconPlus = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconMinus = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 12h14" />
  </svg>
);
export const IconGear = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10.03 4.66 L10.40 1.93 L13.60 1.93 L13.97 4.66 L15.80 5.42 L18.00 3.75 L20.25 6.00 L18.58 8.20 L19.34 10.03 L22.07 10.40 L22.07 13.60 L19.34 13.97 L18.58 15.80 L20.25 18.00 L18.00 20.25 L15.80 18.58 L13.97 19.34 L13.60 22.07 L10.40 22.07 L10.03 19.34 L8.20 18.58 L6.00 20.25 L3.75 18.00 L5.42 15.80 L4.66 13.97 L1.93 13.60 L1.93 10.40 L4.66 10.03 L5.42 8.20 L3.75 6.00 L6.00 3.75 L8.20 5.42 Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const IconSpeaker = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M17 9a4 4 0 010 6" />
  </svg>
);
export const IconSpeakerOff = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M17 9l5 6M22 9l-5 6" />
  </svg>
);
export const IconGrid = (p: P) => (
  <svg {...base} {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  </svg>
);
export const IconBot = (p: P) => (
  <svg {...base} {...p}>
    <rect x="5" y="8" width="14" height="11" rx="3" />
    <path d="M12 4v4M9 13h.01M15 13h.01M9 16.5h6" />
  </svg>
);
export const IconLoop = (p: P) => (
  <svg {...base} {...p}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a3 3 0 013-3h15" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a3 3 0 01-3 3H3" />
  </svg>
);
export const IconArrowUp = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
export const IconArrowDown = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
);
export const IconDownload = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
  </svg>
);
