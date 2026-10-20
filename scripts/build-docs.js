// Copy the browser-safe modules into docs/lib so the GitHub Pages site runs the same classifier as the CLI.
// Usage: node scripts/build-docs.js
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SHARED = ['catalog.js', 'extract.js', 'hf.js'];
const src = (f) => fileURLToPath(new URL(`../src/${f}`, import.meta.url));
const dst = (f) => fileURLToPath(new URL(`../docs/lib/${f}`, import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(fileURLToPath(new URL('../docs/lib/', import.meta.url)), { recursive: true });
  for (const f of SHARED) copyFileSync(src(f), dst(f));
  console.log(`copied ${SHARED.join(', ')} to docs/lib`);
}
