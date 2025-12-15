<script lang="ts">
	import { generate_smart_palette } from "$lib/utils/color-utils"

	type Props = {
		value: string
		label?: string
		compact?: boolean
		theme_colors?: string[]
		onchange: (color: string) => void
	}

	let { value = $bindable(), label = "", compact = false, theme_colors = [], onchange }: Props = $props()

	let expanded = $state(false)

	// Generate palette from theme colors
	let palette = $derived(generate_smart_palette(theme_colors, 24))

	// Check if current value is custom (not in palette)
	let is_custom = $derived(!palette.includes(value.toLowerCase()))

	function select(color: string) {
		value = color
		if (compact) expanded = false
		onchange(color)
	}

	function handle_hex_input(e: Event) {
		const input = e.target as HTMLInputElement
		let hex = input.value.trim()
		if (!hex.startsWith('#')) hex = '#' + hex
		if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
			value = hex
			onchange(hex)
		}
	}

	function handle_native_picker(e: Event) {
		const input = e.target as HTMLInputElement
		value = input.value
		onchange(input.value)
	}
</script>

{#if compact}
	<!-- Compact mode: label + hex input, expandable palette -->
	<div class="color-field-compact">
		<button
			type="button"
			class="compact-header"
			onclick={() => (expanded = !expanded)}
		>
			<span class="compact-label">{label}</span>
			<div class="compact-value">
				<span
					class="compact-swatch"
					style:background-color={value}
				></span>
				<input
					type="text"
					class="compact-hex"
					value={value}
					onclick={(e) => e.stopPropagation()}
					onchange={handle_hex_input}
					onkeydown={(e) => e.key === 'Enter' && handle_hex_input(e)}
				/>
			</div>
		</button>

		{#if expanded}
			<div class="compact-palette">
				<div class="palette-grid">
					{#each palette as color (color)}
						<button
							type="button"
							class="swatch"
							class:selected={value.toLowerCase() === color}
							style:background-color={color}
							style:border-color={color === "#ffffff" ? "var(--builder-border)" : "transparent"}
							onclick={() => select(color)}
							title={color}
							aria-label="Select color {color}"
						></button>
					{/each}

					<!-- Show custom color as separate swatch if not in palette -->
					{#if is_custom}
						<button
							type="button"
							class="swatch selected"
							style:background-color={value}
							onclick={() => select(value)}
							title={value}
							aria-label="Current custom color {value}"
						></button>
					{/if}

					<!-- Plus button with native picker overlay -->
					<div class="picker-wrapper">
						<div class="swatch custom">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M12 5v14M5 12h14" />
							</svg>
						</div>
						<input
							type="color"
							class="picker-overlay"
							value={value}
							oninput={handle_native_picker}
							title="Pick custom color"
						/>
					</div>
				</div>
			</div>
		{/if}
	</div>
{:else}
	<!-- Full mode: always show palette -->
	<div class="color-field">
		{#if label}
			<span class="label">{label}</span>
		{/if}

		<div class="palette-grid">
			{#each palette as color (color)}
				<button
					type="button"
					class="swatch"
					class:selected={value.toLowerCase() === color}
					style:background-color={color}
					style:border-color={color === "#ffffff" ? "var(--builder-border)" : "transparent"}
					onclick={() => select(color)}
					title={color}
					aria-label="Select color {color}"
				></button>
			{/each}

			<!-- Show custom color as separate swatch if not in palette -->
			{#if is_custom}
				<button
					type="button"
					class="swatch selected"
					style:background-color={value}
					onclick={() => select(value)}
					title={value}
					aria-label="Current custom color {value}"
				></button>
			{/if}

			<!-- Plus button with native picker overlay -->
			<div class="picker-wrapper">
				<div class="swatch custom">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M12 5v14M5 12h14" />
					</svg>
				</div>
				<input
					type="color"
					class="picker-overlay"
					value={value}
					oninput={handle_native_picker}
					title="Pick custom color"
				/>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ========== COMPACT MODE ========== */
	.color-field-compact {
		display: flex;
		flex-direction: column;
	}

	.compact-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 6px 0;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.compact-header:hover {
		background: var(--builder-bg-tertiary);
		margin: 0 -8px;
		padding: 6px 8px;
		width: calc(100% + 16px);
		border-radius: 4px;
	}

	.compact-label {
		font-size: 11px;
		color: var(--builder-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.compact-value {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.compact-swatch {
		width: 20px;
		height: 20px;
		border-radius: 4px;
		border: 1px solid var(--builder-border);
		flex-shrink: 0;
	}

	.compact-hex {
		width: 72px;
		padding: 4px 8px;
		font-size: 12px;
		font-family: ui-monospace, monospace;
		background: var(--builder-bg-tertiary);
		border: 1px solid var(--builder-border);
		border-radius: 4px;
		color: var(--builder-text-primary);
	}

	.compact-hex:focus {
		outline: none;
		border-color: var(--builder-accent);
	}

	.compact-palette {
		padding: 8px 0;
		margin-top: 4px;
		border-top: 1px solid var(--builder-border);
	}

	/* ========== FULL MODE ========== */
	.color-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.label {
		font-size: 11px;
		color: var(--builder-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/* ========== SHARED STYLES ========== */
	.palette-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(28px, 1fr));
		gap: 6px;
	}

	.swatch {
		aspect-ratio: 1;
		width: 100%;
		border-radius: 4px;
		border: 2px solid transparent;
		cursor: pointer;
		transition: transform 0.1s, box-shadow 0.1s;
	}

	.swatch:hover {
		transform: scale(1.1);
		z-index: 1;
	}

	.swatch.selected {
		box-shadow: 0 0 0 2px var(--builder-bg-secondary), 0 0 0 3px var(--builder-accent);
	}

	.swatch.custom {
		border: 2px dashed var(--builder-border);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--builder-text-secondary);
	}

	.swatch.custom:hover {
		border-color: var(--builder-text-secondary);
	}

	.swatch.custom svg {
		width: 14px;
		height: 14px;
	}

	/* Picker wrapper - positions overlay on top of the + button */
	.picker-wrapper {
		position: relative;
		aspect-ratio: 1;
		width: 100%;
	}

	.picker-wrapper .swatch {
		width: 100%;
		height: 100%;
	}

	.picker-wrapper:hover .swatch {
		transform: scale(1.1);
		z-index: 1;
	}

	.picker-overlay {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
		width: 100%;
		height: 100%;
	}
</style>
