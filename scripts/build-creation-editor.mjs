import { build } from 'esbuild';
await build({ entryPoints: ['src/creation-editor.mjs'], outfile: 'public/vendor/creation-editor.js',
  bundle: true, format: 'esm', minify: true, legalComments: 'eof', platform: 'browser' });
