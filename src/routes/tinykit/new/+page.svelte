<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { ArrowLeft, Sparkles, Loader2, Upload, Settings } from "lucide-svelte";
  import Icon from "@iconify/svelte";
  import { get_saved_theme, apply_builder_theme } from "$lib/builder_themes";
  import { onMount } from "svelte";
  import { project_service } from "$lib/services/project.svelte";
  import { kit_service } from "$lib/services/kit.svelte";
  import { auth, pb } from "$lib/pocketbase.svelte";
  import {
    KITS,
    TEMPLATES,
    type Template,
  } from "$lib/templates";

  type TemplateArchetype = 'app' | 'form' | 'dashboard' | 'site';
  import type { Kit } from "../types";

  let { data } = $props();

  // Domain is set only when creating an app from the domain connection flow.
  let domain = $derived(data.domain || "");

  let prompt = $state("");
  let is_creating = $state(false);
  let error_message = $state("");
  let textarea_el: HTMLTextAreaElement;
  let file_input: HTMLInputElement;

  // LLM configuration status
  let llm_configured = $state<boolean | null>(null); // null = loading

  // Get kit from URL params
  let kit_id = $derived($page.url.searchParams.get("kit"));
  let kit_record = $state<Kit | null>(null);

  // Find kit definition if it's a predefined kit
  let kit_def = $derived(KITS.find((k) => k.id === kit_id));

  // Get kit name and icon - prefer kit_record, then kit_def, then fallback
  let kit_name = $derived(kit_record?.name || kit_def?.name || kit_id || "kit");
  let kit_icon = $derived(
    kit_record?.icon || kit_def?.icon || "mdi:folder-outline"
  );

  // Show all templates - user can add any template to any kit
  let kit_templates_all = $derived(kit_id ? TEMPLATES : []);

  // Filter templates by archetype
  let selected_archetype = $state<TemplateArchetype | "all">("all");

  let kit_templates = $derived(
    selected_archetype === "all"
      ? kit_templates_all
      : kit_templates_all.filter((t) => t.archetype === selected_archetype)
  );

  const all_archetypes: { id: TemplateArchetype | "all"; label: string }[] = [
    { id: "all", label: "All" },
    { id: "app", label: "Apps" },
    { id: "form", label: "Forms" },
    { id: "dashboard", label: "Dashboards" },
    { id: "site", label: "Sites" },
  ];

  // Only show archetype tabs that have templates in this kit
  let archetypes = $derived(
    all_archetypes.filter(a =>
      a.id === "all" || kit_templates_all.some(t => t.archetype === a.id)
    )
  );

  onMount(async () => {
    const theme = get_saved_theme();
    apply_builder_theme(theme);

    // Redirect to new-kit if no kit param
    if (!kit_id) {
      goto("/tinykit/new-kit");
      return;
    }

    // Try to load kit record from database
    if (kit_id && !kit_def) {
      kit_record = await kit_service.get(kit_id);
    }

    // Check LLM configuration status
    try {
      const res = await fetch("/api/settings/llm-status", {
        headers: { Authorization: `Bearer ${pb.authStore.token}` }
      });
      if (res.ok) {
        const data = await res.json();
        llm_configured = data.configured ?? false;
      } else {
        llm_configured = false;
      }
    } catch {
      llm_configured = false;
    }

    if (llm_configured) {
      textarea_el?.focus();
    }
  });

  async function create_from_prompt() {
    if (!prompt.trim() || !kit_id) return;

    is_creating = true;
    error_message = "";

    if (!auth.is_authenticated || !pb.authStore.isValid) {
      error_message = "Session expired. Please log in again.";
      is_creating = false;
      setTimeout(() => goto("/login"), 1500);
      return;
    }

    try {
      const project = await project_service.create({
        name: "",
        kit: kit_id,
        domain: domain || undefined,
        initial_prompt: prompt,
      });

      if (!project?.id) {
        throw new Error("Project creation returned invalid response");
      }

      if (prompt.trim()) {
        sessionStorage.setItem(
          `tinykit:initial_prompt:${project.id}`,
          prompt.trim()
        );
      }

      goto(`/tinykit/studio?id=${project.id}`);
    } catch (err: any) {
      console.error("Failed to create project:", err);
      const detail =
        err?.data?.message ||
        err?.response?.message ||
        err?.message ||
        "Unknown error";
      error_message = `Failed to create project: ${detail}`;
      is_creating = false;
    }
  }

  async function create_from_template(template_id: string) {
    if (!kit_id) return;

    is_creating = true;
    error_message = "";

    if (!auth.is_authenticated || !pb.authStore.isValid) {
      error_message = "Session expired. Please log in again.";
      is_creating = false;
      setTimeout(() => goto("/login"), 1500);
      return;
    }

    try {
      const template = TEMPLATES.find((t) => t.id === template_id);
      if (!template) {
        error_message = "Template not found";
        is_creating = false;
        return;
      }

      const project = await project_service.create({
        name: template.name,
        kit: kit_id,
        domain: domain || undefined,
        frontend_code: template.frontend_code || "",
        design: template.design || [],
        content: template.content || [],
        data: template.data || {},
      });

      if (!project?.id) {
        throw new Error("Project creation returned invalid response");
      }

      goto(`/tinykit/studio?id=${project.id}`);
    } catch (err: any) {
      console.error("Failed to create project:", err);
      const detail =
        err?.data?.message ||
        err?.response?.message ||
        err?.message ||
        "Unknown error";
      error_message = `Failed to create project: ${detail}`;
      is_creating = false;
    }
  }

  function handle_keydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      create_from_prompt();
    }
  }

  function trigger_file_upload() {
    file_input?.click();
  }

  async function handle_snapshot_upload(event: Event) {
    if (!kit_id) return;

    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    is_creating = true;
    error_message = "";

    if (!auth.is_authenticated || !pb.authStore.isValid) {
      error_message = "Session expired. Please log in again.";
      is_creating = false;
      setTimeout(() => goto("/login"), 1500);
      return;
    }

    try {
      const text = await file.text();
      const snapshot_data = JSON.parse(text);

      if (
        !snapshot_data.frontend_code &&
        !snapshot_data.design &&
        !snapshot_data.content
      ) {
        error_message = "Invalid snapshot file: missing required data";
        is_creating = false;
        input.value = "";
        return;
      }

      const filename = file.name.replace(/\.json$/, "");
      const project_name =
        snapshot_data.description ||
        filename.replace(/^snapshot-\d{4}-\d{2}-\d{2}-/, "") ||
        "Restored Project";

      const data: Record<string, any> = {};
      if (
        snapshot_data.collections &&
        Array.isArray(snapshot_data.collections)
      ) {
        for (const col of snapshot_data.collections) {
          data[col.name] = {
            schema: col.schema || [],
            records: col.records || [],
          };
        }
      }

      const project = await project_service.create({
        name: project_name,
        kit: kit_id,
        domain: domain || undefined,
        frontend_code: snapshot_data.frontend_code || "",
        design: snapshot_data.design || [],
        content: snapshot_data.content || [],
        data,
      });

      goto(`/tinykit/studio?id=${project.id}`);
    } catch (err: any) {
      const detail =
        err?.data?.message ||
        err?.response?.message ||
        err?.message ||
        "Unknown error";
      error_message = `Failed to restore from snapshot: ${detail}`;
      is_creating = false;
      input.value = "";
    }
  }

  function get_back_href() {
    return `/tinykit?kit=${kit_id}`;
  }
