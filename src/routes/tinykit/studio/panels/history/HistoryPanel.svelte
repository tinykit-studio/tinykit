<script lang="ts">
  import type { Snapshot } from "../../../types";
  import * as api from "../../../lib/api.svelte";
  import { getProjectContext } from "../../../context";
  import { Download, Upload, Code, Palette, FileText, Database } from "lucide-svelte";
  import { getProjectStore } from "../../project.svelte";
  import { onMount } from "svelte";
  import { normalizeProjectImport } from "$lib/project-import";

  const { project_id } = getProjectContext();
  const store = getProjectStore();

  type HistoryPanelProps = {
    is_restoring?: boolean;
    on_snapshot_created?: () => Promise<void>;
    on_snapshot_restored?: () => Promise<void>;
  };

  let {
    is_restoring = $bindable(false),
    on_snapshot_created,
    on_snapshot_restored,
  }: HistoryPanelProps = $props();

  let snapshots = $derived(store.snapshots);
  let is_loading = $derived(store.snapshots_loading);

  onMount(() => {
    store.loadSnapshots();
  });

  let file_input: HTMLInputElement | undefined = $state();

  async function create_snapshot_manual() {
    try {
      await api.create_snapshot(project_id, "Manual snapshot");
      await on_snapshot_created?.();
    } catch (err) {
      console.error("Failed to create snapshot:", err);
    }
  }

  async function restore_snapshot(id: string) {
    if (
      !confirm(
        "Restore this snapshot? Code, design, content, and database records will be overwritten.",
      )
    )
      return;
    is_restoring = true;
    try {
      await api.restore_snapshot(project_id, id);
      await on_snapshot_restored?.();
    } catch (err) {
      console.error("Failed to restore snapshot:", err);
    } finally {
      is_restoring = false;
    }
  }

  async function delete_snapshot(id: string) {
    try {
      await api.delete_snapshot(project_id, id);
      snapshots = snapshots.filter((s) => s.id !== id);
    } catch (err) {
      console.error("Failed to delete snapshot:", err);
    }
  }

  function download_snapshot(snapshot: any) {
    const data = {
      id: snapshot.id,
      timestamp: snapshot.timestamp,
      description: snapshot.description,
      frontend_code: snapshot.frontend_code || "",
      design: snapshot.design || [],
      content: snapshot.content || [],
      collections: snapshot.collections || [],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const date = new Date(snapshot.timestamp).toISOString().split("T")[0];
    a.download = `snapshot-${date}-${snapshot.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function trigger_file_upload() {
    file_input?.click();
  }

  async function handle_file_upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const data = normalizeProjectImport(raw, file.name);
      if (store.project?.source_bundle || raw.source_bundle || raw.asset_files?.length || raw.source_asset_files?.length || raw.assets?.length) throw new Error('Use New app → Import app to restore exports with uploaded files or multiple source files.');

      if (
        !confirm(
          "Restore from this file? Code, design, content, and database records will be overwritten.",
        )
      ) {
        return;
      }

      is_restoring = true;

      await api.create_snapshot(project_id, 'Before importing from file');
      await api.restore_from_snapshot_data(project_id, {
        frontend_code: data.frontend_code,
        design: data.design,
        content: data.content,
        data: Object.hasOwn(raw, 'data') || Object.hasOwn(raw, 'collections') ? data.data : undefined,
        source_bundle: null,
      });

      await on_snapshot_restored?.();
    } catch (err) {
      console.error("Failed to restore from file:", err);
      alert(
        err instanceof Error ? err.message : "Could not restore this file.",
      );
    } finally {
      is_restoring = false;
      // Reset input so same file can be selected again
      input.value = "";
    }
  }

  function format_time_ago(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  type ToolBadge = { type: "code" | "design" | "content" | "data"; count: number };

  function get_tool_badges(tools?: string[]): ToolBadge[] {
    if (!tools || tools.length === 0) return [];

    const counts: Record<string, number> = {};
    for (const tool of tools) {
      counts[tool] = (counts[tool] || 0) + 1;
    }

    const badges: ToolBadge[] = [];

    // Code changes
    if (counts["write_code"]) {
      badges.push({ type: "code", count: counts["write_code"] });
    }

    // Design fields
    const design_count = (counts["create_design_field"] || 0) + (counts["update_design_field"] || 0);
    if (design_count > 0) {
      badges.push({ type: "design", count: design_count });
    }

    // Content fields
    const content_count = (counts["create_content_field"] || 0) + (counts["update_content_field"] || 0);
    if (content_count > 0) {
      badges.push({ type: "content", count: content_count });
    }

    // Data operations
    const data_count = (counts["create_data_table"] || 0) + (counts["add_data_record"] || 0) +
                       (counts["update_data_record"] || 0) + (counts["delete_data_record"] || 0);
    if (data_count > 0) {
      badges.push({ type: "data", count: data_count });
    }

    return badges;
  }

  type ToolSummaryLine = { icon: "code" | "design" | "content" | "data"; text: string };

  function get_tools_summary(tools?: string[]): ToolSummaryLine[] {
    if (!tools || tools.length === 0) return [];

    const counts: Record<string, number> = {};
    for (const tool of tools) {
      counts[tool] = (counts[tool] || 0) + 1;
    }

    const lines: ToolSummaryLine[] = [];

    if (counts["write_code"]) {
      lines.push({ icon: "code", text: "Code updated" });
    }
    if (counts["create_design_field"]) {
      const n = counts["create_design_field"];
      lines.push({ icon: "design", text: `${n} design field${n > 1 ? "s" : ""} created` });
    }
    if (counts["update_design_field"]) {
      const n = counts["update_design_field"];
      lines.push({ icon: "design", text: `${n} design field${n > 1 ? "s" : ""} updated` });
    }
    if (counts["create_content_field"]) {
      const n = counts["create_content_field"];
      lines.push({ icon: "content", text: `${n} content field${n > 1 ? "s" : ""} created` });
    }
    if (counts["update_content_field"]) {
      const n = counts["update_content_field"];
      lines.push({ icon: "content", text: `${n} content field${n > 1 ? "s" : ""} updated` });
    }
    if (counts["create_data_table"]) {
      const n = counts["create_data_table"];
      lines.push({ icon: "data", text: `${n} data table${n > 1 ? "s" : ""} created` });
    }
    if (counts["add_data_record"]) {
      const n = counts["add_data_record"];
      lines.push({ icon: "data", text: `${n} record${n > 1 ? "s" : ""} added` });
    }
    if (counts["update_data_record"]) {
      const n = counts["update_data_record"];
      lines.push({ icon: "data", text: `${n} record${n > 1 ? "s" : ""} updated` });
    }
    if (counts["delete_data_record"]) {
      const n = counts["delete_data_record"];
      lines.push({ icon: "data", text: `${n} record${n > 1 ? "s" : ""} deleted` });
    }

    return lines;
  }
</script>

<div class="h-full flex flex-col overflow-hidden">
  <!-- Hidden file input for upload -->
  <input
    bind:this={file_input}
    type="file"
    accept=".json"
    class="hidden"
    onchange={handle_file_upload}
  />

  <div
    class="p-4 border-b border-[var(--builder-border)] flex items-center justify-between"
  >
    <div>
      <h3 class="text-sm font-sans text-[var(--builder-text-secondary)] mb-1">
        Snapshots
      </h3>
      <p class="text-xs text-[var(--builder-text-secondary)] opacity-60">
        Auto-saved when Agent makes changes
      </p>
    </div>
    <div class="flex gap-2">
      <button
        class="text-xs px-2 py-1.5 bg-[var(--builder-bg-tertiary)] hover:bg-[var(--builder-accent)] text-[var(--builder-text-secondary)] hover:text-[var(--builder-accent-text)] rounded transition-colors flex items-center gap-1"
        onclick={trigger_file_upload}
        title="Restore from file"
      >
        <Upload class="w-3 h-3" />
      </button>
      <button
        class="text-xs px-3 py-1.5 bg-[var(--builder-bg-tertiary)] hover:bg-[var(--builder-accent)] text-[var(--builder-text-secondary)] hover:text-[var(--builder-accent-text)] rounded transition-colors"
        onclick={create_snapshot_manual}
      >
        Save
      </button>
    </div>
  </div>
  <div class="flex-1 overflow-y-auto">
    {#if is_loading}
      <div class="p-4 text-center text-[var(--builder-text-secondary)] text-sm">
        Loading...
      </div>
    {:else if snapshots.length === 0}
      <div class="p-4 text-center text-[var(--builder-text-secondary)] text-sm">
        No snapshots yet
      </div>
    {:else}
      <div class="divide-y divide-[var(--builder-border)]">
        {#each snapshots as snapshot (snapshot.id)}
          {#if snapshot.description === "Before reset"}
            <div class="flex items-center gap-2 px-3 py-2 bg-red-950/30">
              <div class="flex-1 h-px bg-red-500/50"></div>
              <span class="text-[10px] text-red-400 uppercase tracking-wider"
                >Reset</span
              >
              <div class="flex-1 h-px bg-red-500/50"></div>
            </div>
          {/if}
          <div class="p-3 hover:bg-[var(--builder-bg-secondary)] group relative">
            <p class="text-sm text-[var(--builder-text-primary)]">
              {snapshot.description}
            </p>
            <div class="flex items-center gap-2 mt-1">
              <span class="text-xs text-[var(--builder-text-secondary)]">
                {format_time_ago(snapshot.timestamp)}
              </span>
              {#if get_tool_badges(snapshot.tools).length > 0}
                <div class="badges-container relative">
                  <div class="flex items-center gap-1.5">
                    {#each get_tool_badges(snapshot.tools) as badge}
                      <span class="inline-flex items-center gap-0.5 text-[var(--builder-text-secondary)]">
                        {#if badge.type === "code"}
                          <Code class="w-3 h-3" />
                        {:else if badge.type === "design"}
                          <Palette class="w-3 h-3" />
                        {:else if badge.type === "content"}
                          <FileText class="w-3 h-3" />
                        {:else if badge.type === "data"}
                          <Database class="w-3 h-3" />
                        {/if}
                        {#if badge.count > 1}
                          <span class="text-[10px]">{badge.count}</span>
                        {/if}
                      </span>
                    {/each}
                  </div>
                  <div class="badges-tooltip">
                    {#each get_tools_summary(snapshot.tools) as line}
                      <div class="flex items-center gap-1.5">
                        {#if line.icon === "code"}
                          <Code class="w-3 h-3 opacity-60" />
                        {:else if line.icon === "design"}
                          <Palette class="w-3 h-3 opacity-60" />
                        {:else if line.icon === "content"}
                          <FileText class="w-3 h-3 opacity-60" />
                        {:else if line.icon === "data"}
                          <Database class="w-3 h-3 opacity-60" />
                        {/if}
                        <span>{line.text}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
            <div
              class="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 transition-opacity bg-[var(--builder-bg-secondary)] rounded px-1 py-1 snapshot-actions"
            >
              <button
                class="text-xs px-2 py-1 bg-[var(--builder-bg-tertiary)] hover:bg-[var(--builder-accent)] text-[var(--builder-text-secondary)] hover:text-[var(--builder-accent-text)] rounded transition-colors flex items-center"
                onclick={() => download_snapshot(snapshot)}
                title="Download snapshot"
              >
                <Download class="w-3 h-3" />
              </button>
              <button
                class="text-xs px-2 py-1 bg-[var(--builder-bg-tertiary)] hover:bg-[var(--builder-accent)] text-[var(--builder-text-secondary)] hover:text-[var(--builder-accent-text)] rounded transition-colors"
                onclick={() => restore_snapshot(snapshot.id)}
                disabled={is_restoring}
              >
                Restore
              </button>
              <button
                class="text-xs px-2 py-1 bg-[var(--builder-bg-tertiary)] hover:bg-red-600 text-[var(--builder-text-secondary)] hover:text-white rounded transition-colors"
                onclick={() => delete_snapshot(snapshot.id)}
              >
                ×
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  /* Always show on touch devices, hide until hover on devices with hover */
  .snapshot-actions {
    opacity: 1;
  }

  @media (hover: hover) {
    .snapshot-actions {
      opacity: 0;
    }

    .group:hover .snapshot-actions {
      opacity: 1;
    }
  }

  /* Tooltip for badges */
  .badges-container {
    cursor: default;
  }

  .badges-tooltip {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    padding: 6px 10px;
    background: var(--builder-bg-tertiary);
    border: 1px solid var(--builder-border);
    border-radius: 6px;
    font-size: 11px;
    color: var(--builder-text-secondary);
    white-space: nowrap;
    z-index: 50;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .badges-container:hover .badges-tooltip {
    display: block;
  }
</style>
