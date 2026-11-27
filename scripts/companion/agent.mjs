import { agentStatus, codexTaskStatus, agentSessions, openInAgent, focusCodex, stopCodex } from './codex.mjs';
let text = '';
for await (const chunk of process.stdin) { text += chunk; if (text.length > 12000) throw new Error('Request too large.'); }
try {
  const payload = JSON.parse(text);
  if (payload.action === 'status') {
    const statuses = await Promise.all(['codex', 'claude'].map(async provider => {
      const { available, message, desktop_available } = await agentStatus(provider);
      return [provider, { available, message, desktop_available: desktop_available ?? (provider === 'codex' && available) }];
    }));
    const providers = Object.fromEntries(statuses);
    const [job, sessions] = await Promise.all([codexTaskStatus(process.env.TINYKIT_COMPANION_DIR), agentSessions(process.env.TINYKIT_COMPANION_DIR)]);
    console.log(JSON.stringify({ ok: true, ...providers.codex, providers, job, sessions }));
  } else if (payload.action === 'open') {
    if (!process.env.TINYKIT_COMPANION_DIR) throw new Error('Start the local companion first.');
    console.log(JSON.stringify(await openInAgent(process.env.TINYKIT_COMPANION_DIR, payload.request, { provider: payload.provider || 'codex', newChat: payload.new_chat ?? false, openWhenFinished: payload.open_when_finished ?? false })));
  } else if (payload.action === 'focus' || payload.action === 'stop') {
    if (!process.env.TINYKIT_COMPANION_DIR) throw new Error('Start the local companion first.');
    if (typeof payload.job_id !== 'string') throw new Error('Choose the current customization request first.');
    console.log(JSON.stringify(await (payload.action === 'focus' ? focusCodex(process.env.TINYKIT_COMPANION_DIR, payload.job_id, payload.provider) : stopCodex(process.env.TINYKIT_COMPANION_DIR, payload.job_id))));
  } else throw new Error('Unknown agent action.');
} catch (error) { console.log(JSON.stringify({ ok: false, error: error.message })); }
