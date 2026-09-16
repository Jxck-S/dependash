import { getDashboardData, resolveScope } from '@/lib/data';
import { StatCard } from '@/components/Ui';
import { SeverityTrendChart, SeverityPie, ChurnChart, EcosystemChart } from '@/components/Charts';
import AlertTable from '@/components/AlertTable';
import TrendList from '@/components/TrendList';
import EmptyState from '@/components/EmptyState';
import ScopeBar from '@/components/ScopeBar';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const data = getDashboardData(resolveScope((await searchParams).scope));
  if (!data.hasHistory || !data.latest) return <EmptyState />;

  const { totals, latest } = data;
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
          label="Repositories"
          value={totals.repos}
          hint={`${totals.reposEnabled} with Dependabot on · ${totals.reposDisabled} off · ${totals.reposUnknown} unknown`}
        />
        <StatCard
          label="Open alerts"
          value={totals.openAlerts}
          hint={`across ${totals.reposWithOpenAlerts} repositories`}
          tone={totals.openAlerts ? 'high' : 'good'}
        />
        <StatCard label="Critical" value={totals.bySeverity.critical} tone="critical" hint="open, unfixed" />
        <StatCard label="High" value={totals.bySeverity.high} tone="high" hint="open, unfixed" />
        <StatCard
          label="MTTR"
          value={totals.mttrDays === null ? '—' : `${totals.mttrDays}d`}
          hint="mean time to remediation (fixed alerts)"
        />
        <StatCard
          label="Fix velocity"
          value={`${totals.fixVelocityPerDay}/day`}
          hint={`${totals.fixesLast7Days} fixed vs ${totals.newLast7Days} new (7d)`}
          tone={totals.fixesLast7Days >= totals.newLast7Days ? 'good' : 'high'}
        />
        <StatCard
          label="Median open age"
          value={totals.medianAgeDays === null ? '—' : `${totals.medianAgeDays}d`}
          hint="of alerts still open"
        />
        <StatCard
          label="Last fetch"
          value={new Date(latest.meta.takenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          hint={`${latest.meta.reposScanned} repos in ${(latest.meta.durationMs / 1000).toFixed(1)}s`}
          tone="muted"
        />
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <SeverityTrendChart data={data.daily} />
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <SeverityPie counts={totals.bySeverity} />
        <EcosystemChart data={data.ecosystems} />
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <ChurnChart data={data.daily} />
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <TrendList
          title="Repos with increasing alerts"
          subtitle={`Opened minus fixed over the last ${data.trendWindowDays} days.`}
          trends={data.increasing}
          tone="up"
        />
        <TrendList
          title="Repos with decreasing alerts"
          subtitle={`Fixed minus opened over the last ${data.trendWindowDays} days.`}
          trends={data.decreasing}
          tone="down"
        />
      </div>

      <AlertTable
        alerts={data.alerts}
        lifecycles={data.lifecycles}
        title="Top 15 riskiest open alerts"
        limit={15}
      />
    </>
  );
}
