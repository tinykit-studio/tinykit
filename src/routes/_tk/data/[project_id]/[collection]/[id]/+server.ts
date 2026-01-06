import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getProject, pb } from '$lib/server/pb'
import { check_rate_limit, check_origin, get_client_ip } from '$lib/server/data-security'
import { validate_schema } from '$lib/server/data-utils'

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
 *
 * File uploads:
 *   - PATCH with FormData to update files
 *   - Same format as POST in collection endpoint
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

		// Parse request body - handle both JSON and FormData
		let updates: Record<string, any>
		const content_type = request.headers.get('content-type') || ''

		if (content_type.includes('multipart/form-data')) {
			updates = await parse_form_data_with_files(request, project_id)
		} else if (content_type.includes('application/json')) {
			updates = await request.json()
		} else {
			try {
				updates = await request.json()
			} catch {
				updates = await parse_form_data_with_files(request, project_id)
			}
		}

		const data = project.data || {}

		if (!(collection in data)) {
			throw error(404, 'Collection not found')
		}

		const collection_data = data[collection]
		const records = get_records(collection_data)
		// Use loose comparison to handle numeric IDs from legacy data
		const index = records.findIndex((r: any) => String(r.id) === String(id))
		if (index === -1) {
			throw error(404, 'Record not found')
		}

		// Validate fields against schema
		const { warnings } = validate_schema(collection_data, updates)

		// Update record, preserving id
		const existing = records[index]
		const updated = {
			...existing,
			...updates,
			id: existing.id
		}

		records[index] = updated
		data[collection] = set_records(collection_data, records)

		// Save back to project
		await pb.collection('_tk_projects').update(project_id, { data })

		// Include warnings in response if any
		const response_body = warnings.length > 0
			? { ...updated, _warnings: warnings }
			: updated

		return json(response_body)
	} catch (err: any) {
		if (err.status) throw err
		console.error('[Data API] Update error:', err)
		throw error(500, 'Failed to update record')
	}
}

/**
 * Parse FormData with file upload support
 */
async function parse_form_data_with_files(
	request: Request,
	project_id: string
): Promise<Record<string, any>> {
	const form = await request.formData()
	const result: Record<string, any> = {}
	const file_fields: Map<string, File[]> = new Map()

	for (const [key, value] of form.entries()) {
		if (key === '_data') {
			try {
				Object.assign(result, JSON.parse(value as string))
			} catch {
				// Ignore parse errors
			}
		} else if (key.startsWith('_file:')) {
			const field_name = key.slice(6)
			if (value instanceof File) {
				if (!file_fields.has(field_name)) {
					file_fields.set(field_name, [])
				}
				file_fields.get(field_name)!.push(value)
			}
		} else if (value instanceof File) {
			if (!file_fields.has(key)) {
				file_fields.set(key, [])
			}
			file_fields.get(key)!.push(value)
		} else {
			try {
				result[key] = JSON.parse(value as string)
			} catch {
				result[key] = value
			}
		}
	}

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

	const project = await pb.collection('_tk_projects').getOne(project_id)
	const before_count = (project.assets as string[] || []).length

	const updated = await pb.collection('_tk_projects').update(project_id, upload_form)
	const new_assets = (updated.assets as string[] || []).slice(before_count)

	let new_index = 0
	for (const [field_name, indices] of field_indices) {
		const filenames = indices.map(() => new_assets[new_index++])
		result[field_name] = filenames.length === 1 ? filenames[0] : filenames
	}

	return result
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
