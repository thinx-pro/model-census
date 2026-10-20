import { FAMILY_LABEL } from './catalog.js';

export const VERSION = '0.1.0';

const useColor = () => (process.env.FORCE_COLOR ? process.env.FORCE_COLOR !== '0' : process.stdout.isTTY && !process.env.NO_COLOR);
const paint = (code) => (s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint(1); const dim = paint(2); const red = paint(31); const green = paint(32); const yellow = paint(33); const cyan = paint(36);

const KIND_ORDER = ['model', 'router', 'endpoint', 'env-var', 'package', 'local-model'];
const KIND_TITLE = { model: 'Model ids in code and config', router: 'Routed at runtime (cannot be resolved statically)', endpoint: 'API endpoints', 'env-var': 'Credential / base-URL variables', package: 'SDK packages', 'local-model': 'Models on this machine' };
const FLAG_TEXT = {
  'community-modified': 'name says safety training was removed or altered (abliterated / uncensored)',
  'third-party-upload': 'weights uploaded by someone other than the original vendor',
  'undeclared-lineage': 'tokenizer matches a family the metadata does not declare',
  'runtime-routing': 'the router picks the model per request',
  'multi-vendor-host': 'host serves many vendors; the model id decides',
  'multi-vendor-sdk': 'SDK talks to many vendors',
  unreadable: 'file could not be parsed',
};

export function originLabel(o) { return FAMILY_LABEL[o] || o; }

// Merge findings with the same kind + id into one entry with many locations.
export function group(findings) {
  const map = new Map();
  for (const f of findings) {
    const key = `${f.kind}:${f.id.toLowerCase()}`;
    let g = map.get(key);
    if (!g) {
      g = { kind: f.kind, id: f.id, origins: [...f.origins], route: f.route, flags: [...(f.flags || [])], notes: [...(f.notes || [])], locations: [], name: f.name, lineage: f.lineage, architecture: f.architecture, license: f.license, ecosystem: f.ecosystem, doc: !!f.doc };
      map.set(key, g);
    } else {
      for (const o of f.origins) if (!g.origins.includes(o)) g.origins.push(o);
      for (const x of f.flags || []) if (!g.flags.includes(x)) g.flags.push(x);
      for (const x of f.notes || []) if (!g.notes.includes(x)) g.notes.push(x);
      if (!f.doc) g.doc = false;
      if (!g.lineage && f.lineage) g.lineage = f.lineage;
    }
    if (g.origins.length > 1) g.origins = g.origins.filter((o) => o !== 'unknown');
    g.locations.push(f.line ? `${f.file}:${f.line}` : f.file);
  }
  return [...map.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
}

export function applyPolicy(groups, deny) {
  const d = deny.map((x) => x.toLowerCase());
  for (const g of groups) g.denied = g.origins.some((o) => d.includes(o));
  return groups.filter((g) => g.denied);
}

export function summarize(groups) {
  const by = new Map();
  for (const g of groups) {
    for (const o of g.origins) {
      const s = by.get(o) || { origin: o, entries: 0, refs: 0, kinds: new Set() };
      s.entries++; s.refs += g.locations.length; s.kinds.add(g.kind);
      by.set(o, s);
    }
  }
  return [...by.values()].sort((a, b) => (a.origin === 'unknown') - (b.origin === 'unknown') || b.refs - a.refs).map((s) => ({ ...s, kinds: [...s.kinds] }));
}

function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length); }

export function renderText(ctx) {
  const { groups, denied, deny, root, stats } = ctx;
  const out = [];
  out.push(`${bold('model-census')} ${dim(VERSION)}  ${dim(root)}  ${dim(`${stats.files} files · ${stats.ms} ms${stats.local ? ' · +local' : ''}${stats.online ? ' · +online' : ''}`)}`);
  out.push('');
  if (!groups.length) { out.push(green('No model references found.')); return out.join('\n'); }
  const sum = summarize(groups);
  out.push(bold(`${pad('ORIGIN', 22)}${pad('ENTRIES', 9)}${pad('REFS', 7)}SEEN AS`));
  for (const s of sum) {
    const isDenied = deny.includes(s.origin);
    const line = `${pad(originLabel(s.origin), 22)}${pad(s.entries, 9)}${pad(s.refs, 7)}${s.kinds.join(', ')}`;
    out.push(isDenied ? red(line + '  ✖ denied') : s.origin === 'unknown' ? yellow(line) : line);
  }
  const usedFlags = new Set();
  const labelOf = (g) => (g.kind === 'endpoint' ? `${g.id} (${g.name})` : g.id + (g.doc ? ' (docs)' : ''));
  const idW = Math.min(64, Math.max(...groups.map((g) => labelOf(g).length)) + 2);
  const orW = Math.min(30, Math.max(...groups.map((g) => g.origins.map(originLabel).join(' + ').length)) + 2);
  for (const kind of KIND_ORDER) {
    const gs = groups.filter((g) => g.kind === kind);
    if (!gs.length) continue;
    out.push('');
    out.push(bold(KIND_TITLE[kind]));
    for (const g of gs) {
      const mark = g.denied ? red('✖') : g.flags.length ? yellow('!') : green('·');
      const origin = g.origins.map(originLabel).join(' + ');
      const where = g.locations[0] + (g.locations.length > 1 ? dim(` (+${g.locations.length - 1})`) : '');
      out.push(` ${mark} ${pad(labelOf(g), idW)} ${pad(origin, orW)} ${dim(where)}`);
      for (const fl of g.flags) { usedFlags.add(fl); }
      if (g.flags.length) out.push(`     ${yellow(g.flags.join(', '))}`);
      for (const n of g.notes.slice(0, 3)) out.push(`     ${dim(n)}`);
      if (g.lineage && g.lineage.length > 1) out.push(`     ${cyan('lineage:')} ${g.lineage.map((n) => n.id + (n.license ? dim(` [${n.license}]`) : '')).join(dim(' ← '))}`);
    }
  }
  if (usedFlags.size) {
    out.push('');
    out.push(dim('Flags'));
    for (const f of usedFlags) out.push(dim(`  ${f}: ${FLAG_TEXT[f] || ''}`));
  }
  out.push('');
  if (deny.length) {
    out.push(denied.length
      ? red(bold(`✖ ${denied.length} ${denied.length === 1 ? 'entry' : 'entries'} trace back to denied origins (${deny.join(', ')}).`))
      : green(bold(`✔ Nothing traces back to denied origins (${deny.join(', ')}).`)));
  }
  const unresolved = groups.filter((g) => g.origins.includes('unknown')).length;
  if (unresolved) out.push(yellow(`${unresolved} ${unresolved === 1 ? 'entry has' : 'entries have'} an origin a static scan cannot pin down (routers, multi-vendor hosts or SDKs).`));
  if (!stats.online && groups.some((g) => g.flags.includes('third-party-upload'))) out.push(dim('Tip: --online walks the Hugging Face base_model chain for hub ids.'));
  return out.join('\n');
}

