import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { pb, validateUserToken, unauthorizedResponse } from '$lib/server/pb'
import PocketBase from 'pocketbase'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { sourceHash, validateSourceBundle } from '../../../../../../scripts/static-project/source-tree.mjs'

// These definitions are shared with PocketBase's CommonJS hook runtime.
// Load them natively so Vite does not evaluate module.exports as ESM.
const definitions = createRequire(`${process.cwd()}/package.json`)('./pocketbase/pb_hooks/lib/definitions.cjs')

// GET /api/projects/:id/export - Export project data
export const GET: RequestHandler = async ({ params, request }) => {
	if (!await validateUserToken(request)) return unauthorizedResponse('Sign in to export this project.')
	try {
		const options = new URL(request.url).searchParams
		const include_records = options.get('include_records') === '1'
		const include_assets = options.get('include_assets') === '1'
		// Read with the caller's token so collection view rules authorize this project.
		const client = new PocketBase(pb.baseURL)
		client.authStore.save(request.headers.get('Authorization')!.slice(7), null)
		const project = await client.collection('_tk_projects').getOne(params.id)

		if (!project) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		const base_revision = createHash('sha256').update(definitions.canonical(definitions.sourceState(project))).digest('hex')
		const source = !project.source_bundle && project.cli_draft?.base_revision === base_revision ? project.cli_draft.definition : definitions.definition(project)
		const source_bundle = project.source_bundle ? validateSourceBundle(project.source_bundle) : null
		const source_hash = sourceHash(source.frontend_code, source_bundle)
		// Keep a root edit made in Studio when restoring the rest of the tree.
		if (source_bundle) source_bundle.files['src/App.svelte'] = Buffer.from(source.frontend_code).toString('base64')

		// Include portable assets so the exported app can run independently of its host.
		// Service settings, credentials, and chat history are intentionally not exported.
		const asset_files: Array<{ name: string; base64: string }> = []
		const source_asset_files: Array<{ name: string; base64: string }> = []
		let totalBytes = 0
		for (const name of include_assets ? project.assets || [] : []) {
			const response = await fetch(client.files.getURL(project, name, { token: await client.files.getToken() }))
			if (!response.ok) throw new Error(`Could not export asset ${name}`)
			const bytes = Buffer.from(await response.arrayBuffer())
			totalBytes += bytes.length
			if (totalBytes > 50 * 1024 * 1024) return json({ error: 'Project assets exceed the 50 MB local export limit.' }, { status: 413 })
			asset_files.push({ name, base64: bytes.toString('base64') })
		}
		// CLI-owned graphics are separate from private runtime uploads and belong
		// to the portable app definition. Protected files use the caller's token.
		if (Object.keys(source.assets || {}).length) {
			const token = await client.files.getToken()
			for (const [name, asset] of Object.entries(source.assets) as Array<[string, any]>) {
				const record = await client.collection('_tk_source_assets').getOne(asset.id)
				const response = await fetch(client.files.getURL(record, record.file, { token }))
				if (!response.ok) throw new Error(`Could not export source asset ${name}`)
				const bytes = Buffer.from(await response.arrayBuffer())
				totalBytes += bytes.length
				if (totalBytes > 50 * 1024 * 1024) return json({ error: 'Project assets exceed the 50 MB local export limit.' }, { status: 413 })
				source_asset_files.push({ name, base64: bytes.toString('base64') })
			}
		}

		return json({
			format_version: source_bundle ? 2 : 1,
			source_bundle,
			source_hash,
			hosted: { server: new URL(request.url).origin, project_id: project.id, base_revision, draft_revision: project.cli_draft?.revision || null },
			export_options: { include_records, include_assets },
			omitted_assets: include_assets ? 0 : (project.assets || []).length,
			id: project.id,
			name: source.name,
			visibility: project.visibility || 'public',
			frontend_code: source.frontend_code,
			backend_code: source.backend_code,
			design: source.design,
			content: source.content,
			data: Object.fromEntries(Object.entries(source.schema).map(([name, schema]) => [name, {
				schema,
				records: include_records ? (Array.isArray(project.data?.[name]) ? project.data[name] : project.data?.[name]?.records || []) : []
			}])),
			custom_instructions: source.custom_instructions,
			assets: include_assets ? project.assets || [] : [],
			asset_files,
			source_asset_files,
			exported_at: new Date().toISOString()
		}, { headers: { 'Cache-Control': 'no-store' } })
	} catch (error: any) {
		if (error.status === 403) return json({ error: 'Not allowed to export this project' }, { status: 403 })
		if (error.status === 404) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		console.error('Export error:', error)
		return json({ error: 'Failed to export project' }, { status: 500 })
	}
}
