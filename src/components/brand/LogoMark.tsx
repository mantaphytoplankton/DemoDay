/** A play button built from five score bars, tallest (5, sky) to shortest (1, coral). ui-guideline.md section 2.2. */
const BARS: [number, number, number, string][] = [
  [3, 4, 24, "var(--color-score-5)"],
  [8.6, 7, 18, "var(--color-score-4)"],
  [14.2, 10, 12, "var(--color-score-3)"],
  [19.8, 12.5, 7, "var(--color-score-2)"],
  [25.4, 14.5, 3, "var(--color-score-1)"],
];

export function LogoMark({ size }: { size: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {BARS.map(([x, y, h, fill], i) => (
        <rect key={i} style={{ "--i": i } as React.CSSProperties} x={x} y={y} width="3.6" height={h} rx="1.6" fill={fill} />
      ))}
    </svg>
  );
}
