<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import {
		ArrowLeft,
		Loader2,
		Save,
		Check,
		Eye,
		EyeOff,
		CircleCheck,
		CircleX,
		TestTube,
	} from "lucide-svelte";
	import { get_saved_theme, apply_builder_theme } from "$lib/builder_themes";
	import { pb } from "$lib/pocketbase.svelte";

	// Handle server auth expiry - redirect to login
	function handle_api_error(data: any, status: number): boolean {
		if (status === 503 && data.error === "server_auth_expired") {
			goto("/login")
			return true
		}
		return false
	}

	interface LLMConfig {
		provider: string;
		api_key: string;
		model: string;
		base_url?: string;
		has_api_key?: boolean;
	}

	const PROVIDERS = [
		{
			id: "anthropic",
			name: "Anthropic",
			models: [
				{
					id: "claude-opus-4-5-20251101",
					label: "claude-opus-4.5 — best",
				},
				{
					id: "claude-haiku-4-5-20251001",
					label: "claude-haiku-4.5 — fast",
				},
			],
		},
		{
			id: "openai",
			name: "OpenAI",
			models: [
				{ id: "gpt-5.2-2025-12-11", label: "gpt-5.2-2025-12-11 — best" },
			],
		},
		{
			id: "gemini",
			name: "Google Gemini",
			models: [
				{
					id: "gemini-3-pro-preview",
					label: "gemini-3-pro-preview — best"
				},
				{
					id: "gemini-3-flash-preview",
					label: "gemini-3-flash-preview — fast"
				}
			]
		},
	];

	const API_KEY_URLS: Record<string, string> = {
		gemini: "https://aistudio.google.com/apikey",
		anthropic: "https://console.anthropic.com/settings/keys",
		openai: "https://platform.openai.com/api-keys",
		deepseek: "https://platform.deepseek.com/api_keys",
	};

	let config = $state<LLMConfig>({
		provider: "gemini",
		api_key: "",
		model: "gemini-3-pro-preview",
		base_url: "",
	});

	let is_loading = $state(true);
	let is_saving = $state(false);
	let save_success = $state(false);
	let error = $state<string | null>(null);
	let show_api_key = $state(false);
	let validation_status = $state<"idle" | "testing" | "valid" | "invalid">(
		"idle",
	);
	let validation_error = $state<string | null>(null);
	let api_key_modified = $state(false);
	let masked_api_key = $state("");

	let available_models = $derived(
		PROVIDERS.find((p) => p.id === config.provider)?.models || [],
	);

	onMount(async () => {
		const theme = get_saved_theme();
		apply_builder_theme(theme);
		await load_settings();
	});

	async function load_settings() {
		is_loading = true;
		error = null;
		try {
			const res = await fetch("/api/settings?key=llm", {
				headers: {
					Authorization: `Bearer ${pb.authStore.token}`,
				},
			});
			const data = await res.json();
			if (handle_api_error(data, res.status)) return;
			if (data.value) {
				// Store masked key separately, clear the input field
				masked_api_key = data.value.api_key || "";
				config = {
					...config,
					...data.value,
					api_key: "", // Don't populate input with masked value
				};
				api_key_modified = false;
			}
		} catch (err: any) {
			console.error("Failed to load settings:", err);
		} finally {
			is_loading = false;
		}
	}

	async function save_settings() {
		is_saving = true;
		error = null;
		save_success = false;

		try {
			const value: Record<string, any> = {
				provider: config.provider,
				model: config.model,
				base_url: config.base_url || null,
			};

			// Only include api_key if user entered a new one
			if (api_key_modified && config.api_key) {
				value.api_key = config.api_key;
			}

			const res = await fetch("/api/settings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${pb.authStore.token}`,
				},
				body: JSON.stringify({ key: "llm", value }),
			});

			const data = await res.json();
			if (handle_api_error(data, res.status)) return;
			if (!res.ok) {
				throw new Error(data.error || "Failed to save settings");
			}

			// If we saved a new key, update the masked display
			if (api_key_modified && config.api_key) {
				masked_api_key = "•".repeat(Math.min(config.api_key.length - 4, 20)) + config.api_key.slice(-4);
				config.api_key = "";
				config.has_api_key = true;
				api_key_modified = false;
			}

			save_success = true;
			setTimeout(() => {
				save_success = false;
			}, 2000);
		} catch (err: any) {
			console.error("Failed to save settings:", err);
			error = err.message || "Failed to save settings";
		} finally {
			is_saving = false;
		}
	}

	function handle_provider_change(e: Event) {
		const target = e.target as HTMLSelectElement;
		config.provider = target.value;
		// Set default model for this provider
		const provider = PROVIDERS.find((p) => p.id === config.provider);
		if (provider && provider.models.length > 0) {
			config.model = provider.models[0].id;
		}
		// Reset validation when provider changes
		validation_status = "idle";
		validation_error = null;
	}

	async function test_api_key() {
		if (!config.api_key) return;

		validation_status = "testing";
		validation_error = null;

		try {
			const res = await fetch("/api/settings/validate-llm", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${pb.authStore.token}`,
				},
				body: JSON.stringify({
					provider: config.provider,
					api_key: config.api_key,
					base_url: config.base_url || undefined,
				}),
			});

			const data = await res.json();

			if (data.valid) {
				validation_status = "valid";
			} else {
				validation_status = "invalid";
				validation_error = data.error || "Invalid API key";
			}
		} catch (err: any) {
			validation_status = "invalid";
			validation_error = err.message || "Validation failed";
		}
	}

	function handle_api_key_change() {
		// Mark as modified and reset validation when key changes
		api_key_modified = true;
		validation_status = "idle";
		validation_error = null;
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
				href="/tinykit"
				class="p-2 -ml-2 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
			>
				<ArrowLeft class="w-5 h-5" />
			</a>
			<span
				class="text-xl font-semibold text-[var(--builder-text-primary)]"
				>Settings</span
			>
		</div>
	</header>

	<!-- Main content -->
	<main class="max-w-2xl mx-auto px-6 py-8">
		{#if is_loading}
			<div class="flex items-center justify-center py-20">
				<Loader2
					class="w-8 h-8 animate-spin text-[var(--builder-text-muted)]"
				/>
			</div>
		{:else}
			<div class="space-y-8">
				<!-- LLM Configuration -->
				<section>
					<h2
						class="text-lg font-medium text-[var(--builder-text-primary)] mb-4"
					>
						AI Model
					</h2>

					<div
						class="space-y-4 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg p-6"
					>
						<!-- Provider -->
						<div>
							<label
								for="provider"
								class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-2"
							>
								Provider
							</label>
							<select
								id="provider"
								value={config.provider}
								onchange={handle_provider_change}
								class="w-full px-3 py-2 bg-[var(--builder-bg-tertiary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] focus:outline-none focus:border-[var(--builder-accent)]"
							>
								{#each PROVIDERS as provider (provider.id)}
									<option value={provider.id}
										>{provider.name}</option
									>
								{/each}
							</select>
						</div>

						<!-- API Key -->
						<div>
							<label
								for="api_key"
								class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-2"
							>
								API Key
								{#if config.has_api_key && !api_key_modified}
									<span class="ml-2 text-green-500 font-normal">
										✓ Configured
									</span>
								{/if}
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
							<div class="flex gap-2">
								<div class="relative flex-1">
									<input
										id="api_key"
										type={show_api_key
											? "text"
											: "password"}
										bind:value={config.api_key}
										oninput={handle_api_key_change}
										placeholder={config.has_api_key && !api_key_modified
											? masked_api_key || "Enter new key to replace"
											: "Enter your API key"}
										class="w-full px-3 py-2 pr-10 bg-[var(--builder-bg-tertiary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] placeholder:text-[var(--builder-text-muted)] focus:outline-none focus:border-[var(--builder-accent)] font-mono text-sm"
									/>
									<button
										type="button"
										onclick={() =>
											(show_api_key = !show_api_key)}
										class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--builder-text-muted)] hover:text-[var(--builder-text-primary)]"
									>
										{#if show_api_key}
											<EyeOff class="w-4 h-4" />
										{:else}
											<Eye class="w-4 h-4" />
										{/if}
									</button>
								</div>
								<button
									type="button"
									onclick={test_api_key}
									disabled={!config.api_key ||
										validation_status === "testing"}
									class="px-3 py-2 bg-[var(--builder-bg-tertiary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] hover:border-[var(--builder-accent)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 text-sm"
								>
									{#if validation_status === "testing"}
										<Loader2 class="w-4 h-4 animate-spin" />
									{:else if validation_status === "valid"}
										<CircleCheck
											class="w-4 h-4 text-green-500"
										/>
									{:else if validation_status === "invalid"}
										<CircleX class="w-4 h-4 text-red-500" />
									{:else}
										<TestTube class="w-4 h-4" />
									{/if}
									Test
								</button>
							</div>
							{#if validation_status === "valid"}
								<p class="text-xs text-green-500 mt-1.5">
									API key is valid
								</p>
							{:else if validation_status === "invalid" && validation_error}
								<p class="text-xs text-red-400 mt-1.5">
									{validation_error}
								</p>
							{:else if config.has_api_key && !api_key_modified}
								<p class="text-xs text-[var(--builder-text-muted)] mt-1.5">
									Enter a new key to replace the existing one
								</p>
							{/if}
						</div>

						<!-- Model -->
						<div>
							<label
								for="model"
								class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-2"
							>
								Model
							</label>
							<select
								id="model"
								bind:value={config.model}
								class="w-full px-3 py-2 bg-[var(--builder-bg-tertiary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] focus:outline-none focus:border-[var(--builder-accent)]"
							>
								{#each available_models as model (model.id)}
									<option value={model.id}
										>{model.label}</option
									>
								{/each}
							</select>
						</div>
					</div>
				</section>

				<!-- Error message -->
				{#if error}
					<div
						class="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm"
					>
						{error}
					</div>
				{/if}

				<!-- Info message when no API key -->
				{#if !config.has_api_key && !config.api_key}
					<div
						class="px-4 py-3 bg-[var(--builder-bg-tertiary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-secondary)] text-sm"
					>
						AI features require an API key. You can still use
						templates and manual code editing without one.
					</div>
				{/if}

				<!-- Save button -->
				<div class="flex justify-end">
					<button
						onclick={save_settings}
						disabled={is_saving}
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
