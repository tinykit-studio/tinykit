import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { compile } from 'svelte/compiler';

const templates = Object.fromEntries(['notes', 'bookmarks'].map(id => [id, JSON.parse(readFileSync(new URL(`../src/lib/templates/${id}.json`, import.meta.url), 'utf8'))]));

function harness(id, collection, extras = {}) {
  const template = templates[id];
  let script = template.frontend_code.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  // Keep derived values live when subscriptions and event handlers change plain VM state.
  const nodes = parse(script, { ecmaVersion: 'latest', sourceType: 'module' }).body;
  for (const node of nodes.reverse()) {
    if (node.type === 'ImportDeclaration') script = script.slice(0, node.start) + script.slice(node.end);
    else if (node.type === 'VariableDeclaration') {
      const declaration = node.declarations[0];
      if (declaration.init?.callee?.object?.name === '$derived') {
        const fn = declaration.init.arguments[0];
        const replacement = `Object.defineProperty(globalThis, ${JSON.stringify(declaration.id.name)}, {get: () => (${script.slice(fn.start, fn.end)})()});`;
        script = script.slice(0, node.start) + replacement + script.slice(node.end);
      }
    }
  }
  const cleanup = [], effects = [], timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    content: Object.fromEntries(template.content.map(field => [field.id, field.value])),
    data: { [id]: collection }, $state: value => value, $effect: fn => effects.push(fn),
    onDestroy: fn => cleanup.push(fn), window: {}, console, URL,
    crypto: { randomUUID: () => 'created-record' },
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    proxy: { url: value => value }, ...extras
  });
  vm.runInContext(script, context);
  return { run: code => vm.runInContext(code, context), cleanup, effects, timers };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function subscription(records = []) {
  let receive, unsubscribed = false;
  return {
    subscribe(callback) { receive = callback; callback(records); return () => { unsubscribed = true; }; },
    emit(value) { receive(value); },
    get unsubscribed() { return unsubscribed; }
  };
}

for (const [id, template] of Object.entries(templates)) {
  test(`${id}: compiles for preview and publishing without accessibility warnings`, () => {
    for (const generate of ['client', 'server']) {
      const result = compile(template.frontend_code, { filename: `${id}.svelte`, generate });
      assert.deepEqual(result.warnings.filter(warning => warning.code.startsWith('a11y_')), []);
    }
  });
}

test('Notes serializes rapid title saves and preserves newer edits through stale subscriptions', async () => {
  const sub = subscription([{ id: 'note', title: 'Original' }]);
  const firstWrite = deferred();
  const writes = [];
  const app = harness('notes', { ...sub, update: (id, fields) => { writes.push({ id, fields }); return writes.length === 1 ? firstWrite.promise : Promise.resolve(); } });
  const first = app.run('update_note("title", "First edit")');
  const second = app.run('update_note("title", "Latest edit")');
  assert.equal(writes.length, 1);
  sub.emit([{ id: 'note', title: 'Original' }]);
  assert.equal(app.run('selected_note.title'), 'Latest edit');
  firstWrite.resolve();
  await Promise.all([first, second]);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].fields.title, 'Latest edit');
  assert.equal(app.run('unsaved'), false);
});

test('Notes keeps failed content saves attached to their note and can retry after switching', async () => {
  const sub = subscription([{ id: 'first', title: 'First' }, { id: 'second', title: 'Second' }]);
  const writes = [];
  let fail = true;
  const app = harness('notes', { ...sub, update: async (id, fields) => { if (fail) throw new Error('Offline'); writes.push({ id, fields }); } });
  app.run('debounced_save("Unsaved first note")');
  await assert.rejects(app.run('flush_save()'));
  app.run('select_note("second")');
  sub.emit([{ id: 'first', title: 'First', content: 'Old server version' }, { id: 'second', title: 'Second' }]);
  assert.equal(app.run('notes[0].content'), 'Unsaved first note');
  assert.match(app.run('save_error'), /could not be saved/);
  fail = false;
  await app.run('retry_saves()');
  assert.equal(writes[0].id, 'first');
  assert.equal(writes[0].fields.content, 'Unsaved first note');
  assert.equal(app.run('save_error'), '');
  assert.equal(app.timers.size, 0);
});

test('Notes waits for in-flight writes before deleting and preserves drafts after failed deletion', async () => {
  const sub = subscription([{ id: 'note', title: 'Note' }]);
  const pending = deferred();
  const operations = [];
  const app = harness('notes', { ...sub,
    update: () => { operations.push('save'); return pending.promise; },
    delete: async () => { operations.push('delete'); throw new Error('Offline'); }
  });
  app.run('debounced_save("draft")');
  const save = app.run('flush_save()');
  app.run('debounced_save("newer draft")');
  const deletion = app.run('delete_note("note")');
  assert.deepEqual(operations, ['save']);
  pending.resolve();
  await Promise.all([save, deletion]);
  assert.deepEqual(operations, ['save', 'delete']);
  assert.equal(app.run('drafts.get("note").content'), 'newer draft');
  assert.match(app.run('action_error'), /Could not delete/);
  assert.equal(app.run('deleting_id'), null);
  assert.equal(app.timers.size, 0);
});

