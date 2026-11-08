<script module lang="ts">
  export type AgentActivity = { name: string; state: string; active: boolean; summary: string };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  type Provider = 'codex' | 'claude';
  type ProviderStatus = { available: boolean; desktop_available?: boolean; message?: string };
  type Job = { id: string; provider: Provider; state: string; active: boolean; thread_id: string | null; desktop_opened: boolean; desktop_handoff: string | null; open_when_finished: boolean | null; request: string; message: string; summary: string; new_chat: boolean };
  type Session = { job_id: string; thread_id: string; turn_count: number; history: Job[] };
  const label = (value: Provider) => value === 'claude' ? 'Claude Code' : 'Codex';
  let { onActivity }: { onActivity: (activity: AgentActivity | null) => void } = $props();
  let provider = $state<Provider>('codex');
  let providers = $state<Record<Provider, ProviderStatus>>({ codex: { available: false }, claude: { available: false } });
  let sessions = $state<Record<Provider, Session | null>>({ codex: null, claude: null });
  let loading = $state(true), busy = $state(false), newChat = $state(false);
  let openWhenFinished = $state(false);
  let request = $state('');
  let message = $state(''), failure = $state(''), job = $state<Job | null>(null);
  const working = $derived(busy || job?.active === true);
  const name = $derived(label(provider));
  const session = $derived(sessions[provider]);
  const selectedJob = $derived(job?.provider === provider ? job : session?.history[0]);
  const continuing = $derived(session && !newChat);
  $effect(() => {
    onActivity(selectedJob ? {
      name: label(selectedJob.provider), state: selectedJob.state,
      active: selectedJob.active, summary: selectedJob.summary
    } : null);
  });
  const canView = $derived((session?.thread_id || selectedJob?.thread_id) && !(job?.active && job.provider === provider) && providers[provider].desktop_available);
  async function call(action: string, values: Record<string, string | boolean> = {}) {
    const response = await fetch('/companion/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, provider, ...values }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || result.message || 'Could not connect to your coding agent.');
    return result;
  }
  onMount(() => {
    let mounted = true, refreshing = false;
    async function refresh() {
      if (busy || refreshing) return;
      refreshing = true;
      try {
        const result = await call('status');
        if (!mounted || busy) return;
        const finished = job?.active && !result.job?.active;
        providers = result.providers; sessions = result.sessions; job = result.job;
        if (loading) {
          const savedHandoff = sessions.codex?.history[0]?.open_when_finished;
          if (typeof savedHandoff === 'boolean') openWhenFinished = savedHandoff;
          if (job) provider = job.provider;
          else if (!providers.codex.available && providers.claude.available) provider = 'claude';
          request = job && job.state !== 'completed' ? job.request : '';
          newChat = job?.new_chat === true && !job.thread_id;
        } else if (finished) request = job?.state === 'completed' ? '' : job?.request || request;
        if (job?.thread_id && (job.active || finished)) newChat = false;
        if (job?.active) provider = job.provider;
      } catch (error) { if (mounted && loading) failure = error instanceof Error ? error.message : 'Could not connect to your coding agent.'; }
      finally { refreshing = false; if (mounted) loading = false; }
    }
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { mounted = false; clearInterval(timer); };
  });
  async function act(action: 'open' | 'focus' | 'stop') {
    if (busy || (action === 'open' && (job?.active || !request.trim()))) return;
    busy = true; failure = ''; message = '';
    try {
      const result = await call(action, action === 'open' ? { request, new_chat: newChat, open_when_finished: provider === 'codex' && openWhenFinished } : { job_id: action === 'focus' ? session?.job_id || selectedJob!.id : job!.id });
      message = action === 'focus' ? result.message || '' : '';
      if (action !== 'focus') job = result.job;
      if (action === 'open') { if (job?.thread_id) newChat = false; if (job?.state === 'completed') request = ''; }
      if (job?.active) provider = job.provider;
    } catch (error) { failure = error instanceof Error ? error.message : 'Could not connect to your coding agent.'; }
    finally { busy = false; }
  }
</script>

<section class="codex" aria-label="Customize with your coding agent">
  <h2>Make a change</h2>
  <label class="provider" for="coding-agent">Customize with<select id="coding-agent" aria-label="Customize with" bind:value={provider} disabled={working} onchange={() => { newChat = false; failure = ''; message = ''; }}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
  {#if session}<p class="chat-context">{newChat ? 'A fresh conversation. Your app stays as it is.' : `Your saved ${name} chat · ${session.turn_count} ${session.turn_count === 1 ? 'request' : 'requests'}`}</p>{/if}
  <p class="intro">{name} edits your local project. The preview updates as files change.</p>
  <label for="customization">{continuing ? 'What would you like to refine next?' : 'What would you like to change?'}</label>
  <textarea id="customization" bind:value={request} placeholder={continuing ? 'Describe the next change.' : 'For example, add a filter for overdue follow-ups.'} maxlength="6000" rows="4" disabled={working}></textarea>

  {#if provider === 'codex'}
    <label class="handoff"><input type="checkbox" bind:checked={openWhenFinished} disabled={working} aria-describedby="desktop-handoff-help" />Open chat in Codex Desktop when finished</label>
    <p class="hint handoff-help" id="desktop-handoff-help">Leave this off to keep refining here. While the chat is open in Desktop, continue there. Close that chat in Desktop before sending another request here.</p>
  {/if}
  <button class="open" onclick={() => act('open')} disabled={loading || !providers[provider].available || working || !request.trim()}>{busy ? `Connecting to ${name}…` : job?.active ? `${label(job.provider)} is working…` : `Make change with ${name}`}</button>
  {#if session}<button class="new-chat" onclick={() => { newChat = !newChat; failure = ''; message = ''; }} disabled={working}>{newChat ? 'Keep using the saved chat' : 'Start new chat'}</button>{/if}
  {#if !loading && !providers[provider].available}<p class="hint">{providers[provider].message}</p>
  {:else}<p class="hint">{continuing ? 'Continues this app’s conversation, including your earlier requests.' : `Uses your ${provider === 'claude' ? 'Claude subscription' : 'Codex sign-in'}.`} Each agent keeps its own chat. Changes appear in the preview. Review before publishing.</p>{/if}
  {#if canView || job?.active}
    <div class="task-actions">
      {#if canView}<button onclick={() => act('focus')} disabled={busy}>{provider === 'codex' ? 'Open in Codex Desktop ↗' : 'Open chat ↗'}</button>{/if}
      {#if job?.active && job.state !== 'handing_off'}<button onclick={() => act('stop')} disabled={busy || job.state === 'stopping'}>Stop</button>{/if}
    </div>
  {/if}
  {#if selectedJob?.message || message}<p class="message" class:attention={selectedJob && ['failed', 'needs_attention', 'interrupted'].includes(selectedJob.state)} role="status">{message || selectedJob?.message}</p>{/if}
  {#if provider === 'codex' && job?.active && job.desktop_handoff === 'pending'}<p class="hint">Codex will open this chat after Tinykit finishes and releases it.</p>{/if}
  {#if selectedJob?.summary && !selectedJob.active && selectedJob.state !== 'completed'}<details><summary>{name}’s update</summary><p class="agent-summary">{selectedJob.summary}</p></details>{/if}
  {#if session?.history.length}<details class="history"><summary>Recent requests in this chat</summary>{#each [...session.history].reverse() as turn (turn.id)}<div class="turn"><p class="turn-request">{turn.request}</p>{#if turn.summary}<p class="agent-summary">{turn.summary}</p>{/if}</div>{/each}</details>{/if}
  {#if failure}<p class="failure" role="alert">{failure}</p>{/if}
</section>

<style>
  .codex{margin:23px 0 27px;padding-bottom:25px;border-bottom:1px solid #dce2df}h2{font-size:17px;font-weight:600;letter-spacing:-.4px;margin:0 0 20px}label{display:block;font-size:11px;color:#475569}textarea{display:block;width:100%;resize:vertical;min-height:75px;border:1px solid #cbd5e1;border-radius:7px;padding:11px;margin:8px 0 11px;background:#ffffff;color:#1f2937;font:12px/1.65 system-ui,sans-serif}.open{display:flex;align-items:center;justify-content:space-between;width:100%;border-radius:7px;padding:12px 13px;background:#334155;color:white;border:1px solid #334155;font-size:12px;cursor:pointer}.intro{font-size:12px;line-height:1.6;color:#475569;margin:0 0 14px}.open:disabled,button:disabled{opacity:.5;cursor:default}.hint,.message,.failure{font-size:11px;line-height:1.7}.hint{color:#64748b;margin-top:12px}.message{color:#47714c}.failure{color:#a14e2c}button:focus-visible,textarea:focus-visible{outline:2px solid #57764a;outline-offset:3px}
  .task-actions{display:flex;gap:12px;margin:12px 0}.task-actions button{border:0;background:none;padding:0;color:#47684d;font-size:11px;cursor:pointer}details{font-size:11px;color:#475569;margin-top:10px}summary{cursor:pointer}.agent-summary{white-space:pre-wrap;line-height:1.6;max-height:190px;overflow:auto}
  .provider{margin-bottom:15px}select{display:block;width:100%;margin:7px 0 0;padding:9px;border:1px solid #cbd5e1;border-radius:7px;background:#ffffff;color:#1f2937;font:12px system-ui,sans-serif}.attention{color:#a14e2c}select:focus-visible{outline:2px solid #57764a;outline-offset:3px}
  .chat-context{font-size:11px;line-height:1.7;color:#47714c;margin:-3px 0 12px}.new-chat{background:none;border:0;color:#475569;font-size:11px;padding:9px 0 0;cursor:pointer}.history{margin-top:13px}.turn{border-left:2px solid #dce4d6;padding-left:10px;margin:12px 0}.turn-request{white-space:pre-wrap;line-height:1.6;color:#1f2937;font-weight:500}.handoff{display:flex;align-items:center;gap:7px;margin:0 0 14px;font-size:11px;line-height:1.5}.handoff input{accent-color:#334155}.handoff-help{margin:-9px 0 12px}
</style>
