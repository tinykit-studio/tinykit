<script lang="ts">
  import type {
    HTMLInputAttributes,
    HTMLInputTypeAttribute,
  } from "svelte/elements";
  import { cn, type WithElementRef } from "$lib/utils.js";
  type InputType = Exclude<HTMLInputTypeAttribute, "file">;
  type Props = WithElementRef<
    Omit<HTMLInputAttributes, "type"> &
      (
        | { type: "file"; files?: FileList }
        | { type?: InputType; files?: undefined }
      )
  >;
  let {
    ref = $bindable(null),
    value = $bindable(),
    type,
    files = $bindable(),
    class: className,
    "data-slot": dataSlot = "input",
    ...restProps
  }: Props = $props();
</script>

{#if type === "file"}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    class={cn(
      "flex h-9 w-full min-w-0 rounded-md border px-3 pt-1.5 text-sm font-medium outline-none transition-all",
      "bg-[var(--builder-bg-secondary)] border-[var(--builder-border)] text-[var(--builder-text-primary)]",
      "placeholder:text-[var(--builder-text-muted)]",
      "focus:border-[var(--builder-accent)] focus:ring-1 focus:ring-[var(--builder-accent)]/50",
      "hover:border-[var(--builder-bg-hover)]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--builder-text-secondary)]",
      className,
    )}
    type="file"
    bind:files
    bind:value
    {...restProps}
  />
{:else}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    class={cn(
      "flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm outline-none transition-all",
      "bg-[var(--builder-bg-secondary)] border-[var(--builder-border)] text-[var(--builder-text-primary)]",
      "placeholder:text-[var(--builder-text-muted)]",
      "focus:border-[var(--builder-accent)] focus:ring-1 focus:ring-[var(--builder-accent)]/50",
      "hover:border-[var(--builder-bg-hover)]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {type}
    bind:value
    {...restProps}
  />
{/if}
