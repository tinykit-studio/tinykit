<script lang="ts">
  import { onDestroy } from "svelte";
  import { watch } from "runed";
  import CodeMirror from "$lib/components/CodeMirror.client.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { LaptopMinimal, Server } from "lucide-svelte";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import type { EditorLanguage } from "../../types";
  import * as api from "../../lib/api.svelte";
  import { getProjectContext } from "../../context";

  const { project_id } = getProjectContext();

  type CodeTab = "frontend" | "backend";
  let active_tab = $state<CodeTab>("frontend");

  const backend_placeholder = `/*
  Server-side Backend (Coming Soon in v0.2)

  This file runs 24/7 on your server.
  It enables features impossible in client-side code:

  🔒 Secrets        Keep API keys hidden from the browser
  ⏰ Cron Jobs      Run scheduled tasks
  ⚡ Background     Run heavy tasks without timeouts
*/

import { db, env, queue } from '$services'

// --- 1. API Endpoints ---

// GET /api/fn/health
export const health = async () => {
  return { status: 'ok' }
}

// POST /api/fn/summarize
export const summarize = {
  post: async (context) => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: \`Bearer \${env.OPENAI_API_KEY}\`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: context.body.text }]
      })
    })
    return res.json()
  }
}

// --- 2. Background Jobs ---

// Trigger via: await queue('process_upload', { id: '123' })
export const process_upload = {
  background: true,
  handler: async (context) => {
    // Runs in background - can take minutes without timing out
    console.log(\`Processing \${context.data.id}...\`)
  }
}

// --- 3. Cron Jobs ---

// Runs every morning at 9am
export const daily_cleanup = {
  cron: '0 9 * * *',
  handler: async () => {
    // Database cleanup, send reports, etc.
  }
}

/*
  Ideas or feedback? Join us at discord.gg/tinykit
*/`;

  // Track if component is still mounted
  let is_mounted = true;
  onDestroy(() => {
    is_mounted = false;
    // Clear any pending save timeout
    if (save_timeout) {
      clearTimeout(save_timeout);
      save_timeout = null;
    }
  });

  type CodePanelProps = {
    current_file: string;
    file_content: string;
    editor_language: EditorLanguage;
    is_loading: boolean;
    on_content_change: (content: string) => void;
    on_refresh_preview: () => void;
    on_save_status_change?: (status: {
      is_saving: boolean;
      has_unsaved: boolean;
      last_saved_at: Date | null;
    }) => void;
  };

  let {
    current_file,
    file_content = $bindable(),
    editor_language,
    is_loading,
    on_content_change,
    on_refresh_preview,
    on_save_status_change,
  }: CodePanelProps = $props();

  let save_timeout: ReturnType<typeof setTimeout> | null = null;
  let last_saved_content = $state("");
  let last_saved_at = $state<Date | null>(null);
  let is_saving = $state(false);

  let has_unsaved_changes = $derived(
    file_content !== last_saved_content && last_saved_content !== "",
  );

  // Notify parent of status changes
  $effect(() => {
    on_save_status_change?.({
      is_saving,
      has_unsaved: has_unsaved_changes,
      last_saved_at,
    });
  });

  async function save_file() {
    if (!is_mounted) return;
    if (!current_file || is_loading) return;
    if (file_content === last_saved_content) return;
    if (!file_content || file_content.length === 0) return;

    is_saving = true;
    try {
      await api.write_code(project_id, file_content);
      last_saved_content = file_content;
      last_saved_at = new Date();
      on_refresh_preview();
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      is_saving = false;
    }
  }

  function handle_change(new_value: string) {
    // Don't process changes if unmounted
    if (!is_mounted) return;

    // Mark as user edit so the $effect doesn't reset last_saved_content
    is_user_editing = true;
    file_content = new_value;
    on_content_change(new_value);

    // Trigger auto-save
    if (save_timeout) clearTimeout(save_timeout);
    save_timeout = setTimeout(async () => {
      if (is_mounted && current_file && !is_loading) {
        await save_file();
      }
    }, 1000);
  }

  // Track when content changes externally (from file load or agent)
  // We use a flag to distinguish user edits from external updates
  let is_user_editing = $state(false);

  // Reset tracking when current_file changes (file was loaded)
  watch(
    () => current_file,
    () => {
      is_user_editing = false;
    },
  );

  // When file_content changes externally (not from handle_change), update last_saved_content
  watch(
    () => file_content,
    (new_content) => {
      if (new_content && !is_user_editing) {
        last_saved_content = new_content;
      }
    },
  );
</script>

<div class="h-full flex font-sans text-sm">
  <!-- Editor -->
  <div class="flex-1 relative w-full">
    <!-- Floating toggle (vertical) -->
    <Tooltip.Provider>
      <div
        class="absolute top-2 right-2 z-10 flex flex-col items-center gap-0.5 p-0.5 rounded-full backdrop-blur-sm shadow-sm shadow-black/40 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)]"
      >
        <Tooltip.Root openDelay={200}>
          <Tooltip.Trigger>
            <button
              class="p-1.5 rounded-full transition-colors {active_tab ===
              'backend'
                ? 'bg-[var(--builder-bg-tertiary)] text-[var(--builder-text-primary)]'
                : 'text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)]'}"
              onclick={() => (active_tab = "backend")}
            >
              <Server class="w-3.5 h-3.5" />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content side="left" class="mr-2 mt-2">
            <p class="font-medium">Server</p>
            <p class="text-xs text-muted-foreground">Coming soon</p>
          </Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root openDelay={200}>
          <Tooltip.Trigger>
            <button
              class="p-1.5 rounded-full transition-colors {active_tab ===
              'frontend'
                ? 'bg-[var(--builder-bg-tertiary)] text-[var(--builder-text-primary)]'
                : 'text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)]'}"
              onclick={() => (active_tab = "frontend")}
            >
              <LaptopMinimal class="w-3.5 h-3.5" />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content side="left" class="mr-2">
            <p class="font-medium">Client</p>
            <p class="text-xs text-muted-foreground">Runs in browser</p>
          </Tooltip.Content>
        </Tooltip.Root>
      </div>
    </Tooltip.Provider>
    {#if active_tab === "frontend"}
      <CodeMirror
        value={file_content}
        language={editor_language}
        onChange={handle_change}
        cache_key={current_file}
        on:save={save_file}
      />
    {:else}
      <CodeMirror
        value={backend_placeholder}
        language="javascript"
        onChange={() => {}}
        cache_key="backend-placeholder"
      />
    {/if}
  </div>
</div>
