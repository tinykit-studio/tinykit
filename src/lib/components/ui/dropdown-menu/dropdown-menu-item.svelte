<script lang="ts">
	import { cn } from '$lib/utils'
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui'

	let {
		ref = $bindable(null),
		class: className,
		inset,
		...restProps
	}: DropdownMenuPrimitive.ItemProps & {
		inset?: boolean
	} = $props()
</script>

<DropdownMenuPrimitive.Item
	bind:ref
	class={cn(
		'data-highlighted:bg-[var(--builder-bg-secondary)] data-highlighted:text-[var(--builder-text-primary)] relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-disabled:pointer-events-none data-disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
		inset && 'pl-8',
		className
	)}
	{...restProps}
/>
