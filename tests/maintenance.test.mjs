import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { File } from 'node:buffer';
import ts from 'typescript';
import { parse } from 'acorn';
import { compile } from 'svelte/compiler';

function loadTS(path, imports = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const exports = {};
  vm.runInNewContext(outputText, { ...globals, exports, require: name => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  }});
  return exports;
}
const source = readFileSync(new URL('../src/lib/compiler/iframe.js', import.meta.url), 'utf8');
const declaration = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.find(
  n => n.type === 'VariableDeclaration' && n.declarations[0].id.name === 'generate_data_module'
);
const preview = vm.runInNewContext(source.slice(declaration.start, declaration.end) + '; generate_data_module');
const production = loadTS('src/routes/tinykit/lib/module-generators.ts').generate_data_module;

for (const [name, generate] of [['preview', preview], ['production', production]]) {
  test(`${name}: uploaded files resolve to saved filenames and failed uploads restore prior data`, async () => {
    const window = {}; window.parent = window;
    let patch;
    const db = vm.runInNewContext(generate('project', ['notes']).replace('export default db', 'db'), {
      window, File, FormData, console, setTimeout, URLSearchParams,
      EventSource: class { addEventListener() {} },
      fetch: async (_url, options) => options?.method === 'PATCH' ? patch(options) : {
        ok: true, json: async () => ({ items: [{ id: 'note', src: 'old.png' }] })
      }
    });
    let latest;
    const unsubscribe = db.notes.subscribe(rows => latest = rows);
    await db.notes.list();
    patch = async options => {
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get('_file:src').name, 'photo.png');
      return { ok: true, json: async () => ({ id: 'note', src: 'saved.png' }) };
    };
    await db.notes.update('note', { src: new File(['image'], 'photo.png', { type: 'image/png' }) });
    assert.equal(latest[0].src, 'saved.png');
    patch = async () => ({ ok: false, text: async () => 'Upload failed' });
    await assert.rejects(db.notes.update('note', { src: new File(['image'], 'retry.png') }), /Upload failed/);
    assert.equal(latest[0].src, 'saved.png');
    unsubscribe();
  });
}

const redirect = (status, location) => { throw { status, location }; };
for (const [query, assigned, expected] of [
  ['', false, '/tinykit/connect-domain'], ['', true, '/tinykit/studio?id=assigned'],
  ['?dashboard=1', true, null], ['?kit=kit1', true, null]
]) {
  test(`domain entry ${query || '/tinykit'}, assigned=${assigned}`, async () => {
    const { load } = loadTS('src/routes/tinykit/+page.server.ts', {
      '@sveltejs/kit': { redirect }, '$lib/server/pb': { getProjectByDomain: async () => assigned ? { id: 'assigned' } : null }
    });
    const run = () => load({ locals: { domain: 'app.example' }, url: new URL('https://app.example/tinykit' + query) });
    if (expected) await assert.rejects(run(), e => e.status === 302 && e.location === expected);
    else await run();
  });
}

test('ordinary app creation leaves domain unassigned; explicit connection normalizes and checks it', async () => {
  let checked;
  const { load } = loadTS('src/routes/tinykit/new/+page.server.ts', {
    '@sveltejs/kit': { redirect }, '$lib/server/pb': { getProjectByDomain: async domain => {
      checked = domain; return domain === 'taken.example' ? { id: 'existing' } : null;
    }}
  });
  const run = query => load({ locals: { domain: 'dashboard.example' }, url: new URL('https://dashboard.example/tinykit/new' + query) });
  assert.equal((await run('')).domain, '');
  assert.equal(checked, undefined);
  assert.equal((await run('?domain=WWW.App.Example:443')).domain, 'app.example');
  assert.equal(checked, 'app.example');
  await assert.rejects(run('?domain=taken.example'), e => e.location === '/tinykit/studio?id=existing');
});

test('connection screen redirects an already assigned domain to its app', async () => {
  const { load } = loadTS('src/routes/tinykit/connect-domain/+page.server.ts', {
    '@sveltejs/kit': { redirect }, '$lib/server/pb': { getProjectByDomain: async () => ({ id: 'existing' }) }
  });
  await assert.rejects(load({ locals: { domain: 'taken.example' } }), e => e.location === '/tinykit/studio?id=existing');
});

test('Canvas template compiles with Svelte 5 for preview and publishing', () => {
  const template = JSON.parse(readFileSync(new URL('../src/lib/templates/canvas.json', import.meta.url)));
  for (const generate of ['client', 'server']) compile(template.frontend_code, { generate, filename: 'Canvas.svelte' });
});

