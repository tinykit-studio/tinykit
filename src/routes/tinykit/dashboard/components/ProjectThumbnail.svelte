<script lang="ts">
	import { onMount } from "svelte"
	import { processCode, dynamic_iframe_srcdoc } from "$lib/compiler/init"
	import { pb } from "$lib/pocketbase.svelte"
	import type { DesignField, ContentField } from "../../types"

	let {
		code = "",
		design = [],
		content = [],
		data = {},
		compiled_html = "",
		project_id = "",
		collection_id = "_tk_projects"
	}: {
		code: string
		design: DesignField[]
		content?: ContentField[]
		data?: Record<string, any>
		compiled_html?: string
		project_id?: string
		collection_id?: string
	} = $props()

	let srcdoc = $state("")
	let is_loading = $state(true)
	let has_error = $state(false)
	let iframe_el = $state<HTMLIFrameElement | null>(null)
	let pending_code: string | null = null

	function handle_message(e: MessageEvent) {
		if (e.source !== iframe_el?.contentWindow) return
		const { event } = e.data || {}
		if (event === "INITIALIZED" && pending_code) {
			iframe_el?.contentWindow?.postMessage({
				event: "SET_APP",
				payload: { componentApp: pending_code, data: {} }
			}, "*")
			pending_code = null
		}
	}

	onMount(() => {
		window.addEventListener("message", handle_message)
		load_preview()

		return () => {
			window.removeEventListener("message", handle_message)
		}
	})

	async function load_preview() {
		// If we have a published_html file, fetch its contents
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

		// Otherwise compile on-the-fly with full data support
		if (!code) {
			is_loading = false
			return
		}

		try {
			const result = await processCode({
				component: code,
				buildStatic: false,
				runtime: ["mount", "unmount"]
			})

			if (result.error || !result.js) {
				has_error = true
				is_loading = false
				return
			}

			// Extract collection names from data object
			const data_collections = Object.keys(data || {})

			// Store compiled code to send when iframe is ready
			pending_code = result.js

			// Build srcdoc with full data module support
			srcdoc = dynamic_iframe_srcdoc("", {
				content: content || [],
				design: design || [],
				project_id: project_id || "",
				data_collections
			})
		} catch (err) {
			console.error("[ProjectThumbnail] Compile error:", err)
			has_error = true
		} finally {
			is_loading = false
		}
	}
</script>

<div class="thumbnail-container">
	{#if is_loading}
		<div class="placeholder loading">
			<div class="spinner"></div>
		</div>
	{:else if has_error || !srcdoc}
		<div class="placeholder ghost">
			<div class="ghost-box"></div>
		</div>
	{:else}
		<iframe
			bind:this={iframe_el}
			title="Project preview"
			{srcdoc}
			sandbox="allow-scripts"
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
