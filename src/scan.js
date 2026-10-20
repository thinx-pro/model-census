import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { extractFromText, extractFromPackageJson, extractFromPython } from './extract.js';
import { classifyModel } from './catalog.js';
import { readGguf, ggufLineage } from './gguf.js';
import { lineage } from './hf.js';

const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'vendor',
  'venv', '.venv', 'env', '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'target', 'coverage', '.turbo', '.cache',
  '.idea', '.vscode-test', 'site-packages', '.tox', 'Pods', 'DerivedData', '.gradle']);
const SKIP_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|uv\.lock|Cargo\.lock|Gemfile\.lock|composer\.lock|go\.sum)$|\.min\.(js|css)$|\.map$/;
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.kts', '.rb', '.php',
  '.cs', '.swift', '.scala', '.ex', '.exs', '.sh', '.bash', '.zsh', '.fish', '.yaml', '.yml', '.toml', '.json', '.jsonc', '.json5', '.ini',
  '.cfg', '.conf', '.properties', '.tf', '.hcl', '.vue', '.svelte', '.astro', '.lua', '.dart', '.r', '.jl', '.ipynb', '.sql', '.env', '.xml']);
const DOC_EXT = new Set(['.md', '.mdx', '.rst', '.txt', '.adoc']);
const MAX_FILE = 1024 * 1024;

function isEnvFile(name) { return /^\.env(\..+)?$/.test(name) || name.endsWith('.env'); }
function isPyManifest(name) { return /^requirements.*\.txt$|^pyproject\.toml$|^Pipfile$|^setup\.cfg$|^constraints.*\.txt$/.test(name); }
function isDockerish(name) { return /^(Dockerfile|Containerfile|Makefile|Procfile|Justfile)(\..+)?$/.test(name) || /\.dockerfile$/i.test(name); }

export function walk(root, { docs = false, exclude = [], maxFiles = 50000 } = {}) {
  const files = [];
  const ggufs = [];
  const stack = [root];
  while (stack.length && files.length < maxFiles) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(dir, e.name);
      const rel = relative(root, p);
      if (exclude.some((x) => rel.includes(x))) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(p); continue; }
      if (!e.isFile()) continue;
      if (SKIP_FILES.test(rel)) continue;
      const ext = extname(e.name).toLowerCase();
      if (ext === '.gguf') { ggufs.push(p); continue; }
      const kind = e.name === 'package.json' ? 'package-json'
        : isPyManifest(e.name) ? 'python'
        : isEnvFile(e.name) || isDockerish(e.name) || CODE_EXT.has(ext) ? 'code'
        : docs && DOC_EXT.has(ext) ? 'doc' : null;
      if (kind) files.push({ path: p, rel, kind });
    }
  }
  return { files, ggufs };
}

