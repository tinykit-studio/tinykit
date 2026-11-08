import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { pb, validateUserToken, unauthorizedResponse } from '$lib/server/pb'
import PocketBase from 'pocketbase'
import { sourceHash, validateSourceBundle } from '../../../../../../scripts/static-project/source-tree.mjs'

// POST /api/projects/:id/build - Save build output as file attachment
export const POST: RequestHandler = async ({ params, request }) => {
	// Require authentication
	const user = await validateUserToken(request)
	if (!user) {
		return unauthorizedResponse('Authentication required')
	}

	try {
		const { html, frontend_code, source_bundle, expected_source_hash } = await request.json()

		if (typeof html !== 'string' || !html || Buffer.byteLength(html) > 10 * 1024 * 1024) {
			return json({ error: 'html is required' }, { status: 400 })
		}
		// Use the builder's identity for both view and update authorization.
		const client = new PocketBase(pb.baseURL)
		client.authStore.save(request.headers.get('Authorization')!.slice(7), null)
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
		if (frontend_code !== undefined) {
			if (typeof frontend_code !== 'string' || frontend_code.length > 10000000 || !expected_source_hash) {
				return json({ error: 'Source publishing requires source and its export hash.' }, { status: 400 })
			}
			const current_hash = sourceHash(project.frontend_code, project.source_bundle)
			if (current_hash !== expected_source_hash) return json({ error: 'Server source changed; reconcile before publishing.' }, { status: 409 })
			// PocketBase repeats this comparison inside the write transaction.
			// A process-local lock cannot protect against another server or client.
			return json(await client.send(`/api/tinykit/projects/${params.id}/component-build`, {
				method: 'POST', body: { html, frontend_code, expected_source_hash, ...(bundle ? { source_bundle: bundle } : {}) }
			}))
		}

		// Create a FormData with the HTML file
		const form_data = new FormData()
		const blob = new Blob([html], { type: 'text/html' })
		form_data.append('published_html', blob, 'index.html')
		// JSON preserves source line endings; plain multipart text normalizes LF
		// to CRLF and would invalidate the next export hash after a publish.
		if (frontend_code !== undefined) form_data.append('@jsonPayload', JSON.stringify({ frontend_code, ...(bundle ? { source_bundle: bundle } : {}) }))

		// Only replace the code/artifact. Never overwrite live fields or records.
		await client.collection('_tk_projects').update(params.id, form_data)

		return json({
			success: true,
			source_hash: frontend_code !== undefined ? sourceHash(frontend_code, bundle) : undefined,
			size: html.length
		})
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
