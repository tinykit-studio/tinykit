<script lang="ts">
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Button } from '$lib/components/ui/button';
  import { localEditCommand, localEditLink, localEditPrompt } from '$lib/local-edit-command';

  let { project_id, project_title, on_close }: {
    project_id: string; project_title: string; on_close: () => void;
  } = $props();

  let origin = $state('');
  let link = $state('');
  let tab = $state('prompt');
  let fromCheckout = $state(true);
  let copyResult = $state<{ text: string; copied: boolean } | null>(null);
  let setupError = $state('');
  const cli = $derived(fromCheckout ? 'npm run tinykit --' : 'tinykit');
  const command = $derived(link ? localEditCommand(project_id, origin, fromCheckout) : '');
  const prompt = $derived(link ? localEditPrompt(project_id, origin, env.PUBLIC_TINYKIT_LOCAL_EDIT_BRANCH) : '');
  const isPrompt = $derived(tab === 'prompt');
  const copyText = $derived(isPrompt ? prompt : command);
  const activeCopyResult = $derived(copyResult?.text === copyText ? copyResult : null);

  onMount(() => {
    try {
      origin = window.location.origin;
      link = localEditLink(project_id, origin);
    } catch (error) {
      setupError = error instanceof Error ? error.message : 'Could not prepare local editing.';
    }
  });

  async function copy() {
    const text = copyText;
    copyResult = null;
    try {
      await navigator.clipboard.writeText(text);
      copyResult = { text, copied: true };
    } catch {
      copyResult = { text, copied: false };
    }
  }
</script>

<Dialog.Root open onOpenChange={(open) => { if (!open) on_close(); }}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-[600px]">
    <Dialog.Header>
      <Dialog.Title>Edit with local agent</Dialog.Title>
      <Dialog.Description>Set up {project_title || 'this app'} for local editing.</Dialog.Description>
    </Dialog.Header>

    <Tabs.Root bind:value={tab}>
      <Tabs.List aria-label="Local editing setup" class="w-full bg-[var(--builder-bg-secondary)]">
        <Tabs.Trigger value="prompt" class="flex-1">Paste a prompt</Tabs.Trigger>
        <Tabs.Trigger value="terminal" class="flex-1">Terminal setup</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="prompt" class="grid gap-3 pt-2 text-sm [&[hidden]]:hidden">
        <p>Copy this prompt into Codex, Claude Code, or your preferred local coding agent. It asks the agent to prepare the app and start its preview.</p>
        <label class="grid gap-2">
          <span class="font-medium">Setup prompt</span>
          <textarea readonly value={prompt} rows="8" class="w-full resize-y rounded-md border border-[var(--builder-border)] bg-[var(--builder-bg-secondary)] p-3 text-xs leading-relaxed"></textarea>
        </label>
      </Tabs.Content>

      <Tabs.Content value="terminal" class="grid gap-3 pt-2 text-sm [&[hidden]]:hidden">
        <label class="flex items-center gap-2 text-xs">
          <input type="checkbox" bind:checked={fromCheckout} />
          Run commands from a Tinykit checkout
        </label>
        {#if fromCheckout}
          <p class="text-xs opacity-75">Open your <a class="underline" href="https://github.com/tinykit-studio/tinykit" target="_blank" rel="noreferrer">Tinykit checkout</a> in Terminal. Use Node 22+ and run <code>npm ci</code> once.</p>
        {/if}
        <p class="text-xs opacity-75">Sign in with <code>{cli} login --server {origin} --email you@example.com</code>, using your own email. Then run the command below to set up this app and open Codex Desktop on your Mac.</p>
        <label class="grid gap-2">
          <span class="font-medium">Local editing command</span>
          <input readonly value={command} onclick={(event) => event.currentTarget.select()} class="w-full rounded-md border border-[var(--builder-border)] bg-[var(--builder-bg-secondary)] p-3 text-xs font-mono text-[var(--builder-text-primary)]" />
        </label>
        <p class="text-xs opacity-75">Live records stay on the server. To enable direct opening from Studio, run <code>{cli} launcher install</code> once. The launcher uses Apple’s Command Line Tools and opens apps you’ve already set up.</p>
      </Tabs.Content>
    </Tabs.Root>

    {#if setupError}<p role="alert" class="text-sm">{setupError}</p>{/if}
    {#if activeCopyResult?.copied}
      <p role="status" class="text-sm">{isPrompt ? 'Prompt copied. Paste it into your local agent.' : 'Command copied. Paste it into your terminal.'}</p>
    {:else if activeCopyResult}
      <p role="alert" class="text-sm">Select the {isPrompt ? 'prompt' : 'command'} above and copy it manually.</p>
    {/if}

    <Dialog.Footer class="flex-wrap gap-2 sm:space-x-0">
      <Button variant="ghost" onclick={on_close}>Close</Button>
      {#if link}
        <Button variant="outline" href={link} data-sveltekit-reload>Open in Codex Desktop</Button>
      {/if}
      <Button disabled={!copyText} onclick={copy}>{isPrompt ? 'Copy prompt' : 'Copy command'}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
