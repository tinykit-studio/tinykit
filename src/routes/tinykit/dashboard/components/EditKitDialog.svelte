<script lang="ts">
  import { Loader2 } from "lucide-svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import IconPicker from "../../studio/components/IconPicker.svelte";
  import type { Kit } from "../../types";

  let {
    kit,
    open = $bindable(false),
    on_save,
  }: {
    kit: Kit;
    open: boolean;
    on_save: (
      id: string,
      name: string,
      icon: string,
      builder_theme_id?: string
    ) => Promise<void>;
  } = $props();

  let name = $state(kit.name);
  let icon = $state(kit.icon);
  let is_saving = $state(false);

  // Reset local state when kit prop changes or dialog opens
  $effect(() => {
    if (open) {
      name = kit.name;
      icon = kit.icon;
    }
  });

  async function handle_save() {
    if (!name.trim()) return;
    is_saving = true;
    try {
      // Pass existing theme id without modification
      await on_save(kit.id, name, icon, kit.builder_theme_id);
      open = false;
    } finally {
      is_saving = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[425px]">
    <Dialog.Header>
      <Dialog.Title class="text-[var(--builder-text-primary)]"
        >Edit Kit</Dialog.Title
      >
      <Dialog.Description class="text-[var(--builder-text-secondary)]">
        Update the name and icon for this kit.
      </Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-6 py-4">
      <div class="flex flex-col gap-3">
        <label
          for="name"
          class="text-sm font-medium text-[var(--builder-text-primary)]"
          >Name</label
        >
        <Input
          id="name"
          bind:value={name}
          placeholder="Kit Name"
          class="bg-[var(--builder-bg-primary)] text-[var(--builder-text-primary)] border-[var(--builder-border)] placeholder:text-[var(--builder-text-secondary)]"
        />
      </div>

      <div class="flex flex-col gap-3">
        <label
          for="icon"
          class="text-sm font-medium text-[var(--builder-text-primary)]"
          >Icon</label
        >
        <!-- IconPicker might need internal updates or a wrapper class, assuming it uses inherited color -->
        <div class="text-[var(--builder-text-primary)]">
          <IconPicker bind:value={icon} />
        </div>
      </div>
    </div>

    <Dialog.Footer>
      <Button
        variant="outline"
        onclick={() => (open = false)}
        class="border-[var(--builder-border)] text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)]"
        >Cancel</Button
      >
      <Button disabled={!name.trim() || is_saving} onclick={handle_save}>
        {#if is_saving}
          <Loader2 class="mr-2 h-4 w-4 animate-spin" />
        {/if}
        Save Changes
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
