import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import contract from '../pocketbase/pb_hooks/lib/definitions.cjs';
import { serverOrigin, parseHostedArgs } from '../scripts/companion/hosted.mjs';
import { buildHostedDefinition } from '../scripts/companion/build.mjs';

const project = { name: 'Live app', frontend_code: '<h1>Hello</h1>', data: { notes: { schema: [{ name: 'title', type: 'text' }], records: [{ id: 'live', title: 'Keep this' }] } }, settings: { secret: 'private' }, assets: ['private-upload.png'] };
const fingerprint = p => createHash('sha256').update(contract.canonical(contract.sourceState(p))).digest('hex');

test('hosted revisions ignore record writes, uploads, and service credentials', () => {
  const changed = structuredClone(project);
  changed.data.notes.records.push({ id: 'new', title: 'Added while pushing' });
  changed.assets.push('another-upload.png');
  changed.settings.secret = 'different';
  assert.equal(fingerprint(project), fingerprint(changed));
  changed.content = [{ name: 'Title', type: 'text', value: 'CMS edit' }];
  assert.notEqual(fingerprint(project), fingerprint(changed));
  assert.doesNotMatch(JSON.stringify(contract.definition(project)), /Keep this|private/);
});

test('schema activation/materialization preserves revisions and rejects destructive migrations', () => {
  const schema = { notes: [...project.data.notes.schema, { name: 'done', type: 'boolean' }], added: [] };
  contract.additiveSchema(contract.definition(project).schema, schema);
  const before = { ...project, cli_schema: schema };
  const after = { ...before, data: { notes: { schema: schema.notes, records: [{ title: 'still here' }] }, added: { schema: [], records: [] } } };
  assert.equal(fingerprint(before), fingerprint(after));
  assert.throws(() => contract.additiveSchema(schema, { notes: [] }), /migration/);
  assert.throws(() => contract.additiveSchema(schema, { notes: [{ name: 'title', type: 'number' }], added: [] }), /migration/);
  assert.throws(() => contract.validate({ ...contract.definition(project), data: { notes: [] } }), /Records/);
});

test('hosted connection validation avoids credential redirects and insecure remote origins', () => {
  assert.equal(serverOrigin('https://example.com'), 'https://example.com');
  assert.equal(serverOrigin('http://127.0.0.1:5198'), 'http://127.0.0.1:5198');
  for (const value of ['http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com?token=x']) assert.throws(() => serverOrigin(value));
  assert.throws(() => parseHostedArgs(['--server']), /needs a value/);
});

test('headless publishing builds Tinykit modules and fails before activation on invalid source', async () => {
  const def = contract.definition({ ...project, frontend_code: '<script>import content from "$content"; import db from "$data"; let count = $state(0);</script><button onclick={() => count++}>{content.title} {count}</button>', content: [{ name: 'Title', type: 'text', value: 'Hosted build' }] });
  const revision = createHash('sha256').update(contract.canonical(def)).digest('hex');
  const html = await buildHostedDefinition(def, '123456789abcdef', revision);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes(`name="tinykit-definition" content="${revision}"`));
  assert.match(html, /data:text\/javascript;base64,/);
  assert.doesNotMatch(html, /private-upload|Keep this|\.\/main.js/);
  await assert.rejects(buildHostedDefinition({ ...def, frontend_code: '<script>let x = ;</script>' }, '123456789abcdef', revision));
});

test('the existing Canvas app builds with its installed component dependencies', async () => {
  const canvas = JSON.parse(await readFile(new URL('../src/lib/templates/canvas.json', import.meta.url), 'utf8'));
  const definition = contract.definition(canvas);
  const revision = createHash('sha256').update(contract.canonical(definition)).digest('hex');
  const html = await buildHostedDefinition(definition, '123456789abcdef', revision);
  assert.match(html, /data:text\/javascript;base64,/);
});
