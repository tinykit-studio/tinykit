import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProject } from '$lib/server/pb'
import { check_rate_limit, check_origin, get_client_ip } from '$lib/server/data-security'

/**
 * Data Proxy API - List and Create records
 *
 * GET  /_tk/data/{project_id}/{collection} - List records
 * POST /_tk/data/{project_id}/{collection} - Create record
 *
 * Security:
 *   - Origin check: Blocks cross-origin browser requests
 *   - Rate limiting: 30 writes per minute per IP
 *
 * Data format: { schema: [{name, type}], records: [...] }
 *
 * Query params for GET:
 *   - filter: Filter expression (applied in-memory)
 *   - sort: Sort field (prefix with - for descending)
 *   - page: Page number (default 1)
 *   - perPage: Records per page (default 50)
 *   - expand: Relation field(s) to expand (comma-separated)
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

// GET - List records
export const GET: RequestHandler = async ({ params, url }) => {
	const { project_id, collection } = params

	try {
		// Get project and validate collection exists
		const project = await getProject(project_id)
		if (!project) throw error(404, 'Project not found')
		const data = project.data || {}

		if (!(collection in data)) {
			return json({ items: [], totalItems: 0, page: 1, perPage: 50, totalPages: 0 })
		}

		let records = get_records(data[collection])

		// Apply in-memory filter (simple field=value matching for now)
		const filter = url.searchParams.get('filter')
		if (filter) {
			records = apply_filter(records, filter)
		}

		// Apply sorting
		const sort = url.searchParams.get('sort')
		if (sort) {
			records = apply_sort(records, sort)
		}

		// Expand relations
		const expand = url.searchParams.get('expand')
		if (expand) {
			records = apply_expand(records, expand, data)
		}

		// Pagination
		const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
		const per_page = Math.min(100, Math.max(1, parseInt(url.searchParams.get('perPage') || '50', 10)))
		const total_items = records.length
		const total_pages = Math.ceil(total_items / per_page)
		const start = (page - 1) * per_page
		const paginated = records.slice(start, start + per_page)

		return json({
			items: paginated,
			totalItems: total_items,
			page,
			perPage: per_page,
			totalPages: total_pages
		})
	} catch (err: any) {
		if (err.status === 404) {
			throw error(404, 'Project not found')
		}
		console.error('[Data API] List error:', err)
		throw error(500, 'Failed to list records')
	}
}

// POST - Create record
export const POST: RequestHandler = async ({ params, request }) => {
	const { project_id, collection } = params

	try {
		// Get project first (needed for origin check)
		const project = await getProject(project_id)
		if (!project) throw error(404, 'Project not found')

		// Security checks
		check_origin(request, project.domain)
		check_rate_limit(get_client_ip(request))

		const body = await request.json()
		const data = project.data || {}

		// Initialize collection if it doesn't exist (new format)
		if (!(collection in data)) {
			data[collection] = { schema: [], records: [] }
		}

		// Expect { schema, records } format
		let collection_data = data[collection]
		if (!collection_data.records) {
			collection_data.records = []
		}

		// Generate ID if not provided
		const record = {
			id: body.id || generate_id(),
			...body,
			created: new Date().toISOString(),
			updated: new Date().toISOString()
		}

		// Add record
		collection_data.records.push(record)

		// Save back to project
		const { pb } = await import('$lib/server/pb')
		await pb.collection('_tk_projects').update(project_id, { data })

		return json(record, { status: 201 })
	} catch (err: any) {
		if (err.status === 404) {
			throw error(404, 'Project not found')
		}
		console.error('[Data API] Create error:', err)
		throw error(500, 'Failed to create record')
	}
}

// Helper: Generate a short random ID (5 chars, alphanumeric)
function generate_id(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
	let id = ''
	for (let i = 0; i < 5; i++) {
		id += chars[Math.floor(Math.random() * chars.length)]
	}
	return id
}

// Helper: Apply simple filter (supports field=value and field!=value)
function apply_filter(records: any[], filter: string): any[] {
	// Parse simple expressions: field = "value" or field != "value"
	// Also supports: field = true, field = false, field = 123
	const expressions = filter.split('&&').map(e => e.trim())

	return records.filter(record => {
		for (const expr of expressions) {
			// Match: field = "value" or field = value or field != "value"
			const match = expr.match(/^(\w+)\s*(=|!=|>|<|>=|<=)\s*(.+)$/)
			if (!match) continue

			const [, field, op, raw_value] = match
			let value: any = raw_value.trim()

			// Parse value type
			if (value.startsWith('"') && value.endsWith('"')) {
				value = value.slice(1, -1)
			} else if (value.startsWith("'") && value.endsWith("'")) {
				value = value.slice(1, -1)
			} else if (value === 'true') {
				value = true
			} else if (value === 'false') {
				value = false
			} else if (value === 'null') {
				value = null
			} else if (!isNaN(Number(value))) {
				value = Number(value)
			}

			const record_value = record[field]

			switch (op) {
				case '=':
					if (record_value !== value) return false
					break
				case '!=':
					if (record_value === value) return false
					break
				case '>':
					if (!(record_value > value)) return false
					break
				case '<':
					if (!(record_value < value)) return false
					break
				case '>=':
					if (!(record_value >= value)) return false
					break
				case '<=':
					if (!(record_value <= value)) return false
					break
			}
		}
		return true
	})
}

// Helper: Apply sorting
function apply_sort(records: any[], sort: string): any[] {
	const fields = sort.split(',').map(s => s.trim())

	return [...records].sort((a, b) => {
		for (const field of fields) {
			const desc = field.startsWith('-')
			const key = desc ? field.slice(1) : field
			const modifier = desc ? -1 : 1

			if (a[key] < b[key]) return -1 * modifier
			if (a[key] > b[key]) return 1 * modifier
		}
		return 0
	})
}

// Helper: Expand relations (resolve foreign keys)
function apply_expand(records: any[], expand: string, all_data: Record<string, any>): any[] {
	const fields = expand.split(',').map(s => s.trim())

	return records.map(record => {
		const expanded = { ...record }

		for (const field of fields) {
			const fk_value = record[field]
			if (!fk_value) continue

			// Try to find the relation target
			// Convention: field name like "user_id" -> look in "users" collection
			// Or field name like "category" -> look in "categories" collection
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
	})
}

// Helper: Guess collection name from field name
function guess_collection_name(field: string): string | null {
	// Remove _id suffix if present
	let name = field.replace(/_id$/, '')

	// Simple pluralization
	if (!name.endsWith('s')) {
		name = name + 's'
	}

	return name
}
