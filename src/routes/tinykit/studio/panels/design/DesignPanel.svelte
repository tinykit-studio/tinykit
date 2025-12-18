<script lang="ts">
  import { tick } from "svelte";
  import { watch } from "runed";
  import { slide } from "svelte/transition";
  import { dragHandleZone, dragHandle } from "svelte-dnd-action";
  import Icon from "@iconify/svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import type { DesignField, DesignFieldType } from "../../../types";
  import ColorPalette from "../../components/ColorPalette.svelte";
  import RadiusEditor from "../../components/RadiusEditor.svelte";
  import SizeEditor from "../../components/SizeEditor.svelte";
  import * as api from "../../../lib/api.svelte";
  import {
    Square,
    Search,
    Loader2,
    Pencil,
    Palette,
    Type,
    Trash2,
    Eclipse,
    AlignLeft,
    Ruler,
  } from "lucide-svelte";
  import AddFieldButton from "../../components/AddFieldButton.svelte";
  import TypeGrid from "../../components/TypeGrid.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { getProjectContext } from "../../../context";
  import { getProjectStore } from "../../project.svelte";

  const { project_id } = getProjectContext();
  const store = getProjectStore();

  type DesignPanelProps = {
    target_field?: string | null;
    on_refresh_preview: () => void;
    on_target_consumed?: () => void;
  };

  let {
    target_field = null,
    on_refresh_preview,
    on_target_consumed,
  }: DesignPanelProps = $props();

  // Local mutable copy that syncs from store
  let design_fields = $state<DesignField[]>([]);

  // Sync from store (store handles optimistic updates so this is always fresh)
  $effect(() => {
    design_fields = store.design;
  });

  // Map for storing field element references by field id
  let field_elements: Record<string, HTMLDivElement> = {};

  // Track expanded fields - persist to localStorage
  const EXPANDED_STORAGE_KEY = "tinykit:design-expanded-fields";

  function load_expanded_fields(): Set<string> {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem(EXPANDED_STORAGE_KEY);
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch (err) {
      console.error("Failed to load expanded fields from localStorage:", err);
    }
    return new Set();
  }

  let expanded_fields: Set<string> = $state(load_expanded_fields());

  function save_expanded_fields() {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        EXPANDED_STORAGE_KEY,
        JSON.stringify([...expanded_fields]),
      );
    } catch (err) {
      console.error("Failed to save expanded fields to localStorage:", err);
    }
  }

  function toggle_expand(id: string) {
    if (expanded_fields.has(id)) {
      expanded_fields = new Set([...expanded_fields].filter((f) => f !== id));
    } else {
      expanded_fields = new Set([...expanded_fields, id]);
    }
    save_expanded_fields();
  }

  function toggle_all_fields() {
    const all_ids = design_fields.map((f) => f.id);
    const all_expanded = all_ids.every((id) => expanded_fields.has(id));
    if (all_expanded) {
      expanded_fields = new Set();
    } else {
      expanded_fields = new Set(all_ids);
    }
    save_expanded_fields();
  }

  // Watch for target field changes and expand/scroll to the field
  watch(
    () => [target_field, design_fields.length] as const,
    ([field_name, fields_count]) => {
      (async () => {
        if (field_name && fields_count > 0) {
          // Find the field by name
          const field = design_fields.find((f) => f.name === field_name);
          if (field) {
            // Expand the field if not already expanded
            if (!expanded_fields.has(field.id)) {
              expanded_fields = new Set([...expanded_fields, field.id]);
              save_expanded_fields();
            }
            // Wait for DOM to update then scroll into view
            await tick();
            const element = field_elements[field.id];
            if (element) {
              element.scrollIntoView({ behavior: "smooth", block: "center" });
              // Add highlight animation
              element.classList.add("field-highlight");
              setTimeout(
                () => element.classList.remove("field-highlight"),
                1500,
              );
            }
            // Consume the target only after successful action
            on_target_consumed?.();
          }
        }
      })();
    },
  );

  async function delete_field(id: string) {
    try {
      await api.delete_design_field(project_id, id);
      store.delete_design_field(id);
      design_fields = design_fields.filter((f) => f.id !== id);
    } catch (err) {
      console.error("Failed to delete design field:", err);
    }
  }

  // Modal state for adding new fields
  let show_add_modal = $state(false);
  let new_name = $state("");
  let new_value = $state("#3b82f6");
  let new_type: DesignFieldType = $state("color");

  // Field type definitions
  const field_types: {
    value: DesignFieldType;
    label: string;
    default: string;
    icon: typeof Palette;
  }[] = [
    { value: "color", label: "Color", default: "#3b82f6", icon: Palette },
    { value: "size", label: "Size", default: "16px", icon: Ruler },
    { value: "font", label: "Font", default: "Inter", icon: Type },
    { value: "radius", label: "Radius", default: "8px", icon: Square },
    {
      value: "shadow",
      label: "Shadow",
      default: "0 4px 6px rgba(0,0,0,0.1)",
      icon: Eclipse,
    },
    { value: "text", label: "Custom", default: "", icon: AlignLeft },
  ];

  // Bunny Fonts state
  type BunnyFont = {
    familyName: string;
    category: string;
    weights: number[];
    styles: string[];
  };
  let bunny_fonts: BunnyFont[] = $state([]);
  let fonts_loading = $state(false);
  let font_search = $state("");
  let font_dropdown_open = $state(false);
  let loaded_font_links: Set<string> = $state(new Set());
  let filtered_fonts = $derived(
    bunny_fonts
      .filter((f) =>
        f.familyName.toLowerCase().includes(font_search.toLowerCase()),
      )
      .slice(0, 50),
  );

  // Popular fonts for quick selection
  const popular_fonts = [
    { name: "Inter", category: "sans-serif" },
    { name: "Roboto", category: "sans-serif" },
    { name: "Open Sans", category: "sans-serif" },
    { name: "Lato", category: "sans-serif" },
    { name: "Playfair Display", category: "serif" },
    { name: "Merriweather", category: "serif" },
    { name: "Source Code Pro", category: "monospace" },
    { name: "JetBrains Mono", category: "monospace" },
    { name: "Poppins", category: "sans-serif" },
    { name: "Montserrat", category: "sans-serif" },
    { name: "Raleway", category: "sans-serif" },
    { name: "Nunito", category: "sans-serif" },
  ];

  function load_font_preview(font_name: string) {
    if (loaded_font_links.has(font_name)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.bunny.net/css?family=${encodeURIComponent(font_name.toLowerCase().replace(/ /g, "-"))}:400`;
    document.head.appendChild(link);
    loaded_font_links = new Set([...loaded_font_links, font_name]);
  }

  $effect(() => {
    if (font_dropdown_open && filtered_fonts.length > 0) {
      filtered_fonts
        .slice(0, 20)
        .forEach((f) => load_font_preview(f.familyName));
    }
  });

  $effect(() => {
    popular_fonts.forEach((f) => load_font_preview(f.name));
  });

  // Size input state (for add dialog)
  let size_value = $state(16);

  // Radius input state (for add dialog)
  let radius_value = $state(8);

  // Shadow presets
  const shadow_presets = [
    { name: "None", value: "none" },
    { name: "SM", value: "0 1px 2px rgba(0,0,0,0.05)" },
    { name: "MD", value: "0 4px 6px rgba(0,0,0,0.1)" },
    { name: "LG", value: "0 10px 15px rgba(0,0,0,0.1)" },
    { name: "XL", value: "0 20px 25px rgba(0,0,0,0.15)" },
    { name: "Inner", value: "inset 0 2px 4px rgba(0,0,0,0.1)" },
  ];

  async function load_bunny_fonts() {
    if (bunny_fonts.length > 0) return;
    fonts_loading = true;
    try {
      const res = await fetch("https://fonts.bunny.net/list");
      const data = await res.json();
      bunny_fonts = Object.values(data) as BunnyFont[];
      bunny_fonts.sort((a, b) => a.familyName.localeCompare(b.familyName));
    } catch (err) {
      console.error("Failed to load Bunny Fonts:", err);
    } finally {
      fonts_loading = false;
    }
  }

  function name_to_css_var(name: string): string {
    if (!name.trim()) return "";
    return (
      "--" +
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
    );
  }

  let generated_css_var = $derived(name_to_css_var(new_name));

  function reset_modal() {
    new_name = "";
    new_value = "#3b82f6";
    new_type = "color";
    size_value = 16;
    radius_value = 8;
    font_search = "";
    font_dropdown_open = false;
    show_add_modal = false;
  }

  function set_type(type: DesignFieldType) {
    new_type = type;
    const type_def = field_types.find((t) => t.value === type);
    if (type_def) new_value = type_def.default;
    if (type === "font") load_bunny_fonts();
    if (type === "size") {
      size_value = 16;
      new_value = "16px";
    } else if (type === "radius") {
      radius_value = 8;
      new_value = "8px";
    } else if (type === "shadow") {
      new_value = shadow_presets[2].value;
    }
  }

  function update_size_value() {
    new_value = `${size_value}px`;
  }

  function update_radius_value() {
    new_value = radius_value === 9999 ? "9999px" : `${radius_value}px`;
  }

  async function add_field() {
    if (!new_name.trim() || !generated_css_var) return;

    const field_data: Omit<DesignField, "id"> = {
      name: new_name,
      css_var: generated_css_var,
      value: new_value,
      type: new_type,
      unit: new_type === "size" || new_type === "radius" ? "px" : undefined,
      min: new_type === "radius" ? 0 : undefined,
      max: new_type === "radius" ? 50 : undefined,
    };

    try {
      const created_field = await api.add_design_field(project_id, field_data);
      store.add_design_field(created_field);
      // design_fields syncs via $effect from store.design
      reset_modal();
    } catch (err) {
      console.error("Failed to add design field:", err);
    }
  }

  function parse_number(value: string): number {
    return parseFloat(value) || 0;
  }

  function get_unit(value: string): string {
    const match = value.match(/[\d.]+(.*)$/);
    return match?.[1] || "px";
  }

  // Edit dialog state
  let show_edit_modal = $state(false);
  let editing_field: DesignField | null = $state(null);
  let edit_name = $state("");
  let edit_type: DesignFieldType = $state("color");

  function open_edit_modal(field: DesignField) {
    editing_field = field;
    edit_name = field.name;
    edit_type = field.type;
    show_edit_modal = true;
  }

  function reset_edit_modal() {
    editing_field = null;
    edit_name = "";
    edit_type = "color";
    show_edit_modal = false;
  }

  async function save_edit() {
    if (!editing_field || !edit_name.trim()) return;

    const new_css_var = name_to_css_var(edit_name);
    if (!new_css_var) return;

    // Check for duplicate CSS var (excluding current field)
    const duplicate = design_fields.find(
      (f) => f.id !== editing_field!.id && f.css_var === new_css_var,
    );
    if (duplicate) {
      console.error("CSS variable already exists:", new_css_var);
      return;
    }

    try {
      store.pause_realtime();
      const updated_field = {
        ...editing_field,
        name: edit_name,
        css_var: new_css_var,
        type: edit_type,
      };
      await api.update_design_field_meta(project_id, editing_field.id, {
        name: edit_name,
        css_var: new_css_var,
        type: edit_type,
      });
      reset_edit_modal();
    } catch (err) {
      console.error("Failed to update design field:", err);
    }
  }

  // Inline editing helpers for font fields
  let editing_font_field: string | null = $state(null);
  let inline_font_search = $state("");
  let inline_font_dropdown_open = $state(false);

  let inline_filtered_fonts = $derived(
    bunny_fonts
      .filter((f) =>
        f.familyName.toLowerCase().includes(inline_font_search.toLowerCase()),
      )
      .slice(0, 30),
  );

  function open_font_edit(field_id: string, current_value: string) {
    editing_font_field = field_id;
    inline_font_search = "";
    inline_font_dropdown_open = true;
    load_bunny_fonts();
  }

  function close_font_edit() {
    editing_font_field = null;
    inline_font_search = "";
    inline_font_dropdown_open = false;
  }

  $effect(() => {
    if (inline_font_dropdown_open && inline_filtered_fonts.length > 0) {
      inline_filtered_fonts
        .slice(0, 20)
        .forEach((f) => load_font_preview(f.familyName));
    }
  });

  // DnD for reordering fields
  const FLIP_DURATION = 150;

  function handle_dnd_consider(e: CustomEvent<{ items: DesignField[] }>) {
    design_fields = e.detail.items;
  }

  async function handle_dnd_finalize(e: CustomEvent<{ items: DesignField[] }>) {
    design_fields = e.detail.items;
    try {
      store.pause_realtime();
      await api.reorder_design_fields(project_id, design_fields);
    } catch (err) {
      console.error("Failed to reorder design fields:", err);
    }
  }
</script>

<div class="design-panel bg-white/[0.025]">
  <!-- Field list -->
  <div
    class="field-list"
    use:dragHandleZone={{
      items: design_fields,
      flipDurationMs: FLIP_DURATION,
      dropTargetStyle: {},
    }}
    onconsider={handle_dnd_consider}
    onfinalize={handle_dnd_finalize}
  >
    {#each design_fields as field (field.id)}
      {@const is_expanded = expanded_fields.has(field.id)}
      <div
        bind:this={field_elements[field.id]}
        class="field-item"
        class:expanded={is_expanded}
      >
        <div
          class="field-header"
          role="button"
          tabindex="0"
          onclick={() => toggle_expand(field.id)}
          ondblclick={toggle_all_fields}
          onkeydown={(e) => e.key === "Enter" && toggle_expand(field.id)}
        >
          <div class="field-info">
            <span class="field-name">{field.name}</span>
            <span class="field-css-var">{field.css_var}</span>
          </div>

          <div class="field-actions">
            <div
              use:dragHandle
              aria-label="drag-handle"
              class="drag-handle"
              title="Drag to reorder"
            >
              <Icon icon="ic:baseline-drag-handle" class="w-4 h-4" />
            </div>

            <button
              class="edit-btn"
              onclick={(e) => {
                e.stopPropagation();
                open_edit_modal(field);
              }}
              title="Edit field"
            >
              <Pencil size={14} />
            </button>

            <button
              class="delete-btn"
              onclick={(e) => {
                e.stopPropagation();
                delete_field(field.id);
              }}
              title="Delete field"
            >
              <Trash2 size={14} />
            </button>
          </div>

          <div class="field-preview">
            {#if field.type === "color"}
              <span class="color-preview" style:background-color={field.value}
              ></span>
            {:else if field.type === "font"}
              <span
                class="font-preview"
                style="font-family: '{field.value}', sans-serif">Aa</span
              >
            {:else if field.type === "radius"}
              <span
                class="radius-preview"
                style="border-radius: {field.value === '9999px'
                  ? '50%'
                  : field.value}"
              ></span>
            {:else if field.type === "shadow"}
              <span class="shadow-preview" style="box-shadow: {field.value}"
              ></span>
            {:else if field.type === "size"}
              <span class="size-preview">{field.value}</span>
            {:else}
              <span class="text-preview">{field.value}</span>
            {/if}
          </div>
        </div>

        {#if is_expanded}
          {@const theme_colors = design_fields
            .filter((f) => f.type === "color" && f.id !== field.id)
            .map((f) => f.value)}
          <div transition:slide={{ duration: 100 }} class="field-editor">
            {#if field.type === "color"}
              <ColorPalette
                value={field.value}
                {theme_colors}
                onchange={(color) => store.update_design_field(field.id, color)}
              />
            {:else if field.type === "size"}
              <SizeEditor
                value={parse_number(field.value)}
                onchange={(v) => store.update_design_field(field.id, `${v}px`)}
              />
            {:else if field.type === "radius"}
              <RadiusEditor
                value={parse_number(field.value)}
                onchange={(v) => store.update_design_field(field.id, v === 9999 ? "9999px" : `${v}px`)}
              />
            {:else if field.type === "font"}
              <div class="font-editor">
                <div class="font-grid">
                  {#each popular_fonts as font (font.name)}
                    <button
                      type="button"
                      class="font-btn"
                      class:selected={field.value === font.name}
                      onclick={() => store.update_design_field(field.id, font.name)}
                    >
                      <span style="font-family: '{font.name}', {font.category}"
                        >{font.name}</span
                      >
                    </button>
                  {/each}
                </div>
                <div class="font-search-container">
                  <Search size={14} class="search-icon" />
                  <input
                    type="text"
                    class="font-search"
                    placeholder="Search fonts..."
                    bind:value={inline_font_search}
                    onfocus={() => {
                      editing_font_field = field.id;
                      inline_font_dropdown_open = true;
                      load_bunny_fonts();
                    }}
                  />
                  {#if editing_font_field === field.id && inline_font_dropdown_open && inline_font_search.length > 0}
                    <div class="font-dropdown">
                      {#each inline_filtered_fonts as font (font.familyName)}
                        <button
                          type="button"
                          class="font-dropdown-item"
                          class:selected={field.value === font.familyName}
                          onclick={() => {
                            store.update_design_field(field.id, font.familyName);
                            close_font_edit();
                          }}
                        >
                          <span
                            style="font-family: '{font.familyName}', sans-serif"
                            >{font.familyName}</span
                          >
                          <span class="font-category">{font.category}</span>
                        </button>
                      {/each}
                      {#if inline_filtered_fonts.length === 0}
                        <div class="font-no-results">No fonts found</div>
                      {/if}
                    </div>
                  {/if}
                </div>
              </div>
            {:else if field.type === "shadow"}
              <div class="shadow-editor">
                {#each shadow_presets as preset (preset.name)}
                  <button
                    type="button"
                    class="shadow-btn"
                    class:active={field.value === preset.value}
                    onclick={() => store.update_design_field(field.id, preset.value)}
                  >
                    <span class="shadow-box" style="box-shadow: {preset.value}"
                    ></span>
                    <span class="shadow-name">{preset.name}</span>
                  </button>
                {/each}
              </div>
            {:else}
              <Input
                value={field.value}
                onchange={(e: Event) => store.update_design_field(field.id, (e.currentTarget as HTMLInputElement).value)}
              />
            {/if}
          </div>
        {/if}
      </div>
    {/each}

    <!-- Add field button (inside list for proper scroll positioning) -->
    <AddFieldButton
      label="Add Design Field"
      onclick={() => (show_add_modal = true)}
    />
  </div>
</div>

<!-- Add field dialog -->
<Dialog.Root bind:open={show_add_modal}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header class="mt-8">
      <Dialog.Title>Add Design Field</Dialog.Title>
      <Dialog.Description>
        Create a CSS variable that can be edited visually.
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
          placeholder={new_type === "color"
            ? "Primary Color"
            : new_type === "font"
              ? "Body Font"
              : new_type === "radius"
                ? "Card Radius"
                : "Field name"}
        />
        {#if generated_css_var}
          <p class="hint mono">{generated_css_var}</p>
        {:else}
          <p class="hint">Enter a name to generate CSS variable</p>
        {/if}
      </div>

      <!-- Value -->
      <div class="form-group">
        <Label>Value</Label>
        {#if new_type === "color"}
          {@const all_theme_colors = design_fields
            .filter((f) => f.type === "color")
            .map((f) => f.value)}
          <ColorPalette
            bind:value={new_value}
            theme_colors={all_theme_colors}
            onchange={(c) => (new_value = c)}
          />
        {:else if new_type === "size"}
          <SizeEditor
            value={size_value}
            onchange={(v) => {
              size_value = v;
              update_size_value();
            }}
          />
        {:else if new_type === "radius"}
          <RadiusEditor
            value={radius_value}
            onchange={(v) => {
              radius_value = v;
              update_radius_value();
            }}
          />
        {:else if new_type === "font"}
          <div class="font-editor">
            {#if fonts_loading}
              <div class="font-loading">
                <Loader2 size={16} class="animate-spin" />
                <span>Loading fonts...</span>
              </div>
            {:else}
              <div class="font-grid">
                {#each popular_fonts as font (font.name)}
                  <button
                    type="button"
                    class="font-btn"
                    class:selected={new_value === font.name}
                    onclick={() => {
                      new_value = font.name;
                      font_search = "";
                      font_dropdown_open = false;
                    }}
                  >
                    <span style="font-family: '{font.name}', {font.category}"
                      >{font.name}</span
                    >
                  </button>
                {/each}
              </div>
              <div class="font-search-container">
                <Search size={14} class="search-icon" />
                <input
                  type="text"
                  class="font-search"
                  placeholder="Search {bunny_fonts.length} fonts..."
                  bind:value={font_search}
                  onfocus={() => (font_dropdown_open = true)}
                />
                {#if new_value && !font_search}
                  <span
                    class="font-badge"
                    style="font-family: '{new_value}', sans-serif"
                    >{new_value}</span
                  >
                {/if}
                {#if font_dropdown_open && font_search.length > 0}
                  <div class="font-dropdown">
                    {#each filtered_fonts as font (font.familyName)}
                      <button
                        type="button"
                        class="font-dropdown-item"
                        class:selected={new_value === font.familyName}
                        onclick={() => {
                          load_font_preview(font.familyName);
                          new_value = font.familyName;
                          font_search = "";
                          font_dropdown_open = false;
                        }}
                      >
                        <span
                          style="font-family: '{font.familyName}', sans-serif"
                          >{font.familyName}</span
                        >
                        <span class="font-category">{font.category}</span>
                      </button>
                    {/each}
                    {#if filtered_fonts.length === 0}
                      <div class="font-no-results">No fonts found</div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {:else if new_type === "shadow"}
          <div class="shadow-editor">
            {#each shadow_presets as preset (preset.name)}
              <button
                type="button"
                class="shadow-btn"
                class:active={new_value === preset.value}
                onclick={() => (new_value = preset.value)}
              >
                <span class="shadow-box" style="box-shadow: {preset.value}"
                ></span>
                <span class="shadow-name">{preset.name}</span>
              </button>
            {/each}
          </div>
        {:else}
          <Input bind:value={new_value} placeholder="Value" />
        {/if}
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={reset_modal}>Cancel</Button>
      <Button onclick={add_field}>Add Field</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Edit field dialog -->
<Dialog.Root bind:open={show_edit_modal}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header class="mt-8">
      <Dialog.Title>Edit Design Field</Dialog.Title>
      <Dialog.Description>Update the field name or type.</Dialog.Description>
    </Dialog.Header>

    <div class="dialog-content">
      <!-- Name -->
      <div class="form-group">
        <Label for="edit-field-name">Name</Label>
        <Input
          id="edit-field-name"
          bind:value={edit_name}
          placeholder="Field name"
        />
        {#if edit_name}
          <p class="hint mono">{name_to_css_var(edit_name)}</p>
        {/if}
      </div>

      <!-- Type -->
      <div class="form-group">
        <Label>Type</Label>
        <TypeGrid
          types={field_types}
          selected={edit_type}
          onselect={(v) => (edit_type = v as DesignFieldType)}
        />
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={reset_edit_modal}>Cancel</Button>
      <Button onclick={save_edit}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .design-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: hidden;
  }

  .field-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    padding: 12px;
  }

  /* Field item */
  .field-item {
    flex-shrink: 0;
    background: var(--builder-bg-primary);
    border-radius: 2px;
    /* overflow: hidden; */
    transition: box-shadow 0.3s ease-out;
    container-type: inline-size;
    position: relative;
  }

  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    cursor: grab;
    color: var(--builder-text-secondary);
    opacity: 0;
    transition: opacity 0.15s;
    border-radius: 4px;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .field-header:hover .drag-handle {
    opacity: 0.5;
  }

  .field-header:hover .drag-handle:hover {
    opacity: 1;
  }

  /* Highlight animation for targeted fields */
  :global(.field-highlight) {
    animation: highlight-pulse 1.5s ease-out;
  }

  @keyframes highlight-pulse {
    0% {
      box-shadow: 0 0 0 3px var(--tool-design);
    }
    100% {
      box-shadow: 0 0 0 0px transparent;
    }
  }

  .field-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    cursor: pointer;
    background: transparent;
    border: none;
    text-align: left;
    outline: 1px solid transparent;
    outline-offset: -1px;
    transition: outline-color 0.15s;
  }

  .field-header:hover {
    outline-color: var(--builder-accent);
  }

  .field-info {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }

  .field-name {
    font-size: 0.875rem;
    font-weight: 400;
    color: var(--builder-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .field-css-var {
    font-size: 11px;
    font-family: ui-monospace, monospace;
    color: var(--builder-text-secondary);
    opacity: 0;
    transition: opacity 0.15s;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .field-header:hover .field-css-var {
    opacity: 0.6;
  }

  /* Hide CSS var on narrow containers */
  @container (max-width: 280px) {
    .field-css-var {
      display: none;
    }
  }

  .field-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .field-preview {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .color-preview {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: 1px solid var(--builder-border);
  }

  .font-preview {
    font-size: 16px;
    color: var(--builder-text-primary);
    padding: 2px 6px;
    background: var(--builder-bg-secondary);
    border-radius: 4px;
  }

  .radius-preview {
    width: 24px;
    height: 24px;
    background: var(--builder-accent);
  }

  .shadow-preview {
    width: 24px;
    height: 24px;
    background: var(--builder-text-primary);
    border-radius: 4px;
  }

  .size-preview,
  .text-preview {
    font-size: 12px;
    font-family: ui-monospace, monospace;
    color: var(--builder-text-secondary);
    padding: 2px 6px;
    background: var(--builder-bg-secondary);
    border-radius: 4px;
  }

  .edit-btn,
  .delete-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    color: var(--builder-text-secondary);
    cursor: pointer;
    border-radius: 4px;
    opacity: 0;
    transition:
      opacity 0.15s,
      background 0.15s,
      color 0.15s;
  }

  .field-header:hover .field-actions .edit-btn,
  .field-header:hover .field-actions .delete-btn {
    opacity: 1;
  }

  .edit-btn:hover {
    background: rgba(59, 130, 246, 0.1);
    color: #3b82f6;
  }

  .delete-btn:hover {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }

  /* Field editor */
  .field-editor {
    padding: 12px;
    border-top: 1px solid var(--builder-border);
    background: var(--builder-bg-primary);
  }

  /* Font editor */
  .font-editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .font-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .font-btn {
    padding: 8px 6px;
    background: var(--builder-bg-secondary);
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--builder-text-primary);
    cursor: pointer;
    font-size: 11px;
    text-align: center;
    transition: all 0.15s;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .font-btn:hover {
    background: var(--builder-bg-tertiary);
    border-color: var(--builder-border);
  }

  .font-btn.selected {
    background: var(--builder-accent);
    color: white;
    border-color: var(--builder-accent);
  }

  .font-search-container {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--builder-bg-secondary);
    border: 1px solid var(--builder-border);
    border-radius: 6px;
  }

  .font-search-container:focus-within {
    border-color: var(--builder-accent);
  }

  .font-search-container :global(.search-icon) {
    color: var(--builder-text-secondary);
    flex-shrink: 0;
  }

  .font-search {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 13px;
    color: var(--builder-text-primary);
  }

  .font-search::placeholder {
    color: var(--builder-text-secondary);
  }

  .font-badge {
    font-size: 11px;
    color: var(--builder-text-secondary);
    background: var(--builder-bg-secondary);
    padding: 2px 8px;
    border-radius: 4px;
  }

  .font-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--builder-bg-secondary);
    border: 1px solid var(--builder-border);
    border-radius: 6px;
    z-index: 50;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    max-height: 200px;
    overflow-y: auto;
  }

  .font-dropdown-item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: transparent;
    border: none;
    color: var(--builder-text-primary);
    cursor: pointer;
    font-size: 13px;
    text-align: left;
  }

  .font-dropdown-item:hover {
    background: var(--builder-bg-tertiary);
  }

  .font-dropdown-item.selected {
    background: var(--builder-accent);
    color: white;
  }

  .font-category {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--builder-text-secondary);
    opacity: 0.7;
  }

  .font-dropdown-item.selected .font-category {
    color: rgba(255, 255, 255, 0.7);
  }

  .font-no-results {
    padding: 16px;
    text-align: center;
    color: var(--builder-text-secondary);
    font-size: 13px;
  }

  .font-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    color: var(--builder-text-secondary);
    font-size: 13px;
  }

  /* Shadow editor */
  .shadow-editor {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .shadow-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px;
    background: var(--builder-bg-secondary);
    border: 1px solid var(--builder-border);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .shadow-btn:hover {
    background: var(--builder-bg-tertiary);
  }

  .shadow-btn.active {
    border-color: var(--builder-accent);
    background: var(--builder-bg-tertiary);
  }

  .shadow-box {
    width: 32px;
    height: 32px;
    background: var(--builder-text-primary);
    border-radius: 6px;
  }

  .shadow-name {
    font-size: 10px;
    color: var(--builder-text-secondary);
    text-transform: uppercase;
  }

  .shadow-btn.active .shadow-name {
    color: var(--builder-accent);
  }

  /* Dialog styles */
  .dialog-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 0;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .hint {
    font-size: 12px;
    color: var(--builder-text-secondary);
  }

  .hint.mono {
    font-family: ui-monospace, monospace;
  }
</style>
