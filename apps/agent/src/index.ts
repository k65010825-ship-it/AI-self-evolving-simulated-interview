import { createAgentApp } from './app.ts';
const port = Number(process.env.AGENT_PORT ?? 3200);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid AGENT_PORT');
Bun.serve({ hostname: process.env.AGENT_HOST ?? '127.0.0.1', port, fetch: createAgentApp().fetch });
console.log(`Agent scaffold: http://127.0.0.1:${port}/health`);
