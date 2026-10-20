import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyModel, parseId } from '../src/catalog.js';
import { extractFromText } from '../src/extract.js';
import { walk, scanFiles, scanGguf, scanLocal, enrichOnline } from '../src/scan.js';
import { group, applyPolicy } from '../src/report.js';
import { lineage } from '../src/hf.js';
import { makeProject, writeGguf } from './fixture.js';

const BIN = fileURLToPath(new URL('../bin/model-census.js', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'mc-test-'));

test('classifies ids across routes', () => {
  const cases = {
    'deepseek-chat': ['deepseek'],
    'gpt-4o-mini': ['openai'],
    'claude-sonnet-4-5': ['anthropic'],
    'openrouter/deepseek/deepseek-r1': ['deepseek'],
    'groq/deepseek-r1-distill-llama-70b': ['deepseek', 'meta'],
    'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B': ['deepseek', 'qwen'],
    'us.anthropic.claude-3-5-sonnet-20241022-v2:0': ['anthropic'],
    'deepseek.r1-v1:0': ['deepseek'],
    'qwen2.5-coder:7b': ['qwen'],
    'hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M': ['meta'],
    'accounts/fireworks/models/deepseek-v3': ['deepseek'],
    'publishers/google/models/gemini-2.0-flash@001': ['google'],
    'perplexity-ai/r1-1776': ['deepseek'],
    'mistral-large-latest': ['mistral'],
    'gpt-oss:20b': ['openai'],
  };
  for (const [id, want] of Object.entries(cases)) {
    const c = classifyModel(id);
    assert.ok(c, `${id} should classify`);
    assert.deepEqual(c.origins.sort(), [...want].sort(), id);
  }
  for (const id of ['express', 'react-dom', 'v1', 'utf-8', 'main', 'en-US', 'image/png', 'openai/example', 'openai/openai-agents-python', 'anthropic/model']) assert.equal(classifyModel(id), null, id);
  assert.equal(extractFromText(`x = "openai.AsyncOpenAI"; y = "openai.types.responses.ResponseOutputItem"`, 'a.py').length, 0);
});

test('route prefixes do not count as authors', () => {
  const g = classifyModel('groq/deepseek-r1-distill-llama-70b');
  assert.equal(g.route, 'groq');
  assert.ok(!g.flags.includes('third-party-upload'));
  const h = classifyModel('huihui-ai/DeepSeek-R1-Distill-Qwen-7B-abliterated-v2');
  assert.ok(h.flags.includes('third-party-upload'));
  assert.ok(h.flags.includes('community-modified'));
  assert.equal(parseId('bedrock/us.anthropic.claude-3-5-sonnet-20241022-v2:0').org, 'anthropic');
  assert.ok(!classifyModel('gemini/gemini-2.5-pro').flags.includes('third-party-upload'));
  assert.deepEqual(classifyModel('amazon/nova-pro'), { ...classifyModel('amazon/nova-pro'), origins: ['amazon'], flags: [] });
  assert.ok(!classifyModel('fireworks_ai/accounts/fireworks/models/deepseek-r1').flags.includes('third-party-upload'));
  assert.deepEqual(classifyModel('fireworks_ai/accounts/fireworks/models/deepseek-r1').origins, ['deepseek']);
  assert.equal(extractFromText(`from llama_index.embeddings.huggingface import X; m = "llama_index.embeddings.huggingface"`, 'a.py').length, 0);
  assert.equal(extractFromText(`if "qwen" in name:`, 'a.py').length, 0);
  assert.equal(extractFromText(`api_key="gemini-test-key"; rid = "gemini-response-id-123"; p = "gpt-"; q = "gemini/"`, 'a.py').length, 0);
});

test('short ids need model context on the line', () => {
  assert.equal(extractFromText(`const cls = "o3";`, 'a.ts').length, 0);
  assert.equal(extractFromText(`fallback_model: o3`, 'a.yaml').length, 1);
  assert.equal(extractFromText(`model = "o3"`, 'a.py').length, 1);
});

