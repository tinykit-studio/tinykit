// API client functions for tinykit admin interface
// This version uses the Pocketbase SDK directly for authenticated access

import { pb } from '$lib/pocketbase.svelte'
import { project_service } from '$lib/services/project.svelte'
import { transform_content_fields } from '$lib/compiler/init'
import { generate_data_module, generate_tinykit_module } from './module-generators'
import type {
	Project,
	AgentMessage,
	ContentField,
	DesignField,
	Snapshot,
	Template,
	CollectionSchema
} from "../types"

const COLLECTION = '_tk_projects'

// Helper to get auth headers for API requests
function get_auth_headers(): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	}
	if (pb.authStore.token) {
		headers['Authorization'] = `Bearer ${pb.authStore.token}`
	}
	return headers
}

// Helper to get project and throw if not found
async function get_project(project_id: string): Promise<Project> {
	return await pb.collection(COLLECTION).getOne<Project>(project_id)
}

// Helper to update project
async function update_project(project_id: string, data: Partial<Project>): Promise<Project> {
	return await pb.collection(COLLECTION).update<Project>(project_id, data)
}

// Snapshots API
export async function load_snapshots(project_id: string): Promise<Snapshot[]> {
	const project = await get_project(project_id)
	return project.snapshots || []
}

export async function create_snapshot(project_id: string, description: string): Promise<void> {
	await project_service.create_snapshot(project_id, description)
}

export async function restore_snapshot(project_id: string, id: string): Promise<void> {
	await project_service.restore_snapshot(project_id, id)
}

export async function delete_snapshot(project_id: string, id: string): Promise<void> {
	await project_service.delete_snapshot(project_id, id)
}

export async function restore_from_snapshot_data(
	project_id: string,
	data: { frontend_code: string; design: DesignField[]; content: ContentField[]; collections?: CollectionSchema[] }
): Promise<void> {
	const project = await get_project(project_id)
	const update_data: Partial<Project> = {
		frontend_code: data.frontend_code,
		design: data.design,
		content: data.content
	}

	// Restore collection schemas and records if provided
	if (data.collections && Array.isArray(data.collections) && data.collections.length > 0) {
		const updated_data = { ...project.data }
		for (const col of data.collections) {
			// Restore both schema and records from snapshot
			updated_data[col.name] = {
				schema: col.schema || [],
				records: col.records || []
			}
		}
		update_data.data = updated_data
	}

	await update_project(project_id, update_data)
}

// Code API - tinykit stores code in project.frontend_code
export async function read_code(project_id: string): Promise<string> {
	const project = await get_project(project_id)
	return project.frontend_code || ''
}

export async function write_code(project_id: string, content: string): Promise<void> {
	await update_project(project_id, { frontend_code: content })
}

// Agent/Chat API
// Note: The actual LLM call still goes through the server endpoint (for API key security)
// The server manages conversation history - client just sends the prompt
export async function send_prompt(
	project_id: string,
	prompt: string,
	spec_content?: string,
	display_prompt?: string
): Promise<Response> {
	// The agent endpoint still needs to be server-side for LLM API keys
	const body: any = {
		prompt,
		display_prompt: display_prompt || prompt,
		stream: true
	}
	if (spec_content) {
		body.spec = spec_content
	}

	return fetch(`/api/projects/${project_id}/agent`, {
		method: "POST",
		headers: get_auth_headers(),
		body: JSON.stringify(body)
	})
}

export async function load_messages(project_id: string): Promise<AgentMessage[]> {
	const project = await get_project(project_id)
	return project.agent_chat || []
}

export async function save_messages(project_id: string, messages: AgentMessage[]): Promise<void> {
	await update_project(project_id, { agent_chat: messages })
}

export async function clear_conversation(project_id: string): Promise<void> {
	await update_project(project_id, { agent_chat: [] })
}

// Content fields API
export async function add_content_field(project_id: string, field: Omit<ContentField, "id">): Promise<ContentField> {
	const project = await get_project(project_id)
	const fields = project.content || []
	const new_field: ContentField = {
		...field,
		id: crypto.randomUUID()
	}
	fields.push(new_field)
	await update_project(project_id, { content: fields })
	return new_field
}

