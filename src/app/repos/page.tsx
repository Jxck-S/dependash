import { getDashboardData, resolveScope } from '@/lib/data';
import RepoTable from '@/components/RepoTable';
import EmptyState from '@/components/EmptyState';
import ScopeBar from '@/components/ScopeBar';
import { StatCard } from '@/components/Ui';

export const dynamic = 'force-dynamic';

export default async function ReposPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const data = getDashboardData(resolveScope((await searchParams).scope));
  if (!data.hasHistory || !data.latest) return <EmptyState />;

  const { totals } = data;
  const worst = data.repos[0];

  return (
    <>
      <ScopeBar
        owners={data.owners}
        scope={data.scope}
        repos={data.totals.repos}
        openAlerts={data.totals.openAlerts}
      />
      <div className="grid cards">
        <StatCard label="Repositories scanned" value={totals.repos} />
        <StatCard label="Dependabot enabled" value={totals.reposEnabled} tone="good" />
        <StatCard
          label="Dependabot disabled"
          value={totals.reposDisabled}
          tone="critical"
          hint="no alerting on these repos"
        />
        <StatCard
          label="Enablement unknown"
          value={totals.reposUnknown}
          tone="muted"
          hint="token lacks admin/security_events access"
        />
        <StatCard
          label="Highest risk repo"
          value={worst ? worst.riskScore : 0}
          hint={worst ? worst.fullName : '—'}
          tone="high"
        />
      </div>
      <RepoTable repos={data.repos} />
    </>
  );
}