</script>

<svelte:head>
  <title>New App - tinykit</title>
</svelte:head>

<div
  class="min-h-screen bg-[var(--builder-bg-primary)] flex flex-col safe-area-top"
>
  <!-- Header -->
  <header class="border-b border-[var(--builder-border)] px-6 py-4">
    <a
      href={get_back_href()}
      class="inline-flex items-center gap-2 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
    >
      <ArrowLeft class="w-4 h-4" />
      <span class="text-sm">Back to {kit_name || "projects"}</span>
    </a>
  </header>

  <!-- Main content -->
  <main
    class="flex-1 flex flex-col items-center px-6 py-12 max-w-3xl mx-auto w-full overflow-y-auto"
  >
    <!-- Title with kit badge -->
    <div class="flex items-center gap-3 mb-4">
      <Icon icon={kit_icon} class="w-8 h-8 text-[var(--builder-accent)]" />
      <h1
        class="text-4xl font-semibold text-[var(--builder-text-primary)] text-center"
      >
        Add to {kit_name}
      </h1>
    </div>
    <p class="text-[var(--builder-text-muted)] mb-8 text-center">
      Describe your app or pick a template
    </p>

    <!-- Error message -->
    {#if error_message}
      <div
        class="w-full mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm"
      >
        {error_message}
      </div>
    {/if}

    <!-- AI Generation section -->
    {#if llm_configured === false}
      <!-- LLM not configured - show settings prompt -->
      <div
        class="w-full bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg p-6 mb-8"
      >
        <div class="flex flex-col items-center gap-3 text-center">
          <div class="p-3 rounded-full bg-[var(--builder-bg-tertiary)]">
            <Sparkles class="w-6 h-6 text-[var(--builder-text-muted)]" />
          </div>
          <p class="text-[var(--builder-text-secondary)] text-sm">
            AI generation requires an LLM API key
          </p>
          <a
            href="/tinykit/settings"
            class="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--builder-accent)] text-[var(--builder-accent-text)] hover:bg-[var(--builder-accent-hover)] transition-colors text-sm font-medium"
          >
            <Settings class="w-4 h-4" />
            Configure LLM
          </a>
        </div>
      </div>
    {:else}
      <!-- LLM configured or loading - show prompt input -->
      <div
        class="w-full bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg focus-within:ring-2 focus-within:ring-[var(--builder-accent)] focus-within:border-transparent mb-8"
        class:opacity-50={llm_configured === null}
      >
        <div class="relative">
          <textarea
            bind:this={textarea_el}
            bind:value={prompt}
            onkeydown={handle_keydown}
            disabled={is_creating || llm_configured === null}
            placeholder="Describe your app..."
            rows="3"
            class="w-full px-4 pt-4 pb-2 bg-transparent text-[var(--builder-text-primary)] placeholder:text-[var(--builder-text-muted)] resize-none focus:outline-none disabled:opacity-50 max-h-48 overflow-y-auto"
          ></textarea>
          <div
            class="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[var(--builder-bg-secondary)] to-transparent pointer-events-none"
          ></div>
        </div>
        <div class="flex justify-end px-3 pb-3">
          <button
            onclick={create_from_prompt}
            disabled={!prompt.trim() || is_creating || llm_configured === null}
            class="px-3 py-2 rounded-md bg-[var(--builder-accent)] text-[var(--builder-accent-text)] hover:bg-[var(--builder-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium"
          >
            {#if is_creating}
              <Loader2 class="w-4 h-4 animate-spin" />
              Creating...
            {:else}
              <Sparkles class="w-4 h-4" />
              Create
            {/if}
          </button>
        </div>
      </div>
    {/if}

    <!-- Templates divider -->
    <div class="w-full flex items-center gap-4 mb-6">
      <div class="flex-1 h-px bg-[var(--builder-border)]"></div>
      <span class="text-sm text-[var(--builder-text-muted)]">Or pick a template</span>
      <div class="flex-1 h-px bg-[var(--builder-border)]"></div>
    </div>

    <!-- Filter Bar -->
    <div
      class="w-full flex items-center gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide"
    >
      {#each archetypes as type}
        <button
          onclick={() => (selected_archetype = type.id)}
          class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap {selected_archetype ===
          type.id
            ? 'bg-[var(--builder-accent)] text-[var(--builder-accent-text)]'
            : 'bg-[var(--builder-bg-secondary)] text-[var(--builder-text-secondary)] hover:bg-[var(--builder-bg-tertiary)] hover:text-[var(--builder-text-primary)] icon-button'}"
        >
          {type.label}
        </button>
      {/each}
    </div>

    <!-- Templates grid -->
    <div class="w-full">
      {#if kit_templates.length > 0}
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {#each kit_templates as template (template.id)}
              <button
                onclick={() => create_from_template(template.id)}
                disabled={is_creating}
                class="group relative flex flex-col items-start gap-1.5 p-2.5 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg hover:border-[var(--builder-accent)] hover:bg-[var(--builder-bg-tertiary)] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left h-[72px]"
              >
                <div class="flex items-center gap-2">
                  <Icon
                    icon={template.preview}
                    class="w-4 h-4 text-[var(--builder-accent)] flex-shrink-0"
                  />
                  <span class="font-medium text-[var(--builder-text-primary)] text-xs line-clamp-1">
                    {template.name}
                  </span>
                </div>
                <p class="text-[10px] text-[var(--builder-text-muted)] line-clamp-2 leading-tight">
                  {template.description}
                </p>
              </button>
            {/each}
        </div>
      {:else}
        <p class="text-center text-[var(--builder-text-muted)] py-4 text-sm">
          No templates available. Describe your app above to get started.
        </p>
      {/if}
    </div>

    <!-- Restore from snapshot -->
    <div class="w-full flex items-center gap-4 mt-8 mb-6">
      <div class="flex-1 h-px bg-[var(--builder-border)]"></div>
      <span class="text-sm text-[var(--builder-text-muted)]"
        >Or restore from a snapshot</span
      >
      <div class="flex-1 h-px bg-[var(--builder-border)]"></div>
    </div>

    <input
      bind:this={file_input}
      type="file"
      accept=".json"
      class="hidden"
      onchange={handle_snapshot_upload}
    />

    <button
      onclick={trigger_file_upload}
      disabled={is_creating}
      class="w-full flex items-center justify-center gap-3 p-6 bg-[var(--builder-bg-secondary)] border border-dashed border-[var(--builder-border)] rounded-lg hover:border-[var(--builder-accent)] hover:bg-[var(--builder-bg-tertiary)] transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
    >
      <Upload
        class="w-6 h-6 text-[var(--builder-text-secondary)] group-hover:text-[var(--builder-accent)] transition-colors"
      />
      <div class="text-left">
        <div class="font-medium text-[var(--builder-text-primary)]">
          Upload Snapshot
        </div>
        <div class="text-xs text-[var(--builder-text-muted)] mt-0.5">
          Restore a project from a downloaded snapshot file
        </div>
      </div>
    </button>

  </main>
</div>