export async function update_content_field(project_id: string, id: string, value: any): Promise<void> {
	const project = await get_project(project_id)
	const fields = project.content || []
	const field = fields.find(f => f.id === id)
	if (field) {
		field.value = value
		await update_project(project_id, { content: fields })
	}
}

export async function delete_content_field(project_id: string, id: string): Promise<void> {
	const project = await get_project(project_id)
	const fields = (project.content || []).filter(f => f.id !== id)
	await update_project(project_id, { content: fields })
}

export async function reorder_content_fields(project_id: string, fields: ContentField[]): Promise<void> {
	await update_project(project_id, { content: fields })
}

export async function add_design_field(project_id: string, field: Omit<DesignField, "id">): Promise<DesignField> {
	const project = await get_project(project_id)
	const design = project.design || []
	const new_field: DesignField = {
		...field,
		id: crypto.randomUUID()
	}
	design.push(new_field)
	await update_project(project_id, { design })
	return new_field
}

export async function update_design_field(project_id: string, id: string, value: string): Promise<void> {
	const project = await get_project(project_id)
	const design = project.design || []
	const field = design.find(f => f.id === id)
	if (field) {
		field.value = value
		await update_project(project_id, { design })
	}
}

export async function update_design_field_meta(
	project_id: string,
	id: string,
	updates: { name?: string; css_var?: string; type?: string }
): Promise<void> {
	const project = await get_project(project_id)
	const design = project.design || []
	const field = design.find(f => f.id === id)
	if (field) {
		if (updates.name !== undefined) field.name = updates.name
		if (updates.css_var !== undefined) field.css_var = updates.css_var
		if (updates.type !== undefined) field.type = updates.type as any
		await update_project(project_id, { design })
	}
}

export async function delete_design_field(project_id: string, id: string): Promise<void> {
	const project = await get_project(project_id)
	const design = (project.design || []).filter(f => f.id !== id)
	await update_project(project_id, { design })
}

export async function reorder_design_fields(project_id: string, fields: DesignField[]): Promise<void> {
	await update_project(project_id, { design: fields })
}

// Data Files API - stored in project.data as key-value
export async function load_data_files(project_id: string): Promise<string[]> {
	const project = await get_project(project_id)
	return Object.keys(project.data || {})
}

export async function read_data_file(project_id: string, filename: string): Promise<any> {
	const project = await get_project(project_id)
	return project.data?.[filename] ?? null
}

export async function write_data_file(project_id: string, filename: string, data: any): Promise<void> {
	const project = await get_project(project_id)
	const updated_data = { ...project.data, [filename]: data }
	await update_project(project_id, { data: updated_data })
}

export async function delete_data_file(project_id: string, filename: string): Promise<void> {
	const project = await get_project(project_id)
	const updated_data = { ...project.data }
	delete updated_data[filename]
	await update_project(project_id, { data: updated_data })
}

export async function get_data_file_icon(filename: string): Promise<string> {
	// Simple icon mapping based on filename
	const name = filename.toLowerCase().replace('.json', '')
	const icon_map: Record<string, string> = {
		users: 'mdi:account-group',
		user: 'mdi:account',
		posts: 'mdi:post',
		comments: 'mdi:comment-multiple',
		orders: 'mdi:cart',
		products: 'mdi:package-variant',
		settings: 'mdi:cog',
		config: 'mdi:cog',
		todos: 'mdi:checkbox-marked-outline',
		tasks: 'mdi:checkbox-marked-outline',
		events: 'mdi:calendar',
		messages: 'mdi:message',
		notifications: 'mdi:bell',
		tags: 'mdi:tag',
		categories: 'mdi:folder',
		contacts: 'mdi:contacts',
		customers: 'mdi:account-box',
		articles: 'mdi:newspaper',
		notes: 'mdi:note-text',
		pages: 'mdi:file-document',
		inventory: 'mdi:warehouse',
		payments: 'mdi:credit-card',
		invoices: 'mdi:receipt',
		bookings: 'mdi:calendar-check',
		appointments: 'mdi:calendar-clock',
		items: 'mdi:format-list-bulleted',
		projects: 'mdi:folder-open',
		files: 'mdi:file-multiple',
		images: 'mdi:image-multiple',
		logs: 'mdi:history',
		reviews: 'mdi:star',
		favorites: 'mdi:heart'
	}
	return icon_map[name] || 'mdi:database'
}

