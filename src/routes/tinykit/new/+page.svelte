<script lang="ts">
  import { goto } from "$app/navigation";
  import { ArrowLeft, Sparkles, Loader2, Globe, Upload } from "lucide-svelte";
  import Icon from "@iconify/svelte";
  import { get_saved_theme, apply_builder_theme } from "$lib/builder_themes";
  import { onMount } from "svelte";
  import { project_service } from "$lib/services/project.svelte";
  import { auth, pb } from "$lib/pocketbase.svelte";
  import { TEMPLATES } from "$lib/templates";

  // Get domain from server load
  let { data } = $props();
  const domain = data.domain;

  let prompt = $state("");
  let is_creating = $state(false);
  let error_message = $state("");
  let textarea_el: HTMLTextAreaElement;
  let file_input: HTMLInputElement;

  onMount(() => {
    const theme = get_saved_theme();
    apply_builder_theme(theme);
    textarea_el?.focus();
  });

  async function create_from_prompt() {
    if (!prompt.trim()) return;

    is_creating = true;
    error_message = "";

    // Verify auth before attempting to create
    if (!auth.is_authenticated || !pb.authStore.isValid) {
      error_message = "Session expired. Please log in again.";
      is_creating = false;
      setTimeout(() => goto("/login"), 1500);
      return;
    }

    try {
      // Generate a project name using the LLM
      let project_name = generate_name_from_prompt(prompt); // fallback
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (pb.authStore.token) {
          headers["Authorization"] = `Bearer ${pb.authStore.token}`;
        }
        const res = await fetch("/api/ai/generate-name", {
          method: "POST",
          headers,
          body: JSON.stringify({ prompt: prompt.trim() }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.name) {
            project_name = json.name;
          }
        }
      } catch {
        // Use fallback name
      }

      const project = await project_service.create({
        name: project_name,
        domain: domain,
        initial_prompt: prompt,
      });
      // Redirect to builder (domain is now set, so /tinykit/studio will work)
      goto(`/tinykit/studio?id=${project.id}`);
    } catch (err: any) {
      console.error("Failed to create project:", err);
      // Extract meaningful error message
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
    is_creating = true;
    error_message = "";

    // Verify auth before attempting to create
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
        domain: domain,
        frontend_code: template.frontend_code || "",
        design: template.design || [],
        content: template.content || [],
        data: template.data || {},
      });

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

  function generate_name_from_prompt(prompt: string): string {
    // Extract first few meaningful words from prompt
    const words = prompt
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 3);

    if (words.length === 0) return "New Project";

    return words
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
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
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    is_creating = true;
    error_message = "";

    // Verify auth before attempting to create
    if (!auth.is_authenticated || !pb.authStore.isValid) {
      error_message = "Session expired. Please log in again.";
      is_creating = false;
      setTimeout(() => goto("/login"), 1500);
      return;
    }

    try {
      const text = await file.text();
      const snapshot_data = JSON.parse(text);

      // Validate snapshot structure
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

      // Extract name from filename or description
      const filename = file.name.replace(/\.json$/, "");
      const project_name =
        snapshot_data.description ||
        filename.replace(/^snapshot-\d{4}-\d{2}-\d{2}-/, "") ||
        "Restored Project";

      // Ensure domain is valid
      const target_domain = domain || "localhost";

      // Reconstruct data object from collections array (including records)
      const data: Record<string, any> = {};
      if (snapshot_data.collections && Array.isArray(snapshot_data.collections)) {
        for (const col of snapshot_data.collections) {
          data[col.name] = {
            schema: col.schema || [],
            records: col.records || []
          };
        }
      }

      const project = await project_service.create({
        name: project_name,
        domain: target_domain,
        frontend_code: snapshot_data.frontend_code || "",
        design: snapshot_data.design || [],
        content: snapshot_data.content || [],
        data
      });

      goto(`/tinykit/studio?id=${project.id}`);
    } catch (err: any) {
      // Check for specific validation errors
      if (err?.data?.data?.domain?.code === "validation_not_unique") {
        error_message = `A project already exists for domain "${domain || 'localhost'}". Delete it first or use a different domain.`;
      } else {
        const detail =
          err?.data?.message ||
          err?.response?.message ||
          err?.message ||
          "Unknown error";
        error_message = `Failed to restore from snapshot: ${detail}`;
      }
      is_creating = false;
      input.value = "";
    }
  }
