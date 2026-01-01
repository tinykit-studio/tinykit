<script lang="ts">
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import { Loader2, Eye, EyeOff, CircleCheck, CircleX, TestTube } from "lucide-svelte";
	import { auth } from "$lib/pocketbase.svelte";

	const PROVIDERS = [
		{ id: "gemini", name: "Google Gemini", models: [
			{ id: "gemini-3-pro-preview", label: "gemini-3-pro-preview — best" }
		]},
		{ id: "anthropic", name: "Anthropic", models: [
			{ id: "claude-opus-4-5-20251101", label: "claude-opus-4.5 — best" },
			{ id: "claude-haiku-4-5-20251001", label: "claude-haiku-4.5 — fast" }
		]},
		{ id: "openai", name: "OpenAI", models: [
			{ id: "gpt-5.2-2025-12-11", label: "gpt-5.2-2025-12-11 — best" }
		]}
	]

	const API_KEY_URLS: Record<string, string> = {
		gemini: "https://aistudio.google.com/apikey",
		anthropic: "https://console.anthropic.com/settings/keys",
		openai: "https://platform.openai.com/api-keys"
	}

	let email = $state("");
	let password = $state("");
	let confirm_password = $state("");
	let llm_provider = $state("gemini");
	let llm_api_key = $state("");
	let llm_model = $state("gemini-3-pro-preview");
	let show_api_key = $state(false);
	let is_submitting = $state(false);
	let is_checking = $state(true);
	let error = $state<string | null>(null);
	let validation_status = $state<'idle' | 'testing' | 'valid' | 'invalid'>('idle');
	let validation_error = $state<string | null>(null);

	let available_models = $derived(
		PROVIDERS.find(p => p.id === llm_provider)?.models || []
	);

	function handle_provider_change(e: Event) {
		const target = e.target as HTMLSelectElement;
		llm_provider = target.value;
		const provider = PROVIDERS.find(p => p.id === llm_provider);
		if (provider && provider.models.length > 0) {
			llm_model = provider.models[0].id;
		}
		// Reset validation when provider changes
		validation_status = 'idle';
		validation_error = null;
	}

	async function test_api_key() {
		if (!llm_api_key) return;

		validation_status = 'testing';
		validation_error = null;

		try {
			const res = await fetch("/api/settings/validate-llm", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					provider: llm_provider,
					api_key: llm_api_key
				})
			});

			const data = await res.json();

			if (data.valid) {
				validation_status = 'valid';
			} else {
				validation_status = 'invalid';
				validation_error = data.error || 'Invalid API key';
			}
		} catch (err: any) {
			validation_status = 'invalid';
			validation_error = err.message || 'Validation failed';
		}
	}

	function handle_api_key_change() {
		validation_status = 'idle';
		validation_error = null;
	}

	onMount(async () => {
		// Check if setup is needed
		try {
			const res = await fetch("/api/setup");
			const data = await res.json();

			if (!data.needs_setup) {
				// Setup already done, redirect to login
				goto("/login");
				return;
			}
		} catch (err) {
			// If check fails, show setup anyway
		}
		is_checking = false;
	});

	async function handle_submit(e: Event) {
		e.preventDefault();
		error = null;

		if (password !== confirm_password) {
			error = "Passwords do not match";
			return;
		}

		if (password.length < 8) {
			error = "Password must be at least 8 characters";
			return;
		}

		is_submitting = true;

		try {
			const res = await fetch("/api/setup", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email,
					password,
					llm: llm_api_key ? {
						provider: llm_provider,
						api_key: llm_api_key,
						model: llm_model
					} : null
				}),
			});

			const data = await res.json();

			if (!res.ok) {
				throw new Error(data.error || "Setup failed");
			}

			// Setup complete, auto-login with the same credentials
			await auth.login(email, password);
			goto("/tinykit/dashboard");
		} catch (err: any) {
			error = err.message || "Setup failed. Please try again.";
		} finally {
			is_submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Setup - tinykit</title>
</svelte:head>

<div
	class="min-h-screen bg-[var(--builder-bg-primary)] flex items-center justify-center p-4"
>
	{#if is_checking}
		<div class="flex flex-col items-center gap-3">
			<Loader2
				class="w-8 h-8 text-[var(--builder-accent)] animate-spin"
			/>
			<p class="text-sm text-[var(--builder-text-secondary)]">
				Checking setup status...
			</p>
		</div>
	{:else}
		<div class="w-full max-w-sm">
			<!-- Welcome -->
			<div class="text-center mb-8">
				<h1
					class="text-2xl font-semibold text-[var(--builder-text-primary)]"
				>
					Welcome to tinykit
				</h1>
				<p class="text-sm text-[var(--builder-text-secondary)] mt-2">
					Create your admin account to get started
				</p>
			</div>

			<!-- Setup Form -->
			<form onsubmit={handle_submit} class="space-y-4">
				{#if error}
					<div
						class="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm"
					>
						{error}
					</div>
				{/if}

				<div>
					<label
						for="email"
						class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-1.5"
					>
						Email
					</label>
					<input
						id="email"
						type="email"
						bind:value={email}
						required
						disabled={is_submitting}
						class="w-full px-3 py-2 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] placeholder-[var(--builder-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--builder-accent)] focus:border-transparent disabled:opacity-50"
						placeholder="you@example.com"
					/>
				</div>

				<div>
					<label
						for="password"
						class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-1.5"
					>
						Password
					</label>
					<input
						id="password"
						type="password"
						bind:value={password}
						required
						minlength={8}
						disabled={is_submitting}
						class="w-full px-3 py-2 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] placeholder-[var(--builder-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--builder-accent)] focus:border-transparent disabled:opacity-50"
						placeholder="••••••••"
					/>
					<p class="text-xs text-[var(--builder-text-muted)] mt-1">
						Minimum 8 characters
					</p>
				</div>

				<div>
					<label
						for="confirm_password"
						class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-1.5"
					>
						Confirm Password
					</label>
					<input
						id="confirm_password"
						type="password"
						bind:value={confirm_password}
						required
						minlength={8}
						disabled={is_submitting}
						class="w-full px-3 py-2 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] placeholder-[var(--builder-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--builder-accent)] focus:border-transparent disabled:opacity-50"
						placeholder="••••••••"
					/>
				</div>

				<!-- LLM Configuration -->
				<div class="pt-4 mt-4 border-t border-[var(--builder-border)]">
					<h3 class="text-sm font-medium text-[var(--builder-text-primary)] mb-1">
						AI Model <span class="font-normal text-[var(--builder-text-muted)]">(optional)</span>
					</h3>
					<p class="text-xs text-[var(--builder-text-muted)] mb-3">
						Skip this to use templates only. AI lets you build apps from a prompt.
					</p>

					<div class="space-y-3">
						<div>
							<label
								for="llm_provider"
								class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-1.5"
							>
								Provider
							</label>
							<select
								id="llm_provider"
								value={llm_provider}
								onchange={handle_provider_change}
								disabled={is_submitting}
								class="w-full px-3 py-2 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--builder-accent)] focus:border-transparent disabled:opacity-50"
							>
								{#each PROVIDERS as provider (provider.id)}
									<option value={provider.id}>{provider.name}</option>
								{/each}
							</select>
						</div>

						<div>
							<label
								for="llm_api_key"
								class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-1.5"
							>
								API Key
								{#if API_KEY_URLS[llm_provider]}
									<a
										href={API_KEY_URLS[llm_provider]}
										target="_blank"
										rel="noopener noreferrer"
										class="ml-1 text-[var(--builder-accent)] hover:underline font-normal"
									>
										Get one
									</a>
								{/if}
							</label>
							<div class="flex gap-2">
								<div class="relative flex-1">
									<input
										id="llm_api_key"
										type={show_api_key ? "text" : "password"}
										bind:value={llm_api_key}
										oninput={handle_api_key_change}
										disabled={is_submitting}
										class="w-full px-3 py-2 pr-10 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] placeholder-[var(--builder-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--builder-accent)] focus:border-transparent disabled:opacity-50 font-mono text-sm"
										placeholder="Enter your API key"
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
								<button
									type="button"
									onclick={test_api_key}
									disabled={!llm_api_key || validation_status === 'testing' || is_submitting}
									class="px-3 py-2 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] hover:border-[var(--builder-accent)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 text-sm"
								>
									{#if validation_status === 'testing'}
										<Loader2 class="w-4 h-4 animate-spin" />
									{:else if validation_status === 'valid'}
										<CircleCheck class="w-4 h-4 text-green-500" />
									{:else if validation_status === 'invalid'}
										<CircleX class="w-4 h-4 text-red-500" />
									{:else}
										<TestTube class="w-4 h-4" />
									{/if}
									Test
								</button>
							</div>
							{#if validation_status === 'valid'}
								<p class="text-xs text-green-500 mt-1">API key is valid</p>
							{:else if validation_status === 'invalid' && validation_error}
								<p class="text-xs text-red-400 mt-1">{validation_error}</p>
							{/if}
						</div>

						<div>
							<label
								for="llm_model"
								class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-1.5"
							>
								Model
							</label>
							<select
								id="llm_model"
								bind:value={llm_model}
								disabled={is_submitting}
								class="w-full px-3 py-2 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--builder-accent)] focus:border-transparent disabled:opacity-50"
							>
								{#each available_models as model (model.id)}
									<option value={model.id}>{model.label}</option>
								{/each}
							</select>
						</div>
					</div>

					<p class="text-xs text-[var(--builder-text-muted)] mt-2">
						You can configure this anytime in Settings.
					</p>
				</div>

				<button
					type="submit"
					disabled={is_submitting}
					class="w-full py-2.5 bg-[var(--builder-accent)] text-white rounded-lg hover:bg-[var(--builder-accent-hover)] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-6"
				>
					{#if is_submitting}
						<Loader2 class="w-4 h-4 animate-spin" />
						Setting up...
					{:else}
						Complete Setup
					{/if}
				</button>
			</form>

			<p
				class="mt-6 text-center text-xs text-[var(--builder-text-muted)]"
			>
				This will create your admin account and configure the server.
			</p>
		</div>
	{/if}
</div>
