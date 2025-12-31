/**
 * Kit service - client-side Pocketbase operations for kits
 *
 * Usage:
 *   import { kit_service } from '$lib/services/kit.svelte'
 *
 *   const kits = await kit_service.list()
 *   await kit_service.create({ name: 'My Kit', icon: 'mdi:folder' })
 */

import { pb } from '$lib/pocketbase.svelte'
import type { Kit } from '../../routes/tinykit/types'

const COLLECTION = '_tk_kits'

/**
 * Kit service with all CRUD operations
 */
export const kit_service = {
	/**
	 * List all kits (sorted by created date, oldest first)
	 */
	async list(): Promise<Kit[]> {
		try {
			const records = await pb.collection(COLLECTION).getFullList<Kit>({
				sort: 'created'
			})
			return records
		} catch (e) {
			// Collection may not exist yet (pre-migration)
			console.warn('Failed to list kits:', e)
			return []
		}
	},

	/**
	 * Get a single kit by ID
	 */
	async get(id: string): Promise<Kit | null> {
		try {
			return await pb.collection(COLLECTION).getOne<Kit>(id)
		} catch (e) {
			return null
		}
	},

	/**
	 * Create a new kit
	 */
	async create(params: { name: string; icon?: string }): Promise<Kit> {
		try {
			return await pb.collection(COLLECTION).create<Kit>({
				name: params.name,
				icon: params.icon || 'mdi:folder-outline'
			})
		} catch (e: any) {
			// Surface the actual error from Pocketbase
			const msg = e?.response?.message || e?.message || 'Unknown error'
			console.error('Kit create error:', e?.response || e)
			throw new Error(`Failed to create kit: ${msg}`)
		}
	},

	/**
	 * Update a kit
	 */
	async update(id: string, data: Partial<Pick<Kit, 'name' | 'icon' | 'builder_theme_id'>>): Promise<Kit> {
		return await pb.collection(COLLECTION).update<Kit>(id, data)
	},

	/**
	 * Delete a kit
	 */
	async delete(id: string): Promise<void> {
		await pb.collection(COLLECTION).delete(id)
	}
}
