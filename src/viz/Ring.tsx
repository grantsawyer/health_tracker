/**
 * Progress ring toward a goal (e.g. steps). The arc starts at the bottom and
 * sweeps clockwise; past the goal it stays full. Numbers are the main text,
 * so the ring itself is decorative for screen readers.
 */
export function Ring({ value, goal, label, valueText, goalText }: { value: number; goal: number; label: string; valueText: string; goalText: string }) {
  const size = 260, stroke = 34, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const frac = goal > 0 ? Math.min(1, Math.max(0, value / goal)) : 0;
  const visible = frac > 0 ? Math.max(frac, 0.03) : 0; // tiny progress still shows a nub
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${valueText} ${goalText}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--viz-track)" strokeWidth={stroke} />
      {visible > 0 && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--activity)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${visible * c} ${c}`} transform={`rotate(90 ${size / 2} ${size / 2})`} />
      )}
      <text className="ring-label" x={size / 2} y={size / 2 - 38} textAnchor="middle">{label}</text>
      <text className="ring-value" x={size / 2} y={size / 2 + 14} textAnchor="middle">{valueText}</text>
      <text className="ring-goal" x={size / 2} y={size / 2 + 44} textAnchor="middle">{goalText}</text>
    </svg>
  );
}
