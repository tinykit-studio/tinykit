<script lang="ts" generics="T extends string">
	import type { Type } from "lucide-svelte"

	type TypeOption = {
		value: T
		label: string
		icon: typeof Type
	}

	let {
		types,
		selected,
		onselect
	}: {
		types: TypeOption[]
		selected: T
		onselect: (value: T) => void
	} = $props()
</script>

<div class="type-grid">
	{#each types as t (t.value)}
		{@const IconComponent = t.icon}
		<button
			type="button"
			onclick={() => onselect(t.value)}
			class="type-btn"
			class:active={selected === t.value}
		>
			<IconComponent size={18} />
			<span>{t.label}</span>
		</button>
	{/each}
</div>

<style>
	.type-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}

	.type-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 12px 8px;
		border-radius: 8px;
		border: 1px solid var(--builder-border);
		background: var(--builder-bg-secondary);
		color: var(--builder-text-secondary);
		cursor: pointer;
		transition: all 0.15s;
		font-size: 12px;
	}

	.type-btn:hover {
		border-color: var(--builder-text-secondary);
		color: var(--builder-text-primary);
	}

	.type-btn.active {
		border-color: var(--builder-accent);
		color: var(--builder-accent);
	}
</style>
