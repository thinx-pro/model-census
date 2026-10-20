// Optional online step: walk a Hugging Face model's declared base_model chain using the public API.
// Only model ids are sent to huggingface.co; no file contents. Gated models need a token, which we never ask for.
import { classifyModel, DEEPSEEK_TOKENS } from './catalog.js';

const API = 'https://huggingface.co/api/models/';
const EXPAND = '?expand[]=cardData&expand[]=config&expand[]=gguf';

export async function fetchModel(id, fetchImpl = fetch) {
  const res = await fetchImpl(API + id.split('/').map(encodeURIComponent).join('/') + EXPAND, { headers: { accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) return { id, error: 'gated or private' };
  if (res.status === 404) return { id, error: 'not found' };
  if (!res.ok) return { id, error: `HTTP ${res.status}` };
  return { id, data: await res.json() };
}

function basesOf(data) {
  const b = data?.cardData?.base_model;
  if (!b) return [];
  return (Array.isArray(b) ? b : [b]).filter((x) => typeof x === 'string' && x.includes('/'));
}

function fingerprint(data) {
  const tc = data?.config?.tokenizer_config || {};
  const bos = typeof tc.bos_token === 'string' ? tc.bos_token : tc.bos_token?.content;
  const tpl = [tc.chat_template, data?.gguf?.chat_template, data?.gguf?.bos_token, bos].map((x) => (typeof x === 'string' ? x : '')).join('\n');
  return DEEPSEEK_TOKENS.test(tpl) ? ['deepseek'] : [];
}

// Returns { chain: [{id, license, architecture, error?}], origins, fingerprints, gaps }
export async function lineage(id, { fetchImpl = fetch, maxDepth = 8, cache = new Map() } = {}) {
  const chain = [];
  const origins = new Set();
  const fingerprints = new Set();
  const gaps = [];
  const queue = [{ id, depth: 0 }];
  const visited = new Set();
  while (queue.length) {
    const { id: cur, depth } = queue.shift();
    if (visited.has(cur.toLowerCase()) || depth > maxDepth) continue;
    visited.add(cur.toLowerCase());
    if (!cache.has(cur)) cache.set(cur, await fetchModel(cur, fetchImpl));
    const got = cache.get(cur);
    const c = classifyModel(cur);
    if (c) c.origins.forEach((o) => origins.add(o));
    if (got.error) { chain.push({ id: cur, depth, error: got.error }); gaps.push(`${cur}: ${got.error}`); continue; }
    const d = got.data;
    const node = {
      id: d.id || cur,
      depth,
      license: d.cardData?.license_name || d.cardData?.license || null,
      architecture: d.config?.architectures?.[0] || d.gguf?.architecture || null,
      bases: basesOf(d),
    };
    chain.push(node);
    fingerprint(d).forEach((f) => fingerprints.add(f));
    for (const b of node.bases) queue.push({ id: b, depth: depth + 1 });
    if (!node.bases.length && depth === 0 && !c) gaps.push(`${cur}: no base_model declared`);
  }
  fingerprints.forEach((f) => origins.add(f));
  return { chain, origins: [...origins], fingerprints: [...fingerprints], gaps };
}
