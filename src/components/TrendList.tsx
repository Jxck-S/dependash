import { RepoTrend } from '@/lib/types';

export default function TrendList({
  title,
  subtitle,
  trends,
  tone,
}: {
  title: string;
  subtitle: string;
  trends: RepoTrend[];
  tone: 'up' | 'down';
}) {
  const color = tone === 'up' ? 'var(--critical)' : 'var(--good)';
  const max = Math.max(1, ...trends.map((t) => Math.abs(t.delta)));
  return (
    <div className="panel">
      <h2>{title}</h2>
      <p className="sub">{subtitle}</p>
      {trends.length === 0 ? (
        <div className="empty">
          No net change in this window.
        </div>
      ) : (
        trends.slice(0, 12).map((t) => (
          <div className="bar-row" key={t.fullName}>
            <a href={`https://github.com/${t.fullName}/security/dependabot`} target="_blank" rel="noreferrer">
              {t.fullName.split('/')[1] ?? t.fullName}
            </a>
            <div className="bar-track">
              <div
                style={{
                  width: `${(Math.abs(t.delta) / max) * 100}%`,
                  background: color,
                }}
              />
            </div>
            <span className="num" style={{ color }}>
              {t.delta > 0 ? `+${t.delta}` : t.delta}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
