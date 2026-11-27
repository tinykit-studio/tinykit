<script lang="ts">
  import Icon from "@iconify/svelte";
  import { Search } from "lucide-svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import {
    TEMPLATES,
    get_template_groups,
    type Template,
  } from "$lib/templates";
  let {
    on_select,
    on_close,
  }: { on_select: (template: Template) => void; on_close: () => void } =
    $props();
  let search = $state("");
  let templates = $derived(
    TEMPLATES.filter((template) =>
      `${template.name} ${template.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    ),
  );
  let groups = $derived(get_template_groups(templates));
</script>

<Dialog.Root
  open={true}
  onOpenChange={(open) => {
    if (!open) on_close();
  }}
>
  <Dialog.Content class="max-w-2xl max-h-[85dvh] flex flex-col">
    <Dialog.Header>
      <Dialog.Title>Load template</Dialog.Title>
      <Dialog.Description
        >Replaces this app’s code, content, design, and data.</Dialog.Description
      >
    </Dialog.Header>
    <div class="search-field">
      <Search size={15} /><input
        type="search"
        aria-label="Search templates"
        placeholder="Search templates…"
        bind:value={search}
      />
    </div>
    <div class="template-list">
      {#each groups as group (group.id)}
        <section class="template-group" aria-label={group.label}>
          {#if group.id === "featured" || groups.length > 1}
            <h3>{group.label}<span>{group.templates.length}</span></h3>
          {/if}
          {#each group.templates as template (template.id)}<button
              onclick={() => on_select(template)}
              class="template-choice"
              ><Icon icon={template.preview} width={18} /><span
                ><strong>{template.name}</strong><span class="description"
                  >{template.description}</span
                ></span
              ></button
            >
          {/each}
        </section>
      {:else}<p class="empty">No templates match your search.</p>{/each}
    </div>
  </Dialog.Content>
</Dialog.Root>

<style>
  .search-field {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    border: 1px solid var(--builder-border);
    border-radius: 5px;
    color: var(--builder-text-secondary);
  }
  .search-field:focus-within {
    border-color: var(--builder-accent);
  }
  input {
    width: 100%;
    min-width: 0;
    background: transparent;
    outline: none;
    font-size: 13px;
    color: var(--builder-text-primary);
  }
  .template-list {
    overflow-y: auto;
    min-height: 0;
  }
  .template-group + .template-group {
    margin-top: 24px;
  }
  h3 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 8px 0 0;
    font-size: 12px;
    font-weight: 500;
  }
  h3 > span {
    color: var(--builder-text-secondary);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  .template-choice {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    text-align: left;
    width: 100%;
    padding: 14px 0;
    border-bottom: 1px solid var(--builder-border);
  }
  .template-choice :global(svg) {
    flex-shrink: 0;
    color: var(--builder-text-secondary);
    margin-top: 2px;
  }
  strong {
    font-size: 13px;
    font-weight: 500;
  }
  .template-choice:hover strong {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .description {
    display: block;
    color: var(--builder-text-secondary);
    font-size: 12px;
    line-height: 1.5;
    margin-top: 4px;
  }
  .empty {
    font-size: 13px;
    padding-block: 24px;
    color: var(--builder-text-secondary);
  }
</style>