test('Notes recreates the editor per note and after deleting the final note', () => {
  const sub = subscription([{ id: 'first', content: 'First' }, { id: 'second', content: 'Second' }]);
  const editors = [];
  class Editor {
    constructor(options) { this.options = options; editors.push(this); }
    destroy() { this.destroyed = true; }
  }
  const app = harness('notes', sub, { Editor, StarterKit: { configure: options => ({ name: 'starterKit', options }) }, Underline: { name: 'underline' }, Link: { configure: options => ({ name: 'link', options }) } });
  app.run('editor_el = {}'); app.effects[1]();
  app.run('select_note("second")'); app.effects[1]();
  assert.equal(editors.length, 2);
  assert.equal(editors[0].destroyed, true);
  assert.equal(editors[1].options.content, 'Second');
  assert.equal(editors[1].options.extensions[0].options.link, false);
  assert.equal(editors[1].options.extensions[0].options.underline, false);
  assert.equal(editors[1].options.extensions[1].name, 'underline');
  assert.equal(editors[1].options.extensions[2].name, 'link');
  assert.equal(editors[1].options.extensions[2].options.openOnClick, false);
  sub.emit([]); app.run('editor_el = null'); app.effects[1]();
  assert.equal(editors[1].destroyed, true);
  sub.emit([{ id: 'new', content: 'New note' }]); app.run('editor_el = {}'); app.effects[1]();
  assert.equal(editors.length, 3);
  assert.equal(editors[2].options.content, 'New note');
  app.cleanup.forEach(fn => fn());
  assert.equal(sub.unsubscribed, true);
  assert.equal(editors[2].destroyed, true);
});

test('Bookmarks accepts empty optional tags on existing records', () => {
  const app = harness('bookmarks', subscription([{ id: 'old', title: 'Existing link', tags: null }]));
  assert.equal(app.run('parse_tags(bookmarks[0].tags).length'), 0);
  assert.equal(app.run('parse_tags(undefined).length'), 0);
});

test('Bookmarks handles blocked storage, sorts without mutating subscription records, and unsubscribes', () => {
  const rows = [{ id: 'second', order: 2 }, { id: 'first', order: 1 }];
  const sub = subscription(rows);
  const app = harness('bookmarks', sub, { localStorage: { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); } } });
  assert.equal(app.run('view_mode'), 'list');
  app.run('set_view_mode("cards")');
  assert.equal(app.run('view_mode'), 'cards');
  assert.equal(rows[0].id, 'second');
  assert.equal(app.run('bookmarks[0].id'), 'first');
  app.cleanup.forEach(fn => fn());
  assert.equal(sub.unsubscribed, true);
});

test('Bookmarks prevents duplicate saves, normalizes tags, and appends after sparse ordering', async () => {
  const pending = deferred(), writes = [];
  const app = harness('bookmarks', { ...subscription([{ id: 'existing', order: 7 }]), create: value => { writes.push(value); return pending.promise; } });
  app.run('new_url = "https://example.com"; new_title = " Example "; new_tags = "reference, reference, , work"');
  const first = app.run('add_bookmark()');
  await app.run('add_bookmark()');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].tags, 'reference, work');
  assert.equal(writes[0].order, 8);
  assert.equal(writes[0].title, 'Example');
  assert.equal(app.run('saving'), true);
  pending.resolve(); await first;
  assert.equal(app.run('saving'), false);
  assert.equal(app.run('new_url'), '');
});

test('Bookmarks retains entered fields on save failure and reports delete/reorder failures', async () => {
  const app = harness('bookmarks', { ...subscription([{ id: 'a', order: 0 }, { id: 'b', order: 1 }]),
    create: async () => { throw Error('Offline'); }, delete: async () => { throw Error('Offline'); }, update: async () => { throw Error('Offline'); }
  });
  app.run('new_url = "https://example.com"; new_title = "Keep title"');
  await app.run('add_bookmark()');
  assert.equal(app.run('new_title'), 'Keep title');
  assert.match(app.run('form_error'), /Could not save/);
  await app.run('delete_bookmark("a")');
  assert.match(app.run('action_error'), /Could not delete/);
  assert.equal(app.run('deleting_ids.length'), 0);
  await app.run('move_bookmark("b", -1)');
  assert.match(app.run('action_error'), /reordering/);
  assert.equal(app.run('reordering'), false);
  assert.equal(app.run('dragging_id'), null);
});

