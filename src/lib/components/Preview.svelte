<script lang="ts">
  import { onMount } from "svelte";
  import {
    processCode,
    dynamic_iframe_srcdoc,
    generate_design_css,
    extract_web_fonts,
    transform_content_fields,
    reset_compiler_workers,
  } from "$lib/compiler/init";
  import { watch } from "runed";
  import { Sparkles, RotateCcw } from "lucide-svelte";
  import { isolateCompanionPreview, companionAssetReferences } from '$lib/compiler/companion';
  // Import store type only to avoid hard dependency if possible?
  // We need the value to access state.
  // Using relative path to access route-level store
  import { getProjectStore } from "$tinykit/studio/project.svelte";
  import { debounce, cloneDeep } from "lodash-es";
  let {
    project_id,
    project_store,
    companion = false,
    preview_capability = '',
    source_revision = '',
    on_compile,
  }: {
    project_id: string;
    project_store?: any;
    companion?: boolean;
    preview_capability?: string;
    source_revision?: string;
    on_compile?: (report: { revision: string; attempt: string; state: 'pending' | 'success' | 'error'; error?: string }) => void;
  } = $props();

  // Try to get store from context
  const context_store = (() => {
    try { return getProjectStore(); }
    catch { return null; }
  })();
  const store = $derived(project_store || context_store);

  // let realtime_unsubscribe: (() => void) | null = null;
  const source_tree = $derived(Boolean(store?.project?.source_bundle));
  let is_mounted = false;

  let preview_iframe = $state<HTMLIFrameElement | null>(null);
  let iframe_loaded = $state(false);
  let compiled_app = $state<string | null>(null);
  let compile_error = $state<string | null>(null);
  let error_type = $state<"compile" | "runtime" | "timeout">("compile");
  let is_compiling = $state(false);

  // A compile that never settles (e.g. a hung compiler worker) would otherwise leave
  // the preview on its building animation forever. Generous: a cold first compile is slow.
  const COMPILE_TIMEOUT = 20000;
  let compile_timeout: ReturnType<typeof setTimeout> | undefined;

  // Infinite loop detection via heartbeat monitoring
  let last_heartbeat = $state(0);
  let heartbeat_check_interval: ReturnType<typeof setInterval> | null = null;
  let last_freeze_check_at = 0;
  let freeze_detected = $state(false); // Prevents auto-recompile after freeze
  let mounting_in_progress = $state(false); // Track if mount is in progress
  let mount_started_at = $state(0); // When mount started
  let last_code_change_at = $state(0); // When code last changed (for grace period)
  const HEARTBEAT_TIMEOUT = 1200; // Consider frozen if no heartbeat for 1.2s
  const MOUNT_TIMEOUT = 600; // Very tight timeout during mount (600ms)
  const CODE_CHANGE_GRACE_PERIOD = 1000; // Grace period after code change before freeze detection

  // Use store processing state if available
  let is_processing = $derived(store?.is_processing);
  // Once declared stuck, stop the building animation so it doesn't contradict the error.
  const is_building = $derived((is_compiling && error_type !== "timeout") || is_processing);

  // Debounced compilation to avoid rapid re-compiles
  const debounced_compile = debounce(() => {
    if (!source_tree && !is_processing && active_code && !freeze_detected) {
      compile_component();
    }
  }, 150);

  // Watch for code changes
  const active_code = $derived(store?.project?.frontend_code);
  let last_code_snapshot = ""; // Track code to detect actual changes
  watch(
    () => ({ is_processing, active_code, source_revision }),
    (value, previous) => {
      // Store snapshots can change after a data write without changing source.
      if (previous && value.is_processing === previous.is_processing && value.active_code === previous.active_code && value.source_revision === previous.source_revision) return;
      const { is_processing, active_code } = value;
      if (is_processing) return;
      // Clear freeze flag when code actually changes (user edited or snapshot restored)
      if (active_code && active_code !== last_code_snapshot) {
        freeze_detected = false;
        last_code_snapshot = active_code;
        last_code_change_at = Date.now(); // Track for grace period
      }
      if (active_code) {
        debounced_compile();
      } else if (!active_code) {
        compilation_version++;
        compiled_app = null;
        compile_error = null;
        post_to_iframe({ event: "CLEAR_APP" });
        if (on_compile) {
          const report = { revision: source_revision, attempt: crypto.randomUUID() };
          on_compile({ ...report, state: 'pending' });
          on_compile({ ...report, state: 'success' });
        }
      }
    },
  );

  // Send message to iframe via postMessage
  function post_to_iframe(message: any) {
    if (!preview_iframe?.contentWindow) return;
    preview_iframe.contentWindow.postMessage(message, "*");
  }

  // Watch for app data changes (debounced to prevent rapid-fire updates)
  // Using JSON comparison to avoid Svelte 5 proxy issues
  let last_data_hash = "";
  const send_data_update = debounce((data: any) => {
    const data_hash = JSON.stringify(data ?? {});
    if (data_hash === last_data_hash) return;
    last_data_hash = data_hash;
    post_to_iframe({
      event: "DATA_UPDATED",
      payload: { data: companion ? companionAssetReferences(JSON.parse(data_hash), project_id, preview_capability) : JSON.parse(data_hash) },
    });
  }, 50);

  watch(
    () => store?.project?.data,
    (data) => send_data_update(data),
  );

  let content_fields = $state<any[]>([]);
  let design_fields = $state<any[]>([]);
  let data_collections = $state<string[]>([]);

  // Store hashes for comparison to avoid Svelte proxy issues
  let content_hash = "";
  let design_hash = "";
  let data_collections_hash = "";

  let srcdoc = $state("");
  let pending_config_update = $state(false);
  let compilation_version = 0;

  // Reset state when project_id changes
  watch(
    () => project_id,
    (id, previous) => {
      if (id === previous) return;
      // Reset all state
      iframe_loaded = false;
      compiled_app = null;
      compile_error = null;
      srcdoc = "";
      content_fields = [];
      design_fields = [];
      data_collections = [];
      content_hash = "";
      design_hash = "";
      data_collections_hash = "";
      compilation_version = 0;
      last_data_hash = "";
    },
  );

  // Watch for content/design/data_files changes AND project_id changes
  // Using JSON.stringify ensures we only react to actual value changes, not reference changes
  // Including project_id ensures srcdoc is recreated when project changes
  watch(
    () => store?.project
      ? JSON.stringify({
          project_id, // Include project_id to trigger recreation when it changes
          content: store.content,
          design: store.design,
          data_files: store.data_files
        })
      : null,
    () => {
      if (store?.project && project_id) {
        apply_config_update(
          store.content || [],
          store.design || [],
          store.data_files || []
        );
      }
    },
  );


  function handle_iframe_message(e: MessageEvent) {
    // Only handle messages from our iframe
    if (e.source !== preview_iframe?.contentWindow) return;
    const { event, payload } = e.data || {};
    if (!event) return;

    if (event === "INITIALIZED") {
      iframe_loaded = true;
      last_heartbeat = Date.now();
      if (compiled_app) {
        send_to_iframe();
      }
    } else if (event === "HEARTBEAT") {
      last_heartbeat = Date.now();
    } else if (event === "PRE_MOUNT") {
      // Mount is about to start - set tight timeout
      mounting_in_progress = true;
      mount_started_at = Date.now();
    } else if (event === "MOUNTED") {
      // Component mounted successfully
      mounting_in_progress = false;
    } else if (event === "SET_ERROR") {
      compile_error = payload?.error || "Unknown runtime error";
      error_type = "runtime";
    } else if (event === "BEGIN") {
      compile_error = null;
    }
  }

  function check_for_freeze() {
    const now = Date.now();
    const parent_was_paused = last_freeze_check_at > 0 && now - last_freeze_check_at > HEARTBEAT_TIMEOUT;
    last_freeze_check_at = now;
    // A suspended parent cannot distinguish a frozen iframe from delayed timers.
    // Give the iframe another heartbeat after the parent resumes.
    if (parent_was_paused) {
      last_heartbeat = now;
      if (mounting_in_progress) mount_started_at = now;
      return;
    }
    if (source_tree) return;
    if (!iframe_loaded) return;

    // Embedded browser tabs can remain "visible" when their native host loses
    // focus, while throttling the iframe's timers. Agent handoff must not turn
    // that pause into a permanent runtime error when the user returns.
    if (document.visibilityState === "hidden" || !document.hasFocus()) {
      last_heartbeat = now;
      if (mounting_in_progress) mount_started_at = now;
      return;
    }

    // Skip freeze detection during grace period after code change (e.g., snapshot restore)
    if (last_code_change_at > 0) {
      const grace_elapsed = Date.now() - last_code_change_at;
      if (grace_elapsed < (companion ? 5000 : CODE_CHANGE_GRACE_PERIOD)) {
        return;
      }
    }

    // Check mount timeout first (very tight - 600ms)
    if (mounting_in_progress && mount_started_at > 0) {
      const mount_elapsed = Date.now() - mount_started_at;
      if (mount_elapsed > (companion ? 5000 : MOUNT_TIMEOUT)) {
        trigger_freeze_recovery("Infinite loop detected during component mount. Fix your code and save to retry.");
        return;
      }
    }

    // Check heartbeat timeout (general freeze detection)
    if (last_heartbeat > 0) {
      const elapsed = Date.now() - last_heartbeat;
      if (elapsed > (companion ? 5000 : HEARTBEAT_TIMEOUT)) {
        trigger_freeze_recovery("Infinite loop detected - your code is blocking the main thread. Fix the loop and save to retry.");
        return;
      }
    }
  }

  function trigger_freeze_recovery(message: string) {
    compile_error = message;
    error_type = "runtime";
    freeze_detected = true; // Prevent auto-recompile until code changes
    mounting_in_progress = false;
    mount_started_at = 0;
    // Clear compiled app so it won't auto-resend after reload
    compiled_app = null;
    // Force iframe reload by resetting srcdoc
    const current_srcdoc = srcdoc;
    srcdoc = "";
    iframe_loaded = false;
    last_heartbeat = 0;
    // Restore empty iframe shell
    setTimeout(() => {
      srcdoc = current_srcdoc;
    }, 50);
  }

  // Handle tab visibility changes - reset heartbeat when tab becomes visible
  // This prevents false "infinite loop" detection after tab was in background
  function handle_visibility_change() {
    if (document.visibilityState === "visible") {
      // Reset heartbeat timestamp when tab becomes visible
      // Browser throttles setInterval in background tabs, so heartbeat may be stale
      last_heartbeat = Date.now();
      mounting_in_progress = false;
      mount_started_at = 0;
    }
  }

  onMount(() => {
    is_mounted = true;

    // Listen for messages from iframe via postMessage
    window.addEventListener("message", handle_iframe_message);

    // Listen for tab visibility changes to prevent false freeze detection
    document.addEventListener("visibilitychange", handle_visibility_change);

    // Start heartbeat monitoring for infinite loop detection (check every 400ms for faster response)
    heartbeat_check_interval = setInterval(check_for_freeze, 400);

    return () => {
      is_mounted = false;
      compilation_version++;
      window.removeEventListener("message", handle_iframe_message);
      document.removeEventListener("visibilitychange", handle_visibility_change);
      send_data_update.cancel();
      debounced_compile.cancel();
      clearTimeout(compile_timeout);
      if (heartbeat_check_interval) {
        clearInterval(heartbeat_check_interval);
        heartbeat_check_interval = null;
      }
    };
  });


  // Unified update logic (shared by store and manual loading)
  async function apply_config_update(
    new_content: any[],
    new_design: any[],
    new_data_collections: string[],
  ) {
    // Check if fields actually changed using hash comparison (avoids Svelte proxy issues)
    const new_content_hash = JSON.stringify(new_content);
    const new_design_hash = JSON.stringify(new_design);
    const new_data_hash = JSON.stringify(new_data_collections);

    const content_changed = new_content_hash !== content_hash;
    const design_changed = new_design_hash !== design_hash;
    const data_changed = new_data_hash !== data_collections_hash;

    // No srcdoc yet or data collections changed - need full reload
    if (!srcdoc || data_changed) {
      if (is_processing) {
        pending_config_update = true;
      } else {
        content_fields = new_content;
        design_fields = new_design;
        data_collections = new_data_collections;
        content_hash = new_content_hash;
        design_hash = new_design_hash;
        data_collections_hash = new_data_hash;

        srcdoc = dynamic_iframe_srcdoc("", {
          content: content_fields,
          design: design_fields,
          project_id,
          data_collections,
          preview_capability: companion ? preview_capability : '',
        });
        if (companion) srcdoc = isolateCompanionPreview(srcdoc, project_id, preview_capability);

        if (!active_code) return;
        compile_component();
      }
      return;
    }

    // Content changes: update global and remount (no full reload)
    if (content_changed) {
      content_fields = new_content;
      content_hash = new_content_hash;
      post_to_iframe({
        event: "UPDATE_CONTENT",
        payload: { content: companion ? companionAssetReferences(transform_content_fields(new_content, project_id), project_id, preview_capability) : transform_content_fields(new_content, project_id) },
      });
    }

    // Design changes: inject CSS (no reload needed)
    if (design_changed) {
      design_fields = new_design;
      design_hash = new_design_hash;
      post_to_iframe({
        event: "UPDATE_CSS_VARS",
        payload: { css: generate_design_css(new_design) },
      });
      const fonts = extract_web_fonts(new_design);
      if (fonts.length > 0) {
        post_to_iframe({
          event: "UPDATE_FONTS",
          payload: { fonts },
        });
      }
    }
  }

  async function compile_component() {
    if (source_tree) return;
    // Don't compile if we just detected a freeze (user must edit code first)
    if (freeze_detected) return;

    const my_version = ++compilation_version;
    const report = { revision: source_revision, attempt: on_compile ? crypto.randomUUID() : '' };
    on_compile?.({ ...report, state: 'pending' });

    is_compiling = true;
    compile_error = null;
    error_type = "compile";
    clearTimeout(compile_timeout);
    compile_timeout = setTimeout(() => {
      if (my_version !== compilation_version || !is_compiling) return;
      compile_error = `Still compiling after ${COMPILE_TIMEOUT / 1000} seconds. The compiler may have stopped responding. Retry starts a fresh compiler.`;
      error_type = "timeout";
      // If the compile finishes later, its success report replaces this one.
      on_compile?.({ ...report, state: 'error', error: compile_error });
    }, COMPILE_TIMEOUT);

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
      console.error("[Preview] Compilation error:", err);
      // Check if this is a worker initialization error
      const err_msg = err instanceof Error ? err.message : String(err);
      if (err_msg.includes("worker") || err_msg.includes("Worker")) {
        compile_error = "Failed to initialize compiler. Try refreshing the page.";
      } else {
        compile_error = err_msg;
      }
      error_type = "compile";
      compiled_app = null;
    } finally {
      // Only update UI state if this is still the current compilation
      if (my_version === compilation_version) {
        clearTimeout(compile_timeout);
        is_compiling = false;
        on_compile?.({ ...report, state: compile_error ? 'error' : 'success', ...(compile_error ? { error: compile_error } : {}) });
      }
    }
  }

  function retry_compile() {
    // The stuck compile may hold a hung worker; replace the workers before retrying.
    reset_compiler_workers();
    compile_error = null;
    compile_component();
  }

  function send_to_iframe() {
    if (!compiled_app) return;
    // Send project data to pre-populate collections before mount
    // Clone to avoid DataCloneError from Svelte 5 reactive proxies
    const project_data = cloneDeep(store?.project?.data || {});
    post_to_iframe({
      event: "SET_APP",
      payload: {
        componentApp: companion ? companionAssetReferences(compiled_app, project_id, preview_capability) : compiled_app,
        content: companion ? companionAssetReferences(transform_content_fields(content_fields, project_id), project_id, preview_capability) : transform_content_fields(content_fields, project_id),
        data: companion ? companionAssetReferences(project_data, project_id, preview_capability) : project_data,
      },
    });
  }

