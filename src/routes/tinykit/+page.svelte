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
    FolderOpen,
    MoreVertical,
    Pencil
  } from "lucide-svelte";
  import Icon from "@iconify/svelte";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { get_saved_theme, apply_builder_theme } from "$lib/builder_themes";
  import { auth } from "$lib/pocketbase.svelte";
  import { project_service } from "$lib/services/project.svelte";
  import { kit_service } from "$lib/services/kit.svelte";
  import type { Project, Kit } from "./types";
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
      : null
  );

  // Derived state
  let selected_kit = $derived(kits.find((k) => k.id === selected_kit_id));
  let uncategorized_projects = $derived(projects.filter((p) => !p.kit || p.kit === "custom"));
  let has_uncategorized = $derived(uncategorized_projects.length > 0);
  let filtered_projects = $derived(
    selected_kit_id === "_uncategorized"
      ? uncategorized_projects
      : selected_kit_id
        ? projects.filter((p) => p.kit === selected_kit_id)
        : projects
  );

  // Sync kit filter to URL query param using SvelteKit's shallow routing
  let mounted = $state(false);
  $effect(() => {
    // Read selected_kit_id to establish dependency
    const kit_id = selected_kit_id;
    if (!mounted) return;

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
    mounted = true;
    const theme = get_saved_theme();
    apply_builder_theme(theme);

    // Load data
    await Promise.all([load_projects(), load_kits()]);

    // First-time user with no projects? Guide them to create one
    if (projects.length === 0 && kits.length === 0) {
      goto("/tinykit/new-kit");
    }
  });

  async function load_projects() {
    is_loading_projects = true;
    try {
      projects = await project_service.list();
    } catch (err) {
      console.error("Failed to load projects:", err);
    } finally {
      is_loading_projects = false;
    }
  }

  async function load_kits() {
    is_loading_kits = true;
    try {
      kits = await kit_service.list();
      // Auto-select first kit, or uncategorized if no kits but has orphan projects
      if (!selected_kit_id) {
        if (kits.length > 0) {
          selected_kit_id = kits[0].id;
        } else if (uncategorized_projects.length > 0) {
          selected_kit_id = "_uncategorized";
        }
      }
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

  async function handle_save_kit(id: string, name: string, icon: string, builder_theme_id?: string) {
    try {
      const data: { name: string; icon: string; builder_theme_id?: string } = { name, icon }
      if (builder_theme_id) {
        data.builder_theme_id = builder_theme_id
      }
      const updated = await kit_service.update(id, data)
      kits = kits.map((k) => (k.id === id ? updated : k))
    } catch (err) {
      console.error("Failed to update kit:", err)
      alert("Failed to update kit")
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
    return project.domain || "no domain";
  }

  function get_studio_href(project: Project): string {
    return `/tinykit/studio?id=${project.id}`;
  }

  function get_new_project_url(): string {
    return selected_kit_id
      ? `/tinykit/new?kit=${selected_kit_id}`
      : "/tinykit/new";
  }

  function get_kit_icon(project: Project): string {
    const kit = kits.find((k) => k.id === project.kit);
    return kit?.icon || "lucide:file";
  }
</script>

<svelte:head>
  <title>Dashboard - tinykit</title>
</svelte:head>

<div class="min-h-screen bg-[var(--builder-bg-primary)] safe-area-top">
  <!-- Header -->
  <header class="border-b border-[var(--builder-border)] py-4">
    <div class="max-w-6xl mx-auto px-6 flex items-center justify-between">
      <div class="flex items-center gap-8">
        <Logo width="4rem" />
      </div>

      <div class="flex items-center gap-3">
        <a
          href="/tinykit/settings"
          class="p-2 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
          title="Settings"
        >
          <Settings class="w-5 h-5" />
        </a>
        <button
          onclick={handle_logout}
          class="p-2 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
          title="Sign out"
        >
          <LogOut class="w-5 h-5" />
        </button>
      </div>
    </div>
  </header>

  <!-- Main content -->
  <main class="py-4">
    <!-- Kit Filter Tabs -->
    <div class="sticky top-0 z-10 relative w-full mb-2 py-3 bg-[var(--builder-bg-primary)]">
      <div
        class="w-full overflow-x-auto pb-1 no-scrollbar"
        style="padding-left: max(1.5rem, calc((100% - 72rem) / 2 + 1.5rem)); padding-right: max(1.5rem, calc((100% - 72rem) / 2 + 1.5rem));"
      >
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-2">
            {#each kits as kit (kit.id)}
              <button
                onclick={() => (selected_kit_id = kit.id)}
                class="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap select-none {selected_kit_id ===
                kit.id
                  ? 'bg-[var(--builder-accent)] text-[var(--builder-accent-text)]'
                  : 'bg-[var(--builder-bg-secondary)] text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-tertiary)]'}"
              >
                <Icon icon={kit.icon} class="w-4 h-4" />
                {kit.name}
              </button>
            {/each}
            {#if has_uncategorized}
              <button
                onclick={() => (selected_kit_id = "_uncategorized")}
                class="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap select-none {selected_kit_id === '_uncategorized'
                  ? 'bg-[var(--builder-accent)] text-[var(--builder-accent-text)]'
                  : 'bg-[var(--builder-bg-secondary)] text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-tertiary)]'}"
              >
                Uncategorized
              </button>
            {/if}
          </div>

          <div class="w-px h-6 bg-[var(--builder-border)] mx-1"></div>

          <a
            href="/tinykit/new-kit"
            class="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)] transition-colors whitespace-nowrap"
          >
            <Plus class="w-4 h-4" />
            New Kit
          </a>
        </div>
      </div>
      <div
        class="pointer-events-none absolute right-0 top-0 bottom-2 w-16 bg-gradient-to-l from-black/5 to-transparent"
      ></div>
    </div>

    <!-- Kit Header & Projects Grid -->
    <div class="max-w-6xl mx-auto px-6">
      {#if selected_kit}
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <Icon
              icon={selected_kit.icon}
              class="w-6 h-6 text-[var(--builder-text-primary)]"
            />
            <h2
              class="text-2xl font-semibold text-[var(--builder-text-primary)]"
            >
              {selected_kit.name}
            </h2>
          </div>

          <div class="flex items-center gap-2">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                class="p-2 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)] rounded-md transition-colors"
              >
                <MoreVertical class="w-5 h-5" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item
                  class="gap-2 cursor-pointer"
                  onclick={handle_edit_kit}
                >
                  <Pencil class="w-4 h-4" />
                  Edit Kit
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  class="gap-2 text-red-400 focus:text-red-400 cursor-pointer"
                  onclick={() => open_delete_kit_dialog(selected_kit!)}
                >
                  <Trash2 class="w-4 h-4" />
                  Delete Kit
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
            <a
              href={get_new_project_url()}
              class="inline-flex items-center gap-2 px-4 py-2 bg-[var(--builder-bg-secondary)] text-[var(--builder-text-primary)] border border-[var(--builder-border)] rounded-lg hover:bg-[var(--builder-bg-tertiary)] transition-colors text-sm font-medium"
            >
              <Plus class="w-4 h-4" />
              New App
            </a>
          </div>
        </div>
      {:else if selected_kit_id === "_uncategorized"}
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-2xl font-semibold text-[var(--builder-text-primary)]">
            Uncategorized
          </h2>
        </div>
      {/if}

      <!-- Projects Grid -->
      {#if is_loading_projects}
        <div class="flex items-center justify-center py-20">
          <Loader2
            class="w-8 h-8 animate-spin text-[var(--builder-text-muted)]"
          />
        </div>
      {:else if filtered_projects.length === 0}
        <div
          class="flex flex-col items-center justify-center py-20 text-center"
        >
          <FolderOpen class="w-16 h-16 text-[var(--builder-text-muted)] mb-4" />
          <h2
            class="text-xl font-medium text-[var(--builder-text-primary)] mb-2"
          >
            {selected_kit_id ? "No projects in this kit" : "No projects yet"}
          </h2>
          <p class="text-[var(--builder-text-muted)] mb-6">
            {selected_kit_id
              ? "Add a project to this kit to get started"
              : "Create your first project to get started"}
          </p>
          <a
            href={get_new_project_url()}
            class="inline-flex items-center gap-2 px-4 py-2 bg-[var(--builder-bg-secondary)] text-[var(--builder-text-primary)] border border-[var(--builder-border)] rounded-lg hover:bg-[var(--builder-bg-tertiary)] transition-colors"
          >
            <Plus class="w-4 h-4" />
            New App
          </a>
        </div>
      {:else}
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each filtered_projects as project (project.id)}
            <div
              class="group relative bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg overflow-hidden hover:border-[var(--builder-accent)] transition-colors duration-150"
            >
              <a
                href={get_studio_href(project)}
                class="block aspect-[4/3] overflow-hidden"
              >
                <ProjectThumbnail
                  code={project.frontend_code}
                  design={project.design || []}
                  content={project.content || []}
                  data={project.data || {}}
                  compiled_html={project.published_html}
                  project_id={project.id}
                  fallback_icon={get_kit_icon(project)}
                />
              </a>

              <div class="p-4 flex items-start justify-between gap-2">
                <a href={get_studio_href(project)} class="block min-w-0 flex-1">
                  <h3
                    class="font-medium text-[var(--builder-text-primary)] group-hover:text-[var(--builder-accent)] transition-colors truncate"
                  >
                    {project.name}
                  </h3>
                  <p
                    class="text-sm text-[var(--builder-text-muted)] mt-1 truncate"
                  >
                    {get_domain(project)}
                  </p>
                </a>

                <div
                  class="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {#if project.domain}
                    <a
                      href="https://{project.domain}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="p-1.5 rounded text-[var(--builder-text-muted)] hover:text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-tertiary)] transition-colors"
                      title="Open {project.domain}"
                    >
                      <ExternalLink class="w-4 h-4" />
                    </a>
                  {/if}
                  <button
                    onclick={() => delete_project(project.id, project.name)}
                    disabled={deleting_project_id === project.id}
                    class="p-1.5 rounded text-[var(--builder-text-muted)] hover:text-red-400 hover:bg-[var(--builder-bg-tertiary)] transition-colors disabled:opacity-50"
                    title="Delete project"
                  >
                    {#if deleting_project_id === project.id}
                      <Loader2 class="w-4 h-4 animate-spin" />
                    {:else}
                      <Trash2 class="w-4 h-4" />
                    {/if}
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
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

