import { Hono } from 'hono';
import { toProblem } from '../../../packages/contracts/src/errors.ts';
import type { ErrorCode } from '../../../packages/contracts/src/tools.ts';
export function createApiApp(service: 'api' | 'agent' = 'api') {
  const app = new Hono();
  app.get('/health', (c) => c.json({ service, stage: 'scaffold', liveModelConfigured: false,
    capabilities: service === 'agent' ? ['offline-pi-spike', 'draft-seed-knowledge'] : ['health-only'] }));
  app.notFound((c) => {
    const code: ErrorCode = c.req.path.startsWith('/v1/') || c.req.path.startsWith('/internal/v1/') ? 'NOT_IMPLEMENTED' : 'NOT_FOUND';
    const problem = toProblem(code, crypto.randomUUID());
    return new Response(JSON.stringify(problem), { status: problem.status, headers: { 'content-type': 'application/problem+json' } });
  });
  app.onError(() => {
    const problem = toProblem('INTERNAL_ERROR', crypto.randomUUID());
    return new Response(JSON.stringify(problem), { status: 500, headers: { 'content-type': 'application/problem+json' } });
  });
  return app;
}
