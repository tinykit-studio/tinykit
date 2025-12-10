import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProject } from '$lib/server/pb'
import { check_rate_limit, check_origin, get_client_ip } from '$lib/server/data-security'

/**
 * Data Proxy API - Single record operations
 *
 * GET    /_tk/data/{project_id}/{collection}/{id} - Get record
 * PATCH  /_tk/data/{project_id}/{collection}/{id} - Update record
 * DELETE /_tk/data/{project_id}/{collection}/{id} - Delete record
 *
 * Security:
 *   - Origin check: Blocks cross-origin browser requests (writes only)
 *   - Rate limiting: 30 writes per minute per IP
 *
 * Data format: { schema: [{name, type}], records: [...] }
 */

// Extract records from collection data
// Supports both { schema, records } format and legacy array format
function get_records(collection_data: any): any[] {
	if (!collection_data) return []
	// New format: { schema, records }
	if (collection_data.records && Array.isArray(collection_data.records)) {
		return collection_data.records
	}
	// Legacy format: plain array
	if (Array.isArray(collection_data)) {
		return collection_data
	}
	return []
}

// Set records in collection data (preserves schema, converts legacy to new format)
function set_records(collection_data: any, records: any[]): any {
	// If legacy format (plain array), convert to new format
	if (Array.isArray(collection_data)) {
		return { schema: [], records }
	}
	return { ...collection_data, records }
}

// GET - Get single record
export const GET: RequestHandler = async ({ params, url }) => {
	const { project_id, collection, id } = params

	try {
		const project = await getProject(project_id)
		if (!project) throw error(404, 'Project not found')
		const data = project.data || {}

		if (!(collection in data)) {
			throw error(404, 'Collection not found')
		}

		const records = get_records(data[collection])
		// Use loose comparison to handle numeric IDs from legacy data
		const record = records.find((r: any) => String(r.id) === String(id))
		if (!record) {
			throw error(404, 'Record not found')
		}

		// Expand relations if requested
		const expand = url.searchParams.get('expand')
		if (expand) {
			return json(apply_expand(record, expand, data))
		}

		return json(record)
	} catch (err: any) {
		if (err.status) throw err
		console.error('[Data API] Get error:', err)
		throw error(500, 'Failed to get record')
	}
}

// PATCH - Update record
export const PATCH: RequestHandler = async ({ params, request }) => {
	const { project_id, collection, id } = params

	try {
		const project = await getProject(project_id)
		if (!project) throw error(404, 'Project not found')

		// Security checks
		check_origin(request, project.domain)
		check_rate_limit(get_client_ip(request))

		const updates = await request.json()
		const data = project.data || {}

		if (!(collection in data)) {
			throw error(404, 'Collection not found')
		}

		const records = get_records(data[collection])
		// Use loose comparison to handle numeric IDs from legacy data
		const index = records.findIndex((r: any) => String(r.id) === String(id))
		if (index === -1) {
			throw error(404, 'Record not found')
		}

		// Update record, preserving id and created timestamp
		const existing = records[index]
		const updated = {
			...existing,
			...updates,
			id: existing.id,
			created: existing.created,
			updated: new Date().toISOString()
		}

		records[index] = updated
		data[collection] = set_records(data[collection], records)

		// Save back to project
		const { pb } = await import('$lib/server/pb')
		await pb.collection('_tk_projects').update(project_id, { data })

		return json(updated)
	} catch (err: any) {
		if (err.status) throw err
		console.error('[Data API] Update error:', err)
		throw error(500, 'Failed to update record')
	}
}

// DELETE - Delete record
export const DELETE: RequestHandler = async ({ params, request }) => {
	const { project_id, collection, id } = params

	try {
		const project = await getProject(project_id)
		if (!project) throw error(404, 'Project not found')

		// Security checks
		check_origin(request, project.domain)
		check_rate_limit(get_client_ip(request))

		const data = project.data || {}

		if (!(collection in data)) {
			throw error(404, 'Collection not found')
		}

		const records = get_records(data[collection])
		// Use loose comparison to handle numeric IDs from legacy data
		const index = records.findIndex((r: any) => String(r.id) === String(id))
		if (index === -1) {
			throw error(404, 'Record not found')
		}

		// Remove record
		records.splice(index, 1)
		data[collection] = set_records(data[collection], records)

		// Save back to project
		const { pb } = await import('$lib/server/pb')
		await pb.collection('_tk_projects').update(project_id, { data })

		return new Response(null, { status: 204 })
	} catch (err: any) {
		if (err.status) throw err
		console.error('[Data API] Delete error:', err)
		throw error(500, 'Failed to delete record')
	}
}

// Helper: Expand relations for a single record
function apply_expand(record: any, expand: string, all_data: Record<string, any>): any {
	const fields = expand.split(',').map(s => s.trim())
	const expanded = { ...record }

	for (const field of fields) {
		const fk_value = record[field]
		if (!fk_value) continue

		const target_collection = guess_collection_name(field)

		if (target_collection && all_data[target_collection]) {
			const target_records = get_records(all_data[target_collection])
			const related = target_records.find((r: any) => r.id === fk_value)
			if (related) {
				expanded[`expand_${field}`] = related
			}
		}
	}

	return expanded
}

// Helper: Guess collection name from field name
function guess_collection_name(field: string): string | null {
	let name = field.replace(/_id$/, '')
	if (!name.endsWith('s')) {
		name = name + 's'
	}
	return name
}
