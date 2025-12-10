/**
 * Setup Pocketbase collection rules for authenticated access
 *
 * This script updates the _tk_projects collection to require authentication
 * for all operations. Run this once after setting up your Pocketbase instance.
 *
 * Usage:
 *   POCKETBASE_URL=http://127.0.0.1:8091 \
 *   POCKETBASE_ADMIN_EMAIL=admin@localhost \
 *   POCKETBASE_ADMIN_PASSWORD=yourpassword \
 *   node scripts/setup-auth-rules.js
 */

import PocketBase from 'pocketbase'

const PB_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8091'
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL || 'admin@localhost'
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD

if (!ADMIN_PASSWORD) {
	console.error('Error: POCKETBASE_ADMIN_PASSWORD environment variable is required')
	process.exit(1)
}

const pb = new PocketBase(PB_URL)

async function main() {
	console.log(`Connecting to PocketBase at ${PB_URL}...`)

	try {
		// Authenticate as superuser
		await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
		console.log('Authenticated as superuser')

		// Get the _tk_projects collection
		let collection
		try {
			collection = await pb.collections.getOne('_tk_projects')
			console.log('Found _tk_projects collection')
		} catch (err) {
			console.log('_tk_projects collection not found, creating it...')
			collection = await createProjectsCollection()
		}

		// Update collection rules to require authentication
		// Rule: "@request.auth.id != ''" means user must be logged in
		const auth_rule = "@request.auth.id != ''"

		await pb.collections.update(collection.id, {
			listRule: auth_rule,
			viewRule: auth_rule,
			createRule: auth_rule,
			updateRule: auth_rule,
			deleteRule: auth_rule
		})

		console.log('Updated _tk_projects collection rules:')
		console.log('  listRule:', auth_rule)
		console.log('  viewRule:', auth_rule)
		console.log('  createRule:', auth_rule)
		console.log('  updateRule:', auth_rule)
		console.log('  deleteRule:', auth_rule)

		// Ensure users collection exists and is properly configured
		await ensureUsersCollection()

		console.log('\n✓ Auth rules setup complete!')
		console.log('\nNext steps:')
		console.log('1. Create a user account via PocketBase admin UI or API')
		console.log('2. Use the login page at /login to authenticate')
	} catch (err) {
		console.error('Error:', err.message || err)
		process.exit(1)
	}
}

async function createProjectsCollection() {
	return await pb.collections.create({
		name: '_tk_projects',
		type: 'base',
		schema: [
			{ name: 'name', type: 'text', required: true },
			{ name: 'domain', type: 'text', required: true },
			{ name: 'frontend_code', type: 'text', required: false },
			{ name: 'backend_code', type: 'text', required: false },
			{ name: 'design', type: 'json', required: false },
			{ name: 'content', type: 'json', required: false },
			{ name: 'snapshots', type: 'json', required: false },
			{ name: 'agent_chat', type: 'json', required: false },
			{ name: 'custom_instructions', type: 'text', required: false },
			{ name: 'data', type: 'json', required: false },
			{ name: 'settings', type: 'json', required: false }
		],
		indexes: [
			'CREATE UNIQUE INDEX idx_domain ON _tk_projects (domain)'
		],
		listRule: '',
		viewRule: '',
		createRule: '',
		updateRule: '',
		deleteRule: ''
	})
}

async function ensureUsersCollection() {
	try {
		const users = await pb.collections.getOne('users')
		console.log('Users collection already exists')

		// Make sure the users collection allows self-registration
		// (users can create their own accounts)
		// createRule: null means no one can create, "" means anyone can create
		if (users.createRule === null) {
			await pb.collections.update(users.id, {
				createRule: '' // Empty string means anyone can create (register)
			})
			console.log('Updated users collection to allow self-registration')
		} else {
			console.log('Users collection already allows registration')
		}
	} catch (err) {
		// Users collection should exist by default in PocketBase
		// If it doesn't, something is wrong
		console.warn('Warning: users collection not found. This should exist by default.')
	}
}

main()
