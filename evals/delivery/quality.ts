import { spawn } from 'node:child_process';
import type { DeliveryStage, QualityId } from './report.ts';
export const commands: Record<QualityId, readonly string[]> = {
  typecheck: ['run', 'typecheck'], test: ['test'], pi_offline: ['run', 'pi:offline'],
  knowledge_check: ['run', 'check:knowledge'], openapi_lint: ['run', 'openapi:lint'],
};
export function parseCounts(id: QualityId, tail: string) {
  const last = (re: RegExp) => [...tail.matchAll(re)].at(-1)?.[1];
  const n = (s: string | undefined) => s === undefined ? null : Number(s);
  return id === 'test' ? { testsPassed: n(last(/(\d+) pass\b/g)), testsFailed: n(last(/(\d+) fail\b/g)),
    assertions: n(last(/(\d+) expect\(\) calls/g)), warnings: null } : null;
}
/** Fixed commands only. Output is bounded and discarded; it is never included in artifacts. */
// The 995-test Windows matrix completed in 246s (2026-11-15); keep a bounded 300s window.
export async function runQuality(id: QualityId, root: string, signal?: AbortSignal, timeoutMs = id === 'test' ? 300000 : 120000): Promise<DeliveryStage> {
  const start = performance.now();
  return new Promise(resolve => {
    let settled = false, stopping: DeliveryStage['error'] = null, total = 0, tail = '', timer: ReturnType<typeof setTimeout>, cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const env: NodeJS.ProcessEnv = { CI: '1', NO_COLOR: '1' };
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'OS']) if (process.env[key]) env[key] = process.env[key];
    const child = spawn(process.execPath, ['--no-env-file', ...commands[id]], { cwd: root, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (exitCode: number | null, error: DeliveryStage['error']) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(cleanupTimer); signal?.removeEventListener('abort', cancel);
      child.stdout?.destroy(); child.stderr?.destroy();
      const counts = parseCounts(id, tail);
      if (!error && id === 'test' && (!counts?.testsPassed || counts.testsFailed !== 0 || counts.assertions === null)) error = 'CHECK_SUMMARY_MISSING';
      resolve({ id, status: error ? 'failed' : 'passed', durationMs: Math.round(performance.now() - start), error, skippedBecause: null, exitCode, counts });
    };
    const stop = (error: DeliveryStage['error']) => {
      if (settled || stopping) return; stopping = error;
      // Best effort cleanup of this owned process tree; not an OS sandbox guarantee.
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        // Give /T time to enumerate descendants while the parent PID still exists.
        const fallback = () => { if (settled) return; child.kill('SIGKILL'); finish(null, error); };
        killer.on('error', fallback); killer.on('close', fallback);
        cleanupTimer = setTimeout(() => { killer.kill(); fallback(); }, 2000); killer.unref(); return;
      }
      child.kill('SIGKILL'); finish(null, error);
    };
    const cancel = () => stop('CHECK_CANCELLED');
    const chunk = (data: Buffer) => { total += data.length; if (total > 1024 * 1024) return stop('CHECK_OUTPUT_LIMIT'); tail = (tail + data.toString('utf8')).slice(-32768); };
    child.stdout.on('data', chunk); child.stderr.on('data', chunk);
    child.on('error', () => finish(null, 'CHECK_START_FAILED'));
    child.on('close', code => finish(code, stopping ?? (code === 0 ? null : 'CHECK_FAILED')));
    timer = setTimeout(() => stop('CHECK_TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
  });
}
