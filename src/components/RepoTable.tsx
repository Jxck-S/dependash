'use client';

import { useMemo, useState } from 'react';
import { RepoMetric } from '@/lib/types';
import { Delta, EnabledBadge, RepoFlags } from './Ui';

type SortKey =
  | 'fullName'
  | 'riskScore'
  | 'healthScore'
  | 'openAlerts'
  | 'critical'
  | 'high'
  | 'mttrDays'
  | 'oldestOpenAlertDays'
  | 'delta';

type Filter = 'all' | 'enabled' | 'disabled' | 'unknown' | 'with-alerts' | 'archived' | 'active';

const PAGE_SIZE = 25;

/** Sort choices for the phone layout, where there are no clickable headers. */
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'riskScore', label: 'Risk' },
  { key: 'openAlerts', label: 'Open alerts' },
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'delta', label: 'Δ 7d' },
  { key: 'healthScore', label: 'Health' },
  { key: 'mttrDays', label: 'MTTR' },
  { key: 'oldestOpenAlertDays', label: 'Oldest alert' },
  { key: 'fullName', label: 'Name' },
];

export default function RepoTable({ repos }: { repos: RepoMetric[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('riskScore');
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = repos.filter((r) => {
      if (q && !r.fullName.toLowerCase().includes(q) && !(r.language ?? '').toLowerCase().includes(q)) {
        return false;
      }
      if (filter === 'enabled') return r.dependabotAlertsEnabled === true;
      if (filter === 'disabled') return r.dependabotAlertsEnabled === false;
      if (filter === 'unknown') return r.dependabotAlertsEnabled === null;
      if (filter === 'with-alerts') return r.openAlerts > 0;
      if (filter === 'archived') return r.archived;
      if (filter === 'active') return !r.archived;
      return true;
    });
    const value = (r: RepoMetric): number | string => {
      switch (sortKey) {
        case 'fullName':
          return r.fullName.toLowerCase();
        case 'critical':
          return r.openBySeverity.critical;
        case 'high':
          return r.openBySeverity.high;
        case 'mttrDays':
          return r.mttrDays ?? -1;
        case 'oldestOpenAlertDays':
          return r.oldestOpenAlertDays ?? -1;
        default:
          return r[sortKey] as number;
      }
    };
    list = [...list].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return asc ? cmp : -cmp;
    });
    return list;
  }, [repos, query, filter, sortKey, asc]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const sort = (key: SortKey) => {
    if (key === sortKey) setAsc(!asc);
    else {
      setSortKey(key);
      setAsc(key === 'fullName');
    }
    setPage(0);
  };
  const arrow = (key: SortKey) => (sortKey === key ? (asc ? ' ▲' : ' ▼') : '');

  return (
    <div className="panel">
      <h2>Repositories</h2>
      <p className="sub">
        Every repo visible to your token. Repo name links to GitHub; “Dependabot” links straight to that
        repo&apos;s Dependabot alerts page.
      </p>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter by name or language…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setPage(0);
          }}
        >
          <option value="all">All repos</option>
          <option value="enabled">Dependabot enabled</option>
          <option value="disabled">Dependabot disabled</option>
          <option value="unknown">Enablement unknown</option>
          <option value="with-alerts">With open alerts</option>
          <option value="active">Active (not archived)</option>
          <option value="archived">Archived only</option>
        </select>
        <select
          className="mobile-only"
          value={sortKey}
          onChange={(e) => {
            const key = e.target.value as SortKey;
            setSortKey(key);
            setAsc(key === 'fullName');
            setPage(0);
          }}
          aria-label="Sort by"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              Sort: {o.label}
            </option>
          ))}
        </select>
        <span className="muted">{rows.length} repos</span>
      </div>

      {/* Table on wide screens, cards on phones (toggled in CSS). */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th onClick={() => sort('fullName')}>Repository{arrow('fullName')}</th>
              <th>Dependabot</th>
              <th className="num" onClick={() => sort('openAlerts')}>Open{arrow('openAlerts')}</th>
              <th className="num" onClick={() => sort('critical')}>Crit{arrow('critical')}</th>
              <th className="num" onClick={() => sort('high')}>High{arrow('high')}</th>
              <th className="num">Med</th>
              <th className="num">Low</th>
              <th className="num" onClick={() => sort('delta')} title="Alerts opened minus closed in the last 7 days">Δ 7d{arrow('delta')}</th>
              <th className="num" onClick={() => sort('riskScore')}>Risk{arrow('riskScore')}</th>
              <th className="num" onClick={() => sort('healthScore')}>Health{arrow('healthScore')}</th>
              <th className="num" onClick={() => sort('mttrDays')}>MTTR{arrow('mttrDays')}</th>
              <th className="num" onClick={() => sort('oldestOpenAlertDays')}>
                Oldest{arrow('oldestOpenAlertDays')}
              </th>
              <th>Lang</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.fullName}>
                <td>
                  <a href={r.htmlUrl} target="_blank" rel="noreferrer">
                    {r.fullName}
                  </a>
                  <RepoFlags archived={r.archived} isPrivate={r.private} fork={r.fork} />
                  {r.error && (
                    <div className="muted mono" title={r.error}>
                      ⚠ {r.error.slice(0, 60)}
                    </div>
                  )}
                </td>
                <td>
                  <a href={r.dependabotUrl} target="_blank" rel="noreferrer" title="Open Dependabot alerts on GitHub">
                    <EnabledBadge enabled={r.dependabotAlertsEnabled} archived={r.archived} />
                  </a>
                </td>
                <td className="num">{r.openAlerts}</td>
                <td className="num" style={{ color: r.openBySeverity.critical ? 'var(--critical)' : undefined }}>
                  {r.openBySeverity.critical}
                </td>
                <td className="num" style={{ color: r.openBySeverity.high ? 'var(--high)' : undefined }}>
                  {r.openBySeverity.high}
                </td>
                <td className="num">{r.openBySeverity.medium}</td>
                <td className="num">{r.openBySeverity.low}</td>
                <td className="num">
                  <Delta value={r.delta} />
                </td>
                <td className="num">{r.riskScore}</td>
                <td className="num" style={{ color: r.healthScore >= 80 ? 'var(--good)' : undefined }}>
                  {r.healthScore}
                </td>
                <td className="num">{r.mttrDays === null ? '—' : `${r.mttrDays}d`}</td>
                <td className="num">
                  {r.oldestOpenAlertDays === null ? '—' : `${r.oldestOpenAlertDays}d`}
                </td>
                <td className="muted">{r.language ?? '—'}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={13} className="empty">
                  No repositories match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="card-list">
        {visible.map((r) => (
          <RepoCard key={r.fullName} repo={r} />
        ))}
        {visible.length === 0 && <div className="empty">No repositories match this filter.</div>}
      </div>

      <div className="pager">
        <button className="pg" onClick={() => setPage(current - 1)} disabled={current === 0}>
          ← Prev
        </button>
        <span>
          Page {current + 1} of {pageCount}
        </span>
        <button className="pg" onClick={() => setPage(current + 1)} disabled={current >= pageCount - 1}>
          Next →
        </button>
      </div>
    </div>
  );
}

