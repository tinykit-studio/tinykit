<script lang="ts">
  import { tick } from "svelte";
  import { watch } from "runed";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Label } from "$lib/components/ui/label";
  import { Switch } from "$lib/components/ui/switch";
  import { Item, ItemGroup } from "$lib/components/ui/item";
  import * as Select from "$lib/components/ui/select";
  import CustomFieldRenderer from "$lib/components/CustomFieldRenderer.svelte";
  import AddFieldButton from "../../components/AddFieldButton.svelte";
  import type { ContentField } from "../../types";
  import * as api from "../../lib/api.svelte";
  import { getProjectContext } from "../../context";

  const { project_id } = getProjectContext();

  type ContentPanelProps = {
    content_fields: ContentField[];
    custom_field_types: any[];
    target_field?: string | null;
    on_refresh_preview: () => void;
    on_target_consumed?: () => void;
  };

  let {
    content_fields = $bindable(),
    custom_field_types,
    target_field = null,
    on_refresh_preview,
    on_target_consumed,
  }: ContentPanelProps = $props();

  // Map for storing input element references by field id
  let field_inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};

  // Watch for target field changes and focus on the field
  // Watch both target_field and content_fields.length to handle case where fields load after target is set
  watch(
    () => [target_field, content_fields.length] as const,
    async ([field_name, fields_count]) => {
      if (field_name && fields_count > 0) {
        const field = content_fields.find((f) => f.name === field_name);
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

  let show_create_form = $state(false);
  let new_field_name = $state("");
  let new_field_type = $state("text");
  let new_field_value = $state("");
  let new_field_description = $state("");

  // Build field type options for select
  let field_type_options = $derived.by(() => {
    const base_options = [
      { value: "text", label: "Text" },
      { value: "textarea", label: "Textarea" },
      { value: "number", label: "Number" },
      { value: "boolean", label: "Boolean" },
      { value: "json", label: "JSON" },
    ];
    const custom_options = custom_field_types.map((ct) => ({
      value: `custom:${ct.id}`,
      label: `${ct.manifest.icon || "🔧"} ${ct.manifest.name}`,
    }));
    return { base_options, custom_options };
  });

  async function add_field() {
    if (!new_field_name.trim()) return;

    let new_field: any;

    if (new_field_type.startsWith("custom:")) {
      const custom_type_id = new_field_type.replace("custom:", "");
      const custom_field_def = custom_field_types.find(
        (ct) => ct.id === custom_type_id,
      );

      if (!custom_field_def) {
        console.error("Custom field type not found:", custom_type_id);
        return;
      }

      let default_value = {};
      try {
        default_value = new_field_value ? JSON.parse(new_field_value) : {};
      } catch {
        default_value = {};
      }

      new_field = {
        id: Date.now().toString(),
        name: new_field_name,
        type: "custom",
        customType: custom_field_def.manifest.name,
        value: default_value,
        description: new_field_description,
        config: custom_field_def.manifest.defaultConfig || {},
      };
    } else {
      new_field = {
        id: Date.now().toString(),
        name: new_field_name,
        type: new_field_type,
        value:
          new_field_type === "boolean"
            ? false
            : new_field_type === "number"
              ? parseFloat(new_field_value) || 0
              : new_field_value,
        description: new_field_description,
      };
    }

    try {
      await api.add_content_field(project_id, new_field);
      content_fields = [...content_fields, new_field];
      show_create_form = false;
      new_field_name = "";
      new_field_type = "text";
      new_field_value = "";
      new_field_description = "";
    } catch (err) {
      console.error("Failed to add content field:", err);
    }
  }

  async function delete_field(id: string) {
    try {
      await api.delete_content_field(project_id, id);
      content_fields = content_fields.filter((f) => f.id !== id);
    } catch (error) {
      console.error("Failed to delete content field:", error);
    }
  }

  async function update_field_value(field: ContentField, new_value: any) {
    try {
      await api.update_content_field(project_id, field.id, new_value);
      content_fields = content_fields.map((f) =>
        f.id === field.id ? { ...f, value: new_value } : f,
      );
      on_refresh_preview();
      window.dispatchEvent(new CustomEvent("tinykit:config-updated"));
    } catch (error) {
      console.error("Failed to update content field:", error);
    }
  }

  // Handle input changes - update local state only
  function handle_input(field: ContentField, new_value: any) {
    content_fields = content_fields.map((f) =>
      f.id === field.id ? { ...f, value: new_value } : f,
    );
  }

  // Save on blur
  function handle_blur(field: ContentField) {
    update_field_value(field, field.value);
  }

  function cancel_create() {
    show_create_form = false;
    new_field_name = "";
    new_field_type = "text";
    new_field_value = "";
    new_field_description = "";
  }

  function handle_type_change(value: string | undefined) {
    if (value) {
      new_field_type = value;
    }
  }

  // Convert field name to content key (e.g., "Hero Title" → "content.hero_title")
  function name_to_content_key(name: string): string {
    if (!name.trim()) return "";
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    return slug;
  }
</script>

<div class="content-panel bg-white/[0.025]">
  <ItemGroup class="gap-2">
    {#each content_fields as field (field.id)}
      <Item
        class="field-card bg-[var(--builder-bg-primary)] p-3 rounded-sm relative group"
      >
        <button
          onclick={() => delete_field(field.id)}
          class="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded text-[var(--builder-text-secondary)] hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
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

        <div class="field-label-row">
          <Label for="field-{field.id}">{field.name}</Label>
          <span class="field-content-key"
            >{name_to_content_key(field.name)}</span
          >
        </div>

        {#if field.type === "custom" && field.customType}
          <CustomFieldRenderer
            customType={field.customType}
            value={field.value}
            disabled={true}
            config={field.config || {}}
          />
        {:else if field.type === "textarea"}
          <textarea
            bind:this={field_inputs[field.id]}
            id="field-{field.id}"
            value={field.value}
            oninput={(e) => handle_input(field, e.currentTarget.value)}
            onblur={() => handle_blur(field)}
            rows={3}
            class="flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm outline-none transition-all mt-[3px] bg-[var(--builder-bg-secondary)] border-[var(--builder-border)] text-[var(--builder-text-primary)] placeholder:text-[var(--builder-text-muted)] focus:border-[var(--builder-accent)] focus:ring-1 focus:ring-[var(--builder-accent)]/50 hover:border-[var(--builder-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          ></textarea>
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
        {:else}
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
            class="flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none transition-all bg-[var(--builder-bg-secondary)] border-[var(--builder-border)] text-[var(--builder-text-primary)] placeholder:text-[var(--builder-text-muted)] focus:border-[var(--builder-accent)] focus:ring-1 focus:ring-[var(--builder-accent)]/50 hover:border-[var(--builder-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          />
        {/if}

        {#if field.description}
          <p class="text-xs text-[var(--builder-text-secondary)] opacity-70">
            {field.description}
          </p>
        {/if}
      </Item>
    {/each}

    <!-- Add field button / form -->
    {#if show_create_form}
      <Item
        class="bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg p-4"
      >
        <form
          onsubmit={(e) => {
            e.preventDefault();
            add_field();
          }}
          class="flex flex-col gap-3"
        >
          <div class="flex flex-col gap-1.5">
            <Label for="field-name">Field Name</Label>
            <Input
              id="field-name"
              bind:value={new_field_name}
              placeholder="e.g., Hero Title"
              required
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1.5">
              <Label>Field Type</Label>
              <Select.Root type="single" onValueChange={handle_type_change}>
                <Select.Trigger
                  class="w-full bg-[var(--builder-bg-primary)] border-[var(--builder-border)]"
                >
                  {field_type_options.base_options.find(
                    (o) => o.value === new_field_type,
                  )?.label ||
                    field_type_options.custom_options.find(
                      (o) => o.value === new_field_type,
                    )?.label ||
                    "Select type"}
                </Select.Trigger>
                <Select.Content
                  class="bg-[var(--builder-bg-primary)] border-[var(--builder-border)]"
                >
                  {#each field_type_options.base_options as option (option.value)}
                    <Select.Item
                      value={option.value}
                      label={option.label}
                      class="text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)]"
                    >
                      {option.label}
                    </Select.Item>
                  {/each}
                  {#if field_type_options.custom_options.length > 0}
                    <Select.Separator class="bg-[var(--builder-border)]" />
                    {#each field_type_options.custom_options as option (option.value)}
                      <Select.Item
                        value={option.value}
                        label={option.label}
                        class="text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)]"
                      >
                        {option.label}
                      </Select.Item>
                    {/each}
                  {/if}
                </Select.Content>
              </Select.Root>
            </div>

            {#if new_field_type !== "boolean"}
              <div class="flex flex-col gap-1.5">
                <Label for="field-value">Initial Value</Label>
                <Input
                  id="field-value"
                  type={new_field_type === "number" ? "number" : "text"}
                  bind:value={new_field_value}
                  placeholder="Value"
                />
              </div>
            {/if}
          </div>

          <div class="flex flex-col gap-1.5">
            <Label for="field-description">Description (optional)</Label>
            <Input
              id="field-description"
              bind:value={new_field_description}
              placeholder="Describe what this field is for"
            />
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onclick={cancel_create}>
              Cancel
            </Button>
            <Button type="submit">Add Field</Button>
          </div>
        </form>
      </Item>
    {:else}
      <AddFieldButton
        label="Add Content Field"
        onclick={() => (show_create_form = true)}
      />
    {/if}
  </ItemGroup>
</div>

<style>
  .content-panel {
    height: 100%;
    overflow-y: auto;
    padding: 12px;
  }

  .field-label-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .field-content-key {
    font-size: 11px;
    font-family: ui-monospace, monospace;
    color: var(--builder-text-secondary);
    opacity: 0;
    transition: opacity 0.15s;
  }

  :global(.field-card:hover) .field-content-key {
    opacity: 0.6;
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
</style>
