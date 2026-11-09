export type PillTone = "good" | "warn" | "info";

/** Status pill. Color is never the only signal: the text always states the status. */
export function Pill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export interface Status {
  tone: PillTone;
  text: string;
}
