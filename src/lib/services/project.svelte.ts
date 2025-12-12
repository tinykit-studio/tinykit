/**
 * Project service - client-side Pocketbase operations
 *
 * This module provides all project CRUD operations using the PB SDK directly.
 * It replaces the /api/projects/* endpoints for authenticated users.
 *
 * Usage:
 *   import { project_service } from '$lib/services/project.svelte'
 *
 *   // List projects
 *   const projects = await project_service.list()
 *
 *   // Get single project
 *   const project = await project_service.get(id)
 *
 *   // Update project
 *   await project_service.update(id, { frontend_code: '...' })
 */

import { pb } from '$lib/pocketbase.svelte'
import type {
	Project,
	Message,
	DesignField,
	ContentField,
	Snapshot,
	CollectionSchema
} from '../../routes/tinykit/types'

const COLLECTION = '_tk_projects'

// Default values for new projects
const DEFAULT_PROJECT: Partial<Project> = {
	domain: '',
	frontend_code: '',
	backend_code: '',
	design: [],
	content: [],
	snapshots: [],
	agent_chat: [],
	custom_instructions: '',
	data: {},
	settings: {
		vibe_zone_enabled: true,
		project_title: 'My Project'
	}
}

/**
 * Project service with all CRUD operations
 */
export const project_service = {
	/**
	 * List all projects (sorted by updated date, newest first)
	 */
	async list(): Promise<Project[]> {
		const records = await pb.collection(COLLECTION).getList<Project>(1, 500)
		// Sort by updated date descending (newest first)
		return records.items.sort(
			(a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
		)
	},

	/**
	 * Get a single project by ID
	 */
	async get(id: string): Promise<Project> {
		return await pb.collection(COLLECTION).getOne<Project>(id)
	},

	/**
	 * Create a new project
	 */
	async create(params: {
		name: string
		domain: string
		frontend_code?: string
		design?: DesignField[]
		content?: ContentField[]
		data?: Record<string, any>
		initial_prompt?: string
	}): Promise<Project> {
		const project_data: Partial<Project> = {
			...DEFAULT_PROJECT,
			name: params.name,
			domain: params.domain.toLowerCase(),
			frontend_code: params.frontend_code || '',
			design: params.design || [],
			content: params.content || [],
			data: params.data || {},
			settings: {
				...DEFAULT_PROJECT.settings,
				project_title: params.name
			}
		}

		// If there's an initial prompt, add it as first message
		if (params.initial_prompt) {
			project_data.agent_chat = [
				{
					role: 'user',
					content: params.initial_prompt
				}
			]
		}

		return await pb.collection(COLLECTION).create<Project>(project_data)
	},

	/**
	 * Update a project
	 */
	async update(id: string, data: Partial<Project>): Promise<Project> {
		// Guard against accidentally clearing frontend_code
		if ('frontend_code' in data) {
			const codeLength = (data.frontend_code as string)?.length || 0
			if (codeLength === 0) {
				// Remove frontend_code from the update
				const { frontend_code, ...rest } = data
				if (Object.keys(rest).length > 0) {
					return await pb.collection(COLLECTION).update<Project>(id, rest)
				}
				// Nothing to update
				return await pb.collection(COLLECTION).getOne<Project>(id)
			}
		}
		return await pb.collection(COLLECTION).update<Project>(id, data)
	},

	/**
	 * Delete a project
	 */
	async delete(id: string): Promise<void> {
		await pb.collection(COLLECTION).delete(id)
	},

	// ==========================================
	// Convenience methods for specific fields
	// ==========================================

	/**
	 * Update frontend code
	 */
	async update_code(id: string, frontend_code: string): Promise<Project> {
		return this.update(id, { frontend_code })
	},

	/**
	 * Update design fields
	 */
	async update_design(id: string, design: DesignField[]): Promise<Project> {
		return this.update(id, { design })
	},

	/**
	 * Update content fields
	 */
	async update_content(id: string, content: ContentField[]): Promise<Project> {
		return this.update(id, { content })
	},

	/**
	 * Update agent chat history
	 */
	async update_chat(id: string, agent_chat: Message[]): Promise<Project> {
		return this.update(id, { agent_chat })
	},

	/**
	 * Update data (JSON key-value store)
	 */
	async update_data(id: string, data: Record<string, any>): Promise<Project> {
		return this.update(id, { data })
	},

	/**
	 * Get a specific data file from project.data
	 */
	async get_data_file(id: string, filename: string): Promise<any> {
		const project = await this.get(id)
		return project.data?.[filename] ?? null
	},

	/**
	 * Set a specific data file in project.data
	 */
	async set_data_file(id: string, filename: string, content: any): Promise<Project> {
		const project = await this.get(id)
		const data = { ...project.data, [filename]: content }
		return this.update(id, { data })
	},

	/**
	 * Delete a specific data file from project.data
	 */
	async delete_data_file(id: string, filename: string): Promise<Project> {
		const project = await this.get(id)
		const data = { ...project.data }
		delete data[filename]
		return this.update(id, { data })
	},

	// ==========================================
	// Snapshot operations
	// ==========================================

	/**
	 * Create a snapshot of current project state
	 */
	async create_snapshot(id: string, description: string): Promise<Snapshot> {
		const project = await this.get(id)
		const snapshots = project.snapshots || []

		// Extract collection schemas and records from project.data
		const collections: CollectionSchema[] = []
		if (project.data && typeof project.data === 'object') {
			for (const [name, value] of Object.entries(project.data)) {
				if (value && typeof value === 'object' && 'schema' in value) {
					collections.push({
						name,
						schema: (value as any).schema || [],
						records: (value as any).records || []
					})
				}
			}
		}

		const snapshot: Snapshot = {
			id: `snap_${Date.now()}`,
			timestamp: Date.now(),
			description,
			file_count: 1, // Just frontend_code for now
			collections
		}

		// Store full snapshot data (we need to extend Snapshot type or store separately)
		const snapshot_with_data = {
			...snapshot,
			frontend_code: project.frontend_code || '',
			design: project.design || [],
			content: project.content || []
		}

		// Add to beginning (most recent first), keep last 50
		const updated_snapshots = [snapshot_with_data, ...snapshots].slice(0, 50)

		await this.update(id, { snapshots: updated_snapshots as any })
		return snapshot
	},

	/**
	 * Restore a snapshot
	 */
	async restore_snapshot(id: string, snapshot_id: string): Promise<void> {
		const project = await this.get(id)
		const snapshot = (project.snapshots as any[])?.find((s: any) => s.id === snapshot_id)

		if (!snapshot) {
			throw new Error('Snapshot not found')
		}

		// Build updated data with restored collection schemas and records
		const updated_data = { ...project.data }
		if (snapshot.collections && Array.isArray(snapshot.collections)) {
			for (const col of snapshot.collections) {
				// Restore both schema and records from snapshot
				updated_data[col.name] = {
					schema: col.schema || [],
					records: col.records || []
				}
			}
		}

		await this.update(id, {
			frontend_code: snapshot.frontend_code,
			design: snapshot.design,
			content: snapshot.content,
			data: updated_data
		})
	},

	/**
	 * Delete a snapshot
	 */
	async delete_snapshot(id: string, snapshot_id: string): Promise<void> {
		const project = await this.get(id)
		const snapshots = (project.snapshots || []).filter((s: any) => s.id !== snapshot_id)
		await this.update(id, { snapshots })
	},

	// ==========================================
	// Settings operations
	// ==========================================

	/**
	 * Update project settings
	 */
	async update_settings(
		id: string,
		settings: Partial<Project['settings']>
	): Promise<Project> {
		const project = await this.get(id)
		return this.update(id, {
			settings: { ...project.settings, ...settings }
		})
	}
}
