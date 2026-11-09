import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { compile } from 'svelte/compiler';

const templates = Object.fromEntries(['portfolio', 'changelog'].map(id => [id, JSON.parse(readFileSync(new URL(`../src/lib/templates/${id}.json`, import.meta.url), 'utf8'))]));
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
  const cleanup = [], timers = new Map();
  let timer_id = 0;
  const document = { body: { style: { overflow: 'auto' }, appendChild() {} }, createElement() { return { click() {}, remove() {} }; } };
  const context = vm.createContext({ content: Object.fromEntries(template.content.map(field => [field.name.toLowerCase().replace(/\W+/g, '_'), field.value])), data: collections,
    $state: value => value, onDestroy: fn => cleanup.push(fn), tick: async () => {}, URL, Blob, document, console,
    setTimeout: fn => { timers.set(++timer_id, fn); return timer_id; }, clearTimeout: id => timers.delete(id), ...extras });
  vm.runInContext(source, context);
  return { run: code => vm.runInContext(code, context), cleanup, timers, document };
}
function subscription(rows = []) {
  let receive, fail, closed = false;
  return { subscribe(onRows, _params, onError) { receive = onRows; fail = onError; onRows(rows); return () => closed = true; }, emit: rows => receive(rows), fail: () => fail(Error('Offline')), get closed() { return closed; } };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function portfolio(collection, categories = subscription()) { return harness('portfolio', { projects: collection, categories }); }
function changelog(collection, extras) { return harness('changelog', { changelog: collection }, extras); }

for (const [id, template] of Object.entries(templates)) {
  test(`${id}: preview and published components compile without warnings`, () => {
    for (const generate of ['client', 'server']) assert.deepEqual(compile(template.frontend_code, { generate, filename: `${id}.svelte` }).warnings, []);
  });
  test(`${id}: failures keep existing data, retry once at a time, and ignore responses after cleanup`, async () => {
    const sub = subscription([{ id: 'existing', title: 'Existing' }]);
    const pending = deferred();
    let attempts = 0;
    const collection = { ...sub, list: async () => { attempts += 1; if (attempts === 1) throw Error('Offline'); if (attempts === 2) return [{ id: 'loaded', title: 'Loaded' }]; return pending.promise; } };
    const categories = subscription();
    categories.list = async () => [];
    const app = id === 'portfolio' ? portfolio(collection, categories) : changelog(collection);
    const rows = id === 'portfolio' ? 'projects' : 'entries';
    const error = id === 'portfolio' ? 'load_errors.projects' : 'load_error';
    sub.fail();
    assert.equal(app.run('loading'), false);
    assert.match(app.run(error), /Could not load/);
    assert.equal(app.run(`${rows}[0].id`), 'existing');
    await app.run('retry_load()');
    assert.match(app.run(error), /Could not load/);
    await app.run('retry_load()');
    assert.equal(app.run(error), '');
    assert.equal(app.run(`${rows}[0].id`), 'loaded');
    const retry = app.run('retry_load()');
    await app.run('retry_load()');
    assert.equal(attempts, 3);
    app.cleanup.forEach(fn => fn());
    pending.resolve([{ id: 'late' }]); await retry;
    sub.emit([{ id: 'later' }]);
    assert.equal(app.run(`${rows}[0].id`), 'loaded');
    assert.equal(sub.closed, true);
    if (id === 'portfolio') assert.equal(categories.closed, true);
  });
}

test('Portfolio filters every visible project, handles duplicate/legacy rows and resets deleted categories', () => {
  const projects = subscription([{ id: 'one', featured: true, category_id: 'web' }, { id: 'two', featured: 'false', category_id: 'mobile' }, null, { id: 'one', title: 'Updated', featured: true, category_id: 'web' }]);
  const categories = subscription([{ id: 'web', name: 'Web' }, { id: 'mobile', name: 'Mobile' }]);
  const app = portfolio(projects, categories);
  assert.equal(app.run('projects.length'), 2);
  assert.equal(app.run('projects[0].title'), 'Updated');
  assert.equal(app.run('featured_projects.length'), 1);
  app.run('filter = "mobile"');
  assert.equal(app.run('filtered_projects[0].id'), 'two');
  assert.equal(app.run('featured_projects.length'), 0);
  categories.emit([{ id: 'web', name: 'Web' }]);
  assert.equal(app.run('filter'), 'all');
});

test('Portfolio rejects unsafe links and replaces broken images locally, allowing a corrected URL', () => {
  const app = portfolio(subscription());
  for (const value of ['javascript:alert(1)', 'data:text/html,no', 'file:///private', '//example.com', 'not a URL', null, { url: 'https://example.com' }]) assert.equal(app.run(`safe_url(${JSON.stringify(value)})`), '');
  assert.equal(app.run('safe_url(" https://example.com/project ")'), 'https://example.com/project');
  assert.equal(app.run('safe_url("/images/work.png", true)'), '/images/work.png');
  assert.equal(app.run('safe_url("/\\\\example.com", true)'), '');
  app.run('projects = [{id:"work", image_url:"https://example.com/old.png"}]; image_failed(projects[0])');
  assert.equal(app.run('project_image(projects[0])'), '');
  app.run('projects[0].image_url = "https://example.com/new.png"');
  assert.equal(app.run('project_image(projects[0])'), 'https://example.com/new.png');
  assert.equal(templates.portfolio.data.projects.records.some(row => row.image_url?.includes('placehold.co')), false);
});

test('Portfolio native dialog releases scroll lock and subscriptions when its project disappears or app closes', async () => {
  const projects = subscription([{ id: 'project', title: 'Original' }]);
  const categories = subscription();
  const app = portfolio(projects, categories);
  app.run('project_dialog = {open: false, showModal() { this.open = true }, close() { this.open = false }}');
  await app.run('open_project(projects[0])');
  assert.equal(app.run('project_dialog.open'), true);
  assert.equal(app.document.body.style.overflow, 'hidden');
  projects.emit([{ id: 'project', title: 'Refreshed' }]);
  assert.equal(app.run('selected_project.title'), 'Refreshed');
  projects.emit([]);
  assert.equal(app.run('selected_project'), null);
  assert.equal(app.run('project_dialog.open'), false);
  assert.equal(app.document.body.style.overflow, 'auto');
  projects.emit([{ id: 'again' }]);
  await app.run('open_project(projects[0])');
  app.cleanup.forEach(fn => fn());
  assert.equal(app.document.body.style.overflow, 'auto');
  assert.equal(projects.closed, true);
  assert.equal(categories.closed, true);
});

test('Portfolio close before dialog mount prevents a delayed open and stale close events preserve a newer dialog', async () => {
  const app = portfolio(subscription([{ id: 'project' }]));
  app.run('project_dialog = {open:false, showModal() { this.open = true }, close() { this.open = false }}');
  const opening = app.run('open_project(projects[0])');
  app.run('close_project()'); await opening;
  assert.equal(app.run('project_dialog.open'), false);
  assert.equal(app.document.body.style.overflow, 'auto');
  await app.run('open_project(projects[0])');
  app.run('dialog_closed()');
  assert.equal(app.run('selected_project.id'), 'project');
  assert.equal(app.document.body.style.overflow, 'hidden');
});

test('Changelog dates remain on the intended day west of UTC and invalid dates sort last without mutating input', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const rows = [{ id: 'older', date: '2026-10-01' }, { id: 'invalid', date: '2026-02-30' }, { id: 'newer', date: '2026-10-15' }, { id: 'missing' }];
    const app = changelog(subscription(rows));
    assert.equal(app.run('format_date("2026-10-15")'), 'Oct 15, 2026');
    assert.equal(app.run('entries.map(entry => entry.id).join(",")'), 'newer,older,invalid,missing');
    assert.equal(rows[0].id, 'older');
    assert.equal(app.run('format_date("2026-02-30")'), 'Date not set');
    assert.equal(app.run('date_attribute("bad")'), undefined);
    assert.equal(app.run('parse_date(null)'), null);
    assert.equal(app.run('date_attribute("2026-10-15")'), '2026-10-15');
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('Changelog filters trimmed legacy tags and keeps unknown releases out of the New label', () => {
  const app = changelog(subscription([{ id: 'one', tag: ' New ' }, { id: 'two', tag: 'Security' }, { id: 'three' }]));
  app.run('filter_tag = "new"');
  assert.equal(app.run('filtered_entries.length'), 1);
  assert.equal(app.run('filtered_entries[0].id'), 'one');
  assert.equal(app.run('filter_tags.includes("security")'), true);
  assert.equal(app.run('get_tag_info("Security").label'), 'Security');
  assert.equal(app.run('get_tag_info(null).label'), 'Update');
  assert.equal(app.run('get_tag_info("constructor").label'), 'Constructor');
});

test('Changelog supports simple release formatting while rendering HTML as text', () => {
  const app = changelog(subscription());
  const rendered = app.run('render_content("**Bold** and *italic* and `**code**`\\n<img src=x onerror=alert(1)> & text")');
  assert.match(rendered, /<strong>Bold<\/strong>/);
  assert.match(rendered, /<em>italic<\/em>/);
  assert.match(rendered, /<code>\*\*code\*\*<\/code>/);
  assert.match(rendered, /<br>&lt;img src=x onerror=alert\(1\)&gt; &amp; text/);
  assert.doesNotMatch(rendered, /<img/);
  assert.equal(app.run('render_content(7)'), '7');
  assert.equal(app.run('render_content(null)'), '');
});

test('Changelog exports all updates as escaped Atom XML and releases download resources', () => {
  const downloads = [], revoked = [];
  const document = { body: { appendChild() {} }, createElement() { const link = { click() { downloads.push({ href: link.href, download: link.download }); }, remove() {} }; return link; } };
  class FakeURL extends URL { static createObjectURL() { return 'blob:feed'; } static revokeObjectURL(value) { revoked.push(value); } }
  const app = changelog(subscription([{ id: 'a', title: 'A & <B>', description: '<script>alert(1)</script>', date: '2026-10-15', tag: 'new' }, { id: 'b', title: 'Second', date: '2026-10-01', tag: 'fixed' }]), { document, URL: FakeURL });
  app.run('filter_tag = "new"');
  const feed = app.run('build_feed()');
  assert.match(feed, /xmlns="http:\/\/www.w3.org\/2005\/Atom"/);
  assert.match(feed, /<author><name>Changelog<\/name><\/author>/);
  assert.match(feed, /A &amp; &lt;B&gt;/);
  assert.match(feed, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal((feed.match(/<entry>/g) || []).length, 2);
  app.run('download_feed()');
  assert.deepEqual(downloads, [{ href: 'blob:feed', download: 'changelog.atom' }]);
  assert.equal(app.timers.size, 1);
  app.cleanup.forEach(fn => fn());
  assert.deepEqual(revoked, ['blob:feed']);
  assert.equal(app.timers.size, 0);
  assert.equal(templates.changelog.content.find(field => field.id === 'rss_button').value, 'Download feed');
});

test('Changelog makes feed failures recoverable and does not export an empty collection', () => {
  class FakeURL extends URL { static createObjectURL() { throw Error('Unavailable'); } }
  const sub = subscription();
  const app = changelog(sub, { URL: FakeURL });
  app.run('download_feed()');
  assert.equal(app.run('action_error'), '');
  sub.emit([{ id: 'entry' }]);
  app.run('download_feed()');
  assert.match(app.run('action_error'), /Could not download/);
  assert.equal(app.run('feed_urls.size'), 0);
});


test('Changelog feed identifies the published site and removes an anchor if download setup fails', () => {
  const removed = [], revoked = [];
  const document = { body: { appendChild() {} }, createElement() { return { click() { throw Error('Blocked'); }, remove() { removed.push(true); } }; } };
  class FakeURL extends URL { static createObjectURL() { return 'blob:failed'; } static revokeObjectURL(value) { revoked.push(value); } }
  const app = changelog(subscription([{ id: 'entry', date: '1960-01-01' }]), { document, URL: FakeURL, window: { location: { href: 'https://updates.example.com/releases?version=1#old' } } });
  assert.match(app.run('build_feed()'), /<id>https:\/\/updates.example.com\/releases\?version=1#changelog<\/id>/);
  assert.match(app.run('build_feed()'), /<updated>1960-01-01T00:00:00.000Z<\/updated>/);
  app.run('download_feed()');
  assert.deepEqual(removed, [true]);
  assert.deepEqual(revoked, ['blob:failed']);
  assert.match(app.run('action_error'), /Could not download/);
});

for (const id of ['portfolio', 'changelog']) {
  test(`${id}: a late retry cannot overwrite newer live data or restore a recovered error`, async () => {
    const sub = subscription([{ id: 'old' }]);
    const pending = deferred();
    const categories = { ...subscription(), list: async () => [] };
    const app = id === 'portfolio' ? portfolio({ ...sub, list: () => pending.promise }, categories) : changelog({ ...sub, list: () => pending.promise });
    sub.fail();
    const retry = app.run('retry_load()');
    const latest = { id: 'new', title: 'Latest' };
    sub.emit([latest]); latest.title = 'Changed outside the app';
    pending.resolve([{ id: 'stale' }]); await retry;
    const name = id === 'portfolio' ? 'projects' : 'entries';
    assert.equal(app.run(`${name}[0].id`), 'new');
    assert.equal(app.run(`${name}[0].title`), 'Latest');
    const error = id === 'portfolio' ? 'load_errors.projects' : 'load_error';
    assert.equal(app.run(error), '');
    const failure = deferred();
    const failingSub = subscription([{ id: 'old' }]);
    const failing = id === 'portfolio' ? portfolio({ ...failingSub, list: () => failure.promise }, categories) : changelog({ ...failingSub, list: () => failure.promise });
    const stale = failing.run('retry_load()');
    failingSub.emit([{ id: 'live' }]); failure.reject(Error('Offline')); await stale;
    assert.equal(failing.run(error), '');
  });
}

test('Portfolio independently guards category retries and rejects control characters in URLs', async () => {
  const pending = deferred(), categories = subscription([{ id: 'old' }]);
  categories.list = () => pending.promise;
  const app = portfolio({ ...subscription([]), list: async () => [] }, categories);
  const retry = app.run('retry_load()');
  categories.emit([{ id: 'live', name: 'Latest category' }]);
  pending.resolve([{ id: 'stale' }]); await retry;
  assert.equal(app.run('categories[0].id'), 'live');
  assert.equal(app.run('safe_url("https://exa\\nmple.com")'), '');
  assert.equal(app.run('safe_url("/photo\\t.png", true)'), '');
  assert.equal(app.run('project_title({title:"   "})'), 'Untitled project');
  assert.equal(app.run('initials({title:"   "})'), 'UP');
});

test('Changelog rejects impossible dates in timestamp records and supplies a readable empty release title', () => {
  const app = changelog(subscription());
  assert.equal(app.run('parse_date("2026-02-30 10:00:00Z")'), null);
  assert.equal(app.run('format_date("2026-02-30 10:00:00Z")'), 'Date not set');
  assert.equal(app.run('entry_title({title:"  "})'), 'Untitled update');
});

for (const id of ['portfolio', 'changelog']) {
  test(`${id}: initial load and retries include records beyond the first page`, async () => {
    const rows = Array.from({ length: 61 }, (_, index) => ({ id: `record-${index}` }));
    const collection = {
      subscribe(callback, params) { callback(params.all ? rows : rows.slice(0, 50)); return () => {}; },
      list: async params => params.all ? rows : rows.slice(0, 50)
    };
    const app = id === 'portfolio' ? portfolio(collection, collection) : changelog(collection);
    const name = id === 'portfolio' ? 'projects' : 'entries';
    assert.equal(app.run(`${name}.length`), 61);
    await app.run('retry_load()');
    assert.equal(app.run(`${name}.length`), 61);
    if (id === 'portfolio') assert.equal(app.run('categories.length'), 61);
  });
}
