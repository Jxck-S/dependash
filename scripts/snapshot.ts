#!/usr/bin/env tsx
/**
 * Local fetch runner.
 *
 *   npm run snapshot                       # scan everything you can see
 *   npm run snapshot -- --owner myorg      # limit to one org/user
 *   npm run snapshot -- --exclude-org bigorg  # skip an org/user
 *   npm run snapshot -- --include-archived --include-forks
 *   npm run snapshot -- --dependamate "dependamate scan --json"
 *
 * Overwrites the single last-fetch file in the OS temp dir. There is no
 * archive of past runs; trends come from the alert timestamps in this fetch.
 * Makes only HTTP GET requests. Never commits, never opens PRs, never touches
 * workflows, never modifies any repository.
 */

import { runSnapshot } from '../src/lib/collect';
import { emptySeverityCounts } from '../src/lib/types';

interface Args {
  owners: string[];
  excludeOwners: string[];
  only: string[];
  includeArchived: boolean;
  includeForks: boolean;
  visibility: 'all' | 'public' | 'private';
  affiliation?: string;
  concurrency: number;
  maxAlertPages: number;
  dependamate?: string;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    owners: [],
    excludeOwners: [],
    only: [],
    includeArchived: false,
    includeForks: false,
    visibility: 'all',
    concurrency: 6,
    maxAlertPages: 20,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--owner':
      case '--org':
        args.owners.push(...next().split(',').map((s) => s.trim()).filter(Boolean));
        break;
      case '--exclude-owner':
      case '--exclude-org':
        args.excludeOwners.push(...next().split(',').map((s) => s.trim()).filter(Boolean));
        break;
      case '--repo':
      case '--only':
        args.only.push(...next().split(',').map((s) => s.trim()).filter(Boolean));
        break;
      case '--include-archived':
        args.includeArchived = true;
        break;
      case '--include-forks':
        args.includeForks = true;
        break;
      case '--visibility':
        args.visibility = next() as Args['visibility'];
        break;
      case '--affiliation':
        args.affiliation = next();
        break;
      case '--concurrency':
        args.concurrency = Number(next());
        break;
      case '--max-alert-pages':
        args.maxAlertPages = Number(next());
        break;
      case '--dependamate':
        args.dependamate = next();
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown flag: ${arg}`);
          printHelp();
          process.exit(1);
        }
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`dependash snapshot runner (read-only)

Usage: npm run snapshot -- [options]

  --owner <a,b>          Only scan these orgs/users
  --exclude-owner <a,b>  Skip these orgs/users            (alias: --exclude-org)
  --repo <owner/name>    Only scan these repositories
  --include-archived     Include archived repositories
  --include-forks        Include forks
  --visibility <v>       all | public | private            (default: all)
  --affiliation <list>   owner,collaborator,organization_member
  --concurrency <n>      Parallel repo scans                (default: 6)
  --max-alert-pages <n>  Max 100-alert pages per repo       (default: 20)
  --dependamate "<cmd>"  Use an external scanner for alerts instead of the API
  --quiet                Only print the final summary

Auth: uses $DEPENDASH_TOKEN / $GITHUB_TOKEN / $GH_TOKEN, else \`gh auth token\`.
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const log = args.quiet ? () => {} : (m: string) => console.log(m);

  const { snapshot, file, openAlerts } = await runSnapshot({
    owners: args.owners,
    excludeOwners: args.excludeOwners,
    only: args.only,
    includeArchived: args.includeArchived,
    includeForks: args.includeForks,
    visibility: args.visibility,
    affiliation: args.affiliation,
    concurrency: args.concurrency,
    maxAlertPages: args.maxAlertPages,
    dependamate: args.dependamate,
    log,
  });

  const bySeverity = emptySeverityCounts();
  for (const a of snapshot.alerts) {
    if (a.state === 'open') bySeverity[a.severity] += 1;
  }

  console.log('');
  console.log(`last fetch saved: ${file}`);
  console.log(`  repos scanned    ${snapshot.meta.reposScanned}`);
  console.log(`  dependabot on    ${snapshot.meta.reposWithAlertsEnabled}`);
  console.log(`  alerts total     ${snapshot.alerts.length}`);
  console.log(
    `  open alerts      ${openAlerts} (critical ${bySeverity.critical}, high ${bySeverity.high}, medium ${bySeverity.medium}, low ${bySeverity.low})`,
  );
  if (snapshot.meta.errors.length) {
    console.log(`  warnings         ${snapshot.meta.errors.length} (see meta.errors in the JSON)`);
  }
  console.log('');
  console.log('Next: npm run dev  \u2192  http://localhost:3939');
}

main().catch((err) => {
  console.error(`\nsnapshot failed: ${(err as Error).message}`);
  process.exit(1);
});
