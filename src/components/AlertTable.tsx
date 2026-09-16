'use client';

import { useMemo, useState } from 'react';
import { AlertRecord, LifecycleRecord, SEVERITIES, Severity } from '@/lib/types';
import { SeverityBadge } from './Ui';

const PAGE_SIZE = 40;
const WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export default function AlertTable({
  alerts,
  lifecycles,
  title = 'Open alerts',
  limit,
}: {
  alerts: AlertRecord[];
  lifecycles: LifecycleRecord[];
  title?: string;
  limit?: number;
}) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState<'all' | Severity>('all');
  const [ecosystem, setEcosystem] = useState('all');
  const [page, setPage] = useState(0);

  const ageByKey = useMemo(
    () => new Map(lifecycles.map((l) => [l.key, l.ageDays])),
    [lifecycles],
  );
  const ecosystems = useMemo(
    () => [...new Set(alerts.map((a) => a.ecosystem))].sort(),
    [alerts],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = alerts.filter((a) => {
      if (severity !== 'all' && a.severity !== severity) return false;
      if (ecosystem !== 'all' && a.ecosystem !== ecosystem) return false;
      if (!q) return true;
      return (
        a.repo.toLowerCase().includes(q) ||
        a.packageName.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        (a.ghsaId ?? '').toLowerCase().includes(q) ||
        (a.cveId ?? '').toLowerCase().includes(q)
      );
    });
    list.sort(
      (a, b) =>
        WEIGHT[b.severity] - WEIGHT[a.severity] ||
        (ageByKey.get(b.key) ?? 0) - (ageByKey.get(a.key) ?? 0),
    );
    return limit ? list.slice(0, limit) : list;
  }, [alerts, query, severity, ecosystem, ageByKey, limit]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = limit ? rows : rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="panel">
      <h2>{title}</h2>
      <p className="sub">
        Package links go to the alert in GitHub; the GHSA id opens the advisory in the GitHub Advisory
        Database.
      </p>
      {!limit && (
        <div className="toolbar">
          <input
            type="search"
            placeholder="Search repo, package, GHSA, CVE, summary…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            style={{ minWidth: 280 }}
          />
          <select
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value as Severity | 'all');
              setPage(0);
            }}
          >
            <option value="all">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={ecosystem}
            onChange={(e) => {
              setEcosystem(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All ecosystems</option>
            {ecosystems.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <span className="muted">{rows.length} alerts</span>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Repository</th>
              <th>Package</th>
              <th>Summary</th>
              <th>Advisory</th>
              <th className="num">CVSS</th>
              <th className="num">Age</th>
              <th>Patched in</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <tr key={a.key}>
                <td>
                  <SeverityBadge severity={a.severity} />
                </td>
                <td>
                  <a href={`https://github.com/${a.repo}/security/dependabot`} target="_blank" rel="noreferrer">
                    {a.repo}
                  </a>
                </td>
                <td>
                  <a href={a.htmlUrl} target="_blank" rel="noreferrer" className="mono">
                    {a.packageName}
                  </a>
                  <div className="muted mono">
                    {a.ecosystem}
                    {a.manifestPath ? ` · ${a.manifestPath}` : ''}
                    {a.scope === 'development' ? ' · dev' : ''}
                  </div>
                </td>
                <td style={{ maxWidth: 380 }}>{a.summary}</td>
                <td className="mono">
                  {a.ghsaId ? (
                    <a href={a.advisoryUrl ?? '#'} target="_blank" rel="noreferrer">
                      {a.ghsaId}
                    </a>
                  ) : (
                    '—'
                  )}
                  {a.cveId && <div className="muted">{a.cveId}</div>}
                </td>
                <td className="num">{a.cvssScore ?? '—'}</td>
                <td className="num">{ageByKey.has(a.key) ? `${ageByKey.get(a.key)}d` : '—'}</td>
                <td className="mono">{a.firstPatchedVersion ?? <span className="muted">no fix yet</span>}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  No alerts match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!limit && (
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
      )}
    </div>
  );
}
