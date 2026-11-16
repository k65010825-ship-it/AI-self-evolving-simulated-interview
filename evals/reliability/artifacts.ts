import { open, lstat } from 'node:fs/promises';
import { canonical } from '../answers/validation.ts';
import { collectDeliverySources } from '../delivery/sources.ts';
import { verifyReliabilityReport } from './report.ts';
export async function readReliabilityArtifact(path: string, sourceRoot: string) {
  let handle;
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error('link');
    handle = await open(path, 'r'); if (!(await handle.stat()).isFile()) throw new Error('file');
    const buffer = Buffer.alloc(4 * 1024 * 1024 + 1); let count = 0;
    while (count < buffer.length) { const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null); if (!bytesRead) break; count += bytesRead; }
    if (count === buffer.length) throw new Error('size');
    const r = verifyReliabilityReport(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))));
    if (canonical(r.sourceManifest) !== canonical(await collectDeliverySources(sourceRoot))) throw new Error('source');
    return r;
  } catch { throw new Error('RELIABILITY_ARTIFACT_INVALID'); } finally { await handle?.close(); }
}
