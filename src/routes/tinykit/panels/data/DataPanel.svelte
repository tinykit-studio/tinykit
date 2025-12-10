<script lang="ts">
  import Icon from "@iconify/svelte";
  import { Database, Download, Plus } from "lucide-svelte";
  import { watch } from "runed";
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import DeleteButton from "../../components/DeleteButton.svelte";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Select from "$lib/components/ui/select";
  import * as Dialog from "$lib/components/ui/dialog";
  import type { DataRecord } from "../../types";
  import * as api from "../../lib/api.svelte";
  import { getProjectContext } from "../../context";
  import { pb } from "$lib/pocketbase.svelte";

  const { project_id } = getProjectContext();

  // Subscribe to realtime updates for data changes
  let realtime_unsubscribe: (() => void) | null = null;

  onMount(() => {
    pb.collection("_tk_projects")
      .subscribe(project_id, (e) => {
        if (e.action === "update" && selected_file) {
          // Refresh current collection when data changes
          const new_data = e.record.data?.[selected_file];
          if (new_data) {
            update_file_content(new_data);
          }
        }
      })
      .then((unsubscribe) => {
        realtime_unsubscribe = unsubscribe;
      })
      .catch((err) => {
        console.warn("[DataPanel] Failed to subscribe to realtime:", err);
      });

    return () => {
      realtime_unsubscribe?.();
    };
  });

  // Update file content from realtime data
  function update_file_content(raw_data: any) {
    if (raw_data && typeof raw_data === "object" && !Array.isArray(raw_data)) {
      let schema = raw_data.schema || [];
      const records = raw_data.records || [];
      if (schema.length === 0 && records.length > 0) {
        schema = infer_schema_from_records(records);
      }
      file_content = { schema: sort_columns(schema), records };
    } else if (Array.isArray(raw_data)) {
      const records = raw_data;
      const schema = infer_schema_from_records(records);
      file_content = { schema: sort_columns(schema), records };
    }
  }

  // Collection data format with schema
  type ColumnSchema = { name: string; type: string };
  type CollectionData = {
    schema: ColumnSchema[];
    records: DataRecord[];
  };

  type DataPanelProps = {
    data_files: string[];
    table_icons: Record<string, string>;
    target_field?: string | null;
    on_refresh_preview: () => void;
    on_target_consumed?: () => void;
  };

  let { data_files, table_icons, target_field = null, on_refresh_preview, on_target_consumed }: DataPanelProps =
    $props();

  // Watch for target_field changes to auto-select collection
  watch(
    () => [target_field, data_files.length] as const,
    ([field_name, files_count]) => {
      if (field_name && files_count > 0) {
        // Find matching collection (exact match or case-insensitive)
        const match = data_files.find(f => f === field_name || f.toLowerCase() === field_name.toLowerCase());
        if (match) {
          select_file(match);
          on_target_consumed?.();
        }
      }
    }
  );

  let selected_file = $state<string | null>(null);
  let file_content = $state<CollectionData | null>(null);
  let editing_record_index = $state<number | null>(null);
  let editing_record = $state<DataRecord | null>(null);
  let show_add_form = $state(false);
  let new_record = $state<DataRecord>({});
  let show_create_collection = $state(false);
  let show_edit_collection = $state(false);
  let new_collection_name = $state("");
  let new_columns = $state<ColumnSchema[]>([{ name: "id", type: "text" }]);

  // Sanitize collection name as user types
  function handle_collection_name_input(e: Event) {
    const input = e.target as HTMLInputElement;
    const sanitized = input.value.toLowerCase().replace(/\s+/g, "_");
    new_collection_name = sanitized;
  }

  // Sort columns with id first, then alphabetically
  function sort_columns(cols: ColumnSchema[]): ColumnSchema[] {
    return [...cols].sort((a, b) => {
      if (a.name === "id") return -1;
      if (b.name === "id") return 1;
      return a.name.localeCompare(b.name);
    });
  }

  // Get column names from schema, sorted with id first
  function get_column_names(schema: ColumnSchema[]): string[] {
    return sort_columns(schema).map(c => c.name);
  }

  // Column type options
  const COLUMN_TYPES = [
    { value: "text", label: "Text" },
    { value: "number", label: "Number" },
    { value: "boolean", label: "Boolean" },
    { value: "date", label: "Date" },
    { value: "email", label: "Email" },
    { value: "url", label: "URL" }
  ] as const;

  function get_type_label(type: string): string {
    return COLUMN_TYPES.find(t => t.value === type)?.label || "Text";
  }

  // Infer schema from records if missing
  function infer_schema_from_records(records: DataRecord[]): ColumnSchema[] {
    if (!records || records.length === 0) return []

    const first_record = records[0]
    const schema: ColumnSchema[] = []

    for (const [key, value] of Object.entries(first_record)) {
      let type = "text"
      if (typeof value === "number") type = "number"
      else if (typeof value === "boolean") type = "boolean"
      schema.push({ name: key, type })
    }

    return schema
  }

  async function select_file(filename: string) {
    selected_file = filename;
    try {
      const raw_data = await api.read_data_file(project_id, filename);

      // Handle different data formats
      if (raw_data && typeof raw_data === "object" && !Array.isArray(raw_data)) {
        // New format: { schema, records }
        let schema = raw_data.schema || []
        const records = raw_data.records || []

        // If schema is missing/empty but we have records, infer schema
        if (schema.length === 0 && records.length > 0) {
          schema = infer_schema_from_records(records)
        }

        file_content = {
          schema: sort_columns(schema),
          records
        };
      } else if (Array.isArray(raw_data)) {
        // Legacy format: just an array of records
        const records = raw_data
        const schema = infer_schema_from_records(records)
        file_content = {
          schema: sort_columns(schema),
          records
        };
      } else {
        file_content = { schema: [], records: [] };
      }
    } catch (error) {
      console.error("Failed to load data file:", error);
      file_content = { schema: [], records: [] };
    }
  }

  function generate_id() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  function start_add_record() {
    if (!file_content) return;
    const columns = get_column_names(file_content.schema);
    new_record = columns.reduce((acc, col) => ({
      ...acc,
      [col]: col === "id" ? generate_id() : ""
    }), {});
    show_add_form = true;
  }

  async function save_new_record() {
    if (!selected_file || !file_content) return;
    const updated: CollectionData = {
      schema: file_content.schema,
      records: [...file_content.records, new_record]
    };
    await save_collection(updated);
    show_add_form = false;
    new_record = {};
  }

  function start_edit_record(index: number) {
    if (!file_content) return;
    editing_record_index = index;
    editing_record = { ...file_content.records[index] };
  }

  async function save_edit_record() {
    if (!selected_file || !file_content || editing_record_index === null || !editing_record) return;
    const new_records = [...file_content.records];
    new_records[editing_record_index] = editing_record;
    const updated: CollectionData = {
      schema: file_content.schema,
      records: new_records
    };
    await save_collection(updated);
    editing_record_index = null;
    editing_record = null;
  }

  function cancel_edit() {
    editing_record_index = null;
    editing_record = null;
    show_add_form = false;
    new_record = {};
  }

  async function delete_record(index: number) {
    if (!selected_file || !file_content || !confirm("Delete this record?")) return;
    const new_records = file_content.records.filter((_, i) => i !== index);
    const updated: CollectionData = {
      schema: file_content.schema,
      records: new_records
    };
    await save_collection(updated);
  }

  async function save_collection(data: CollectionData) {
    if (!selected_file) return;
    try {
      await api.write_data_file(project_id, selected_file, data);
      file_content = data;
      on_refresh_preview();
      window.dispatchEvent(new CustomEvent("tinykit:config-updated"));
    } catch (error) {
      console.error("Failed to save collection:", error);
    }
  }

  function add_column() {
    new_columns = [...new_columns, { name: "", type: "text" }];
  }

  function remove_column(index: number) {
    new_columns = new_columns.filter((_, i) => i !== index);
  }

  async function refresh_data_files() {
    try {
      const files = await api.load_data_files(project_id);
      data_files = files;
    } catch (error) {
      console.error("Failed to refresh data files:", error);
    }
  }

  async function create_collection() {
    const collection_id = new_collection_name.trim();
    if (!collection_id) return;

    try {
      // Filter out columns with empty names and create schema
      const schema = new_columns
        .filter(col => col.name.trim())
        .map(col => ({ name: col.name.trim(), type: col.type }));

      // Create collection with schema and empty records
      const collection_data: CollectionData = {
        schema: sort_columns(schema),
        records: []
      };

      await api.write_data_file(project_id, collection_id, collection_data);
      await refresh_data_files();

      show_create_collection = false;
      new_collection_name = "";
      new_columns = [{ name: "id", type: "text" }];

      // Auto-select the new collection
      await select_file(collection_id);

      // Notify Preview to update its data collections for import map
      window.dispatchEvent(new CustomEvent("tinykit:config-updated"));
    } catch (error) {
      console.error("Failed to create collection:", error);
    }
  }

  function cancel_create_collection() {
    show_create_collection = false;
    show_edit_collection = false;
    new_collection_name = "";
    new_columns = [{ name: "id", type: "text" }];
  }

  async function delete_collection(filename: string) {
    if (!confirm(`Delete collection "${filename}"? This cannot be undone.`))
      return;

    try {
      await api.delete_data_file(project_id, filename);
      if (selected_file === filename) {
        selected_file = null;
        file_content = null;
      }
      await refresh_data_files();
    } catch (error) {
      console.error("Failed to delete collection:", error);
    }
  }

  function start_edit_collection() {
    if (!selected_file || !file_content) return;
    // Load current schema, sorted with id first
    new_columns = sort_columns([...file_content.schema]);
    show_edit_collection = true;
  }

  function get_default_value(type: string): any {
    switch (type) {
      case "number": return 0;
      case "boolean": return false;
      default: return "";
    }
  }

  async function save_edited_collection() {
    if (!selected_file || !file_content) return;

    try {
      // Filter out columns with empty names
      const new_schema = new_columns
        .filter(col => col.name.trim())
        .map(col => ({ name: col.name.trim(), type: col.type }));

      // Get old schema column names for comparison
      const old_column_names = new Set(file_content.schema.map(c => c.name));
      const new_column_names = new Set(new_schema.map(c => c.name));

      // Transform existing records to match new schema
      const new_records = file_content.records.map((old_record) => {
        const transformed: Record<string, any> = {};
        for (const col of new_schema) {
          if (old_record.hasOwnProperty(col.name)) {
            // Keep existing value
            transformed[col.name] = old_record[col.name];
          } else {
            // New column - use default value
            transformed[col.name] = get_default_value(col.type);
          }
        }
        return transformed;
      });

      const updated: CollectionData = {
        schema: sort_columns(new_schema),
        records: new_records
      };

      await save_collection(updated);
      show_edit_collection = false;
      new_columns = [{ name: "id", type: "text" }];
    } catch (error) {
      console.error("Failed to edit collection:", error);
    }
  }

  function download_collection() {
    if (!selected_file || !file_content) return;
    const json = JSON.stringify(file_content.records, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selected_file}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="h-full flex font-sans text-sm">
  <!-- Collections Sidebar -->
  <div class="w-48 border-r border-[var(--builder-border)] flex flex-col">
    <div class="p-3 border-b border-[var(--builder-border)]">
      <h3
        class="text-[var(--builder-text-secondary)] text-xs uppercase tracking-wide"
      >
        Collections
      </h3>
    </div>
    <div class="flex-1 overflow-y-auto">
      {#if data_files.length > 0}
        {#each data_files as file (file)}
          <div class="group relative">
            <button
              onclick={() => select_file(file)}
              class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors {selected_file ===
              file
                ? 'bg-[var(--builder-bg-tertiary)] text-[var(--builder-text-primary)]'
                : 'text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)]'}"
            >
              <Icon
                icon={table_icons[file] || "mdi:database"}
                class="w-4 h-4 flex-shrink-0"
              />
              <span class="flex-1 truncate">{file}</span>
            </button>
            <button
              onclick={(e) => {
                e.stopPropagation();
                delete_collection(file);
              }}
              class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-[var(--builder-text-secondary)] hover:text-red-400 transition-all"
              title="Delete collection"
            >
              ×
            </button>
          </div>
        {/each}
        <button
          onclick={() => (show_create_collection = true)}
          class="w-full px-3 py-2 text-left text-sm text-[var(--builder-accent)] hover:opacity-80 hover:bg-[var(--builder-bg-secondary)] transition-colors"
        >
          + Create Collection
        </button>
      {:else}
        <div class="p-3 text-[var(--builder-text-secondary)] text-xs">
          No collections yet
        </div>
        <button
          onclick={() => (show_create_collection = true)}
          class="w-full px-3 py-2 text-left text-sm text-[var(--builder-accent)] hover:opacity-80 hover:bg-[var(--builder-bg-secondary)] transition-colors"
        >
          + Create Collection
        </button>
      {/if}
    </div>
  </div>

  <!-- Table View -->
  <div class="flex-1 flex flex-col overflow-hidden">
    {#if selected_file && file_content}
      {@const collection_name = selected_file.replace(".json", "")}
      {@const records = file_content.records}
      {@const columns = get_column_names(file_content.schema)}
      <div
        class="border-b border-[var(--builder-border)] bg-[var(--builder-bg-primary)] px-4 py-3 flex items-center justify-between min-w-[400px]"
      >
        <div class="flex items-center gap-3">
          <Icon
            icon={table_icons[selected_file] || "mdi:database"}
            class="w-5 h-5 text-[var(--builder-text-secondary)]"
          />
          <span class="text-[var(--builder-text-primary)] font-medium"
            >{collection_name}</span
          >
          <span class="text-[var(--builder-text-secondary)] text-xs"
            >{records.length} records</span
          >
          <button
            onclick={download_collection}
            class="p-1 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
            title="Download JSON"
          >
            <Download class="w-3.5 h-3.5" />
          </button>
        </div>
        <div class="flex items-center gap-2">
          <button
            onclick={start_edit_collection}
            class="px-3 py-1.5 text-xs text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
          >
            Edit
          </button>
          <button
            onclick={start_add_record}
            class="px-3 py-1.5 text-xs bg-[var(--builder-accent)] hover:opacity-90 text-white rounded transition-colors font-medium"
          >
            + Add
          </button>
        </div>
      </div>
      <div class="flex-1 overflow-auto">
        {#if show_add_form}
          <div
            class="p-4 border-b border-[var(--builder-border)] bg-[var(--builder-bg-secondary)]"
          >
            <div class="grid grid-cols-2 gap-3 mb-3">
              {#each columns as col}
                <div>
                  <label
                    class="text-xs text-[var(--builder-text-secondary)] block mb-1"
                    >{col}</label
                  >
                  <input
                    type="text"
                    bind:value={new_record[col]}
                    class="w-full px-2 py-1 text-sm bg-[var(--builder-bg-primary)] border border-[var(--builder-border)] rounded text-[var(--builder-text-primary)] focus:border-[var(--builder-accent)] focus:outline-none"
                  />
                </div>
              {/each}
            </div>
            <div class="flex gap-2">
              <button
                onclick={save_new_record}
                class="px-3 py-1 text-xs bg-[var(--builder-accent)] hover:opacity-90 text-white rounded"
                >Save</button
              >
              <button
                onclick={cancel_edit}
                class="px-3 py-1 text-xs text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)]"
                >Cancel</button
              >
            </div>
          </div>
        {/if}
        {#if records.length > 0 && columns.length > 0}
          <table class="w-full border-collapse">
            <thead class="sticky top-0 bg-[var(--builder-bg-secondary)] z-10">
              <tr class="border-b border-[var(--builder-border)]">
                {#each columns as col}
                  <th
                    class="px-4 py-3 text-left text-xs text-[var(--builder-text-secondary)] font-normal whitespace-nowrap uppercase tracking-wide"
                  >
                    {col}
                  </th>
                {/each}
                <th
                  class="px-4 py-3 text-right text-xs text-[var(--builder-text-secondary)] font-normal w-28 uppercase tracking-wide"
                ></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[var(--builder-border)]">
              {#each records as record, i (i)}
                {#if editing_record_index === i && editing_record}
                  <tr class="bg-[var(--builder-bg-secondary)]">
                    {#each columns as col}
                      <td class="px-3 py-2">
                        <input
                          type="text"
                          bind:value={editing_record[col]}
                          class="w-full px-2 py-1.5 text-sm bg-[var(--builder-bg-primary)] border border-[var(--builder-border)] rounded text-[var(--builder-text-primary)] focus:border-[var(--builder-accent)] focus:outline-none"
                        />
                      </td>
                    {/each}
                    <td class="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onclick={save_edit_record}
                        class="text-xs text-[var(--builder-accent)] hover:opacity-80 mr-3"
                        >Save</button
                      >
                      <button
                        onclick={cancel_edit}
                        class="text-xs text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)]"
                        >Cancel</button
                      >
                    </td>
                  </tr>
                {:else}
                  <tr class="hover:bg-[var(--builder-bg-secondary)] group transition-colors">
                    {#each columns as col}
                      {@const val = record[col]}
                      <td
                        class="px-4 py-3 text-sm text-[var(--builder-text-primary)] max-w-xs truncate"
                      >
                        {#if val === null || val === undefined}
                          <span
                            class="text-[var(--builder-text-secondary)] italic opacity-60"
                            >null</span
                          >
                        {:else if typeof val === "object"}
                          <span class="text-[var(--builder-text-secondary)] font-mono text-xs"
                            >{JSON.stringify(val)}</span
                          >
                        {:else if typeof val === "boolean"}
                          <span class="{val ? 'text-orange-400' : 'text-[var(--builder-text-secondary)]'}">{val}</span
                          >
                        {:else}
                          {val}
                        {/if}
                      </td>
                    {/each}
                    <td
                      class="px-4 py-3 text-right opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
                    >
                      <button
                        onclick={() => start_edit_record(i)}
                        class="text-xs text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] mr-3"
                        >Edit</button
                      >
                      <button
                        onclick={() => delete_record(i)}
                        class="text-xs text-[var(--builder-text-secondary)] hover:text-red-400"
                        >Delete</button
                      >
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        {:else if !show_add_form}
          <div class="flex-1 flex items-center justify-center h-full">
            <p class="text-[var(--builder-text-secondary)] text-sm">
              No records in this collection
            </p>
          </div>
        {/if}
      </div>
    {:else if selected_file}
      <div class="flex-1 flex items-center justify-center">
        <p class="text-[var(--builder-text-secondary)] text-sm">Loading...</p>
      </div>
    {:else}
      <div class="flex-1 flex items-center justify-center">
        <div class="text-center text-[var(--builder-text-secondary)]">
          <Database class="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p class="text-sm">Select a collection to view records</p>
        </div>
      </div>
    {/if}
  </div>

  <!-- Create Collection Modal -->
  <Dialog.Root bind:open={show_create_collection}>
    <Dialog.Content class="sm:max-w-lg">
      <Dialog.Header>
        <Dialog.Title>Create New Collection</Dialog.Title>
        <Dialog.Description>
          Define the structure for your new data collection.
        </Dialog.Description>
      </Dialog.Header>

      <form
        onsubmit={(e) => {
          e.preventDefault();
          create_collection();
        }}
        class="flex flex-col gap-4 py-4"
      >
        <div class="flex flex-col gap-1.5">
          <Label for="collection-name">Collection Name</Label>
          <Input
            id="collection-name"
            bind:value={new_collection_name}
            oninput={handle_collection_name_input}
            placeholder="e.g., users, products, orders"
            required
          />
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <Label>Columns</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onclick={add_column}
              class="h-auto py-1 px-2 text-xs"
            >
              <Plus class="h-3 w-3 mr-1" />
              Add Column
            </Button>
          </div>

          <div class="flex flex-col gap-2">
            {#each new_columns as column, i (i)}
              <div class="flex gap-2 items-center">
                <Input
                  bind:value={column.name}
                  placeholder="Column name"
                  class="flex-1"
                />
                <Select.Root
                  type="single"
                  value={column.type}
                  onValueChange={(v) => {
                    if (v) column.type = v;
                  }}
                >
                  <Select.Trigger class="w-28">
                    {get_type_label(column.type)}
                  </Select.Trigger>
                  <Select.Content>
                    {#each COLUMN_TYPES as type_option (type_option.value)}
                      <Select.Item value={type_option.value} label={type_option.label}>
                        {type_option.label}
                      </Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
                <DeleteButton
                  onclick={() => remove_column(i)}
                  disabled={new_columns.length === 1}
                />
              </div>
            {/each}
          </div>
        </div>

        <Dialog.Footer class="pt-2">
          <Button
            type="button"
            variant="ghost"
            onclick={cancel_create_collection}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!new_collection_name.trim() ||
              new_columns.every((c) => !c.name.trim())}
          >
            Create Collection
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>

  <!-- Edit Collection Modal -->
  <Dialog.Root bind:open={show_edit_collection}>
    <Dialog.Content class="sm:max-w-lg">
      <Dialog.Header>
        <Dialog.Title>Edit Collection: {selected_file}</Dialog.Title>
        <Dialog.Description>
          Modify the column structure for this collection.
        </Dialog.Description>
      </Dialog.Header>

      <form
        onsubmit={(e) => {
          e.preventDefault();
          save_edited_collection();
        }}
        class="flex flex-col gap-4 py-4"
      >
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <Label>Columns</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onclick={add_column}
              class="h-auto py-1 px-2 text-xs"
            >
              <Plus class="h-3 w-3 mr-1" />
              Add Column
            </Button>
          </div>

          <div class="flex flex-col gap-2">
            {#each new_columns as column, i (i)}
              <div class="flex gap-2 items-center">
                <Input
                  bind:value={column.name}
                  placeholder="Column name"
                  class="flex-1"
                />
                <Select.Root
                  type="single"
                  value={column.type}
                  onValueChange={(v) => {
                    if (v) column.type = v;
                  }}
                >
                  <Select.Trigger class="w-28">
                    {get_type_label(column.type)}
                  </Select.Trigger>
                  <Select.Content>
                    {#each COLUMN_TYPES as type_option (type_option.value)}
                      <Select.Item value={type_option.value} label={type_option.label}>
                        {type_option.label}
                      </Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
                <DeleteButton
                  onclick={() => remove_column(i)}
                  disabled={new_columns.length === 1}
                />
              </div>
            {/each}
          </div>

          <p class="text-xs text-[var(--builder-text-secondary)] opacity-60">
            Note: Removing columns will delete that data from all records.
            Adding columns will use default values for existing records.
          </p>
        </div>

        <Dialog.Footer class="pt-2">
          <Button
            type="button"
            variant="ghost"
            onclick={cancel_create_collection}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={new_columns.every((c) => !c.name.trim())}
          >
            Save Changes
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>
</div>
