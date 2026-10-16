// Resolve hooks so plain Node (type stripping, Node >= 23.6) can import the app's TypeScript engine for the referee:
// maps "@/x" to src/x.ts and extensionless relative imports to .ts / index.ts. No build step, no new dependency.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function candidate(base) {
  for (const p of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const hit = candidate(path.join(SRC, specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    if (!path.extname(base) || !existsSync(base)) {
      const hit = candidate(base);
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
