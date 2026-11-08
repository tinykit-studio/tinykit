import { openCodexThread, threadURL } from './codex.mjs';

// The desktop must never be asked to resume while our CLI still owns the chat.
// An OS open acknowledgement is not proof that the desktop composer refreshed.
export async function handoffCodex(job, { released, app, save, openThread = openCodexThread }) {
  await released;
  job.state = 'handing_off';
  job.desktop_handoff = 'opening';
  job.message = 'Your changes are ready. Opening the saved chat in Codex…';
  await save(job);
  try {
    if (!app || !threadURL(job.thread_id)) throw new Error('No desktop chat available.');
    await openThread(app, job.thread_id);
    job.desktop_opened = true;
    job.desktop_handoff = 'opened';
    job.message = 'Opened the saved chat in Codex Desktop. Continue there, or close that chat before sending another request here. You can still review and publish here.';
  } catch {
    job.desktop_opened = false;
    job.desktop_handoff = 'failed';
    job.message = 'Your changes are ready. Codex could not open its saved chat; choose View in Codex to try again.';
  }
  job.state = 'completed';
  await save(job);
  return job;
}
