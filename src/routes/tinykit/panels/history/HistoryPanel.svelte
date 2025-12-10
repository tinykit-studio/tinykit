<script lang="ts">
  import type { Snapshot } from "../../types";
  import * as api from "../../lib/api.svelte";
  import { getProjectContext } from "../../context";
  import { Download, Upload } from "lucide-svelte";

  const { project_id } = getProjectContext();

  type HistoryPanelProps = {
    snapshots: Snapshot[];
    is_loading: boolean;
    is_restoring: boolean;
    on_snapshot_created: () => Promise<void>;
    on_snapshot_restored: () => Promise<void>;
  };

  let {
    snapshots = $bindable(),
    is_loading,
    is_restoring = $bindable(),
    on_snapshot_created,
    on_snapshot_restored,
  }: HistoryPanelProps = $props();

  let file_input: HTMLInputElement | undefined = $state();

  async function create_snapshot_manual() {
    try {
      await api.create_snapshot(project_id, "Manual snapshot");
      await on_snapshot_created();
    } catch (err) {
      console.error("Failed to create snapshot:", err);
    }
  }

  async function restore_snapshot(id: string) {
    if (!confirm("Restore this snapshot? Code, design, content, and database records will be overwritten."))
      return;
    is_restoring = true;
    try {
      await api.restore_snapshot(project_id, id);
      await on_snapshot_restored();
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
      const data = JSON.parse(text);

      // Validate snapshot structure
      if (!data.frontend_code && !data.design && !data.content) {
        alert("Invalid snapshot file: missing required data");
        return;
      }

      if (
        !confirm("Restore from this file? Code, design, content, and database records will be overwritten.")
      ) {
        return;
      }

      is_restoring = true;

      // Restore directly using the snapshot data
      await api.restore_from_snapshot_data(project_id, {
        frontend_code: data.frontend_code || "",
        design: data.design || [],
        content: data.content || [],
        collections: data.collections || [],
      });

      await on_snapshot_restored();
    } catch (err) {
      console.error("Failed to restore from file:", err);
      alert(
        "Failed to restore from file. Make sure it's a valid snapshot JSON.",
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
        class="text-xs px-2 py-1.5 bg-[var(--builder-bg-tertiary)] hover:bg-[var(--builder-accent)] text-[var(--builder-text-secondary)] hover:text-white rounded transition-colors flex items-center gap-1"
        onclick={trigger_file_upload}
        title="Restore from file"
      >
        <Upload class="w-3 h-3" />
      </button>
      <button
        class="text-xs px-3 py-1.5 bg-[var(--builder-bg-tertiary)] hover:bg-[var(--builder-accent)] text-[var(--builder-text-secondary)] hover:text-white rounded transition-colors"
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
          <div class="p-3 hover:bg-[var(--builder-bg-secondary)] group">
            <div class="flex items-start justify-between">
              <div class="flex-1 min-w-0">
                <p class="text-sm text-[var(--builder-text-primary)] truncate">
                  {snapshot.description}
                </p>
                <p class="text-xs text-[var(--builder-text-secondary)] mt-1">
                  {format_time_ago(snapshot.timestamp)} · {snapshot.file_count} files
                </p>
              </div>
              <div
                class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2"
              >
                <button
                  class="text-xs px-2 py-1 bg-[var(--builder-bg-tertiary)] hover:bg-[var(--builder-accent)] text-[var(--builder-text-secondary)] hover:text-white rounded transition-colors flex items-center"
                  onclick={() => download_snapshot(snapshot)}
                  title="Download snapshot"
                >
                  <Download class="w-3 h-3" />
                </button>
                <button
                  class="text-xs px-2 py-1 bg-[var(--builder-bg-tertiary)] hover:bg-[var(--builder-accent)] text-[var(--builder-text-secondary)] hover:text-white rounded transition-colors"
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
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
