<script lang="ts">
    import { onDestroy } from "svelte";
    import CodeMirror from "./CodeMirror/CodeMirror.svelte";
    import type { ContentFieldInfo } from "./CodeMirror/extensions";
    import { LaptopMinimal, Server } from "lucide-svelte";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import * as api from "$tinykit/lib/api.svelte";
    import { getProjectContext } from "$tinykit/context";
    import { getProjectStore } from "$tinykit/studio/project.svelte";

    const { project_id } = getProjectContext();
    const store = getProjectStore();

    // Convert content field name to key (same as in iframe.js slugify)
    function name_to_key(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "");
    }

    // Derive content field info for autocomplete
    let content_fields_info = $derived<ContentFieldInfo[]>(
        store.content.map((field) => ({
            key: name_to_key(field.name),
            type: field.type,
        })),
    );

    type CodeTab = "frontend" | "backend";
    let active_tab = $state<CodeTab>("frontend");

    const backend_placeholder = `/*
  Server-side Backend (Coming Soon in v0.2)
  This file runs 24/7 on your server.
*/

import { env, queue } from '$tinykit'

// --- 1. API Endpoints ---

// GET /api/health
export const health = async () => {
  return { status: 'ok' }
}

// POST /api/summarize
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
export const daily_checkin = {
  cron: '0 9 * * *',
  handler: async () => {
    // Read data, send reports, etc.
  }
}

/*
  Ideas or feedback? https://github.com/tinykit-studio/tinykit/discussions
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
        on_refresh_preview: () => void;
        on_save_status_change?: (status: {
            is_saving: boolean;
            has_unsaved: boolean;
            last_saved_at: Date | null;
        }) => void;
    };

    let { on_refresh_preview, on_save_status_change }: CodePanelProps =
        $props();

    // Local state for code content - start empty, sync from store via effect below
    let code_content = $state("");

    // Track when content changes externally (from file load or agent)
    let is_user_editing = $state(false);

    // Sync from store on mount AND when store.code changes
    // This handles both initial load and realtime updates
    // Use untrack to read current values without creating circular dependencies
    $effect(() => {
        const store_code = store.code;
        // Read these without creating a dependency on them
        const current_code = $state.snapshot(code_content);
        const editing = $state.snapshot(is_user_editing);

        // Only sync if user isn't actively editing and there's new content
        if (!editing && store_code && store_code !== current_code) {
            code_content = store_code;
            last_saved_content = store_code;
        }
    });

    let save_timeout: ReturnType<typeof setTimeout> | null = null;
    let last_saved_content = $state("");
    let last_saved_at = $state<Date | null>(null);
    let is_saving = $state(false);

    let has_unsaved_changes = $derived(
        code_content !== last_saved_content && last_saved_content !== "",
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
        if (store.loading) return;
        if (code_content === last_saved_content) return;

        is_saving = true;
        try {
            // Optimistic update - sync store immediately so realtime echoes are ignored
            store.update_code(code_content);
            await api.write_code(project_id, code_content);
            last_saved_content = code_content;
            last_saved_at = new Date();
            // Reset user editing flag after save so realtime updates can apply again
            is_user_editing = false;

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

        // Mark as user edit so external updates don't overwrite
        is_user_editing = true;
        code_content = new_value;

        // Trigger auto-save
        if (save_timeout) clearTimeout(save_timeout);
        save_timeout = setTimeout(async () => {
            if (is_mounted && !store.loading) {
                await save_file();
            }
            // Always reset editing flag after save completes
            // This ensures agent updates can come through after user stops typing
            is_user_editing = false;
        }, 500);
    }
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
                        <p class="text-xs text-muted-foreground">
                            Runs in browser
                        </p>
                    </Tooltip.Content>
                </Tooltip.Root>
            </div>
        </Tooltip.Provider>
        {#if active_tab === "frontend"}
            <CodeMirror
                value={code_content}
                language="svelte"
                onChange={handle_change}
                cache_key="frontend-code (TODO: set to project ID)"
                collections={store.data_files}
                content_fields={content_fields_info}
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