</script>

<svelte:head>
  <title>New Project - tinykit</title>
</svelte:head>

<div class="min-h-screen bg-[var(--builder-bg-primary)] flex flex-col safe-area-top">
  <!-- Header -->
  <header class="border-b border-[var(--builder-border)] px-6 py-4">
    <a
      href="/tinykit/dashboard"
      class="inline-flex items-center gap-2 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
    >
      <ArrowLeft class="w-4 h-4" />
      <span class="text-sm">Back to projects</span>
    </a>
  </header>

  <!-- Main content -->
  <main
    class="flex-1 flex flex-col items-center justify-center px-6 py-12 max-w-3xl mx-auto w-full"
  >
    <!-- Domain badge -->
    <div
      class="flex items-center gap-2 px-4 py-2 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-full mb-6"
    >
      <Globe class="w-4 h-4 text-[var(--builder-accent)]" />
      <span class="text-sm text-[var(--builder-text-secondary)]"
        >Creating an app for</span
      >
      <span class="text-sm font-medium text-[var(--builder-text-primary)]"
        >{domain}</span
      >
    </div>

    <!-- Title -->
    <h1
      class="text-4xl font-semibold text-[var(--builder-text-primary)] mb-12 text-center"
    >
      What do you want to create?
    </h1>

    <!-- Prompt input -->
    <div class="w-full mb-6">
      <div class="relative">
        <textarea
          bind:this={textarea_el}
          bind:value={prompt}
          onkeydown={handle_keydown}
          disabled={is_creating}
          placeholder="Describe your app..."
          rows="3"
          class="w-full px-4 py-4 pr-14 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] placeholder:text-[var(--builder-text-muted)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--builder-accent)] focus:border-transparent disabled:opacity-50"
        ></textarea>
        <button
          onclick={create_from_prompt}
          disabled={!prompt.trim() || is_creating}
          class="absolute right-3 bottom-3 px-3 py-2 rounded-md bg-[var(--builder-accent)] text-white hover:bg-[var(--builder-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium"
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

    <!-- Error message -->
    {#if error_message}
      <div
        class="w-full mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm"
      >
        {error_message}
      </div>
    {/if}

    <!-- Divider -->
    <div class="w-full flex items-center gap-4 mb-8">
      <div class="flex-1 h-px bg-[var(--builder-border)]"></div>
      <span class="text-sm text-[var(--builder-text-muted)]"
        >Or start from a template</span
      >
      <div class="flex-1 h-px bg-[var(--builder-border)]"></div>
    </div>

    <!-- Template scroll -->
    <div class="w-full relative">
      <!-- Right fade only -->
      <div
        class="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-[var(--builder-bg-primary)] to-transparent z-10 pointer-events-none"
      ></div>

      <div
        class="flex gap-3 overflow-x-auto pb-2 pr-8 scrollbar-hide"
        style="-webkit-overflow-scrolling: touch;"
      >
        {#each TEMPLATES as template}
          <button
            onclick={() => create_from_template(template.id)}
            disabled={is_creating}
            class="flex-shrink-0 w-44 flex flex-col items-start gap-3 p-4 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg hover:border-[var(--builder-accent)] hover:bg-[var(--builder-bg-tertiary)] transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <Icon
              icon={template.preview}
              class="mx-auto w-6 h-6 text-[var(--builder-accent)]"
            />
            <div>
              <div
                class="font-medium text-[var(--builder-text-primary)] text-sm"
              >
                {template.name}
              </div>
              <div
                class="text-xs text-[var(--builder-text-muted)] mt-0.5 line-clamp-2"
              >
                {template.description}
              </div>
            </div>
          </button>
        {/each}
      </div>
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

<style>
  /* Hide scrollbar but allow scrolling */
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
</style>
