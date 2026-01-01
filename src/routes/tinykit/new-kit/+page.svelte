<script lang="ts">
  import { goto } from "$app/navigation";
  import { ArrowLeft, Loader2, Package, Pencil, Check, X, Eye } from "lucide-svelte";
  import Icon from "@iconify/svelte";
  import { get_saved_theme, apply_builder_theme } from "$lib/builder_themes";
  import { onMount } from "svelte";
  import { project_service } from "$lib/services/project.svelte";
  import { kit_service } from "$lib/services/kit.svelte";
  import { auth, pb } from "$lib/pocketbase.svelte";
  import { get_featured_kits_with_templates, type KitWithTemplates, type Template } from "$lib/templates";
  import { processCode, dynamic_iframe_srcdoc, generate_design_css } from "$lib/compiler/init";
  import { build_app } from "../lib/api.svelte";

  const kits = get_featured_kits_with_templates();
  let is_creating = $state(false);
  let error_message = $state("");
  let show_custom_name_dialog = $state(false);
  let custom_kit_name = $state("");
  let custom_name_input: HTMLInputElement;

  // Kit customization state
  let selected_kit = $state<KitWithTemplates | null>(null);
  let selected_templates = $state<Set<string>>(new Set());

  // Template preview state
  let previewing_template = $state<Template | null>(null);
  let preview_iframe = $state<HTMLIFrameElement | null>(null);
  let preview_srcdoc = $state("");
  let preview_compiled = $state<string | null>(null);
  let preview_error = $state<string | null>(null);
  let is_compiling_preview = $state(false);

  onMount(() => {
    const theme = get_saved_theme();
    apply_builder_theme(theme);
  });

  async function open_preview(template: Template, e: MouseEvent) {
    e.stopPropagation();
    previewing_template = template;
    preview_error = null;
    preview_compiled = null;
    is_compiling_preview = true;

    // Generate srcdoc with template's design/content
    preview_srcdoc = dynamic_iframe_srcdoc("", {
      content: template.content || [],
      design: template.design || [],
      project_id: "preview",
      data_collections: template.data ? Object.keys(template.data) : []
    });

    // Compile the template code
    try {
      const result = await processCode({
        component: template.frontend_code,
        buildStatic: false,
        dev_mode: true,
        sourcemap: false,
        runtime: ["mount", "unmount"]
      });

      if (result.error) {
        preview_error = result.error;
      } else {
        preview_compiled = result.js;
      }
    } catch (err) {
      preview_error = err instanceof Error ? err.message : String(err);
    } finally {
      is_compiling_preview = false;
    }
  }

  function close_preview() {
    previewing_template = null;
    preview_srcdoc = "";
    preview_compiled = null;
    preview_error = null;
  }

  function handle_preview_iframe_load() {
    if (!preview_iframe?.contentWindow || !preview_compiled) return;

    // Clone data to ensure it's postMessage-safe (avoids DataCloneError from Svelte 5 proxies)
    const template_data = previewing_template?.data
      ? JSON.parse(JSON.stringify(previewing_template.data))
      : {};

    preview_iframe.contentWindow.postMessage({
      event: "SET_APP",
      payload: {
        componentApp: preview_compiled,
        data: template_data
      }
    }, "*");

    // Also send initial data
    preview_iframe.contentWindow.postMessage({
      event: "DATA_UPDATED",
      payload: { data: template_data }
    }, "*");
  }

  $effect(() => {
    if (preview_iframe && preview_compiled && preview_srcdoc) {
      // Wait for iframe to initialize, then send the app
      const handler = (e: MessageEvent) => {
        if (e.source !== preview_iframe?.contentWindow) return;
        if (e.data?.event === "INITIALIZED") {
          handle_preview_iframe_load();
        }
      };
      window.addEventListener("message", handler);
      return () => window.removeEventListener("message", handler);
    }
  });

  function select_kit(kit: KitWithTemplates) {
    selected_kit = kit;
    // Select all templates by default
    selected_templates = new Set(kit.templates.map(t => t.id));
    error_message = "";
  }

  function toggle_template(template_id: string) {
    const next = new Set(selected_templates);
    if (next.has(template_id)) {
      next.delete(template_id);
    } else {
      next.add(template_id);
    }
    selected_templates = next;
  }

  function select_all() {
    if (selected_kit) {
      selected_templates = new Set(selected_kit.templates.map(t => t.id));
    }
  }

  function select_none() {
    selected_templates = new Set();
  }

  function close_customizer() {
    selected_kit = null;
    selected_templates = new Set();
  }

  async function create_kit() {
    if (!selected_kit || selected_templates.size === 0) return;

    is_creating = true;
    error_message = "";

    if (!auth.is_authenticated || !pb.authStore.isValid) {
      error_message = "Session expired. Please log in again.";
      is_creating = false;
      setTimeout(() => goto("/login"), 1500);
      return;
    }

    try {
      // Create kit record in the database
      const kit = await kit_service.create({
        name: selected_kit.name,
        icon: selected_kit.icon
      });

      // Filter to only selected templates
      const templates_to_create = selected_kit.templates.filter(t =>
        selected_templates.has(t.id)
      );

      // Batch create selected templates
      const created_projects = await project_service.batch_create_kit(kit.id, templates_to_create);

      // Build all projects in parallel for preview thumbnails
      console.log(`Building ${created_projects.length} projects...`);
      const build_results = await Promise.all(
        created_projects.map(p =>
          build_app(p.id)
            .then(res => {
              console.log(`Built ${p.name}:`, res);
              return { success: true, project: p.name };
            })
            .catch(err => {
              console.error(`Failed to build ${p.name}:`, err);
              return { success: false, project: p.name, error: err };
            })
        )
      );
      console.log('Build results:', build_results);

      // Redirect to dashboard with this kit selected
      goto(`/tinykit?kit=${kit.id}`);
    } catch (err: any) {
      console.error("Failed to create kit:", err);
      const detail =
        err?.data?.message ||
        err?.response?.message ||
        err?.message ||
        "Unknown error";
      error_message = `Failed to create kit: ${detail}`;
      is_creating = false;
    }
  }

  function start_custom_kit() {
    show_custom_name_dialog = true;
    custom_kit_name = "";
    // Focus input after dialog opens
    setTimeout(() => custom_name_input?.focus(), 100);
  }

  async function create_custom_kit() {
    if (!custom_kit_name.trim()) {
      error_message = "Please enter a name for your kit";
      return;
    }

    is_creating = true;
    error_message = "";

    if (!auth.is_authenticated || !pb.authStore.isValid) {
      error_message = "Session expired. Please log in again.";
      is_creating = false;
      setTimeout(() => goto("/login"), 1500);
      return;
    }

    try {
      // Create kit record in the database
      const kit = await kit_service.create({
        name: custom_kit_name.trim(),
        icon: "mdi:folder-outline"
      });

      // Redirect to /new with the kit ID to add first app
      goto(`/tinykit/new?kit=${kit.id}`);
    } catch (err: any) {
      console.error("Failed to create custom kit:", err);
      const detail =
        err?.data?.message ||
        err?.response?.message ||
        err?.message ||
        "Unknown error";
      error_message = `Failed to create kit: ${detail}`;
      is_creating = false;
    }
  }

  function handle_custom_keydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      create_custom_kit();
    } else if (e.key === "Escape") {
      show_custom_name_dialog = false;
    }
  }
