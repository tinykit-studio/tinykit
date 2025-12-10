<script lang="ts">
	import { cn } from "$lib/utils.js"
	import { Tooltip as TooltipPrimitive } from "bits-ui"

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		portalProps,
		...restProps
	}: TooltipPrimitive.ContentProps & {
		portalProps?: TooltipPrimitive.PortalProps
	} = $props()
</script>

<TooltipPrimitive.Portal {...portalProps}>
	<TooltipPrimitive.Content
		bind:ref
		{sideOffset}
		class={cn(
			"bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 overflow-hidden rounded-md border border-[var(--builder-border)] px-3 py-1.5 text-sm shadow-md",
			className
		)}
		{...restProps}
	/>
</TooltipPrimitive.Portal>
