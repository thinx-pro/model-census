// List distinct Co-authored-by / Assisted-by trailer values that were NOT attributed (development aid,
// to spot AI tools the catalogue does not know yet). Usage: node scripts/commits-misses.js <repo-dir>
import { spawnSync } from 'node:child_process';
import { attribute } from '../src/commits.js';

const r = spawnSync('git', ['-C', process.argv[2], 'log', '--all', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x1e'], { encoding: 'utf8', maxBuffer: 1 << 30 });
const counts = new Map();
for (const rec of r.stdout.split('\x1e')) {
  const [sha, author, email, date, body = ''] = rec.replace(/^\s+/, '').split('\x1f');
  if (!sha) continue;
  const trailers = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^(co-authored-by|assisted-by|generated-by):\s+(.+)$/i);
    if (m) trailers.push({ key: m[1], value: m[2].trim() });
  }
  if (!trailers.length) continue;
  const a = attribute({ sha, author, email, date, subject: body.split('\n')[0], body, trailers });
  if (a) continue;
  for (const t of trailers) {
    const v = t.value.replace(/<([^@>]+)@/, '<…@');
    counts.set(v, (counts.get(v) || 0) + 1);
  }
}
for (const [v, c] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(String(c).padStart(5), v);