export function scanFiles(files) {
  const findings = [];
  for (const f of files) {
    let st;
    try { st = statSync(f.path); } catch { continue; }
    if (st.size > MAX_FILE) continue;
    let text;
    try { text = readFileSync(f.path, 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) continue;
    if (f.kind === 'package-json') findings.push(...extractFromPackageJson(text, f.rel));
    if (f.kind === 'python') findings.push(...extractFromPython(text, f.rel));
    // package.json strings are package names ("gpt-tokenizer"), not model ids
    if (f.kind === 'code' || f.kind === 'doc' || f.rel.endsWith('.toml') || f.rel.endsWith('.cfg')) {
      for (const x of extractFromText(text, f.rel)) { if (f.kind === 'doc') x.doc = true; findings.push(x); }
    }
  }
  return findings;
}

export function scanGguf(path, label) {
  let info;
  try { info = ggufLineage(readGguf(path)); } catch (e) { return { kind: 'local-model', id: basename(path), file: label, line: 0, origins: ['unknown'], route: 'local', flags: ['unreadable'], notes: [String(e.message)] }; }
  const origins = new Set();
  const notes = [];
  const fromName = classifyModel(info.name || basename(path, '.gguf')) || classifyModel(basename(path, '.gguf').replace(/[-.]?(q\d.*|f16|bf16|fp16|iq\d.*)$/i, ''));
  if (fromName) fromName.origins.forEach((o) => origins.add(o));
  for (const b of info.bases) {
    const c = classifyModel(b);
    if (c) c.origins.forEach((o) => origins.add(o));
    notes.push(`declares base model ${b}`);
  }
  for (const fp of info.fingerprints) { origins.add(fp); notes.push(`tokenizer contains ${fp} special tokens`); }
  const flags = [];
  if (fromName?.flags?.includes('community-modified')) flags.push('community-modified');
  if (info.fingerprints.length && !info.bases.length && !(fromName && fromName.origins.some((o) => info.fingerprints.includes(o)))) flags.push('undeclared-lineage');
  return { kind: 'local-model', id: info.name || basename(path), file: label, line: 0, origins: origins.size ? [...origins] : ['unknown'], route: 'local', architecture: info.architecture, license: info.license, bases: info.bases, flags, notes };
}

function listDirs(p) { try { return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } }
function listAll(p) { try { return readdirSync(p, { withFileTypes: true }); } catch { return []; } }

// Models that live on this machine: Ollama, Hugging Face cache, LM Studio.
export function scanLocal(home = homedir()) {
  const out = [];
  const tilde = (p) => (p.startsWith(home) ? '~' + p.slice(home.length) : p);
  // Ollama: manifests/<registry>/<namespace>/<name>/<tag>
  const man = join(home, '.ollama', 'models', 'manifests');
  for (const reg of listDirs(man)) {
    for (const ns of listDirs(join(man, reg))) {
      for (const name of listDirs(join(man, reg, ns))) {
        for (const tag of listAll(join(man, reg, ns, name))) {
          if (!tag.isFile()) continue;
          const id = reg === 'registry.ollama.ai' ? (ns === 'library' ? `${name}:${tag.name}` : `${ns}/${name}:${tag.name}`) : `${reg}/${ns}/${name}:${tag.name}`;
          const c = classifyModel(reg === 'hf.co' ? `hf.co/${ns}/${name}:${tag.name}` : id);
          out.push({ kind: 'local-model', id, file: tilde(join(man, reg, ns, name, tag.name)), line: 0, route: 'ollama', origins: c ? c.origins : ['unknown'], flags: c ? c.flags : [], notes: c ? c.notes : [] });
        }
      }
    }
  }
  // Hugging Face hub cache: models--org--name
  const hub = process.env.HF_HUB_CACHE || join(process.env.HF_HOME || join(home, '.cache', 'huggingface'), 'hub');
  for (const d of listDirs(hub)) {
    if (!d.startsWith('models--')) continue;
    const id = d.slice(8).replace('--', '/');
    const snaps = join(hub, d, 'snapshots');
    const ggufs = [];
    for (const s of listDirs(snaps)) for (const f of listAll(join(snaps, s))) if (f.name.endsWith('.gguf')) ggufs.push(join(snaps, s, f.name));
    const c = classifyModel(id);
    const f = { kind: 'local-model', id, file: tilde(join(hub, d)), line: 0, route: 'hf-cache', origins: c ? c.origins : ['unknown'], flags: c ? c.flags : [], notes: c ? [...c.notes] : [], hub: id };
    if (!ggufs.length && !listDirs(snaps).length) f.notes.push('no snapshot downloaded');
    for (const g of ggufs) {
      const x = scanGguf(g, tilde(g));
      x.origins.forEach((o) => { if (o !== 'unknown' && !f.origins.includes(o)) f.origins.push(o); });
      f.notes.push(...x.notes);
      for (const fl of x.flags) if (!f.flags.includes(fl)) f.flags.push(fl);
    }
    f.origins = f.origins.filter((o) => o !== 'unknown' || f.origins.length === 1);
    out.push(f);
  }
  // LM Studio: <models>/<publisher>/<repo>/*.gguf
  for (const base of [join(home, '.lmstudio', 'models'), join(home, '.cache', 'lm-studio', 'models')]) {
    if (!existsSync(base)) continue;
    for (const pub of listDirs(base)) for (const repo of listDirs(join(base, pub))) {
      for (const f of listAll(join(base, pub, repo))) {
        if (!f.name.endsWith('.gguf')) continue;
        const p = join(base, pub, repo, f.name);
        const x = scanGguf(p, tilde(p));
        const c = classifyModel(`${pub}/${repo}`);
        if (c) c.origins.forEach((o) => { if (!x.origins.includes(o)) x.origins.push(o); });
        x.origins = x.origins.filter((o) => o !== 'unknown' || x.origins.length === 1);
        x.id = `${pub}/${repo}/${f.name}`;
        x.route = 'lm-studio';
        x.hub = `${pub}/${repo}`;
        out.push(x);
      }
    }
  }
  return out;
}

// Enrich findings that carry a hub id with the declared base_model chain from Hugging Face.
export async function enrichOnline(findings, { fetchImpl = fetch, log = () => {} } = {}) {
  const cache = new Map();
  const results = new Map();
  for (const f of findings) {
    const id = f.hub || hubIdOf(f);
    if (!id) continue;
    if (!results.has(id)) { log(`  lineage ${id}`); results.set(id, await lineage(id, { fetchImpl, cache })); }
    const l = results.get(id);
    if (l.chain[0]?.error) { f.notes.push(`Hugging Face: ${l.chain[0].error}`); continue; }
    f.lineage = l.chain.map((n) => ({ id: n.id, depth: n.depth, license: n.license || null, architecture: n.architecture || null, error: n.error }));
    for (const o of l.origins) if (o !== 'unknown' && !f.origins.includes(o)) { f.origins.push(o); f.notes.push(`lineage via Hugging Face reaches ${o}`); }
    f.origins = f.origins.filter((o) => o !== 'unknown' || f.origins.length === 1);
    if (l.fingerprints.length) {
      const declared = l.chain.some((n) => { const c = classifyModel(n.id); return c && l.fingerprints.some((fp) => c.origins.includes(fp)); });
      f.notes.push(`tokenizer contains ${l.fingerprints.join(', ')} special tokens`);
      if (!declared && !f.flags.includes('undeclared-lineage')) f.flags.push('undeclared-lineage');
    }
  }
  return findings;
}

export function hubIdOf(f) {
  if (f.kind !== 'model') return null;
  if (f.route !== 'hub' && f.route !== 'ollama-hf') return null;
  const m = f.id.replace(/^(hf\.co|huggingface\.co)\//i, '').replace(/:[\w.-]+$/, '').match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