function RepoCard({ repo: r }: { repo: RepoMetric }) {
  const sev = r.openBySeverity;
  const worst = (['critical', 'high', 'medium', 'low'] as const).find((s) => sev[s] > 0);
  return (
    <div className={`m-card${worst ? ` sev-${worst}` : ''}`}>
      <div className="m-card-top">
        <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="m-card-title">
          {r.fullName}
        </a>
        <a href={r.dependabotUrl} target="_blank" rel="noreferrer" title="Open Dependabot alerts on GitHub">
          <EnabledBadge enabled={r.dependabotAlertsEnabled} archived={r.archived} />
        </a>
      </div>
      <RepoFlags archived={r.archived} isPrivate={r.private} fork={r.fork} />
      {r.error && <div className="muted mono m-card-sub">⚠ {r.error.slice(0, 80)}</div>}
      <div className="m-sev">
        <span>
          <strong>{r.openAlerts}</strong> open
        </span>
        <span style={{ color: sev.critical ? 'var(--critical)' : undefined }}>{sev.critical} crit</span>
        <span style={{ color: sev.high ? 'var(--high)' : undefined }}>{sev.high} high</span>
        <span>{sev.medium} med</span>
        <span>{sev.low} low</span>
      </div>
      <dl className="m-stats">
        <div>
          <dt>Risk</dt>
          <dd>{r.riskScore}</dd>
        </div>
        <div>
          <dt>Health</dt>
          <dd style={{ color: r.healthScore >= 80 ? 'var(--good)' : undefined }}>{r.healthScore}</dd>
        </div>
        <div>
          <dt>Δ 7d</dt>
          <dd>
            <Delta value={r.delta} />
          </dd>
        </div>
        <div>
          <dt>MTTR</dt>
          <dd>{r.mttrDays === null ? '—' : `${r.mttrDays}d`}</dd>
        </div>
        <div>
          <dt>Oldest</dt>
          <dd>{r.oldestOpenAlertDays === null ? '—' : `${r.oldestOpenAlertDays}d`}</dd>
        </div>
        <div>
          <dt>Lang</dt>
          <dd className="muted">{r.language ?? '—'}</dd>
        </div>
      </dl>
    </div>
  );
}
