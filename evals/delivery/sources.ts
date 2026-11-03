import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { DeliveryReport } from './report.ts';
const roots = ['apps', 'packages', 'tests', 'scripts', 'experiments', 'evals', 'knowledge', 'docs', 'package.json', 'bun.lock', 'bunfig.toml', 'tsconfig.json', 'README.md', 'AGENTS.md'];
const exclude = new Set(['node_modules', 'dist', 'release', 'coverage', '.cache', '.git', '.agents', '.codex', '.sdd']);
export async function collectDeliverySources(root: string): Promise<DeliveryReport['sourceManifest']> {
  const base = await realpath(root), result: DeliveryReport['sourceManifest'] = [];
  async function visit(path: string) {
    const stat = await lstat(path); if (stat.isSymbolicLink()) throw new Error('DELIVERY_SOURCE_INVALID');
    const rel = relative(base, await realpath(path)); if (rel.startsWith('..') || resolve(base, rel) !== path) throw new Error('DELIVERY_SOURCE_INVALID');
    if (stat.isDirectory()) { for (const name of (await readdir(path)).sort()) if (!exclude.has(name) && !name.startsWith('.')) await visit(resolve(path, name)); }
    else if (stat.isFile()) {
      const name = rel.split(sep).join('/');
      // Fixed source formats only; never inspect nested .env files, PEMs or key stores.
      if (!roots.includes(name) && (!/\.(ts|tsx|json|yaml|yml|md|html|css|svg|wav)$/.test(name) || name.split('/').some(part => part.startsWith('.')))) return;
      if (!/^[A-Za-z0-9_./-]+$/.test(name) || stat.size > 16 * 1024 * 1024 || result.length >= 5000) throw new Error('DELIVERY_SOURCE_INVALID');
      result.push({ path: name, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
    }
  }
  for (const name of roots) await visit(resolve(base, name));
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
