<script lang="ts">
	import { PaintBucket } from 'lucide-svelte'
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
	import { builder_themes, apply_builder_theme, save_theme, type BuilderTheme } from '$lib/builder_themes'
	import { onMount } from 'svelte'

	let current_theme = $state<BuilderTheme>(builder_themes[0])
	let hovered_theme = $state<BuilderTheme | null>(null)
	let show_theme_menu = $state(false)

	onMount(() => {
		const saved_id = localStorage.getItem('builder-theme')
		const theme = builder_themes.find(t => t.id === saved_id) || builder_themes[0]
		current_theme = theme
		apply_builder_theme(theme)
	})

	function preview_theme(theme: BuilderTheme) {
		hovered_theme = theme
		apply_builder_theme(theme)
	}

	function clear_preview() {
		hovered_theme = null
		apply_builder_theme(current_theme)
	}

	function select_theme(theme: BuilderTheme) {
		current_theme = theme
		hovered_theme = null
		apply_builder_theme(theme)
		save_theme(theme.id)
		show_theme_menu = false
	}
</script>

{#if show_theme_menu}
	<div class="theme-submenu-overlay" onclick={() => show_theme_menu = false}></div>
	<div class="theme-submenu">
		<div class="px-3 py-2 text-sm font-semibold border-b border-[var(--builder-border)]">
			Builder Theme
		</div>
		<div class="max-h-96 overflow-y-auto p-1">
			{#each builder_themes as theme}
				<button
					onclick={() => select_theme(theme)}
					onmouseenter={() => preview_theme(theme)}
					onmouseleave={clear_preview}
					class="w-full flex items-center justify-between gap-3 px-2 py-2 rounded hover:bg-[var(--builder-bg-secondary)] cursor-pointer transition-colors"
				>
					<div class="flex items-center gap-2 flex-1">
						<div class="flex gap-0.5">
							<div class="w-3 h-6 rounded-sm" style="background-color: {theme.colors.bg_secondary}"></div>
							<div class="w-3 h-6 rounded-sm" style="background-color: {theme.colors.accent}"></div>
						</div>
						<span class="text-sm">{theme.name}</span>
					</div>
					{#if current_theme.id === theme.id}
						<div class="w-2 h-2 rounded-full bg-[var(--builder-accent)]"></div>
					{/if}
				</button>
			{/each}
		</div>
	</div>
{/if}

<button
	onclick={() => show_theme_menu = !show_theme_menu}
	class="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-[var(--builder-bg-secondary)] rounded-sm cursor-pointer"
>
	<PaintBucket class="w-4 h-4" />
	<span>Theme</span>
</button>

<style>
	.theme-submenu-overlay {
		position: fixed;
		inset: 0;
		z-index: 40;
	}

	.theme-submenu {
		position: fixed;
		right: 16px;
		top: 80px;
		width: 240px;
		background: var(--builder-bg-secondary);
		border: 1px solid var(--builder-border);
		border-radius: 0.5rem;
		box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
		z-index: 50;
		color: var(--builder-text-primary);
	}
</style>
