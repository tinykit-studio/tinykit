<script lang="ts">
	import Plus from "lucide-svelte/icons/plus"

	type AddFieldButtonProps = {
		label: string
		onclick: () => void
	}

	let { label, onclick }: AddFieldButtonProps = $props()
</script>

<button class="add-btn" {onclick}>
	<Plus size={16} />
	<span>{label}</span>
</button>

<style>
	.add-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 10px 16px;
		background: var(--builder-bg-primary);
		border: 1px dashed var(--builder-border);
		border-radius: 2px;
		color: var(--builder-text-primary);
		cursor: pointer;
		font-size: 13px;
		transition: all 0.15s;
		width: 100%;
	}

	.add-btn:hover {
		border-color: var(--builder-accent);
		color: var(--builder-accent);
	}
</style>
