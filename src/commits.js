// Which AI tools and models are credited in this repository's git history?
// Reads commit metadata only (author, trailers, message footer). Never reads diffs or file contents.
//
// Evidence used, strongest first:
//   - a model named in a trailer:  "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>",
//     "Co-authored-by: aider (deepseek/deepseek-chat) <noreply@aider.chat>", "Assisted-by: Codex:gpt-5"
//   - a tool's own signature:      "Generated with Claude Code", "(aider)" author suffix, bot accounts
// A commit without any of these is NOT evidence that a person wrote it: most tools only add a
// trailer when configured to, and people remove them.
import { spawnSync } from 'node:child_process';
import { classifyModel, FAMILIES } from './catalog.js';

// Agent tools. `family` is the vendor whose models the tool uses by default, or null when the tool
// is multi-vendor (then only a named model can say whose weights were involved).
export const TOOLS = [
  { id: 'claude-code', label: 'Claude Code', family: 'anthropic', test: (c) => /generated with \[?claude code\]?|claude\.(ai|com)\/(code|claude-code)/i.test(c.body) || c.trailers.some((t) => /noreply@anthropic\.com/i.test(t.value)) },
  { id: 'aider', label: 'aider', family: null, test: (c) => /\(aider\)\s*$/i.test(c.author) || c.trailers.some((t) => /@aider\.(chat|dev)|^aider\s*\(/i.test(t.value)) || /^aider: /i.test(c.subject) },
  { id: 'codex', label: 'Codex', family: 'openai', test: (c) => /^codex\b/i.test(c.author) || /chatgpt-codex-connector|openai-codex/i.test(c.author + c.email) || c.trailers.some((t) => /^codex\b|@openai\.com|chatgpt\.com\/codex/i.test(t.value)) },
  { id: 'copilot', label: 'GitHub Copilot', family: null, test: (c) => /copilot/i.test(c.author + ' ' + c.email) || c.trailers.some((t) => /copilot/i.test(t.value)) },
  { id: 'cursor', label: 'Cursor', family: null, test: (c) => /cursoragent@cursor\.com|^cursor agent\b/i.test(c.author + ' ' + c.email) || c.trailers.some((t) => /cursoragent@cursor\.com|^cursor agent\b/i.test(t.value)) },
  { id: 'jules', label: 'Jules', family: 'google', test: (c) => /google-labs-jules|jules\b.*google/i.test(c.author + ' ' + c.email) || c.trailers.some((t) => /google-labs-jules/i.test(t.value)) },
  { id: 'gemini-cli', label: 'Gemini CLI', family: 'google', test: (c) => c.trailers.some((t) => /^gemini(\s+cli)?\s*</i.test(t.value)) || /generated (with|by) gemini cli/i.test(c.body) },
  // Match Devin's bot account and domain only: plain "devin" is also part of people's usernames.
  { id: 'devin', label: 'Devin', family: null, test: (c) => /devin-ai-integration|@devin\.ai\b|^devin ai\b/i.test(c.author + ' ' + c.email) || c.trailers.some((t) => /devin-ai-integration|@devin\.ai\b|^devin(\s+ai)?\s*</i.test(t.value)) },
  // Bot account, official addresses, or "opencode (<model>) <…>"; not any address containing "opencode".
  { id: 'opencode', label: 'OpenCode', family: null, test: (c) => c.trailers.some((t) => /opencode-agent\[bot\]|@opencode\.ai\b|opencode@sst\.dev|^opencode\s*(\(|<)/i.test(t.value)) || /generated (with|by) \[?opencode/i.test(c.body) },
  { id: 'qwen-code', label: 'Qwen Code', family: 'qwen', test: (c) => c.trailers.some((t) => /qwen[- ]?cod(e|er)/i.test(t.value)) || /generated (with|by) qwen code/i.test(c.body) },
  { id: 'kimi-cli', label: 'Kimi CLI', family: 'moonshot', test: (c) => c.trailers.some((t) => /kimi[- ]?(cli|code)/i.test(t.value)) },
  { id: 'amazon-q', label: 'Amazon Q / Kiro', family: 'amazon', test: (c) => /amazon-q-developer|kiro/i.test(c.author + ' ' + c.email) || c.trailers.some((t) => /amazon q developer|kiro/i.test(t.value)) },
];

// A bare "Model:" line is too common in ordinary commit messages to count as a trailer.
const AI_TRAILER = /^(co-authored-by|assisted-by|generated-by|ai-assisted-by|ai-model|x-ai-model|made-with|written-by|co-developed-by)$/i;

// Turn "Claude Opus 4.6", "aider (deepseek/deepseek-chat)", "Codex:gpt-5" or "GPT-5 Codex" into model ids
// to classify. Returns [{ id, origins }].
export function modelsInText(text) {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const id = raw.trim().replace(/[)"'`.,;]+$/, '');
    if (!id || seen.has(id.toLowerCase())) return;
    const c = classifyModel(id);
    if (c && c.origins.length) { seen.add(id.toLowerCase()); out.push({ id, origins: c.origins }); }
  };
  const s = text.replace(/<[^>]*>/g, ' ');
  // explicit ids: "(deepseek/deepseek-chat)", "Codex:gpt-5", "model: claude-sonnet-4-5"
  for (const m of s.matchAll(/[\w.-]+\/[\w.:-]+|(?<=[:(]\s*)[a-z][\w.-]*\d[\w.-]*/gi)) add(m[0]);
  // spoken names: "Claude Opus 4.6", "Gemini 2.5 Pro", "GPT-5 Codex", "DeepSeek V3.2", "Kimi K2"
  const NAME = /\b(claude|gpt|o[1-9]|gemini|gemma|deepseek|qwen\d*(?:\.\d+)?|qwq|kimi|glm|grok|mistral|devstral|codestral|llama|minimax|nova|command|phi)(?:[\s-]+[a-z]*\d[\w.]*|[\s-]+(?:opus|sonnet|haiku|pro|flash|mini|nano|coder|codex|chat|reasoner|thinking|instruct|turbo|max|plus|large|small|medium|k\d+)\b)*/gi;
  for (const m of s.matchAll(NAME)) {
    const id = m[0].trim().toLowerCase().replace(/\s+/g, '-');
    // Already covered by an explicit id ("gemini/gemini-2.5-pro" contains "gemini-2.5-pro").
    if ([...seen].some((x) => x.includes(id))) continue;
    add(id);
    if (!seen.has(id)) {
      // "claude" alone, "gemini" alone: classify by family name
      const f = FAMILIES.find((x) => x.id === id || x.label.toLowerCase() === id);
      if (f && !seen.has(f.id)) { seen.add(f.id); out.push({ id: m[0].trim(), origins: [f.id] }); }
    }
  }
  return out;
}

function parseLog(raw) {
  const commits = [];
  for (const rec of raw.split('\x1e')) {
    const r = rec.replace(/^\s+/, '');
    if (!r) continue;
    const [sha, author, email, date, body = ''] = r.split('\x1f');
    const lines = body.trimEnd().split('\n');
    const trailers = [];
    for (const line of lines) {
      const m = line.match(/^([A-Za-z][\w-]*):\s+(.+)$/);
      if (m && AI_TRAILER.test(m[1])) trailers.push({ key: m[1], value: m[2].trim() });
    }
    commits.push({ sha, author, email, date, subject: lines[0] || '', body, trailers });
  }
  return commits;
}

/** Attribute one parsed commit. Returns null when nothing in it names an AI tool or model. */
export function attribute(c) {
  const tools = TOOLS.filter((t) => t.test(c));
  const models = [];
  const evidence = [];
  for (const t of c.trailers) {
    const ms = modelsInText(t.value);
    // Ignore human co-authors: only trailers that name a model or a tool count.
    if (ms.length) { models.push(...ms); evidence.push(`${t.key}: ${t.value}`); }
    else if (tools.some((tool) => tool.test({ ...c, author: '', email: '', body: '', subject: '', trailers: [t] }))) evidence.push(`${t.key}: ${t.value}`);
  }
  if (/\(aider\)\s*$/i.test(c.author)) evidence.push(`author: ${c.author}`);
  const sig = c.body.match(/generated with \[?[\w ]+\]?(\([^)]*\))?/i);
  if (sig) evidence.push(sig[0]);
  if (!tools.length && !models.length) return null;
  if (!evidence.length) evidence.push(`author: ${c.author} <${c.email}>`);
  const origins = new Set(models.flatMap((m) => m.origins));
  // A tool's default vendor counts only when no model is named.
  if (!origins.size) for (const t of tools) if (t.family) origins.add(t.family);
  return {
    sha: c.sha,
    date: c.date,
    tools: tools.map((t) => t.label),
    models: [...new Set(models.map((m) => m.id))],
    origins: [...origins],
    modelStated: models.length > 0,
    evidence: [...new Set(evidence)].slice(0, 3),
  };
}

/** Read `git log` in `dir` and attribute every commit. */
export function scanCommits(dir, { since, max } = {}) {
  const args = ['-C', dir, 'log', '--all', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x1e'];
  if (since) args.push(`--since=${since}`);
  if (max) args.push(`--max-count=${max}`);
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.error) throw new Error(`git not available: ${r.error.message}`);
  if (r.status !== 0) throw new Error((r.stderr || '').trim() || `git log failed in ${dir}`);
  const commits = parseLog(r.stdout);
  const attributed = [];
  for (const c of commits) {
    const a = attribute(c);
    if (a) attributed.push(a);
  }
  return { total: commits.length, attributed, first: commits.at(-1)?.date, last: commits[0]?.date };
}

/** Group attributed commits by tool + model. */
export function summarizeCommits(scan) {
  const groups = new Map();
  for (const a of scan.attributed) {
    const key = `${a.tools.join('+') || '—'}|${a.models.join(', ') || '(model not stated)'}`;
    let g = groups.get(key);
    if (!g) { g = { tool: a.tools.join(' + ') || '—', model: a.models.join(', ') || '(model not stated)', origins: a.origins, modelStated: a.modelStated, count: 0, first: a.date, last: a.date, sample: a.sha, evidence: a.evidence[0] }; groups.set(key, g); }
    g.count++;
    if (a.date < g.first) g.first = a.date;
    if (a.date > g.last) { g.last = a.date; g.sample = a.sha; }
  }
  const byOrigin = {};
  for (const a of scan.attributed) for (const o of a.origins.length ? a.origins : ['unknown']) byOrigin[o] = (byOrigin[o] || 0) + 1;
  return { groups: [...groups.values()].sort((x, y) => y.count - x.count), byOrigin };
}
