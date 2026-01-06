import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProject, pb } from '$lib/server/pb'
import { check_rate_limit, check_origin, get_client_ip } from '$lib/server/data-security'
import { validate_schema, generate_id } from '$lib/server/data-utils'

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
 * File uploads:
 *   - POST with FormData to include files
 *   - Non-file fields in `_data` as JSON string
 *   - File fields as `_file:{fieldname}` entries
 *   - Files are uploaded to project.assets, filenames stored in record
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
		// Get project first (needed for origin check and file uploads)
		const project = await getProject(project_id)
		if (!project) throw error(404, 'Project not found')

		// Security checks
		check_origin(request, project.domain)
		check_rate_limit(get_client_ip(request))

		// Parse request body - handle both JSON and FormData
		let body: Record<string, any>
		const content_type = request.headers.get('content-type') || ''

		if (content_type.includes('multipart/form-data')) {
			// FormData with potential file uploads
			body = await parse_form_data_with_files(request, project_id)
		} else if (content_type.includes('application/json')) {
			body = await request.json()
		} else {
			// Try JSON first, fall back to FormData
			try {
				body = await request.json()
			} catch {
				body = await parse_form_data_with_files(request, project_id)
			}
		}

		const data = project.data || {}

		// Initialize collection if it doesn't exist (new format)
		if (!(collection in data)) {
			data[collection] = { schema: [], records: [] }
		}

		// Expect { schema, records } format
		const collection_data = data[collection]
		if (!collection_data.records) {
			collection_data.records = []
		}

		// Validate fields against schema
		const { warnings } = validate_schema(collection_data, body)

		// Generate ID if not provided
		const record = {
			id: body.id || generate_id(),
			...body
		}

		// Add record
		collection_data.records.push(record)

		// Save back to project
		await pb.collection('_tk_projects').update(project_id, { data })

		// Include warnings in response if any
		const response_body = warnings.length > 0
			? { ...record, _warnings: warnings }
			: record

		return json(response_body, { status: 201 })
	} catch (err: any) {
		if (err.status === 404) {
			throw error(404, 'Project not found')
		}
		console.error('[Data API] Create error:', err)
		throw error(500, 'Failed to create record')
	}
}

/**
 * Parse FormData with file upload support
 * - `_data` field contains JSON for non-file fields
 * - `_file:{fieldname}` entries contain files to upload
 * - Direct FormData passthrough also supported (Pocketbase-style)
 */
async function parse_form_data_with_files(
	request: Request,
	project_id: string
): Promise<Record<string, any>> {
	const form = await request.formData()
	const result: Record<string, any> = {}
	const file_fields: Map<string, File[]> = new Map()

	// First pass: collect all fields
	for (const [key, value] of form.entries()) {
		if (key === '_data') {
			// JSON data for non-file fields
			try {
				Object.assign(result, JSON.parse(value as string))
			} catch {
				// Ignore parse errors
			}
		} else if (key.startsWith('_file:')) {
			// File field (our convention)
			const field_name = key.slice(6) // Remove '_file:' prefix
			if (value instanceof File) {
				if (!file_fields.has(field_name)) {
					file_fields.set(field_name, [])
				}
				file_fields.get(field_name)!.push(value)
			}
		} else if (value instanceof File) {
			// Direct file field (Pocketbase-style)
			if (!file_fields.has(key)) {
				file_fields.set(key, [])
			}
			file_fields.get(key)!.push(value)
		} else {
			// Regular field - try to parse as JSON, fall back to string
			try {
				result[key] = JSON.parse(value as string)
			} catch {
				result[key] = value
			}
		}
	}

	// Upload files and store filenames
	if (file_fields.size > 0) {
		const uploaded = await upload_files_to_assets(project_id, file_fields)
		Object.assign(result, uploaded)
	}

	return result
}

/**
 * Upload files to project.assets and return field->filename mapping
 */
async function upload_files_to_assets(
	project_id: string,
	file_fields: Map<string, File[]>
): Promise<Record<string, string | string[]>> {
	const result: Record<string, string | string[]> = {}

	// Build FormData with all files for single upload request
	const upload_form = new FormData()
	const field_indices: Map<string, number[]> = new Map()
	let file_index = 0

	for (const [field_name, files] of file_fields) {
		field_indices.set(field_name, [])
		for (const file of files) {
			// Use 'assets+' to append to existing files (Pocketbase convention)
			upload_form.append('assets+', file)
			field_indices.get(field_name)!.push(file_index++)
		}
	}

	// Get current assets count before upload
	const project = await pb.collection('_tk_projects').getOne(project_id)
	const before_count = (project.assets as string[] || []).length

	// Upload all files at once
	const updated = await pb.collection('_tk_projects').update(project_id, upload_form)
	const new_assets = (updated.assets as string[] || []).slice(before_count)

	// Map uploaded filenames back to fields
	let new_index = 0
	for (const [field_name, indices] of field_indices) {
		const filenames = indices.map(() => new_assets[new_index++])
		// Single file -> string, multiple files -> array
		result[field_name] = filenames.length === 1 ? filenames[0] : filenames
	}

	return result
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
