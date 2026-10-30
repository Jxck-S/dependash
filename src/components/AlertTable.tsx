'use client';

import { useMemo, useState } from 'react';
import { agentFixPrompt, alertsMarkdown, repoNames } from '@/lib/alert-export';
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
      <div className="panel-head">
        <h2>{title}</h2>
        <CopyButtons alerts={rows} />
      </div>
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
            className="search-wide"
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

      {/* Table on wide screens, cards on phones (toggled in CSS). */}
      <div className="table-wrap">
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
      <div className="card-list">
        {visible.map((a) => (
          <AlertCard key={a.key} alert={a} age={ageByKey.get(a.key)} />
        ))}
        {visible.length === 0 && <div className="empty">No alerts match this filter.</div>}
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

function AlertCard({ alert: a, age }: { alert: AlertRecord; age: number | undefined }) {
  return (
    <div className={`m-card sev-${a.severity}`}>
      <div className="m-card-top">
        <SeverityBadge severity={a.severity} />
        {a.cvssScore != null && <span className="muted">CVSS {a.cvssScore}</span>}
        {age !== undefined && <span className="muted">{age}d old</span>}
      </div>
      <a href={a.htmlUrl} target="_blank" rel="noreferrer" className="mono m-card-title">
        {a.packageName}
      </a>
      <div className="muted mono m-card-sub">
        {a.ecosystem}
        {a.manifestPath ? ` · ${a.manifestPath}` : ''}
        {a.scope === 'development' ? ' · dev' : ''}
      </div>
      <p className="m-card-body">{a.summary}</p>
      <div className="m-card-meta">
        <a href={`https://github.com/${a.repo}/security/dependabot`} target="_blank" rel="noreferrer">
          {a.repo}
        </a>
        {a.ghsaId && (
          <a href={a.advisoryUrl ?? '#'} target="_blank" rel="noreferrer" className="mono">
            {a.ghsaId}
          </a>
        )}
        {a.cveId && <span className="muted mono">{a.cveId}</span>}
        <span className="mono">
          {a.firstPatchedVersion ? (
            <>fix: {a.firstPatchedVersion}</>
          ) : (
            <span className="muted">no fix yet</span>
          )}
        </span>
      </div>
    </div>
  );
}

const COPY_KINDS = [
  { id: 'alerts', label: 'Alerts', title: 'Markdown list of these alerts, grouped by repo', build: alertsMarkdown },
  { id: 'repos', label: 'Repos', title: 'Just the repo names, one per line', build: repoNames },
  {
    id: 'prompt',
    label: 'AI fix prompt',
    title: 'These alerts plus instructions for an AI coding agent to fix them, test, and open a PR per repo',
    build: (alerts: AlertRecord[]) => agentFixPrompt(alerts),
  },
] as const;

/** Copies whatever the table currently matches (every page, after filters) in one of three forms. */
function CopyButtons({ alerts }: { alerts: AlertRecord[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (id: string, text: string) => {
    setCopied((await writeClipboard(text)) ? id : 'failed');
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="copy-bar">
      <span className="muted">
        {copied === 'failed' ? 'Couldn’t copy' : `Copy ${alerts.length} alert${alerts.length === 1 ? '' : 's'}:`}
      </span>
      {COPY_KINDS.map((k) => (
        <button
          key={k.id}
          className={`pg${k.id === 'prompt' ? ' run-btn' : ''}`}
          title={k.title}
          disabled={alerts.length === 0}
          onClick={() => void copy(k.id, k.build(alerts))}
        >
          {copied === k.id ? '✓ Copied' : k.label}
        </button>
      ))}
    </div>
  );
}

/** Clipboard API first; fall back to a hidden textarea where it's blocked (insecure origin, webviews). */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}