</script>

<svelte:head>
  <title>New Kit - tinykit</title>
</svelte:head>

<div
  class="min-h-screen bg-[var(--builder-bg-primary)] flex flex-col safe-area-top"
>
  <!-- Header -->
  <header class="border-b border-[var(--builder-border)] px-6 py-4">
    <a
      href="/tinykit"
      class="inline-flex items-center gap-2 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
    >
      <ArrowLeft class="w-4 h-4" />
      <span class="text-sm">Back to projects</span>
    </a>
  </header>

  <!-- Main content -->
  <main class="flex-1 flex flex-col overflow-hidden">
    <!-- Title section -->
    <div class="px-6 pt-12 pb-8 text-center">
      <h1 class="text-4xl font-semibold text-[var(--builder-text-primary)] mb-4">
        Choose a kit
      </h1>
      <p class="text-[var(--builder-text-muted)]">
        Kits bundle related apps together. Pick one to get started.
      </p>
    </div>

    <!-- Error message -->
    {#if error_message}
      <div class="px-6 mb-4">
        <div
          class="max-w-xl mx-auto p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm"
        >
          {error_message}
        </div>
      </div>
    {/if}


    <!-- Kit options - grid layout -->
    <div class="flex-1 overflow-y-auto px-6 pb-12">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-w-6xl mx-auto">
        {#each kits as kit (kit.id)}
          <button
            onclick={() => select_kit(kit)}
            disabled={is_creating || show_custom_name_dialog || selected_kit !== null}
            class="flex flex-col p-5 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-xl hover:border-[var(--builder-accent)] hover:bg-[var(--builder-bg-tertiary)] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left group"
          >
            <!-- Header row: icon + name -->
            <div class="flex items-center gap-3 mb-3">
              <div
                class="w-10 h-10 rounded-lg bg-[var(--builder-accent)]/10 flex items-center justify-center flex-shrink-0"
              >
                <Icon
                  icon={kit.icon}
                  class="w-6 h-6 text-[var(--builder-accent)]"
                />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <h2
                    class="font-semibold text-[var(--builder-text-primary)] group-hover:text-[var(--builder-accent)] transition-colors"
                  >
                    {kit.name}
                  </h2>
                  <span
                    class="text-xs text-[var(--builder-text-muted)] bg-[var(--builder-bg-tertiary)] px-1.5 py-0.5 rounded"
                  >
                    {kit.templates.length}
                  </span>
                </div>
                <p class="text-xs text-[var(--builder-text-muted)]">
                  {kit.tagline}
                </p>
              </div>
            </div>

            <!-- Template list -->
            <div class="flex flex-wrap gap-1.5">
              {#each kit.templates as template (template.id)}
                <span
                  class="text-xs text-[var(--builder-text-secondary)] bg-[var(--builder-bg-primary)] px-2 py-1 rounded"
                >
                  {template.name}
                </span>
              {/each}
            </div>
          </button>
        {/each}

        <!-- Custom kit option -->
        <button
          onclick={start_custom_kit}
          disabled={is_creating || show_custom_name_dialog || selected_kit !== null}
          class="flex flex-col p-5 bg-[var(--builder-bg-secondary)] border border-dashed border-[var(--builder-border)] rounded-xl hover:border-[var(--builder-accent)] hover:bg-[var(--builder-bg-tertiary)] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left group"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-lg bg-[var(--builder-bg-tertiary)] flex items-center justify-center flex-shrink-0"
            >
              <Pencil
                class="w-5 h-5 text-[var(--builder-text-muted)] group-hover:text-[var(--builder-accent)] transition-colors"
              />
            </div>
            <div>
              <h2
                class="font-semibold text-[var(--builder-text-primary)] group-hover:text-[var(--builder-accent)] transition-colors"
              >
                Custom kit
              </h2>
              <p class="text-xs text-[var(--builder-text-muted)]">
                Start from scratch
              </p>
            </div>
          </div>
        </button>
      </div>
    </div>
  </main>

  <!-- Kit customization modal -->
  {#if selected_kit}
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6"
      onclick={(e) => e.target === e.currentTarget && close_customizer()}
      onkeydown={(e) => e.key === "Escape" && close_customizer()}
      role="dialog"
      tabindex="-1"
    >
      <div
        class="bg-[var(--builder-bg-primary)] border border-[var(--builder-border)] rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
      >
        <!-- Header -->
        <div class="flex items-center gap-4 p-6 border-b border-[var(--builder-border)]">
          <div
            class="w-12 h-12 rounded-xl bg-[var(--builder-accent)]/10 flex items-center justify-center flex-shrink-0"
          >
            <Icon
              icon={selected_kit.icon}
              class="w-7 h-7 text-[var(--builder-accent)]"
            />
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="text-xl font-semibold text-[var(--builder-text-primary)]">
              {selected_kit.name}
            </h2>
            <p class="text-sm text-[var(--builder-text-muted)]">
              {selected_kit.tagline}
            </p>
          </div>
          <button
            onclick={close_customizer}
            class="p-2 text-[var(--builder-text-muted)] hover:text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)] rounded-lg transition-colors"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <!-- Template selection -->
        <div class="flex-1 overflow-y-auto p-6">
          <div class="flex items-center justify-between mb-4">
            <p class="text-sm text-[var(--builder-text-secondary)]">
              {selected_templates.size} of {selected_kit.templates.length} selected
            </p>
            <div class="flex gap-2">
              <button
                onclick={select_all}
                class="text-xs text-[var(--builder-text-muted)] hover:text-[var(--builder-text-primary)] transition-colors"
              >
                All
              </button>
              <span class="text-[var(--builder-text-muted)]">·</span>
              <button
                onclick={select_none}
                class="text-xs text-[var(--builder-text-muted)] hover:text-[var(--builder-text-primary)] transition-colors"
              >
                None
              </button>
            </div>
          </div>

          <div class="space-y-2">
            {#each selected_kit.templates as template (template.id)}
              <div
                class="flex items-center gap-2 p-3 rounded-lg border transition-all {selected_templates.has(template.id)
                  ? 'bg-[var(--builder-accent)]/10 border-[var(--builder-accent)]/30'
                  : 'bg-[var(--builder-bg-secondary)] border-[var(--builder-border)]'}"
              >
                <button
                  onclick={() => toggle_template(template.id)}
                  class="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <div
                    class="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors {selected_templates.has(template.id)
                      ? 'bg-[var(--builder-accent)] border-[var(--builder-accent)]'
                      : 'border-[var(--builder-text-muted)]'}"
                  >
                    {#if selected_templates.has(template.id)}
                      <Check class="w-3 h-3 text-white" />
                    {/if}
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="font-medium text-[var(--builder-text-primary)]">
                      {template.name}
                    </p>
                    <p class="text-xs text-[var(--builder-text-muted)] truncate">
                      {template.description}
                    </p>
                  </div>
                </button>
                <button
                  onclick={(e) => open_preview(template, e)}
                  class="p-2 text-[var(--builder-text-muted)] hover:text-[var(--builder-accent)] hover:bg-[var(--builder-bg-tertiary)] rounded-lg transition-colors flex-shrink-0"
                  title="Preview {template.name}"
                >
                  <Eye class="w-4 h-4" />
                </button>
              </div>
            {/each}
          </div>
        </div>

        <!-- Footer -->
        <div class="p-6 border-t border-[var(--builder-border)] flex gap-3">
          {#if error_message}
            <p class="flex-1 text-sm text-red-400">{error_message}</p>
          {:else}
            <div class="flex-1"></div>
          {/if}
          <button
            onclick={close_customizer}
            disabled={is_creating}
            class="px-4 py-2 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onclick={create_kit}
            disabled={is_creating || selected_templates.size === 0}
            class="px-5 py-2 rounded-lg bg-[var(--builder-accent)] text-[var(--builder-accent-text)] hover:bg-[var(--builder-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {#if is_creating}
              <Loader2 class="w-4 h-4 animate-spin" />
              Creating...
            {:else}
              Create kit
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Custom kit modal -->
  {#if show_custom_name_dialog}
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6"
      onclick={(e) => e.target === e.currentTarget && (show_custom_name_dialog = false)}
      onkeydown={(e) => e.key === "Escape" && (show_custom_name_dialog = false)}
      role="dialog"
      tabindex="-1"
    >
      <div
        class="bg-[var(--builder-bg-primary)] border border-[var(--builder-border)] rounded-2xl w-full max-w-md shadow-2xl"
      >
        <!-- Header -->
        <div class="flex items-center gap-4 p-6 border-b border-[var(--builder-border)]">
          <div
            class="w-12 h-12 rounded-xl bg-[var(--builder-bg-tertiary)] flex items-center justify-center flex-shrink-0"
          >
            <Pencil class="w-6 h-6 text-[var(--builder-text-muted)]" />
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="text-xl font-semibold text-[var(--builder-text-primary)]">
              Custom kit
            </h2>
            <p class="text-sm text-[var(--builder-text-muted)]">
              Start from scratch
            </p>
          </div>
          <button
            onclick={() => (show_custom_name_dialog = false)}
            class="p-2 text-[var(--builder-text-muted)] hover:text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)] rounded-lg transition-colors"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <!-- Form -->
        <div class="p-6">
          <label class="block text-sm text-[var(--builder-text-secondary)] mb-2">
            Kit name
          </label>
          <input
            bind:this={custom_name_input}
            bind:value={custom_kit_name}
            onkeydown={handle_custom_keydown}
            disabled={is_creating}
            placeholder="My Kit"
            class="w-full px-4 py-3 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] placeholder:text-[var(--builder-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--builder-accent)] focus:border-transparent disabled:opacity-50"
          />
          {#if error_message}
            <p class="mt-2 text-sm text-red-400">{error_message}</p>
          {/if}
        </div>

        <!-- Footer -->
        <div class="p-6 border-t border-[var(--builder-border)] flex justify-end gap-3">
          <button
            onclick={() => (show_custom_name_dialog = false)}
            disabled={is_creating}
            class="px-4 py-2 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onclick={create_custom_kit}
            disabled={!custom_kit_name.trim() || is_creating}
            class="px-5 py-2 rounded-lg bg-[var(--builder-accent)] text-[var(--builder-accent-text)] hover:bg-[var(--builder-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {#if is_creating}
              <Loader2 class="w-4 h-4 animate-spin" />
              Creating...
            {:else}
              Create kit
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Template preview modal -->
  {#if previewing_template}
    <div
      class="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4 sm:p-8"
      onclick={(e) => e.target === e.currentTarget && close_preview()}
      onkeydown={(e) => e.key === "Escape" && close_preview()}
      role="dialog"
      tabindex="-1"
    >
      <div
        class="bg-[var(--builder-bg-primary)] border border-[var(--builder-border)] rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--builder-border)] flex-shrink-0">
          <div>
            <h2 class="text-lg font-semibold text-[var(--builder-text-primary)]">
              {previewing_template.name}
            </h2>
            <p class="text-sm text-[var(--builder-text-muted)]">
              {previewing_template.description}
            </p>
          </div>
          <button
            onclick={close_preview}
            class="p-2 text-[var(--builder-text-muted)] hover:text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)] rounded-lg transition-colors"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <!-- Preview area -->
        <div class="flex-1 bg-white relative overflow-hidden">
          {#if is_compiling_preview}
            <div class="absolute inset-0 flex items-center justify-center bg-[var(--builder-bg-secondary)]">
              <div class="flex flex-col items-center gap-3 text-[var(--builder-text-muted)]">
                <Loader2 class="w-8 h-8 animate-spin" />
                <span class="text-sm">Compiling preview...</span>
              </div>
            </div>
          {:else if preview_error}
            <div class="absolute inset-0 flex items-center justify-center bg-[var(--builder-bg-secondary)] p-6">
              <div class="text-center max-w-md">
                <div class="text-red-400 text-lg mb-2">Preview Error</div>
                <p class="text-sm text-[var(--builder-text-muted)] font-mono">{preview_error}</p>
              </div>
            </div>
          {:else if preview_srcdoc}
            <iframe
              bind:this={preview_iframe}
              title="Template Preview"
              srcdoc={preview_srcdoc}
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
              class="w-full h-full border-none"
            ></iframe>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
