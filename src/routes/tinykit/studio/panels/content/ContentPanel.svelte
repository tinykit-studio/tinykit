<script lang="ts">
  import { tick } from "svelte";
  import { watch } from "runed";
  import { debounce } from "lodash-es";
  import { dragHandleZone, dragHandle } from "svelte-dnd-action";
  import Icon from "@iconify/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Switch } from "$lib/components/ui/switch";
  import * as Dialog from "$lib/components/ui/dialog";
  import AddFieldButton from "../../components/AddFieldButton.svelte";
  import TypeGrid from "../../components/TypeGrid.svelte";
  import JsonEditor from "../../components/JsonEditor.svelte";
  import MarkdownEditor from "../../components/MarkdownEditor.svelte";
  import type { ContentField } from "../../../types";
  import * as api from "../../../lib/api.svelte";
  import { getProjectContext } from "../../../context";
  import { getProjectStore } from "../../project.svelte";
  import {
    Type,
    FileText,
    Hash,
    ToggleLeft,
    Braces,
    ImageIcon,
    Upload,
    Link,
    Loader2,
    X,
  } from "lucide-svelte";

  const { project_id } = getProjectContext();
  const store = getProjectStore();

  type ContentPanelProps = {
    target_field?: string | null;
    on_refresh_preview: () => void;
    on_target_consumed?: () => void;
  };

  let {
    target_field = null,
    on_refresh_preview,
    on_target_consumed,
  }: ContentPanelProps = $props();

  // Local mutable state for editing
  let local_fields = $state<ContentField[]>([]);

  // Sync from store, but be careful not to overwrite active edits if possible
  // For now, strict sync. Svelte's keyed each block handles DOM preservation.
  watch(
    () => store.content,
    (new_content) => {
      // Only update if different JSON to avoid spurious updates?
      if (JSON.stringify(new_content) !== JSON.stringify(local_fields)) {
        local_fields = new_content; // Copy reference is fine as we replace it on edit?
        // Actually store.content is new array from derived.
        // If we modify local_fields items, we drift.
        // Let's rely on full replacement for simplicity for now.
      }
    },
  );

  // Careful: watch runs immediately? No, runed watch might run immediate.
  // We can just init local_fields from store.content if available?
  // store.content is derived constant access.
  $effect(() => {
    if (local_fields.length === 0 && store.content.length > 0) {
      local_fields = store.content;
    }
  });

  // Map for storing input element references by field id
  let field_inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};

  // Watch for target field changes and focus on the field
  watch(
    () => [target_field, local_fields.length] as const,
    async ([field_name, fields_count]) => {
      if (field_name && fields_count > 0) {
        const field = local_fields.find((f) => f.name === field_name);
        if (field) {
          await tick();
          const input = field_inputs[field.id];
          if (input) {
            // Scroll into view and focus
            input.scrollIntoView({ behavior: "smooth", block: "center" });
            input.focus();
            // Add highlight animation
            input.classList.add("field-highlight");
            setTimeout(() => input.classList.remove("field-highlight"), 1500);
          }
          // Consume the target only after successful focus
          on_target_consumed?.();
        }
      }
    },
  );

  // Modal state for adding new fields
  let show_add_modal = $state(false);
  let new_name = $state("");
  let new_type = $state("text");
  let new_value = $state("");
  let new_description = $state("");

  // Field type definitions with icons
  type ContentFieldType =
    | "text"
    | "markdown"
    | "number"
    | "boolean"
    | "json"
    | "image";

  const field_types: {
    value: ContentFieldType;
    label: string;
    icon: typeof Type;
  }[] = [
    { value: "text", label: "Text", icon: Type },
    { value: "markdown", label: "Markdown", icon: FileText },
    { value: "number", label: "Number", icon: Hash },
    { value: "boolean", label: "Boolean", icon: ToggleLeft },
    { value: "image", label: "Image", icon: ImageIcon },
    { value: "json", label: "JSON", icon: Braces },
  ];

  // Convert name to content key (e.g., "Hero Title" → "hero_title")
  function name_to_content_key(name: string): string {
    if (!name.trim()) return "";
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  }

  let generated_content_key = $derived(name_to_content_key(new_name));

  function reset_modal() {
    new_name = "";
    new_type = "text";
    new_value = "";
    new_description = "";
    dialog_image_mode = "upload";
    show_add_modal = false;
  }

  function set_type(type: ContentFieldType) {
    new_type = type;
    // Reset value based on type
    if (type === "boolean") {
      new_value = "";
    } else if (type === "number") {
      new_value = "0";
    } else if (type === "json") {
      new_value = "{}";
    } else if (type === "image") {
      new_value = "";
    } else {
      new_value = "";
    }
  }

  // Auto-resize textarea helper
  function auto_resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  // Svelte action to auto-resize on mount
  function auto_resize_init(el: HTMLTextAreaElement) {
    // Initial resize
    requestAnimationFrame(() => auto_resize(el));
    return {
      update() {
        auto_resize(el);
      },
    };
  }

  // Image upload state - track per field
  let uploading_fields: Record<string, boolean> = $state({});
  let image_modes: Record<string, "upload" | "url"> = $state({});

  function get_image_mode(field_id: string): "upload" | "url" {
    return image_modes[field_id] || "upload";
  }

  function set_image_mode(field_id: string, mode: "upload" | "url") {
    image_modes[field_id] = mode;
  }

  async function handle_image_upload(field: ContentField, file: File) {
    if (!file.type.startsWith("image/")) {
      console.error("Not an image file");
      return;
    }

    uploading_fields[field.id] = true;
    try {
      const url = await api.upload_asset(project_id, file);
      await update_field_value(field, url);
    } catch (err) {
      console.error("Failed to upload image:", err);
    } finally {
      uploading_fields[field.id] = false;
    }
  }

  function handle_image_drop(e: DragEvent, field: ContentField) {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file) handle_image_upload(field, file);
  }

  function handle_image_paste(e: ClipboardEvent, field: ContentField) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handle_image_upload(field, file);
          return;
        }
      }
    }
  }

  function clear_image(field: ContentField) {
    update_field_value(field, "");
  }

  // Dialog image upload state
  let dialog_image_mode = $state<"upload" | "url">("upload");
  let dialog_uploading = $state(false);

  async function handle_dialog_image_upload(file: File) {
    if (!file.type.startsWith("image/")) {
      console.error("Not an image file");
      return;
    }

    dialog_uploading = true;
    try {
      const url = await api.upload_asset(project_id, file);
      new_value = url;
    } catch (err) {
      console.error("Failed to upload image:", err);
    } finally {
      dialog_uploading = false;
    }
  }

  function handle_dialog_image_drop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file) handle_dialog_image_upload(file);
  }

  async function add_field() {
    if (!new_name.trim() || !generated_content_key) return;

    const field_data: Omit<ContentField, "id"> = {
      name: new_name,
      type: new_type,
      value:
        new_type === "boolean"
          ? false
          : new_type === "number"
            ? parseFloat(new_value) || 0
            : new_type === "json"
              ? new_value || "{}"
              : new_value,
      description: new_description,
    };

    try {
      const created_field = await api.add_content_field(project_id, field_data);
      store.add_content_field(created_field);
      // local_fields syncs via watch from store.content
      reset_modal();
    } catch (err) {
      console.error("Failed to add content field:", err);
    }
  }

  async function delete_field(id: string) {
    try {
      await api.delete_content_field(project_id, id);
      store.delete_content_field(id);
      local_fields = local_fields.filter((f) => f.id !== id);
    } catch (error) {
      console.error("Failed to delete content field:", error);
    }
  }

  function update_field_value(field: ContentField, new_value: any) {
    store.update_content_field(field.id, new_value);
    local_fields = local_fields.map((f) =>
      f.id === field.id ? { ...f, value: new_value } : f,
    );
    on_refresh_preview();
  }

  // Debounced store update for real-time preview (300ms delay)
  const debounced_store_update = debounce((field_id: string, value: any) => {
    store.update_content_field(field_id, value);
    on_refresh_preview();
  }, 300);

  // Handle input changes - update local state immediately, debounce store update
  function handle_input(field: ContentField, new_value: any) {
    local_fields = local_fields.map((f) =>
      f.id === field.id ? { ...f, value: new_value } : f,
    );
    // Debounced update for real-time preview
    debounced_store_update(field.id, new_value);
  }

  // Save immediately on blur (flush any pending debounced update)
  function handle_blur(field: ContentField) {
    debounced_store_update.cancel();
    update_field_value(field, field.value);
  }

  // DnD for reordering fields
  const FLIP_DURATION = 150;

  function handle_dnd_consider(e: CustomEvent<{ items: ContentField[] }>) {
    local_fields = e.detail.items;
  }

  async function handle_dnd_finalize(
    e: CustomEvent<{ items: ContentField[] }>,
  ) {
    local_fields = e.detail.items;
    try {
      store.pause_realtime();
      await api.reorder_content_fields(project_id, local_fields);
    } catch (err) {
      console.error("Failed to reorder content fields:", err);
    }
  }
