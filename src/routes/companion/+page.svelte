<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import HostedPanel from './HostedPanel.svelte';
  import AgentPanel from './AgentPanel.svelte';
  import Preview from '$lib/components/Preview.svelte';
  import type { Project } from '$tinykit/types';

  let project = $state<Project | null>(null);
  let status = $state<any>(null);
  let previewCapability = $state('');
  let connectionError = $state('');
  const appOnly = $derived(page.url.searchParams.get('view') === 'app');
  const store = {
    get project() { return project; },
    get content() { return project?.content || []; },
    get design() { return project?.design || []; },
    get data_files() { return Object.keys(project?.data || {}); },
    is_processing: false
  };
  let signature = '';
  let reportQueue = Promise.resolve();
  function reportCompile(report: { revision: string; attempt: string; state: 'pending' | 'success' | 'error'; error?: string }) {
    reportQueue = reportQueue.then(async () => {
      await fetch('/companion/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
    }).catch(() => {});
  }
  onMount(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch('/companion/state', { signal: controller.signal });
        if (!response.ok) throw new Error('Local app is unavailable. Check the tinykit dev terminal.');
        const next = await response.json();
        if (stopped) return;
        status = next.status;
        previewCapability = next.preview_capability;
        const nextSignature = JSON.stringify(next.project);
        if (nextSignature !== signature) { project = next.project; signature = nextSignature; }
        connectionError = '';
      } catch (error) {
        if (!stopped) connectionError = error instanceof Error ? error.message : 'Connection lost.';
      } finally {
        if (!stopped) timer = setTimeout(refresh, 500);
      }
    }
    refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  });
</script>

<svelte:head><title>{project?.name || 'Local app'}{appOnly ? '' : ' · Tinykit editor'}</title></svelte:head>

<div class="companion-shell" class:app-only={appOnly}>
  {#if !appOnly}
  <header>
    <div><span class="brand">tinykit</span><span class="divider">/</span><strong>{project?.name || 'Opening app…'}</strong><span class="badge">Editor</span><a class="app-link" href="/companion?view=app" target="_blank" rel="noreferrer">Open app preview ↗</a></div>
    <span class="sync-status" role="status">{connectionError ? 'Disconnected' : status?.import_error ? 'Import paused' : status?.compile?.state === 'error' ? 'Compile error' : status?.compile?.state === 'pending' ? 'Compiling preview…' : status ? `Watching files · revision ${status.revision}` : 'Connecting…'}</span>
  </header>
  {/if}
  <div class="workspace">
    {#if !appOnly}
    <aside>
      <h1>App editor</h1>
      <p>Customize your app here, then publish it to use it at its own address.</p>
      <AgentPanel />
      <HostedPanel source_revision={status?.source_revision} import_error={status?.import_error} />
      <details class="project-files"><summary>Project files</summary>
      <ul>
        <li><code>App.svelte</code><span>App interface</span></li>
        <li><code>content.json</code><span>Text and content fields</span></li>
        <li><code>design.json</code><span>Colors, fonts, and spacing</span></li>
        <li><code>schema.json</code><span>Data collection definitions</span></li>
        <li><code>assets/</code><span>Images and files</span></li>
      </ul></details>
      <p class="note">This preview uses local data. Sample records stay here; your published app keeps its own records.</p>
      {#if connectionError || status?.import_error}
        <div class="diagnostic" role="alert"><h2>{connectionError ? 'Connection lost' : 'Could not import files'}</h2><pre>{connectionError || status.import_error}</pre><p>The last imported preview stays available. Fix the file to resume.</p></div>
      {:else if status?.diagnostic}
        <div class="diagnostic" role="alert"><h2>App.svelte{status.diagnostic.line ? `:${status.diagnostic.line}` : ''}</h2><pre>{status.diagnostic.message}{status.diagnostic.frame ? '\n\n' + status.diagnostic.frame : ''}</pre><p>Save a correction to rebuild automatically.</p></div>
      {/if}
    </aside>
    {/if}
    <main aria-label="App preview">
      {#if project}{#key status?.asset_revision}<Preview project_id={project.id} project_store={store} companion preview_capability={previewCapability} source_revision={`${status.session_id}:${status.source_revision}`} on_compile={reportCompile} />{/key}{:else}<p class="empty">Starting the local preview…</p>{/if}
    </main>
  </div>
</div>

<style>
  .companion-shell { height: 100dvh; display: flex; flex-direction: column; background: #f8fafc; color: #1f2937; font-family: system-ui, sans-serif; }
  header { min-height: 70px; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 24px; border-bottom: 1px solid #dce2df; background: white; }
  header > div { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .brand { font-size: 20px; font-weight: 650; letter-spacing: -.5px; }
  .divider { color: #aab6b0; }
  .badge { border: 1px solid #d3e5da; border-radius: 20px; padding: 4px 10px; color: #475569; background: #f1f5f9; font-size: 11px; }
  .sync-status { color: #547264; font-size: 12px; }
  .app-link { color: #475569; font-size: 12px; text-decoration: none; }
  .workspace { display: flex; flex: 1; min-height: 0; }
  aside { width: 340px; flex-shrink: 0; padding: 28px 22px; border-right: 1px solid #dce2df; overflow: auto; }
  h1 { font-size: 22px; font-weight: 650; letter-spacing: -.6px; margin: 0 0 12px; }
  p { font-size: 13px; line-height: 1.65; color: #63736b; }
  h2 { font-size: 12px; font-weight: 650; margin: 28px 0 12px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 10px 0; border-bottom: 1px solid #e4e9e6; }
  code { display: block; font-size: 12px; }
  li span { display: block; margin-top: 4px; color: #738178; font-size: 11px; }
  .project-files { margin-top: 26px; font-size: 12px; color: #53705c; }
  .project-files summary { cursor: pointer; }
  .note { margin-top: 24px; font-size: 12px; }
  .diagnostic { margin-top: 24px; border: 1px solid #e6c9c3; border-radius: 8px; padding: 12px; background: #fff5f2; color: #8b3728; }
  .diagnostic h2 { margin: 0 0 10px; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
  main { flex: 1; min-width: 0; position: relative; background: white; }
  .empty { padding: 32px; }
  @media (max-width: 700px) { header { padding: 12px; } .badge { display: none; } aside { width: 300px; padding: 20px 14px; } }
  @media (max-width: 500px) { .workspace { flex-direction: column; } aside { width: 100%; max-height: 45dvh; border-right: 0; border-bottom: 1px solid #dce2df; } aside ul, .note { display: none; } }
</style>
