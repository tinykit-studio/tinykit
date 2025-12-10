<script lang="ts">
	import { Pane, Button as TweakButton, Folder, Text, Textarea, Slider, Checkbox } from 'svelte-tweakpane-ui'

	interface ContentField {
		id: string
		name: string
		type: string
		value: any
		description: string
		customType?: string
		config?: any
	}

	interface Props {
		fields: ContentField[]
		on_update?: (id: string, value: any) => void
		on_delete?: (id: string) => void
		on_create?: () => void
	}

	let { fields = [], on_update, on_delete, on_create }: Props = $props()

	// Create reactive objects for Tweakpane bindings
	let field_values = $derived.by(() => {
		const obj: Record<string, any> = {}
		fields.forEach(field => {
			obj[field.id] = field.value
		})
		return obj
	})

	function handle_change(field_id: string, new_value: any) {
		on_update?.(field_id, new_value)
	}
</script>

<div class="content-tweakpane">
	<Pane title="Content Fields" position="inline">
		{#if on_create}
			<TweakButton
				on:click={() => on_create?.()}
				title="Create Field"
			/>
		{/if}

		<Folder title="Fields" expanded={true}>
			{#each fields as field}
				{#if field.type === 'custom'}
					<!-- Custom fields - show a simplified text view -->
					<div class="custom-field-wrapper">
						<span class="field-label">{field.name}</span>
						<span class="custom-type-badge">{field.customType}</span>
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
				{:else if field.type === 'boolean'}
					<!-- Boolean checkbox -->
					<div class="field-wrapper">
						<label>
							<span class="field-label">{field.name}</span>
							<input
								type="checkbox"
								checked={field_values[field.id]}
								on:change={(e) => handle_change(field.id, e.currentTarget.checked)}
								title={field.description || ''}
							/>
						</label>
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
				{:else if field.type === 'number'}
					<!-- Number input -->
					<div class="field-wrapper">
						<label>
							<span class="field-label">{field.name}</span>
							<input
								type="number"
								value={field_values[field.id]}
								on:input={(e) => handle_change(field.id, parseFloat(e.currentTarget.value))}
								title={field.description || ''}
								step="1"
							/>
						</label>
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
				{:else if field.type === 'textarea'}
					<!-- Textarea -->
					<div class="field-wrapper vertical">
						<div class="field-header">
							<span class="field-label">{field.name}</span>
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
						<textarea
							value={field_values[field.id]}
							on:input={(e) => handle_change(field.id, e.currentTarget.value)}
							title={field.description || ''}
							rows="3"
						></textarea>
					</div>
				{:else if field.type === 'json'}
					<!-- JSON textarea -->
					<div class="field-wrapper vertical">
						<div class="field-header">
							<span class="field-label">{field.name} (JSON)</span>
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
						<textarea
							value={typeof field_values[field.id] === 'string' ? field_values[field.id] : JSON.stringify(field_values[field.id], null, 2)}
							on:input={(e) => {
								try {
									const parsed = JSON.parse(e.currentTarget.value)
									handle_change(field.id, parsed)
								} catch {
									// Invalid JSON, store as string
									handle_change(field.id, e.currentTarget.value)
								}
							}}
							title={field.description || ''}
							rows="4"
							class="json-textarea"
						></textarea>
					</div>
				{:else}
					<!-- Text input (default) -->
					<div class="field-wrapper">
						<label>
							<span class="field-label">{field.name}</span>
							<input
								type="text"
								value={field_values[field.id]}
								on:input={(e) => handle_change(field.id, e.currentTarget.value)}
								title={field.description || ''}
							/>
						</label>
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
				{/if}

				{#if field.description}
					<div class="field-description">{field.description}</div>
				{/if}
			{/each}
		</Folder>

		{#if fields.length === 0}
			<div class="empty-state">
				No content fields yet. Click "Create Field" or ask the Agent!
			</div>
		{/if}
	</Pane>
</div>

<style>
	.content-tweakpane {
		height: 100%;
		overflow-y: auto;
	}

	.field-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.field-wrapper.vertical {
		flex-direction: column;
		align-items: stretch;
	}

	.field-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
	}

	.field-label {
		font-size: 0.875rem;
		color: #999;
		margin-bottom: 0.25rem;
		display: block;
	}

	.field-description {
		font-size: 0.75rem;
		color: #666;
		margin-top: -0.5rem;
		margin-bottom: 0.5rem;
		font-style: italic;
	}

	.custom-field-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 0.25rem;
		margin-bottom: 0.75rem;
	}

	.custom-type-badge {
		font-size: 0.75rem;
		background: #7c3aed;
		color: white;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		margin-left: auto;
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
		flex-shrink: 0;
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

	input[type="checkbox"] {
		width: 1.25rem;
		height: 1.25rem;
		cursor: pointer;
		accent-color: #f97316;
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

	textarea {
		width: 100%;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 0.25rem;
		padding: 0.5rem;
		color: white;
		font-size: 0.875rem;
		resize: vertical;
		font-family: inherit;
	}

	textarea.json-textarea {
		font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
		font-size: 0.8rem;
	}

	input[type="number"]:focus,
	input[type="text"]:focus,
	textarea:focus {
		outline: none;
		border-color: #f97316;
	}

	label {
		display: block;
		width: 100%;
	}
</style>
