/**
 * Reactive project store
 *
 * Provides reactive access to the current project with auto-save functionality.
 * Uses Svelte 5 runes for reactivity.
 *
 * Usage:
 *   import { current_project } from '$lib/stores/project.svelte'
 *
 *   // Load a project
 *   await current_project.load(project_id)
 *
 *   // Access project data (reactive)
 *   current_project.data?.frontend_code
 *
 *   // Update and auto-save
 *   await current_project.update({ frontend_code: '...' })
 */

import { project_service } from '$lib/services/project.svelte'
import type { Project, AgentMessage, DesignField, ContentField } from '../../routes/tinykit/types'

class ProjectStore {
	// Reactive state
	data = $state<Project | null>(null)
	is_loading = $state(false)
	is_saving = $state(false)
	error = $state<string | null>(null)
	last_saved_at = $state<Date | null>(null)

	// Current project ID
	private _id: string | null = null

	/**
	 * Load a project by ID
	 */
	async load(id: string): Promise<Project | null> {
		this._id = id
		this.is_loading = true
		this.error = null

		try {
			this.data = await project_service.get(id)
			return this.data
		} catch (err: any) {
			this.error = err.message || 'Failed to load project'
			this.data = null
			return null
		} finally {
			this.is_loading = false
		}
	}

	/**
	 * Reload the current project
	 */
	async reload(): Promise<Project | null> {
		if (!this._id) return null
		return this.load(this._id)
	}

	/**
	 * Update project fields and save to database
	 */
	async update(updates: Partial<Project>): Promise<Project | null> {
		if (!this._id || !this.data) return null

		this.is_saving = true
		this.error = null

		try {
			// Optimistically update local state
			this.data = { ...this.data, ...updates }

			// Save to database
			const saved = await project_service.update(this._id, updates)
			this.data = saved
			this.last_saved_at = new Date()

			return saved
		} catch (err: any) {
			this.error = err.message || 'Failed to save project'
			// Reload to get server state on error
			await this.reload()
			return null
		} finally {
			this.is_saving = false
		}
	}

	/**
	 * Clear the current project (e.g., when navigating away)
	 */
	clear(): void {
		this._id = null
		this.data = null
		this.error = null
		this.is_loading = false
		this.is_saving = false
		this.last_saved_at = null
	}

	// ==========================================
	// Convenience getters
	// ==========================================

	get id(): string | null {
		return this._id
	}

	get has_unsaved_changes(): boolean {
		// Could implement dirty tracking here
		return false
	}

	// ==========================================
	// Convenience update methods
	// ==========================================

	/**
	 * Update frontend code
	 */
	async update_code(frontend_code: string): Promise<Project | null> {
		return this.update({ frontend_code })
	}

	/**
	 * Update design fields
	 */
	async update_design(design: DesignField[]): Promise<Project | null> {
		return this.update({ design })
	}

	/**
	 * Update content fields
	 */
	async update_content(content: ContentField[]): Promise<Project | null> {
		return this.update({ content })
	}

	/**
	 * Update chat messages
	 */
	async update_chat(agent_chat: AgentMessage[]): Promise<Project | null> {
		return this.update({ agent_chat })
	}

	/**
	 * Add a message to chat
	 */
	async add_message(message: AgentMessage): Promise<Project | null> {
		if (!this.data) return null
		const agent_chat = [...(this.data.agent_chat || []), message]
		return this.update({ agent_chat })
	}

	/**
	 * Update a specific data file
	 */
	async set_data_file(filename: string, content: any): Promise<Project | null> {
		if (!this.data) return null
		const data = { ...this.data.data, [filename]: content }
		return this.update({ data })
	}

	/**
	 * Delete a specific data file
	 */
	async delete_data_file(filename: string): Promise<Project | null> {
		if (!this.data) return null
		const data = { ...this.data.data }
		delete data[filename]
		return this.update({ data })
	}

	/**
	 * Get list of data file names
	 */
	get data_files(): string[] {
		return Object.keys(this.data?.data || {})
	}

	// ==========================================
	// Snapshot methods
	// ==========================================

	/**
	 * Create a snapshot
	 */
	async create_snapshot(description: string): Promise<void> {
		if (!this._id) return
		await project_service.create_snapshot(this._id, description)
		await this.reload()
	}

	/**
	 * Restore a snapshot
	 */
	async restore_snapshot(snapshot_id: string): Promise<void> {
		if (!this._id) return
		await project_service.restore_snapshot(this._id, snapshot_id)
		await this.reload()
	}

	/**
	 * Delete a snapshot
	 */
	async delete_snapshot(snapshot_id: string): Promise<void> {
		if (!this._id) return
		await project_service.delete_snapshot(this._id, snapshot_id)
		await this.reload()
	}

	// ==========================================
	// Settings methods
	// ==========================================

	/**
	 * Update project title
	 */
	async set_title(title: string): Promise<Project | null> {
		if (!this.data) return null
		return this.update({
			settings: { ...this.data.settings, project_title: title }
		})
	}

	/**
	 * Toggle vibe zone
	 */
	async toggle_vibe_zone(): Promise<Project | null> {
		if (!this.data) return null
		return this.update({
			settings: {
				...this.data.settings,
				vibe_zone_enabled: !this.data.settings?.vibe_zone_enabled
			}
		})
	}
}

// Export singleton store
export const current_project = new ProjectStore()
