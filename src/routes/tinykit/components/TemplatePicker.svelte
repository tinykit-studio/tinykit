<script lang="ts">
	import Icon from '@iconify/svelte'
	import { TEMPLATES, type Template } from '$lib/templates'

	type TemplatePickerProps = {
		on_select: (template: Template) => void
		on_close: () => void
	}

	let { on_select, on_close }: TemplatePickerProps = $props()
</script>

<!-- Modal Overlay -->
<div
	class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
	onclick={on_close}
>
	<!-- Modal Content -->
	<div
		class="bg-[var(--builder-bg-primary)] border border-[var(--builder-border)] rounded-lg p-6 max-w-2xl w-full mx-4"
		onclick={(e) => e.stopPropagation()}
	>
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-xl font-bold text-[var(--builder-text-primary)]">
				Choose a Template
			</h2>
			<button
				onclick={on_close}
				class="text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] text-2xl leading-none"
			>
				×
			</button>
		</div>

		<p class="text-sm text-[var(--builder-text-secondary)] mb-4">
			Start with a template to quickly build your app.
		</p>

		<!-- Template scroll -->
		<div class="relative">
			<!-- Right fade only -->
			<div class="absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-[var(--builder-bg-primary)] to-transparent z-10 pointer-events-none"></div>

			<div class="flex gap-3 overflow-x-auto pb-2 pr-6 scrollbar-hide">
				{#each TEMPLATES as template}
					<button
						onclick={() => on_select(template)}
						class="flex-shrink-0 w-40 flex flex-col items-start gap-3 p-4 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg hover:border-[var(--builder-accent)] hover:bg-[var(--builder-bg-tertiary)] transition-all text-left"
					>
						<Icon icon={template.preview} class="w-5 h-5 text-[var(--builder-accent)]" />
						<div>
							<div class="font-medium text-[var(--builder-text-primary)] text-sm">
								{template.name}
							</div>
							<div class="text-xs text-[var(--builder-text-muted)] mt-0.5 line-clamp-2">
								{template.description}
							</div>
						</div>
					</button>
				{/each}
			</div>
		</div>

		<!-- Warning -->
		<div class="mt-4 p-3 bg-orange-900/20 border border-orange-700/50 rounded-lg">
			<p class="text-xs text-orange-300">
				⚠️ Loading a template will replace your current project files
			</p>
		</div>
	</div>
</div>

<style>
	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
</style>
