import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { pb, validateUserToken, unauthorizedResponse } from '$lib/server/pb'
import PocketBase from 'pocketbase'
import { sourceHash, validateSourceBundle } from '../../../../../../scripts/static-project/source-tree.mjs'

function publisher(request: Request) {
	const client = new PocketBase(pb.baseURL)
	client.authStore.save(request.headers.get('Authorization')!.slice(7), null)
	return client
}

// Fetch the build inputs and their revision together before Studio compiles.
export const GET: RequestHandler = async ({ params, request }) => {
	if (!await validateUserToken(request)) return unauthorizedResponse('Authentication required')
	try {
		const snapshot = await publisher(request).send(`/api/tinykit/projects/${params.id}/studio-build`, { method: 'GET' })
		return json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
	} catch (error: any) {
		return json({ error: error.message }, { status: error.status >= 400 && error.status <= 599 ? error.status : 500 })
	}
}

// POST /api/projects/:id/build - Save build output as file attachment
export const POST: RequestHandler = async ({ params, request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const { html, frontend_code, source_bundle, expected_source_hash, expected_studio_revision } = await request.json()

		if (typeof html !== 'string' || !html || Buffer.byteLength(html) > 10 * 1024 * 1024) {
			return json({ error: 'html is required' }, { status: 400 })
		}
		// Use the builder's identity for both view and update authorization.
		const client = publisher(request)
		if (frontend_code === undefined && source_bundle === undefined) {
			if (typeof expected_studio_revision !== 'string' || !/^[a-f0-9]{64}$/.test(expected_studio_revision)) {
				return json({ error: 'Reload Studio and build again to obtain a build revision.' }, { status: 409 })
			}
			return json(await client.send(`/api/tinykit/projects/${params.id}/component-build`, {
				method: 'POST', body: { html, expected_studio_revision }
			}))
		}
		const project = await client.collection('_tk_projects').getOne(params.id)
		if (project.source_bundle && source_bundle === undefined) return json({ error: 'Publish this component app from its local source folder, including its source bundle.' }, { status: 409 })
		let bundle
		if (source_bundle !== undefined) {
			if (!Object.hasOwn(project, 'source_bundle')) return json({ error: 'Apply the source-bundle database migration before publishing a component app.' }, { status: 409 })
			try {
				bundle = validateSourceBundle(source_bundle)
				if (Buffer.from(bundle.files['src/App.svelte'], 'base64').toString('utf8') !== frontend_code) throw new Error('App.svelte must match frontend_code.')
			} catch (error: any) { return json({ error: error.message }, { status: 400 }) }
		}
		if (typeof frontend_code !== 'string' || frontend_code.length > 10000000 || !expected_source_hash) {
			return json({ error: 'Source publishing requires source and its export hash.' }, { status: 400 })
		}

		const current_hash = sourceHash(project.frontend_code, project.source_bundle)
		if (current_hash !== expected_source_hash) return json({ error: 'Server source changed; reconcile before publishing.' }, { status: 409 })
		return json(await client.send(`/api/tinykit/projects/${params.id}/component-build`, {
			method: 'POST', body: { html, frontend_code, expected_source_hash: current_hash, ...(bundle ? { source_bundle: bundle } : {}) }
		}))
	} catch (error: any) {
		if (error.status === 409) return json({ error: error.message }, { status: 409 })
		if (error.status === 403) return json({ error: 'Not allowed to publish this project' }, { status: 403 })
		if (error.status === 404) {
			return json({ error: 'Project not found' }, { status: 404 })
		}
		console.error('Build save error:', error)
		const error_message = error.response?.data || error.message || String(error)
		console.error('Build save error details:', JSON.stringify(error_message, null, 2))
		return json({ error: `${error.message || error}: ${JSON.stringify(error_message)}` }, { status: 500 })
	}
}
