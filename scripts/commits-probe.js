// Print a quick attribution summary for a repository (development aid).
// Usage: node scripts/commits-probe.js <repo-dir> [samples]
import { scanCommits, summarizeCommits } from '../src/commits.js';

const s = scanCommits(process.argv[2]);
const sum = summarizeCommits(s);
console.log(`total ${s.total}, attributed ${s.attributed.length}`);
console.log(sum.byOrigin);
for (const g of sum.groups.slice(0, 25)) console.log(String(g.count).padStart(6), g.tool.padEnd(20), g.model.padEnd(40), g.origins.join('+'), '|', g.evidence);
const n = Number(process.argv[3] || 0);
for (let i = 0; i < n; i++) {
  const a = s.attributed[Math.floor((i * 7919 + 13) % s.attributed.length)];
  console.log('SAMPLE', a.sha.slice(0, 10), a.tools.join('+'), a.models.join(','), a.origins.join('+'), '|', a.evidence.join(' || '));
}
