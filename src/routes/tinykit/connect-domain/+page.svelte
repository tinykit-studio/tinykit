<script lang="ts">
	import { goto } from "$app/navigation"
	import { onMount } from "svelte"
	import { ArrowLeft, Plus, Link2, Loader2, Globe, FolderOpen, Search, Check } from "lucide-svelte"
	import Icon from "@iconify/svelte"
	import { get_saved_theme, apply_builder_theme } from "$lib/builder_themes"
	import { project_service } from "$lib/services/project.svelte"
	import { kit_service } from "$lib/services/kit.svelte"
	import type { Project, Kit } from "../types"

	let { data } = $props()

	let domain = $derived(data.domain || "")

	// State
	let projects = $state<Project[]>([])
	let kits = $state<Kit[]>([])
	let is_loading = $state(true)
	let is_attaching = $state(false)
	let error_message = $state("")
	let search_query = $state("")
	let selected_project_id = $state<string | null>(null)

	// Keep the search available when no projects match.
	let unassigned_projects = $derived(projects.filter(p => !p.domain));
	let attachable_projects = $derived(
		unassigned_projects
			.filter(p => {
				if (!search_query) return true
				const q = search_query.toLowerCase()
				return (p.name || "").toLowerCase().includes(q)
			})
	)

	// Group projects by kit for display
	let projects_by_kit = $derived.by(() => {
		const grouped: Record<string, Project[]> = {}
		for (const project of attachable_projects) {
			const kit_id = project.kit || "_uncategorized"
			if (!grouped[kit_id]) grouped[kit_id] = []
			grouped[kit_id].push(project)
		}
		return grouped
	})

	function get_kit_name(kit_id: string): string {
		if (kit_id === "_uncategorized") return "Uncategorized"
		const kit = kits.find(k => k.id === kit_id)
		return kit?.name || kit_id
	}

	function get_kit_icon(kit_id: string): string {
		if (kit_id === "_uncategorized") return "lucide:folder"
		const kit = kits.find(k => k.id === kit_id)
		return kit?.icon || "lucide:folder"
	}

	onMount(async () => {
		const theme = get_saved_theme()
		apply_builder_theme(theme)

		try {
			const [loaded_projects, loaded_kits] = await Promise.all([
				project_service.list(),
				kit_service.list()
			])
			projects = loaded_projects
			kits = loaded_kits
		} catch (err) {
			console.error("Failed to load data:", err)
			error_message = "Failed to load projects"
		} finally {
			is_loading = false
		}
	})

	async function attach_to_project() {
		if (!selected_project_id || !domain) return

		is_attaching = true
		error_message = ""

		try {
			await project_service.update(selected_project_id, { domain })
			// Redirect to the studio for this project
			await goto(`/tinykit/studio?id=${selected_project_id}`)
		} catch (err: any) {
			console.error("Failed to attach domain:", err)
			error_message = err?.message || "Failed to attach domain to project"
			is_attaching = false
		}
	}

	function go_to_new_app() {
		// First kit, or new-kit if none exist
		if (kits.length > 0) {
			goto(`/tinykit/new?kit=${kits[0].id}&domain=${encodeURIComponent(domain)}`)
		} else {
			goto(`/tinykit/new-kit?domain=${encodeURIComponent(domain)}`)
		}
	}
</script>

<svelte:head>
	<title>Connect Domain - tinykit</title>
</svelte:head>

