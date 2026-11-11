const compact = new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 1 });

export type Series = { label: string; points: [number, number][] };

/** A small SVG line chart of values by year. Colors come from CSS custom properties --viz-0, --viz-1, ... */
export const LineChart = ({ series, width = 280, height = 96 }: { series: Series[]; width?: number; height?: number }) => {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;
  const pad = { left: 44, right: 8, top: 8, bottom: 18 };
  const xs = all.map((p) => p[0]);
  const top = Math.max(...all.map((p) => p[1]));
  const [x0, x1, y1] = [Math.min(...xs), Math.max(...xs), top * 1.05];
  const x = (v: number) => pad.left + ((v - x0) / Math.max(x1 - x0, 1)) * (width - pad.left - pad.right);
  const y = (v: number) => height - pad.bottom - (v / (y1 || 1)) * (height - pad.top - pad.bottom);
  const color = (i: number) => `var(--viz-${i}, currentColor)`;
  return (
    <figure className="viz-line">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" fontSize={10} fill="currentColor">
        <text x={pad.left - 4} y={y(top) + 4} textAnchor="end">{compact.format(top)}</text>
        <text x={pad.left - 4} y={y(0)} textAnchor="end">0</text>
        <text x={x(x0)} y={height - 4}>{x0}</text>
        <text x={x(x1)} y={height - 4} textAnchor="end">{x1}</text>
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.3} />
        {series.map((s, i) => (
          <g key={s.label} stroke={color(i)} fill={color(i)}>
            <polyline fill="none" strokeWidth={1.5} points={s.points.map(([a, b]) => `${x(a)},${y(b)}`).join(" ")} />
            {s.points.map(([a, b]) => (
              <circle key={a} cx={x(a)} cy={y(b)} r={2}>
                <title>{`${s.label} ${a}: ${b.toLocaleString()}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      {series.length > 1 && (
        <figcaption>
          {series.map((s, i) => (
            <span key={s.label} style={{ color: color(i) }}>● {s.label} </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
};
