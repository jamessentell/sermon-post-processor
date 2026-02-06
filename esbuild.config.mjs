import { build } from 'esbuild';

await build({
  entryPoints: ['src/renderer.ts'],
  bundle: true,
  outfile: 'dist/renderer.js',
  platform: 'browser',
  target: 'es2021',
});
