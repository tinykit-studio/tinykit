<script lang="ts">
	import { AlertTriangle, Loader2, Trash2 } from "lucide-svelte"
	import Icon from "@iconify/svelte"
	import * as Dialog from "$lib/components/ui/dialog"
	import { Button } from "$lib/components/ui/button"
	import { kit_service } from "$lib/services/kit.svelte"
	import { project_service } from "$lib/services/project.svelte"
	import type { Kit, Project } from "../../types"

	let {
		kit,
		projects,
		open = $bindable(false),
		on_deleted
	}: {
		kit: Kit
		projects: Project[]
		open: boolean
		on_deleted: () => void
	} = $props()

	let is_deleting = $state(false)
	let error = $state<string | null>(null)

	let projects_in_kit = $derived(projects.filter((p) => p.kit === kit.id))
	let project_count = $derived(projects_in_kit.length)

	async function handle_delete() {
		is_deleting = true
		error = null

		try {
			// Delete all projects in the kit first
			for (const project of projects_in_kit) {
				await project_service.delete(project.id)
			}

			// Then delete the kit itself
			await kit_service.delete(kit.id)

			open = false
			on_deleted()
		} catch (e: any) {
			console.error("Failed to delete kit:", e)
			error = e?.message || "Failed to delete kit"
		} finally {
			is_deleting = false
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[425px]">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-red-500">
				<AlertTriangle class="w-5 h-5" />
				Delete Kit
			</Dialog.Title>
			<Dialog.Description>
				This action cannot be undone.
			</Dialog.Description>
		</Dialog.Header>

		<div class="py-4">
			<!-- Kit being deleted -->
			<div class="flex items-center gap-3 p-3 rounded-lg bg-[var(--builder-bg-secondary)] border border-[var(--builder-border)] mb-4">
				<div class="w-10 h-10 rounded-lg bg-[var(--builder-bg-tertiary)] flex items-center justify-center">
					<Icon icon={kit.icon} class="w-5 h-5 text-[var(--builder-text-primary)]" />
				</div>
				<div>
					<p class="font-medium text-[var(--builder-text-primary)]">{kit.name}</p>
					<p class="text-sm text-[var(--builder-text-muted)]">
						{project_count} {project_count === 1 ? "project" : "projects"}
					</p>
				</div>
			</div>

			<!-- Warning message -->
			{#if project_count > 0}
				<div class="flex gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
					<Trash2 class="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
					<div class="text-sm">
						<p class="font-medium text-red-500">
							{project_count} {project_count === 1 ? "project" : "projects"} will be permanently deleted
						</p>
						<p class="text-[var(--builder-text-muted)] mt-1">
							All project data, code, and content will be lost forever.
						</p>
					</div>
				</div>
			{:else}
				<p class="text-sm text-[var(--builder-text-muted)]">
					This kit is empty. Only the kit itself will be deleted.
				</p>
			{/if}

			{#if error}
				<p class="text-sm text-red-500 mt-3">{error}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={is_deleting}>
				Cancel
			</Button>
			<Button variant="destructive" onclick={handle_delete} disabled={is_deleting}>
				{#if is_deleting}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Deleting...
				{:else}
					Delete {project_count > 0 ? "Kit & Projects" : "Kit"}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
