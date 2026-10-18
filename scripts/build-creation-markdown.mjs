import { build } from 'esbuild';
await build({ entryPoints: ['src/creation-markdown.mjs'], outfile: 'public/vendor/creation-markdown.js',
  bundle: true, format: 'esm', minify: true, legalComments: 'eof', platform: 'browser' });
