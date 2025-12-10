// API client functions for tinykit admin interface
// This version uses the Pocketbase SDK directly for authenticated access

import { pb } from '$lib/pocketbase.svelte'
import { project_service } from '$lib/services/project.svelte'
import type {
	Project,
	Message,
	FileTreeItem,
	ApiEndpoint,
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
// Set force=true to allow intentional clearing of frontend_code (e.g., reset)
async function update_project(project_id: string, data: Partial<Project>, force = false): Promise<Project> {
	// Guard against accidentally clearing frontend_code (unless force=true)
	if ('frontend_code' in data && !force) {
		const codeLength = (data.frontend_code as string)?.length || 0
		if (codeLength === 0) {
			// Remove frontend_code from the update
			const { frontend_code, ...rest } = data
			if (Object.keys(rest).length > 0) {
				return await pb.collection(COLLECTION).update<Project>(project_id, rest)
			}
			// Nothing to update
			return await pb.collection(COLLECTION).getOne<Project>(project_id)
		}
	}
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

// Code API - tinykit stores code in project.frontend_code (App.svelte)
export async function read_code(project_id: string): Promise<string> {
	const project = await get_project(project_id)
	return project.frontend_code || ''
}

export async function write_code(project_id: string, content: string): Promise<void> {
	if (!content) throw new Error('Cannot write empty code')
	await update_project(project_id, { frontend_code: content })
}

// Agent/Chat API
// Note: The actual LLM call still goes through the server endpoint (for API key security)
// This just manages the chat history storage
export async function send_prompt(
	project_id: string,
	messages: Message[],
	spec_content?: string
): Promise<Response> {
	// The agent endpoint still needs to be server-side for LLM API keys
	const body: any = {
		messages,
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

export async function load_messages(project_id: string): Promise<Message[]> {
	const project = await get_project(project_id)
	return project.agent_chat || []
}

export async function save_messages(project_id: string, messages: Message[]): Promise<void> {
	await update_project(project_id, { agent_chat: messages })
}

export async function clear_conversation(project_id: string): Promise<void> {
	await update_project(project_id, { agent_chat: [] })
}

// Config API
export type ConfigResponse = {
	env: Record<string, string>
	endpoints: ApiEndpoint[]
	fields: ContentField[]
	design: DesignField[]
}

export async function load_config(project_id: string): Promise<ConfigResponse> {
	const project = await get_project(project_id)
	return {
		env: {}, // env vars not stored in project currently
		endpoints: [], // endpoints not stored in project currently
		fields: project.content || [],
		design: project.design || []
	}
}

export async function update_config_section(
	project_id: string,
	section: "env" | "endpoints" | "fields" | "design",
	data: any
): Promise<void> {
	if (section === "fields") {
		await update_project(project_id, { content: data })
	} else if (section === "design") {
		await update_project(project_id, { design: data })
	}
	// env and endpoints not currently stored in project
}

export async function add_env_var(project_id: string, key: string, value: string): Promise<void> {
	// Not implemented - env vars not stored in project
}

export async function delete_env_var(project_id: string, key: string): Promise<void> {
	// Not implemented - env vars not stored in project
}

export async function add_endpoint(project_id: string, endpoint: Omit<ApiEndpoint, "id">): Promise<void> {
	// Not implemented - endpoints not stored in project
}

export async function delete_endpoint(project_id: string, id: string): Promise<void> {
	// Not implemented - endpoints not stored in project
}

export async function add_content_field(project_id: string, field: Omit<ContentField, "id">): Promise<void> {
	const project = await get_project(project_id)
	const fields = project.content || []
	const new_field = {
		...field,
		id: crypto.randomUUID()
	}
	fields.push(new_field)
	await update_project(project_id, { content: fields })
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

export async function add_design_field(project_id: string, field: Omit<DesignField, "id">): Promise<void> {
	const project = await get_project(project_id)
	const design = project.design || []
	const new_field = {
		...field,
		id: crypto.randomUUID()
	}
	design.push(new_field)
	await update_project(project_id, { design })
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

export async function load_custom_field_types(): Promise<any[]> {
	// This still needs server endpoint for now (reads from filesystem)
	const res = await fetch("/api/symbols?type=field", {
		headers: get_auth_headers()
	})
	if (!res.ok) throw new Error("Failed to load custom field types")
	const data = await res.json()
	return data.symbols || []
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

// Build API - compiles to static HTML with hydration and sends to server to save
export async function build_app(project_id: string): Promise<any> {
	// Import compiler dynamically to avoid SSR issues
	const { processCode } = await import('$lib/compiler/init')

	// Get source code and config using SDK
	const project = await get_project(project_id)
	const source_code = project.frontend_code || ''

	// Get list of data collections from project.data keys
	const data_collections = Object.keys(project.data || {})

	const config: ConfigResponse & { project_id: string, data_collections: string[], project_name: string } = {
		env: {},
		endpoints: [],
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
	const slugify = (text: string) => text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '')

	// Transform content fields into key-value object (same format as $content import)
	const content_obj: Record<string, any> = {}
	for (const field of config.fields || []) {
		const key = slugify(field.name)
		content_obj[key] = field.value
	}

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
	config: ConfigResponse & { project_id?: string, data_collections?: string[], project_name?: string }
}

function generate_production_html({ body, head = '', hydration_js, config }: ProductionHtmlOptions): string {
	const slugify = (text: string) => text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '')

	// Transform content fields into key-value object
	const content_obj: Record<string, any> = {}
	for (const field of config.fields || []) {
		const key = slugify(field.name)
		content_obj[key] = field.value
	}

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
	const tinykit_module = generate_tinykit_module()
	const tinykit_url = `data:text/javascript,${encodeURIComponent(tinykit_module)}`

	// Build hydration script only if there's client JS
	const hydration_script = hydration_js ? `
	<script type="module">
		// Hydrate the pre-rendered HTML with client-side interactivity
		const code = ${JSON.stringify(hydration_js)};
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
	${head}
	<style>${design_css}</style>
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

/**
 * Generate the $data module code
 * This creates a db object with collection accessors that proxy to the /_tk/data API
 * Includes realtime subscription support via PocketBase
 */
function generate_data_module(project_id: string, collections: string[]): string {
	// Generate collection entries
	const collection_entries = collections
		.map(name => `  ${name}: create_collection('${name}')`)
		.join(',\n')

	return `
const PROJECT_ID = '${project_id}'
const API_BASE = '/_tk/data'

// Global registry for realtime updates
const _collections = {}

function create_collection(name) {
  const base_url = \`\${API_BASE}/\${PROJECT_ID}/\${name}\`
  let subscribers = []
  let cache = null
  let last_params = null
  let mutation_cooldown = 0 // Timestamp until which we ignore external updates

  // Compare two record arrays for equality (by JSON serialization)
  function records_equal(a, b) {
    if (!a || !b) return false
    if (a.length !== b.length) return false
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch (e) {
      return false
    }
  }

  const collection = {
    // Notify all subscribers with new data (skip if unchanged or in cooldown)
    _notify(records, force = false) {
      // During cooldown period, ignore external updates (SSE/realtime)
      // This prevents re-renders when our own mutations echo back
      if (!force && Date.now() < mutation_cooldown) {
        return
      }
      if (!force && records_equal(cache, records)) {
        return // Skip notification if data hasn't changed
      }
      cache = records
      for (const cb of subscribers) {
        try { cb(records) } catch (e) { console.error('[db] subscriber error:', e) }
      }
    },

    // Set a cooldown period during which external updates are ignored
    _set_cooldown(ms = 500) {
      mutation_cooldown = Date.now() + ms
    },

    // Refresh cache from server and notify
    async _refresh() {
      try {
        await collection.list(last_params || {})
      } catch (e) {
        console.error('[db] refresh error:', e)
      }
    },

    async list(params = {}) {
      last_params = params
      const query = new URLSearchParams()
      if (params.filter) query.set('filter', params.filter)
      if (params.sort) query.set('sort', params.sort)
      if (params.page) query.set('page', String(params.page))
      if (params.perPage) query.set('perPage', String(params.perPage))
      if (params.expand) query.set('expand', params.expand)

      const res = await fetch(\`\${base_url}?\${query}\`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      const items = data.items || []
      // Update cache silently - don't notify subscribers
      // Notifications come from: subscribe() initial load, mutations, external events
      cache = items
      return items
    },

    async get(id, params = {}) {
      const query = new URLSearchParams()
      if (params.expand) query.set('expand', params.expand)

      const res = await fetch(\`\${base_url}/\${id}?\${query}\`)
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },

    async create(data) {
      const res = await fetch(base_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      if (!res.ok) throw new Error(await res.text())
      const record = await res.json()
      // Set cooldown to ignore echo from our own mutation
      collection._set_cooldown(500)
      // Optimistically update local cache
      if (cache) {
        cache = [...cache, record]
        collection._notify(cache, true)
      }
      return record
    },

    async update(id, data) {
      // Set cooldown to ignore echo from our own mutation
      collection._set_cooldown(500)
      // Optimistically update local cache first (before server roundtrip)
      if (cache) {
        const idx = cache.findIndex(r => r.id === id)
        if (idx !== -1) {
          cache = cache.map(r => r.id === id ? { ...r, ...data, updated: new Date().toISOString() } : r)
          collection._notify(cache, true)
        }
      }
      const res = await fetch(\`\${base_url}/\${id}\`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },

    async delete(id) {
      // Set cooldown to ignore echo from our own mutation
      collection._set_cooldown(500)
      // Optimistically update local cache first
      if (cache) {
        cache = cache.filter(r => r.id !== id)
        collection._notify(cache, true)
      }
      const res = await fetch(\`\${base_url}/\${id}\`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      return true
    },

    /**
     * Subscribe to realtime updates for this collection
     * @param {function} callback - Called with array of records on each update
     * @param {object} params - Optional list params (filter, sort, etc.)
     * @returns {function} Unsubscribe function
     */
    subscribe(callback, params = {}) {
      subscribers.push(callback)
      last_params = params

      // Initial fetch - explicitly notify this subscriber
      collection.list(params)
        .then(items => callback(items))
        .catch(e => console.error('[db] initial fetch error:', e))

      // Return unsubscribe function
      return () => {
        const idx = subscribers.indexOf(callback)
        if (idx > -1) subscribers.splice(idx, 1)
      }
    }
  }

  // Register in global registry
  _collections[name] = collection
  return collection
}

// Handle realtime updates (called by PB subscription)
if (typeof window !== 'undefined') {
  window.__tk_update_data = (all_data) => {
    for (const [name, collection] of Object.entries(_collections)) {
      if (all_data[name]) {
        const records = all_data[name].records || all_data[name] || []
        collection._notify(Array.isArray(records) ? records : [])
      }
    }
  }

  // Production mode: connect to SSE endpoint for realtime
  const sse = new EventSource('/_tk/realtime/' + PROJECT_ID)

  sse.addEventListener('data_updated', (e) => {
    try {
      const data = JSON.parse(e.data)
      window.__tk_update_data(data)
    } catch (err) {
      console.warn('[db] Failed to parse realtime data:', err)
    }
  })

  sse.addEventListener('error', () => {
    console.warn('[db] SSE connection error, will retry...')
  })
}

const db = {
${collection_entries}
}

export default db
`.trim()
}

/**
 * Generate the $tk module code (tinykit utilities)
 */
function generate_tinykit_module(): string {
	return `
export async function proxy(url, options = {}) {
  const proxy_url = '/api/proxy?url=' + encodeURIComponent(url)
  return fetch(proxy_url, options)
}
proxy.json = async function(url) {
  const response = await proxy(url)
  if (!response.ok) throw new Error('Failed to fetch: ' + response.status)
  return response.json()
}
proxy.text = async function(url) {
  const response = await proxy(url)
  if (!response.ok) throw new Error('Failed to fetch: ' + response.status)
  return response.text()
}
proxy.url = function(url) {
  return '/api/proxy?url=' + encodeURIComponent(url)
}
`.trim()
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
	}, true) // force=true to allow clearing frontend_code
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
