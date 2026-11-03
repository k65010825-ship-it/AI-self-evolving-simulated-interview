import { createHash } from 'node:crypto';
import { open, readdir, readFile, lstat, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { verifyAcceptanceReport, type SourceManifest } from './report.ts';

const sourceRoots = ['apps/agent/src', 'packages/contracts/src', 'packages/interview-domain/src',
  'packages/agent-client/src', 'experiments', 'evals', 'scripts', 'knowledge'];
/** A code/data fingerprint, not a build attestation: excludes credentials and generated artifacts. */
export async function collectSourceManifest(root: string): Promise<SourceManifest> {
  const rootReal = await realpath(root);
  const paths = ['package.json', 'bun.lock', 'tsconfig.json', 'apps/agent/package.json',
    'packages/contracts/package.json', 'packages/interview-domain/package.json', 'packages/agent-client/package.json'];
  async function checkedPath(path: string) {
    const full = join(root, path), actual = await realpath(full), rel = relative(rootReal, actual);
    if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel) || (await lstat(full)).isSymbolicLink()) throw new Error('ACCEPTANCE_SOURCE_INVALID');
    return full;
  }
  async function walk(relative: string) {
    const entries = await readdir(await checkedPath(relative), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('ACCEPTANCE_SOURCE_INVALID');
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(ts|json)$/.test(path)) paths.push(path);
    }
  }
  for (const path of sourceRoots) await walk(path);
  return Promise.all(paths.sort().map(async path => ({ path, sha256: createHash('sha256').update(await readFile(await checkedPath(path))).digest('hex') })));
}

export async function readAcceptanceReport(path: string) {
  const maxBytes = 2 * 1024 * 1024;
  let handle;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(maxBytes + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    if (count > maxBytes) throw new Error('Oversized');
    return verifyAcceptanceReport(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))));
  } catch { throw new Error('ACCEPTANCE_REPORT_INVALID'); }
  finally { await handle?.close(); }
}
