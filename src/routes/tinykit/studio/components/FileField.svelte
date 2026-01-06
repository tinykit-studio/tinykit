<script lang="ts">
	import { pb } from "$lib/pocketbase.svelte"
	import { Upload, X, Image, File } from "lucide-svelte"

	type FileFieldProps = {
		project_id: string
		value: string | string[]
		multiple?: boolean
		onchange?: (value: string | string[]) => void
	}

	let {
		project_id,
		value = $bindable(),
		multiple = false,
		onchange
	}: FileFieldProps = $props()

	let uploading = $state(false)
	let drag_over = $state(false)
	let file_input: HTMLInputElement

	// Get asset URL for display
	function get_asset_url(filename: string, thumb?: string): string {
		return `/_tk/assets/${filename}?project_id=${project_id}${thumb ? `&thumb=${thumb}` : ""}`
	}

	// Check if file is an image
	function is_image(filename: string): boolean {
		if (!filename || typeof filename !== "string") return false
		const ext = filename.split(".").pop()?.toLowerCase() || ""
		return ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(ext)
	}

	// Get original filename from Pocketbase's generated name
	function get_display_name(filename: string): string {
		if (!filename || typeof filename !== "string") return ""
		// Pocketbase format: randomchars_originalname.ext
		const match = filename.match(/^[a-z0-9]+_(.+)$/i)
		return match ? match[1] : filename
	}

	async function handle_upload(files: FileList | null) {
		if (!files?.length) return

		uploading = true
		try {
			const form = new FormData()
			for (const file of Array.from(files)) {
				// Use 'assets+' to append to existing files (Pocketbase convention)
				form.append("assets+", file)
			}

			// Get current assets count
			const project = await pb.collection("_tk_projects").getOne(project_id)
			const before_count = (project.assets as string[] || []).length

			// Upload files
			const updated = await pb.collection("_tk_projects").update(project_id, form)
			const new_assets = (updated.assets as string[] || []).slice(before_count)

			if (multiple) {
				const current = Array.isArray(value) ? value : value ? [value] : []
				const new_value = [...current, ...new_assets]
				value = new_value
				onchange?.(new_value)
			} else {
				const new_value = new_assets[0] || ""
				value = new_value
				onchange?.(new_value)
			}
		} catch (err) {
			console.error("[FileField] Upload failed:", err)
		} finally {
			uploading = false
		}
	}

	function handle_drop(e: DragEvent) {
		e.preventDefault()
		drag_over = false
		handle_upload(e.dataTransfer?.files ?? null)
	}

	function remove_file(filename: string) {
		if (multiple && Array.isArray(value)) {
			const new_value = value.filter(f => f !== filename)
			value = new_value
			onchange?.(new_value)
		} else {
			value = ""
			onchange?.("")
		}
	}

	function trigger_upload() {
		file_input?.click()
	}

	// Normalize value to array for rendering, filtering out non-strings
	let files = $derived(
		(Array.isArray(value) ? value : value ? [value] : [])
			.filter((f): f is string => typeof f === "string" && f.length > 0)
	)
</script>

