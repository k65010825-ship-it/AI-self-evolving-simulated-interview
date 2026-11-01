import { createApiApp } from './app.ts';
const port = Number(process.env.API_PORT ?? 3100);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT');
Bun.serve({ hostname: process.env.API_HOST ?? '127.0.0.1', port, fetch: createApiApp().fetch });
console.log(`API scaffold: http://127.0.0.1:${port}/health`);
