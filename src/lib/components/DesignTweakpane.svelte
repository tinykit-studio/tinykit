<script lang="ts">
	import { Pane, Button as TweakButton, Folder } from 'svelte-tweakpane-ui'

	interface DesignField {
		id: string
		name: string
		css_var: string
		value: string
		description: string
	}

	interface Props {
		fields: DesignField[]
		on_update?: (id: string, value: string) => void
		on_delete?: (id: string) => void
		on_create?: () => void
	}

	let { fields = [], on_update, on_delete, on_create }: Props = $props()

	// Group fields by type for better organization
	let grouped_fields = $derived.by(() => {
		const colors: DesignField[] = []
		const spacing: DesignField[] = []
		const typography: DesignField[] = []
		const other: DesignField[] = []

		fields.forEach(field => {
			const var_name = field.css_var.toLowerCase()
			if (var_name.includes('color') || var_name.includes('bg') || field.value.startsWith('#')) {
				colors.push(field)
			} else if (var_name.includes('spacing') || var_name.includes('padding') || var_name.includes('margin') || var_name.includes('gap')) {
				spacing.push(field)
			} else if (var_name.includes('font') || var_name.includes('text') || var_name.includes('size')) {
				typography.push(field)
			} else {
				other.push(field)
			}
		})

		return { colors, spacing, typography, other }
	})

	// Create reactive objects for Tweakpane bindings
	let field_values = $derived.by(() => {
		const obj: Record<string, any> = {}
		fields.forEach(field => {
			// Parse numeric values (e.g., "16px" -> {value: 16, unit: 'px'})
			const numeric_match = field.value.match(/^(-?\d+\.?\d*)(px|rem|em|%)?$/)
			if (numeric_match) {
				obj[field.id] = parseFloat(numeric_match[1])
			} else {
				obj[field.id] = field.value
			}
		})
		return obj
	})

	function handle_change(field_id: string, new_value: any) {
		const field = fields.find(f => f.id === field_id)
		if (!field) return

		// Convert back to string with unit if needed
		let value_str: string
		const numeric_match = field.value.match(/^(-?\d+\.?\d*)(px|rem|em|%)?$/)
		if (numeric_match && typeof new_value === 'number') {
			const unit = numeric_match[2] || ''
			value_str = `${new_value}${unit}`
		} else {
			value_str = String(new_value)
		}

		on_update?.(field_id, value_str)
	}

	function render_field_group(group: DesignField[], title: string, expanded = true) {
		return group.length > 0 ? { group, title, expanded } : null
	}
</script>

<div class="design-tweakpane">
	<Pane title="Design System" position="inline">
		{#if on_create}
			<TweakButton
				on:click={() => on_create?.()}
				title="Create Field"
			/>
		{/if}

		{#each [
			render_field_group(grouped_fields.colors, 'Colors', true),
			render_field_group(grouped_fields.spacing, 'Spacing', true),
			render_field_group(grouped_fields.typography, 'Typography', true),
			render_field_group(grouped_fields.other, 'Other', false)
		].filter(Boolean) as folder_data}
			{#if folder_data}
				<Folder title={folder_data.title} expanded={folder_data.expanded}>
					{#each folder_data.group as field}
						<div class="field-wrapper">
							{#if field.value.startsWith('#')}
								<!-- Color picker -->
								<input
									type="color"
									value={field_values[field.id]}
									on:change={(e) => handle_change(field.id, e.currentTarget.value)}
									title={field.description || field.name}
								/>
							{:else if typeof field_values[field.id] === 'number'}
								<!-- Slider for numeric values -->
								<label>
									<span class="field-label">{field.name}</span>
									<input
										type="number"
										value={field_values[field.id]}
										on:input={(e) => handle_change(field.id, parseFloat(e.currentTarget.value))}
										title={field.description || ''}
										step="0.1"
									/>
								</label>
							{:else}
								<!-- Text input for strings -->
								<label>
									<span class="field-label">{field.name}</span>
									<input
										type="text"
										value={field_values[field.id]}
										on:input={(e) => handle_change(field.id, e.currentTarget.value)}
										title={field.description || ''}
									/>
								</label>
							{/if}

							{#if on_delete}
								<button
									class="delete-btn"
									on:click={() => on_delete?.(field.id)}
									title="Delete {field.name}"
								>
									×
								</button>
							{/if}
						</div>
					{/each}
				</Folder>
			{/if}
		{/each}

		{#if fields.length === 0}
			<div class="empty-state">
				No design fields yet. Click "Create Field" or ask the Agent!
			</div>
		{/if}
	</Pane>
</div>

<style>
	.design-tweakpane {
		height: 100%;
		overflow-y: auto;
	}

	.field-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.field-label {
		font-size: 0.875rem;
		color: #999;
		margin-bottom: 0.25rem;
		display: block;
	}

	.delete-btn {
		background: transparent;
		border: none;
		color: #666;
		cursor: pointer;
		font-size: 1.5rem;
		line-height: 1;
		padding: 0.25rem 0.5rem;
		transition: color 0.2s;
	}

	.delete-btn:hover {
		color: #ef4444;
	}

	.empty-state {
		padding: 2rem;
		text-align: center;
		color: #666;
		font-size: 0.875rem;
	}

	input[type="color"] {
		width: 100%;
		height: 2.5rem;
		border: 1px solid #2a2a2a;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	input[type="number"],
	input[type="text"] {
		width: 100%;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 0.25rem;
		padding: 0.5rem;
		color: white;
		font-size: 0.875rem;
	}

	input[type="number"]:focus,
	input[type="text"]:focus {
		outline: none;
		border-color: #f97316;
	}
</style>
