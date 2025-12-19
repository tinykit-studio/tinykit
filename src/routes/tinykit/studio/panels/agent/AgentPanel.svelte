<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { Button } from "$lib/components/ui/button";
  import TokenCost from "../../../components/TokenCost.svelte";
  import { emoji_to_icon } from "./emojis";
  import {
    FileText,
    Palette,
    Database,
    Code,
    ArrowUp,
    Settings,
    Sparkles,
  } from "lucide-svelte";
  import { pb } from "$lib/pocketbase.svelte";
  import type {
    AgentMessage,
    PreviewError,
    TokenUsage,
    PendingPrompt,
  } from "../../../types";
  import {
    send_prompt,
    clear_conversation,
    load_spec,
  } from "../../../lib/api.svelte";
  import { marked } from "marked";
  import { current_builder_theme } from "$lib/builder_themes";
  import { getProjectContext } from "../../../context";
  import { getProjectStore } from "../../project.svelte";

  // Get project_id from context instead of props
  const { project_id } = getProjectContext();
  const store = getProjectStore();

  // Configure marked
  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  function render_markdown(text: string): string {
    // Replace annoying phrases with neutral tone
    let processed = text;
    processed = processed.replace(
      /You're absolutely right!?/gi,
      "That's correct.",
    );
    processed = processed.replace(/Absolutely right!?/gi, "Correct.");

    // Replace emojis with icon markers before markdown parsing
    for (const [emoji, icon] of Object.entries(emoji_to_icon)) {
      const escaped = emoji.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      processed = processed.replace(
        new RegExp(escaped, "gu"),
        `[[ICON::${icon}]]`,
      );
    }

    // Clean up excessive whitespace
    const cleaned = processed.replace(/\n{3,}/g, "\n\n").trim();

    // Parse markdown
    let html = marked.parse(cleaned) as string;

    // Replace icon markers with iconify-icon web components
    html = html.replace(
      /\[\[ICON::([^\]]+)\]\]/g,
      '<iconify-icon icon="$1" style="vertical-align: -0.125em;color:var(--builder-accent)"></iconify-icon>',
    );

    return html;
  }

  // Detect if current theme is light (for conditional prose styling)
  let is_light_theme = $derived($current_builder_theme?.id === "light");

  // Prose classes that adapt to theme
  let prose_classes = $derived(
    is_light_theme
      ? "prose prose-sm prose-pre:bg-black/5 prose-pre:border prose-pre:border-black/10 prose-code:before:content-none prose-code:after:content-none prose-headings:font-semibold prose-p:my-2 prose-headings:my-2 max-w-none mb-4"
      : "prose prose-invert prose-sm prose-pre:bg-white/[0.025] prose-pre:border prose-pre:border-white/10 prose-code:before:content-none prose-code:after:content-none prose-headings:font-semibold prose-p:my-2 prose-headings:my-2 max-w-none mb-4",
  );

  // Message bubble background that adapts to theme
  let bubble_bg = $derived(
    is_light_theme ? "bg-black/[0.025]" : "bg-white/[0.025]",
  );

  type AgentPanelProps = {
    vibe_zone_visible: boolean;
    vibe_user_prompt: string;
    preview_errors: PreviewError[];
    pending_prompt: PendingPrompt | null;
    on_navigate_to_field: (tab: string, field_name?: string) => void;
    on_pending_prompt_consumed: () => void;
    on_loading_change?: (loading: boolean) => void;
  };

  let {
    vibe_zone_visible = $bindable(),
    vibe_user_prompt = $bindable(),
    preview_errors = $bindable(),
    pending_prompt = null,
    on_navigate_to_field,
    on_pending_prompt_consumed,
    on_loading_change,
  }: AgentPanelProps = $props();

  // Derive vibe_zone_enabled from store
  let vibe_zone_enabled = $derived(
    store.project?.settings?.vibe_zone_enabled ?? true,
  );

  // Callbacks replaced by store methods
  const on_refresh_data = async () => {
    // Trigger store refresh which updates all data
    await store.refresh();
    // Also maybe need a specific reload for files? store.data_files is derived from project.data.
    // So project refresh is enough.
  };

  let agent_input = $state("");
  let message_container: HTMLDivElement;
  let input_element: HTMLTextAreaElement;
  let llm_configured = $state<boolean | null>(null); // null = loading, true/false = checked

  // Local sending state - triggers immediately on send, before realtime updates
  let is_sending = $state(false);

  // Store derived state
  let is_processing = $derived(store.is_processing);
  let is_loading_messages = $derived(store.loading);
  let store_messages = $derived(store.messages);
  let local_errors = $state<AgentMessage[]>([]);
  let messages = $derived([...store_messages, ...local_errors]);

  // Combined loading state for UI - shows bar immediately
  let show_loading = $derived(is_sending || is_processing);

  // localStorage key for persisting draft input
  const draft_key = `tinykit:agent-draft:${project_id}`;
  let auto_scroll = $state(true);
  let user_dismissed_vibe = $state(false);
  let current_usage = $state<TokenUsage | null>(null);

  // Sync vibe zone visibility to parent (for rendering over preview)
  $effect(() => {
    vibe_zone_visible =
      vibe_zone_enabled && is_processing && !user_dismissed_vibe;
  });

  // Notify parent of loading state changes (for preview indicator)
  $effect(() => {
    on_loading_change?.(show_loading);
  });

  // Handle dismiss from parent (when user closes vibe zone)
  export function dismiss_vibe() {
    user_dismissed_vibe = true;
  }

  onMount(async () => {
    input_element?.focus();
    // Scroll to bottom when mounting (switching to this tab)
    scroll_to_bottom();
    // Restore draft from localStorage
    const saved_draft = localStorage.getItem(draft_key);
    if (saved_draft) {
      agent_input = saved_draft;
      // Trigger auto-resize after restoring
      setTimeout(() => auto_resize_input(), 0);
    }
    // Check if LLM is configured
    try {
      const res = await fetch("/api/settings/llm-status", {
        headers: { Authorization: `Bearer ${pb.authStore.token}` },
      });
      const data = await res.json();
      llm_configured = data.configured;
    } catch {
      llm_configured = false;
    }
  });

  // Save draft to localStorage when input changes
  $effect(() => {
    if (agent_input) {
      localStorage.setItem(draft_key, agent_input);
    } else {
      localStorage.removeItem(draft_key);
    }
  });

  // Scroll to bottom when messages change
  $effect(() => {
    if (messages.length > 0) {
      scroll_to_bottom();
    }
  });

  // Track hidden prompt instructions (for fix error, etc.)
  let pending_full_prompt = $state<string | null>(null);

  // Handle pending prompt from external sources (e.g., fix error button)
  $effect(() => {
    if (pending_prompt && !is_processing) {
      // Show display version to user, store full version for API
      agent_input = pending_prompt.display;
      pending_full_prompt = pending_prompt.full;
      on_pending_prompt_consumed();
      // Small delay to ensure state is updated before sending
      setTimeout(() => send_message(), 50);
    }
  });

  function handle_keydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send_message();
    }
    // cmd-n to clear conversation
    if ((e.metaKey || e.ctrlKey) && e.key === "n") {
      e.preventDefault();
      clear_messages();
    }
  }

  function auto_resize_input() {
    if (!input_element) return;
    input_element.style.height = "auto";
    input_element.style.height = `${input_element.scrollHeight}px`;
  }

  function scroll_to_bottom() {
    if (message_container && auto_scroll) {
      setTimeout(() => {
        if (message_container) {
          message_container.scrollTop = message_container.scrollHeight;
        }
      }, 100);
    }
  }

  function handle_message_scroll() {
    if (!message_container) return;

    const threshold = 50;
    const scroll_top = message_container.scrollTop;
    const scroll_height = message_container.scrollHeight;
    const client_height = message_container.clientHeight;

    auto_scroll = scroll_height - scroll_top - client_height < threshold;
  }

  async function send_message() {
    if (!agent_input.trim() || is_processing || is_sending) return;

    const display_prompt = agent_input.trim();
    // Use full prompt if available (e.g., fix error with hidden instructions), otherwise use display
    const api_prompt = pending_full_prompt || display_prompt;
    pending_full_prompt = null; // Clear after use

    vibe_user_prompt = display_prompt;
    agent_input = "";
    user_dismissed_vibe = false;
    current_usage = null;

    // Start local loading immediately (before realtime updates)
    is_sending = true;

    // Reset textarea height
    if (input_element) {
      input_element.style.height = "auto";
    }

    // Note: We don't add the user message optimistically here
    // The server adds it to agent_chat and realtime syncs it back
    // This prevents duplicate messages
    scroll_to_bottom();

    try {
      // Include preview errors in context if any
      const errors_context =
        preview_errors.length > 0
          ? `\n\n[Preview errors detected:\n${preview_errors.map((e) => `- ${e.type}: ${e.message}${e.line ? ` (line ${e.line})` : ""}`).join("\n")}\n]`
          : "";

      preview_errors = []; // Clear errors after including

      // Fetch the current spec
      let spec = "";
      try {
        spec = await load_spec(project_id);
      } catch (err) {
        console.error("Failed to fetch spec:", err);
      }

      // Fire-and-forget: send prompt to server
      // Server will run agent in background and stream updates to DB
      // Client receives updates via Pocketbase realtime subscription
      // Send just the prompt - server handles adding to conversation history
      const response = await send_prompt(
        project_id,
        api_prompt + errors_context,
        spec,
      );

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(
          data.error || `Failed to start agent (${response.status})`,
        );
      }

      // Server returns { started: true, status: 'running' }
      // Updates will come through realtime subscription
      console.log("[Agent] Started:", data);

      // Realtime will take over - is_sending will be reset by the effect below
    } catch (error) {
      console.error("Failed to send message:", error);
      const error_message =
        error instanceof Error ? error.message : String(error);
      // Reset local sending state on error
      is_sending = false;
      // Show error in chat via local state
      local_errors = [
        ...local_errors,
        {
          role: "assistant",
          content: `Error: ${error_message}`,
        },
      ];
    }
  }

  // Reset local sending state when realtime takes over (is_processing becomes true)
  $effect(() => {
    if (is_processing) {
      // Realtime confirmed agent is running - local state no longer needed
      is_sending = false;
    }
  });

  // Safety timeout: reset is_sending if realtime never fires (e.g., network issue)
  let sending_timeout: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (is_sending) {
      sending_timeout = setTimeout(() => {
        if (is_sending && !is_processing) {
          console.warn("[Agent] Sending timeout - realtime may not be working");
          is_sending = false;
        }
      }, 30000); // 30 second timeout
    } else if (sending_timeout) {
      clearTimeout(sending_timeout);
      sending_timeout = null;
    }
  });

  async function clear_messages() {
    if (confirm("Clear all messages?")) {
      local_errors = [];
      try {
        await clear_conversation(project_id);
      } catch (error) {
        console.error("Failed to clear agent history:", error);
      }
    }
  }

  // Helper functions for code blocks and tool display
  // Extract field name from tool result string
  function extract_field_name(
    tool_name: string,
    result: string,
  ): string | null {
    if (tool_name === "create_content_field") {
      // Pattern: Created content field "FIELD_NAME" ...
      const match = result.match(/Created content field "([^"]+)"/);
      return match ? match[1] : null;
    }
    if (tool_name === "create_design_field") {
      // Pattern: Created {type} design field "FIELD_NAME" ...
      // e.g. "Created color design field "Primary Color" (--color-primary)"
      const match = result.match(/Created \w+ design field "([^"]+)"/);
      return match ? match[1] : null;
    }
    if (tool_name === "create_data_file") {
      // Pattern: Created collection "COLLECTION_NAME" with X records...
      const match = result.match(/Created collection "([^"]+)"/);
      return match ? match[1] : null;
    }
    if (tool_name === "insert_records") {
      // Pattern: Inserted X records into "COLLECTION_NAME"...
      const match = result.match(/into "([^"]+)"/);
      return match ? match[1] : null;
    }
    return null;
  }
