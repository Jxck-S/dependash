#!/usr/bin/env tsx
/**
 * Generates a synthetic fetch so you can explore the dashboard without a GitHub
 * token — and so screenshots never expose anyone's real repositories.
 *
 *   npm run demo            # write demo data, then `npm run dev`
 *
 * Writes to the same single last-fetch file the real collector uses, so it will
 * be replaced the next time you press "Fetch now". The hosted version offers
 * the same data through its "Load demo data" button.
 */

import { buildDemoSnapshot } from '../src/lib/demo';
import { writeSnapshot } from '../src/lib/store';

const snapshot = buildDemoSnapshot();
const file = writeSnapshot(snapshot);
const open = snapshot.alerts.filter((a) => a.state === 'open').length;
console.log(`demo data written: ${file}`);
console.log(`  ${snapshot.repos.length} repositories · ${snapshot.alerts.length} alerts · ${open} open`);
console.log('');
console.log('Next: npm run dev  →  http://localhost:3939');
