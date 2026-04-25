import React from 'react';
import { VitalLog } from '../types';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

interface Props {
  vitals: VitalLog[];
}

const WEIGHT_COLOR = '#4A8AE8';
const BF_COLOR = '#F0903D';
const WEIGHT_DELTA_COLOR = '#185FA5';
const BF_DELTA_COLOR = '#BA7517';
const TEXT_GRAY = '#6B7280';
const TEXT_DARK = '#111827';
const TICK_GRAY = '#9CA3AF';
const DELTA_BG = '#F3F4F6';

const WEIGHT_DOMAIN: [number, number] = [180, 194];
const WEIGHT_TICKS = [180, 184, 189, 194];
const BF_DOMAIN: [number, number] = [21, 27];
const BF_TICKS = [21, 23, 25, 27];

const formatMDShort = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

function smooth(values: number[], window = 7): number[] {
  return values.map((_, i) => {
    const start = Math.max(0, i - (window - 1));
    const slice = values.slice(start, i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

function makeEndDot(color: string, total: number) {
  return (props: any) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null || index !== total - 1) return null;
    return (
      <g key={`end-${color}-${index}`}>
        <circle cx={cx} cy={cy} r={5} fill="#fff" />
        <circle cx={cx} cy={cy} r={3.5} fill={color} />
      </g>
    );
  };
}

function formatDelta(d: number, suffix: string): string {
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}${suffix}`;
}

export function CompositionTrend({ vitals }: Props) {
  const sorted = [...vitals]
    .filter(v => typeof v.weight === 'number' && typeof v.bodyFat === 'number')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const cardStyle: React.CSSProperties = {
    border: '0.5px solid rgba(0,0,0,0.08)',
    borderRadius: 16,
    padding: '18px 16px'
  };

  if (sorted.length < 2) {
    return (
      <div className="bg-white" style={cardStyle}>
        <div
          className="flex items-center justify-center text-sm text-center px-4"
          style={{ height: 240, color: TICK_GRAY }}
        >
          Log at least two measurements to see your composition trend.
        </div>
      </div>
    );
  }

  const weightsSmooth = smooth(sorted.map(v => v.weight), 7);
  const bfsSmooth = smooth(sorted.map(v => v.bodyFat), 7);

  const chartData = sorted.map((v, i) => ({
    ts: new Date(v.date).getTime(),
    weight: weightsSmooth[i],
    bodyFat: bfsSmooth[i]
  }));

  const minTs = chartData[0].ts;
  const maxTs = chartData[chartData.length - 1].ts;
  const xTicks = Array.from({ length: 5 }, (_, i) =>
    Math.round(minTs + ((maxTs - minTs) * i) / 4)
  );

  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  const weightDelta = latest.weight - earliest.weight;
  const bfDelta = latest.bodyFat - earliest.bodyFat;

  const total = chartData.length;

  return (
    <div className="bg-white" style={cardStyle}>
      <div className="flex items-center justify-center gap-3 mb-3 flex-wrap" style={{ fontSize: 12 }}>
        <span className="flex items-center gap-1.5">
          <span
            className="rounded-full shrink-0"
            style={{ width: 8, height: 8, background: WEIGHT_COLOR }}
          />
          <span style={{ color: TEXT_GRAY }}>Weight</span>
          <span style={{ color: TEXT_DARK, fontWeight: 700 }}>
            {latest.weight} lbs
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="rounded-full shrink-0"
            style={{ width: 8, height: 8, background: BF_COLOR }}
          />
          <span style={{ color: TEXT_GRAY }}>BF%</span>
          <span style={{ color: TEXT_DARK, fontWeight: 700 }}>
            {latest.bodyFat}%
          </span>
        </span>
      </div>

      <div style={{ height: 220, width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 4, left: 4, bottom: 0 }}
          >
            <defs>
              <linearGradient id="ctV2GradWeight" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={WEIGHT_COLOR} stopOpacity={0.18} />
                <stop offset="100%" stopColor={WEIGHT_COLOR} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="ctV2GradBF" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={BF_COLOR} stopOpacity={0.14} />
                <stop offset="100%" stopColor={BF_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid
              vertical={false}
              strokeDasharray="2 3"
              stroke="rgba(0,0,0,0.08)"
            />

            <XAxis
              dataKey="ts"
              type="number"
              domain={[minTs, maxTs]}
              ticks={xTicks}
              tickFormatter={formatMDShort}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 9, fill: TICK_GRAY }}
            />

            <YAxis
              yAxisId="weight"
              orientation="left"
              domain={WEIGHT_DOMAIN}
              ticks={WEIGHT_TICKS}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 9, fill: TICK_GRAY }}
              width={30}
              allowDataOverflow
            />

            <YAxis
              yAxisId="bf"
              orientation="right"
              domain={BF_DOMAIN}
              ticks={BF_TICKS}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 9, fill: TICK_GRAY }}
              width={24}
              allowDataOverflow
            />

            <Area
              yAxisId="weight"
              type="monotone"
              dataKey="weight"
              stroke={WEIGHT_COLOR}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="url(#ctV2GradWeight)"
              dot={makeEndDot(WEIGHT_COLOR, total)}
              activeDot={false}
              isAnimationActive={false}
            />
            <Area
              yAxisId="bf"
              type="monotone"
              dataKey="bodyFat"
              stroke={BF_COLOR}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="url(#ctV2GradBF)"
              dot={makeEndDot(BF_COLOR, total)}
              activeDot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex gap-2 mt-3">
        <DeltaCard
          label="Weight Δ"
          value={formatDelta(weightDelta, ' lbs')}
          color={WEIGHT_DELTA_COLOR}
        />
        <DeltaCard
          label="BF% Δ"
          value={formatDelta(bfDelta, '%')}
          color={BF_DELTA_COLOR}
        />
      </div>
    </div>
  );
}

function DeltaCard({
  label,
  value,
  color
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className="flex-1"
      style={{
        background: DELTA_BG,
        borderRadius: 8,
        padding: '10px 12px'
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.4px',
          color: TEXT_GRAY,
          textTransform: 'uppercase'
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 500,
          color,
          marginTop: 2
        }}
      >
        {value}
      </div>
    </div>
  );
}
