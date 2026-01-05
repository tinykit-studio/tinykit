<script lang="ts">
	import { onMount } from "svelte"
	import Icon from "@iconify/svelte"
	import { pb } from "$lib/pocketbase.svelte"

	let {
		compiled_html = "",
		project_id = "",
		collection_id = "_tk_projects",
		fallback_icon = ""
	}: {
		code?: string
		design?: any[]
		content?: any[]
		data?: Record<string, any>
		compiled_html?: string
		project_id?: string
		collection_id?: string
		fallback_icon?: string
	} = $props()

	let srcdoc = $state("")
	let is_loading = $state(true)

	onMount(() => {
		load_preview()
	})

	async function load_preview() {
		// If we have a published_html file, fetch its contents
		// This is the ONLY safe way to show thumbnails - published HTML is pre-compiled
		if (compiled_html && project_id) {
			try {
				const file_url = pb.files.getURL(
					{ id: project_id, collectionId: collection_id, collectionName: collection_id },
					compiled_html
				)
				const response = await fetch(file_url)
				if (response.ok) {
					srcdoc = await response.text()
					is_loading = false
					return
				}
			} catch (err) {
				console.error("[ProjectThumbnail] Failed to fetch published HTML:", err)
			}
		}

		// Don't compile on-the-fly for thumbnails - it's too risky
		// Complex apps can freeze the entire dashboard with infinite loops
		// Just show a placeholder if no published HTML exists
		is_loading = false
	}
</script>

<div class="thumbnail-container">
	{#if is_loading}
		<div class="placeholder loading">
			<div class="spinner"></div>
		</div>
	{:else if !srcdoc}
		<div class="placeholder ghost">
			{#if fallback_icon}
				<Icon icon={fallback_icon} class="fallback-icon" />
			{:else}
				<div class="ghost-box"></div>
			{/if}
		</div>
	{:else}
		<iframe
			title="Project preview"
			{srcdoc}
			sandbox="allow-scripts allow-same-origin"
			class="thumbnail-iframe"
		></iframe>
	{/if}
</div>

<style>
	.thumbnail-container {
		width: 100%;
		height: 100%;
		position: relative;
		background: var(--builder-bg-tertiary, #1a1a1a);
	}

	.placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.placeholder.loading {
		background: var(--builder-bg-tertiary, #1a1a1a);
	}

	.placeholder.ghost {
		background: var(--builder-bg-tertiary, #1a1a1a);
	}

	.ghost-box {
		width: 60%;
		height: 50%;
		border: 2px dashed var(--builder-border, #333);
		border-radius: 8px;
		opacity: 0.4;
	}

	:global(.fallback-icon) {
		width: 48px;
		height: 48px;
		color: var(--builder-text-muted, #666);
		opacity: 0.6;
	}

	.spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--builder-border, #333);
		border-top-color: var(--builder-accent, #3b82f6);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.thumbnail-iframe {
		width: 200%;
		height: 200%;
		border: none;
		transform: scale(0.5);
		transform-origin: top left;
		pointer-events: none;
	}
</style>
