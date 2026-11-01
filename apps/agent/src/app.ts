import { Hono } from 'hono';
import { toProblem } from '../../../packages/contracts/src/errors.ts';
export function createAgentApp() {
  const app = new Hono();
  app.get('/health', (c) => c.json({ service: 'agent', stage: 'scaffold', liveModelConfigured: false,
    capabilities: ['offline-pi-spike', 'draft-seed-knowledge'] }));
  app.notFound((c) => {
    const problem = toProblem(c.req.path.startsWith('/internal/v1/') ? 'NOT_IMPLEMENTED' : 'NOT_FOUND', crypto.randomUUID());
    return new Response(JSON.stringify(problem), { status: problem.status, headers: { 'content-type': 'application/problem+json' } });
  });
  app.onError(() => {
    const problem = toProblem('INTERNAL_ERROR', crypto.randomUUID());
    return new Response(JSON.stringify(problem), { status: 500, headers: { 'content-type': 'application/problem+json' } });
  });
  return app;
}
