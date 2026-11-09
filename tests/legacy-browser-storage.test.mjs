import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { withLegacyBrowserStorage } from '../src/lib/server/legacy-browser-storage.js';

test('legacy app scripts can use storage before hydration and share nothing with other pages', () => {
  const original = '<!DOCTYPE html><html><head><script>window.localStorage.setItem("choice", 42)</script></head></html>';
  const html = withLegacyBrowserStorage(original);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g), match => match[1]);
  const makePage = () => {
    const window = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Sandbox blocked storage', 'SecurityError'); }
    });
    vm.runInNewContext(scripts[0], { window });
    return window;
  };
  const first = makePage(), second = makePage();
  vm.runInNewContext(scripts[1], { window: first });
  assert.equal(first.localStorage.getItem('choice'), '42');
  assert.equal(second.localStorage.getItem('choice'), null);
  assert.equal(first.localStorage.key(0), 'choice');
  first.localStorage.removeItem('choice');
  assert.equal(first.localStorage.length, 0);
  first.localStorage.setItem('temp', true);
  first.localStorage.clear();
  assert.equal(first.localStorage.key(0), null);
  const native = Object.freeze({ getItem() { throw new Error('Do not read host storage'); } });
  const window = { localStorage: native };
  vm.runInNewContext(scripts[0], { window });
  assert.equal(window.localStorage, native);
});
