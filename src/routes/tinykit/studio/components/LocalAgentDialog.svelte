<script lang="ts">
  import { onMount } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { localEditCommand, localEditLink } from '$lib/local-edit-command';

  let { project_id, project_title, on_close }: {
    project_id: string; project_title: string; on_close: () => void;
  } = $props();
  let command = $state('');
  let link = $state('');
  let copied = $state(false);
  let message = $state('');
  onMount(() => {
    try { command = localEditCommand(project_id, window.location.origin); link = localEditLink(project_id, window.location.origin); }
    catch (error) { message = error instanceof Error ? error.message : 'Could not prepare the local editing command.'; }
  });
  async function copy() {
    copied = false; message = '';
    try { await navigator.clipboard.writeText(command); copied = true; }
    catch { message = 'Select the command above and copy it to your terminal.'; }
  }
</script>

<Dialog.Root open onOpenChange={(open) => { if (!open) on_close(); }}>
  <Dialog.Content class="sm:max-w-[560px]">
    <Dialog.Header>
      <Dialog.Title>Edit with local agent</Dialog.Title>
      <Dialog.Description>Open {project_title || 'this app'} on your computer with Codex.</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-4 py-3 text-sm">
      <p>Opening your local agent… If your browser asks, choose <strong>Open Tinykit Launcher</strong>. Tinykit opens this app’s registered folder and preview in Codex.</p>
      <p class="text-xs opacity-75">Nothing opened? On your Mac, run <code>tinykit launcher install</code> once. This requires macOS, Apple’s Command Line Tools, Node 22+, the Tinykit CLI, and Codex desktop.</p>
      <p class="text-xs opacity-75">The launcher opens apps already set up on this computer. To set up this app first, use the command below. Already have its folder? Run <code>tinykit edit .</code> there once.</p>
      <label class="grid gap-2">
        <span class="font-medium">Local editing command</span>
        <input readonly value={command} onclick={(event) => event.currentTarget.select()} class="w-full rounded-md border border-[var(--builder-border)] bg-[var(--builder-bg-secondary)] p-3 text-xs font-mono text-[var(--builder-text-primary)]" />
      </label>
      <p class="text-xs opacity-75">First time? Sign in with <code>tinykit login --server &lt;server-address&gt; --email &lt;your-email&gt;</code>, then run the command above to export and prepare the app. Live records stay on the server.</p>
      <p class="text-xs opacity-75">After editing, use <code>tinykit check --json</code>, then <code>tinykit publish</code> when ready.</p>
      {#if copied}<p role="status" class="text-sm">Command copied. Paste it into your terminal.</p>{/if}
      {#if message}<p role="alert" class="text-sm">{message}</p>{/if}
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclickcapture={on_close}>Close</Button>
      <Button variant="outline" disabled={!command} onclickcapture={copy}>{copied ? 'Copied' : 'Copy command'}</Button>
      <Button href={link || undefined} data-sveltekit-reload disabled={!link}>Open again</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
