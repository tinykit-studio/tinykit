<script lang="ts">
  import Icon from "@iconify/svelte";
  import { fade } from "svelte/transition";
  import { Database, Download, Plus, Image, File, Trash2 } from "lucide-svelte";
  import { watch } from "runed";
  import { onMount } from "svelte";
  import { dndzone } from "svelte-dnd-action";
  import { Button } from "$lib/components/ui/button";
  import DeleteButton from "../../components/DeleteButton.svelte";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Select from "$lib/components/ui/select";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Switch } from "$lib/components/ui/switch";
  import type { DataRecord } from "../../../types";
  import * as api from "../../../lib/api.svelte";
  import { getProjectContext } from "../../../context";
  import { pb } from "$lib/pocketbase.svelte";
  import { getProjectStore } from "../../project.svelte";
  import FileField from "../../components/FileField.svelte";
  import JsonEditor from "../../components/JsonEditor.svelte";
  import IconPicker from "../../components/IconPicker.svelte";

  const { project_id } = getProjectContext();
  const store = getProjectStore();

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
        // Only sort inferred schemas (legacy data without explicit order)
        schema = sort_columns(infer_schema_from_records(records));
      }
      file_content = { schema, records };
    } else if (Array.isArray(raw_data)) {
      // Legacy format - sort inferred schema
      const records = raw_data;
      const schema = sort_columns(infer_schema_from_records(records));
      file_content = { schema, records };
    }
  }

  // Collection data format with schema
  type ColumnSchema = { name: string; type: string };
  type CollectionData = {
    schema: ColumnSchema[];
    records: DataRecord[];
    icon?: string;
  };

  type DataPanelProps = {
    target_field?: string | null;
    on_refresh_preview: () => void;
    on_target_consumed?: () => void;
  };

  let {
    target_field = null,
    on_refresh_preview,
    on_target_consumed,
  }: DataPanelProps = $props();

  let data_files = $derived(store.data_files);
  let table_icons = $derived(store.table_icons);

  // LocalStorage key for last opened collection (scoped by project)
  const LAST_COLLECTION_KEY = `tinykit:last_collection:${project_id}`;

  function get_last_opened_collection(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(LAST_COLLECTION_KEY);
  }

  function save_last_opened_collection(name: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem(LAST_COLLECTION_KEY, name);
  }

  // Watch for target_field changes to auto-select collection
  watch(
    () => [target_field, data_files.length] as const,
    ([field_name, files_count]) => {
      if (field_name && files_count > 0) {
        // Find matching collection (exact match or case-insensitive)
        const match = data_files.find(
          (f) =>
            f === field_name || f.toLowerCase() === field_name.toLowerCase(),
        );
        if (match) {
          select_file(match);
          on_target_consumed?.();
        }
      } else if (!selected_file && files_count > 0) {
        // Try to restore last opened collection, fall back to first
        const saved = get_last_opened_collection();
        const to_select = saved && data_files.includes(saved) ? saved : data_files[0];
        select_file(to_select);
      }
    },
  );

  // Save selected collection to localStorage when it changes
  $effect(() => {
    if (selected_file) {
      save_last_opened_collection(selected_file);
    }
  });

  let selected_file = $state<string | null>(null);
  let file_content = $state<CollectionData | null>(null);
  let editing_record_index = $state<number | null>(null);
  let editing_record = $state<DataRecord | null>(null);
  let show_edit_dialog = $state(false);
  let show_add_form = $state(false);
  let new_record = $state<DataRecord>({});
  let show_create_collection = $state(false);
  let show_edit_collection = $state(false);
  let new_collection_name = $state("");
  let new_collection_icon = $state("");
  let new_columns = $state<ColumnSchema[]>([{ name: "id", type: "id" }]);

  // Sanitize collection name as user types
  function handle_collection_name_input(e: Event) {
    const input = e.target as HTMLInputElement;
    const raw = input.value;
    const sanitized = raw.toLowerCase().replace(/\s+/g, "_");
    input.value = sanitized;
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

  // Get column names from schema in defined order
  function get_column_names(schema: ColumnSchema[]): string[] {
    return schema.map((c) => c.name);
  }

  // Column type options
  const COLUMN_TYPES = [
    { value: "id", label: "ID" },
    { value: "text", label: "Text" },
    { value: "number", label: "Number" },
    { value: "boolean", label: "Boolean" },
    { value: "date", label: "Date" },
    { value: "json", label: "JSON" },
    { value: "file", label: "File" },
    { value: "files", label: "Files" },
  ] as const;

  function get_type_label(type: string): string {
    return COLUMN_TYPES.find((t) => t.value === type)?.label || "Text";
  }

  // Get column type from schema
  function get_column_type(schema: ColumnSchema[], col_name: string): string {
    return schema.find((c) => c.name === col_name)?.type || "text";
  }

  // Check if a filename is an image
  function is_image_file(filename: string): boolean {
    if (!filename) return false;
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(ext);
  }

  // Get asset URL (use centralized helper)
  function get_asset_url(filename: string, thumb?: string): string {
    return api.asset_url(project_id, filename, thumb);
  }

  // Get display name from Pocketbase filename
  function get_display_name(filename: string): string {
    const match = filename.match(/^[a-z0-9]+_(.+)$/i);
    return match ? match[1] : filename;
  }

  // Infer schema from records if missing (legacy data fallback)
  function infer_schema_from_records(records: DataRecord[]): ColumnSchema[] {
    if (!records || records.length === 0) return [];

    const first_record = records[0];
    const schema: ColumnSchema[] = [];

    for (const [key, value] of Object.entries(first_record)) {
      let type = "text";
      if (typeof value === "number") type = "number";
      else if (typeof value === "boolean") type = "boolean";
      schema.push({ name: key, type });
    }

    return schema;
  }

  async function select_file(filename: string) {
    selected_file = filename;
    try {
      const raw_data = await api.read_data_file(project_id, filename);

      // Handle different data formats
      if (
        raw_data &&
        typeof raw_data === "object" &&
        !Array.isArray(raw_data)
      ) {
        // New format: { schema, records, icon }
        let schema = raw_data.schema || [];
        const records = raw_data.records || [];
        const icon = raw_data.icon;

        // If schema is missing/empty but we have records, infer schema
        if (schema.length === 0 && records.length > 0) {
          // Only sort inferred schemas
          schema = sort_columns(infer_schema_from_records(records));
        }

        file_content = {
          schema,
          records,
          icon,
        };
      } else if (Array.isArray(raw_data)) {
        // Legacy format: just an array of records - sort inferred schema
        const records = raw_data;
        const schema = sort_columns(infer_schema_from_records(records));
        file_content = {
          schema,
          records,
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
    return Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  }

  function start_add_record() {
    if (!file_content) return;
    // Initialize new record with default values based on column types
    new_record = file_content.schema.reduce(
      (acc, col) => ({
        ...acc,
        [col.name]: get_default_value(col.type),
      }),
      {},
    );
    show_add_form = true;
  }

  async function save_new_record() {
    if (!selected_file || !file_content) return;
    const updated: CollectionData = {
      schema: file_content.schema,
      records: [...file_content.records, new_record],
      icon: file_content.icon,
    };
    await save_collection(updated);
    show_add_form = false;
    new_record = {};
  }

  function start_edit_record(index: number) {
    if (!file_content) return;
    editing_record_index = index;
    editing_record = { ...file_content.records[index] };
    show_edit_dialog = true;
  }

  async function save_edit_record() {
    if (
      !selected_file ||
      !file_content ||
      editing_record_index === null ||
      !editing_record
    )
      return;
    const new_records = [...file_content.records];
    new_records[editing_record_index] = editing_record;
    const updated: CollectionData = {
      schema: file_content.schema,
      records: new_records,
      icon: file_content.icon,
    };
    await save_collection(updated);
    show_edit_dialog = false;
    editing_record_index = null;
    editing_record = null;
  }

  function cancel_edit() {
    show_edit_dialog = false;
    editing_record_index = null;
    editing_record = null;
    show_add_form = false;
    new_record = {};
  }

  async function delete_record(index: number) {
    if (!selected_file || !file_content || !confirm("Delete this record?"))
      return;
    const new_records = file_content.records.filter((_, i) => i !== index);
    const updated: CollectionData = {
      schema: file_content.schema,
      records: new_records,
      icon: file_content.icon,
    };
    await save_collection(updated);
  }

  async function save_collection(data: CollectionData) {
    if (!selected_file) return;
    try {
      await api.write_data_file(project_id, selected_file, data);
      file_content = data;
      on_refresh_preview();
    } catch (error) {
      console.error("Failed to save collection:", error);
    }
  }

  function add_column() {
    new_columns = [...new_columns, { name: "", type: "text" }];
  }

  function remove_column(id: string) {
    columns_with_ids = columns_with_ids.filter((c) => c.id !== id);
  }

  // DnD requires unique IDs - track columns with IDs
  let column_id_counter = $state(0);
  type ColumnWithId = ColumnSchema & { id: string };
  let columns_with_ids = $state<ColumnWithId[]>([
    { id: "col_0", name: "id", type: "id" },
  ]);

  const FLIP_DURATION = 200;

  // Split columns: ID columns are locked at top, others are draggable
  let id_columns = $derived(columns_with_ids.filter((c) => c.type === "id"));
  let draggable_columns = $derived(
    columns_with_ids.filter((c) => c.type !== "id"),
  );

  function init_columns_for_edit(schema: ColumnSchema[]) {
    columns_with_ids = schema.map((col) => ({
      ...col,
      id: `col_${column_id_counter++}`,
    }));
  }

  function add_column_with_id() {
    // New columns are added to draggable section
    const new_col: ColumnWithId = {
      id: `col_${column_id_counter++}`,
      name: "",
      type: "text",
    };
    // Insert after ID columns
    const id_cols = columns_with_ids.filter((c) => c.type === "id");
    const other_cols = columns_with_ids.filter((c) => c.type !== "id");
    columns_with_ids = [...id_cols, ...other_cols, new_col];
  }

  function handle_dnd_consider(e: CustomEvent<{ items: ColumnWithId[] }>) {
    // Preserve ID columns at the start
    columns_with_ids = [...id_columns, ...e.detail.items];
  }

  function handle_dnd_finalize(e: CustomEvent<{ items: ColumnWithId[] }>) {
    // Preserve ID columns at the start
    columns_with_ids = [...id_columns, ...e.detail.items];
  }

  // Convert columns_with_ids back to plain schema for saving
  function get_schema_from_columns(): ColumnSchema[] {
    return columns_with_ids
      .filter((col) => col.name.trim())
      .map(({ name, type }) => ({ name: name.trim(), type }));
  }

  async function refresh_data_files() {
    try {
      // Refreshing the store updates the derived data_files
      await store.refresh();
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
        .filter((col) => col.name.trim())
        .map((col) => ({ name: col.name.trim(), type: col.type }));

      // Create collection with schema, empty records, and icon
      const collection_data: CollectionData = {
        schema,
        records: [],
        icon: new_collection_icon.trim() || undefined,
      };

      await api.write_data_file(project_id, collection_id, collection_data);
      await refresh_data_files();

      show_create_collection = false;
      new_collection_name = "";
      new_collection_icon = "";
      new_columns = [{ name: "id", type: "id" }];

      // Auto-select the new collection
      await select_file(collection_id);
    } catch (error) {
      console.error("Failed to create collection:", error);
    }
  }

  function cancel_create_collection() {
    show_create_collection = false;
    show_edit_collection = false;
    new_collection_name = "";
    new_collection_icon = "";
    new_columns = [{ name: "id", type: "id" }];
    columns_with_ids = [
      { id: `col_${column_id_counter++}`, name: "id", type: "id" },
    ];
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
    // Load current schema in its defined order
    init_columns_for_edit(file_content.schema);
    new_collection_icon = file_content.icon || "";
    show_edit_collection = true;
  }

  function get_default_value(type: string): any {
    switch (type) {
      case "id":
        return generate_id();
      case "number":
        return 0;
      case "boolean":
        return false;
      case "json":
        return {};
      default:
        return "";
    }
  }

  async function save_edited_collection() {
    if (!selected_file || !file_content) return;

    try {
      // Get schema from DnD columns
      const new_schema = get_schema_from_columns();

      // Get old schema column names for comparison
      const old_column_names = new Set(file_content.schema.map((c) => c.name));
      const new_column_names = new Set(new_schema.map((c) => c.name));

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
        schema: new_schema,
        records: new_records,
        icon: new_collection_icon.trim() || undefined,
      };

      await save_collection(updated);
      show_edit_collection = false;
      columns_with_ids = [
        { id: `col_${column_id_counter++}`, name: "id", type: "id" },
      ];
      new_collection_icon = "";
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

<div class="h-full flex flex-col font-sans text-sm">
  <!-- Header with Collection Dropdown -->
  <div
    class="border-b border-[var(--builder-border)] bg-[var(--builder-bg-primary)] px-3 py-2 flex items-center justify-between gap-2"
  >
    <div class="flex items-center gap-2 min-w-0 flex-1">
      <!-- Collection Dropdown -->
      <Select.Root
        type="single"
        value={selected_file || ""}
        onValueChange={(v) => {
          if (v === "__create__") {
            show_create_collection = true;
          } else if (v) {
            select_file(v);
          }
        }}
      >
        <Select.Trigger
          class="h-8 px-2 gap-1.5 border-none bg-transparent hover:bg-[var(--builder-bg-secondary)] w-auto"
        >
          <div class="flex items-center gap-2">
            {#if selected_file}
              <Icon
                icon={table_icons[selected_file] || "mdi:database"}
                class="w-4 h-4 flex-shrink-0 text-[var(--builder-text-secondary)]"
              />
              <span class="font-medium text-[var(--builder-text-primary)]"
                >{selected_file}</span
              >
            {:else}
              <Database
                class="w-4 h-4 flex-shrink-0 text-[var(--builder-text-secondary)]"
              />
              <span class="text-[var(--builder-text-secondary)]">Select</span>
            {/if}
          </div>
        </Select.Trigger>
        <Select.Content>
          {#each data_files as file (file)}
            <Select.Item value={file} label={file}>
              <div class="flex items-center gap-2">
                <Icon
                  icon={table_icons[file] || "mdi:database"}
                  class="w-4 h-4 flex-shrink-0"
                />
                {file}
              </div>
            </Select.Item>
          {/each}
          {#if data_files.length > 0}
            <div class="border-t border-[var(--builder-border)] my-1"></div>
          {/if}
          <Select.Item value="__create__" label="Create collection">
            <div class="flex items-center gap-2 text-[var(--builder-accent)]">
              <Plus class="w-4 h-4 flex-shrink-0" />
              Create collection
            </div>
          </Select.Item>
        </Select.Content>
      </Select.Root>

      {#if selected_file && file_content}
        <span
          class="text-[var(--builder-text-secondary)] text-xs flex-shrink-0"
        >
          {file_content.records.length} records
        </span>
      {/if}
    </div>

    {#if selected_file && file_content}
      <div class="flex items-center gap-1 flex-shrink-0">
        <button
          onclick={download_collection}
          class="p-1.5 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
          title="Download JSON"
        >
          <Download class="w-4 h-4" />
        </button>
        <button
          onclick={start_edit_collection}
          class="p-1.5 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
          title="Edit collection"
        >
          <Icon icon="mdi:pencil" class="w-4 h-4" />
        </button>
        <button
          onclick={start_add_record}
          class="p-1.5 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors border border-[var(--builder-border)] hover:border-[var(--builder-text-secondary)] rounded"
          title="Add record"
        >
          <Plus class="w-4 h-4" />
        </button>
      </div>
    {/if}
  </div>

  <!-- Table View -->
  <div class="flex-1 flex flex-col overflow-hidden">
    {#if selected_file && file_content}
      {@const records = file_content.records}
      {@const columns = get_column_names(file_content.schema)}
      <div class="flex-1 overflow-auto">
        {#if records.length > 0 && columns.length > 0}
          <div class="min-w-full overflow-x-auto">
            <table class="w-full border-collapse min-w-max">
              <thead class="sticky top-0 bg-[var(--builder-bg-secondary)] z-10">
                <tr class="border-b border-[var(--builder-border)]">
                  {#each columns as col}
                    <th
                      class="px-3 py-2 text-left text-xs text-[var(--builder-text-secondary)] font-normal whitespace-nowrap uppercase tracking-wide"
                    >
                      {col}
                    </th>
                  {/each}
                  <th
                    class="px-2 py-2 text-right text-xs text-[var(--builder-text-secondary)] font-normal w-10 uppercase tracking-wide"
                  ></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--builder-border)]">
                {#each records as record, i (i)}
                  <tr
                    transition:fade
                    onclick={() => start_edit_record(i)}
                    class="hover:bg-[var(--builder-bg-secondary)] group transition-colors cursor-pointer active:bg-[var(--builder-bg-tertiary)]"
                  >
                    {#each columns as col}
                      {@const val = record[col]}
                      {@const col_type = get_column_type(
                        file_content.schema,
                        col,
                      )}
                      <td
                        class="px-3 py-2 text-sm text-[var(--builder-text-primary)] max-w-[180px] truncate"
                      >
                        {#if val === null || val === undefined || val === ""}
                          <span
                            class="text-[var(--builder-text-secondary)] italic opacity-60"
                            >—</span
                          >
                        {:else if col_type === "file" && typeof val === "string"}
                          <div class="flex items-center gap-2">
                            {#if is_image_file(val)}
                              <img
                                src={get_asset_url(val, "32x32")}
                                alt=""
                                class="w-8 h-8 rounded object-cover flex-shrink-0"
                              />
                            {:else}
                              <div
                                class="w-8 h-8 rounded bg-[var(--builder-bg-tertiary)] flex items-center justify-center flex-shrink-0"
                              >
                                <File
                                  class="w-4 h-4 text-[var(--builder-text-secondary)]"
                                />
                              </div>
                            {/if}
                            <span class="truncate text-xs"
                              >{get_display_name(val)}</span
                            >
                          </div>
                        {:else if col_type === "files" && Array.isArray(val)}
                          <div class="flex items-center gap-1">
                            {#each val.slice(0, 3) as filename}
                              {#if is_image_file(filename)}
                                <img
                                  src={get_asset_url(filename, "24x24")}
                                  alt=""
                                  class="w-6 h-6 rounded object-cover"
                                />
                              {:else}
                                <div
                                  class="w-6 h-6 rounded bg-[var(--builder-bg-tertiary)] flex items-center justify-center"
                                >
                                  <File
                                    class="w-3 h-3 text-[var(--builder-text-secondary)]"
                                  />
                                </div>
                              {/if}
                            {/each}
                            {#if val.length > 3}
                              <span
                                class="text-xs text-[var(--builder-text-secondary)]"
                                >+{val.length - 3}</span
                              >
                            {/if}
                          </div>
                        {:else if typeof val === "object"}
                          <span
                            class="text-[var(--builder-text-secondary)] font-mono text-xs"
                            >{JSON.stringify(val)}</span
                          >
                        {:else if col_type === "date" && typeof val === "string"}
                          <span class="text-[var(--builder-text-secondary)]"
                            >{new Date(val).toLocaleString()}</span
                          >
                        {:else if typeof val === "boolean"}
                          <span
                            class={val
                              ? "text-orange-400"
                              : "text-[var(--builder-text-secondary)]"}
                            >{val}</span
                          >
                        {:else}
                          {val}
                        {/if}
                      </td>
                    {/each}
                    <td
                      class="px-2 py-2 text-right opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
                    >
                      <button
                        onclick={(e) => {
                          e.stopPropagation();
                          delete_record(i);
                        }}
                        class="p-1.5 text-[var(--builder-text-secondary)] hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                        title="Delete record"
                      >
                        <Trash2 class="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="flex-1 flex items-center justify-center h-full p-4">
            <div class="text-center">
              <p class="text-[var(--builder-text-secondary)] text-sm mb-3">
                No records in this collection
              </p>
              <Button variant="outline" size="sm" onclick={start_add_record}>
                <Plus class="w-4 h-4 mr-1" />
                Add first record
              </Button>
            </div>
          </div>
        {/if}
      </div>
    {:else if selected_file}
      <div class="flex-1 flex items-center justify-center p-4">
        <p class="text-[var(--builder-text-secondary)] text-sm">Loading...</p>
      </div>
    {:else if data_files.length === 0}
      <div class="flex-1 flex items-center justify-center p-8">
        <div class="text-center max-w-xs">
          <Database
            class="w-12 h-12 mx-auto mb-4 text-[var(--builder-text-secondary)] opacity-40"
          />
          <h3 class="text-[var(--builder-text-primary)] font-medium mb-2">
            No collections yet
          </h3>
          <p class="text-[var(--builder-text-secondary)] text-sm mb-4">
            Collections let you store and manage structured data for your app.
          </p>
          <Button
            variant="outline"
            size="sm"
            onclick={() => (show_create_collection = true)}
          >
            <Plus class="w-4 h-4 mr-1.5" />
            Create your first collection
          </Button>
        </div>
      </div>
    {:else}
      <div class="flex-1 flex items-center justify-center p-4">
        <div class="text-center text-[var(--builder-text-secondary)]">
          <Database class="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p class="text-sm">Select a collection to view records</p>
        </div>
      </div>
    {/if}
  </div>

  <!-- Create Collection Modal -->
  <Dialog.Root bind:open={show_create_collection}>
    <Dialog.Content
      class="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto"
    >
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
            value={new_collection_name}
            oninput={handle_collection_name_input}
            placeholder="e.g., users, products, orders"
            class="h-10"
            required
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <Label>Icon</Label>
          <IconPicker
            value={new_collection_icon}
            onchange={(icon) => (new_collection_icon = icon)}
            initial_search={new_collection_name}
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
              {#if column.type === "id"}
                <!-- ID column is locked -->
                <div class="flex gap-2 items-center opacity-60">
                  <Input value={column.name} class="flex-1 min-w-0" disabled />
                  <div
                    class="w-24 md:w-28 px-3 py-2 text-sm border border-[var(--builder-border)] rounded-md bg-[var(--builder-bg-secondary)] flex-shrink-0"
                  >
                    {get_type_label(column.type)}
                  </div>
                  <div class="w-8"></div>
                </div>
              {:else}
                <div class="flex gap-2 items-center">
                  <Input
                    bind:value={column.name}
                    placeholder="Column name"
                    class="flex-1 min-w-0"
                  />
                  <Select.Root
                    type="single"
                    value={column.type}
                    onValueChange={(v) => {
                      if (v) column.type = v;
                    }}
                  >
                    <Select.Trigger class="w-24 md:w-28 flex-shrink-0">
                      {get_type_label(column.type)}
                    </Select.Trigger>
                    <Select.Content>
                      {#each COLUMN_TYPES.filter((t) => t.value !== "id") as type_option (type_option.value)}
                        <Select.Item
                          value={type_option.value}
                          label={type_option.label}
                        >
                          {type_option.label}
                        </Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                  <DeleteButton
                    onclick={() => {
                      new_columns = new_columns.filter((_, idx) => idx !== i);
                    }}
                  />
                </div>
              {/if}
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
    <Dialog.Content
      class="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto"
    >
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
        <div class="flex flex-col gap-1.5 mb-2">
          <Label>Icon</Label>
          <IconPicker
            value={new_collection_icon}
            onchange={(icon) => (new_collection_icon = icon)}
            initial_search={selected_file || ""}
          />
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <Label>Columns</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onclick={add_column_with_id}
              class="h-auto py-1 px-2 text-xs"
            >
              <Plus class="h-3 w-3 mr-1" />
              Add Column
            </Button>
          </div>

          <!-- ID columns (locked at top) -->
          {#each id_columns as column (column.id)}
            <div class="flex gap-2 items-center opacity-60">
              <div class="p-1 w-4"></div>
              <Input
                bind:value={column.name}
                placeholder="Column name"
                class="flex-1"
              />
              <div
                class="w-16 px-3 mr-[4px] py-2 text-sm border border-[var(--builder-border)] rounded-md bg-[var(--builder-bg-secondary)]"
              >
                {get_type_label(column.type)}
              </div>
              <div class="w-8"></div>
            </div>
          {/each}

          <!-- Draggable columns -->
          <div
            class="flex flex-col gap-2"
            use:dndzone={{
              items: draggable_columns,
              flipDurationMs: FLIP_DURATION,
              dropTargetStyle: {},
            }}
            onconsider={handle_dnd_consider}
            onfinalize={handle_dnd_finalize}
          >
            {#each draggable_columns as column (column.id)}
              <div class="flex gap-2 items-center">
                <div
                  class="cursor-grab text-[var(--builder-text-secondary)] opacity-40 hover:opacity-80 transition-opacity touch-none"
                  title="Drag to reorder"
                >
                  <Icon icon="ic:baseline-drag-handle" class="w-4 h-4" />
                </div>
                <Input
                  bind:value={column.name}
                  placeholder="Column name"
                  class="flex-1 min-w-0"
                />
                <Select.Root
                  type="single"
                  value={column.type}
                  onValueChange={(v) => {
                    if (v) column.type = v;
                  }}
                >
                  <Select.Trigger class="w-24 md:w-28 flex-shrink-0">
                    {get_type_label(column.type)}
                  </Select.Trigger>
                  <Select.Content>
                    {#each COLUMN_TYPES.filter((t) => t.value !== "id") as type_option (type_option.value)}
                      <Select.Item
                        value={type_option.value}
                        label={type_option.label}
                      >
                        {type_option.label}
                      </Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
                <DeleteButton
                  onclick={() => remove_column(column.id)}
                  disabled={columns_with_ids.length === 1}
                />
              </div>
            {/each}
          </div>

          <p class="text-xs text-[var(--builder-text-secondary)] opacity-60">
            Drag to reorder. ID column is always first.
          </p>
        </div>

        <Dialog.Footer class="pt-2">
          <button
            type="button"
            onclick={() => {
              if (selected_file) {
                delete_collection(selected_file);
                show_edit_collection = false;
              }
            }}
            class="mr-auto text-xs text-[var(--builder-text-secondary)] hover:text-red-400 transition-colors"
          >
            Delete collection
          </button>
          <Button
            type="button"
            variant="ghost"
            onclick={cancel_create_collection}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={columns_with_ids.every((c) => !c.name.trim())}
          >
            Save Changes
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>

  <!-- Edit Record Dialog -->
  <Dialog.Root bind:open={show_edit_dialog}>
    <Dialog.Content class="max-w-[95vw] sm:max-w-lg max-h-[90vh] flex flex-col">
      <Dialog.Header>
        <Dialog.Title>Edit Record</Dialog.Title>
        <Dialog.Description>
          Update the values for this record.
        </Dialog.Description>
      </Dialog.Header>

      {#if editing_record && file_content}
        {@const columns = get_column_names(file_content.schema)}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            save_edit_record();
          }}
          class="flex flex-col gap-4 py-4 overflow-hidden min-w-0"
        >
          <div
            class="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1 min-w-0 overflow-x-hidden"
          >
            {#each columns as col}
              {@const col_type = get_column_type(file_content.schema, col)}
              <div class="flex flex-col gap-1.5 min-w-0">
                <Label for="edit-{col}">{col}</Label>
                {#if col_type === "id"}
                  <Input
                    id="edit-{col}"
                    bind:value={editing_record[col]}
                    class="font-mono text-sm opacity-50"
                    readonly
                  />
                {:else if col_type === "file"}
                  <FileField {project_id} bind:value={editing_record[col]} />
                {:else if col_type === "files"}
                  <FileField
                    {project_id}
                    bind:value={editing_record[col]}
                    multiple
                  />
                {:else if col_type === "boolean"}
                  <Switch
                    checked={editing_record[col] === true}
                    onCheckedChange={(v) => {
                      if (editing_record) editing_record[col] = v;
                    }}
                  />
                {:else if col_type === "number"}
                  <Input
                    id="edit-{col}"
                    type="number"
                    step="any"
                    value={editing_record[col]}
                    oninput={(e) => {
                      if (editing_record)
                        editing_record[col] = Number(e.currentTarget.value);
                    }}
                  />
                {:else if col_type === "date"}
                  <Input
                    id="edit-{col}"
                    type="datetime-local"
                    value={editing_record[col] || ""}
                    oninput={(e) => {
                      if (editing_record)
                        editing_record[col] = e.currentTarget.value;
                    }}
                  />
                {:else if col_type === "json"}
                  <JsonEditor
                    value={typeof editing_record[col] === "string"
                      ? editing_record[col]
                      : JSON.stringify(editing_record[col] ?? {}, null, 2)}
                    onchange={(val) => {
                      if (editing_record) {
                        try {
                          editing_record[col] = JSON.parse(val);
                        } catch {
                          editing_record[col] = val;
                        }
                      }
                    }}
                    min_height="80px"
                    max_height="200px"
                  />
                {:else}
                  <Input id="edit-{col}" bind:value={editing_record[col]} />
                {/if}
              </div>
            {/each}
          </div>

          <Dialog.Footer class="pt-2">
            <Button type="button" variant="ghost" onclick={cancel_edit}>
              Cancel
            </Button>
            <Button type="submit">Save Changes</Button>
          </Dialog.Footer>
        </form>
      {/if}
    </Dialog.Content>
  </Dialog.Root>

  <!-- Add Record Dialog -->
  <Dialog.Root bind:open={show_add_form}>
    <Dialog.Content class="max-w-[95vw] sm:max-w-lg max-h-[90vh] flex flex-col">
      <Dialog.Header>
        <Dialog.Title>Add Record</Dialog.Title>
        <Dialog.Description>
          Create a new record in {selected_file}.
        </Dialog.Description>
      </Dialog.Header>

      {#if file_content}
        {@const columns = get_column_names(file_content.schema)}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            save_new_record();
          }}
          class="flex flex-col gap-4 py-4 overflow-hidden min-w-0"
        >
          <div
            class="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1 min-w-0 overflow-x-hidden"
          >
            {#each columns as col}
              {@const col_type = get_column_type(file_content.schema, col)}
              <div class="flex flex-col gap-1.5 min-w-0">
                <Label for="add-{col}">{col}</Label>
                {#if col_type === "id"}
                  <Input
                    id="add-{col}"
                    bind:value={new_record[col]}
                    class="font-mono text-sm opacity-50"
                    readonly
                  />
                {:else if col_type === "file"}
                  <FileField {project_id} bind:value={new_record[col]} />
                {:else if col_type === "files"}
                  <FileField
                    {project_id}
                    bind:value={new_record[col]}
                    multiple
                  />
                {:else if col_type === "boolean"}
                  <Switch
                    checked={new_record[col] === true}
                    onCheckedChange={(v) => {
                      new_record[col] = v;
                    }}
                  />
                {:else if col_type === "number"}
                  <Input
                    id="add-{col}"
                    type="number"
                    step="any"
                    value={new_record[col]}
                    oninput={(e) => {
                      new_record[col] = Number(e.currentTarget.value);
                    }}
                  />
                {:else if col_type === "date"}
                  <Input
                    id="add-{col}"
                    type="datetime-local"
                    value={new_record[col] || ""}
                    oninput={(e) => {
                      new_record[col] = e.currentTarget.value;
                    }}
                  />
                {:else if col_type === "json"}
                  <JsonEditor
                    value={typeof new_record[col] === "string"
                      ? new_record[col]
                      : JSON.stringify(new_record[col] ?? {}, null, 2)}
                    onchange={(val) => {
                      try {
                        new_record[col] = JSON.parse(val);
                      } catch {
                        new_record[col] = val;
                      }
                    }}
                    min_height="80px"
                    max_height="200px"
                  />
                {:else}
                  <Input id="add-{col}" bind:value={new_record[col]} />
                {/if}
              </div>
            {/each}
          </div>

          <Dialog.Footer class="pt-2">
            <Button type="button" variant="ghost" onclick={cancel_edit}>
              Cancel
            </Button>
            <Button type="submit">Add Record</Button>
          </Dialog.Footer>
        </form>
      {/if}
    </Dialog.Content>
  </Dialog.Root>
</div>
