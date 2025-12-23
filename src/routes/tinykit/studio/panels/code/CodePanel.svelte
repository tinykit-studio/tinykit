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

    const backend_example = `// Backend functions run on your server (not in browser)
// Call from frontend: import backend from '$backend'
//                     const result = await backend.my_function({ arg })

// Available globals: env (secrets), data (collections), fetch

export async function hello({ name }) {
  return { message: \`Hello, \${name}!\` }
}

// Example: Call external API with secret key
export async function summarize({ text }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${env.OPENAI_API_KEY}\`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: \`Summarize: \${text}\` }]
    })
  })
  const data = await response.json()
  return { summary: data.choices?.[0]?.message?.content }
}

// Example: Access project data
export async function get_stats() {
  const todos = await data.todos.list()
  const done = todos.filter(t => t.done).length
  return { total: todos.length, done, pending: todos.length - done }
}
`;

    // Track if component is still mounted
    let is_mounted = true;
    onDestroy(() => {
        is_mounted = false;
        // Clear any pending save timeouts
        if (save_timeout) {
            clearTimeout(save_timeout);
            save_timeout = null;
        }
        if (backend_save_timeout) {
            clearTimeout(backend_save_timeout);
            backend_save_timeout = null;
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
    let backend_code_content = $state("");

    // Track when content changes externally (from file load or agent)
    let is_user_editing = $state(false);
    let is_backend_user_editing = $state(false);

    // Sync frontend code from store
    $effect(() => {
        const store_code = store.code;
        const current_code = $state.snapshot(code_content);
        const editing = $state.snapshot(is_user_editing);

        if (!editing && store_code && store_code !== current_code) {
            code_content = store_code;
            last_saved_content = store_code;
        }
    });

    // Sync backend code from store
    $effect(() => {
        const store_backend = store.backend_code;
        const current = $state.snapshot(backend_code_content);
        const editing = $state.snapshot(is_backend_user_editing);

        if (!editing && store_backend !== current) {
            backend_code_content = store_backend || backend_example;
            last_saved_backend = store_backend || "";
        }
    });

    let save_timeout: ReturnType<typeof setTimeout> | null = null;
    let backend_save_timeout: ReturnType<typeof setTimeout> | null = null;
    let last_saved_content = $state("");
    let last_saved_backend = $state("");
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

    async function save_backend() {
        if (!is_mounted) return;
        if (store.loading) return;
        if (backend_code_content === last_saved_backend) return;

        is_saving = true;
        try {
            store.update_backend_code(backend_code_content);
            await api.write_backend_code(project_id, backend_code_content);
            last_saved_backend = backend_code_content;
            last_saved_at = new Date();
            is_backend_user_editing = false;
        } catch (err) {
            console.error("Failed to save backend code:", err);
        } finally {
            is_saving = false;
        }
    }

    function handle_backend_change(new_value: string) {
        if (!is_mounted) return;

        is_backend_user_editing = true;
        backend_code_content = new_value;

        if (backend_save_timeout) clearTimeout(backend_save_timeout);
        backend_save_timeout = setTimeout(async () => {
            if (is_mounted && !store.loading) {
                await save_backend();
            }
            is_backend_user_editing = false;
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
                        <p class="text-xs text-muted-foreground">Runs on server</p>
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
                value={backend_code_content}
                language="javascript"
                onChange={handle_backend_change}
                cache_key="backend-code"
            />
        {/if}
    </div>
</div>
