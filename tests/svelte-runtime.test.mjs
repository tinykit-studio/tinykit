import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { rollup } from 'rollup';
import { compile } from 'svelte/compiler';
import { create_svelte_runtime } from '../src/lib/compiler/workers/svelte-runtime.js';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('svelte/package.json'));
const metadata = JSON.parse(readFileSync(join(root, 'package.json')));
const sources = {};
function collect(dir) {
  for (const item of readdirSync(dir, {withFileTypes:true})) {
    if (item.name === 'compiler') continue;
    const path = join(dir,item.name);
    if (item.isDirectory()) collect(path);
    else if (path.endsWith('.js')) sources['/node_modules/svelte/' + relative(root,path)] = readFileSync(path,'utf8');
  }
}
collect(join(root,'src'));
const runtime = create_svelte_runtime(sources, metadata.exports, readFileSync(join(dirname(require.resolve('clsx')), 'clsx.mjs'),'utf8'));

test('Svelte runtime selects browser/server exports and resolves internal aliases locally', () => {
  assert.match(runtime.resolve('svelte',null), /index-client\.js$/);
  assert.match(runtime.resolve('svelte',null,true), /index-server\.js$/);
  const client=runtime.resolve('svelte/internal/client',null);
  assert.match(runtime.resolve('../shared/utils.js',client), /src\/internal\/shared\/utils.js$/);
  assert.match(runtime.resolve('#client/constants',client), /src\/internal\/client\/constants.js$/);
  assert.ok(runtime.load(client).length > 0);
  assert.equal(runtime.resolve('other-package',null),null);
  assert.throws(()=>runtime.resolve('svelte/nonexistent',null),/Unsupported/);
});

const canvas=JSON.parse(readFileSync(new URL('../src/lib/templates/canvas.json',import.meta.url))).frontend_code;
const icon=readFileSync(new URL('../src/lib/compiler/shims/IconifyIcon.svelte',import.meta.url),'utf8');
for(const generate of ['client','server']) {
  test(`Canvas ${generate} bundles with the installed Svelte runtime and no CDN requests`, async () => {
    const server=generate==='server';
    const bundle=await rollup({
      input:'App.svelte',
      external: id => ['$content','$data','$tinykit'].includes(id),
      onwarn: warning => { if(warning.code!=='CIRCULAR_DEPENDENCY') throw new Error(warning.message); },
      plugins:[{
        name:'local-runtime-test',
        resolveId(id,importer) {
          if(id==='App.svelte'||id==='esm-env') return id;
          if(id==='@iconify/svelte') return 'Icon.svelte';
          const resolved=runtime.resolve(id,importer,server);
          assert.ok(resolved, `Unexpected remote or unresolved dependency: ${id}`);
          return resolved;
        },
        load(id) {
          if(id==='App.svelte') return compile(canvas,{generate,filename:id}).js.code;
          if(id==='Icon.svelte') return compile(icon,{generate,filename:id}).js.code;
          if(id==='esm-env') return `export const DEV=false; export const PROD=true; export const BROWSER=${!server};`;
          return runtime.load(id);
        }
      }]
    });
    try {
      const output=await bundle.generate({format:'esm'});
      assert.ok(output.output[0].code.length>1000);
      assert.ok(!output.output[0].code.includes('https://esm.sh/svelte'));
    } finally { await bundle.close(); }
  });
}

test('CDN-built Svelte 5 components use the same runtime as the app', () => {
  const client = runtime.resolve('svelte/internal/client', null);
  assert.equal(runtime.resolve('https://esm.sh/svelte@5.43.12/es2022/internal/client.mjs', 'App.svelte'), client);
  assert.equal(runtime.resolve('/svelte@^5.0.0/internal/client?target=es2022', 'https://esm.sh/some-component'), client);
  assert.equal(runtime.resolve('https://esm.sh/svelte@5.43.12/es2022/svelte.mjs', null), runtime.resolve('svelte', null));
  assert.equal(runtime.resolve('https://esm.sh/svelte@5.43.12/es2022/src/internal/client/runtime.mjs', null),
    runtime.resolve('./runtime.js', client));
  assert.equal(runtime.resolve('https://esm.sh/svelte@4/internal', null), null);
  assert.equal(runtime.resolve('https://example.com/svelte@5/internal/client', null), null);
});
