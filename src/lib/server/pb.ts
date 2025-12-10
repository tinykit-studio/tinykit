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

// Get credentials from setup file or env vars
function getCredentials(): { email: string; password: string } | null {
	// First try to read from setup file
	try {
		if (fs.existsSync(SETUP_FILE)) {
			const data = fs.readFileSync(SETUP_FILE, 'utf-8')
			const setup = JSON.parse(data)
			if (setup.admin_email && setup.admin_password) {
				return { email: setup.admin_email, password: setup.admin_password }
			}
		}
	} catch (err) {
		// Fall through to env vars
	}

	// Fall back to env vars
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

	// Check for new credentials every 5 seconds if not authenticated
	const now = Date.now()
	if (!isAuthenticated && now - lastCredentialsCheck < 5000) {
		return false
	}
	lastCredentialsCheck = now

	const creds = getCredentials()
	if (!creds) {
		console.warn('[PB] No credentials available (server needs setup)')
		return false
	}

	try {
		// PocketBase 0.23+ uses _superusers collection for admin auth
		await pb.collection('_superusers').authWithPassword(creds.email, creds.password)
		isAuthenticated = true
		return true
	} catch (error: any) {
		// Don't throw - just log and return false
		// This allows the app to work before setup is complete
		console.warn('[PB] Auth failed (server may need setup):', error.message || error)
		isAuthenticated = false
		return false
	}
}

// Project type
export type Project = {
	id: string
	collectionId: string
	collectionName: string
	name: string
	domain: string
	frontend_code: string
	backend_code: string
	published_html: string // filename of the compiled HTML file attachment
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
	if (!authed) return null

	try {
		return await pb.collection('_tk_projects').getOne(id)
	} catch {
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
	domain: string
	frontend_code?: string
	design?: any[]
	content?: any[]
	initial_prompt?: string
}): Promise<Project | null> {
	const authed = await ensureAuth()
	if (!authed) return null

	const project_data: any = {
		name: data.name,
		domain: data.domain.toLowerCase(),
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

	// If there's an initial prompt, add it as first message
	if (data.initial_prompt) {
		project_data.agent_chat = [
			{
				role: 'user',
				content: data.initial_prompt
			}
		]
	}

	return await pb.collection('_tk_projects').create(project_data)
}

/**
 * Update project fields
 */
export async function updateProject(projectId: string, data: any): Promise<Project | null> {
	const authed = await ensureAuth()
	if (!authed) {
		throw new Error('Server not authenticated to Pocketbase. Check POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD env vars.')
	}

	// Guard against accidentally clearing frontend_code
	if ('frontend_code' in data) {
		const codeLength = data.frontend_code?.length || 0
		if (codeLength === 0) {
			const { frontend_code, ...rest } = data
			if (Object.keys(rest).length > 0) {
				return await pb.collection('_tk_projects').update(projectId, rest)
			}
			return null
		}
	}

	return await pb.collection('_tk_projects').update(projectId, data)
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
export async function createSnapshot(projectId: string, description: string) {
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
	provider: 'openai' | 'anthropic' | 'gemini' | 'zai' | 'ollama'
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
