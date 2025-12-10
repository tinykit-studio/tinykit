<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui'
	import { cn } from '$lib/utils.js'

	let { ref = $bindable(null), class: className, ...restProps }: DialogPrimitive.DescriptionProps = $props()
</script>

<DialogPrimitive.Description bind:ref class={cn('text-[var(--builder-text-secondary)] text-sm', className)} {...restProps} />
