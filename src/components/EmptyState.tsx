export default function EmptyState() {
  return (
    <div className="panel empty">
      <h2 style={{ textTransform: 'none', fontSize: 18, color: 'var(--text)' }}>No data yet</h2>
      <p>
        Click <strong>Fetch now</strong> above, or run the collector from a terminal:
      </p>
      <p className="mono">npm run snapshot</p>
      <p className="muted">
        It authenticates with <code>gh auth token</code> (or <code>$GITHUB_TOKEN</code>), makes read-only
        GitHub API calls, and keeps only the most recent result. Nothing is ever written back to GitHub.
      </p>
    </div>
  );
}
