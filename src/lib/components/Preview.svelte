<script lang="ts">
  import { onMount } from "svelte";
  import {
    processCode,
    dynamic_iframe_srcdoc,
    generate_design_css,
    extract_web_fonts,
    transform_content_fields,
  } from "$lib/compiler/init";
  import { watch } from "runed";
  import { Sparkles } from "lucide-svelte";
  // Import store type only to avoid hard dependency if possible?
  // We need the value to access state.
  // Using relative path to access route-level store
  import { getProjectStore } from "$tinykit/studio/project.svelte";
  import _ from "lodash-es";
  let {
    project_id,
  }: {
    project_id: string;
  } = $props();

  // Try to get store from context
  let store: any = null;
  try {
    store = getProjectStore();
  } catch (e) {
    // Ignore - not in studio context
  }

  // let realtime_unsubscribe: (() => void) | null = null;
  let is_mounted = false;

  let preview_iframe = $state<HTMLIFrameElement | null>(null);
  let channel: BroadcastChannel | null = null;
  let iframe_loaded = $state(false);
  let compiled_app = $state<string | null>(null);
  let compile_error = $state<string | null>(null);
  let error_type = $state<"compile" | "runtime">("compile");
  let is_compiling = $state(false);

  // Use store processing state if available
  let is_processing = $derived(store?.is_processing);

  // Watch for code changes
  const active_code = $derived(store?.project?.frontend_code);
  watch(
    () => ({ is_processing, active_code }),
    ({ is_processing, active_code }) => {
      if (is_processing) return;
      if (active_code) {
        compile_component();
      } else if (!active_code) {
        compiled_app = null;
        compile_error = null;
        channel?.postMessage({ event: "CLEAR_APP" });
      }
    },
  );

  // Watch for app data changes (debounced to prevent rapid-fire updates)
  let last_sent_data: any;
  const send_data_update = _.debounce((data: any) => {
    if (_.isEqual(data, last_sent_data)) return;
    const cloned_data = _.cloneDeep(data);
    channel?.postMessage({
      event: "DATA_UPDATED",
      payload: { data: cloned_data },
    });
    last_sent_data = cloned_data;
  }, 50);

  watch(
    () => store?.project?.data,
    (data) => send_data_update(data),
  );

  let content_fields = $state<any[]>([]);
  let design_fields = $state<any[]>([]);
  let data_collections = $state<string[]>([]);

  let srcdoc = $state("");
  const broadcast_id = $derived(`crud-preview-${project_id}`);
  let pending_config_update = $state(false);
  let compilation_version = 0;

  // Reset state when project_id changes
  watch(
    () => project_id,
    () => {
      // Close old channel and create new one
      channel?.close();
      channel = new BroadcastChannel(broadcast_id);
      channel.onmessage = handle_channel_message;

      // Reset all state
      iframe_loaded = false;
      compiled_app = null;
      compile_error = null;
      srcdoc = "";
      content_fields = [];
      design_fields = [];
      data_collections = [];
      compilation_version = 0;
    },
  );

  $effect(() => {
    if (store && store.project) {
      // Sync basic data
      // Note: diffing happens in the update_config function usually,
      // but here we are reacting to fine-grained store updates.
      // We can call a unified update function.
      handle_store_update();
    }
  });

  async function handle_store_update() {
    if (!store) return;

    const new_content = store.content || [];
    const new_design = store.design || [];
    const new_data = store.data_files || [];

    // We reuse the existing diffing logic
    await apply_config_update(new_content, new_design, new_data);
  }

  function handle_channel_message({ data }: MessageEvent) {
    const { event } = data;
    if (event === "INITIALIZED") {
      iframe_loaded = true;
      if (compiled_app) {
        send_to_iframe();
      }
    } else if (event === "SET_ERROR") {
      compile_error = data.payload?.error || "Unknown runtime error";
      error_type = "runtime";
    } else if (event === "BEGIN") {
      compile_error = null;
    }
  }

  onMount(() => {
    is_mounted = true;

    channel = new BroadcastChannel(broadcast_id);
    channel.onmessage = handle_channel_message;

    return () => {
      is_mounted = false;
      channel?.close();
      send_data_update.cancel();
    };
  });


  // Unified update logic (shared by store and manual loading)
  async function apply_config_update(
    new_content: any[],
    new_design: any[],
    new_data_collections: string[],
  ) {
    // Check if fields actually changed
    const content_changed = !_.isEqual(new_content, content_fields);
    const design_changed = !_.isEqual(new_design, design_fields);
    const data_changed = !_.isEqual(new_data_collections, data_collections);

    // No srcdoc yet or data collections changed - need full reload
    if (!srcdoc || data_changed) {
      if (is_processing) {
        pending_config_update = true;
      } else {
        content_fields = new_content;
        design_fields = new_design;
        data_collections = new_data_collections;

        srcdoc = dynamic_iframe_srcdoc("", broadcast_id, {
          content: content_fields,
          design: design_fields,
          project_id,
          data_collections,
        });

        if (!active_code) return;
        compile_component();
      }
      return;
    }

    // Content changes: update global and remount (no full reload)
    if (content_changed) {
      content_fields = new_content;
      channel?.postMessage({
        event: "UPDATE_CONTENT",
        payload: { content: transform_content_fields(new_content, project_id) },
      });
    }

    // Design changes: inject CSS (no reload needed)
    if (design_changed) {
      design_fields = new_design;
      channel?.postMessage({
        event: "UPDATE_CSS_VARS",
        payload: { css: generate_design_css(new_design) },
      });
      const fonts = extract_web_fonts(new_design);
      if (fonts.length > 0) {
        channel?.postMessage({
          event: "UPDATE_FONTS",
          payload: { fonts },
        });
      }
    }
  }

  async function compile_component() {
    const my_version = ++compilation_version;

    is_compiling = true;
    compile_error = null;

    try {
      const result = await processCode({
        component: active_code,
        buildStatic: false,
        dev_mode: true,
        sourcemap: true,
        runtime: ["mount", "unmount"],
      });

      if (my_version !== compilation_version) {
        return;
      }

      if (result.error) {
        compile_error = result.error;
        error_type = "compile";
        compiled_app = null;
      } else {
        compiled_app = result.js;
        compile_error = null;
        if (iframe_loaded) {
          send_to_iframe();
        }
      }
    } catch (err) {
      // Discard error if a newer compilation started
      if (my_version !== compilation_version) {
        return;
      }
      compile_error = err instanceof Error ? err.message : String(err);
      error_type = "compile";
      compiled_app = null;
    } finally {
      // Only update UI state if this is still the current compilation
      if (my_version === compilation_version) {
        is_compiling = false;
      }
    }
  }

  function send_to_iframe() {
    if (!channel || !compiled_app) return;
    channel.postMessage({
      event: "SET_APP",
      payload: {
        componentApp: compiled_app,
        data: {},
      },
    });
  }

