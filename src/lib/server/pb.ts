/**
 * Pocketbase superuser client
 * This client has full access to all collections and bypasses collection rules.
 * Use this for server-side operations where you handle auth/permissions yourself.
 */

import PocketBase from 'pocketbase'
import { env } from '$env/dynamic/private'
import * as fs from 'fs'

const PB_URL = env.POCKETBASE_URL || 'http://127.0.0.1:8091'
const SETUP_FILE = './pocketbase/pb_data/.setup_complete'

// Create singleton PB client
export const pb = new PocketBase(PB_URL)

// Disable auto cancellation for concurrent requests
pb.autoCancellation(false)

// Initialize admin auth
let isAuthenticated = false
let lastCredentialsCheck = 0

// Get auth token from setup file or credentials from env vars
function getAuthConfig(): { token: string } | { email: string; password: string } | null {
	// First try to load from setup file
	try {
		if (fs.existsSync(SETUP_FILE)) {
			const data = fs.readFileSync(SETUP_FILE, 'utf-8')
			const setup = JSON.parse(data)

			// Prefer auth token (new format)
			if (setup.auth_token) {
				return { token: setup.auth_token }
			}

			// Fall back to password (legacy format) - will migrate to token on success
			if (setup.admin_email && setup.admin_password) {
				return { email: setup.admin_email, password: setup.admin_password }
			}
		}
	} catch (err) {
		// Fall through to env vars
	}

	// Fall back to env vars (for manual configuration)
	const email = env.POCKETBASE_ADMIN_EMAIL
	const password = env.POCKETBASE_ADMIN_PASSWORD
	if (email && password) {
		return { email, password }
	}

	return null
}

async function ensureAuth(): Promise<boolean> {
	// If already authenticated with valid token, return true
	if (isAuthenticated && pb.authStore.isValid) {
		return true
	}

	// If token expired, clear state and re-authenticate
	if (isAuthenticated && !pb.authStore.isValid) {
		console.log('[PB] Auth token expired, re-authenticating...')
		isAuthenticated = false
	}

	// Check for new config every 5 seconds if not authenticated
	const now = Date.now()
	if (!isAuthenticated && now - lastCredentialsCheck < 5000) {
		return false
	}
	lastCredentialsCheck = now

	const config = getAuthConfig()
	if (!config) {
		console.warn('[PB] No auth config available (server needs setup)')
		return false
	}

	try {
		if ('token' in config) {
			// Use saved token - restore it to authStore
			pb.authStore.save(config.token, null)

			// Validate and refresh the token
			try {
				await pb.collection('_superusers').authRefresh()
				isAuthenticated = true
				console.log('[PB] Server authenticated via saved token')

				// Save refreshed token back to file
				saveRefreshedToken(pb.authStore.token)
				return true
			} catch {
				// Token invalid/expired, can't refresh without password
				console.warn('[PB] Saved token invalid, need fresh setup or env vars')
				pb.authStore.clear()
				return false
			}
		} else {
			// Use email/password (from env vars or legacy setup file)
			await pb.collection('_superusers').authWithPassword(config.email, config.password)
			isAuthenticated = true
			console.log('[PB] Server authenticated via credentials')

			// Migrate to token-based auth (save token, remove password from file)
			saveRefreshedToken(pb.authStore.token)
			return true
		}
	} catch (error: any) {
		console.error('[PB] Auth failed:', error.message || error)
		isAuthenticated = false
		return false
	}
}

// Save refreshed token back to setup file (and remove password if present)
function saveRefreshedToken(token: string): void {
	try {
		if (!fs.existsSync(SETUP_FILE)) return

		const data = fs.readFileSync(SETUP_FILE, 'utf-8')
		const setup = JSON.parse(data)

		// Update token
		setup.auth_token = token

		// Remove password if present (migration from legacy format)
		if (setup.admin_password) {
			delete setup.admin_password
			console.log('[PB] Migrated from password to token-based auth')
		}

		fs.writeFileSync(SETUP_FILE, JSON.stringify(setup), { mode: 0o600 })
	} catch {
		// Silently fail - not critical
	}
}