</script>

<div class="h-full flex flex-col text-sm relative">
  <!-- Message History -->
  <div
    in:fade={{ duration: 200 }}
    bind:this={message_container}
    onscroll={handle_message_scroll}
    class="flex-1 overflow-y-auto p-3 space-y-3"
  >
    {#if is_loading_messages}
      <div
        class="flex flex-col items-center justify-center py-12 text-[var(--builder-text-secondary)]"
      >
        <div
          class="w-8 h-8 border-2 border-[var(--builder-accent)]/90 border-t-[var(--builder-accent)] rounded-full animate-spin mb-3"
        ></div>
        <p class="text-sm">Loading conversation...</p>
      </div>
    {:else if messages.length === 0}
      <div class="text-[var(--builder-text-secondary)] text-center py-12">
        {#if llm_configured === false}
          <div class="flex flex-col items-center gap-4">
            <div
              class="w-12 h-12 rounded-full bg-[var(--builder-bg-tertiary)] flex items-center justify-center"
            >
              <Sparkles class="w-6 h-6 text-[var(--builder-text-muted)]" />
            </div>
            <div>
              <p class="text-lg font-medium text-[var(--builder-text-primary)]">
                AI not configured
              </p>
              <p class="mt-2 max-w-xs mx-auto">
                Add an API key to use the AI assistant, or use templates and
                manual editing.
              </p>
            </div>
            <a
              href="/tinykit/settings"
              class="inline-flex items-center gap-2 px-4 py-2 bg-[var(--builder-accent)] text-white rounded-lg hover:bg-[var(--builder-accent-hover)] transition-colors text-sm font-medium"
            >
              <Settings class="w-4 h-4" />
              Configure AI
            </a>
          </div>
        {:else}
          <p class="text-lg font-medium text-[var(--builder-text-primary)]">
            Welcome to tinykit
          </p>
          <p class="mt-2">Describe what you want to build...</p>
        {/if}
      </div>
    {:else}
      {#each messages as message}
        {#if message.content || (message.stream_items && message.stream_items.length > 0)}
          <div
            in:fade={{ duration: 200 }}
            class="relative space-y-1 {bubble_bg} p-4 rounded-md {message.role ===
            'user'
              ? 'border-l-2 border-l-[var(--builder-accent)]'
              : ''}"
          >
            <div class="text-[var(--builder-text-secondary)] text-xs">
              {message.role === "user" ? "You" : "Agent"}
            </div>
            <div class="text-[var(--builder-text-primary)]">
              {#if message.role === "user"}
                <div class={prose_classes}>
                  {@html render_markdown(message.content)}
                </div>
              {:else}
                {#if message.stream_items && message.stream_items.length > 0}
                  <!-- Render items in stream order -->
                  {#each message.stream_items as item}
                    {@const is_text = item.type === "text"}
                    {@const is_tool = item.type === "tool"}
                    <div in:fade class="message-container">
                      {#if is_text}
                        <div class={prose_classes}>
                          {@html render_markdown(item.content || "")}
                        </div>
                      {:else if is_tool}
                        {@const tool_name = item.name || "unknown"}
                        {@const tool_result = item.result || ""}
                        {@const field_name = extract_field_name(
                          tool_name,
                          tool_result,
                        )}
                        {@const is_duplicate =
                          tool_result.includes("already exists")}
                        {#if !(is_duplicate || tool_name === "update_spec" || tool_name === "name_project")}
                          <div in:fade class="tool-button-container">
                            {#if tool_name === "create_content_field"}
                              <button
                                onclick={() => {
                                  store.refresh();
                                  on_navigate_to_field(
                                    "content",
                                    field_name || undefined,
                                  );
                                }}
                                class="tool-button tool-button--content tool-button--interactive"
                              >
                                <FileText class="w-3 h-3" />
                                <span>{field_name || "Content"}</span>
                              </button>
                            {:else if tool_name === "create_design_field"}
                              <button
                                onclick={() => {
                                  store.refresh();
                                  on_navigate_to_field(
                                    "design",
                                    field_name || undefined,
                                  );
                                }}
                                class="tool-button tool-button--design tool-button--interactive"
                              >
                                <Palette class="w-3 h-3" />
                                <span>{field_name || "Design"}</span>
                              </button>
                            {:else if tool_name === "create_data_file" || tool_name === "insert_records"}
                              <button
                                onclick={() => {
                                  on_navigate_to_field(
                                    "data",
                                    field_name || undefined,
                                  );
                                  store.refresh();
                                }}
                                class="tool-button tool-button--data tool-button--interactive"
                              >
                                <Database class="w-3 h-3" />
                                <span>{field_name || "Data"}</span>
                              </button>
                            {:else if tool_name === "write_code"}
                              <button
                                onclick={() => {
                                  // Navigate to code tab
                                  on_navigate_to_field("code");
                                }}
                                class="tool-button tool-button--code tool-button--interactive"
                              >
                                <Code class="w-3 h-3" />
                                <span>Code</span>
                              </button>
                            {:else}
                              <div
                                in:fade
                                class="tool-button tool-button--success"
                              >
                                <iconify-icon
                                  icon="lucide:check"
                                  class="w-3 h-3"
                                ></iconify-icon>
                                <span>{tool_name}</span>
                              </div>
                            {/if}
                          </div>
                        {/if}
                      {/if}
                    </div>
                  {/each}
                {:else}
                  <!-- Fallback for old messages without stream_items -->
                  <div class={prose_classes}>
                    {@html render_markdown(message.content)}
                  </div>
                {/if}

                <!-- Token usage display for assistant messages -->
                {#if message.usage}
                  <div class="absolute bottom-2 right-3">
                    <TokenCost usage={message.usage} />
                  </div>
                {/if}
              {/if}
            </div>
          </div>
        {/if}
      {/each}
      {#if show_loading}
        <div
          in:fade={{ duration: 200 }}
          out:fade={{ duration: 300 }}
          class="flex items-center gap-3 pl-1"
        >
          <span
            class="text-[var(--builder-text-secondary)] animate-pulse whitespace-nowrap"
            >Processing...</span
          >
          <div
            class="loading-bar-container h-[2px] flex-1 bg-[var(--builder-border)]/50 relative overflow-hidden rounded-[1rem]"
          >
            <div
              class="loading-bar absolute h-full w-1/2 bg-[var(--builder-accent)] rounded-[1rem]"
            ></div>
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <!-- Input Area -->
  <div class="border-t border-[var(--builder-border)]">
    {#if messages.length > 0}
      <div class="border-b border-[var(--builder-border)] px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onclick={clear_messages}
          class="text-xs font-sans text-[var(--builder-text-secondary)]"
        >
          Clear conversation
        </Button>
      </div>
    {/if}
    <div class="p-4">
      <div class="flex items-start gap-2">
        <span class="text-[var(--builder-accent)] pt-0.5 hidden sm:block"
          >></span
        >
        <textarea
          bind:this={input_element}
          bind:value={agent_input}
          onkeydown={handle_keydown}
          oninput={auto_resize_input}
          placeholder={llm_configured === false
            ? "AI not configured"
            : "Make a todo list"}
          class="mt-[3px] flex-1 bg-transparent text-[var(--builder-text-primary)] placeholder:text-[var(--builder-text-secondary)] placeholder:opacity-50 focus:outline-none font-sans resize-none overflow-hidden min-h-[1.5rem] max-h-[12rem]"
          disabled={show_loading || llm_configured === false}
          rows="1"
        ></textarea>
        <button
          onclick={send_message}
          disabled={show_loading ||
            !agent_input.trim() ||
            llm_configured === false}
          class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors {agent_input.trim() &&
          !show_loading &&
          llm_configured !== false
            ? 'bg-[var(--builder-accent)] text-white'
            : 'bg-[var(--builder-bg-tertiary)] text-[var(--builder-text-secondary)]'}"
        >
          <ArrowUp class="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .streaming-text {
    animation: fadeIn 0.3s ease-in;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .message-container {
    display: inline;
  }
  .message-container:empty {
    display: none;
  }
  .message-container:has(.prose) {
    display: block;
  }

  /* Tool button base styles */
  .tool-button-container {
    display: inline-flex;
    margin-right: 6px;
    margin-bottom: 6px;
  }
  .tool-button {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    line-height: 1rem;
    border: 1px solid;
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }

  .tool-button--interactive {
    cursor: pointer;
  }

  /* Code tool (orange - primary accent) */
  .tool-button--code {
    background: color-mix(in srgb, var(--tool-code) 10%, transparent);
    border-color: color-mix(in srgb, var(--tool-code) 20%, transparent);
    color: var(--tool-code);
  }
  .tool-button--code.tool-button--interactive:hover {
    background: color-mix(in srgb, var(--tool-code) 20%, transparent);
    border-color: color-mix(in srgb, var(--tool-code) 30%, transparent);
  }

  /* Content tool (green) */
  .tool-button--content {
    background: color-mix(in srgb, var(--tool-content) 10%, transparent);
    border-color: color-mix(in srgb, var(--tool-content) 20%, transparent);
    color: var(--tool-content);
  }
  .tool-button--content.tool-button--interactive:hover {
    background: color-mix(in srgb, var(--tool-content) 20%, transparent);
    border-color: color-mix(in srgb, var(--tool-content) 30%, transparent);
  }

  /* Design tool (purple) */
  .tool-button--design {
    background: color-mix(in srgb, var(--tool-design) 10%, transparent);
    border-color: color-mix(in srgb, var(--tool-design) 20%, transparent);
    color: var(--tool-design);
  }
  .tool-button--design.tool-button--interactive:hover {
    background: color-mix(in srgb, var(--tool-design) 20%, transparent);
    border-color: color-mix(in srgb, var(--tool-design) 30%, transparent);
  }

  /* Data tool (indigo) */
  .tool-button--data {
    background: color-mix(in srgb, var(--tool-data) 10%, transparent);
    border-color: color-mix(in srgb, var(--tool-data) 20%, transparent);
    color: var(--tool-data);
  }
  .tool-button--data.tool-button--interactive:hover {
    background: color-mix(in srgb, var(--tool-data) 20%, transparent);
    border-color: color-mix(in srgb, var(--tool-data) 30%, transparent);
  }

  /* Success/confirmation (emerald) */
  .tool-button--success {
    background: color-mix(in srgb, var(--tool-success) 10%, transparent);
    border-color: color-mix(in srgb, var(--tool-success) 20%, transparent);
    color: var(--tool-success);
  }

  /* Prevent iOS zoom on input focus */
  textarea {
    font-size: 16px;
  }

  @media (min-width: 768px) {
    textarea {
      font-size: inherit;
    }
  }

  /* Simple code block styling (no syntax highlighting) */
  :global(.prose pre) {
    background: var(--builder-bg-tertiary) !important;
    border: 1px solid var(--builder-border) !important;
    border-radius: 0.25rem;
    margin: 0.5rem 0;
    padding: 1rem;
    overflow-x: auto;
  }

  :global(.prose pre code) {
    font-size: 0.875rem;
    line-height: 1.5;
    background: transparent !important;
    color: var(--builder-text-primary);
    font-family: "Monaco", "Menlo", "Ubuntu Mono", "Courier New", monospace;
  }

  /* Loading bar animation */
  @keyframes slide {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(400%);
    }
  }

  .loading-bar-container {
    mask-image: linear-gradient(
      to right,
      transparent,
      black 20%,
      black 80%,
      transparent
    );
    -webkit-mask-image: linear-gradient(
      to right,
      transparent,
      black 20%,
      black 80%,
      transparent
    );
  }

  .loading-bar {
    animation: slide 1.5s ease-in-out infinite;
    box-shadow: 0 0 8px var(--builder-accent);
  }
</style>
