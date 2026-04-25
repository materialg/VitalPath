import React from 'react';
import { VitalLog } from '../types';
import {
  XAxis,
  YAxis,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

interface Props {
  vitals: VitalLog[];
}

const WEIGHT_COLOR = '#4A8AE8';
const BF_COLOR = '#F0903D';

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

export function CompositionTrend({ vitals }: Props) {
  const chartData = [...vitals].reverse().map(log => {
    const d = new Date(log.date);
    return {
      ...log,
      displayDate: `${d.getMonth() + 1}/${d.getDate()}`
    };
  });

  const latest = vitals[0];
  const total = chartData.length;

  return (
    <div
      className="bg-white"
      style={{
        border: '0.5px solid rgba(0,0,0,0.08)',
        borderRadius: 16,
        padding: '18px 16px'
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <span className="text-xs font-bold text-[#141414]/40 uppercase tracking-widest">
          Composition Trend
        </span>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span
              className="rounded-full shrink-0"
              style={{ width: 8, height: 8, background: WEIGHT_COLOR }}
            />
            <span className="text-[#141414]/60">Weight</span>
            <span className="font-bold text-[#141414]">
              {latest ? `${latest.weight} lbs` : '—'}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="rounded-full shrink-0"
              style={{ width: 8, height: 8, background: BF_COLOR }}
            />
            <span className="text-[#141414]/60">BF%</span>
            <span className="font-bold text-[#141414]">
              {latest ? `${latest.bodyFat}%` : '—'}
            </span>
          </span>
        </div>
      </div>

      <div className="h-[220px] w-full">
        {total > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 12, right: 12, left: 4, bottom: 4 }}
            >
              <defs>
                <linearGradient id="ctGradWeight" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={WEIGHT_COLOR} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={WEIGHT_COLOR} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ctGradBF" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BF_COLOR} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={BF_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="displayDate" hide />
              <YAxis yAxisId="weight" hide domain={['dataMin', 'dataMax']} />
              <YAxis
                yAxisId="bf"
                orientation="right"
                hide
                domain={['dataMin', 'dataMax']}
              />
              <Area
                yAxisId="weight"
                type="monotone"
                dataKey="weight"
                stroke={WEIGHT_COLOR}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="url(#ctGradWeight)"
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
                fill="url(#ctGradBF)"
                dot={makeEndDot(BF_COLOR, total)}
                activeDot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-[#141414]/40 text-center px-4">
            Log at least two measurements to see your composition trend.
          </div>
        )}
      </div>
    </div>
  );
}