<div class="file-field">
	<input
		bind:this={file_input}
		type="file"
		{multiple}
		accept={multiple ? undefined : "image/*"}
		onchange={(e) => handle_upload(e.currentTarget.files)}
		class="hidden"
	/>

	{#if multiple}
		<!-- Multiple files: list view -->
		<div
			class="drop-zone"
			class:drag-over={drag_over}
			role="button"
			tabindex="0"
			ondragover={(e) => { e.preventDefault(); drag_over = true }}
			ondragleave={() => drag_over = false}
			ondrop={handle_drop}
			onclick={trigger_upload}
			onkeydown={(e) => e.key === 'Enter' && trigger_upload()}
		>
			{#if uploading}
				<div class="spinner"></div>
				<span class="hint">Uploading...</span>
			{:else if files.length > 0}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div class="file-list" onclick={(e) => e.stopPropagation()}>
					{#each files as filename (filename)}
						<div class="file-item">
							{#if is_image(filename)}
								<img
									src={get_asset_url(filename, "80x80")}
									alt={get_display_name(filename)}
									class="file-thumb"
								/>
							{:else}
								<div class="file-icon">
									<File class="w-4 h-4" />
								</div>
							{/if}
							<span class="file-name" title={get_display_name(filename)}>
								{get_display_name(filename)}
							</span>
							<button
								type="button"
								onclick={() => remove_file(filename)}
								class="remove-btn"
								title="Remove"
							>
								<X class="w-3 h-3" />
							</button>
						</div>
					{/each}
				</div>
				<span class="hint">Drop more or click to add</span>
			{:else}
				<Upload class="w-5 h-5 text-[var(--builder-text-secondary)]" />
				<span class="hint">Drop files or click to upload</span>
			{/if}
		</div>
	{:else}
		<!-- Single image: preview box -->
		<div
			class="image-box"
			class:drag-over={drag_over}
			class:has-image={files.length > 0 && is_image(files[0])}
			role="button"
			tabindex="0"
			ondragover={(e) => { e.preventDefault(); drag_over = true }}
			ondragleave={() => drag_over = false}
			ondrop={handle_drop}
			onclick={trigger_upload}
			onkeydown={(e) => e.key === 'Enter' && trigger_upload()}
		>
			{#if uploading}
				<div class="spinner"></div>
			{:else if files.length > 0}
				{#if is_image(files[0])}
					<img
						src={get_asset_url(files[0])}
						alt={get_display_name(files[0])}
						class="image-preview"
					/>
					<button
						type="button"
						class="remove-overlay"
						onclick={(e) => { e.stopPropagation(); remove_file(files[0]) }}
						title="Remove image"
					>
						<X class="w-4 h-4" />
					</button>
				{:else}
					<File class="w-6 h-6 text-[var(--builder-text-secondary)]" />
					<span class="file-name-solo">{get_display_name(files[0])}</span>
					<button
						type="button"
						class="remove-overlay"
						onclick={(e) => { e.stopPropagation(); remove_file(files[0]) }}
						title="Remove file"
					>
						<X class="w-4 h-4" />
					</button>
				{/if}
			{:else}
				<Image class="w-6 h-6 text-[var(--builder-text-secondary)]" />
				<span class="hint">Drop or click</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.file-field {
		width: 100%;
	}

	/* Shared bordered container styles */
	.drop-zone,
	.image-box {
		width: 100%;
		border: 1px dashed var(--builder-border);
		border-radius: 0.5rem;
		background: var(--builder-bg-primary);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		cursor: pointer;
		transition: all 0.15s;
		position: relative;
		overflow: hidden;
	}

	.drop-zone {
		padding: 1rem;
		min-height: 80px;
	}

	.image-box {
		aspect-ratio: 16 / 9;
		min-height: 100px;
	}

	.drop-zone:hover,
	.drop-zone.drag-over,
	.image-box:hover,
	.image-box.drag-over {
		border-color: var(--builder-accent);
		background: var(--builder-bg-secondary);
	}

	.image-box.has-image {
		border-style: solid;
		border-color: var(--builder-border);
	}

	.image-box.has-image:hover {
		border-color: var(--builder-accent);
	}

	/* Hint text */
	.hint {
		font-size: 0.75rem;
		color: var(--builder-text-secondary);
	}

	/* Spinner */
	.spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--builder-border);
		border-top-color: var(--builder-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Image preview (single image mode) */
	.image-preview {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.remove-overlay {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		width: 1.75rem;
		height: 1.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		border-radius: 0.375rem;
		opacity: 0;
		transition: opacity 0.15s;
		cursor: pointer;
	}

	.image-box:hover .remove-overlay {
		opacity: 1;
	}

	.remove-overlay:hover {
		background: rgba(239, 68, 68, 0.9);
	}

	/* File name for non-image single file */
	.file-name-solo {
		font-size: 0.75rem;
		color: var(--builder-text-primary);
		text-align: center;
		padding: 0 1rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}

	/* Multiple files list */
	.file-list {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}

	.file-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		background: var(--builder-bg-secondary);
		border-radius: 0.25rem;
	}

	.file-thumb {
		width: 28px;
		height: 28px;
		object-fit: cover;
		border-radius: 0.25rem;
		flex-shrink: 0;
	}

	.file-icon {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--builder-bg-tertiary);
		border-radius: 0.25rem;
		color: var(--builder-text-secondary);
		flex-shrink: 0;
	}

	.file-name {
		flex: 1;
		font-size: 0.75rem;
		color: var(--builder-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.remove-btn {
		padding: 0.25rem;
		color: var(--builder-text-secondary);
		border-radius: 0.25rem;
		transition: all 0.15s;
		flex-shrink: 0;
	}

	.remove-btn:hover {
		color: #ef4444;
		background: rgba(239, 68, 68, 0.1);
	}
</style>
