<script lang="ts">
	import Icon from "@iconify/svelte"
	import { onMount } from "svelte"

	const streams = [
		{ id: "jfKfPfyJRdk", name: "Lo-fi Girl" },
		{ id: "5yx6BWlEVcY", name: "Chillhop" },
		{ id: "3TX_W_CMwT8", name: "Daybreak" }
	]

	let is_muted = $state(true)
	let current_index = $state(0)

	let current_stream = $derived(streams[current_index])

	onMount(() => {
		const stored_mute = localStorage.getItem("tinykit-studio-mute")
		if (stored_mute !== null) {
			is_muted = stored_mute === "true"
		}
		const stored_stream = localStorage.getItem("tinykit-lofi-stream")
		if (stored_stream !== null) {
			const idx = parseInt(stored_stream)
			if (!isNaN(idx) && idx >= 0 && idx < streams.length) {
				current_index = idx
			}
		}
	})

	function toggle_mute() {
		is_muted = !is_muted
		localStorage.setItem("tinykit-studio-mute", String(is_muted))
	}

	function next_stream() {
		current_index = (current_index + 1) % streams.length
		localStorage.setItem("tinykit-lofi-stream", String(current_index))
	}
</script>

<div class="flex flex-col items-center justify-center space-y-4 max-w-3xl mx-auto px-8">
	<div
		class="border-2 border-[var(--builder-border)] rounded-lg overflow-hidden bg-black"
		style="width: 600px; height: 340px;"
	>
		{#key current_stream.id}
			<iframe
				width="600"
				height="340"
				src="https://www.youtube-nocookie.com/embed/{current_stream.id}?autoplay=1&mute={is_muted ? '1' : '0'}&loop=1&playlist={current_stream.id}"
				title={current_stream.name}
				frameborder="0"
				allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
				allowfullscreen
			></iframe>
		{/key}
	</div>

	<div class="flex items-center space-x-3">
		<button
			onclick={toggle_mute}
			class="flex items-center justify-center w-10 h-10 border border-[var(--builder-border)] text-[var(--builder-text-secondary)] hover:border-[var(--builder-accent)] hover:text-[var(--builder-accent)] transition-colors rounded-full"
			title={is_muted ? "Unmute" : "Mute"}
		>
			<Icon
				icon={is_muted ? "heroicons:speaker-x-mark-20-solid" : "heroicons:speaker-wave-20-solid"}
				class="w-5 h-5"
			/>
		</button>
		<button
			onclick={next_stream}
			class="flex items-center gap-2 px-4 py-2 border border-[var(--builder-border)] text-[var(--builder-text-secondary)] hover:border-[var(--builder-accent)] hover:text-[var(--builder-accent)] transition-colors rounded-full text-sm"
		>
			Next
			<Icon icon="heroicons:arrow-right-20-solid" class="w-4 h-4" />
		</button>
	</div>
</div>
