import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { compile } from 'svelte/compiler';

const templates = Object.fromEntries(['homepage', 'linktree'].map(id => [id, JSON.parse(readFileSync(new URL(`../src/lib/templates/${id}.json`, import.meta.url), 'utf8'))]));
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
function harness(id, collections, extras = {}) {
  const template = templates[id];
  let source = template.frontend_code.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const nodes = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body;
  for (const node of nodes.reverse()) {
    if (node.type === 'ImportDeclaration') source = source.slice(0, node.start) + source.slice(node.end);
    else if (node.type === 'VariableDeclaration') {
      const declaration = node.declarations[0];
      if (declaration.init?.callee?.object?.name === '$derived') {
        const fn = declaration.init.arguments[0];
        source = source.slice(0, node.start) + `Object.defineProperty(globalThis, ${JSON.stringify(declaration.id.name)}, {get: () => (${source.slice(fn.start, fn.end)})()});` + source.slice(node.end);
      }
    }
  }
  const cleanup = [];
  const content = Object.fromEntries(template.content.map(field => [slug(field.name), field.value]));
  const context = vm.createContext({ content, data: collections, $state: value => value,
    onDestroy: fn => cleanup.push(fn), URL, console, ...extras });
  vm.runInContext(source, context);
  return { run: code => vm.runInContext(code, context), cleanup, content };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function subscription(records = []) {
  let receive, error, closed = false;
  return {
    subscribe(onRows, _params, onError) { receive = onRows; error = onError; onRows(records); return () => closed = true; },
    emit: rows => receive(rows), fail: () => error(Error('Offline')), get closed() { return closed; }
  };
}
const event = { preventDefault() {} };

for (const [id, template] of Object.entries(templates)) {
  test(`${id}: preview and published site compile without warnings and match CMS field names`, () => {
    for (const generate of ['client', 'server']) assert.deepEqual(compile(template.frontend_code, { generate, filename: `${id}.svelte` }).warnings, []);
    const keys = new Set(template.content.map(field => slug(field.name)));
    for (const [, key] of template.frontend_code.matchAll(/\bcontent\.(\w+)/g)) assert.equal(keys.has(key), true, `Unknown content field ${key}`);
  });
  test(`${id}: retry recovers from load failures and ignores late responses after live updates or cleanup`, async () => {
    const name = id === 'homepage' ? 'projects' : 'links';
    const sub = subscription([{ id: 'existing', title: 'Existing' }]);
    const pending = deferred(); let attempts = 0;
    const collection = { ...sub, list: async () => { if (++attempts === 1) throw Error('Offline'); if (attempts === 2) return [{ id: 'loaded' }]; return pending.promise; } };
    const app = harness(id, { [name]: collection });
    sub.fail();
    assert.equal(app.run('loading'), false);
    assert.match(app.run('load_error'), /Could not load/);
    assert.equal(app.run(`${name}[0].id`), 'existing');
    await app.run('retry_load()');
    assert.match(app.run('load_error'), /Could not load/);
    await app.run('retry_load()');
    assert.equal(app.run(`${name}[0].id`), 'loaded');
    assert.equal(app.run('load_error'), '');
    const retry = app.run('retry_load()'); await app.run('retry_load()');
    assert.equal(attempts, 3);
    sub.emit([{ id: 'new-live-record' }]);
    pending.resolve([{ id: 'stale-retry-record' }]); await retry;
    assert.equal(app.run(`${name}[0].id`), 'new-live-record');
    app.cleanup.forEach(fn => fn());
    assert.equal(sub.closed, true);
    sub.emit([{ id: 'after-unmount' }]); sub.fail();
    assert.equal(app.run(`${name}[0].id`), 'new-live-record');
    assert.equal(app.run('load_error'), '');
  });
  test(`${id}: pending retries cannot mutate an unmounted site`, async () => {
    const name = id === 'homepage' ? 'projects' : 'links';
    const pending = deferred();
    const sub = subscription([{ id: 'existing' }]);
    const app = harness(id, { [name]: { ...sub, list: () => pending.promise } });
    const retry = app.run('retry_load()');
    app.cleanup.forEach(fn => fn());
    pending.resolve([{ id: 'after-unmount' }]); await retry;
    assert.equal(app.run(`${name}[0].id`), 'existing');
    assert.equal(sub.closed, true);
  });
  test(`${id}: collection data is copied, deduplicated and safely tolerates empty responses`, () => {
    const name = id === 'homepage' ? 'projects' : 'links';
    const first = { id: 'a', title: 'First' }, latest = { id: 'a', title: 'Latest' };
    const sub = subscription([null, first, { title: 'No ID' }, latest]);
    const app = harness(id, { [name]: sub });
    assert.equal(app.run(`${name}.length`), 1);
    assert.equal(app.run(`${name}[0].title`), 'Latest');
    latest.title = 'Changed externally';
    assert.equal(app.run(`${name}[0].title`), 'Latest');
    sub.emit(undefined);
    assert.equal(app.run(`${name}.length`), 0);
  });
}

test('Homepage validates blank fields and email before sending', async () => {
  const writes = [];
  const app = harness('homepage', { projects: subscription(), messages: { create: async fields => writes.push(fields) } }, { event });
  app.run('name = "  "; email = "me@example.com"; message = "Message"');
  await app.run('handle_submit(event)');
  assert.match(app.run('error'), /name, email, and message/);
  app.run('name = "Alex"; email = "invalid email"'); await app.run('handle_submit(event)');
  assert.match(app.run('error'), /valid email/);
  assert.equal(writes.length, 0);
});

test('Homepage prevents duplicate submissions, trims fields and clears only a successful message', async () => {
  const pending = deferred(), writes = [];
  const app = harness('homepage', { projects: subscription(), messages: { create: fields => { writes.push(fields); return pending.promise; } } }, { event });
  app.run('name = " Alex "; email = " me@example.com "; message = " Hello ";');
  const send = app.run('handle_submit(event)'); await app.run('handle_submit(event)');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, 'Alex');
  assert.equal(writes[0].email, 'me@example.com');
  assert.equal(writes[0].message, 'Hello');
  assert.equal(Number.isNaN(Date.parse(writes[0].created_at)), false);
  assert.equal(app.run('sending'), true);
  pending.resolve(); await send;
  assert.equal(app.run('sent'), true);
  assert.equal(app.run('sending'), false);
  assert.equal(app.run('name + email + message'), '');
});

