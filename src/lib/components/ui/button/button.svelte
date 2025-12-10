<script lang="ts" module>
	import type { WithElementRef } from 'bits-ui'
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements'
	import { type VariantProps, tv } from 'tailwind-variants'

	export const buttonVariants = tv({
		base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--builder-accent)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
		variants: {
			variant: {
				default: 'bg-[var(--builder-accent)] text-white hover:opacity-90 shadow-sm',
				destructive: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
				outline: 'border border-[var(--builder-border)] bg-transparent text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)] shadow-sm',
				secondary: 'bg-[var(--builder-bg-secondary)] text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-tertiary)] shadow-sm',
				ghost: 'text-[var(--builder-text-secondary)] hover:bg-[var(--builder-bg-secondary)] hover:text-[var(--builder-text-primary)]',
				link: 'text-[var(--builder-accent)] underline-offset-4 hover:underline'
			},
			size: {
				default: 'h-9 px-4 py-2',
				sm: 'h-8 px-3 text-xs',
				lg: 'h-10 px-8',
				icon: 'h-9 w-9'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	})

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant']
	export type ButtonSize = VariantProps<typeof buttonVariants>['size']

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant
			size?: ButtonSize
		}
</script>

<script lang="ts">
	import { cn } from '$lib/utils'

	let { class: className, variant = 'default', size = 'default', ref = $bindable(null), href = undefined, type = 'button', children, ...restProps }: ButtonProps = $props()
</script>

{#if href}
	<a bind:this={ref} class={cn(buttonVariants({ variant, size }), className)} {href} {...restProps}>
		{@render children?.()}
	</a>
{:else}
	<button bind:this={ref} class={cn(buttonVariants({ variant, size }), className)} {type} {...restProps}>
		{@render children?.()}
	</button>
{/if}
