// What a model id, endpoint or package tells us about where a model comes from.
// Everything here is offline knowledge. It is not exhaustive: unknown ids are reported as "unknown".

// Model families, keyed by the organisation that trained the original weights.
// `test` runs on the lower-cased model part of an id (route prefixes and org already removed).
export const FAMILIES = [
  { id: 'deepseek', label: 'DeepSeek', test: /deepseek|^r1-1776|^mai-ds-r1|^deepscaler|^deepcoder-/ },
  { id: 'openai', label: 'OpenAI', test: /^(gpt-|chatgpt-|o[1-9](-mini|-pro|-preview|-deep-research|-\d{4}|$)|text-embedding-(3|ada)|text-davinci|davinci-|babbage-|whisper-1|dall-e-|tts-1|gpt-image-|omni-moderation|codex-mini|computer-use-preview)/ },
  { id: 'anthropic', label: 'Anthropic', test: /^claude-|^claude$/ },
  { id: 'google', label: 'Google', test: /^(gemini-|gemma(-|\d|$)|text-bison|chat-bison|text-embedding-00\d|gemini-embedding|palm-)/ },
  { id: 'meta', label: 'Meta', test: /^(meta-)?llama|^codellama/ },
  { id: 'mistral', label: 'Mistral', test: /^(mistral|mixtral|codestral|ministral|pixtral|magistral|devstral|voxtral|open-mistral|open-mixtral)/ },
  { id: 'qwen', label: 'Qwen (Alibaba)', test: /^(qwen|qwq|qvq)/ },
  { id: 'moonshot', label: 'Moonshot (Kimi)', test: /^(kimi|moonshot-)/ },
  { id: 'zhipu', label: 'Zhipu / Z.ai (GLM)', test: /^(glm-|chatglm|codegeex)/ },
  { id: 'minimax', label: 'MiniMax', test: /^(minimax|abab\d)/ },
  { id: 'xai', label: 'xAI (Grok)', test: /^grok(-|$)/ },
  { id: 'cohere', label: 'Cohere', test: /^(command-(r|a|light)|c4ai-|aya-|embed-(english|multilingual)|rerank-(english|multilingual|v\d))/ },
  { id: 'microsoft', label: 'Microsoft', test: /^phi-?\d/ },
  { id: 'nvidia', label: 'NVIDIA', test: /nemotron/ },
  { id: 'amazon', label: 'Amazon', test: /^(nova-|titan-)/ },
  { id: 'ai21', label: 'AI21', test: /^jamba/ },
  { id: 'ibm', label: 'IBM', test: /^granite[-.]?\d/ },
  { id: 'perplexity', label: 'Perplexity', test: /^sonar(-pro|-reasoning|-deep-research)?$/ },
  { id: 'baidu', label: 'Baidu (ERNIE)', test: /^ernie/ },
  { id: 'tencent', label: 'Tencent (Hunyuan)', test: /^hunyuan/ },
  { id: 'bytedance', label: 'ByteDance (Doubao)', test: /^doubao/ },
  { id: '01ai', label: '01.AI (Yi)', test: /^yi-(\d|lightning|large)/ },
  { id: 'inception', label: 'Inception (Mercury)', test: /^mercury-/ },
];

export const FAMILY_LABEL = Object.fromEntries(FAMILIES.map((f) => [f.id, f.label]));
FAMILY_LABEL.unknown = 'Unknown';

// Hub organisations whose own models belong to a family (used when the model name alone says nothing).
export const ORG_FAMILY = {
  'deepseek-ai': 'deepseek', deepseek: 'deepseek',
  openai: 'openai', anthropic: 'anthropic', google: 'google', 'meta-llama': 'meta', meta: 'meta',
  mistralai: 'mistral', qwen: 'qwen', alibaba: 'qwen', moonshotai: 'moonshot', thudm: 'zhipu', 'zai-org': 'zhipu',
  'z-ai': 'zhipu', minimaxai: 'minimax', minimax: 'minimax', 'x-ai': 'xai', xai: 'xai', cohereforai: 'cohere',
  coherelabs: 'cohere', cohere: 'cohere', microsoft: null, nvidia: null, 'ibm-granite': 'ibm',
  perplexity: 'perplexity', baidu: 'baidu', tencent: 'tencent', 'bytedance-seed': 'bytedance', '01-ai': '01ai',
};

