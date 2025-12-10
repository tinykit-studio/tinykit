<script lang="ts">
	import StepSlider from "./StepSlider.svelte"

	type Props = {
		value: number
		onchange: (value: number) => void
	}

	let { value = $bindable(), onchange }: Props = $props()

	const steps = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96]
</script>

<StepSlider
	bind:value
	{steps}
	{onchange}
/>
