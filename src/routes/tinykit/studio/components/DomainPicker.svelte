<script lang="ts">
	import { Globe, ExternalLink, Loader2, Check, Copy } from "lucide-svelte"
	import * as Dialog from "$lib/components/ui/dialog"
	import { Button } from "$lib/components/ui/button"
	import { pb } from "$lib/pocketbase.svelte"

	type AvailableDomain = {
		hostname: string
		first_seen: string
		last_seen: string
	}

	type DomainPickerProps = {
		open: boolean
		project_id: string
		on_close: () => void
		on_select: (domain: string) => void
		on_deploy: () => Promise<void>
	}

	let { open = $bindable(), project_id, on_close, on_select, on_deploy }: DomainPickerProps = $props()

	let is_deploying = $state(false)
	let deploy_success = $state(false)
	let copied = $state(false)

	let available_domains = $state<AvailableDomain[]>([])
	let is_loading = $state(true)
	let custom_domain = $state("")
	let selected_domain = $state<string | null>(null)
	let error = $state("")

	async function load_available_domains() {
		is_loading = true
		error = ""
		try {
			const res = await fetch("/api/domains", {
				headers: {
					Authorization: `Bearer ${pb.authStore.token}`
				}
			})
			if (res.ok) {
				const data = await res.json()
				available_domains = data.domains || []
			}
		} catch (err) {
			console.error("Failed to load domains:", err)
		} finally {
			is_loading = false
		}
	}

	function handle_select(domain: string) {
		selected_domain = domain
		custom_domain = ""
	}

	function handle_custom_input() {
		selected_domain = null
	}

	function handle_confirm() {
		const domain = selected_domain || custom_domain.trim().toLowerCase()
		if (!domain) {
			error = "Please select or enter a domain"
			return
		}
		on_select(domain)
	}

	function open_domain_in_new_tab() {
		const domain = selected_domain || custom_domain.trim()
		if (domain) {
			window.open(`https://${domain}`, "_blank")
		}
	}

	async function handle_quick_deploy() {
		if (is_deploying) return
		is_deploying = true
		try {
			await on_deploy()
			deploy_success = true
		} catch (err) {
			console.error("Deploy failed:", err)
			error = "Deploy failed. Please try again."
		} finally {
			is_deploying = false
		}
	}

	function get_preview_url() {
		return `${window.location.origin}/tinykit/preview/${project_id}`
	}

	async function copy_url() {
		await navigator.clipboard.writeText(get_preview_url())
		copied = true
		setTimeout(() => copied = false, 2000)
	}

	$effect(() => {
		if (open) {
			load_available_domains()
			selected_domain = null
			custom_domain = ""
			error = ""
			is_deploying = false
			deploy_success = false
			copied = false
		}
	})
</script>