// Models whose weights were built on another family's weights. Both families are reported.
// Each entry names a public source so the claim can be checked.
export const DERIVATIVES = [
  { test: /deepseek-r1-distill-qwen/, origins: ['deepseek', 'qwen'], note: 'DeepSeek R1 distilled into Qwen2.5 weights (DeepSeek-R1 model card)' },
  { test: /deepseek-r1-distill-llama/, origins: ['deepseek', 'meta'], note: 'DeepSeek R1 distilled into Llama 3 weights (DeepSeek-R1 model card)' },
  { test: /^r1-1776/, origins: ['deepseek'], note: 'Perplexity post-training of DeepSeek-R1 (perplexity-ai/r1-1776 model card)' },
  { test: /^mai-ds-r1/, origins: ['deepseek'], note: 'Microsoft post-training of DeepSeek-R1 (microsoft/MAI-DS-R1 model card)' },
  { test: /^deepscaler/, origins: ['deepseek', 'qwen'], note: 'Agentica fine-tune of DeepSeek-R1-Distill-Qwen-1.5B' },
  { test: /^deepcoder-/, origins: ['deepseek', 'qwen'], note: 'Agentica fine-tune of DeepSeek-R1-Distill-Qwen-14B' },
];

// Names that suggest a community has removed or altered safety training. Relevant to supply-chain review:
// anyone can publish such weights, and their behaviour is not covered by the original vendor's testing.
export const MODIFIED_TEST = /abliterat|uncensored|lorablated|jailbr[eo]ak|-ablit\b|unaligned/;

// DeepSeek's special tokens use fullwidth bars and U+2581: <｜begin▁of▁sentence｜>, <｜Assistant｜>.
// They survive renaming and re-uploading, so they are evidence even when metadata says nothing.
export const DEEPSEEK_TOKENS = /<｜(begin▁of▁sentence|Assistant|User|end▁of▁sentence)｜>/;

// Short or generic ids that only count when the line talks about a model.
export const WEAK_ID = /^(o[1-9]|grok|kimi|sonar|claude|glm-\d|phi\d?)$/;

// Hosts. `family` is set when the host only serves one vendor's own models.
export const ENDPOINTS = [
  { host: /(^|\.)api\.openai\.com$/, name: 'OpenAI API', family: 'openai' },
  { host: /\.openai\.azure\.com$/, name: 'Azure OpenAI', family: null, aggregator: true },
  { host: /(^|\.)api\.anthropic\.com$/, name: 'Anthropic API', family: 'anthropic' },
  { host: /(^|\.)generativelanguage\.googleapis\.com$/, name: 'Gemini API', family: 'google' },
  { host: /aiplatform\.googleapis\.com$/, name: 'Vertex AI', family: null, aggregator: true },
  { host: /(^|\.)api\.deepseek\.com$/, name: 'DeepSeek API', family: 'deepseek' },
  { host: /(^|\.)api\.moonshot\.(cn|ai)$/, name: 'Moonshot API', family: 'moonshot' },
  { host: /(^|\.)(open\.bigmodel\.cn|api\.z\.ai)$/, name: 'Zhipu / Z.ai API', family: 'zhipu' },
  { host: /(^|\.)api\.minimaxi?\.(chat|com|io)$/, name: 'MiniMax API', family: 'minimax' },
  { host: /(^|\.)dashscope(-intl)?\.aliyuncs\.com$/, name: 'Alibaba DashScope', family: 'qwen' },
  { host: /(^|\.)api\.mistral\.ai$/, name: 'Mistral API', family: 'mistral' },
  { host: /(^|\.)api\.x\.ai$/, name: 'xAI API', family: 'xai' },
  { host: /(^|\.)api\.cohere\.(com|ai)$/, name: 'Cohere API', family: 'cohere' },
  { host: /(^|\.)api\.perplexity\.ai$/, name: 'Perplexity API', family: 'perplexity' },
  { host: /(^|\.)api\.inceptionlabs\.ai$/, name: 'Inception API', family: 'inception' },
  { host: /(^|\.)qianfan\.baidubce\.com$/, name: 'Baidu Qianfan', family: 'baidu' },
  { host: /(^|\.)ark\.[\w-]+\.volces\.com$/, name: 'ByteDance Ark', family: 'bytedance' },
  { host: /(^|\.)api\.lingyiwanwu\.com$/, name: '01.AI API', family: '01ai' },
  { host: /(^|\.)openrouter\.ai$/, name: 'OpenRouter', family: null, aggregator: true },
  { host: /(^|\.)api\.together\.(xyz|ai)$/, name: 'Together AI', family: null, aggregator: true },
  { host: /(^|\.)api\.groq\.com$/, name: 'Groq', family: null, aggregator: true },
  { host: /(^|\.)api\.fireworks\.ai$/, name: 'Fireworks AI', family: null, aggregator: true },
  { host: /(^|\.)api\.deepinfra\.com$/, name: 'DeepInfra', family: null, aggregator: true },
  { host: /(^|\.)api\.siliconflow\.(cn|com)$/, name: 'SiliconFlow', family: null, aggregator: true },
  { host: /(^|\.)api\.hyperbolic\.xyz$/, name: 'Hyperbolic', family: null, aggregator: true },
  { host: /(^|\.)router\.huggingface\.co$|(^|\.)api-inference\.huggingface\.co$/, name: 'Hugging Face Inference', family: null, aggregator: true },
  { host: /^bedrock-runtime\.[\w-]+\.amazonaws\.com$/, name: 'Amazon Bedrock', family: null, aggregator: true },
  { host: /^(localhost|127\.0\.0\.1):11434$/, name: 'Ollama (local)', family: null, aggregator: true },
];

