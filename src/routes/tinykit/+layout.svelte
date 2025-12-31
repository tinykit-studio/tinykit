<script lang="ts">
	import { goto } from "$app/navigation"
	import { auth } from "$lib/pocketbase.svelte"
	import { Loader2 } from "lucide-svelte"

	let { children } = $props()

	// Redirect to login if not authenticated
	$effect(() => {
		if (!auth.is_loading && !auth.is_authenticated) {
			goto("/login")
		}
	})
</script>

{#if auth.is_loading}
	<div class="min-h-screen bg-[var(--builder-bg-primary)] flex items-center justify-center">
		<div class="flex flex-col items-center gap-3">
			<Loader2 class="w-8 h-8 text-[var(--builder-accent)] animate-spin" />
			<p class="text-sm text-[var(--builder-text-secondary)]">Loading...</p>
		</div>
	</div>
{:else if auth.is_authenticated}
	{@render children()}
{:else}
	<div class="min-h-screen bg-[var(--builder-bg-primary)] flex items-center justify-center">
		<Loader2 class="w-8 h-8 text-[var(--builder-accent)] animate-spin" />
	</div>
{/if}
