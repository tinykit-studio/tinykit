<script lang="ts">
	import { onMount } from "svelte"
	import { ArrowLeft, Loader2, Save, Check, Eye, EyeOff } from "lucide-svelte"
	import { get_saved_theme, apply_builder_theme } from "$lib/builder_themes"
	import { pb } from "$lib/pocketbase.svelte"

	interface LLMConfig {
		provider: string
		api_key: string
		model: string
		base_url?: string
	}

	const PROVIDERS = [
		{ id: "gemini", name: "Google Gemini", models: ["gemini-3-pro-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"] },
		{ id: "anthropic", name: "Anthropic", models: ["claude-opus-4-5-20251101", "claude-sonnet-4-5-20250929", "claude-3-5-sonnet-20241022"] },
		{ id: "openai", name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o3-mini"] },
		{ id: "zai", name: "z.ai", models: ["glm-4.6", "glm-4.5", "glm-4.5-flash"] }
	]

	const API_KEY_URLS: Record<string, string> = {
		gemini: "https://aistudio.google.com/apikey",
		anthropic: "https://console.anthropic.com/settings/keys",
		openai: "https://platform.openai.com/api-keys",
		zai: "https://z.ai"
	}

	let config = $state<LLMConfig>({
		provider: "gemini",
		api_key: "",
		model: "gemini-3-pro-preview",
		base_url: ""
	})

	let is_loading = $state(true)
	let is_saving = $state(false)
	let save_success = $state(false)
	let error = $state<string | null>(null)
	let show_api_key = $state(false)

	let available_models = $derived(
		PROVIDERS.find(p => p.id === config.provider)?.models || []
	)

	onMount(async () => {
		const theme = get_saved_theme()
		apply_builder_theme(theme)
		await load_settings()
	})

	async function load_settings() {
		is_loading = true
		error = null
		try {
			const res = await fetch("/api/settings?key=llm", {
				headers: {
					"Authorization": `Bearer ${pb.authStore.token}`
				}
			})
			const data = await res.json()
			if (data.value) {
				config = { ...config, ...data.value }
			}
		} catch (err: any) {
			console.error("Failed to load settings:", err)
		} finally {
			is_loading = false
		}
	}

	async function save_settings() {
		is_saving = true
		error = null
		save_success = false

		try {
			const value = {
				provider: config.provider,
				api_key: config.api_key,
				model: config.model,
				base_url: config.base_url || null
			}

			const res = await fetch("/api/settings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${pb.authStore.token}`
				},
				body: JSON.stringify({ key: "llm", value })
			})

			const data = await res.json()
			if (!res.ok) {
				throw new Error(data.error || "Failed to save settings")
			}

			save_success = true
			setTimeout(() => { save_success = false }, 2000)
		} catch (err: any) {
			console.error("Failed to save settings:", err)
			error = err.message || "Failed to save settings"
		} finally {
			is_saving = false
		}
	}

	function handle_provider_change(e: Event) {
		const target = e.target as HTMLSelectElement
		config.provider = target.value
		// Set default model for this provider
		const provider = PROVIDERS.find(p => p.id === config.provider)
		if (provider && provider.models.length > 0) {
			config.model = provider.models[0]
		}
	}
</script>

<svelte:head>
	<title>Settings - tinykit</title>
</svelte:head>

