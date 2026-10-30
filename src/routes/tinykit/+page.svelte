<script lang="ts">
  import Logo from "$lib/assets/Logo.svelte";
  import { onMount, untrack } from "svelte";
  import { goto, replaceState } from "$app/navigation";
  import { page } from "$app/stores";
  import {
    Plus,
    Trash2,
    ExternalLink,
    Loader2,
    LogOut,
    Settings,
    MoreVertical,
    Pencil,
    Check,
    Search,
    X,
    LayoutGrid,
    ArrowUpRight,
  } from "lucide-svelte";
  import Icon from "@iconify/svelte";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { get_saved_theme, apply_builder_theme } from "$lib/builder_themes";
  import { auth } from "$lib/pocketbase.svelte";
  import { project_service } from "$lib/services/project.svelte";
  import { kit_service } from "$lib/services/kit.svelte";
  import type { Project, Kit } from "./types";
  import { TEMPLATES, get_template } from "$lib/templates";
  import ProjectThumbnail from "./dashboard/components/ProjectThumbnail.svelte";
  import EditKitDialog from "./dashboard/components/EditKitDialog.svelte";
  import DeleteKitDialog from "./dashboard/components/DeleteKitDialog.svelte";

  // Project state
  let projects = $state<Project[]>([]);
  let is_loading_projects = $state(true);
  let deleting_project_id = $state<string | null>(null);

  // Kit state
  let kits = $state<Kit[]>([]);
  let is_loading_kits = $state(true);
  let editing_kit = $state<Kit | null>(null);
  let show_edit_kit_dialog = $state(false);
  let deleting_kit = $state<Kit | null>(null);
  let show_delete_kit_dialog = $state(false);

  // Filter state
  let selected_kit_id = $state<string | null>(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("kit")
      : null,
  );

  let search_query = $state("");
  let load_error = $state("");
  let action_error = $state("");
  let moving_project_id = $state<string | null>(null);

  // Derived state
  let selected_kit = $derived(kits.find((k) => k.id === selected_kit_id));
  let uncategorized_projects = $derived(
    projects.filter((p) => !p.kit || p.kit === "custom"),
  );
  let has_uncategorized = $derived(uncategorized_projects.length > 0);
  let filtered_projects = $derived(
    selected_kit_id === "_uncategorized"
      ? uncategorized_projects
      : selected_kit_id
        ? projects.filter((p) => p.kit === selected_kit_id)
        : projects,
  );

  let visible_projects = $derived(
    filtered_projects.filter((project) =>
      `${project.name} ${project.domain || ""}`
        .toLowerCase()
        .includes(search_query.trim().toLowerCase()),
    ),
  );
  let heading = $derived(
    selected_kit?.name ||
      (selected_kit_id === "_uncategorized" ? "Uncategorized" : "All apps"),
  );

  // Sync kit filter to URL query param using SvelteKit's shallow routing
  let mounted = $state(false);
  $effect(() => {
    // Read selected_kit_id to establish dependency
    const kit_id = selected_kit_id;
    if (!mounted) return;

    try {
      localStorage.setItem("tinykit:kit-filter", kit_id || "_all");
    } catch {
      /* Storage may be unavailable. */
    }

    // Use untrack to read URL without creating a dependency (prevents infinite loop)
    const current_kit = untrack(() => $page.url.searchParams.get("kit"));

    // Only update if different
    if (kit_id !== current_kit) {
      const url = new URL(untrack(() => $page.url));
      if (kit_id) {
        url.searchParams.set("kit", kit_id);
      } else {
        url.searchParams.delete("kit");
      }
      replaceState(url, {});
    }
  });

  onMount(async () => {
    if (!$page.url.searchParams.has("kit")) {
      try {
        const saved = localStorage.getItem("tinykit:kit-filter");
        selected_kit_id = saved && saved !== "_all" ? saved : null;
      } catch {
        /* Use all apps when storage is unavailable. */
      }
    }
    const theme = get_saved_theme();
    apply_builder_theme(theme);

    // Load data
    await Promise.all([load_projects(), load_kits()]);

    if (
      selected_kit_id &&
      selected_kit_id !== "_uncategorized" &&
      !kits.some((kit) => kit.id === selected_kit_id)
    )
      selected_kit_id = null;
    mounted = true;
  });

  async function load_projects() {
    is_loading_projects = true;
    load_error = "";
    try {
      projects = await project_service.list();
    } catch (err) {
      console.error("Failed to load projects:", err);
      load_error = "Your apps could not be loaded. Please try again.";
    } finally {
      is_loading_projects = false;
    }
  }

  async function load_kits() {
    is_loading_kits = true;
    try {
      kits = await kit_service.list();
    } catch (err) {
      console.error("Failed to load kits:", err);
    } finally {
      is_loading_kits = false;
    }
  }

  async function delete_project(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    deleting_project_id = id;
    try {
      await project_service.delete(id);
      projects = projects.filter((p) => p.id !== id);
    } catch (err) {
      console.error("Failed to delete project:", err);
    } finally {
      deleting_project_id = null;
    }
  }

  async function move_project(project: Project, kit_id: string) {
    action_error = "";
    moving_project_id = project.id;
    try {
      const updated = await project_service.move_to_kit(project.id, kit_id);
      projects = projects.map((item) =>
        item.id === project.id ? updated : item,
      );
    } catch {
      action_error = `Could not move "${project.name}". Please try again.`;
    } finally {
      moving_project_id = null;
    }
  }

  function open_delete_kit_dialog(kit: Kit) {
    deleting_kit = kit;
    show_delete_kit_dialog = true;
  }

  function handle_kit_deleted() {
    if (!deleting_kit) return;
    const deleted_id = deleting_kit.id;

    kits = kits.filter((k) => k.id !== deleted_id);
    projects = projects.filter((p) => p.kit !== deleted_id);
    if (selected_kit_id === deleted_id) {
      selected_kit_id = kits.length > 0 ? kits[0].id : null;
    }

    deleting_kit = null;
  }

  async function handle_save_kit(
    id: string,
    name: string,
    icon: string,
    builder_theme_id?: string,
  ) {
    try {
      const data: { name: string; icon: string; builder_theme_id?: string } = {
        name,
        icon,
      };
      if (builder_theme_id) {
        data.builder_theme_id = builder_theme_id;
      }
      const updated = await kit_service.update(id, data);
      kits = kits.map((k) => (k.id === id ? updated : k));
    } catch (err) {
      console.error("Failed to update kit:", err);
      alert("Failed to update kit");
    }
  }

  function handle_edit_kit() {
    if (selected_kit) {
      editing_kit = selected_kit;
      show_edit_kit_dialog = true;
    }
  }

  function handle_logout() {
    auth.logout();
    goto("/login");
  }

  function get_domain(project: Project): string {
    return project.domain || "No domain";
  }

  function get_studio_href(project: Project): string {
    return `/tinykit/studio?id=${project.id}`;
  }

  function get_new_project_url(): string {
    return selected_kit_id && selected_kit_id !== "_uncategorized"
      ? `/tinykit/new?kit=${selected_kit_id}`
      : "/tinykit/new";
  }

  function get_app_icon(project: Project): string | undefined {
    return (
      project.settings?.icon ||
      get_template(project.settings?.template_id || "")?.preview ||
      TEMPLATES.find((template) => template.name === project.name)?.preview
    );
  }

  function get_initials(name: string): string {
    return (
      name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase() || "A"
    );
  }