test('Bookmarks rejects stale metadata after closing or changing the URL', async () => {
  const requests = [];
  class DOMParser { parseFromString() { return { querySelector: selector => selector.includes('og:title') ? { content: 'Fetched title' } : null }; } }
  const app = harness('bookmarks', subscription(), { DOMParser, proxy: { text: () => { const pending = deferred(); requests.push(pending); return pending.promise; } } });
  app.run('new_url = "https://example.com"');
  const paste = app.run('handle_url_paste({clipboardData: {getData: () => "https://example.com"}})');
  app.run('close_dialog()'); requests[0].resolve('HTML'); await paste;
  assert.equal(app.run('new_title'), '');
  assert.equal(app.run('fetching_meta'), false);
  app.run('new_url = "https://example.com"');
  const next = app.run('handle_url_paste({clipboardData: {getData: () => "https://example.com"}})');
  app.run('new_url = "https://other.example"; url_changed(new_url)');
  requests[1].resolve('HTML'); await next;
  assert.equal(app.run('new_title'), '');
  assert.equal(app.run('fetching_meta'), false);
});

test('Bookmarks resolves relative metadata URLs against the page path and preserves entered titles', async () => {
  const pending = deferred();
  class DOMParser { parseFromString() { return { querySelector: selector => {
    if (selector.includes('og:title')) return { content: 'Fetched title' };
    if (selector.includes('og:image')) return { content: './preview.png' };
    if (selector.startsWith('link')) return { getAttribute: () => './icon.png' };
    return null;
  } }; } }
  const app = harness('bookmarks', subscription(), { DOMParser, proxy: { text: () => pending.promise } });
  app.run('new_url = "https://example.com/articles/page"; new_title = "My title"');
  const request = app.run('handle_url_paste({clipboardData: {getData: () => new_url}})');
  pending.resolve('HTML'); await request;
  assert.equal(app.run('new_title'), 'My title');
  assert.equal(app.run('new_og_image'), 'https://example.com/articles/preview.png');
  assert.equal(app.run('new_favicon'), 'https://example.com/articles/icon.png');
});

for (const id of ['notes', 'bookmarks']) {
  test(`${id}: initial-load errors stop loading and retry separately from mutation errors`, async () => {
    let receive, fail, attempts = 0;
    const rows = [{ id: 'loaded', title: 'Loaded', url: 'https://example.com', order: 0 }];
    const app = harness(id, {
      subscribe(onRows, _params, onError) { receive = onRows; fail = onError; onError(Error('Offline')); return () => {}; },
      list: async () => { attempts += 1; if (attempts === 1) throw Error('Offline'); return rows; }
    });
    assert.equal(app.run('loading'), false);
    assert.match(app.run('load_error'), /Could not load/);
    app.run('action_error = "Existing mutation error"');
    await app.run('retry_load()');
    assert.match(app.run('load_error'), /Could not load/);
    assert.equal(app.run('retrying_load'), false);
    await app.run('retry_load()');
    assert.equal(app.run('load_error'), '');
    assert.equal(app.run(`${id}.length`), 1);
    assert.equal(app.run('action_error'), 'Existing mutation error');
    fail(Error('Offline again'));
    assert.equal(app.run(`${id}[0].id`), 'loaded');
    receive(rows);
    assert.equal(app.run('load_error'), '');
  });

  test(`${id}: closing ignores an outstanding load retry`, async () => {
    const pending = deferred();
    const app = harness(id, {
      subscribe(_onRows, _params, onError) { onError(Error('Offline')); return () => {}; },
      list: () => pending.promise
    });
    const retry = app.run('retry_load()');
    await app.run('retry_load()');
    app.cleanup.forEach(fn => fn());
    pending.resolve([{ id: 'late', title: 'Late response' }]);
    await retry;
    assert.equal(app.run(`${id}.length`), 0);
  });
}

test('Notes starts with the phone list and switches between list and editor without losing selection', () => {
  let resize;
  const window = { innerWidth: 375, addEventListener(type, callback) { assert.equal(type, 'resize'); resize = callback; }, removeEventListener() {} };
  const app = harness('notes', subscription([{ id: 'first', title: 'First' }, { id: 'second', title: 'Second' }]), { window });
  const cleanupResize = app.effects[0]();
  assert.equal(app.run('is_mobile'), true);
  assert.equal(app.run('show_sidebar'), true);
  app.run('select_note("second")');
  assert.equal(app.run('show_sidebar'), false);
  assert.equal(app.run('selected_id'), 'second');
  app.run('go_back()');
  assert.equal(app.run('show_sidebar'), true);
  window.innerWidth = 1100; resize();
  assert.equal(app.run('is_mobile'), false);
  assert.equal(app.run('show_sidebar'), true);
  cleanupResize();
});
