// Minimal GGUF metadata reader: reads only the key/value header, never the tensors.
// Spec: https://github.com/ggml-org/ggml/blob/master/docs/gguf.md
import { openSync, readSync, closeSync } from 'node:fs';
import { DEEPSEEK_TOKENS } from './catalog.js';

const MAX_HEADER = 64 * 1024 * 1024;
const WANT = /^(general\.(name|basename|architecture|organization|finetune|license|base_model\..*|source\..*|tags)|tokenizer\.chat_template|tokenizer\.ggml\.(bos_token_id|model))$/;

class Reader {
  constructor(fd) { this.fd = fd; this.buf = Buffer.alloc(0); this.base = 0; this.pos = 0; }
  need(n) {
    const have = this.base + this.buf.length - this.pos;
    if (have >= n) return;
    if (this.pos + n > MAX_HEADER) throw new Error('header too large');
    const start = this.pos - this.base;
    const chunk = Buffer.alloc(Math.max(n - have, 1 << 20));
    const got = readSync(this.fd, chunk, 0, chunk.length, this.base + this.buf.length);
    if (got + have < n) throw new Error('unexpected end of file');
    this.buf = Buffer.concat([this.buf.subarray(start), chunk.subarray(0, got)]);
    this.base = this.pos;
  }
  off() { return this.pos - this.base; }
  u8() { this.need(1); const v = this.buf.readUInt8(this.off()); this.pos += 1; return v; }
  i8() { this.need(1); const v = this.buf.readInt8(this.off()); this.pos += 1; return v; }
  u16() { this.need(2); const v = this.buf.readUInt16LE(this.off()); this.pos += 2; return v; }
  i16() { this.need(2); const v = this.buf.readInt16LE(this.off()); this.pos += 2; return v; }
  u32() { this.need(4); const v = this.buf.readUInt32LE(this.off()); this.pos += 4; return v; }
  i32() { this.need(4); const v = this.buf.readInt32LE(this.off()); this.pos += 4; return v; }
  f32() { this.need(4); const v = this.buf.readFloatLE(this.off()); this.pos += 4; return v; }
  u64() { this.need(8); const v = this.buf.readBigUInt64LE(this.off()); this.pos += 8; return Number(v); }
  i64() { this.need(8); const v = this.buf.readBigInt64LE(this.off()); this.pos += 8; return Number(v); }
  f64() { this.need(8); const v = this.buf.readDoubleLE(this.off()); this.pos += 8; return v; }
  str() { const n = this.u64(); this.need(n); const v = this.buf.toString('utf8', this.off(), this.off() + n); this.pos += n; return v; }
  skip(n) { this.need(n); this.pos += n; }
}

const SIZES = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

function readValue(r, type, keep) {
  switch (type) {
    case 0: return r.u8(); case 1: return r.i8(); case 2: return r.u16(); case 3: return r.i16();
    case 4: return r.u32(); case 5: return r.i32(); case 6: return r.f32(); case 7: return r.u8() !== 0;
    case 8: return r.str(); case 10: return r.u64(); case 11: return r.i64(); case 12: return r.f64();
    case 9: {
      const t = r.u32();
      const n = r.u64();
      if (!keep) {
        if (t === 8) { for (let i = 0; i < n; i++) r.skip(r.u64()); }
        else if (SIZES[t]) r.skip(SIZES[t] * n);
        else for (let i = 0; i < n; i++) readValue(r, t, false);
        return undefined;
      }
      const arr = [];
      for (let i = 0; i < n; i++) arr.push(readValue(r, t, true));
      return arr;
    }
    default: throw new Error(`unknown gguf type ${type}`);
  }
}

// Returns { meta, bosToken } or throws.
export function readGguf(path) {
  const fd = openSync(path, 'r');
  try {
    const r = new Reader(fd);
    r.need(4);
    if (r.buf.toString('latin1', 0, 4) !== 'GGUF') throw new Error('not a GGUF file');
    r.pos = 4;
    const version = r.u32();
    if (version < 2) throw new Error(`unsupported GGUF version ${version}`);
    r.u64(); // tensor count
    const kvCount = r.u64();
    const meta = {};
    let bosId = null;
    let bosToken = null;
    for (let i = 0; i < kvCount; i++) {
      const key = r.str();
      const type = r.u32();
      if (key === 'tokenizer.ggml.tokens' && type === 9) {
        // Only keep the BOS token string; walk the array without storing it.
        const t = r.u32();
        const n = r.u64();
        for (let j = 0; j < n; j++) {
          const s = t === 8 ? r.str() : readValue(r, t, true);
          if (bosId !== null && j === bosId) bosToken = s;
        }
        meta['tokenizer.ggml.tokens.count'] = n;
        continue;
      }
      const v = readValue(r, type, WANT.test(key) && type !== 9 ? true : key === 'general.tags');
      if (v !== undefined && (WANT.test(key))) meta[key] = v;
      if (key === 'tokenizer.ggml.bos_token_id') bosId = v;
    }
    return { version, meta, bosToken };
  } finally {
    closeSync(fd);
  }
}

// Turn GGUF metadata into lineage hints: declared base models and a tokenizer fingerprint.
export function ggufLineage({ meta, bosToken }) {
  const bases = [];
  const count = Number(meta['general.base_model.count'] || 0);
  for (let i = 0; i < count; i++) {
    const name = meta[`general.base_model.${i}.name`];
    const org = meta[`general.base_model.${i}.organization`];
    const repo = meta[`general.base_model.${i}.repo_url`];
    const hub = typeof repo === 'string' ? repo.match(/huggingface\.co\/([^/]+\/[^/?#]+)/) : null;
    bases.push(hub ? hub[1] : [org, name].filter(Boolean).join('/'));
  }
  const tpl = String(meta['tokenizer.chat_template'] || '');
  const fingerprints = [];
  if (DEEPSEEK_TOKENS.test(tpl) || (bosToken && DEEPSEEK_TOKENS.test(bosToken))) fingerprints.push('deepseek');
  return {
    name: meta['general.name'] || meta['general.basename'] || null,
    architecture: meta['general.architecture'] || null,
    license: meta['general.license'] || null,
    bases,
    fingerprints,
  };
}
