<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements'
	import type { WithElementRef } from 'bits-ui'
	import { cn } from '$lib/utils'

	let { ref = $bindable(null), value = $bindable(), class: className, ...restProps }: WithElementRef<HTMLTextareaAttributes> = $props()
</script>

<textarea
	bind:this={ref}
	class={cn(
		'border-[var(--builder-border)] bg-[var(--builder-bg-secondary)] text-[var(--builder-text-primary)] placeholder:text-[var(--builder-text-secondary)] focus-visible:ring-[var(--builder-accent)] focus-visible:border-[var(--builder-accent)] flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	bind:value
	{...restProps}
></textarea>