</script>

<div
  class="preview-container"
  class:is-building={is_building}
  style="view-transition-name: preview-{project_id}"
>
  {#if is_building}
    <div class="building-border"></div>
  {/if}
  {#if compile_error}
    <div class="error-banner">
      <div class="error-banner-content">
        <span class="error-icon">⚠</span>
        <div class="error-text">
          <div class="error-title">
            {error_type === "compile" ? "Compilation Failed" : error_type === "timeout" ? "Preview didn't finish compiling" : "Runtime Error"}
          </div>
          <div class="error-message">{compile_error}</div>
        </div>
      </div>
      {#if error_type === "timeout"}<button class="fix-button" onclick={retry_compile}>
        <RotateCcw class="w-3" />
        Retry
      </button>{:else if !companion}<button
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
      </button>{/if}
    </div>
  {/if}
  {#if source_tree}
    <iframe title="Published app"
      src={`/tinykit/preview/${project_id}?v=${encodeURIComponent(store.project.published_html || '')}`}
      sandbox={companion ? "allow-scripts allow-forms allow-modals allow-popups allow-downloads" : "allow-scripts allow-forms allow-modals allow-popups allow-same-origin allow-downloads"}
      class="preview-iframe"></iframe>
  {:else if srcdoc}
    <iframe
      bind:this={preview_iframe}
      title="Preview"
      {srcdoc}
      sandbox={companion ? "allow-scripts allow-forms allow-modals allow-popups allow-downloads" : "allow-scripts allow-forms allow-modals allow-popups allow-same-origin allow-downloads"}
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
