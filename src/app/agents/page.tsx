'use client';

/**
 * How to connect an AI agent to dependash's MCP endpoint, plus a fallback
 * bearer token for agents that can't do OAuth.
 */

import { useEffect, useState } from 'react';
import { useData } from '@/components/DataProvider';
import { PROXY_HEADER } from '@/lib/github';

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="agent-code">
      <pre className="mono">{children}</pre>
      <button
        className="pg"
        onClick={() =>
          navigator.clipboard?.writeText(children).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export default function AgentsPage() {
  const { auth } = useData();
  const [origin, setOrigin] = useState('https://dependash.vercel.app');
  const [token, setToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  const hosted = auth?.mode === 'hosted';
  const url = `${origin}/api/mcp`;

  async function mint() {
    setError(null);
    const res = await fetch('/api/auth/mcp-token', { method: 'POST', headers: { [PROXY_HEADER]: '1' } }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { token?: string; expiresAt?: string; error?: string } | null;
    if (!res?.ok || !body?.token || !body.expiresAt) setError(body?.error ?? 'Could not create a token.');
    else setToken({ token: body.token, expiresAt: body.expiresAt });
  }

  return (
    <div className="grid">
      <section className="panel">
        <h2>Fix alerts with an AI agent</h2>
        <p className="sub">
          dependash has an MCP endpoint, so coding agents like Claude Code can read your alerts, check what Dependabot already
          fixed, and fix the rest. Tell your agent <i>“use dependash to fix my critical and high alerts”</i>.
        </p>
        <ol className="agent-steps">
          <li>
            <b>Dependabot first.</b> For every alert, <code>triage_alerts</code> finds Dependabot’s PR and checks that it reaches
            the patched version, passes CI and has no conflicts. It also checks whether security updates are turned on.
          </li>
          <li>
            <b>Review or nudge.</b> The agent reviews ready PRs (<code>get_dependabot_pr</code>), fixes failing ones on their
            branch, and turns security updates on or asks Dependabot to recreate a PR where none exists.
          </li>
          <li>
            <b>Fix the rest by hand.</b> Anything Dependabot can’t handle comes with step-by-step instructions
            (<code>manual_fix_prompt</code>) and gets its own PR.
          </li>
        </ol>
        <p className="sub">
          The MCP tools are read-only, like the rest of dependash. Branches, pushes, PR comments and merges are done by the
          agent with its own git / <code>gh</code> access, so your agent’s permission settings decide what it may do.
        </p>
      </section>

      <section className="panel">
        <h2>Connect</h2>
        {hosted ? (
          <>
            <p className="sub">Add the server, and your agent will open a browser window for you to approve it and sign in with GitHub.</p>
            <Code>{`claude mcp add --transport http dependash ${url}`}</Code>
            <p className="sub">
              Other MCP clients (Claude Desktop / claude.ai connectors, Cursor, VS Code): add a remote server with the URL{' '}
              <code>{url}</code>. To revoke access, go to GitHub → Settings → Applications and revoke dependash.
            </p>
          </>
        ) : (
          <>
            <p className="sub">Local mode: the endpoint uses your <code>gh</code> login and only answers this machine, so you don’t need to sign in.</p>
            <Code>{`claude mcp add --transport http dependash ${url}`}</Code>
          </>
        )}
      </section>

      {hosted && auth?.authenticated && (
        <section className="panel">
          <h2>Token for agents without OAuth</h2>
          <p className="sub">
            Some clients only take a fixed header. This creates a token that acts as @{auth.viewer} for 30 days. Treat it like a
            password.
          </p>
          {token ? (
            <>
              <Code>{`claude mcp add --transport http dependash ${url} --header "Authorization: Bearer ${token.token}"`}</Code>
              <p className="sub">Expires {new Date(token.expiresAt).toLocaleString()}.</p>
            </>
          ) : (
            <button className="pg run-btn" onClick={mint}>
              Create token
            </button>
          )}
          {error && <p className="sub">{error}</p>}
        </section>
      )}
    </div>
  );
}
