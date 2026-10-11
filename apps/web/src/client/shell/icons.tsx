/** Minimal 16px stroke icons for the shell nav. Colour comes from `currentColor`. */
import type { SVGProps } from 'react';

function Icon({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-4 shrink-0"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconMission = () => (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);
export const IconPlan = () => (
  <Icon>
    <rect x="2" y="2" width="12" height="12" rx="2" />
    <path d="M5 6h6M5 10h4" />
  </Icon>
);
export const IconTasks = () => (
  <Icon>
    <path d="M6 4h8M6 8h8M6 12h8" />
    <path d="M2 4h.01M2 8h.01M2 12h.01" />
  </Icon>
);
export const IconTeam = () => (
  <Icon>
    <circle cx="6" cy="5.5" r="2.5" />
    <path d="M1.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
    <path d="M11 3.5a2.5 2.5 0 0 1 0 4.5M12.5 10c1.2.5 2 1.8 2 4" />
  </Icon>
);
export const IconCode = () => (
  <Icon>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.5-2 3-7 4" />
  </Icon>
);
export const IconAgents = () => (
  <Icon>
    <rect x="2.5" y="5" width="11" height="8" rx="2" />
    <path d="M8 2v3M6 9h.01M10 9h.01" />
  </Icon>
);
export const IconSettings = () => (
  <Icon>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </Icon>
);

/* Small glyphs for the rail countdown, switchers and menus. */
export const IconChevronsUpDown = () => (
  <Icon className="size-3.5 shrink-0">
    <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />
  </Icon>
);
export const IconCheck = () => (
  <Icon className="size-3.5 shrink-0">
    <path d="M3.5 8.5l3 3 6-7" />
  </Icon>
);
export const IconPlus = () => (
  <Icon className="size-3.5 shrink-0">
    <path d="M8 3v10M3 8h10" />
  </Icon>
);
export const IconClock = () => (
  <Icon className="size-3.5 shrink-0">
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </Icon>
);
export const IconAlert = () => (
  <Icon className="size-3.5 shrink-0">
    <path d="M8 2l6.5 11.5h-13z" />
    <path d="M8 6.5v3M8 11.5h.01" />
  </Icon>
);
export const IconFlag = () => (
  <Icon className="size-3.5 shrink-0">
    <path d="M3.5 14V2.5M3.5 3h8l-1.5 3 1.5 3h-8" />
  </Icon>
);
export const IconMenu = () => (
  <Icon>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </Icon>
);
