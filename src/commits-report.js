// Output for `model-census --commits`.
import { FAMILY_LABEL } from './catalog.js';

const useColor = () => (process.env.FORCE_COLOR ? process.env.FORCE_COLOR !== '0' : process.stdout.isTTY && !process.env.NO_COLOR);
const paint = (code) => (s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint(1); const dim = paint(2); const red = paint(31); const green = paint(32); const yellow = paint(33); const cyan = paint(36);
const label = (o) => FAMILY_LABEL[o] || o;
const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length); };
const day = (d) => (d ? d.slice(0, 10) : '');
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(n / d < 0.1 ? 1 : 0) + '%' : '0%');

export function deniedCommits(scan, deny) {
  if (!deny.length) return [];
  return scan.attributed.filter((a) => a.origins.some((o) => deny.includes(o)));
}

export function renderCommitsText({ scan, summary, denied, deny, root, ms }) {
  const L = [];
  L.push(`${bold('model-census --commits')}  ${root}  ${dim(`(${scan.total.toLocaleString()} commits, ${day(scan.first)} → ${day(scan.last)}, ${ms} ms)`)}`);
  const n = scan.attributed.length;
  L.push(`${bold(n.toLocaleString())} commit${n === 1 ? '' : 's'} (${pct(n, scan.total)}) credit an AI tool or model; ${summary.groups.filter((g) => g.modelStated).reduce((s, g) => s + g.count, 0).toLocaleString()} name the model.`);
  L.push('');
  if (!n) {
    L.push(dim('No AI co-author trailers, tool signatures or agent accounts found.'));
  } else {
    L.push(bold('By origin of the weights'));
    for (const [o, c] of Object.entries(summary.byOrigin).sort((a, b) => b[1] - a[1])) {
      const lab = o === 'unknown' ? dim('tool only, model not stated') : (deny.includes(o) ? red(bold(label(o))) : label(o));
      L.push(`  ${String(c).padStart(7)}  ${pad(pct(c, n), 6)} ${lab}`);
    }
    L.push('');
    L.push(bold('By tool and model'));
    L.push(dim(`  ${'commits'.padStart(7)}  ${pad('tool', 16)} ${pad('model', 34)} ${pad('origin', 18)} ${pad('first', 10)} → last`));
    for (const g of summary.groups.slice(0, 20)) {
      const origin = g.origins.length ? g.origins.map(label).join(' + ') : '?';
      const o = g.origins.some((x) => deny.includes(x)) ? red(pad(origin, 18)) : g.origins.length ? pad(origin, 18) : dim(pad(origin, 18));
      L.push(`  ${String(g.count).padStart(7)}  ${cyan(pad(g.tool, 16))} ${g.modelStated ? pad(g.model, 34) : dim(pad(g.model, 34))} ${o} ${day(g.first)} → ${day(g.last)}`);
    }
    if (summary.groups.length > 20) L.push(dim(`  … ${summary.groups.length - 20} more (use --json)`));
  }
  L.push('');
  if (deny.length) {
    if (denied.length) {
      L.push(red(bold(`DENIED: ${denied.length} commit${denied.length === 1 ? '' : 's'} credit a model from ${deny.map(label).join(', ')}`)));
      for (const a of denied.slice(0, 10)) L.push(`  ${yellow(a.sha.slice(0, 10))} ${day(a.date)}  ${a.evidence[0]}`);
      if (denied.length > 10) L.push(dim(`  … ${denied.length - 10} more (use --json)`));
    } else {
      L.push(green(bold('OK')) + ` — no commit credits a model from ${deny.map(label).join(', ')}`);
    }
  }
  L.push(dim('Only what commits declare. Tools add trailers only when configured to, and people remove them: a commit with no trailer is not evidence of human authorship.'));
  return L.join('\n');
}

export function renderCommitsJson({ scan, summary, denied, deny, root, version }) {
  return JSON.stringify({ tool: 'model-census', version, mode: 'commits', root, total: scan.total, first: scan.first, last: scan.last, attributedCount: scan.attributed.length, byOrigin: summary.byOrigin, groups: summary.groups, deny, denied: denied.map((a) => a.sha), commits: scan.attributed }, null, 2);
}

export function renderCommitsMarkdown({ scan, summary, denied, deny, root }) {
  const n = scan.attributed.length;
  const out = [`## AI-credited commits: ${root}`, '', `Scanned ${scan.total} commits (${day(scan.first)} to ${day(scan.last)}). ${n} (${pct(n, scan.total)}) credit an AI tool or model in their metadata.`, ''];
  out.push('| Origin of weights | Commits | Share |', '|---|---|---|');
  for (const [o, c] of Object.entries(summary.byOrigin).sort((a, b) => b[1] - a[1])) out.push(`| ${o === 'unknown' ? 'Tool only, model not stated' : label(o)} | ${c} | ${pct(c, n)} |`);
  out.push('', '| Tool | Model | Origin | Commits | First | Last |', '|---|---|---|---|---|---|');
  for (const g of summary.groups) out.push(`| ${g.tool} | ${g.model} | ${g.origins.map(label).join(' + ') || '?'} | ${g.count} | ${day(g.first)} | ${day(g.last)} |`);
  if (deny.length) out.push('', denied.length ? `**${denied.length} commit(s) credit a model from ${deny.map(label).join(', ')}.**` : `No commit credits a model from ${deny.map(label).join(', ')}.`);
  out.push('', '_Based on commit trailers, tool signatures and agent accounts only. A commit without them is not evidence of human authorship._');
  return out.join('\n');
}
