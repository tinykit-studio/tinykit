<script lang="ts">
  import { onMount } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { localEditCommand, localEditLink } from '$lib/local-edit-command';

  let { project_id, project_title, on_close }: {
    project_id: string; project_title: string; on_close: () => void;
  } = $props();
  let origin = $state('');
  let fromCheckout = $state(true);
  let link = $state('');
  const cli = $derived(fromCheckout ? 'npm run tinykit --' : 'tinykit');
  const command = $derived(link ? localEditCommand(project_id, origin, fromCheckout) : '');
  let copied = $state(false);
  let message = $state('');
  onMount(() => {
    try {
      origin = window.location.origin;
      link = localEditLink(project_id, origin);
    }
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
      <Dialog.Description>Open {project_title || 'this app'} on your Mac with Codex Desktop.</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-4 py-3 text-sm">
      <p>Opening your local agent… If your browser asks, choose <strong>Open Tinykit Launcher</strong>. Tinykit opens this app’s registered folder and preview in Codex.</p>
      <div class="grid gap-2">
        <p class="font-medium">First time on this Mac?</p>
        <label class="flex items-center gap-2 text-xs">
          <input type="checkbox" bind:checked={fromCheckout} onchange={() => { copied = false; message = ''; }} />
          Run commands from a Tinykit checkout
        </label>
        {#if fromCheckout}
          <p class="text-xs opacity-75">Open your <a class="underline" href="https://github.com/tinykit-studio/tinykit" target="_blank" rel="noreferrer">Tinykit checkout</a> in Terminal. Use Node 22+ and run <code>npm ci</code> once.</p>
        {/if}
        <p class="text-xs opacity-75">Sign in to this Tinykit server with <code>{cli} login --server {origin} --email you@example.com</code>. Use your own email. Then run the command below to set up this app and open Codex.</p>
      </div>
      <label class="grid gap-2">
        <span class="font-medium">Local editing command</span>
        <input readonly value={command} onclick={(event) => event.currentTarget.select()} class="w-full rounded-md border border-[var(--builder-border)] bg-[var(--builder-bg-secondary)] p-3 text-xs font-mono text-[var(--builder-text-primary)]" />
      </label>
      <p class="text-xs opacity-75">Live records stay on the server. To use this Studio button next time, run <code>{cli} launcher install</code> once. The launcher uses Apple’s Command Line Tools and opens apps you’ve already set up.</p>
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
