<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import {
    ArrowLeft,
    Sparkles,
    Loader2,
    Upload,
    Plus,
    Search,
    Eye,
  } from "lucide-svelte";
  import Icon from "@iconify/svelte";
  import { get_saved_theme, apply_builder_theme } from "$lib/builder_themes";
  import { onMount } from "svelte";
  import { project_service } from "$lib/services/project.svelte";
  import { kit_service } from "$lib/services/kit.svelte";
  import { auth, pb } from "$lib/pocketbase.svelte";
  import {
    TEMPLATES,
    get_template_groups,
    type Template,
  } from "$lib/templates";

  type TemplateArchetype = "app" | "form" | "dashboard" | "site";
  import * as Dialog from "$lib/components/ui/dialog";
  import TemplatePreview from "./TemplatePreview.svelte";
  import type { Kit } from "../types";

  let { data } = $props();

  // Domain is set only when creating an app from the domain connection flow.
  let domain = $derived(data.domain || "");

  let prompt = $state("");
  let is_creating = $state(false);
  let error_message = $state("");
  let file_input: HTMLInputElement;

  // LLM configuration status
  let llm_configured = $state<boolean | null>(null); // null = loading

  let kit_id = $state("");
  let kits = $state<Kit[]>([]);
  let is_loading_kits = $state(true);
  let template_search = $state("");
  let previewing_template = $state<Template | null>(null);
  const kit_templates_all = TEMPLATES;

  // Filter templates by archetype
  let selected_archetype = $state<TemplateArchetype | "all">("all");

  let kit_templates = $derived(
    selected_archetype === "all"
      ? kit_templates_all
      : kit_templates_all.filter((t) => t.archetype === selected_archetype),
  );
  let visible_templates = $derived(
    kit_templates.filter((template) =>
      `${template.name} ${template.description}`
        .toLowerCase()
        .includes(template_search.trim().toLowerCase()),
    ),
  );
  let template_groups = $derived(get_template_groups(visible_templates));

  const all_archetypes: { id: TemplateArchetype | "all"; label: string }[] = [
    { id: "all", label: "All" },
    { id: "app", label: "Apps" },
    { id: "form", label: "Forms" },
    { id: "dashboard", label: "Dashboards" },
    { id: "site", label: "Sites" },
  ];

  // Only show archetype tabs that have templates in this kit
  let archetypes = $derived(
    all_archetypes.filter(
      (a) =>
        a.id === "all" || kit_templates_all.some((t) => t.archetype === a.id),
    ),
  );

  onMount(async () => {
    const theme = get_saved_theme();
    apply_builder_theme(theme);

    const requested_kit = $page.url.searchParams.get("kit");
    try {
      kits = await kit_service.list();
      kit_id = kits.some((kit) => kit.id === requested_kit)
        ? requested_kit!
        : "";
    } finally {
      is_loading_kits = false;
    }

    // Check LLM configuration status
    try {
      const res = await fetch("/api/settings/llm-status", {
        headers: { Authorization: `Bearer ${pb.authStore.token}` },
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
  });

  async function create_from_prompt() {
    if (!prompt.trim() || is_creating || is_loading_kits) return;

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
        kit: kit_id || undefined,
        domain: domain || undefined,
        initial_prompt: prompt,
      });

      if (!project?.id) {
        throw new Error("Project creation returned invalid response");
      }

      if (prompt.trim()) {
        sessionStorage.setItem(
          `tinykit:initial_prompt:${project.id}`,
          prompt.trim(),
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
    if (is_creating || is_loading_kits) return;

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
        icon: template.preview,
        template_id: template.id,
        kit: kit_id || undefined,
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
    if (is_creating || is_loading_kits) return;

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
      const response = await fetch('/api/projects/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${pb.authStore.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: JSON.parse(text), filename: file.name, kit: kit_id || undefined, domain: domain || undefined }),
      });
      const project = await response.json().catch(() => ({ error: response.status === 413 ? 'This file exceeds the server’s upload limit.' : 'Could not read the import response.' }));
      if (!response.ok) throw new Error(project.error || 'Could not import app.');
      if (!project?.id) throw new Error('Import returned an invalid app.');
      goto(`/tinykit/studio?id=${project.id}`);
    } catch (err: any) {
      const detail =
        err?.data?.message ||
        err?.response?.message ||
        err?.message ||
        "Unknown error";
      error_message = `Could not import app: ${detail}`;
      is_creating = false;
      input.value = "";
    }
  }

  async function create_blank() {
    if (is_creating || is_loading_kits) return;
    if (!auth.is_authenticated || !pb.authStore.isValid) {
      error_message = "Session expired. Please log in again.";
      return;
    }
    is_creating = true;
    error_message = "";
    try {
      const project = await project_service.create({
        name: "Untitled app",
        kit: kit_id || undefined,
        domain: domain || undefined,
      });
      goto(`/tinykit/studio?id=${project.id}`);
    } catch (error: any) {
      error_message = error?.message || "Could not create app.";
      is_creating = false;
    }
  }

  function get_back_href() {
    return kit_id ? `/tinykit?kit=${kit_id}` : "/tinykit?dashboard=1";
  }
</script>

<svelte:head>
  <title>New App - tinykit</title>
</svelte:head>

<div class="new-app-page safe-area-top">
  <header class="page-header">
    <a href={get_back_href()} class="back-link"><ArrowLeft size={15} /> Apps</a>
  </header>
  <main>
    <div class="page-heading">
      <h1>New app</h1>
      <label class="kit-select"
        >Kit <select
          bind:value={kit_id}
          disabled={is_creating || is_loading_kits}
          aria-label="Kit"
          ><option value="">No kit</option>{#each kits as kit}<option
              value={kit.id}>{kit.name}</option
            >{/each}</select
        ></label
      >
    </div>
    {#if domain}<p class="domain-note">Domain: {domain}</p>{/if}
    {#if error_message}<p class="error-message" role="alert">
        {error_message}
      </p>{/if}

    <div class="starter-actions">
      <button
        class="secondary-button"
        onclick={create_blank}
        disabled={is_creating || is_loading_kits}
        ><Plus size={15} /> Blank app</button
      >
      <button
        class="text-button"
        onclick={trigger_file_upload}
        disabled={is_creating || is_loading_kits}
        ><Upload size={14} /> Import app</button
      >
      <input
        bind:this={file_input}
        type="file"
        accept=".json"
        class="hidden"
        aria-label="Import app or snapshot"
        onchange={handle_snapshot_upload}
      />
    </div>

    <section aria-labelledby="template-heading">
      <div class="section-heading">
        <h2 id="template-heading">Templates</h2>
        <a class="ai-link" href="#ai-heading">Build with AI</a>
        <div class="search-field">
          <Search size={15} /><input
            type="search"
            aria-label="Search templates"
            placeholder="Search templates…"
            bind:value={template_search}
          />
        </div>
      </div>
      <nav class="template-filters" aria-label="Template type">
        {#each archetypes as type}<button
            onclick={() => (selected_archetype = type.id)}
            class:active={selected_archetype === type.id}
            aria-pressed={selected_archetype === type.id}>{type.label}</button
          >{/each}
      </nav>
      {#each template_groups as group (group.id)}
        <section class="template-group" aria-label={group.label}>
          {#if group.id === "featured" || template_groups.length > 1}
            <h3 class="group-heading">
              {group.label}<span>{group.templates.length}</span>
            </h3>
          {/if}
          <div class="template-list">
            {#each group.templates as template (template.id)}
              <div class="template-row">
                <button
                  class="template-choice"
                  onclick={() => create_from_template(template.id)}
                  disabled={is_creating || is_loading_kits}
                >
                  <Icon icon={template.preview} width={19} />
                  <span
                    ><strong>{template.name}</strong><span
                      class="template-description">{template.description}</span
                    ></span
                  >
                </button>
                <button
                  class="preview-button"
                  onclick={() => (previewing_template = template)}
                  disabled={is_creating}
                  aria-label="Preview {template.name}"
                  title="Preview {template.name}"><Eye size={16} /></button
                >
              </div>
            {/each}
          </div>
        </section>
      {:else}<p class="empty-message">No templates match your search.</p>{/each}
    </section>

    <section class="ai-section" aria-labelledby="ai-heading">
      <h2 id="ai-heading">Build with AI</h2>
      {#if llm_configured === false}<p class="ai-note">
          Add an AI provider in <a href="/tinykit/settings">Settings</a> to build
          from a prompt.
        </p>
      {:else}<div class="prompt-field">
          <textarea
            bind:value={prompt}
            onkeydown={handle_keydown}
            disabled={is_creating || llm_configured === null}
            aria-label="Describe your app"
            placeholder={llm_configured === null
              ? "Checking AI settings…"
              : "Describe your app…"}
            rows="3"
          ></textarea><button
            class="primary-button"
            onclick={create_from_prompt}
            disabled={!prompt.trim() ||
              is_creating ||
              is_loading_kits ||
              llm_configured === null}
            >{#if is_creating}<Loader2
                size={15}
                class="animate-spin"
              />{:else}<Sparkles size={15} />{/if} Create app</button
          >
        </div>{/if}
    </section>
  </main>
</div>

{#if previewing_template}
  <Dialog.Root
    open={true}
    onOpenChange={(open) => {
      if (!open) previewing_template = null;
    }}
  >
    <Dialog.Content
      class="max-w-6xl w-[calc(100%-2rem)] h-[85dvh] flex flex-col p-0 gap-0 overflow-hidden"
    >
      <Dialog.Header
        class="px-5 py-4 border-b border-[var(--builder-border)] pr-12"
      >
        <Dialog.Title>{previewing_template.name}</Dialog.Title>
        <Dialog.Description
          >{previewing_template.description}</Dialog.Description
        >
      </Dialog.Header>
      <div class="flex-1 min-h-0">
        {#key previewing_template.id}<TemplatePreview
            template={previewing_template}
          />{/key}
      </div>
      <div class="preview-footer">
        <span class="preview-note"
          >Sample data. Preview changes aren’t saved.</span
        >
        <button
          class="primary-button"
          disabled={is_creating || is_loading_kits}
          onclick={() => {
            const id = previewing_template!.id;
            previewing_template = null;
            create_from_template(id);
          }}>Use template</button
        >
      </div>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<style>
  .new-app-page {
    min-height: 100dvh;
    background: var(--builder-bg-primary);
    color: var(--builder-text-primary);
  }
  .page-header {
    padding: 18px 28px;
    border-bottom: 1px solid var(--builder-border);
  }
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--builder-text-secondary);
    font-size: 13px;
  }
  .back-link:hover {
    color: var(--builder-text-primary);
  }
  main {
    max-width: 880px;
    margin: auto;
    padding: 32px 28px 48px;
  }
  .page-heading,
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }
  h1 {
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  h2 {
    font-size: 14px;
    font-weight: 500;
  }
  .ai-link {
    margin-left: auto;
    font-size: 12px;
    color: var(--builder-text-secondary);
  }
  .ai-link:hover {
    color: var(--builder-text-primary);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .kit-select {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--builder-text-secondary);
  }
  select {
    max-width: 200px;
    min-width: 120px;
    border: 1px solid var(--builder-border);
    border-radius: 5px;
    padding: 6px 10px;
    background: var(--builder-bg-primary);
    color: var(--builder-text-primary);
    font-size: 12px;
  }
  .domain-note {
    font-size: 12px;
    color: var(--builder-text-secondary);
    margin-top: 12px;
  }
  .error-message {
    margin-top: 20px;
    color: #f87171;
    font-size: 13px;
  }
  .starter-actions {
    display: flex;
    align-items: center;
    gap: 20px;
    margin: 24px 0 32px;
  }
  .primary-button,
  .secondary-button,
  .text-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 34px;
    border-radius: 5px;
    font-size: 13px;
    padding: 0 12px;
  }
  .primary-button {
    white-space: nowrap;
    flex-shrink: 0;
    background: var(--builder-accent);
    color: var(--builder-accent-text);
  }
  .primary-button:hover {
    background: var(--builder-accent-hover);
  }
  .secondary-button {
    border: 1px solid var(--builder-border);
  }
  .secondary-button:hover {
    background: var(--builder-bg-secondary);
  }
  .text-button {
    color: var(--builder-text-secondary);
    padding-inline: 0;
  }
  .text-button:hover {
    color: var(--builder-text-primary);
  }
  button:disabled {
    opacity: 0.45;
    cursor: wait;
  }
  .search-field {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--builder-border);
    border-radius: 5px;
    padding: 7px 10px;
    width: 230px;
    color: var(--builder-text-secondary);
  }
  .search-field:focus-within {
    border-color: var(--builder-accent);
  }
  .search-field input {
    min-width: 0;
    width: 100%;
    outline: none;
    background: transparent;
    color: var(--builder-text-primary);
    font-size: 12px;
  }
  .template-filters {
    display: flex;
    gap: 20px;
    border-bottom: 1px solid var(--builder-border);
    margin-top: 12px;
    overflow-x: auto;
  }
  .template-filters button {
    padding: 10px 0;
    color: var(--builder-text-secondary);
    font-size: 12px;
    border-bottom: 2px solid transparent;
  }
  .template-filters button.active {
    color: var(--builder-text-primary);
    border-bottom-color: var(--builder-text-primary);
  }
  .template-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 28px;
  }
  .template-group + .template-group {
    margin-top: 28px;
  }
  .group-heading {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 18px 0 2px;
    font-size: 12px;
    font-weight: 500;
  }
  .group-heading span {
    color: var(--builder-text-secondary);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  .template-row {
    display: flex;
    align-items: center;
    min-width: 0;
    border-bottom: 1px solid var(--builder-border);
  }
  .template-choice {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    flex: 1;
    min-width: 0;
    text-align: left;
    padding: 18px 0;
  }
  .template-choice :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--builder-text-secondary);
  }
  .template-choice > span {
    min-width: 0;
  }
  .template-choice strong {
    font-size: 13px;
    font-weight: 500;
  }
  .template-choice:hover strong {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .template-description {
    display: block;
    font-size: 12px;
    color: var(--builder-text-secondary);
    margin-top: 5px;
    line-height: 1.5;
  }
  .preview-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 4px;
    color: var(--builder-text-secondary);
    flex-shrink: 0;
    margin-left: 8px;
  }
  .preview-button:hover {
    background: var(--builder-bg-secondary);
    color: var(--builder-text-primary);
  }
  .empty-message {
    padding-block: 28px;
    font-size: 13px;
    color: var(--builder-text-secondary);
    grid-column: 1/-1;
  }
  .ai-section {
    border-top: 1px solid var(--builder-border);
    margin-top: 32px;
    padding-top: 24px;
  }
  .ai-note {
    margin-top: 12px;
    font-size: 13px;
    color: var(--builder-text-secondary);
  }
  .ai-note a {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .prompt-field {
    margin-top: 12px;
    border: 1px solid var(--builder-border);
    border-radius: 5px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .prompt-field textarea {
    width: 100%;
    resize: vertical;
    background: transparent;
    outline: none;
    font-size: 13px;
    margin-bottom: 10px;
  }
  .prompt-field:focus-within {
    border-color: var(--builder-accent);
  }
  .preview-note {
    font-size: 11px;
    color: var(--builder-text-secondary);
  }
  .preview-footer {
    padding: 12px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    border-top: 1px solid var(--builder-border);
    background: var(--builder-bg-primary);
  }
  @media (max-width: 600px) {
    .search-field input,
    select,
    .prompt-field textarea {
      font-size: 16px;
    }
    main {
      padding: 24px 20px 36px;
    }
    .page-header {
      padding-inline: 20px;
    }
    .kit-select {
      gap: 6px;
    }
    select {
      min-width: 100px;
      max-width: 150px;
    }
    .section-heading {
      flex-wrap: wrap;
      gap: 12px;
    }
    .search-field {
      width: 100%;
    }
    .template-list {
      grid-template-columns: minmax(0, 1fr);
    }
    .starter-actions {
      gap: 16px;
    }
    .preview-button {
      width: 40px;
      height: 40px;
    }
  }
</style>
