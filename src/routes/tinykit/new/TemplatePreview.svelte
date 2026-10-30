<script lang="ts">
  import { onMount } from "svelte";
  import { processCode, dynamic_iframe_srcdoc } from "$lib/compiler/init";
  import { get_template_preview_data, type Template } from "$lib/templates";

  let { template }: { template: Template } = $props();
  let preview_iframe = $state<HTMLIFrameElement | null>(null);
  let iframe_loaded = false;
  let compiled_app: string | null = null;
  let compile_error = $state<string | null>(null);
  let is_compiling = $state(true);

  function send_to_iframe() {
    if (!iframe_loaded || !compiled_app || !preview_iframe?.contentWindow)
      return;
    preview_iframe.contentWindow.postMessage(
      {
        event: "SET_APP",
        payload: {
          componentApp: compiled_app,
          data: get_template_preview_data(template),
        },
      },
      "*",
    );
  }

  function handle_message(event: MessageEvent) {
    if (event.source !== preview_iframe?.contentWindow) return;
    if (event.data?.event === "INITIALIZED") {
      iframe_loaded = true;
      send_to_iframe();
    } else if (
      event.data?.event === "SET_ERROR" ||
      event.data?.event === "RUNTIME_ERROR"
    ) {
      compile_error =
        event.data.payload?.error ||
        event.data.payload?.message ||
        "Preview could not be loaded.";
    }
  }

  onMount(() => {
    let disposed = false;
    window.addEventListener("message", handle_message);
    processCode({
      component: template.frontend_code,
      buildStatic: false,
      dev_mode: false,
      sourcemap: false,
      runtime: ["mount", "unmount"],
    })
      .then((result) => {
        if (disposed) return;
        if (result.error) compile_error = result.error;
        else {
          compiled_app = result.js;
          send_to_iframe();
        }
      })
      .catch((error) => {
        if (!disposed)
          compile_error =
            error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        if (!disposed) is_compiling = false;
      });
    return () => {
      disposed = true;
      window.removeEventListener("message", handle_message);
    };
  });

  const iframe_srcdoc = dynamic_iframe_srcdoc("", {
    content: template.content || [],
    design: template.design || [],
    project_id: "template-preview",
    local_data: true,
    data_collections: Object.keys(template.data || {}),
  });
</script>

<div class="preview">
  <iframe
    bind:this={preview_iframe}
    srcdoc={iframe_srcdoc}
    sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin allow-downloads"
    title="Preview of {template.name}"
  ></iframe>
  {#if compile_error}<div class="message" role="alert">
      <p>Preview unavailable</p>
      <pre>{compile_error}</pre>
    </div>
  {:else if is_compiling}<div class="message" role="status">
      Loading preview…
    </div>{/if}
</div>

<style>
  .preview {
    height: 100%;
    position: relative;
    background: white;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
  .message {
    position: absolute;
    inset: 0;
    padding: 24px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: var(--builder-bg-primary);
    color: var(--builder-text-secondary);
    font-size: 13px;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-width: 600px;
    font-size: 12px;
    margin-top: 12px;
  }
</style>