// SDK packages. `family` is null for multi-provider SDKs.
const NPM = {
  openai: 'openai', '@anthropic-ai/sdk': 'anthropic', '@google/genai': 'google', '@google/generative-ai': 'google',
  '@mistralai/mistralai': 'mistral', 'cohere-ai': 'cohere', '@deepseek/sdk': 'deepseek',
  'groq-sdk': null, 'together-ai': null, '@openrouter/ai-sdk-provider': null, ollama: null,
  '@aws-sdk/client-bedrock-runtime': null, litellm: null,
};
const PYPI = {
  openai: 'openai', anthropic: 'anthropic', 'google-genai': 'google', 'google-generativeai': 'google',
  mistralai: 'mistral', cohere: 'cohere', dashscope: 'qwen', zhipuai: 'zhipu', zai: 'zhipu', 'zai-sdk': 'zhipu',
  'volcengine-python-sdk': 'bytedance', qianfan: 'baidu', deepseek: 'deepseek',
  groq: null, together: null, ollama: null, litellm: null, openrouter: null,
};
// Integration packages named after a provider: @ai-sdk/<p>, @langchain/<p>, langchain-<p>, llama-index-llms-<p>.
const PROVIDER_SLUG = {
  openai: 'openai', anthropic: 'anthropic', google: 'google', 'google-genai': 'google', 'google-vertex': null, gemini: 'google',
  deepseek: 'deepseek', mistral: 'mistral', mistralai: 'mistral', xai: 'xai', cohere: 'cohere', groq: null,
  togetherai: null, together: null, fireworks: null, deepinfra: null, perplexity: 'perplexity', 'amazon-bedrock': null,
  aws: null, ollama: null, openrouter: null, azure: null, moonshotai: 'moonshot', moonshot: 'moonshot',
  qwen: 'qwen', alibaba: 'qwen', dashscope: 'qwen', zhipuai: 'zhipu', minimax: 'minimax', cerebras: null,
};

export function classifyPackage(name, ecosystem) {
  const n = name.toLowerCase();
  const table = ecosystem === 'npm' ? NPM : PYPI;
  if (n in table) return { family: table[n] };
  const m = n.match(/^(?:@ai-sdk\/|@langchain\/|langchain-|langchain_|llama-index-llms-)([a-z0-9-]+)$/);
  if (m && m[1] in PROVIDER_SLUG) return { family: PROVIDER_SLUG[m[1]] };
  return null;
}

export function classifyHost(host) {
  const h = host.toLowerCase();
  for (const e of ENDPOINTS) if (e.host.test(h)) return e;
  return null;
}

// LiteLLM-style "<host>/<model>" prefixes that name a hosting route, not the model's author.
const LITELLM_HOSTS = new Set(['groq', 'together_ai', 'fireworks_ai', 'bedrock', 'bedrock_converse', 'vertex_ai', 'azure', 'azure_ai',
  'ollama', 'ollama_chat', 'huggingface', 'deepinfra', 'cerebras', 'sambanova', 'nvidia_nim', 'sagemaker', 'replicate', 'cloudflare',
  'watsonx', 'databricks', 'github', 'friendliai', 'novita', 'hyperbolic', 'lm_studio', 'hosted_vllm', 'vllm', 'nebius', 'siliconflow']);