<div class="min-h-screen bg-[var(--builder-bg-primary)] safe-area-top">
	<!-- Header -->
	<header class="border-b border-[var(--builder-border)] px-6 py-4">
		<div class="max-w-2xl mx-auto flex items-center gap-4">
			<a
				href="/tinykit/dashboard"
				class="p-2 -ml-2 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
			>
				<ArrowLeft class="w-5 h-5" />
			</a>
			<span class="text-xl font-semibold text-[var(--builder-text-primary)]">Settings</span>
		</div>
	</header>

	<!-- Main content -->
	<main class="max-w-2xl mx-auto px-6 py-8">
		{#if is_loading}
			<div class="flex items-center justify-center py-20">
				<Loader2 class="w-8 h-8 animate-spin text-[var(--builder-text-muted)]" />
			</div>
		{:else}
			<div class="space-y-8">
				<!-- LLM Configuration -->
				<section>
					<h2 class="text-lg font-medium text-[var(--builder-text-primary)] mb-4">
						AI Model
					</h2>

					<div class="space-y-4 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg p-6">
						<!-- Provider -->
						<div>
							<label for="provider" class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-2">
								Provider
							</label>
							<select
								id="provider"
								value={config.provider}
								onchange={handle_provider_change}
								class="w-full px-3 py-2 bg-[var(--builder-bg-tertiary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] focus:outline-none focus:border-[var(--builder-accent)]"
							>
								{#each PROVIDERS as provider (provider.id)}
									<option value={provider.id}>{provider.name}</option>
								{/each}
							</select>
						</div>

						<!-- API Key -->
						<div>
							<label for="api_key" class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-2">
								API Key
								{#if API_KEY_URLS[config.provider]}
									<a
										href={API_KEY_URLS[config.provider]}
										target="_blank"
										rel="noopener noreferrer"
										class="ml-2 text-[var(--builder-accent)] hover:underline font-normal"
									>
										Get one
									</a>
								{/if}
							</label>
							<div class="relative">
								<input
									id="api_key"
									type={show_api_key ? "text" : "password"}
									bind:value={config.api_key}
									placeholder="Enter your API key"
									class="w-full px-3 py-2 pr-10 bg-[var(--builder-bg-tertiary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] placeholder:text-[var(--builder-text-muted)] focus:outline-none focus:border-[var(--builder-accent)] font-mono text-sm"
								/>
								<button
									type="button"
									onclick={() => show_api_key = !show_api_key}
									class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--builder-text-muted)] hover:text-[var(--builder-text-primary)]"
								>
									{#if show_api_key}
										<EyeOff class="w-4 h-4" />
									{:else}
										<Eye class="w-4 h-4" />
									{/if}
								</button>
							</div>
						</div>

						<!-- Model -->
						<div>
							<label for="model" class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-2">
								Model
							</label>
							<select
								id="model"
								bind:value={config.model}
								class="w-full px-3 py-2 bg-[var(--builder-bg-tertiary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] focus:outline-none focus:border-[var(--builder-accent)]"
							>
								{#each available_models as model (model)}
									<option value={model}>{model}</option>
								{/each}
							</select>
						</div>

						<!-- Base URL (optional, for z.ai etc.) -->
						{#if config.provider === "zai"}
							<div>
								<label for="base_url" class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-2">
									Base URL <span class="font-normal text-[var(--builder-text-muted)]">(optional)</span>
								</label>
								<input
									id="base_url"
									type="text"
									bind:value={config.base_url}
									placeholder="https://api.z.ai/api/paas/v4"
									class="w-full px-3 py-2 bg-[var(--builder-bg-tertiary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] placeholder:text-[var(--builder-text-muted)] focus:outline-none focus:border-[var(--builder-accent)] font-mono text-sm"
								/>
							</div>
						{/if}
					</div>
				</section>

				<!-- Error message -->
				{#if error}
					<div class="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
						{error}
					</div>
				{/if}

				<!-- Save button -->
				<div class="flex justify-end">
					<button
						onclick={save_settings}
						disabled={is_saving || !config.api_key}
						class="inline-flex items-center gap-2 px-4 py-2 bg-[var(--builder-accent)] text-white rounded-lg hover:bg-[var(--builder-accent-hover)] transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{#if is_saving}
							<Loader2 class="w-4 h-4 animate-spin" />
							Saving...
						{:else if save_success}
							<Check class="w-4 h-4" />
							Saved
						{:else}
							<Save class="w-4 h-4" />
							Save Settings
						{/if}
					</button>
				</div>
			</div>
		{/if}
	</main>
</div>
