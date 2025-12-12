<script lang="ts">
  import Logo from "$lib/assets/Logo.svelte";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    Plus,
    Trash2,
    ExternalLink,
    Loader2,
    FolderOpen,
    LogOut,
    Settings,
  } from "lucide-svelte";
  import { get_saved_theme, apply_builder_theme } from "$lib/builder_themes";
  import { auth } from "$lib/pocketbase.svelte";
  import { project_service } from "$lib/services/project.svelte";
  import type { Project } from "../types";
  import ProjectThumbnail from "../components/ProjectThumbnail.svelte";

  let projects = $state<Project[]>([]);
  let is_loading = $state(true);
  let deleting_id = $state<string | null>(null);

  onMount(async () => {
    const theme = get_saved_theme();
    apply_builder_theme(theme);
    await load_projects();
  });

  async function load_projects() {
    is_loading = true;
    try {
      projects = await project_service.list();

      // Redirect to /new if no projects exist
      if (projects.length === 0) {
        goto("/tinykit/new");
        return;
      }
    } catch (err) {
      console.error("Failed to load projects:", err);
    } finally {
      is_loading = false;
    }
  }

  async function delete_project(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    deleting_id = id;
    try {
      await project_service.delete(id);
      projects = projects.filter((p) => p.id !== id);

      // Redirect to /new if no projects remain
      if (projects.length === 0) {
        goto("/tinykit/new");
      }
    } catch (err) {
      console.error("Failed to delete project:", err);
    } finally {
      deleting_id = null;
    }
  }

  function handle_logout() {
    auth.logout();
    goto("/login");
  }

  function get_domain(project: Project): string {
    // Use the domain field (required for all projects)
    return project.domain || "unknown";
  }

  function get_studio_href(project: Project): string {
    const domain = project.domain || "";
    // For localhost domains, stay on current host (preserves port)
    if (domain === "localhost" || domain.startsWith("localhost:")) {
      return `/tinykit/studio?id=${project.id}`;
    }
    return `//${domain}/tinykit/studio`;
  }
</script>

<svelte:head>
  <title>Projects - tinykit</title>
</svelte:head>

<div class="min-h-screen bg-[var(--builder-bg-primary)] safe-area-top">
  <!-- Header -->
  <header class="border-b border-[var(--builder-border)] px-6 py-4">
    <div class="max-w-6xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-3">
        <Logo width="4rem" />
      </div>
      <div class="flex items-center gap-3">
        <a
          href="/tinykit/new"
          class="inline-flex items-center gap-2 px-4 py-2 bg-[var(--builder-accent)] text-white rounded-lg hover:bg-[var(--builder-accent-hover)] transition-colors text-sm font-medium"
        >
          <Plus class="w-4 h-4" />
          New Project
        </a>
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
  <main class="px-6 py-8">
    <div class="max-w-6xl mx-auto">
      <h1
        class="text-2xl font-semibold text-[var(--builder-text-primary)] mb-6"
      >
        Your Projects
      </h1>

      {#if is_loading}
        <div class="flex items-center justify-center py-20">
          <Loader2
            class="w-8 h-8 animate-spin text-[var(--builder-text-muted)]"
          />
        </div>
      {:else if projects.length === 0}
        <!-- Empty state (shouldn't normally show due to redirect) -->
        <div
          class="flex flex-col items-center justify-center py-20 text-center"
        >
          <FolderOpen class="w-16 h-16 text-[var(--builder-text-muted)] mb-4" />
          <h2
            class="text-xl font-medium text-[var(--builder-text-primary)] mb-2"
          >
            No projects yet
          </h2>
          <p class="text-[var(--builder-text-muted)] mb-6">
            Create your first project to get started
          </p>
          <a
            href="/tinykit/new"
            class="inline-flex items-center gap-2 px-4 py-2 bg-[var(--builder-accent)] text-white rounded-lg hover:bg-[var(--builder-accent-hover)] transition-colors"
          >
            <Plus class="w-4 h-4" />
            New Project
          </a>
        </div>
      {:else}
        <!-- Project grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each projects as project}
            <div
              class="group relative bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg overflow-hidden hover:border-[var(--builder-accent)] transition-colors"
            >
              <!-- Preview thumbnail -->
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
                />
              </a>

              <!-- Project info with actions -->
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

                <!-- Actions (show on hover) -->
                <div
                  class="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <a
                    href="https://{project.domain}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="p-1.5 rounded text-[var(--builder-text-muted)] hover:text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-tertiary)] transition-colors"
                    title="Open {project.domain}"
                  >
                    <ExternalLink class="w-4 h-4" />
                  </a>
                  <button
                    onclick={() => delete_project(project.id, project.name)}
                    disabled={deleting_id === project.id}
                    class="p-1.5 rounded text-[var(--builder-text-muted)] hover:text-red-400 hover:bg-[var(--builder-bg-tertiary)] transition-colors disabled:opacity-50"
                    title="Delete project"
                  >
                    {#if deleting_id === project.id}
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
