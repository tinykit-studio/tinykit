<script lang="ts">
	import { Switch as SwitchPrimitive } from 'bits-ui'
	import { cn } from '$lib/utils'

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		class: className,
		...restProps
	}: SwitchPrimitive.RootProps = $props()
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	class={cn(
		'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--builder-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--builder-bg-primary)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--builder-accent)] data-[state=unchecked]:bg-[var(--builder-bg-tertiary)]',
		className
	)}
	{...restProps}
>
	<SwitchPrimitive.Thumb
		class={cn(
			'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0'
		)}
	/>
</SwitchPrimitive.Root>
