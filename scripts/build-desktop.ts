import { build as bundle } from 'esbuild';
import { build as buildRenderer } from 'vite';
await bundle({ entryPoints: ['apps/desktop/src/main/index.ts'], outfile: 'apps/desktop/dist/main.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['electron'] });
await bundle({ entryPoints: ['apps/desktop/src/preload/index.ts'], outfile: 'apps/desktop/dist/preload.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] });
await buildRenderer({ configFile: 'apps/desktop/vite.config.ts' });
console.log('Desktop bundles built. Electron GUI and Windows installer are not verified by this command.');