test('Homepage failed sending preserves the draft and allows retry', async () => {
  let offline = true;
  const app = harness('homepage', { projects: subscription(), messages: { create: async () => { if (offline) throw Error('Offline'); } } }, { event });
  app.run('name = "Alex"; email = "me@example.com"; message = "Keep my message"');
  await app.run('handle_submit(event)');
  assert.equal(app.run('sent'), false);
  assert.equal(app.run('sending'), false);
  assert.equal(app.run('message'), 'Keep my message');
  assert.match(app.run('error'), /Could not send/);
  offline = false; await app.run('handle_submit(event)');
  assert.equal(app.run('sent'), true);
  assert.equal(app.run('error'), '');
});

test('Homepage completion preserves newer text and does not update disposed sites', async () => {
  const pending = deferred();
  const app = harness('homepage', { projects: subscription(), messages: { create: () => pending.promise } }, { event });
  app.run('name = "Alex"; email = "me@example.com"; message = "First draft"');
  const send = app.run('handle_submit(event)');
  app.run('message = "Newer draft"'); pending.resolve(); await send;
  assert.equal(app.run('message'), 'Newer draft');
  assert.equal(app.run('sent'), false);
  const late = deferred();
  const disposed = harness('homepage', { projects: subscription(), messages: { create: () => late.promise } }, { event });
  disposed.run('name = "Alex"; email = "me@example.com"; message = "Keep draft"');
  const request = disposed.run('handle_submit(event)');
  disposed.cleanup.forEach(fn => fn()); late.reject(Error('Offline')); await request;
  assert.equal(disposed.run('message'), 'Keep draft');
  assert.equal(disposed.run('error'), '');
});