for (const [name, generate] of [['preview', preview], ['production', production]]) {
  test(`${name}: rapid edits save in order and a failed write does not block later edits`, async () => {
    let finish;
    let requests = 0;
    const window = {}; window.parent = window;
    const db = vm.runInNewContext(generate('project', ['notes']).replace('export default db', 'db'), {
      window, File, FormData, console, setTimeout, URLSearchParams,
      EventSource: class { addEventListener() {} },
      fetch: async (_url, options) => {
        if (options?.method !== 'PATCH') return {ok:true, json:async()=>({items:[{id:'note',title:'original'}]})};
        requests++;
        if (requests === 1) return new Promise(resolve => finish = resolve);
        if (requests === 2) return {ok:false, text:async()=>'Write failed'};
        return {ok:true, json:async()=>({id:'note', ...JSON.parse(options.body)})};
      }
    });
    let latest;
    db.notes.subscribe(rows => latest = rows);
    await db.notes.list();
    const first = db.notes.update('note', {title:'first'});
    const second = db.notes.update('note', {title:'second'});
    const failure = assert.rejects(second, /Write failed/);
    const third = db.notes.update('note', {title:'third'});
    assert.equal(requests, 1, 'later writes wait for the pending write');
    finish({ok:true, json:async()=>({id:'note', title:'first'})});
    await Promise.all([first, failure, third]);
    assert.equal(requests, 3);
    assert.equal(latest[0].title, 'third');
  });
}


test('cold published requests wait for authentication and enforce private access', async () => {
  const { promise: refresh, resolve: finishRefresh } = Promise.withResolvers();
  const project = { id: 'published000001', published_html: 'index.html', visibility: 'public' };
  const privateProject = { ...project, id: 'private00000001', visibility: 'private', owner: 'owner' };
  const html = '<h1>Published app</h1>';
  let refreshes = 0;
  let authenticated = false;

  class MockPocketBase {
    authStore = { isValid: false, save() {}, clear() {} };
    files = { getURL: () => 'http://pocketbase/index.html', getToken: async () => 'file-token' };
    autoCancellation() {}
    collection(name) {
      if (name === '_superusers') return {
        authRefresh: async () => {
          refreshes++;
          await refresh;
          authenticated = true;
          this.authStore.isValid = true;
        }
      };
      assert.equal(name, '_tk_projects');
      const read = async id => {
        assert.equal(authenticated, true);
        return id === privateProject.id ? privateProject : project;
      };
      return { getOne: read, getFirstListItem: () => read(project.id) };
    }
  }

  const environment = { env: {} };
  const server = loadTS('src/lib/server/pb.ts', {
    pocketbase: { default: MockPocketBase },
    fs: { existsSync: () => true, readFileSync: () => '{"auth_token":"test-token"}', writeFileSync() {} },
    '$env/dynamic/private': environment,
    '$lib/ai/config': {}
  }, { console: { log() {}, warn() {}, error() {} } });
  const privacy = loadTS('src/lib/server/private-apps.ts', { './pb': server }, { Request, Response, Headers });
  const { handle } = loadTS('src/hooks.server.ts', {
    '$env/dynamic/private': environment, '$lib/server/pb': server,
    '$lib/server/companion': { companionEnabled: () => false },
    '$lib/server/private-apps': privacy
  }, { URL });
  const { GET } = loadTS('src/routes/tinykit/preview/[id]/+server.ts', {
    '@sveltejs/kit': { error: (status, message) => Object.assign(new Error(message), { status }) },
    '$lib/server/pb': server
  }, { Response, fetch: async () => new Response(html) });

  const preview = id => {
    const url = new URL('https://app.example/tinykit/preview/' + id);
    return handle({
      event: { url, request: new Request(url), locals: {}, cookies: { get: () => undefined } },
      resolve: () => GET({ params: { id } })
    });
  };
  const responses = Promise.allSettled([preview(project.id), preview(privateProject.id)]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 1);
  finishRefresh();

  const [published, denied] = await responses;
  if (published.status === 'rejected') throw published.reason;
  if (denied.status === 'rejected') throw denied.reason;
  assert.equal(published.value.status, 200);
  assert.equal(await published.value.text(), html);
  assert.equal(denied.value.status, 303);
  assert.match(denied.value.headers.get('Location'), /^\/login\?next=/);
  assert.equal(refreshes, 1, 'both published routes share one token refresh');
});
