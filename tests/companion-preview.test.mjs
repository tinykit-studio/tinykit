import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { companionAssetReferences, isolateCompanionPreview } from '../src/lib/compiler/companion.js';

test('preview asset capabilities remain scoped to the app and preserve image options', () => {
  const value = { image: '/_tk/assets/tinykitlocalapp/logo.svg?thumb=100x100', other: '/_tk/assets/anotherprojectx/private.png', text: 'Normal text', count: 3 };
  const scoped = companionAssetReferences(value, 'tinykitlocalapp', 'preview-capability');
  assert.equal(scoped.image, '/_tk/assets/tinykitlocalapp/logo.svg?thumb=100x100&_preview=preview-capability');
  assert.equal(scoped.other, value.other);
  assert.equal(scoped.text, value.text);
  assert.equal(scoped.count, 3);
  assert.equal(value.image.includes('_preview'), false);
  assert.equal(companionAssetReferences(value, 'tinykitlocalapp', ''), value);
});

test('preview network capability cannot authorize hosted operations or other apps', async () => {
  const html = isolateCompanionPreview('<html><head></head></html>', 'tinykitlocalapp', 'preview-capability');
  const requested = [];
  const window = { fetch: async input => { requested.push(input); }, EventSource: class { constructor(url) { requested.push(url); } } };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { window, document: { baseURI: 'http://127.0.0.1:5200/companion' }, URL, Request });
  await window.fetch('/_tk/data/tinykitlocalapp/notes');
  await window.fetch('/companion/hosted');
  await window.fetch('/_tk/data/anotherprojectx/notes');
  await window.fetch('https://elsewhere.test/_tk/data/tinykitlocalapp/notes');
  new window.EventSource('/_tk/realtime/tinykitlocalapp');
  assert.match(requested[0], /_preview=preview-capability/);
  for (const url of requested.slice(1, 4)) assert.doesNotMatch(url, /preview-capability/);
  assert.match(requested[4], /_preview=preview-capability/);
});

test('the mounted app receives the latest content even when imports initialize an older shell value', async () => {
  const {readFile} = await import('node:fs/promises');
  const {default:ts} = await import('typescript');
  const {parse} = await import('acorn');
  const source = await readFile(new URL('../src/lib/compiler/iframe.js', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {exports,require(name) {
    if (name === './memory-data.js') return {generate_memory_data_module:()=>''};
    if (name === './fonts.js') return {generate_font_links:()=>''};
    if (name === './companion.js') return {companionAssetReferences};
    if (name === './content-utils') return {transform_content_fields:()=>({title:'Old shell value'})};
    throw new Error('Unexpected dependency: '+name);
  }});
  const html = exports.dynamic_iframe_srcdoc('', {project_id:'tinykitlocalapp',local_data:true});
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const ast = parse(script,{sourceType:'module',ecmaVersion:'latest'});
  const listener = ast.body.find(node=>node.type==='ExpressionStatement' && node.expression.type==='CallExpression' && node.expression.callee.property?.name==='addEventListener' && node.expression.arguments[0]?.value==='message').expression.arguments[1];
  const window = {};
  let cachedContent, rendered;
  const receive = vm.runInNewContext('('+script.slice(listener.start,listener.end)+')',{window,
    init:async()=>{cachedContent={title:'Old shell value',removed:'stale'};window.__tk_content=cachedContent;},
    update:()=>{rendered=cachedContent.title;}
  });
  // An update arriving before the import is initialized cannot change its object.
  await receive({data:{event:'UPDATE_CONTENT',payload:{content:{title:'Latest file value'}}}});
  await receive({data:{event:'SET_APP',payload:{componentApp:'compiled app',content:{title:'Latest file value'}}}});
  assert.equal(rendered,'Latest file value');
  assert.equal(window.__tk_content,cachedContent);
  assert.equal('removed' in cachedContent,false);
});