export function renderJson(ctx) {
  return JSON.stringify({ tool: 'model-census', version: VERSION, root: ctx.root, generated: ctx.now, deny: ctx.deny, summary: summarize(ctx.groups), entries: ctx.groups }, null, 2);
}

export function renderMarkdown(ctx) {
  const { groups, deny, denied, now } = ctx;
  const lines = [];
  lines.push(`# AI model inventory`);
  lines.push('');
  const scope = ['code', 'configuration', ...(ctx.stats.local ? ['local model stores'] : []), ...(ctx.stats.online ? ['declared Hugging Face lineage'] : [])];
  lines.push(`Generated by model-census ${VERSION} on ${now.slice(0, 10)}. This is a static scan of ${scope.slice(0, -1).join(', ')} and ${scope.at(-1)}. It lists references, not proof of runtime traffic.`);
  lines.push('');
  lines.push('| Origin | Entries | References |');
  lines.push('|---|---|---|');
  for (const s of summarize(groups)) lines.push(`| ${originLabel(s.origin)} | ${s.entries} | ${s.refs} |`);
  lines.push('');
  lines.push('| Kind | Id | Origin | Where | Notes |');
  lines.push('|---|---|---|---|---|');
  for (const g of groups) {
    const where = g.locations.slice(0, 3).map((l) => `\`${l}\``).join('<br>') + (g.locations.length > 3 ? ` +${g.locations.length - 3}` : '');
    const notes = [...g.flags, ...g.notes.slice(0, 2)].join('; ').replace(/\|/g, '\\|');
    lines.push(`| ${g.kind} | \`${g.id}\` | ${g.origins.map(originLabel).join(' + ')}${g.denied ? ' ✖' : ''} | ${where} | ${notes} |`);
  }
  if (deny.length) {
    lines.push('');
    lines.push(denied.length ? `**${denied.length} entries trace back to denied origins (${deny.join(', ')}).**` : `**No entry traces back to denied origins (${deny.join(', ')}).**`);
  }
  return lines.join('\n');
}

// CycloneDX 1.6: models as machine-learning-model components, endpoints as services.
export function renderCycloneDx(ctx) {
  const comps = [];
  const services = [];
  for (const g of ctx.groups) {
    const props = [
      { name: 'model-census:kind', value: g.kind },
      ...g.origins.map((o) => ({ name: 'model-census:origin', value: o })),
      ...(g.route ? [{ name: 'model-census:route', value: g.route }] : []),
      ...g.flags.map((f) => ({ name: 'model-census:flag', value: f })),
      ...g.locations.slice(0, 20).map((l) => ({ name: 'model-census:location', value: l })),
      ...(g.lineage || []).map((n) => ({ name: 'model-census:lineage', value: `${n.depth}:${n.id}` })),
    ];
    if (g.kind === 'endpoint') {
      services.push({ 'bom-ref': `svc:${g.id}`, name: g.name || g.id, endpoints: [`https://${g.id}`], properties: props });
    } else if (g.kind === 'package') {
      comps.push({ type: 'library', 'bom-ref': `pkg:${g.ecosystem}/${g.id}`, name: g.id, purl: `pkg:${g.ecosystem}/${g.id.replace('@', '%40')}`, properties: props });
    } else {
      const c = { type: 'machine-learning-model', 'bom-ref': `model:${g.id}`, name: g.id, properties: props };
      if (g.license) c.licenses = [{ license: { name: String(g.license) } }];
      comps.push(c);
    }
  }
  return JSON.stringify({
    bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    metadata: { timestamp: ctx.now, tools: { components: [{ type: 'application', name: 'model-census', version: VERSION }] } },
    components: comps, services,
  }, null, 2);
}
