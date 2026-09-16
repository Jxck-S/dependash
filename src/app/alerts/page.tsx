import { getDashboardData, resolveScope } from '@/lib/data';
import AlertTable from '@/components/AlertTable';
import EmptyState from '@/components/EmptyState';
import ScopeBar from '@/components/ScopeBar';
import { StatCard } from '@/components/Ui';
import { AgingChart } from '@/components/Charts';

export const dynamic = 'force-dynamic';

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const data = getDashboardData(resolveScope((await searchParams).scope));
  if (!data.hasHistory || !data.latest) return <EmptyState />;

  const { totals } = data;
  return (
    <>
      <ScopeBar
        owners={data.owners}
        scope={data.scope}
        repos={data.totals.repos}
        openAlerts={data.totals.openAlerts}
      />
      <div className="grid cards">
        <StatCard label="Open" value={totals.openAlerts} />
        <StatCard label="Critical" value={totals.bySeverity.critical} tone="critical" />
        <StatCard label="High" value={totals.bySeverity.high} tone="high" />
        <StatCard label="Medium" value={totals.bySeverity.medium} tone="medium" />
        <StatCard label="Low" value={totals.bySeverity.low} tone="low" />
        <StatCard
          label="Median age"
          value={totals.medianAgeDays === null ? '—' : `${totals.medianAgeDays}d`}
          tone="muted"
        />
      </div>
      <div style={{ marginBottom: 16 }}>
        <AgingChart data={data.aging} />
      </div>
      <AlertTable alerts={data.alerts} lifecycles={data.lifecycles} title="All open alerts" />
    </>
  );
}
