// A small fake project that references models the way real code does.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const FILES = {
  'src/llm.ts': `import OpenAI from 'openai';
import { deepseek } from '@ai-sdk/deepseek';
const client = new OpenAI({ baseURL: 'https://api.deepseek.com/v1' });
export const MAIN_MODEL = 'deepseek-chat';
export const FAST = "gpt-4o-mini";
const r = await client.chat.completions.create({ model: 'claude-sonnet-4-5', messages });
`,
  'src/router.py': `import litellm
MODELS = {
    "summarize": "openrouter/deepseek/deepseek-r1",
    "cheap": "groq/deepseek-r1-distill-llama-70b",
    "default": "openrouter/auto",
}
resp = litellm.completion(model="bedrock/us.anthropic.claude-3-5-sonnet-20241022-v2:0", messages=m)
local = "huihui-ai/DeepSeek-R1-Distill-Qwen-7B-abliterated-v2"
`,
  'config/agents.yaml': `planner:
  model: gemini-2.5-pro
  fallback_model: o3
worker:
  llm: qwen2.5-coder:7b
`,
  '.env.example': `LLM_MODEL=moonshot-v1-8k
OPENAI_BASE_URL=https://openrouter.ai/api/v1
`,
  'requirements.txt': `anthropic>=0.40
langchain-deepseek==0.1.3
requests
`,
  'package.json': JSON.stringify({ name: 'demo', dependencies: { openai: '^4', '@ai-sdk/deepseek': '^1', express: '^4' } }, null, 2),
  'README.md': 'We tried "mistral-large-latest" once.\n',
  'src/ui.css.ts': `export const cls = "o3"; const label = 'grok';\n`,
  'node_modules/x/index.js': `const m = "deepseek-chat";\n`,
};

export function makeProject(root) {
  for (const [rel, body] of Object.entries(FILES)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
}

// Write a tiny but valid GGUF v3 file with the given string metadata and token list.
export function writeGguf(path, meta, tokens = null, bosId = null) {
  const parts = [];
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); parts.push(b); };
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); parts.push(b); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); u64(b.length); parts.push(b); };
  parts.push(Buffer.from('GGUF', 'latin1'));
  u32(3);
  u64(0);
  const kv = Object.entries(meta);
  u64(kv.length + (tokens ? 1 : 0) + (bosId !== null ? 1 : 0) + 1);
  // a float array we must skip
  str('llama.rope.freqs'); u32(9); u32(6); u64(3); parts.push(Buffer.alloc(12));
  for (const [k, v] of kv) {
    str(k);
    if (typeof v === 'number') { u32(4); u32(v); } else { u32(8); str(v); }
  }
  if (bosId !== null) { str('tokenizer.ggml.bos_token_id'); u32(4); u32(bosId); }
  if (tokens) { str('tokenizer.ggml.tokens'); u32(9); u32(8); u64(tokens.length); for (const t of tokens) str(t); }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat(parts));
}
