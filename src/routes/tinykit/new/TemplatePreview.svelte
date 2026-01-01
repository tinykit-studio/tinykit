<script lang="ts">
	import { onMount } from "svelte"
	import Icon from "@iconify/svelte"
	import { processCode, dynamic_iframe_srcdoc } from "$lib/compiler/init"
	import type { Template } from "$lib/templates"

	let { template }: { template: Template } = $props()

	let preview_iframe = $state<HTMLIFrameElement | null>(null)
	let iframe_loaded = $state(false)
	let compiled_app = $state<string | null>(null)
	let compile_error = $state<string | null>(null)
	let is_compiling = $state(false)

	function post_to_iframe(message: any) {
		if (!preview_iframe?.contentWindow) return
		preview_iframe.contentWindow.postMessage(message, "*")
	}

	async function compile_and_render() {
		if (!template?.frontend_code) return

		is_compiling = true
		compile_error = null

		try {
			const result = await processCode({
				component: template.frontend_code,
				buildStatic: false,
				dev_mode: false,
				sourcemap: false,
				runtime: ["mount", "unmount"]
			})

			if (result.error) {
				compile_error = result.error
				compiled_app = null
			} else {
				compiled_app = result.js
				compile_error = null
				if (iframe_loaded) {
					send_to_iframe()
				}
			}
		} catch (err) {
			compile_error = err instanceof Error ? err.message : String(err)
			compiled_app = null
		} finally {
			is_compiling = false
		}
	}

	function send_to_iframe() {
		if (!compiled_app) return

		// Clone data to ensure it's postMessage-safe
		const safe_data = template.data ? JSON.parse(JSON.stringify(template.data)) : {}

		// Mount the app with template data
		post_to_iframe({
			event: "SET_APP",
			payload: {
				componentApp: compiled_app,
				data: safe_data
			}
		})
	}

	function handle_message(event: MessageEvent) {
		if (event.source !== preview_iframe?.contentWindow) return
		const { event: evt } = event.data || {}
		if (evt === "INITIALIZED") {
			// Iframe runtime is ready to receive messages
			iframe_loaded = true
			if (compiled_app) {
				send_to_iframe()
			}
		} else if (evt === "RUNTIME_ERROR") {
			compile_error = event.data.payload?.message || "Runtime error"
		}
	}

	onMount(() => {
		window.addEventListener("message", handle_message)
		compile_and_render()
		return () => window.removeEventListener("message", handle_message)
	})

	// Re-compile when template changes
	$effect(() => {
		if (template?.id) {
			iframe_loaded = false
			compiled_app = null
			compile_error = null
			compile_and_render()
		}
	})

	let iframe_srcdoc = $derived(dynamic_iframe_srcdoc("", {
		content: template.content || [],
		design: template.design || [],
		project_id: "template-preview",
		data_collections: template.data ? Object.keys(template.data) : []
	}))
</script>

{#if compile_error}
	<div class="fallback-container">
		<Icon icon={template.preview || "lucide:file"} class="fallback-icon" />
		<span class="template-name">{template.name}</span>
	</div>
{:else if is_compiling}
	<div class="loading-container">
		<div class="loading-spinner"></div>
	</div>
{:else}
	<iframe
		bind:this={preview_iframe}
		srcdoc={iframe_srcdoc}
		sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
		title="Preview of {template.name}"
		class="preview-iframe"
	></iframe>
{/if}

<style>
	.preview-iframe {
		width: 100%;
		height: 100%;
		border: none;
		background: white;
	}

	.fallback-container,
	.loading-container {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: var(--builder-bg-tertiary, #1a1a1a);
		color: var(--builder-text-muted, #888);
		gap: 1rem;
	}

	:global(.fallback-icon) {
		width: 64px;
		height: 64px;
		opacity: 0.5;
	}

	.template-name {
		font-size: 0.875rem;
		opacity: 0.7;
	}

	.loading-spinner {
		width: 32px;
		height: 32px;
		border: 3px solid #333;
		border-top-color: #888;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