test('scans a project: models, endpoints, packages, routers; skips node_modules and docs', () => {
  const root = tmp();
  try {
    makeProject(root);
    const { files } = walk(root);
    const groups = group(scanFiles(files));
    const ids = groups.map((g) => `${g.kind}:${g.id}`);
    for (const want of [
      'model:deepseek-chat', 'model:gpt-4o-mini', 'model:claude-sonnet-4-5', 'model:openrouter/deepseek/deepseek-r1',
      'model:groq/deepseek-r1-distill-llama-70b', 'model:gemini-2.5-pro', 'model:o3', 'model:qwen2.5-coder:7b', 'model:moonshot-v1-8k',
      'router:openrouter/auto', 'endpoint:api.deepseek.com', 'endpoint:openrouter.ai',
      'package:@ai-sdk/deepseek', 'package:openai', 'package:anthropic', 'package:langchain-deepseek',
    ]) assert.ok(ids.includes(want), `missing ${want}; got ${ids.join(', ')}`);
    assert.ok(!ids.includes('model:@ai-sdk/deepseek'), 'import specifiers are not model ids');
    assert.ok(ids.includes('env-var:OPENAI_BASE_URL'));
    assert.ok(!ids.some((x) => x.startsWith('model:') && /^[A-Z_]+$/.test(x.slice(6))), 'constant names are not model ids');
    assert.ok(!ids.includes('model:mistral-large-latest'), 'README skipped without --docs');
    assert.ok(!ids.includes('model:grok'), 'weak id without context skipped');
    const ds = groups.find((g) => g.id === 'deepseek-chat');
    assert.equal(ds.locations.length, 1, 'node_modules skipped');
    assert.ok(!ids.includes('package:express') && !ids.includes('package:requests'));
    const denied = applyPolicy(groups, ['deepseek']);
    assert.ok(denied.length >= 7, `denied ${denied.length}`);
    const withDocs = group(scanFiles(walk(root, { docs: true }).files)).map((g) => g.id);
    assert.ok(withDocs.includes('mistral-large-latest'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reads GGUF headers: declared base model and DeepSeek tokenizer fingerprint', () => {
  const root = tmp();
  try {
    const a = join(root, 'a.gguf');
    writeGguf(a, { 'general.name': 'Qwen3 1.7B', 'general.architecture': 'qwen3', 'general.base_model.count': 1, 'general.base_model.0.name': 'Qwen3 1.7B Base', 'general.base_model.0.organization': 'Qwen', 'general.base_model.0.repo_url': 'https://huggingface.co/Qwen/Qwen3-1.7B-Base' }, ['<|endoftext|>', 'a', 'b'], 0);
    const fa = scanGguf(a, 'a.gguf');
    assert.deepEqual(fa.origins, ['qwen']);
    assert.ok(fa.notes.some((n) => n.includes('Qwen/Qwen3-1.7B-Base')));
    assert.deepEqual(fa.flags, []);

    // A renamed model with no declared base, but DeepSeek's special tokens in its vocab.
    const b = join(root, 'b.gguf');
    writeGguf(b, { 'general.name': 'MyCorp Assistant 7B', 'general.architecture': 'qwen2', 'tokenizer.chat_template': '{{bos_token}}{% for m in messages %}{{m.content}}{% endfor %}' }, ['x', '<｜begin▁of▁sentence｜>', 'y'], 1);
    const fb = scanGguf(b, 'b.gguf');
    assert.deepEqual(fb.origins, ['deepseek']);
    assert.ok(fb.flags.includes('undeclared-lineage'));

    const c = join(root, 'bad.gguf');
    writeFileSync(c, 'nope');
    assert.ok(scanGguf(c, 'bad.gguf').flags.includes('unreadable'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('local stores: Ollama manifests and Hugging Face cache', () => {
  const home = tmp();
  try {
    writeGguf(join(home, '.ollama/models/manifests/registry.ollama.ai/library/deepseek-r1/8b'), {});
    writeGguf(join(home, '.ollama/models/manifests/registry.ollama.ai/library/llama3.2/latest'), {});
    writeGguf(join(home, '.cache/huggingface/hub/models--bartowski--Llama-3.2-3B-Instruct-GGUF/snapshots/abc/Llama-3.2-3B-Instruct-Q4_K_M.gguf'), { 'general.name': 'Llama 3.2 3B Instruct' });
    const prevHome = process.env.HF_HOME; const prevHub = process.env.HF_HUB_CACHE;
    delete process.env.HF_HOME; delete process.env.HF_HUB_CACHE;
    const out = scanLocal(home);
    if (prevHome !== undefined) process.env.HF_HOME = prevHome;
    if (prevHub !== undefined) process.env.HF_HUB_CACHE = prevHub;
    const byId = Object.fromEntries(out.map((f) => [f.id, f]));
    assert.deepEqual(byId['deepseek-r1:8b'].origins, ['deepseek']);
    assert.deepEqual(byId['llama3.2:latest'].origins, ['meta']);
    assert.deepEqual(byId['bartowski/Llama-3.2-3B-Instruct-GGUF'].origins, ['meta']);
    assert.ok(!JSON.stringify(out).includes(home), 'home path is shown as ~');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

function fakeHub(models) {
  const calls = [];
  const fetchImpl = async (url) => {
    const id = decodeURIComponent(url.split('/api/models/')[1].split('?')[0]);
    calls.push(id);
    const d = models[id];
    if (!d) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => ({ id, ...d }) };
  };
  return { fetchImpl, calls };
}

test('online lineage walks base_model and spots undeclared DeepSeek tokenizers', async () => {
  const { fetchImpl, calls } = fakeHub({
    'acme/helper-7b': { cardData: { base_model: 'someone/tuned-7b', license: 'apache-2.0' }, config: { architectures: ['Qwen2ForCausalLM'] } },
    'someone/tuned-7b': { cardData: {}, config: { architectures: ['Qwen2ForCausalLM'], tokenizer_config: { bos_token: { content: '<｜begin▁of▁sentence｜>' } } } },
  });
  const l = await lineage('acme/helper-7b', { fetchImpl });
  assert.deepEqual(l.chain.map((n) => n.id), ['acme/helper-7b', 'someone/tuned-7b']);
  assert.ok(l.origins.includes('deepseek'));
  assert.deepEqual(calls, ['acme/helper-7b', 'someone/tuned-7b']);

  const findings = extractFromText(`model = "Qwen/Qwen2.5-7B-Instruct"\nother = "nobody/missing-7b-qwen"`, 'x.py');
  const hub = fakeHub({ 'Qwen/Qwen2.5-7B-Instruct': { cardData: { base_model: 'Qwen/Qwen2.5-7B', license: 'apache-2.0' } }, 'Qwen/Qwen2.5-7B': { cardData: { license: 'apache-2.0' } } });
  await enrichOnline(findings, { fetchImpl: hub.fetchImpl });
  assert.deepEqual(findings[0].lineage.map((n) => n.id), ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-7B']);
  assert.ok(!findings[0].flags.includes('undeclared-lineage'));
});

test('docs/lib copies match src (run scripts/build-docs.js)', async () => {
  const { SHARED } = await import('../scripts/build-docs.js');
  for (const f of SHARED) {
    const a = readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');
    const b = readFileSync(fileURLToPath(new URL(`../docs/lib/${f}`, import.meta.url)), 'utf8');
    assert.equal(a, b, `docs/lib/${f} is stale`);
  }
});

test('CLI: help, exit codes, formats', () => {
  const root = tmp();
  try {
    makeProject(root);
    assert.match(execFileSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' }), /--deny/);
    const ok = spawnSync(process.execPath, [BIN, root], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /DeepSeek/);
    const deny = spawnSync(process.execPath, [BIN, root, '--deny', 'deepseek'], { encoding: 'utf8' });
    assert.equal(deny.status, 1);
    assert.match(deny.stdout, /trace back to denied origins/);
    const clean = spawnSync(process.execPath, [BIN, root, '--deny', 'xai'], { encoding: 'utf8' });
    assert.equal(clean.status, 0);
    const bad = spawnSync(process.execPath, [BIN, root, '--deny', 'nope'], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
    const j = JSON.parse(spawnSync(process.execPath, [BIN, root, '--json'], { encoding: 'utf8' }).stdout);
    assert.ok(j.entries.length > 10);
    const bom = JSON.parse(spawnSync(process.execPath, [BIN, root, '--cyclonedx'], { encoding: 'utf8' }).stdout);
    assert.equal(bom.specVersion, '1.6');
    assert.ok(bom.components.some((c) => c.type === 'machine-learning-model' && c.name === 'deepseek-chat'));
    assert.ok(bom.services.some((s) => s.endpoints[0] === 'https://api.deepseek.com'));
    const md = spawnSync(process.execPath, [BIN, root, '--md', '--deny', 'deepseek'], { encoding: 'utf8' }).stdout;
    assert.match(md, /^# AI model inventory/);
    const noColor = spawnSync(process.execPath, [BIN, root], { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } }).stdout;
    assert.ok(!noColor.includes('\x1b['));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
