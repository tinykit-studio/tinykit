<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    processCode,
    dynamic_iframe_srcdoc,
    generate_design_css,
    extract_web_fonts,
  } from "$lib/compiler/init";
  import { debounce } from "lodash-es";
  import * as api from "../../routes/tinykit/lib/api.svelte";
  import { Sparkles } from "lucide-svelte";
  import { pb } from "$lib/pocketbase.svelte";

  let {
    code = $bindable(""),
    language = "html",
    project_id,
    agent_working = false,
  }: {
    code?: string;
    language?: string;
    project_id: string;
    agent_working?: boolean;
  } = $props();

  let realtime_unsubscribe: (() => void) | null = null;
  let is_mounted = false;

  let preview_iframe = $state<HTMLIFrameElement | null>(null);
  let channel: BroadcastChannel | null = null;
  let iframe_loaded = $state(false);
  let compiled_app = $state<string | null>(null);
  let compile_error = $state<string | null>(null);
  let is_compiling = $state(false);
  let show_building = $state(false);
  let content_fields = $state<any[]>([]);
  let design_fields = $state<any[]>([]);
  let data_collections = $state<string[]>([]);
  let srcdoc = $state("");
  const broadcast_id = "crud-preview";
  let building_timeout: ReturnType<typeof setTimeout> | null = null;
  let pending_config_update = $state(false);
  let compilation_version = 0;

  onMount(() => {
    is_mounted = true;

    // Load config data for $content, $design, and $data
    api
      .load_config(project_id)
      .then(async (config) => {
        content_fields = config.fields || [];
        design_fields = config.design || [];
        // Load data collections
        data_collections = await api.load_data_files(project_id);
        srcdoc = dynamic_iframe_srcdoc("", broadcast_id, {
          content: content_fields,
          design: design_fields,
          project_id,
          data_collections,
        });
      })
      .catch((err) => {
        console.error("[Preview] Failed to load config:", err);
        srcdoc = dynamic_iframe_srcdoc("", broadcast_id, { project_id });
      });

    channel = new BroadcastChannel(broadcast_id);
    channel.onmessage = ({ data }) => {
      const { event } = data;
      if (event === "INITIALIZED") {
        iframe_loaded = true;
        if (compiled_app) {
          send_to_iframe();
        }
      } else if (event === "SET_ERROR") {
        compile_error = data.payload?.error || "Unknown runtime error";
      } else if (event === "BEGIN") {
        compile_error = null;
      }
    };

    // Subscribe to realtime updates for this project's data
    pb.collection("_tk_projects")
      .subscribe(project_id, (e) => {
        // Guard against posting to closed channel after unmount
        if (!is_mounted || !channel) return;
        if (e.action === "update" && e.record.data) {
          // Forward data changes to iframe
          channel.postMessage({
            event: "DATA_UPDATED",
            payload: { data: e.record.data },
          });
        }
      })
      .then((unsubscribe) => {
        realtime_unsubscribe = unsubscribe;
      })
      .catch((err) => {
        console.warn("[Preview] Failed to subscribe to realtime:", err);
      });

    // Trigger initial compilation if code exists
    if (code && (language === "html" || language === "svelte")) {
      compile_component();
    }

    return () => {
      is_mounted = false;
      realtime_unsubscribe?.();
      channel?.close();
    };
  });

  async function compile_component() {
    if (!code || (language !== "html" && language !== "svelte")) {
      return;
    }

    // Track version to discard stale results
    const my_version = ++compilation_version;

    is_compiling = true;
    show_building = true;
    compile_error = null;

    // Clear any pending hide timeout
    if (building_timeout) {
      clearTimeout(building_timeout);
      building_timeout = null;
    }

    try {
      const result = await processCode({
        component: code, // Pass the raw Svelte code as a string
        buildStatic: false,
        dev_mode: true, // Enable dev mode for better errors and $inspect
        sourcemap: true, // Enable sourcemaps for debugging
        runtime: ["mount", "unmount"],
      });

      // Discard result if a newer compilation started
      if (my_version !== compilation_version) {
        return;
      }

      if (result.error) {
        compile_error = result.error;
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
      compiled_app = null;
    } finally {
      // Only update UI state if this is still the current compilation
      if (my_version === compilation_version) {
        is_compiling = false;
        // Keep showing building state for minimum 300ms to avoid flicker
        building_timeout = setTimeout(() => {
          show_building = false;
        }, 300);
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

  const debounced_compile = debounce(compile_component, 500);

  // Watch for code changes - but wait until agent is done
  $effect(() => {
    if (
      code &&
      (language === "html" || language === "svelte") &&
      !agent_working
    ) {
      debounced_compile();
    }
  });

  // When agent finishes, process any pending config updates
  $effect(() => {
    if (!agent_working && pending_config_update) {
      pending_config_update = false;
      // Trigger a config reload now that agent is done
      window.dispatchEvent(new CustomEvent("tinykit:config-updated"));
    }
  });

  // Watch for content/design field changes and reload config
  let config_reload_listener: ((e: Event) => void) | null = null;
  onMount(() => {
    config_reload_listener = async () => {
      try {
        const config = await api.load_config(project_id);
        const new_content = config.fields || [];
        const new_design = config.design || [];
        const new_data_collections = await api.load_data_files(project_id);

        // Check if fields actually changed
        const content_changed =
          JSON.stringify(new_content) !== JSON.stringify(content_fields);
        const design_changed =
          JSON.stringify(new_design) !== JSON.stringify(design_fields);
        const data_changed =
          JSON.stringify(new_data_collections) !==
          JSON.stringify(data_collections);

        // Design-only changes: inject CSS without reload
        if (design_changed && !content_changed && !data_changed) {
          design_fields = new_design;
          channel?.postMessage({
            event: "UPDATE_CSS_VARS",
            payload: { css: generate_design_css(new_design) },
          });
          // Also inject any new font links
          const fonts = extract_web_fonts(new_design);
          if (fonts.length > 0) {
            channel?.postMessage({
              event: "UPDATE_FONTS",
              payload: { fonts },
            });
          }
        } else if (content_changed || data_changed) {
          // Content or data changes require full reload - but defer if agent is working
          if (agent_working) {
            // Queue the update for when agent finishes
            pending_config_update = true;
          } else {
            content_fields = new_content;
            design_fields = new_design;
            data_collections = new_data_collections;

            // Update srcdoc with new field data
            srcdoc = dynamic_iframe_srcdoc("", broadcast_id, {
              content: content_fields,
              design: design_fields,
              project_id,
              data_collections,
            });

            // Recompile to pick up new imports
            if (code && (language === "html" || language === "svelte")) {
              compile_component();
            }
          }
        }
      } catch (err) {
        console.error("[Preview] Failed to reload config:", err);
      }
    };

    // Listen for custom events from content/design panels
    window.addEventListener("tinykit:config-updated", config_reload_listener);

    return () => {
      if (config_reload_listener) {
        window.removeEventListener(
          "tinykit:config-updated",
          config_reload_listener,
        );
      }
    };
  });
</script>

<div
  class="preview-container"
  class:is-building={show_building || agent_working}
>
  {#if show_building || agent_working}
    <div class="building-border"></div>
  {/if}
  {#if compile_error}
    <div class="error-banner">
      <div class="error-banner-content">
        <span class="error-icon">⚠</span>
        <div class="error-text">
          <div class="error-title">Compilation Failed</div>
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
