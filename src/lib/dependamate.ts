/**
 * Optional DependaMate (or any external scanner) adapter.
 *
 * The runner defaults to direct GitHub REST calls. If you already have a tool
 * such as DependaMate installed, point the runner at it:
 *
 *   npm run snapshot -- --dependamate "dependamate scan --json"
 *
 * The command must print JSON on stdout. We accept several shapes:
 *   - { alerts: [...] }        - { results: [...] }        - [...]
 * and map permissively onto AlertRecord, so minor schema differences between
 * tool versions do not break ingestion.
 */

import { execSync } from 'node:child_process';
import { AlertRecord, AlertState, Severity } from './types';

type Loose = Record<string, any>;

const SEVERITIES = new Set<Severity>(['critical', 'high', 'medium', 'low']);
const STATES = new Set<AlertState>(['open', 'fixed', 'dismissed', 'auto_dismissed']);

export function runExternalScanner(command: string): AlertRecord[] {
  const stdout = execSync(command, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return parseExternalOutput(stdout);
}

export function parseExternalOutput(stdout: string): AlertRecord[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as Loose;
  const rows: Loose[] = Array.isArray(parsed)
    ? parsed
    : (parsed.alerts ?? parsed.results ?? parsed.data ?? []);
  return rows.map(normalizeLooseAlert).filter((a): a is AlertRecord => Boolean(a));
}

function pick<T>(obj: Loose, ...paths: string[]): T | undefined {
  for (const p of paths) {
    const value = p.split('.').reduce<any>((acc, k) => (acc == null ? acc : acc[k]), obj);
    if (value !== undefined && value !== null) return value as T;
  }
  return undefined;
}

function normalizeLooseAlert(row: Loose): AlertRecord | null {
  const repo =
    pick<string>(row, 'repo', 'repository', 'repository.full_name', 'full_name', 'nameWithOwner');
  const number = Number(pick<number>(row, 'number', 'alert_number', 'id') ?? 0);
  if (!repo || !number) return null;

  const severityRaw = String(
    pick<string>(
      row,
      'severity',
      'security_vulnerability.severity',
      'security_advisory.severity',
      'advisory.severity',
    ) ?? 'low',
  ).toLowerCase();
  const severity = (SEVERITIES.has(severityRaw as Severity) ? severityRaw : 'low') as Severity;

  const stateRaw = String(pick<string>(row, 'state', 'status') ?? 'open').toLowerCase();
  const state = (STATES.has(stateRaw as AlertState) ? stateRaw : 'open') as AlertState;

  const ghsaId =
    pick<string>(row, 'ghsa_id', 'ghsaId', 'security_advisory.ghsa_id', 'advisory.ghsa_id') ?? null;
  const createdAt = pick<string>(row, 'created_at', 'createdAt') ?? new Date().toISOString();

  return {
    key: `${repo}#${number}`,
    repo,
    number,
    state,
    severity,
    ghsaId,
    cveId: pick<string>(row, 'cve_id', 'security_advisory.cve_id') ?? null,
    summary: pick<string>(row, 'summary', 'security_advisory.summary', 'title') ?? '',
    cvssScore: pick<number>(row, 'cvss', 'security_advisory.cvss.score') ?? null,
    ecosystem:
      pick<string>(row, 'ecosystem', 'dependency.package.ecosystem', 'package.ecosystem') ??
      'unknown',
    packageName:
      pick<string>(row, 'package', 'dependency.package.name', 'package.name') ?? 'unknown',
    manifestPath: pick<string>(row, 'manifest', 'dependency.manifest_path') ?? null,
    vulnerableVersionRange:
      pick<string>(row, 'security_vulnerability.vulnerable_version_range', 'vulnerable_range') ??
      null,
    firstPatchedVersion:
      pick<string>(
        row,
        'security_vulnerability.first_patched_version.identifier',
        'first_patched_version',
      ) ?? null,
    scope: (pick<'development' | 'runtime'>(row, 'dependency.scope', 'scope') ?? null) as
      | 'development'
      | 'runtime'
      | null,
    createdAt,
    updatedAt: pick<string>(row, 'updated_at', 'updatedAt') ?? createdAt,
    fixedAt: pick<string>(row, 'fixed_at', 'fixedAt') ?? null,
    dismissedAt: pick<string>(row, 'dismissed_at', 'dismissedAt') ?? null,
    dismissedReason: pick<string>(row, 'dismissed_reason') ?? null,
    htmlUrl:
      pick<string>(row, 'html_url', 'url') ??
      `https://github.com/${repo}/security/dependabot/${number}`,
    advisoryUrl: ghsaId ? `https://github.com/advisories/${ghsaId}` : null,
  };
}