test('Homepage excludes unsafe profile/project destinations and supports uploaded image paths', () => {
  const app = harness('homepage', { projects: subscription() });
  app.run('content.twitter_url = "javascript:alert(1)"; content.github_url = " https://github.com/alex "; content.linkedin_url = "data:text/html,bad"; content.email = "not an email"');
  assert.equal(app.run('socials.length'), 1);
  assert.equal(app.run('socials[0].name'), 'GitHub');
  assert.equal(app.run('safe_url("javascript:alert(1)")'), '');
  assert.equal(app.run('safe_url("https://example.com/project")'), 'https://example.com/project');
  assert.equal(app.run('photo_url("/_tk/assets/site/photo.png")'), '/_tk/assets/site/photo.png');
  assert.equal(app.run('photo_url("//untrusted.example/photo.png")'), '');
  assert.equal(app.run('photo_url("data:image/svg+xml,bad")'), '');
  assert.equal(app.run('email_link(" me@example.com ")'), 'mailto:me@example.com');
  assert.equal(app.run('email_link("me@example.com?bcc=other@example.com")'), '');
  assert.equal(app.run('initials(" Alex Johnson ")'), 'AJ');
});

test('Links keeps numeric order stable without sorting subscription rows in place', () => {
  const rows = [
    { id: 'missing', url: 'https://example.com/missing', order: null },
    { id: 'second', title: ' Second ', url: 'https://example.com/second', order: '2' },
    { id: 'first', url: 'https://example.com/first', order: 1 },
    { id: 'same', url: 'https://example.com/same', order: 2 },
    { id: 'bad-order', url: 'https://example.com/bad-order', order: 'nope' }
  ];
  const app = harness('linktree', { links: subscription(rows) });
  assert.equal(app.run('visible_links.map(link => link.id).join(",")'), 'first,second,same,missing,bad-order');
  assert.equal(rows[0].id, 'missing');
  assert.equal(rows[1].title, ' Second ');
  assert.equal(app.run('visible_links[1].label'), 'Second');
  assert.equal(app.run('visible_links[0].label'), 'example.com');
});

test('Links filters unsafe and empty destinations, while email and phone links stay in their own window', () => {
  const rows = [
    { id: 'script', title: 'Bad', url: 'javascript:alert(1)' },
    { id: 'data', title: 'Bad', url: 'data:text/html,bad' },
    { id: 'blank', title: 'Blank', url: ' ' },
    { id: 'site', title: ' Site ', url: ' https://example.com ' },
    { id: 'email', url: 'mailto:me@example.com' },
    { id: 'phone', url: 'tel:+15551234567' },
    { id: 'empty-email', url: 'mailto:' }
  ];
  const app = harness('linktree', { links: subscription(rows) });
  assert.equal(app.run('visible_links.map(link => link.id).join(",")'), 'site,email,phone');
  assert.equal(app.run('visible_links[0].href'), 'https://example.com/');
  assert.equal(app.run('visible_links[0].external'), true);
  assert.equal(app.run('visible_links[1].external'), false);
  assert.equal(app.run('visible_links[2].external'), false);
  assert.equal(app.run('visible_links[1].label'), 'me@example.com');
  assert.equal(app.run('avatar_url("/_tk/assets/site/profile.png")'), '/_tk/assets/site/profile.png');
  assert.equal(app.run('avatar_url("//example.com/profile.png")'), '');
  assert.equal(app.run('initials("@alex")'), 'A');
});

test('Links accepts safe CMS profile URLs and hides empty or unsafe socials', () => {
  const app = harness('linktree', { links: subscription() });
  app.run('content.twitter_url = "javascript:alert(1)"; content.github_url = " https://github.com/alex "; content.instagram_url = ""; content.youtube_url = "file:///bad"; content.email = " hello@example.com "');
  assert.equal(app.run('socials.map(link => link.name).join(",")'), 'GitHub,Email');
  assert.equal(app.run('socials[1].href'), 'mailto:hello@example.com');
});

for (const id of ['homepage', 'linktree']) {
  test(`${id}: initial load and retries request every published record`, async () => {
    const name = id === 'homepage' ? 'projects' : 'links';
    const rows = Array.from({ length: 61 }, (_, index) => ({ id: `record-${index}`, url: `https://example.com/${index}` }));
    const collection = {
      subscribe(callback, params) { callback(params.all ? rows : rows.slice(0, 50)); return () => {}; },
      list: async params => params.all ? rows : rows.slice(0, 50)
    };
    const app = harness(id, { [name]: collection });
    assert.equal(app.run(`${name}.length`), 61);
    await app.run('retry_load()');
    assert.equal(app.run(`${name}.length`), 61);
  });
}