// LiteLLM-style "<vendor>/<model>" prefixes that call the vendor's own API.
const LITELLM_VENDORS = { gemini: 'google', vertex_ai_beta: 'google', xai: 'xai', mistral: 'mistral', deepseek: 'deepseek', anthropic: 'anthropic',
  openai: 'openai', cohere: 'cohere', cohere_chat: 'cohere', perplexity: 'perplexity', moonshot: 'moonshot', dashscope: 'qwen',
  volcengine: 'bytedance', zai: 'zhipu', minimax: 'minimax' };

const BEDROCK =/^(?:(us|eu|apac|global)\.)?(anthropic|meta|mistral|deepseek|amazon|cohere|ai21|qwen|writer|openai)\.([\w.:-]+)$/;
const OLLAMA_TAG = /^([a-z0-9][\w.-]*):([\w.-]+)$/;

// Split a raw id into route, org and model part.
export function parseId(raw) {
  let s = raw.trim();
  let route = null;
  let org = null;
  const lp = s.toLowerCase().match(/^([a-z_]+)\//);
  if (lp && LITELLM_HOSTS.has(lp[1])) { route = lp[1]; s = s.slice(lp[0].length); }
  else if (lp && LITELLM_VENDORS[lp[1]] && !s.slice(lp[0].length).includes('/')) { route = 'direct'; org = lp[1]; s = s.slice(lp[0].length); }
  const lower = s.toLowerCase();
  if (lower.startsWith('hf.co/') || lower.startsWith('huggingface.co/')) { route = 'ollama-hf'; s = s.slice(s.indexOf('/') + 1); }
  else if (lower.startsWith('openrouter/')) { route = 'openrouter'; s = s.slice(11); }
  else if (lower.startsWith('accounts/fireworks/models/')) { route = 'fireworks'; s = s.slice(26); }
  else if (lower.startsWith('models/')) { route = 'gemini-api'; s = s.slice(7); }
  const pub = s.match(/^publishers\/([\w-]+)\/models\/(.+)$/);
  if (pub) { route = 'vertex'; org = pub[1].toLowerCase(); s = pub[2]; }
  const br = s.toLowerCase().match(BEDROCK);
  if (!org && br) { route = 'bedrock'; org = br[2]; s = br[3].replace(/-v\d+(:\d+)?$/, ''); }
  if (!org && s.includes('/')) {
    const i = s.indexOf('/');
    org = s.slice(0, i).toLowerCase();
    s = s.slice(i + 1);
    if (!route) route = 'hub';
  }
  let tag = null;
  const ot = s.match(OLLAMA_TAG);
  if (ot && !/@/.test(s)) { s = ot[1]; tag = ot[2]; if (!route) route = 'ollama'; }
  s = s.replace(/@[\w.-]+$/, ''); // vertex version suffix
  if (route === 'ollama-hf') s = s.replace(/-gguf$/i, '');
  return { route, org, model: s, tag };
}

// Classify one id. Returns null when it does not look like a model id we know.
export function classifyModel(raw) {
  const p = parseId(raw);
  const m = p.model.toLowerCase();
  const origins = new Set();
  const notes = [];
  for (const d of DERIVATIVES) if (d.test.test(m)) { d.origins.forEach((o) => origins.add(o)); notes.push(d.note); }
  if (!origins.size) {
    for (const f of FAMILIES) if (f.test.test(m)) { origins.add(f.id); break; }
  }
  const orgFamily = p.org ? (p.route === 'direct' ? LITELLM_VENDORS[p.org] : ORG_FAMILY[p.org]) : undefined;
  // When only the org says who made it ("openai/example", "openai/openai-agents-python"), the model part
  // must look like a model name: it needs a digit (DeepSeek-V3, r1, whisper-large-v3).
  if (orgFamily && (origins.size || /\d/.test(m))) origins.add(orgFamily);
  if (!origins.size) return null;
  const flags = [];
  if (MODIFIED_TEST.test(m)) flags.push('community-modified');
  // Only hub-style ids name who uploaded the weights; hosting routes do not.
  if (p.org && orgFamily === undefined && ['hub', 'ollama-hf', 'openrouter', 'lm-studio'].includes(p.route)) flags.push('third-party-upload');
  return { route: p.route, org: p.org, model: p.model, tag: p.tag, origins: [...origins], notes, flags };
}

export function isWeak(raw) {
  return WEAK_ID.test(raw.toLowerCase());
}

// "openrouter/auto" and friends: the model is chosen at request time, so a static scan cannot say which.
export const ROUTER_ID = /^(openrouter\/(auto|free|router)|auto-router|router\/auto)$/i;