</script>

<div class="content-panel bg-white/[0.025]">
  <div
    class="field-list"
    use:dragHandleZone={{
      items: local_fields,
      flipDurationMs: FLIP_DURATION,
      dropTargetStyle: {},
    }}
    onconsider={handle_dnd_consider}
    onfinalize={handle_dnd_finalize}
  >
    {#each local_fields as field (field.id)}
      <div
        class="field-card bg-[var(--builder-bg-primary)] p-3 rounded-sm relative group"
      >
        <button
          onclick={() => delete_field(field.id)}
          class="delete-btn"
          title="Delete field"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 6h18" /><path
              d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
            /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
        </button>

        <div
          use:dragHandle
          aria-label="drag-handle"
          class="drag-handle"
          title="Drag to reorder"
        >
          <Icon icon="ic:baseline-drag-handle" class="w-4 h-4" />
        </div>

        <div class="field-label-row">
          <Label for="field-{field.id}">{field.name}</Label>
          <span class="field-content-key"
            >{name_to_content_key(field.name)}</span
          >
        </div>

        {#if field.type === "text" || field.type === "textarea"}
          <!-- Auto-grow text field -->
          <textarea
            bind:this={field_inputs[field.id]}
            id="field-{field.id}"
            value={field.value}
            oninput={(e) => {
              handle_input(field, e.currentTarget.value);
              auto_resize(e.currentTarget);
            }}
            onblur={() => handle_blur(field)}
            rows={1}
            class="field-textarea auto-grow"
            use:auto_resize_init
          ></textarea>
        {:else if field.type === "markdown"}
          <!-- Markdown field with CodeMirror -->
          <MarkdownEditor
            value={field.value}
            onchange={(val) => update_field_value(field, val)}
            min_height="60px"
            max_height="200px"
          />
        {:else if field.type === "image"}
          <!-- Image field with upload/URL tabs -->
          <div class="image-field">
            {#if field.value}
              <!-- Show preview when image exists -->
              <div class="image-preview-wrapper">
                <div class="image-preview">
                  <img
                    src={api.asset_url(project_id, field.value)}
                    alt={field.name}
                    onerror={(e) =>
                      ((e.currentTarget as HTMLImageElement).style.display =
                        "none")}
                  />
                </div>
                <button
                  type="button"
                  class="image-clear-btn"
                  onclick={() => clear_image(field)}
                  title="Remove image"
                >
                  <X size={14} />
                </button>
              </div>
            {:else}
              <!-- Show upload/URL picker when no image -->
              <div class="image-tabs">
                <button
                  type="button"
                  class="image-tab"
                  class:active={get_image_mode(field.id) === "upload"}
                  onclick={() => set_image_mode(field.id, "upload")}
                >
                  <Upload size={14} />
                  Upload
                </button>
                <button
                  type="button"
                  class="image-tab"
                  class:active={get_image_mode(field.id) === "url"}
                  onclick={() => set_image_mode(field.id, "url")}
                >
                  <Link size={14} />
                  URL
                </button>
              </div>

              {#if get_image_mode(field.id) === "upload"}
                <label
                  class="image-dropzone"
                  class:uploading={uploading_fields[field.id]}
                  ondragover={(e) => e.preventDefault()}
                  ondrop={(e) => handle_image_drop(e, field)}
                  onpaste={(e) => handle_image_paste(e, field)}
                >
                  {#if uploading_fields[field.id]}
                    <Loader2 size={20} class="animate-spin" />
                    <span>Uploading...</span>
                  {:else}
                    <ImageIcon size={20} />
                    <span>Drop image or click to upload</span>
                  {/if}
                  <input
                    type="file"
                    accept="image/*"
                    class="sr-only"
                    onchange={(e) => {
                      const file = e.currentTarget.files?.[0];
                      if (file) handle_image_upload(field, file);
                    }}
                  />
                </label>
              {:else}
                <input
                  bind:this={field_inputs[field.id]}
                  id="field-{field.id}"
                  type="text"
                  value={field.value}
                  oninput={(e) => handle_input(field, e.currentTarget.value)}
                  onblur={() => handle_blur(field)}
                  placeholder="https://example.com/image.jpg"
                  class="field-input"
                />
              {/if}
            {/if}
          </div>
        {:else if field.type === "boolean"}
          <div class="flex items-center gap-2">
            <Switch
              id="field-{field.id}"
              checked={field.value}
              onCheckedChange={(checked) => update_field_value(field, checked)}
            />
            <span class="text-sm text-[var(--builder-text-secondary)]">
              {field.value ? "true" : "false"}
            </span>
          </div>
        {:else if field.type === "json"}
          <!-- JSON field with CodeMirror -->
          <JsonEditor
            value={typeof field.value === "string"
              ? field.value
              : JSON.stringify(field.value, null, 2)}
            onchange={(val) => update_field_value(field, val)}
            min_height="60px"
            max_height="200px"
          />
        {:else}
          <!-- Number or fallback -->
          <input
            bind:this={field_inputs[field.id]}
            id="field-{field.id}"
            type={field.type === "number" ? "number" : "text"}
            value={field.value}
            oninput={(e) => {
              const val =
                field.type === "number"
                  ? parseFloat(e.currentTarget.value) || 0
                  : e.currentTarget.value;
              handle_input(field, val);
            }}
            onblur={() => handle_blur(field)}
            class="field-input"
          />
        {/if}

        {#if field.description}
          <p
            class="text-xs text-[var(--builder-text-secondary)] opacity-70 mt-1"
          >
            {field.description}
          </p>
        {/if}
      </div>
    {/each}

    <!-- Add field button at bottom -->
    <AddFieldButton
      label="Add Content Field"
      onclick={() => (show_add_modal = true)}
    />
  </div>
</div>

<!-- Add field dialog -->
<Dialog.Root bind:open={show_add_modal}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header class="mt-8">
      <Dialog.Title>Add Content Field</Dialog.Title>
      <Dialog.Description>
        Create a content field that can be edited visually.
      </Dialog.Description>
    </Dialog.Header>

    <div class="dialog-content">
      <!-- Type selector -->
      <div class="form-group">
        <Label>Type</Label>
        <TypeGrid types={field_types} selected={new_type} onselect={set_type} />
      </div>

      <!-- Name -->
      <div class="form-group">
        <Label for="field-name">Name</Label>
        <Input
          id="field-name"
          bind:value={new_name}
          placeholder={new_type === "text"
            ? "Hero Title"
            : new_type === "markdown"
              ? "Bio"
              : new_type === "number"
                ? "Price"
                : new_type === "boolean"
                  ? "Show Banner"
                  : new_type === "image"
                    ? "Hero Image"
                    : "Config"}
        />
        {#if generated_content_key}
          <p class="hint mono">{generated_content_key}</p>
        {:else}
          <p class="hint">Enter a name to generate content key</p>
        {/if}
      </div>

      <!-- Value (not for boolean) -->
      {#if new_type !== "boolean"}
        <div class="form-group">
          <Label for="field-value">Initial Value</Label>
          {#if new_type === "markdown"}
            <div class="markdown-field-dialog">
              <MarkdownEditor
                value={new_value}
                onchange={(val) => (new_value = val)}
                min_height="80px"
                max_height="150px"
              />
              <p class="hint">
                Markdown will be converted to HTML automatically
              </p>
            </div>
          {:else if new_type === "json"}
            <JsonEditor
              value={new_value}
              onchange={(val) => (new_value = val)}
              min_height="80px"
              max_height="150px"
            />
          {:else if new_type === "image"}
            <div class="image-field-dialog">
              {#if new_value}
                <!-- Show preview when image exists -->
                <div class="image-preview-wrapper-dialog">
                  <div class="image-preview-dialog">
                    <img
                      src={api.asset_url(project_id, new_value)}
                      alt="Preview"
                      onerror={(e) =>
                        ((e.currentTarget as HTMLImageElement).style.display =
                          "none")}
                    />
                  </div>
                  <button
                    type="button"
                    class="image-clear-btn-dialog"
                    onclick={() => (new_value = "")}
                    title="Remove image"
                  >
                    <X size={14} />
                  </button>
                </div>
              {:else}
                <!-- Upload/URL tabs -->
                <div class="image-tabs">
                  <button
                    type="button"
                    class="image-tab"
                    class:active={dialog_image_mode === "upload"}
                    onclick={() => (dialog_image_mode = "upload")}
                  >
                    <Upload size={14} />
                    Upload
                  </button>
                  <button
                    type="button"
                    class="image-tab"
                    class:active={dialog_image_mode === "url"}
                    onclick={() => (dialog_image_mode = "url")}
                  >
                    <Link size={14} />
                    URL
                  </button>
                </div>

                {#if dialog_image_mode === "upload"}
                  <label
                    class="image-dropzone"
                    class:uploading={dialog_uploading}
                    ondragover={(e) => e.preventDefault()}
                    ondrop={handle_dialog_image_drop}
                  >
                    {#if dialog_uploading}
                      <Loader2 size={20} class="animate-spin" />
                      <span>Uploading...</span>
                    {:else}
                      <ImageIcon size={20} />
                      <span>Drop image or click to upload</span>
                    {/if}
                    <input
                      type="file"
                      accept="image/*"
                      class="sr-only"
                      onchange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        if (file) handle_dialog_image_upload(file);
                      }}
                    />
                  </label>
                {:else}
                  <Input
                    id="field-value"
                    type="text"
                    bind:value={new_value}
                    placeholder="https://example.com/image.jpg"
                  />
                {/if}
              {/if}
            </div>
          {:else}
            <Input
              id="field-value"
              type={new_type === "number" ? "number" : "text"}
              bind:value={new_value}
              placeholder={new_type === "number" ? "0" : "Value"}
            />
          {/if}
        </div>
      {/if}

      <!-- Description -->
      <div class="form-group">
        <Label for="field-description">Description (optional)</Label>
        <Input
          id="field-description"
          bind:value={new_description}
          placeholder="Describe what this field is for"
        />
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={reset_modal}>Cancel</Button>
      <Button onclick={add_field}>Add Field</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .content-panel {
    height: 100%;
    overflow-y: auto;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .field-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    flex: 1;
  }

  .field-card {
    position: relative;
  }

  .drag-handle {
    position: absolute;
    top: 8px;
    right: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    cursor: grab;
    color: var(--builder-text-secondary);
    border-radius: 4px;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .field-card:hover .drag-handle {
    opacity: 0.5;
  }

  .field-card:hover .drag-handle:hover {
    opacity: 1;
  }

  .delete-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--builder-text-secondary);
    opacity: 0;
    transition:
      opacity 0.15s,
      color 0.15s,
      background 0.15s;
  }

  .field-card:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
  }

  .field-label-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .field-content-key {
    font-size: 11px;
    font-family: ui-monospace, monospace;
    color: var(--builder-text-secondary);
    opacity: 0;
    transition: opacity 0.15s;
  }

  .field-card:hover .field-content-key {
    opacity: 0.6;
  }

  /* Remove default svelte-dnd-action blue outline */
  :global(.field-card[aria-grabbed="true"]) {
    outline: none !important;
  }

  /* Highlight animation for focused fields */
  :global(.field-highlight) {
    animation: highlight-pulse 1.5s ease-out;
  }

  @keyframes highlight-pulse {
    0% {
      box-shadow: 0 0 0 3px var(--tool-content);
    }
    100% {
      box-shadow: 0 0 0 0px transparent;
    }
  }

  /* Dialog styles */
  .dialog-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 0;
    overflow: hidden;
    min-width: 0;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
  }

  .hint {
    font-size: 12px;
    color: var(--builder-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint.mono {
    font-family: ui-monospace, monospace;
  }

  /* Field input styles */
  .field-input {
    display: flex;
    height: 36px;
    width: 100%;
    border-radius: 6px;
    border: 1px solid var(--builder-border);
    padding: 0 12px;
    font-size: 14px;
    outline: none;
    transition: all 0.15s;
    background: var(--builder-bg-secondary);
    color: var(--builder-text-primary);
  }

  .field-input:focus {
    border-color: var(--builder-accent);
    box-shadow: 0 0 0 1px var(--builder-accent) / 0.5;
  }

  .field-input::placeholder {
    color: var(--builder-text-muted);
  }

  .field-textarea {
    display: block;
    width: 100%;
    border-radius: 6px;
    border: 1px solid var(--builder-border);
    padding: 8px 12px;
    font-size: 14px;
    outline: none;
    transition: all 0.15s;
    background: var(--builder-bg-secondary);
    color: var(--builder-text-primary);
    resize: none;
    overflow: hidden;
    min-height: 36px;
    line-height: 1.5;
  }

  .field-textarea:focus {
    border-color: var(--builder-accent);
    box-shadow: 0 0 0 1px var(--builder-accent) / 0.5;
  }

  .field-textarea::placeholder {
    color: var(--builder-text-muted);
  }

  .field-textarea.font-mono {
    font-family: ui-monospace, monospace;
    font-size: 13px;
  }

  /* Image field */
  .image-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .image-tabs {
    display: flex;
    gap: 4px;
  }

  .image-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 12px;
    border: 1px solid var(--builder-border);
    background: var(--builder-bg-secondary);
    color: var(--builder-text-secondary);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .image-tab:hover {
    border-color: var(--builder-text-secondary);
    color: var(--builder-text-primary);
  }

  .image-tab.active {
    border-color: var(--builder-accent);
    color: var(--builder-accent);
    background: color-mix(in srgb, var(--builder-accent) 10%, transparent);
  }

  .image-dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px 16px;
    border: 2px dashed var(--builder-border);
    border-radius: 8px;
    background: var(--builder-bg-secondary);
    color: var(--builder-text-secondary);
    cursor: pointer;
    transition: all 0.15s;
    font-size: 13px;
  }

  .image-dropzone:hover {
    border-color: var(--builder-accent);
    color: var(--builder-text-primary);
  }

  .image-dropzone.uploading {
    border-color: var(--builder-accent);
    background: color-mix(in srgb, var(--builder-accent) 5%, transparent);
  }

  .image-preview-wrapper {
    position: relative;
  }

  .image-clear-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    border: none;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .image-preview-wrapper:hover .image-clear-btn {
    opacity: 1;
  }

  .image-clear-btn:hover {
    background: rgba(239, 68, 68, 0.9);
  }

  .image-preview {
    border-radius: 6px;
    overflow: hidden;
    background: var(--builder-bg-secondary);
    border: 1px solid var(--builder-border);
  }

  .image-preview img {
    display: block;
    max-width: 100%;
    max-height: 120px;
    object-fit: contain;
    margin: 0 auto;
  }

  /* Dialog image preview */
  .image-field-dialog {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .image-preview-dialog {
    border-radius: 8px;
    overflow: hidden;
    background: var(--builder-bg-tertiary);
    border: 1px solid var(--builder-border);
    padding: 8px;
  }

  .image-preview-dialog img {
    display: block;
    max-width: 100%;
    max-height: 150px;
    object-fit: contain;
    margin: 0 auto;
    border-radius: 4px;
  }

  .image-preview-wrapper-dialog {
    position: relative;
  }

  .image-clear-btn-dialog {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    border: none;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .image-preview-wrapper-dialog:hover .image-clear-btn-dialog {
    opacity: 1;
  }

  .image-clear-btn-dialog:hover {
    background: rgba(239, 68, 68, 0.9);
  }
</style>
