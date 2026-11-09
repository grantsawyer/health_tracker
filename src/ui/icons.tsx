/** Minimal stroke icons (24px grid, currentColor). Decorative: callers provide the text label. */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{children}</svg>
);

export const Icon = {
  today: () => <Svg><path {...P} d="M12 3v2M4.9 6.9l1.4 1.4M3 14h2M19 14h2M17.7 8.3l1.4-1.4M7 14a5 5 0 0 1 10 0M3 18h18M7 21h10" /></Svg>,
  fitness: () => <Svg><circle {...P} cx="14" cy="4.5" r="1.8" /><path {...P} d="M8 21l3-6 3 2v4M6 12l3-4 4 1 3 3 3 1M11 15l1.5-5" /></Svg>,
  sleep: () => <Svg><path {...P} d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /><path {...P} d="M16 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1Z" /></Svg>,
  food: () => <Svg><path {...P} d="M12 7c-1-2.5-3-3-4.5-2.5C4.5 5.5 4 9 5 12.5S8.5 20 12 20s6-4 7-7.5.5-7-2.5-8C15 4 13 4.5 12 7Z" /><path {...P} d="M12 7c0-2 1-3.5 2.5-4" /></Svg>,
  body: () => <Svg><path {...P} d="M20.5 8.5c0 5-8.5 11-8.5 11S3.5 13.5 3.5 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8.5 2.5Z" /><path {...P} d="M7 12h3l1.5-3 2 6 1.5-3h2" /></Svg>,
  data: () => <Svg><path {...P} d="M4 6h16M4 12h16M4 18h10" /></Svg>,
  account: () => <Svg><circle {...P} cx="12" cy="8.5" r="3.5" /><path {...P} d="M5 20a7 7 0 0 1 14 0" /></Svg>,
  chevronLeft: () => <Svg><path {...P} d="M15 5l-7 7 7 7" /></Svg>,
  chevronRight: () => <Svg><path {...P} d="M9 5l7 7-7 7" /></Svg>,
  chevronDown: () => <Svg><path {...P} d="M6 9l6 6 6-6" /></Svg>,
  reset: () => <Svg><path {...P} d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /><path {...P} d="M12 8v4l2.5 2" /></Svg>,
  refresh: () => <Svg><path {...P} d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" /></Svg>,
  plus: () => <Svg><path {...P} d="M12 5v14M5 12h14" /></Svg>,
  check: () => <Svg><path {...P} d="M5 12.5l4.5 4.5L19 7.5" /></Svg>,
  heart: () => <Svg><path {...P} d="M20.5 8.5c0 5-8.5 11-8.5 11S3.5 13.5 3.5 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8.5 2.5Z" /></Svg>,
  scale: () => <Svg><rect {...P} x="4" y="4" width="16" height="16" rx="4" /><path {...P} d="M9 10a3 3 0 0 1 6 0M12 10l1-1.5" /></Svg>,
  flame: () => <Svg><path {...P} d="M12 21c4 0 6.5-2.6 6.5-6.2 0-4-3.3-6.4-4.4-10.3-2.3 1.5-3.4 3.7-3.4 5.8-1.2-.7-2-2-2.2-3.3C6.6 8.6 5.5 10.9 5.5 14.8 5.5 18.4 8 21 12 21Z" /></Svg>,
  edit: () => <Svg><path {...P} d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" /></Svg>,
  bolt: () => <Svg><path {...P} d="M13 3L5 14h6l-1 7 8-11h-6Z" /></Svg>,
};