// Templates API - still needs server endpoint
export async function load_templates(): Promise<Template[]> {
	const res = await fetch("/api/templates", {
		headers: get_auth_headers()
	})
	if (!res.ok) throw new Error("Failed to load templates")
	return res.json()
}

export async function load_template(project_id: string, template_id: string): Promise<void> {
	const res = await fetch(`/api/projects/${project_id}/templates`, {
		method: "POST",
		headers: get_auth_headers(),
		body: JSON.stringify({ templateId: template_id })
	})
	if (!res.ok) throw new Error("Failed to load template")
}

// Spec API
export async function load_spec(project_id: string): Promise<string> {
	const project = await get_project(project_id)
	return project.custom_instructions || ""
}

export async function save_spec(project_id: string, spec: string): Promise<void> {
	await update_project(project_id, { custom_instructions: spec })
}

// Build config type (used by build_app and generate_production_html)
type BuildConfig = {
	fields: ContentField[]
	design: DesignField[]
	project_id?: string
	data_collections?: string[]
	project_name?: string
}

// Build API - compiles to static HTML with hydration and sends to server to save
export async function build_app(project_id: string): Promise<any> {
	// Import compiler dynamically to avoid SSR issues
	const { processCode } = await import('$lib/compiler/init')

	// Get source code and config using SDK
	const project = await get_project(project_id)
	const source_code = project.frontend_code || ''

	// Get list of data collections from project.data keys
	const data_collections = Object.keys(project.data || {})

	const config: BuildConfig = {
		fields: project.content || [],
		design: project.design || [],
		project_id,
		data_collections,
		project_name: project.name || 'tinykit App'
	}

	if (!source_code) {
		return ``
	}

	// Check if component has any JS (scripts)
	const has_js = source_code.includes('<script')

	// Build tinykit_modules for SSR (content/design/data inlined during server render)
	const content_obj = transform_content_fields(config.fields || [], project_id)

	// Transform design fields into key-value object (same format as $design import)
	const design_obj: Record<string, string> = {}
	for (const field of config.design || []) {
		design_obj[field.css_var] = field.value
	}

	// Compile the component with SSR (buildStatic: true)
	// This produces: { head, body, js } where body is pre-rendered HTML
	const result = await processCode({
		component: source_code,
		buildStatic: true,
		hydrated: has_js, // Include client bundle for hydration if there's JS
		runtime: has_js ? ['hydrate'] : [],
		tinykit_modules: {
			content: content_obj,
			design: design_obj,
			data: {} // Data is fetched client-side, empty for SSR
		}
	})

	if (result.error) {
		const error = new Error(result.error)
		throw error
	}

	if (!result.body) {
		throw new Error('SSR compilation produced no body output')
	}

	// Generate production HTML with pre-rendered content and hydration
	const html = generate_production_html({
		body: result.body,
		head: result.head || '',
		hydration_js: result.js, // Client bundle for hydration (may be empty if no JS)
		config
	})

	// Send to server to save (still needs server endpoint for file storage)
	const res = await fetch(`/api/projects/${project_id}/build`, {
		method: "POST",
		headers: get_auth_headers(),
		body: JSON.stringify({ html })
	})

	if (!res.ok) {
		const error_data = await res.json()
		throw new Error(error_data.error || "Failed to save build")
	}

	return res.json()
}

