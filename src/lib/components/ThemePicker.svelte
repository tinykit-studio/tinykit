<script lang="ts">
	import { Wand2, Sparkles } from 'lucide-svelte'
	import { predefined_themes, type Theme, type ThemeField } from '$lib/themes'
	import { Button } from '$lib/components/ui/button'
	import { Input } from '$lib/components/ui/input'
	import * as Dialog from '$lib/components/ui/dialog'
	import { pb } from '$lib/pocketbase.svelte'

	interface Props {
		on_apply_theme?: (fields: ThemeField[]) => void
	}

	let { on_apply_theme }: Props = $props()

	let show_ai_prompt = $state(false)
	let ai_prompt = $state('')
	let is_generating = $state(false)
	let selected_theme_id = $state<string | null>(null)

	async function apply_theme(theme: Theme) {
		selected_theme_id = theme.id
		// Generate unique IDs for each field
		const fields_with_ids = theme.fields.map((field, idx) => ({
			...field,
			id: `${theme.id}-${idx}-${Date.now()}`
		}))
		on_apply_theme?.(fields_with_ids)
	}

	async function generate_ai_theme() {
		if (!ai_prompt.trim()) return

		is_generating = true
		try {
			const headers: Record<string, string> = { 'Content-Type': 'application/json' }
			if (pb.authStore.token) {
				headers['Authorization'] = `Bearer ${pb.authStore.token}`
			}
			const res = await fetch('/api/agent/theme', {
				method: 'POST',
				headers,
				body: JSON.stringify({ prompt: ai_prompt })
			})

			if (!res.ok) throw new Error('Failed to generate theme')

			const generated_theme = await res.json()

			// Apply the AI-generated theme
			const fields_with_ids = generated_theme.fields.map((field: ThemeField, idx: number) => ({
				...field,
				id: `ai-generated-${idx}-${Date.now()}`
			}))

			on_apply_theme?.(fields_with_ids)
			show_ai_prompt = false
			ai_prompt = ''
		} catch (err) {
			console.error('Failed to generate theme:', err)
			alert('Failed to generate theme. Make sure your AI provider is configured.')
		} finally {
			is_generating = false
		}
	}
</script>

<div class="theme-picker">
	<div class="header">
		<h3>Theme Picker</h3>
		<Button
			size="sm"
			variant="outline"
			onclick={() => show_ai_prompt = !show_ai_prompt}
		>
			<Wand2 class="w-4 h-4 mr-2" />
			AI Generate
		</Button>
	</div>

	{#if show_ai_prompt}
		<div class="ai-prompt-section">
			<Input
				type="text"
				placeholder="Describe your theme (e.g., 'modern dashboard with teal and purple')"
				bind:value={ai_prompt}
				onkeydown={(e) => {
					if (e.key === 'Enter' && !is_generating) {
						generate_ai_theme()
					}
				}}
			/>
			<Button
				size="sm"
				onclick={generate_ai_theme}
				disabled={is_generating || !ai_prompt.trim()}
			>
				{#if is_generating}
					<Sparkles class="w-4 h-4 mr-2 animate-spin" />
					Generating...
				{:else}
					<Sparkles class="w-4 h-4 mr-2" />
					Generate
				{/if}
			</Button>
		</div>
	{/if}

	<div class="themes-grid">
		{#each predefined_themes as theme}
			<button
				class="theme-card"
				class:selected={selected_theme_id === theme.id}
				onclick={() => apply_theme(theme)}
			>
				<div class="theme-preview">
					<div class="preview-colors">
						<div class="color-swatch" style="background-color: {theme.preview.primary}"></div>
						<div class="color-swatch" style="background-color: {theme.preview.secondary}"></div>
						<div class="color-swatch" style="background-color: {theme.preview.accent}"></div>
						<div class="color-swatch large" style="background-color: {theme.preview.background}"></div>
					</div>
				</div>
				<div class="theme-info">
					<h4>{theme.name}</h4>
					<p>{theme.description}</p>
				</div>
			</button>
		{/each}
	</div>
</div>

<style>
	.theme-picker {
		padding: 1rem;
		height: 100%;
		overflow-y: auto;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.header h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: white;
	}

	.ai-prompt-section {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		padding: 1rem;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 0.5rem;
	}

	.ai-prompt-section :global(input) {
		flex: 1;
	}

	.themes-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 1rem;
	}

	.theme-card {
		background: #1e1e1e;
		border: 2px solid #2a2a2a;
		border-radius: 0.5rem;
		padding: 0;
		cursor: pointer;
		transition: all 0.2s;
		overflow: hidden;
	}

	.theme-card:hover {
		border-color: #f97316;
		transform: translateY(-2px);
	}

	.theme-card.selected {
		border-color: #f97316;
		box-shadow: 0 0 0 1px #f97316;
	}

	.theme-preview {
		padding: 1rem;
		background: #151515;
	}

	.preview-colors {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}

	.color-swatch {
		aspect-ratio: 1;
		border-radius: 0.25rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
	}

	.color-swatch.large {
		grid-column: span 3;
		aspect-ratio: 3 / 1;
	}

	.theme-info {
		padding: 1rem;
		text-align: left;
	}

	.theme-info h4 {
		font-size: 0.875rem;
		font-weight: 600;
		color: white;
		margin-bottom: 0.25rem;
	}

	.theme-info p {
		font-size: 0.75rem;
		color: #999;
		line-height: 1.4;
	}

	@media (max-width: 768px) {
		.themes-grid {
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		}
	}
</style>