</script>

<div
  class="preview-container"
  class:is-building={is_compiling || is_processing}
>
  {#if is_compiling || is_processing}
    <div class="building-border"></div>
  {/if}
  {#if compile_error}
    <div class="error-banner">
      <div class="error-banner-content">
        <span class="error-icon">⚠</span>
        <div class="error-text">
          <div class="error-title">
            {error_type === "compile" ? "Compilation Failed" : "Runtime Error"}
          </div>
          <div class="error-message">{compile_error}</div>
        </div>
      </div>
      <button
        class="fix-button"
        onclick={() => {
          window.dispatchEvent(
            new CustomEvent("tinykit:fix-error", {
              detail: { error: compile_error },
            }),
          );
        }}
      >
        <Sparkles class="w-3" />
        Ask agent to fix this
      </button>
    </div>
  {/if}
  {#if srcdoc}
    <iframe
      bind:this={preview_iframe}
      title="Preview"
      {srcdoc}
      class="preview-iframe"
      class:has-error={compile_error}
      class:is-updating={is_compiling}
    ></iframe>
  {:else}
    <div class="loading-placeholder">
      <div class="loading-spinner"></div>
      <span>Loading preview...</span>
    </div>
  {/if}
</div>

<style>
  .preview-container {
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--builder-bg-secondary, #f5f5f5);
  }

  .preview-iframe {
    width: 100%;
    height: 100%;
    border: none;
    opacity: 1;
    transition: opacity 0.15s ease-out;
  }

  .preview-iframe.is-updating {
    opacity: 0.6;
  }

  .preview-iframe.has-error {
    height: calc(100% - 80px);
  }

  .error-banner {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    background: var(--builder-bg-primary, #1a1a1a);
    border-bottom: 1px solid rgba(239, 68, 68, 0.3);
    padding: 0.75rem;
    z-index: 10;
  }

  .error-banner-content {
    display: flex;
    align-items: start;
    gap: 0.5rem;
  }

  .error-icon {
    color: #ef4444;
    font-size: 1.125rem;
    flex-shrink: 0;
    line-height: 1;
  }

  .error-text {
    flex: 1;
    min-width: 0;
  }

  .error-title {
    color: #ef4444;
    font-weight: 500;
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .error-message {
    color: rgba(252, 165, 165, 0.8);
    font-size: 0.75rem;
    margin-top: 0.25rem;
    font-family: "Courier New", monospace;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
  }

  .fix-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 4px;
    color: #ef4444;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .fix-button:hover {
    background: rgba(239, 68, 68, 0.25);
    border-color: rgba(239, 68, 68, 0.5);
  }

  .loading-placeholder {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    color: var(--builder-text-secondary, #888);
    font-size: 0.875rem;
  }

  .loading-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--builder-border, #333);
    border-top-color: var(--builder-accent, #3b82f6);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Racing border animation while building */
  .building-border {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
    overflow: hidden;
    --border: 3px;
    mask:
      linear-gradient(#000, #000) top / 100% var(--border) no-repeat,
      linear-gradient(#000, #000) bottom / 100% var(--border) no-repeat,
      linear-gradient(#000, #000) left / var(--border) 100% no-repeat,
      linear-gradient(#000, #000) right / var(--border) 100% no-repeat;
  }

  .building-border::before {
    content: "";
    position: absolute;
    inset: -50%;
    background: conic-gradient(
      from 0deg,
      transparent 0deg,
      var(--builder-accent, #3b82f6) 60deg,
      transparent 120deg
    );
    animation: race 1.5s linear infinite;
  }

  @keyframes race {
    to {
      transform: rotate(360deg);
    }
  }
</style>
