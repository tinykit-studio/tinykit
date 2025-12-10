<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui'
	import { cn } from '$lib/utils'

	let { ref = $bindable(null), class: className, ...restProps }: DropdownMenuPrimitive.SeparatorProps = $props()
</script>

<DropdownMenuPrimitive.Separator bind:ref class={cn('bg-[var(--builder-border)] -mx-1 my-1 h-px', className)} {...restProps} />
