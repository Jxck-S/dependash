import { Severity } from '@/lib/types';

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge ${severity}`}>{severity}</span>;
}

export function EnabledBadge({
  enabled,
  archived,
}: {
  enabled: boolean | null;
  archived?: boolean;
}) {
  if (enabled === true) return <span className="badge on">on</span>;
  if (enabled === false) return <span className="badge off">off</span>;
  if (archived) {
    return (
      <span className="badge unknown" title="Dependabot does not scan archived repositories">
        n/a
      </span>
    );
  }
  return <span className="badge unknown">unknown</span>;
}

/** Repo attribute markers shown next to the repository name. */
export function RepoFlags({
  archived,
  isPrivate,
  fork,
}: {
  archived: boolean;
  isPrivate: boolean;
  fork: boolean;
}) {
  if (!archived && !isPrivate && !fork) return null;
  return (
    <span className="flags">
      {archived && (
        <span className="badge archived" title="This repository is archived (read-only on GitHub)">
          archived
        </span>
      )}
      {isPrivate && (
        <span className="badge private" title="Private repository">
          private
        </span>
      )}
      {fork && (
        <span className="badge fork" title="This repository is a fork">
          fork
        </span>
      )}
    </span>
  );
}

export function Delta({ value }: { value: number }) {
  if (value > 0) return <span className="delta-up">+{value}</span>;
  if (value < 0) return <span className="delta-down">{value}</span>;
  return <span className="delta-flat">0</span>;
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Severity | 'good' | 'muted';
}) {
  const color =
    tone === 'good'
      ? 'var(--good)'
      : tone === 'muted'
        ? 'var(--muted)'
        : tone
          ? `var(--${tone})`
          : 'var(--text)';
  return (
    <div className="panel card">
      <div className="label">{label}</div>
      <div className="value" style={{ color }}>
        {value}
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
