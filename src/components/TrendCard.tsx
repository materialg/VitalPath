import React from 'react';

type Point = { date: string | Date; value: number };

type Props = {
  weightData: Point[]; // last 14 entries, ascending by date
  bfData: Point[];     // last 14 entries, ascending by date
};

// Catmull-Rom to Bezier smooth path through points
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function scale(values: number[], width: number, height: number, padTop = 0.2, padBot = 0.1) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((v, i) => ({
    x: (i / (values.length - 1)) * width,
    y: height - (((v - min) / range) * height * (1 - padTop - padBot)) - height * padBot,
  }));
}

export default function TrendCard({ weightData, bfData }: Props) {
  const W = 340;
  const H = 220;
  const chartTop = 100; // text block ends here
  const chartH = H - chartTop;

  const wValues = weightData.map(p => p.value);
  const bfValues = bfData.map(p => p.value);

  const wPts = scale(wValues, W, chartH).map(p => ({ x: p.x, y: p.y + chartTop }));
  const bfPts = scale(bfValues, W, chartH).map(p => ({ x: p.x, y: p.y + chartTop }));

  const wLine = smoothPath(wPts);
  const bfLine = smoothPath(bfPts);
  const wArea = `${wLine} L ${W} ${H} L 0 ${H} Z`;
  const bfArea = `${bfLine} L ${W} ${H} L 0 ${H} Z`;

  const weightCurrent = wValues[wValues.length - 1];
  const bfCurrent = bfValues[bfValues.length - 1];
  const weightDelta = weightCurrent - wValues[0];
  const bfDelta = bfCurrent - bfValues[0];

  const fmtDelta = (d: number, unit: string) =>
    `${d < 0 ? '↓' : '↑'} ${Math.abs(d).toFixed(1)}${unit}`;

  return (
    <div style={{
      background: '#FFF3EA',
      borderRadius: 16,
      overflow: 'hidden',
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        <defs>
          <linearGradient id="tc-w" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C44A1F" stopOpacity="0.95" />
            <stop offset="50%" stopColor="#E8743C" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#FFF3EA" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="tc-bf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1F4FA8" stopOpacity="1" />
            <stop offset="40%" stopColor="#3268C8" stopOpacity="0.75" />
            <stop offset="80%" stopColor="#5B8DEF" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#5B8DEF" stopOpacity="0.25" />
          </linearGradient>
        </defs>

        <rect width={W} height={H} fill="#FFF3EA" />

        <text x="20" y="36" fontSize="10" fontWeight="500" fill="#A86A4A" letterSpacing="1.5">
          LAST 14 DAYS
        </text>
        <text x="20" y="66" fontSize="20" fontWeight="500" fill="#3A1F12">
          {weightCurrent.toFixed(1)} lbs · {bfCurrent.toFixed(1)}% body fat
        </text>
        <text x="20" y="88" fontSize="13" fill="#993C1D">
          {fmtDelta(weightDelta, ' lbs')} · {fmtDelta(bfDelta, '%')}
        </text>

        {/* BF behind */}
        <path d={bfArea} fill="url(#tc-bf)" />
        <path d={bfLine} fill="none" stroke="#1F4FA8" strokeWidth="2" strokeLinecap="round" />

        {/* Weight in front */}
        <path d={wArea} fill="url(#tc-w)" />
        <path d={wLine} fill="none" stroke="#C44A1F" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}
