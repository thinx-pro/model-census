#!/usr/bin/env node
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { walk, scanFiles, scanGguf, scanLocal, enrichOnline } from '../src/scan.js';
import { group, applyPolicy, renderText, renderJson, renderMarkdown, renderCycloneDx, VERSION } from '../src/report.js';
import { FAMILIES } from '../src/catalog.js';

const HELP = `model-census ${VERSION}
Which AI models does this codebase reference, and where do they come from?

Usage
  npx github:thinx-pro/model-census [dir] [options]

Scans code, config, .env files and dependency manifests for model ids,
API endpoints and SDK packages, and maps each to the vendor whose weights
it is built on (including distilled and fine-tuned derivatives).

Options
  --deny <list>      comma-separated origins; exit 1 if anything traces back to them
                     e.g. --deny deepseek   (origins: ${FAMILIES.map((f) => f.id).join(', ')})
  --local            also list models on this machine (Ollama, Hugging Face cache, LM Studio)
                     and read GGUF headers for declared base models and tokenizer fingerprints
  --online           walk the declared base_model chain on Hugging Face for hub ids
                     (sends model ids only, to huggingface.co)
  --docs             include .md / .txt / .rst files (off by default)
  --exclude <list>   comma-separated path fragments to skip, e.g. test,fixtures
  --json             JSON output
  --md               Markdown inventory (paste into a security questionnaire or PR)
  --cyclonedx        CycloneDX 1.6 JSON (models as machine-learning-model components)
  -h, --help         show this help
  -v, --version      show version

Exit codes: 0 ok, 1 denied origin found, 2 usage error.
Read-only. Nothing leaves your machine unless you pass --online.`;

function parseArgs(argv) {
  const o = { dir: '.', deny: [], exclude: [], local: false, online: false, docs: false, format: 'text' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '--deny') o.deny = val().split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a.startsWith('--deny=')) o.deny = a.slice(7).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === '--exclude') o.exclude = val().split(',').filter(Boolean);
    else if (a === '--local') o.local = true;
    else if (a === '--online') o.online = true;
    else if (a === '--docs') o.docs = true;
    else if (a === '--json') o.format = 'json';
    else if (a === '--md') o.format = 'md';
    else if (a === '--cyclonedx') o.format = 'cyclonedx';
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else o.dir = a;
  }
  const known = new Set(FAMILIES.map((f) => f.id));
  for (const d of o.deny) if (!known.has(d)) throw new Error(`unknown origin "${d}" in --deny`);
  return o;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`model-census: ${e.message}\n\nRun with --help for usage.`); process.exit(2); }
  if (o.help) { console.log(HELP); return; }
  if (o.version) { console.log(VERSION); return; }
  const root = resolve(o.dir);
  if (!existsSync(root)) { console.error(`model-census: ${o.dir} does not exist`); process.exit(2); }
  const t0 = Date.now();
  let findings = [];
  let fileCount = 0;
  if (statSync(root).isFile()) {
    if (root.endsWith('.gguf')) findings.push(scanGguf(root, o.dir));
    else { findings.push(...scanFiles([{ path: root, rel: o.dir, kind: 'code' }])); }
    fileCount = 1;
  } else {
    const { files, ggufs } = walk(root, { docs: o.docs, exclude: o.exclude });
    fileCount = files.length + ggufs.length;
    findings.push(...scanFiles(files));
    for (const g of ggufs) findings.push(scanGguf(g, g.slice(root.length + 1)));
  }
  if (o.local) findings.push(...scanLocal());
  if (o.online) {
    const log = o.format === 'text' ? (s) => process.stderr.write(s + '\n') : () => {};
    try { await enrichOnline(findings, { log }); } catch (e) { process.stderr.write(`model-census: --online failed (${e.message}); showing offline results\n`); }
  }
  const groups = group(findings);
  const denied = applyPolicy(groups, o.deny);
  const ctx = { groups, denied, deny: o.deny, root: o.dir, now: new Date().toISOString(), stats: { files: fileCount, ms: Date.now() - t0, local: o.local, online: o.online } };
  const render = { text: renderText, json: renderJson, md: renderMarkdown, cyclonedx: renderCycloneDx }[o.format];
  console.log(render(ctx));
  if (denied.length) process.exitCode = 1;
}

main();