<Dialog.Root bind:open onOpenChange={(isOpen) => !isOpen && on_close()}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Globe class="w-5 h-5" />
				Connect a Domain
			</Dialog.Title>
			<Dialog.Description>
				Choose a domain to publish your app to.
			</Dialog.Description>
		</Dialog.Header>

		<div class="py-4 space-y-4">
			<!-- Preview URL option -->
			{#if deploy_success}
				<!-- Success state -->
				<div class="p-4 rounded-lg border border-green-500/50 bg-green-500/10 space-y-3">
					<div class="flex items-center gap-2 text-green-400">
						<Check class="w-5 h-5" />
						<span class="font-medium">Deployed successfully!</span>
					</div>
					<div class="flex items-center gap-2">
						<input
							type="text"
							readonly
							value={get_preview_url()}
							class="flex-1 px-3 py-2 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-sm text-[var(--builder-text-primary)] select-all"
						/>
						<Button variant="outline" size="sm" onclick={copy_url} class="shrink-0">
							{#if copied}
								<Check class="w-4 h-4" />
							{:else}
								<Copy class="w-4 h-4" />
							{/if}
						</Button>
						<Button variant="outline" size="sm" onclick={() => window.open(get_preview_url(), "_blank")} class="shrink-0">
							<ExternalLink class="w-4 h-4" />
						</Button>
					</div>
				</div>
			{:else if is_deploying}
				<!-- Loading state -->
				<div class="w-full flex items-center justify-center gap-3 p-4 rounded-lg border border-[var(--builder-accent)]/50 bg-[var(--builder-accent)]/10">
					<Loader2 class="w-5 h-5 animate-spin text-[var(--builder-accent)]" />
					<span class="text-sm text-[var(--builder-text-primary)]">Deploying...</span>
				</div>
			{:else}
				<!-- Default button -->
				<button
					type="button"
					onclick={handle_quick_deploy}
					class="w-full flex items-center justify-between p-3 rounded-lg border border-[var(--builder-border)] hover:border-[var(--builder-accent)]/50 bg-[var(--builder-bg-secondary)] transition-colors text-left"
				>
					<div class="flex items-center gap-3">
						<ExternalLink class="w-4 h-4 text-[var(--builder-text-muted)]" />
						<div>
							<span class="text-sm text-[var(--builder-text-primary)]">Deploy without domain</span>
							<p class="text-xs text-[var(--builder-text-muted)]">/tinykit/preview/{project_id}</p>
						</div>
					</div>
					<span class="text-xs text-[var(--builder-accent)]">Quick deploy →</span>
				</button>
			{/if}

			<div class="relative">
				<div class="absolute inset-0 flex items-center">
					<span class="w-full border-t border-[var(--builder-border)]"></span>
				</div>
				<div class="relative flex justify-center text-xs">
					<span class="bg-[var(--builder-bg-primary)] px-2 text-[var(--builder-text-muted)]">or connect a domain</span>
				</div>
			</div>

			{#if is_loading}
				<div class="flex items-center justify-center py-8">
					<Loader2 class="w-6 h-6 animate-spin text-[var(--builder-text-muted)]" />
				</div>
			{:else}
				<!-- Available domains -->
				{#if available_domains.length > 0}
					<div class="space-y-2">
						<span class="text-sm font-medium text-[var(--builder-text-secondary)]">
							Detected domains
						</span>
						<div class="space-y-1">
							{#each available_domains as domain (domain.hostname)}
								<button
									type="button"
									onclick={() => handle_select(domain.hostname)}
									class="w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left {selected_domain === domain.hostname
										? 'border-[var(--builder-accent)] bg-[var(--builder-accent)]/10'
										: 'border-[var(--builder-border)] hover:border-[var(--builder-accent)]/50 bg-[var(--builder-bg-secondary)]'}"
								>
									<Globe class="w-4 h-4 text-[var(--builder-text-muted)]" />
									<span class="text-sm text-[var(--builder-text-primary)]">
										{domain.hostname}
									</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Custom domain input -->
				<div class="space-y-2">
					<label for="custom-domain" class="text-sm font-medium text-[var(--builder-text-secondary)]">
						{available_domains.length > 0 ? "Or enter a domain" : "Enter your domain"}
					</label>
					<input
						id="custom-domain"
						type="text"
						bind:value={custom_domain}
						oninput={handle_custom_input}
						placeholder="mysite.com"
						class="w-full px-3 py-2 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] placeholder-[var(--builder-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--builder-accent)] focus:border-transparent"
					/>
				</div>

				<!-- Instructions -->
				{#if selected_domain || custom_domain.trim()}
					<div class="p-3 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg space-y-2">
						<p class="text-sm text-[var(--builder-text-secondary)]">
							Point this domain to your server using your hosting provider.
						</p>
						<button
							type="button"
							onclick={open_domain_in_new_tab}
							class="flex items-center gap-1.5 text-sm text-[var(--builder-accent)] hover:underline"
						>
							<ExternalLink class="w-3 h-3" />
							Open {selected_domain || custom_domain.trim()}
						</button>
						<p class="text-xs text-[var(--builder-text-muted)]">
							Your project will auto-connect when the domain is connected.
						</p>
					</div>
				{/if}

				{#if error}
					<p class="text-sm text-red-400">{error}</p>
				{/if}
			{/if}
		</div>

		<Dialog.Footer>
			{#if deploy_success}
				<Button onclick={on_close}>
					Done
				</Button>
			{:else}
				<Button variant="ghost" onclick={on_close} disabled={is_deploying}>
					Cancel
				</Button>
				<Button
					onclick={handle_confirm}
					disabled={is_deploying || (!selected_domain && !custom_domain.trim())}
				>
					Connect & Deploy
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
