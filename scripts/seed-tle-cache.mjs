#!/usr/bin/env node
/**
 * Pre-seed the CelesTrak TLE disk cache at build/deploy time.
 *
 * The celestrak proxy (server/providers/space/celestrak.js) keeps a memory +
 * disk cache of TLE groups and serves the freshest stale copy when upstream
 * is unreachable. But a fresh deploy starts with an empty cache, and some
 * hosting egress IPs are blocked by celestrak.org — so the satellites layer
 * reports "unavailable" until a fetch succeeds. Seeding the cache during the
 * build (whose egress usually differs) gives the proxy something to serve
 * from the first request; it keeps retrying upstream on every request past
 * the TTL, so it self-heals to fresh data if upstream becomes reachable.
 *
 * Never fails the build: a seed failure only warns, and the proxy degrades
 * gracefully without cache.
 */
import path from 'node:path';
import { promises as fsp } from 'node:fs';

const GROUPS = [
  'stations',
  'visual',
  'gps-ops',
  'glo-ops',
  'galileo',
  'geo',
  'starlink',
];
const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
const USER_AGENT =
  'gods-eye-view-celestrak-proxy/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)';

function tleUrl(group) {
  const url = new URL('https://celestrak.org/NORAD/elements/gp.php');
  url.searchParams.set('GROUP', group);
  url.searchParams.set('FORMAT', 'tle');
  return url;
}

async function seedGroup(group) {
  const res = await fetch(tleUrl(group).toString(), {
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  const count = (body.match(/^1 /gm) || []).length;
  if (count === 0) throw new Error('no TLE lines in response');
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  await fsp.writeFile(
    path.join(CACHE_DIR, `celestrak-${group}.json`),
    JSON.stringify({ at: Date.now(), body }),
    'utf8',
  );
  return count;
}

const results = await Promise.allSettled(GROUPS.map(seedGroup));
let ok = 0;
results.forEach((result, i) => {
  if (result.status === 'fulfilled') {
    ok += 1;
    console.log(`[tle-seed] ${GROUPS[i]}: ${result.value} TLEs cached`);
  } else {
    console.warn(
      `[tle-seed] ${GROUPS[i]} FAILED: ${result.reason?.message || result.reason}`,
    );
  }
});
console.log(`[tle-seed] done: ${ok}/${GROUPS.length} groups cached`);
// Never fail the build — the proxy degrades gracefully without cache.
process.exit(0);
