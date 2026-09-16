import { getDashboardData, resolveScope } from '@/lib/data';
import EmptyState from '@/components/EmptyState';
import ScopeBar from '@/components/ScopeBar';
import { StatCard } from '@/components/Ui';
import {
  SeverityTrendChart,
  ChurnChart,
  FixVelocityChart,
  FixHeatmap,
  AgingChart,
} from '@/components/Charts';
import TrendList from '@/components/TrendList';

export const dynamic = 'force-dynamic';

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const data = getDashboardData(resolveScope((await searchParams).scope));
  if (!data.hasHistory || !data.latest) return <EmptyState />;

  const { totals } = data;
  const mttr = totals.mttrBySeverity;

  return (
    <>
      <ScopeBar
        owners={data.owners}
        scope={data.scope}
        repos={data.totals.repos}
        openAlerts={data.totals.openAlerts}
      />
      <div className="grid cards">
        <StatCard
          label="MTTR overall"
          value={totals.mttrDays === null ? '—' : `${totals.mttrDays}d`}
          hint="mean days from alert open → fixed"
        />
        <StatCard
          label="MTTR critical"
          value={mttr.critical === undefined ? '—' : `${mttr.critical}d`}
          tone="critical"
        />
        <StatCard label="MTTR high" value={mttr.high === undefined ? '—' : `${mttr.high}d`} tone="high" />
        <StatCard label="MTTR medium" value={mttr.medium === undefined ? '—' : `${mttr.medium}d`} tone="medium" />
        <StatCard
          label="Churn (7d)"
          value={`${totals.newLast7Days} in / ${totals.fixesLast7Days} out`}
          hint={`net ${totals.newLast7Days - totals.fixesLast7Days >= 0 ? '+' : ''}${
            totals.newLast7Days - totals.fixesLast7Days
          }`}
          tone={totals.fixesLast7Days >= totals.newLast7Days ? 'good' : 'high'}
        />
        <StatCard
          label="Timeline span"
          value={`${data.daily.length}d`}
          hint="reconstructed from alert timestamps"
          tone="muted"
        />
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <SeverityTrendChart data={data.daily} />
      </div>
      <div className="grid" style={{ marginBottom: 16 }}>
        <ChurnChart data={data.daily} />
      </div>
      <div className="grid two" style={{ marginBottom: 16 }}>
        <FixVelocityChart data={data.daily} />
        <AgingChart data={data.aging} />
      </div>
      <div className="grid" style={{ marginBottom: 16 }}>
        <FixHeatmap cells={data.fixHeatmap} />
      </div>
      <div className="grid two">
        <TrendList
          title="Increasing alert counts"
          subtitle={`Net new open alerts in the last ${data.trendWindowDays} days.`}
          trends={data.increasing}
          tone="up"
        />
        <TrendList
          title="Decreasing alert counts"
          subtitle={`Net alerts closed in the last ${data.trendWindowDays} days.`}
          trends={data.decreasing}
          tone="down"
        />
      </div>
    </>
  );
}