// System font patterns that don't need CDN loading
const SYSTEM_FONT_PATTERNS = [
	'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui',
	'helvetica', 'arial', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
	'ui-monospace', 'ui-sans-serif', 'ui-serif', 'ui-rounded',
	'georgia', 'cambria', 'times new roman', 'times', 'courier new', 'courier',
	'monaco', 'menlo', 'consolas', 'liberation mono', 'dejavu sans mono',
	'lucida console', 'sf mono', 'sfmono-regular'
]

function is_system_font(font_value: string): boolean {
	if (!font_value) return true
	const lower = font_value.toLowerCase()

	// Check if it's a system font stack (starts with system-ui or -apple-system)
	if (font_value.includes(',')) {
		const first_font = font_value.split(',')[0].trim().replace(/["']/g, '')
		if (first_font === 'system-ui' || first_font === '-apple-system') {
			return true
		}
	}

	for (const pattern of SYSTEM_FONT_PATTERNS) {
		if (lower === pattern) return true
	}
	return false
}

function generate_font_links(design_fields: DesignField[]): string {
	const fonts = new Set<string>()

	for (const field of design_fields) {
		if (field.type !== 'font') continue
		if (!field.value || is_system_font(field.value)) continue
		const font_name = field.value.trim().replace(/["']/g, '')
		if (font_name) fonts.add(font_name)
	}

	if (fonts.size === 0) return ''

	const font_params = Array.from(fonts)
		.map(font => `${font.toLowerCase().replace(/\s+/g, '-')}:400,500,600,700`)
		.join('|')

	return `<link rel="stylesheet" href="https://fonts.bunny.net/css?family=${encodeURIComponent(font_params)}&display=swap">`
}

type ProductionHtmlOptions = {
	body: string // Pre-rendered HTML from SSR
	head?: string // SSR head content (title, meta, etc.)
	hydration_js?: string // Client bundle for hydration (optional - may be empty for static-only)
	config: BuildConfig
}

function generate_production_html({ body, head = '', hydration_js, config }: ProductionHtmlOptions): string {
	// Transform content fields into key-value object
	const content_obj = transform_content_fields(config.fields || [], config.project_id || '')

	// Transform design fields into key-value object
	const design_obj: Record<string, string> = {}
	for (const field of config.design || []) {
		design_obj[field.css_var] = field.value
	}

	// Generate inline CSS from design fields
	const design_vars = (config.design || [])
		.map(field => `\t${field.css_var}: ${field.value};`)
		.join('\n')
	const design_css = design_vars ? `:root {\n${design_vars}\n}` : ':root {}'

	// Generate Bunny Fonts CDN links for any web fonts
	const font_links = generate_font_links(config.design || [])

	// Create data URLs for import map (needed for hydration)
	const content_module = `export default ${JSON.stringify(content_obj)}`
	const design_module = `export default ${JSON.stringify(design_obj)}`
	const content_url = `data:text/javascript,${encodeURIComponent(content_module)}`
	const design_url = `data:text/javascript,${encodeURIComponent(design_module)}`

	// Generate $data module
	const data_module = generate_data_module(config.project_id || '', config.data_collections || [])
	const data_url = `data:text/javascript,${encodeURIComponent(data_module)}`

	// Generate $tk module (tinykit utilities)
	const tinykit_module = generate_tinykit_module(config.project_id || '')
	const tinykit_url = `data:text/javascript,${encodeURIComponent(tinykit_module)}`

	// Build hydration script only if there's client JS
	// Escape </script> in the code to prevent breaking out of the script tag
	const escaped_js = hydration_js ? JSON.stringify(hydration_js).replace(/<\/script>/gi, '<\\/script>') : ''
	const hydration_script = hydration_js ? `
	<script type="module">
		// Hydrate the pre-rendered HTML with client-side interactivity
		const code = ${escaped_js};
		const blob = new Blob([code], { type: 'text/javascript' });
		const url = URL.createObjectURL(blob);

		try {
			const mod = await import(url);
			URL.revokeObjectURL(url);

			// Use hydrate() to attach event handlers to existing DOM
			mod.hydrate(mod.default, {
				target: document.getElementById('app')
			});
		} catch (e) {
			URL.revokeObjectURL(url);
			// Don't replace body on hydration error - static content still works
		}
	</script>` : ''

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${config.project_name || 'tinykit App'}</title>
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/modern-normalize@2.0.0/modern-normalize.min.css">
	${font_links}
	<style>${design_css}</style>
	${head}
	${hydration_js ? `<script type="importmap">
	{
		"imports": {
			"svelte": "https://esm.sh/svelte@5",
			"svelte/": "https://esm.sh/svelte@5/",
			"$content": "${content_url}",
			"$design": "${design_url}",
			"$data": "${data_url}",
			"$tinykit": "${tinykit_url}"
		}
	}
	</script>` : ''}
</head>
<body>
	<div id="app">${body}</div>${hydration_script}
</body>
</html>`
}

// Reset API
export async function reset_project(project_id: string): Promise<void> {
	// Save a snapshot before resetting so user can restore if needed
	await create_snapshot(project_id, 'Before reset')

	await update_project(project_id, {
		frontend_code: '',
		design: [],
		content: [],
		agent_chat: [],
		data: {}
	})
}

// Clear agent messages
export async function clear_messages(project_id: string): Promise<void> {
	await update_project(project_id, {
		agent_chat: []
	})
}

// Projects API - use project_service
export async function list_projects(): Promise<Project[]> {
	return project_service.list()
}

export async function create_project(data: {
	name: string
	domain: string
	description?: string
	template_id?: string
}): Promise<Project> {
	return project_service.create({
		name: data.name,
		domain: data.domain,
		initial_prompt: data.description
	})
}

export async function delete_project(project_id: string): Promise<void> {
	return project_service.delete(project_id)
}

// Get project details
export async function get_project_details(project_id: string): Promise<Project> {
	return get_project(project_id)
}

// Update project name
export async function update_project_name(project_id: string, name: string): Promise<void> {
	await update_project(project_id, { name })
}

// Settings
export async function load_settings(project_id: string): Promise<Project['settings']> {
	const project = await get_project(project_id)
	return project.settings || {}
}

export async function save_settings(project_id: string, settings: Project['settings']): Promise<void> {
	await update_project(project_id, { settings })
}

// Update specific settings (merges with existing)
export async function update_project_settings(project_id: string, updates: Partial<Project['settings']>): Promise<void> {
	const project = await get_project(project_id)
	await update_project(project_id, {
		settings: { ...project.settings, ...updates }
	})
}

// Assets API
export async function upload_asset(project_id: string, file: File): Promise<string> {
	const project = await get_project(project_id)
	const existing_assets = project.assets || []

	// Create FormData with the new file appended to existing assets
	const form_data = new FormData()
	form_data.append('assets', file)

	// Update project with new asset
	const updated = await pb.collection(COLLECTION).update<Project>(project_id, form_data)

	// Find the newly added filename (last one in array)
	const new_assets = updated.assets || []
	const new_filename = new_assets.find((f: string) => !existing_assets.includes(f)) || new_assets[new_assets.length - 1]

	// Return just the filename (use asset() helper in templates to get full URL)
	return new_filename
}

export async function list_assets(project_id: string): Promise<string[]> {
	const project = await get_project(project_id)
	return project.assets || []
}

// Convert a filename to a full asset URL (for admin UI previews)
export function asset_url(project_id: string, filename: string, thumb?: string): string {
	if (!filename) return ''
	// If it's already a full URL, return as-is
	if (filename.startsWith('http://') || filename.startsWith('https://')) {
		return filename
	}
	// Use path-based project_id so query params stay clean
	let url = `/_tk/assets/${project_id}/${filename}`
	if (thumb) url += `?thumb=${thumb}`
	return url
}

export async function delete_asset(project_id: string, filename: string): Promise<void> {
	const project = await get_project(project_id)
	const assets = (project.assets || []).filter((f: string) => f !== filename)
	await pb.collection(COLLECTION).update(project_id, { 'assets-': filename })
}
