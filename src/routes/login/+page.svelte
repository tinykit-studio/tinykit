<script lang="ts">
	import { goto } from "$app/navigation"
	import { onMount } from "svelte"
	import { auth } from "$lib/pocketbase.svelte"
	import { Loader2 } from "lucide-svelte"

	let email = $state("")
	let password = $state("")
	let is_submitting = $state(false)
	let is_checking = $state(true)
	let error = $state<string | null>(null)

	onMount(async () => {
		// Check if setup is needed first
		try {
			const res = await fetch("/api/setup")
			const data = await res.json()

			if (data.needs_setup) {
				goto("/setup")
				return
			}
		} catch (err) {
			// If check fails, continue to login
		}
		is_checking = false
	})

	async function handle_submit(e: Event) {
		e.preventDefault()
		error = null
		is_submitting = true

		try {
			await auth.login(email, password)
			goto("/tinykit")
		} catch (err: any) {
			error = err.message || "Login failed. Please check your credentials."
		} finally {
			is_submitting = false
		}
	}
</script>

<svelte:head>
	<title>Login - tinykit</title>
</svelte:head>

<div class="min-h-screen bg-[var(--builder-bg-primary)] flex items-center justify-center p-4 safe-area-top safe-area-bottom">
	{#if is_checking}
		<div class="flex flex-col items-center gap-3">
			<Loader2 class="w-8 h-8 text-[var(--builder-accent)] animate-spin" />
		</div>
	{:else}
	<div class="w-full max-w-sm">
		<!-- Logo -->
		<div class="text-center mb-8">
			<h1 class="text-2xl font-semibold text-[var(--builder-text-primary)]">tinykit</h1>
			<p class="text-sm text-[var(--builder-text-secondary)] mt-1">Sign in to your account</p>
		</div>

		<!-- Login Form -->
		<form onsubmit={handle_submit} class="space-y-4">
			{#if error}
				<div class="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
					{error}
				</div>
			{/if}

			<div>
				<label for="email" class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-1.5">
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
				<label for="password" class="block text-sm font-medium text-[var(--builder-text-secondary)] mb-1.5">
					Password
				</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					required
					disabled={is_submitting}
					class="w-full px-3 py-2 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] placeholder-[var(--builder-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--builder-accent)] focus:border-transparent disabled:opacity-50"
					placeholder="••••••••"
				/>
			</div>

			<button
				type="submit"
				disabled={is_submitting}
				class="w-full py-2.5 bg-[var(--builder-accent)] text-white rounded-lg hover:bg-[var(--builder-accent-hover)] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
			>
				{#if is_submitting}
					<Loader2 class="w-4 h-4 animate-spin" />
					Signing in...
				{:else}
					Sign in
				{/if}
			</button>
		</form>

	</div>
	{/if}
</div>
