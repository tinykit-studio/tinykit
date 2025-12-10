<script lang="ts">
	import StepSlider from "./StepSlider.svelte"

	type Props = {
		value: number
		onchange: (value: number) => void
	}

	let { value = $bindable(), onchange }: Props = $props()

	const steps = [0, 2, 4, 6, 8, 12, 16, 24, 32, 9999]

	function format_label(step: number): string {
		return step === 9999 ? "∞" : String(step)
	}

	function format_display(val: number): string {
		return val === 9999 ? "Full" : `${val}px`
	}
</script>

<StepSlider
	bind:value
	{steps}
	{onchange}
	{format_label}
	{format_display}
>
	{#snippet preview(val)}
		<span
			class="sample"
			style:border-radius={val === 9999 ? "50%" : `${val}px`}
		></span>
		<span class="label">{format_display(val)}</span>
	{/snippet}
</StepSlider>

<style>
	.sample {
		width: 40px;
		height: 40px;
		background: var(--builder-accent);
		transition: border-radius 0.15s;
	}

	.label {
		font-size: 11px;
		font-family: ui-monospace, monospace;
		color: var(--builder-text-secondary);
	}
</style>
