// Pull model ids, endpoints and SDK packages out of one file's text.
import { classifyModel, classifyHost, classifyPackage, isWeak, ROUTER_ID } from './catalog.js';

const STRING = /(["'`])((?:(?!\1)[^\\\n]|\\.){2,160})\1/g;
// key: value / KEY=value / --model value, unquoted
const ASSIGN = /(?:^|[\s,{(])(?:--)?([\w.-]*(?:model|engine|deployment|llm)[\w.-]*)\s*(?:[:=]|\s)\s*([^\s"'`,;#)}\]]+)/gi;
const URL_RE = /\bhttps?:\/\/([a-z0-9.-]+(?::\d+)?)/gi;
// Credentials and base URLs named after a vendor are strong evidence the code talks to it.
const ENV_VENDOR = { DEEPSEEK: 'deepseek', OPENAI: 'openai', ANTHROPIC: 'anthropic', GEMINI: 'google', GOOGLE_GENERATIVE_AI: 'google',
  MISTRAL: 'mistral', MOONSHOT: 'moonshot', KIMI: 'moonshot', ZHIPU: 'zhipu', ZHIPUAI: 'zhipu', ZAI: 'zhipu', GLM: 'zhipu',
  MINIMAX: 'minimax', DASHSCOPE: 'qwen', QWEN: 'qwen', XAI: 'xai', GROK: 'xai', COHERE: 'cohere', CO: 'cohere', PERPLEXITY: 'perplexity',
  PPLX: 'perplexity', ARK: 'bytedance', VOLCENGINE: 'bytedance', QIANFAN: 'baidu', INCEPTION: 'inception',
  GROQ: null, TOGETHER: null, TOGETHER_AI: null, OPENROUTER: null, FIREWORKS: null, DEEPINFRA: null, SILICONFLOW: null };
const ENV_RE = new RegExp(`\\b(${Object.keys(ENV_VENDOR).sort((a, b) => b.length - a.length).join('|')})_(API_KEY|BASE_URL|API_BASE|API_URL|API_HOST)\\b`, 'g');
const ID_SHAPE = /^[A-Za-z0-9][\w.\-/:@]*[A-Za-z0-9]$/; // "gpt-" prefixes are not ids
// Test doubles and identifiers that merely start with a vendor name: "gemini-test-key", "claude-response-id-1".
const NOISE = /(^|[-_])(key|keys|secret|token|fake|dummy|mock|placeholder|response|request|id|session|user|client|provider|config|settings)([-_]|$)/i;
const MODEL_CONTEXT = /model|engine|llm|deployment|completion|chat|provider/i;

// Bare words like "qwen" or "claude" are usually substring checks (`if "qwen" in name`), not model ids.
// Keep them only when the line assigns them to a model-ish key.
const BARE_WORD = /^[A-Za-z]+$/;
const MODEL_ASSIGN = /(model|engine|llm)\w*["']?\s*[:=]|model=/i;

function candidates(line) {
  const out = [];
  const assigned = MODEL_ASSIGN.test(line);
  for (const m of line.matchAll(STRING)) if (!BARE_WORD.test(m[2]) || assigned) out.push(m[2]);
  for (const m of line.matchAll(ASSIGN)) out.push(m[2]);
  return out;
}

export function extractFromText(text, file) {
  const findings = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 2000) continue; // minified or data blobs
    for (const raw of candidates(line)) {
      const id = raw.trim();
      // '@scope/pkg' and './path' are imports, not model ids
      if (id.length < 2 || id.length > 120 || !ID_SHAPE.test(id) || /^(https?:|@|\.{0,2}\/)/.test(id)) continue;
      if (/^[A-Z0-9_]+$/.test(id) && id.includes('_')) continue; // CONSTANT_NAMES (env vars are handled below)
      if (/^[A-Za-z_]+(\.[A-Za-z_]+)+$/.test(id)) continue; // python.module.paths, openai.AsyncOpenAI
      if (NOISE.test(id.replace(/^.*\//, ''))) continue;
      if (/^[a-z]+\d*[A-Z][A-Za-z0-9]*$/.test(id)) continue; // camelCase identifiers: llama3TemplateMessages
      const key = `m:${id}:${i}`;
      if (seen.has(key)) continue;
      if (ROUTER_ID.test(id)) {
        seen.add(key);
        findings.push({ kind: 'router', id, file, line: i + 1, origins: ['unknown'], route: 'openrouter', flags: ['runtime-routing'], notes: ['Model is picked per request by the router; a static scan cannot tell which.'] });
        continue;
      }
      const c = classifyModel(id);
      if (!c) continue;
      if ((isWeak(id) || id.length < 5) && !MODEL_CONTEXT.test(line)) continue;
      seen.add(key);
      findings.push({ kind: 'model', id, file, line: i + 1, ...c });
    }
    for (const m of line.matchAll(ENV_RE)) {
      // OPENAI_BASE_URL is the standard way to point OpenAI-compatible clients at someone else
      const fam = m[1] === 'OPENAI' && m[2] !== 'API_KEY' ? null : ENV_VENDOR[m[1]];
      const key = `v:${m[0]}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ kind: 'env-var', id: m[0], file, line: i + 1, origins: fam ? [fam] : ['unknown'], route: fam ? 'direct' : 'aggregator', flags: fam ? [] : ['multi-vendor-host'], notes: [] });
    }
    for (const m of line.matchAll(URL_RE)) {
      const host = m[1];
      const e = classifyHost(host);
      if (!e) continue;
      const key = `e:${host}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ kind: 'endpoint', id: host.toLowerCase(), name: e.name, file, line: i + 1, origins: e.family ? [e.family] : ['unknown'], route: e.aggregator ? 'aggregator' : 'direct', flags: e.aggregator ? ['multi-vendor-host'] : [], notes: [] });
    }
  }
  return findings;
}

// package.json dependencies
export function extractFromPackageJson(text, file) {
  let pkg;
  try { pkg = JSON.parse(text); } catch { return []; }
  const out = [];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(pkg[field] || {})) {
      const c = classifyPackage(name, 'npm');
      if (!c) continue;
      out.push({ kind: 'package', id: name, ecosystem: 'npm', file, line: lineOf(text, `"${name}"`), origins: c.family ? [c.family] : ['unknown'], route: c.family ? 'direct' : 'aggregator', flags: c.family ? [] : ['multi-vendor-sdk'], notes: [] });
    }
  }
  return out;
}

// requirements*.txt, pyproject.toml, Pipfile, setup.cfg: look for distribution names at the start of a requirement
export function extractFromPython(text, file) {
  const out = [];
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/#.*/, '');
    const reqs = [];
    const bare = l.match(/^\s*([A-Za-z0-9][\w.-]*)\s*(\[[^\]]*\])?\s*([<>=!~;]|$)/);
    if (bare) reqs.push(bare[1]);
    for (const m of l.matchAll(/["']([A-Za-z0-9][\w.-]*)\s*(\[[^\]]*\])?\s*(?:[<>=!~;][^"']*)?["']/g)) reqs.push(m[1]);
    const poetry = l.match(/^\s*([A-Za-z0-9][\w.-]*)\s*=\s*["{]/);
    if (poetry) reqs.push(poetry[1]);
    for (const r of reqs) {
      const name = r.toLowerCase().replace(/_/g, '-');
      if (seen.has(name)) continue;
      const c = classifyPackage(name, 'pypi');
      if (!c) continue;
      seen.add(name);
      out.push({ kind: 'package', id: name, ecosystem: 'pypi', file, line: i + 1, origins: c.family ? [c.family] : ['unknown'], route: c.family ? 'direct' : 'aggregator', flags: c.family ? [] : ['multi-vendor-sdk'], notes: [] });
    }
  }
  return out;
}

function lineOf(text, needle) {
  const i = text.indexOf(needle);
  if (i < 0) return 1;
  return text.slice(0, i).split('\n').length;
}