<div class="min-h-screen bg-[var(--builder-bg-primary)] flex flex-col safe-area-top">
	<!-- Header -->
	<header class="border-b border-[var(--builder-border)] px-6 py-4">
		<a
			href="/tinykit?dashboard=1"
			class="inline-flex items-center gap-2 text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
		>
			<ArrowLeft class="w-4 h-4" />
			<span class="text-sm">Back to dashboard</span>
		</a>
	</header>

	<!-- Main content -->
	<main class="flex-1 flex flex-col items-center px-6 py-12 max-w-2xl mx-auto w-full">
		<!-- Domain badge -->
		<div class="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--builder-accent)]/10 border border-[var(--builder-accent)]/20 mb-6">
			<Globe class="w-4 h-4 text-[var(--builder-accent)]" />
			<span class="text-sm font-medium text-[var(--builder-accent)]">{domain}</span>
		</div>

		<!-- Title -->
		<h1 class="text-3xl font-semibold text-[var(--builder-text-primary)] text-center mb-2">
			Connect this domain
		</h1>
		<p class="text-[var(--builder-text-muted)] mb-8 text-center">
			This domain doesn't have an app yet. Create a new one or connect an existing app.
		</p>

		<!-- Error message -->
		{#if error_message}
			<div class="w-full mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
				{error_message}
			</div>
		{/if}

		<!-- Create New App button -->
		<button
			onclick={go_to_new_app}
			disabled={is_loading || is_attaching}
			class="w-full flex items-center gap-4 p-5 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg hover:border-[var(--builder-accent)] hover:bg-[var(--builder-bg-tertiary)] transition-all group mb-8"
		>
			<div class="p-3 rounded-lg bg-[var(--builder-accent)]/10 group-hover:bg-[var(--builder-accent)]/20 transition-colors">
				<Plus class="w-6 h-6 text-[var(--builder-accent)]" />
			</div>
			<div class="text-left">
				<div class="font-medium text-[var(--builder-text-primary)]">Create new app</div>
				<div class="text-sm text-[var(--builder-text-muted)]">
					Start fresh with AI or a template
				</div>
			</div>
		</button>

		<!-- Divider -->
		<div class="w-full flex items-center gap-4 mb-6">
			<div class="flex-1 h-px bg-[var(--builder-border)]"></div>
			<span class="text-sm text-[var(--builder-text-muted)]">Or connect existing app</span>
			<div class="flex-1 h-px bg-[var(--builder-border)]"></div>
		</div>

		<!-- Attach existing project section -->
		{#if is_loading}
			<div class="flex items-center justify-center py-12">
				<Loader2 class="w-6 h-6 animate-spin text-[var(--builder-text-muted)]" />
			</div>
		{:else if unassigned_projects.length === 0}
			<div class="w-full flex flex-col items-center py-8 text-center">
				<FolderOpen class="w-12 h-12 text-[var(--builder-text-muted)] mb-3" />
				<p class="text-[var(--builder-text-muted)]">
					No unassigned apps available
				</p>
				<p class="text-sm text-[var(--builder-text-muted)] mt-1">
					{projects.length ? "All your apps are already connected to domains" : "Create a new app to get started"}
				</p>
			</div>
		{:else}
			<!-- Search -->
			<div class="w-full relative mb-4">
				<Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--builder-text-muted)]" />
				<input
					type="text"
					bind:value={search_query}
					placeholder="Search apps..."
					class="w-full pl-10 pr-4 py-2.5 bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] rounded-lg text-[var(--builder-text-primary)] placeholder:text-[var(--builder-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--builder-accent)] focus:border-transparent text-sm"
				/>
			</div>

			{#if attachable_projects.length === 0}
				<p class="text-sm text-[var(--builder-text-muted)]">No apps match your search.</p>
			{/if}

			<!-- Projects list -->
			<div class="w-full space-y-4 max-h-[400px] overflow-y-auto">
				{#each Object.entries(projects_by_kit) as [kit_id, kit_projects] (kit_id)}
					<div>
						<div class="flex items-center gap-2 mb-2 px-1">
							<Icon icon={get_kit_icon(kit_id)} class="w-4 h-4 text-[var(--builder-text-muted)]" />
							<span class="text-xs font-medium text-[var(--builder-text-muted)] uppercase tracking-wide">
								{get_kit_name(kit_id)}
							</span>
						</div>
						<div class="space-y-1">
							{#each kit_projects as project (project.id)}
								<button
									onclick={() => selected_project_id = project.id}
									class="w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left {selected_project_id === project.id
										? 'bg-[var(--builder-accent)]/10 border-[var(--builder-accent)]'
										: 'bg-[var(--builder-bg-secondary)] border-[var(--builder-border)] hover:border-[var(--builder-accent)]/50'}"
								>
									<div class="flex-1 min-w-0">
										<div class="font-medium text-[var(--builder-text-primary)] truncate">
											{project.name || "Untitled"}
										</div>
										<div class="text-xs text-[var(--builder-text-muted)] truncate">
											Updated {new Date(project.updated).toLocaleDateString()}
										</div>
									</div>
									{#if selected_project_id === project.id}
										<div class="p-1 rounded-full bg-[var(--builder-accent)]">
											<Check class="w-3 h-3 text-[var(--builder-accent-text)]" />
										</div>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>

			<!-- Attach button -->
			{#if selected_project_id}
				<button
					onclick={attach_to_project}
					disabled={is_attaching}
					class="w-full mt-6 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[var(--builder-accent)] text-[var(--builder-accent-text)] hover:bg-[var(--builder-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
				>
					{#if is_attaching}
						<Loader2 class="w-4 h-4 animate-spin" />
						Connecting...
					{:else}
						<Link2 class="w-4 h-4" />
						Connect to {domain}
					{/if}
				</button>
			{/if}
		{/if}
	</main>
</div>