// Project type
export type Project = {
	id: string
	collectionId: string
	collectionName: string
	name: string
	domain: string
	kit: string
	frontend_code: string
	backend_code: string
	published_html: string // filename of the compiled HTML file attachment
	assets: string[] // filenames of uploaded assets
	design: any[]
	content: any[]
	snapshots: any[]
	agent_chat: any[]
	custom_instructions: string
	data: Record<string, any>
	settings: Record<string, any>
	created: string
	updated: string
}

/**
 * Check if the server setup is complete (marker file exists)
 */
export async function isSetupComplete(): Promise<boolean> {
	try {
		const fs = await import('fs/promises')
		await fs.access('./pocketbase/pb_data/.setup_complete')
		return true
	} catch {
		return false
	}
}

/**
 * List all projects
 * Note: PocketBase 0.23.8 has issues with sorting by created/updated fields,
 * so we fetch without sorting and sort in JS
 */
export async function listProjects(): Promise<Project[]> {
	const authed = await ensureAuth()
	if (!authed) return []

	const records = await pb.collection('_tk_projects').getList(1, 500)
	// Sort by updated date descending (newest first) in JS since PB sort has issues
	const items = records.items as unknown as Project[]
	return items.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
}

/**
 * Get a project by ID
 */
export async function getProject(id: string): Promise<Project | null> {
	const authed = await ensureAuth()
	if (!authed) {
		console.error(`[PB] Cannot get project ${id}: Server auth not available`)
		return null
	}

	try {
		return await pb.collection('_tk_projects').getOne(id)
	} catch (err: any) {
		console.error(`[PB] Failed to get project ${id}:`, err?.message || err)
		return null
	}
}

/**
 * Get a project by domain
 * Returns null if no project matches the domain
 */
export async function getProjectByDomain(domain: string): Promise<Project | null> {
	const authed = await ensureAuth()
	if (!authed) return null

	try {
		// Normalize domain (lowercase, no trailing slashes)
		const normalized = domain.toLowerCase().replace(/\/$/, '')
		const result = await pb.collection('_tk_projects').getFirstListItem(
			`domain = "${normalized}"`
		)
		return result as unknown as Project
	} catch (error: any) {
		// getFirstListItem throws if no match found
		if (error?.status === 404) {
			return null
		}
		return null
	}
}


/**
 * Create a new project
 */
export async function createProject(data: {
	name: string
	domain?: string
	kit?: string
	frontend_code?: string
	design?: any[]
	content?: any[]
	initial_prompt?: string
}): Promise<Project | null> {
	const authed = await ensureAuth()
	if (!authed) return null

	const project_data: any = {
		name: data.name,
		domain: data.domain?.toLowerCase() || '',
		kit: data.kit || 'custom',
		frontend_code: data.frontend_code || '',
		backend_code: '',
		design: data.design || [],
		content: data.content || [],
		snapshots: [],
		agent_chat: [],
		custom_instructions: '',
		data: {},
		settings: {
			vibe_zone_enabled: false,
			project_title: data.name
		}
	}

	// Note: initial_prompt is NOT added to agent_chat here
	// The server adds user messages when send_prompt is called
	// The initial_prompt is passed to the studio page to trigger the first message

	return await pb.collection('_tk_projects').create(project_data)
}

// Queue updates per project to prevent race conditions (read-modify-write cycles)
const updateQueues = new Map<string, Promise<any>>()

// Separate locks for atomic read-modify-write operations
const projectLocks = new Map<string, Promise<any>>()

/**
 * Update project fields
 */
export async function updateProject(projectId: string, data: any): Promise<Project | null> {
	const authed = await ensureAuth()
	if (!authed) {
		throw new Error('Server not authenticated to Pocketbase. Check POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD env vars.')
	}



	// Queue updates for this project to prevent race conditions
	const prev = updateQueues.get(projectId) || Promise.resolve()

	const task = prev.catch(() => { }).then(async () => {
		return await pb.collection('_tk_projects').update(projectId, data) as unknown as Project
	})

	updateQueues.set(projectId, task)

	// Clean up queue map when done to prevent memory leaks
	task.finally(() => {
		if (updateQueues.get(projectId) === task) {
			updateQueues.delete(projectId)
		}
	})

	return task
}

/**
 * Delete a project
 */
export async function deleteProject(projectId: string): Promise<boolean> {
	const authed = await ensureAuth()
	if (!authed) return false

	await pb.collection('_tk_projects').delete(projectId)
	return true
}

