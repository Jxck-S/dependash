'use client';

/**
 * All chart components. Each one takes plain serializable data computed on the
 * server by src/lib/metrics.ts — no fetching happens in the browser.
 */

import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AgingBucket, DailyPoint, EcosystemBreakdown, FixVelocityCell } from '@/lib/types';

const COLORS = {
  critical: '#f85149',
  high: '#ff8c42',
  medium: '#e3b341',
  low: '#58a6ff',
  open: '#4f9cf9',
  fixed: '#3fb950',
  dismissed: '#8b9bb4',
  grid: '#22304a',
  axis: '#8b9bb4',
};

const tooltipStyle = {
  background: '#121926',
  border: '1px solid #22304a',
  borderRadius: 8,
  fontSize: 12,
};

const RANGES = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
  { label: 'All', days: 0 },
];

function useRange(data: DailyPoint[], defaultDays = 90) {
  const [days, setDays] = useState(defaultDays);
  const sliced = useMemo(
    () => (days > 0 ? data.slice(-days) : data),
    [data, days],
  );
  const picker = (
    <div style={{ display: 'flex', gap: 4 }}>
      {RANGES.map((r) => (
        <button
          key={r.label}
          className="pg"
          onClick={() => setDays(r.days)}
          style={days === r.days ? { borderColor: '#4f9cf9', color: '#4f9cf9' } : undefined}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
  return { sliced, picker };
}

function axisProps() {
  return {
    stroke: COLORS.axis,
    tick: { fill: COLORS.axis, fontSize: 11 },
    tickLine: false,
  } as const;
}

/** Open alerts over time, stacked by severity. */
export function SeverityTrendChart({ data }: { data: DailyPoint[] }) {
  const { sliced, picker } = useRange(data);
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2>Open alerts over time</h2>
          <p className="sub">Reconstructed daily from each alert’s open / fix timestamps.</p>
        </div>
        {picker}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={sliced} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" {...axisProps()} minTickGap={28} />
          <YAxis {...axisProps()} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
            <Area
              key={sev}
              type="monotone"
              dataKey={sev}
              stackId="sev"
              stroke={COLORS[sev]}
              fill={COLORS[sev]}
              fillOpacity={0.35}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Alert churn: created vs fixed vs dismissed per day. */
export function ChurnChart({ data }: { data: DailyPoint[] }) {
  const { sliced, picker } = useRange(data);
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2>Alert churn (created vs fixed)</h2>
          <p className="sub">Bars: new / fixed / dismissed per day. Line: net change.</p>
        </div>
        {picker}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={sliced} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" {...axisProps()} minTickGap={28} />
          <YAxis {...axisProps()} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="newAlerts" name="new" fill={COLORS.critical} radius={[2, 2, 0, 0]} />
          <Bar dataKey="fixedAlerts" name="fixed" fill={COLORS.fixed} radius={[2, 2, 0, 0]} />
          <Bar dataKey="dismissedAlerts" name="dismissed" fill={COLORS.dismissed} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cumulative fixes — fix velocity. */
export function FixVelocityChart({ data }: { data: DailyPoint[] }) {
  const { sliced, picker } = useRange(data);
  const cumulative = useMemo(() => {
    let total = 0;
    return sliced.map((d) => {
      total += d.fixedAlerts;
      return { date: d.date, fixed: d.fixedAlerts, cumulative: total };
    });
  }, [sliced]);
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2>Fix velocity</h2>
          <p className="sub">Daily fixes and the running total over the window.</p>
        </div>
        {picker}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={cumulative} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" {...axisProps()} minTickGap={28} />
          <YAxis {...axisProps()} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="fixed" stroke={COLORS.fixed} dot={false} strokeWidth={2} />
          <Line
            type="monotone"
            dataKey="cumulative"
            stroke={COLORS.open}
            dot={false}
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SeverityPie({
  counts,
}: {
  counts: { critical: number; high: number; medium: number; low: number };
}) {
  const data = (['critical', 'high', 'medium', 'low'] as const)
    .map((sev) => ({ name: sev, value: counts[sev] }))
    .filter((d) => d.value > 0);
  return (
    <div className="panel">
      <h2>Severity distribution</h2>
      <p className="sub">Currently open alerts across all repositories.</p>
      {data.length === 0 ? (
        <div className="empty">No open alerts 🎉</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={100} paddingAngle={2}>
              {data.map((d) => (
                <Cell key={d.name} fill={COLORS[d.name as keyof typeof COLORS]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function EcosystemChart({ data }: { data: EcosystemBreakdown[] }) {
  return (
    <div className="panel">
      <h2>Ecosystem breakdown</h2>
      <p className="sub">Open alerts by package ecosystem, split by severity.</p>
      {data.length === 0 ? (
        <div className="empty">No open alerts.</div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34)}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" {...axisProps()} allowDecimals={false} />
            <YAxis type="category" dataKey="ecosystem" {...axisProps()} width={80} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
              <Bar key={sev} dataKey={sev} stackId="s" fill={COLORS[sev]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function AgingChart({ data }: { data: AgingBucket[] }) {
  return (
    <div className="panel">
      <h2>Alert aging</h2>
      <p className="sub">How long currently-open alerts have been open.</p>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" {...axisProps()} />
          <YAxis {...axisProps()} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
            <Bar key={sev} dataKey={sev} stackId="a" fill={COLORS[sev]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** GitHub-contributions-style heatmap of fixes per day. */
export function FixHeatmap({ cells, weeks = 12 }: { cells: FixVelocityCell[]; weeks?: number }) {
  const byDate = new Map<string, number>();
  for (const c of cells) byDate.set(c.date, (byDate.get(c.date) ?? 0) + c.fixes);

  const today = new Date();
  const days: { date: string; fixes: number }[] = [];
  for (let i = weeks * 7 - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, fixes: byDate.get(key) ?? 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.fixes));
  const columns: { date: string; fixes: number }[][] = [];
  for (let i = 0; i < days.length; i += 7) columns.push(days.slice(i, i + 7));

  return (
    <div className="panel">
      <h2>Fix velocity heatmap</h2>
      <p className="sub">Fixes per day over the last {weeks} weeks (darker = more fixes).</p>
      <div className="heatmap">
        {columns.map((col, i) => (
          <div className="col" key={i}>
            {col.map((d) => (
              <div
                key={d.date}
                className="cell"
                title={`${d.date}: ${d.fixes} fix${d.fixes === 1 ? '' : 'es'}`}
                style={
                  d.fixes
                    ? {
                        background: `rgba(63, 185, 80, ${0.2 + 0.8 * (d.fixes / max)})`,
                        borderColor: 'rgba(63,185,80,0.5)',
                      }
                    : undefined
                }
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
