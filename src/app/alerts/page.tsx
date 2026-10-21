'use client';

import { useDashboard } from '@/components/DataProvider';
import Loading from '@/components/Loading';
import AlertTable from '@/components/AlertTable';
import EmptyState from '@/components/EmptyState';
import ScopeBar from '@/components/ScopeBar';
import { StatCard } from '@/components/Ui';
import { AgingChart } from '@/components/Charts';

export default function AlertsPage() {
  const data = useDashboard();
  if (!data) return <Loading />;
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