/**
 * Create a snapshot of current project state
 */
export async function createSnapshot(projectId: string, description: string, tools?: string[]) {
	const project = await getProject(projectId)
	if (!project) return null

	const snapshots = project.snapshots || []

	// Extract collection schemas from project.data
	const collections: Array<{ name: string; schema: Array<{ name: string; type: string }> }> = []
	if (project.data && typeof project.data === 'object') {
		for (const [name, value] of Object.entries(project.data)) {
			if (value && typeof value === 'object' && 'schema' in value) {
				collections.push({
					name,
					schema: (value as any).schema || []
				})
			}
		}
	}

	const snapshot = {
		id: `snap_${Date.now()}`,
		timestamp: Date.now(),
		description,
		tools,
		frontend_code: project.frontend_code || '',
		design: project.design || [],
		content: project.content || [],
		collections
	}

	// Add to beginning (most recent first), keep last 50
	snapshots.unshift(snapshot)
	const trimmed = snapshots.slice(0, 50)

	await updateProject(project.id, { snapshots: trimmed })
	return snapshot
}

/**
 * Restore a snapshot
 */
export async function restoreSnapshot(projectId: string, snapshotId: string) {
	const project = await getProject(projectId)
	if (!project) return null

	const snapshot = project.snapshots?.find((s: any) => s.id === snapshotId)

	if (!snapshot) {
		throw new Error('Snapshot not found')
	}

	// Build updated data with restored collection schemas
	const updated_data = { ...project.data }
	if (snapshot.collections && Array.isArray(snapshot.collections)) {
		for (const col of snapshot.collections) {
			if (updated_data[col.name]) {
				// Collection exists - restore schema, keep existing records
				updated_data[col.name] = {
					...updated_data[col.name],
					schema: col.schema
				}
			} else {
				// Collection was deleted - recreate with empty records
				updated_data[col.name] = {
					schema: col.schema,
					records: []
				}
			}
		}
	}

	await updateProject(projectId, {
		frontend_code: snapshot.frontend_code,
		design: snapshot.design,
		content: snapshot.content,
		data: updated_data
	})

	return snapshot
}

/**
 * Delete a snapshot
 */
export async function deleteSnapshot(projectId: string, snapshotId: string) {
	const project = await getProject(projectId)
	if (!project) return

	const snapshots = (project.snapshots || []).filter((s: any) => s.id !== snapshotId)
	await updateProject(projectId, { snapshots })
}

/**
 * LLM configuration type
 */
export interface LLMSettings {
	provider: 'openai' | 'anthropic' | 'gemini'
	api_key: string
	model: string
	base_url?: string
}

/**
 * Get LLM settings - checks env vars first, then falls back to database
 * Env vars: LLM_API_KEY, LLM_PROVIDER, LLM_MODEL, LLM_BASE_URL
 */
/**
 * Validate a user auth token from Authorization header
 * Returns the user record if valid, null if invalid
 */
export async function validateUserToken(request: Request): Promise<{ id: string; email: string } | null> {
	const auth_header = request.headers.get('Authorization')
	if (!auth_header?.startsWith('Bearer ')) {
		return null
	}

	const token = auth_header.slice(7)
	if (!token) {
		return null
	}

	try {
		// Create a temporary PB client to validate the user token
		const user_pb = new PocketBase(PB_URL)
		user_pb.authStore.save(token, null)

		// Try to refresh - this validates the token and returns user data
		const auth_data = await user_pb.collection('users').authRefresh()
		return {
			id: auth_data.record.id,
			email: auth_data.record.email
		}
	} catch {
		return null
	}
}

/**
 * Helper to return 401 response
 */
export function unauthorizedResponse(message = 'Unauthorized') {
	return new Response(JSON.stringify({ error: message }), {
		status: 401,
		headers: { 'Content-Type': 'application/json' }
	})
}

/**
 * Get LLM settings - checks env vars first, then falls back to database
 * Env vars: LLM_API_KEY, LLM_PROVIDER, LLM_MODEL, LLM_BASE_URL
 */
