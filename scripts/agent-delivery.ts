import { mkdir, mkdtemp } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runDelivery } from '../evals/delivery/runner.ts';
import { verifyDeliveryBundle, writeDeliveryBundle } from '../evals/delivery/bundle.ts';
export function parseDeliveryArgs(args: string[]) {
  if (args.length === 2 && args[0] === '--verify' && basename(args[1]!) === 'report.json') return { verify: resolve(args[1]!) };
  if (args.some(a => !['--in-process', '--scenarios-only'].includes(a)) || new Set(args).size !== args.length) throw new Error('DELIVERY_ARGS_INVALID');
  return { transport: args.includes('--in-process') ? 'in-process' as const : 'tcp' as const,
    checks: args.includes('--scenarios-only') ? 'scenarios-only' as const : 'full' as const };
}
export async function deliveryMain(args: string[]) {
  const config = parseDeliveryArgs(args), root = process.cwd();
  if ('verify' in config) {
    const r = await verifyDeliveryBundle(dirname(config.verify!), root);
    console.log(JSON.stringify({ verified: true, status: r.status, digest: r.digest, rerun: false })); return r.status === 'failed' ? 1 : 0;
  }
  const cache = join(root, '.cache', 'agent-delivery'); await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, 'run-')), controller = new AbortController();
  const cancel = () => controller.abort(); process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    const result = await runDelivery({ root, ...config, signal: controller.signal, onStage: id => console.log(`delivery:${id}`) });
    await writeDeliveryBundle(dir, result); await verifyDeliveryBundle(dir, root);
    console.log(JSON.stringify({ status: result.report.status, summary: result.report.summary, report: join(dir, 'report.json'), productReady: false, liveModelCalls: 0 }));
    return result.report.status === 'failed' ? 1 : 0;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await deliveryMain(process.argv.slice(2)); }
  catch { console.error('DELIVERY_EXECUTION_FAILED'); process.exitCode = 2; }
}