</script>

<svelte:head>
  <title>Dashboard - tinykit</title>
</svelte:head>

<div class="dashboard safe-area-top">
  <header class="dashboard-header">
    <div class="dashboard-container header-inner">
      <a
        href="/tinykit?dashboard=1"
        class="brand-link"
        aria-label="Tinykit home"><Logo width="4.5rem" /></a
      >
      <div class="header-actions">
        <a
          href="https://docs.tinykit.studio"
          target="_blank"
          rel="noopener noreferrer"
          class="docs-link">Documentation <ArrowUpRight size={13} /></a
        >
        <a
          href="/tinykit/settings"
          class="icon-button"
          aria-label="Settings"
          title="Settings"><Settings size={18} /></a
        >
        <button
          onclick={handle_logout}
          class="icon-button"
          aria-label="Sign out"
          title="Sign out"><LogOut size={18} /></button
        >
      </div>
    </div>
  </header>

  <main class="dashboard-container dashboard-main">
    <div class="page-intro">
      <h1>Apps</h1>
      <a href={get_new_project_url()} class="primary-button"
        ><Plus size={17} /> New app</a
      >
    </div>

    <div class="collection-toolbar">
      <nav class="kit-filters" aria-label="Filter apps by kit">
        <button
          class="kit-filter"
          class:selected={selected_kit_id === null}
          aria-pressed={selected_kit_id === null}
          onclick={() => (selected_kit_id = null)}
        >
          <LayoutGrid size={15} /> All apps
          <span class="filter-count">{projects.length}</span>
        </button>
        {#each kits as kit (kit.id)}
          <button
            class="kit-filter"
            class:selected={selected_kit_id === kit.id}
            aria-pressed={selected_kit_id === kit.id}
            onclick={() => (selected_kit_id = kit.id)}
          >
            <Icon icon={kit.icon} width={15} />
            {kit.name}
            <span class="filter-count"
              >{projects.filter((p) => p.kit === kit.id).length}</span
            >
          </button>
        {/each}
        {#if has_uncategorized}
          <button
            class="kit-filter"
            class:selected={selected_kit_id === "_uncategorized"}
            aria-pressed={selected_kit_id === "_uncategorized"}
            onclick={() => (selected_kit_id = "_uncategorized")}
            >Uncategorized <span class="filter-count"
              >{uncategorized_projects.length}</span
            ></button
          >
        {/if}
        <a href="/tinykit/new-kit" class="new-kit-link"
          ><Plus size={15} /> New kit</a
        >
      </nav>
    </div>

    <div class="section-toolbar">
      <div class="section-title">
        {#if selected_kit_id}<h2>{heading}</h2>{/if}
        <span class="app-count" role="status"
          >{visible_projects.length}
          {visible_projects.length === 1 ? "app" : "apps"}</span
        >
        {#if selected_kit}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class="icon-button kit-menu"
              aria-label="Manage {selected_kit.name}"
              ><MoreVertical size={17} /></DropdownMenu.Trigger
            >
            <DropdownMenu.Content align="start">
              <DropdownMenu.Item
                class="gap-2 cursor-pointer"
                onclick={handle_edit_kit}
                ><Pencil size={14} /> Edit kit</DropdownMenu.Item
              >
              <DropdownMenu.Item
                class="gap-2 text-red-400 focus:text-red-400 cursor-pointer"
                onclick={() => open_delete_kit_dialog(selected_kit!)}
                ><Trash2 size={14} /> Delete kit</DropdownMenu.Item
              >
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/if}
      </div>
      <div class="search-field">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          aria-label="Search apps"
          placeholder="Search apps…"
          bind:value={search_query}
        />
        {#if search_query}<button
            class="clear-search"
            aria-label="Clear search"
            onclick={() => (search_query = "")}><X size={14} /></button
          >{/if}
      </div>
    </div>

    {#if action_error}<p class="action-error" role="alert">
        {action_error}
      </p>{/if}
    {#if is_loading_projects || is_loading_kits}
      <p class="loading-state" role="status">Loading apps…</p>
    {:else if load_error}
      <div class="empty-state" role="alert">
        <h3>Could not load apps</h3>
        <p>{load_error}</p>
        <button class="secondary-button" onclick={load_projects}>Retry</button>
      </div>
    {:else if visible_projects.length === 0}
      <div class="empty-state">
        <h3>{search_query.trim() ? "No matching apps" : "No apps yet"}</h3>
        <p>
          {search_query.trim()
            ? "Search by app name or domain."
            : "Create an app to get started."}
        </p>
        {#if search_query.trim()}
          <button class="secondary-button" onclick={() => (search_query = "")}
            >Clear search</button
          >
        {:else}
          <a href={get_new_project_url()} class="primary-button"
            ><Plus size={16} /> New app</a
          >
        {/if}
      </div>
    {:else}
      <table class="app-list">
        <caption class="sr-only">{heading}</caption>
        <thead
          ><tr
            ><th scope="col">App</th><th scope="col" class="domain-column"
              >Domain</th
            ><th scope="col">Status</th><th scope="col"
              ><span class="sr-only">Actions</span></th
            ></tr
          ></thead
        >
        <tbody>
          {#each visible_projects as project (project.id)}
            <tr>
              <td>
                <div class="app-entry">
                  <a
                    href={get_studio_href(project)}
                    class="app-thumbnail"
                    class:has-preview={!!project.published_html}
                    tabindex="-1"
                    aria-hidden="true"
                  >
                    {#if project.published_html}
                      <ProjectThumbnail
                        compiled_html={project.published_html}
                        project_id={project.id}
                        fallback_icon={get_app_icon(project) ||
                          "lucide:app-window"}
                      />
                    {:else if get_app_icon(project)}<Icon
                        icon={get_app_icon(project)!}
                        width={20}
                      />{:else}<span class="app-initials"
                        >{get_initials(project.name)}</span
                      >{/if}
                  </a>
                  <div class="app-summary">
                    <a href={get_studio_href(project)} class="app-name"
                      >{project.name}</a
                    >
                    {#if project.domain}<a
                        class="mobile-domain"
                        href="https://{project.domain}"
                        target="_blank"
                        rel="noopener noreferrer">{project.domain}</a
                      >{:else}<span class="mobile-domain"
                        >{get_domain(project)}</span
                      >{/if}
                  </div>
                </div>
              </td>
              <td class="domain-column">
                {#if project.domain}<a
                    href="https://{project.domain}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="domain-link"
                    ><span>{project.domain}</span><ExternalLink size={12} /></a
                  >{:else}<span class="no-domain" aria-label="No domain">—</span
                  >{/if}
              </td>
              <td class="status-column"
                >{project.published_html ? "Published" : "Draft"}</td
              >
              <td class="actions-column">
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger
                    class="icon-button"
                    aria-label="Actions for {project.name}"
                    disabled={deleting_project_id === project.id ||
                      moving_project_id === project.id}
                  >
                    {#if deleting_project_id === project.id || moving_project_id === project.id}<Loader2
                        size={15}
                        class="animate-spin"
                      />{:else}<MoreVertical size={17} />{/if}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content
                    align="end"
                    class="max-h-[60dvh] overflow-y-auto min-w-44"
                  >
                    {#if kits.length > 0}
                      <DropdownMenu.Label>Move to kit</DropdownMenu.Label>
                      {#each kits as kit (kit.id)}<DropdownMenu.Item
                          class="gap-2 cursor-pointer"
                          disabled={project.kit === kit.id}
                          onclick={() => move_project(project, kit.id)}
                          ><span class="w-4"
                            >{#if project.kit === kit.id}<Check
                                size={14}
                              />{/if}</span
                          >{kit.name}</DropdownMenu.Item
                        >{/each}
                      <DropdownMenu.Item
                        class="gap-2 cursor-pointer"
                        disabled={!project.kit || project.kit === "custom"}
                        onclick={() => move_project(project, "custom")}
                        ><span class="w-4"
                          >{#if !project.kit || project.kit === "custom"}<Check
                              size={14}
                            />{/if}</span
                        >No kit</DropdownMenu.Item
                      >
                      <DropdownMenu.Separator />
                    {/if}
                    <DropdownMenu.Item
                      class="gap-2 cursor-pointer text-red-400 focus:text-red-400"
                      onclick={() => delete_project(project.id, project.name)}
                      ><Trash2 size={14} />Delete app</DropdownMenu.Item
                    >
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </main>
</div>

{#if editing_kit}
  <EditKitDialog
    kit={editing_kit}
    bind:open={show_edit_kit_dialog}
    on_save={handle_save_kit}
  />
{/if}

{#if deleting_kit}
  <DeleteKitDialog
    kit={deleting_kit}
    {projects}
    bind:open={show_delete_kit_dialog}
    on_deleted={handle_kit_deleted}
  />
{/if}

<style>
  .dashboard {
    min-height: 100dvh;
    background: var(--builder-bg-primary);
    color: var(--builder-text-primary);
  }
  .dashboard-container {
    max-width: 1200px;
    padding-inline: 32px;
    margin-inline: auto;
  }
  .dashboard-header {
    border-bottom: 1px solid var(--builder-border);
  }
  .header-inner {
    height: 60px;
    display: flex;
    align-items: center;
  }
  .brand-link {
    display: inline-flex;
    align-items: center;
  }
  .header-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .docs-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--builder-text-secondary);
    margin-right: 12px;
  }
  .docs-link:hover {
    color: var(--builder-text-primary);
  }
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: 5px;
    color: var(--builder-text-secondary);
  }
  .icon-button:hover {
    background: var(--builder-bg-tertiary);
    color: var(--builder-text-primary);
  }
  .icon-button:disabled {
    opacity: 0.4;
    cursor: wait;
  }
  .dashboard-main {
    padding-top: 32px;
    padding-bottom: 40px;
  }
  .page-intro {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    margin-bottom: 28px;
  }
  h1 {
    font-size: 24px;
    line-height: 1.3;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .primary-button,
  .secondary-button {
    min-height: 34px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid transparent;
    border-radius: 5px;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }
  .primary-button {
    background: var(--builder-accent);
    color: var(--builder-accent-text);
  }
  .primary-button:hover {
    background: var(--builder-accent-hover);
  }
  .secondary-button {
    border-color: var(--builder-border);
    background: var(--builder-bg-secondary);
  }
  .secondary-button:hover {
    background: var(--builder-bg-tertiary);
  }
  .collection-toolbar {
    border-bottom: 1px solid var(--builder-border);
    margin-bottom: 20px;
  }
  .kit-filters {
    display: flex;
    align-items: center;
    gap: 18px;
    overflow-x: auto;
  }
  .kit-filter,
  .new-kit-link {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 10px 0 12px;
    border-bottom: 2px solid transparent;
    color: var(--builder-text-secondary);
    white-space: nowrap;
    font-size: 13px;
  }
  .kit-filter:hover,
  .new-kit-link:hover {
    color: var(--builder-text-primary);
  }
  .kit-filter.selected {
    border-bottom-color: var(--builder-text-primary);
    color: var(--builder-text-primary);
  }
  .filter-count {
    color: var(--builder-text-secondary);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .new-kit-link {
    margin-left: auto;
  }
  .section-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    margin-bottom: 16px;
  }
  .section-title {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 10px;
  }
  h2 {
    font-size: 14px;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .app-count {
    font-size: 12px;
    color: var(--builder-text-secondary);
    white-space: nowrap;
  }
  .search-field {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 230px;
    flex-shrink: 0;
    padding: 0 10px;
    height: 34px;
    border: 1px solid var(--builder-border);
    border-radius: 5px;
    color: var(--builder-text-secondary);
  }
  .search-field:focus-within {
    border-color: var(--builder-accent);
  }
  .search-field input {
    width: 100%;
    min-width: 0;
    outline: none;
    background: transparent;
    font-size: 12px;
    color: var(--builder-text-primary);
  }
  .search-field input::placeholder {
    color: var(--builder-text-secondary);
  }
  .search-field input::-webkit-search-cancel-button {
    display: none;
  }
  .clear-search {
    display: flex;
    padding: 4px;
    border-radius: 3px;
  }
  .clear-search:hover {
    background: var(--builder-bg-tertiary);
  }
  .app-list {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    text-align: left;
  }
  .app-list th {
    height: 32px;
    font-size: 11px;
    font-weight: 400;
    color: var(--builder-text-secondary);
    border-bottom: 1px solid var(--builder-border);
  }
  .app-list th:first-child {
    width: 44%;
  }
  .app-list th:nth-child(2) {
    width: 34%;
  }
  .app-list th:nth-child(3) {
    width: 16%;
  }
  .app-list th:last-child {
    width: 44px;
  }
  .app-list td {
    height: 76px;
    border-bottom: 1px solid var(--builder-border);
  }
  .app-list tbody tr:hover {
    background: var(--builder-bg-secondary);
  }
  .app-entry {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding-right: 20px;
  }
  .app-thumbnail {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 54px;
    height: 38px;
    border-radius: 3px;
    flex-shrink: 0;
    overflow: hidden;
    color: var(--builder-text-secondary);
  }
  .app-initials {
    font-size: 12px;
    font-weight: 500;
  }
  .app-thumbnail.has-preview {
    border: 1px solid var(--builder-border);
    background: var(--builder-bg-secondary);
  }
  .app-summary {
    min-width: 0;
  }
  .app-name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 500;
  }
  .app-name:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .mobile-domain {
    display: none;
  }
  .domain-link {
    display: inline-flex;
    max-width: 100%;
    align-items: center;
    gap: 7px;
    padding-right: 16px;
    color: var(--builder-text-secondary);
    font-size: 12px;
  }
  .domain-link span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .domain-link :global(svg) {
    flex-shrink: 0;
  }
  .domain-link:hover {
    color: var(--builder-text-primary);
  }
  .no-domain,
  .status-column {
    color: var(--builder-text-secondary);
    font-size: 12px;
  }
  .actions-column {
    text-align: right;
  }
  .action-error {
    font-size: 13px;
    color: #f87171;
    margin-bottom: 16px;
  }
  .loading-state {
    padding: 40px 0;
    color: var(--builder-text-secondary);
    font-size: 13px;
  }
  .empty-state {
    padding: 56px 0;
    border-top: 1px solid var(--builder-border);
  }
  .empty-state h3 {
    font-size: 15px;
    font-weight: 500;
  }
  .empty-state p {
    margin: 8px 0 20px;
    font-size: 13px;
    color: var(--builder-text-secondary);
    line-height: 1.5;
  }
  @media (max-width: 700px) {
    .search-field input {
      font-size: 16px;
    }
    .dashboard-container {
      padding-inline: 20px;
    }
    .dashboard-main {
      padding-top: 24px;
    }
    .docs-link {
      display: none;
    }
    .kit-filters {
      gap: 16px;
    }
    .section-toolbar {
      flex-wrap: wrap;
      gap: 12px;
    }
    .search-field {
      width: 100%;
      height: 38px;
    }
    .domain-column {
      display: none;
    }
    .app-list th:first-child {
      width: auto;
    }
    .app-list th:nth-child(3) {
      width: 70px;
    }
    .app-list th:last-child {
      width: 38px;
    }
    .app-list td {
      height: 78px;
    }
    .app-entry {
      gap: 10px;
      padding-right: 10px;
    }
    .app-thumbnail {
      width: 36px;
      height: 36px;
    }
    .mobile-domain {
      display: block;
      font-size: 11px;
      color: var(--builder-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 4px;
    }
    .icon-button {
      height: 38px;
      width: 38px;
    }
  }
</style>