export async function getLLMSettings(): Promise<LLMSettings | null> {
	// Check env vars first (for users who prefer not to store keys in DB)
	if (env.LLM_API_KEY) {
		return {
			provider: (env.LLM_PROVIDER as LLMSettings['provider']) || 'anthropic',
			api_key: env.LLM_API_KEY,
			model: env.LLM_MODEL || 'claude-sonnet-4-20250514',
			base_url: env.LLM_BASE_URL || undefined
		}
	}

	// Fall back to database settings
	const authed = await ensureAuth()
	if (!authed) return null

	try {
		const record = await pb.collection('_tk_settings').getOne('llm')
		if (record?.value) {
			return record.value as LLMSettings
		}
	} catch {
		// 404 or other error - no settings configured
	}
	return null
}

/**
 * Helper to run an atomic read-modify-write operation on a project.
 * This ensures that concurrent operations don't overwrite each other.
 */
async function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
	// Wait for any existing lock on this project
	const prev = projectLocks.get(projectId) || Promise.resolve()

	const task = prev.catch(() => {}).then(fn)

	projectLocks.set(projectId, task)

	// Clean up when done
	task.finally(() => {
		if (projectLocks.get(projectId) === task) {
			projectLocks.delete(projectId)
		}
	})

	return task
}

/**
 * Atomically add a content field to a project.
 * Returns the created field or null if it already exists.
 */
export async function addContentField(
	projectId: string,
	field: { name: string; type: string; value: any; description?: string }
): Promise<{ id: string; name: string; type: string; value: any; description: string } | null> {
	return withProjectLock(projectId, async () => {
		const project = await getProject(projectId)
		if (!project) throw new Error('Project not found')

		const fields = [...(project.content || [])]

		// Check for duplicates by name
		if (fields.find((f: any) => f.name === field.name)) {
			return null // Already exists
		}

		const new_field = {
			id: crypto.randomUUID().slice(0, 5),
			name: field.name,
			type: field.type,
			value: field.type === 'boolean' ? field.value === 'true' || field.value === true : field.value,
			description: field.description || ''
		}

		fields.push(new_field)
		await updateProject(projectId, { content: fields })
		return new_field
	})
}

/**
 * Atomically add a design field to a project.
 * Returns the created field or null if it already exists.
 */
export async function addDesignField(
	projectId: string,
	field: { name: string; css_var: string; type: string; value: string; description?: string }
): Promise<{ id: string; name: string; css_var: string; type: string; value: string; description: string; unit?: string; min?: number; max?: number } | null> {
	return withProjectLock(projectId, async () => {
		const project = await getProject(projectId)
		if (!project) throw new Error('Project not found')

		const design = [...(project.design || [])]

		// Check for duplicates by css_var
		if (design.find((f: any) => f.css_var === field.css_var)) {
			return null // Already exists
		}

		const new_field: any = {
			id: crypto.randomUUID().slice(0, 5),
			name: field.name,
			css_var: field.css_var,
			value: field.value,
			type: field.type,
			description: field.description || ''
		}

		if (field.type === 'size' || field.type === 'radius') {
			new_field.unit = 'px'
			if (field.type === 'radius') {
				new_field.min = 0
				new_field.max = 50
			}
		}

		design.push(new_field)
		await updateProject(projectId, { design })
		return new_field
	})
}

/**
 * Atomically add a data collection to a project.
 * Returns success message or error if collection exists.
 */
export async function addDataCollection(
	projectId: string,
	collection: {
		filename: string
		schema: Array<{ name: string; type: string }>
		records: any[]
		icon?: string
	}
): Promise<{ success: boolean; message: string; records_count?: number }> {
	return withProjectLock(projectId, async () => {
		const project = await getProject(projectId)
		if (!project) throw new Error('Project not found')

		const current_data = { ...(project.data || {}) }

		if (current_data[collection.filename]) {
			return { success: false, message: `Collection "${collection.filename}" already exists` }
		}

		// Ensure id column exists at the beginning
		let schema = [...collection.schema]
		const has_id = schema.some(col => col.name === 'id')
		if (!has_id) {
			schema.unshift({ name: 'id', type: 'id' })
		} else {
			schema = schema.filter(col => col.name !== 'id')
			schema.unshift({ name: 'id', type: 'id' })
		}

		// Add IDs to records if not provided
		const now = new Date().toISOString()
		const records_with_ids = collection.records.map(r => ({
			id: r.id || crypto.randomUUID().slice(0, 5),
			...r,
			created: r.created || now,
			updated: r.updated || now
		}))

		current_data[collection.filename] = {
			schema,
			records: records_with_ids,
			icon: collection.icon
		}

		await updateProject(projectId, { data: current_data })
		return {
			success: true,
			message: `Created collection "${collection.filename}" with ${collection.records.length} records`,
			records_count: collection.records.length
		}
	})
}

