import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { handoffCodex } from '../scripts/companion/codex-handoff.mjs';

const thread = '11111111-1111-4111-8111-111111111111';

test('desktop opens the same chat only after the CLI exits, and completion waits for handoff', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 300)'], { stdio: 'ignore' });
  const released = once(child, 'close');
  const job = { state: 'running', thread_id: thread, request: 'Refine this app.', summary: 'Changes are ready.' };
  const states = []; let opened = false, finishOpening;
  const handoff = handoffCodex(job, {
    released, app: '/Applications/ChatGPT.app',
    save: async value => states.push({ state: value.state, handoff: value.desktop_handoff }),
    openThread: async (app, id) => {
      assert.equal(child.exitCode, 0); assert.equal(id, thread); assert.equal(app, '/Applications/ChatGPT.app');
      assert.equal(job.state, 'handing_off'); opened = true;
      await new Promise(resolve => { finishOpening = resolve; });
    },
  });
  await delay(30); assert.equal(opened, false); assert.deepEqual(states, []);
  await released;
  for (let i = 0; !finishOpening && i < 100; i++) await delay(10);
  assert.equal(opened, true); assert.equal(job.state, 'handing_off');
  finishOpening(); await handoff;
  assert.equal(job.state, 'completed'); assert.equal(job.desktop_handoff, 'opened'); assert.equal(job.desktop_opened, true);
  assert.equal(job.thread_id, thread); assert.equal(job.request, 'Refine this app.'); assert.equal(job.summary, 'Changes are ready.');
  assert.deepEqual(states, [{ state: 'handing_off', handoff: 'opening' }, { state: 'completed', handoff: 'opened' }]);
});

test('desktop failure preserves successful customization and offers a manual handoff', async () => {
  const job = { thread_id: thread, summary: 'Saved edits.' };
  await handoffCodex(job, { released: Promise.resolve(), app: '/Applications/ChatGPT.app', save: async () => {}, openThread: async () => { throw new Error('Native app unavailable'); } });
  assert.equal(job.state, 'completed'); assert.equal(job.desktop_handoff, 'failed'); assert.equal(job.desktop_opened, false);
  assert.equal(job.summary, 'Saved edits.'); assert.match(job.message, /View in Codex/);
});

test('handoff does not launch an invalid or missing desktop chat', async () => {
  for (const [app, id] of [[null, thread], ['/Applications/ChatGPT.app', '../another-thread']]) {
    let opened = false;
    const job = { thread_id: id };
    await handoffCodex(job, { released: Promise.resolve(), app, save: async () => {}, openThread: async () => { opened = true; } });
    assert.equal(opened, false); assert.equal(job.state, 'completed'); assert.equal(job.desktop_handoff, 'failed');
  }
});
