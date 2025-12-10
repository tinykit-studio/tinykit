/**
 * PocketBase management - startup, health checks, superuser creation
 */

import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { env } from '$env/dynamic/private'

const PB_DIR = join(process.cwd(), 'pocketbase')
const PB_BINARY = join(PB_DIR, process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase')
const PB_DATA_DIR = join(process.cwd(), env.WORKSPACE_DIR || './workspace', 'pb_data')
const PB_PORT = 8091

let pbProcess: ChildProcess | null = null

export function getPocketbaseUrl(): string {
	return env.POCKETBASE_URL || `http://127.0.0.1:${PB_PORT}`
}

export async function startPocketbase(): Promise<boolean> {
	// Check if using external PocketBase
	if (env.POCKETBASE_URL) {
		console.log(`Using external PocketBase at ${env.POCKETBASE_URL}`)
		return await waitForPocketbase()
	}

	// Check if binary exists
	if (!existsSync(PB_BINARY)) {
		console.error('PocketBase binary not found. Run: npm run pocketbase:download')
		return false
	}

	// Check if already running
	if (await isPocketbaseRunning()) {
		console.log('PocketBase already running')
		await ensureSuperuser()
		return true
	}

	console.log('Starting PocketBase...')

	pbProcess = spawn(PB_BINARY, ['serve', '--http', `127.0.0.1:${PB_PORT}`, '--dir', PB_DATA_DIR], {
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: false
	})

	pbProcess.stdout?.on('data', (data) => {
		const msg = data.toString().trim()
		if (msg) console.log(`[PocketBase] ${msg}`)
	})

	pbProcess.stderr?.on('data', (data) => {
		const msg = data.toString().trim()
		if (msg) console.error(`[PocketBase] ${msg}`)
	})

	pbProcess.on('exit', (code) => {
		console.log(`PocketBase exited with code ${code}`)
		pbProcess = null
	})

	// Wait for PocketBase to be ready
	const ready = await waitForPocketbase()
	if (ready) {
		await ensureSuperuser()
	}
	return ready
}

async function waitForPocketbase(maxAttempts = 30): Promise<boolean> {
	const url = getPocketbaseUrl()

	for (let i = 0; i < maxAttempts; i++) {
		try {
			const response = await fetch(`${url}/api/health`)
			if (response.ok) {
				console.log('PocketBase is ready')
				return true
			}
		} catch {
			// Not ready yet
		}
		await new Promise(resolve => setTimeout(resolve, 200))
	}

	console.error('PocketBase failed to start')
	return false
}

async function isPocketbaseRunning(): Promise<boolean> {
	try {
		const response = await fetch(`${getPocketbaseUrl()}/api/health`)
		return response.ok
	} catch {
		return false
	}
}

async function ensureSuperuser(): Promise<void> {
	const password = env.ADMIN_PASSWORD
	if (!password) {
		console.log('No ADMIN_PASSWORD set - skipping superuser creation')
		return
	}

	const email = 'admin@localhost'
	const url = getPocketbaseUrl()

	try {
		// Check if superuser already exists by trying to auth
		const authResponse = await fetch(`${url}/api/admins/auth-with-password`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ identity: email, password })
		})

		if (authResponse.ok) {
			console.log('Superuser already configured')
			return
		}

		// Try to create superuser (only works on fresh install)
		const createResponse = await fetch(`${url}/api/admins`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password, passwordConfirm: password })
		})

		if (createResponse.ok) {
			console.log('Superuser created successfully')
		} else {
			// May already exist with different password, that's ok
			console.log('Superuser may already exist with different credentials')
		}
	} catch (err) {
		console.error('Failed to configure superuser:', err)
	}
}

export function stopPocketbase(): void {
	if (pbProcess) {
		pbProcess.kill()
		pbProcess = null
		console.log('PocketBase stopped')
	}
}

// Cleanup on process exit
process.on('exit', stopPocketbase)
process.on('SIGINT', () => { stopPocketbase(); process.exit() })
process.on('SIGTERM', () => { stopPocketbase(); process.exit() })