/**
 * Atomically insert records into an existing collection.
 */
export async function insertDataRecords(
	projectId: string,
	collectionName: string,
	records: any[]
): Promise<{ success: boolean; message: string }> {
	return withProjectLock(projectId, async () => {
		const project = await getProject(projectId)
		if (!project) throw new Error('Project not found')

		const current_data = { ...(project.data || {}) }

		if (!current_data[collectionName]) {
			return { success: false, message: `Collection "${collectionName}" does not exist` }
		}

		const now = new Date().toISOString()
		const new_records_with_ids = records.map(r => ({
			id: r.id || crypto.randomUUID().slice(0, 5),
			...r,
			created: r.created || now,
			updated: r.updated || now
		}))

		const collection_data = current_data[collectionName]
		const existing = Array.isArray(collection_data) ? collection_data : (collection_data.records || [])
		const all_records = [...existing, ...new_records_with_ids]

		current_data[collectionName] = {
			schema: collection_data.schema || [],
			records: all_records,
			icon: collection_data.icon
		}

		await updateProject(projectId, { data: current_data })
		return { success: true, message: `Inserted ${records.length} records into "${collectionName}"` }
	})
}

// ==========================================
// Available domains tracking
// ==========================================

type AvailableDomain = {
	hostname: string
	first_seen: string
	last_seen: string
}

/**
 * Track an incoming hostname as available (not assigned to any project)
 * Ignores localhost and common dev domains
 */
export async function trackAvailableDomain(hostname: string): Promise<void> {
	// Skip localhost and dev domains
	if (
		hostname === 'localhost' ||
		hostname.startsWith('localhost:') ||
		hostname.startsWith('127.0.0.1') ||
		hostname.endsWith('.local')
	) {
		return
	}

	const authed = await ensureAuth()
	if (!authed) return

	try {
		// Get current available domains
		let record: any
		try {
			record = await pb.collection('_tk_settings').getOne('available_domains')
		} catch {
			// Create if doesn't exist
			record = await pb.collection('_tk_settings').create({
				id: 'available_domains',
				value: { domains: [] }
			})
		}

		const domains: AvailableDomain[] = record?.value?.domains || []
		const now = new Date().toISOString()

		// Check if already tracked
		const existing = domains.find(d => d.hostname === hostname)
		if (existing) {
			// Update last_seen
			existing.last_seen = now
		} else {
			// Add new
			domains.push({
				hostname,
				first_seen: now,
				last_seen: now
			})
		}

		// Keep only last 50 domains, sorted by last_seen
		const trimmed = domains
			.sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime())
			.slice(0, 50)

		await pb.collection('_tk_settings').update('available_domains', {
			value: { domains: trimmed }
		})
	} catch (err) {
		// Silently fail - tracking is best-effort
		console.warn('[PB] Failed to track available domain:', err)
	}
}

/**
 * Get list of available domains (not assigned to any project)
 */
export async function getAvailableDomains(): Promise<AvailableDomain[]> {
	const authed = await ensureAuth()
	if (!authed) return []

	try {
		const record = await pb.collection('_tk_settings').getOne('available_domains')
		const domains: AvailableDomain[] = record?.value?.domains || []

		// Filter out domains that are now assigned to projects
		const projects = await listProjects()
		const assigned = new Set(projects.map(p => p.domain).filter(Boolean))

		return domains.filter(d => !assigned.has(d.hostname))
	} catch {
		return []
	}
}

/**
 * Remove a domain from available list (when assigned to a project)
 */
export async function removeAvailableDomain(hostname: string): Promise<void> {
	const authed = await ensureAuth()
	if (!authed) return

	try {
		const record = await pb.collection('_tk_settings').getOne('available_domains')
		const domains: AvailableDomain[] = record?.value?.domains || []

		const filtered = domains.filter(d => d.hostname !== hostname)

		await pb.collection('_tk_settings').update('available_domains', {
			value: { domains: filtered }
		})
	} catch {
		// Silently fail
	}
}
