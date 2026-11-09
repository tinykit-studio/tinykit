import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import PocketBase from 'pocketbase'
import { pb, validateUserToken, unauthorizedResponse } from '$lib/server/pb'
import { normalizeProjectImport } from '$lib/project-import'
import { validateSourceBundle } from '../../../../../scripts/static-project/source-tree.mjs'

export const POST: RequestHandler = async ({ request }) => {
	if (!await validateUserToken(request)) return unauthorizedResponse('Sign in to import an app.')
	let payload: any, definition: ReturnType<typeof normalizeProjectImport>, bundle: any
	const files: Array<{ name: string; bytes: Buffer; upload: string }> = []
	try {
		payload = await request.json()
		definition = normalizeProjectImport(payload.app, payload.filename)
		bundle = payload.app.source_bundle ? validateSourceBundle(payload.app.source_bundle) : null
		if (bundle) bundle.files['src/App.svelte'] = Buffer.from(definition.frontend_code).toString('base64')
		const names = new Set<string>()
		let size = 0
		for (const key of ['asset_files', 'source_asset_files']) {
			const assets = payload.app[key] ?? []
			if (!Array.isArray(assets)) throw new Error('Invalid uploaded files in import.')
			for (const asset of assets) {
				if (!asset || typeof asset.name !== 'string' || !asset.name || /[/\\\x00-\x1f]/.test(asset.name) || ['.', '..'].includes(asset.name) || names.has(asset.name) || typeof asset.base64 !== 'string') throw new Error('Invalid or duplicate uploaded filename.')
				const bytes = Buffer.from(asset.base64, 'base64')
				if (bytes.toString('base64') !== asset.base64) throw new Error(`Invalid file encoding: ${asset.name}`)
				size += bytes.length
				if (size > 50 * 1024 * 1024) throw new Error('Imported uploads exceed 50 MB.')
				const extension = asset.name.match(/\.[A-Za-z0-9]{1,12}$/)?.[0] || '.bin'
				files.push({ name: asset.name, bytes, upload: `tkimport${files.length}${extension}` })
				names.add(asset.name)
			}
		}
		if (payload.app.assets !== undefined && (!Array.isArray(payload.app.assets) || payload.app.assets.some((name: any) => !names.has(name)))) throw new Error('This export is missing uploaded files. Download it again with uploaded files included.')
	} catch (error: any) {
		return json({ error: error.message || 'Invalid app export.' }, { status: 400 })
	}
	// The caller's collection rules authorize creation, uploads, and updates.
	const client = new PocketBase(pb.baseURL)
	client.autoCancellation(false)
	client.authStore.save(request.headers.get('Authorization')!.slice(7), null)
	let created: any
	try {
		const fields = {
			...definition,
			kit: typeof payload.kit === 'string' && payload.kit ? payload.kit : 'custom',
			domain: typeof payload.domain === 'string' ? payload.domain.trim().toLowerCase() : '',
			source_bundle: bundle,
			visibility: payload.app.visibility === 'private' ? 'private' : 'public',
			settings: { project_title: definition.name, vibe_zone_enabled: true }
		}
		const form = new FormData()
		for (const [key, value] of Object.entries(fields)) form.append(key, typeof value === 'string' ? value : JSON.stringify(value))
		for (const file of files) form.append('assets', new Blob([new Uint8Array(file.bytes)]), file.upload)
		// JSON keeps source bytes exact; multipart text parts normalize LF to CRLF.
		// Upload imports restore their authored fields with the JSON update below.
		created = await client.collection('_tk_projects').create(files.length ? form : fields)
		if (fields.visibility === 'private' && (created.visibility !== 'private' || !created.owner)) throw new Error('Upgrade this Tinykit server with private-app access before importing a private app.')
		if (bundle && /^[a-z0-9]{15}$/.test(payload.app.id || '')) {
			for (const name of ['tinykit/data.js', 'tinykit/helpers.js']) if (bundle.files[name]) {
				const text = Buffer.from(bundle.files[name], 'base64').toString('utf8')
				const rebound = text.replace(new RegExp(`(\\bconst\\s+PROJECT_ID\\s*=\\s*)(['\"])${payload.app.id}\\2`, 'g'), (_match, prefix, quote) => prefix + quote + created.id + quote)
				bundle.files[name] = Buffer.from(rebound).toString('base64')
			}
		}
		if (files.length) {
			const replacements = files.map(file => {
				const base = file.upload.slice(0, file.upload.lastIndexOf('.'))
				const stored = (created.assets || []).filter((name: string) => name.startsWith(base + '_'))
				if (stored.length !== 1) throw new Error(`Could not restore uploaded file: ${file.name}`)
				return [file.name, stored[0]] as [string, string]
			})
			const rewrite = (value: any): any => {
				if (typeof value === 'string') {
					for (const [oldName, newName] of replacements) {
						const oldPath = `/_tk/assets/${payload.app.id}/${oldName}`
						const newPath = `/_tk/assets/${created.id}/${newName}`
						for (const path of [oldPath, `/_tk/assets/${payload.app.id}/${encodeURIComponent(oldName)}`]) {
							if (typeof payload.app.hosted?.server === 'string') value = value.replaceAll(payload.app.hosted.server + path, newPath)
							value = value.replaceAll(path, newPath)
						}
					}
					return value
				}
				if (Array.isArray(value)) return value.map(rewrite)
				if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, rewrite(field)]))
				return value
			}
			const restored = rewrite(definition)
			const fileNames = new Map(replacements)
			const fileValue = (value: any): any => Array.isArray(value) ? value.map(fileValue) : fileNames.get(value) || value
			const source = (value: string) => {
				value = rewrite(value)
				for (const [oldName, newName] of replacements) {
					const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
					value = value.replace(new RegExp(`(\\basset\\(\\s*)([\x22\x27\x60])${escaped}\\2`, 'g'), (_match, prefix, quote) => prefix + quote + newName + quote)
				}
				return value
			}
			restored.frontend_code = source(restored.frontend_code)
			for (const field of restored.content) if (['image', 'file'].includes(field.type)) field.value = fileValue(field.value)
			for (const collection of Object.values(restored.data) as any[]) for (const field of collection.schema) {
				if (['file', 'image'].includes(field.type) || /(?:image|cover|avatar|photo|file|attachment|url)(?:_|$)/i.test(field.name)) for (const record of collection.records) if (Object.hasOwn(record, field.name)) record[field.name] = fileValue(record[field.name])
			}
			if (bundle) for (const [name, value] of Object.entries(bundle.files)) if (/\.(svelte|[cm]?js|ts|json|html|css)$/.test(name)) {
				bundle.files[name] = Buffer.from(source(Buffer.from(value as string, 'base64').toString('utf8'))).toString('base64')
			}
			created = await client.collection('_tk_projects').update(created.id, { ...restored, source_bundle: bundle })
		}
		else if (bundle) created = await client.collection('_tk_projects').update(created.id, { source_bundle: bundle })
		return json(created, { status: 201, headers: { 'Cache-Control': 'no-store' } })
	} catch (error: any) {
		if (created) {
			try { await client.collection('_tk_projects').delete(created.id) }
			catch { return json({ error: `Import failed. An incomplete app (${created.id}) could not be removed; retry after removing it.` }, { status: 500 }) }
		}
		return json({ error: error.status === 403 ? 'You do not have permission to import this app.' : error.message || 'Could not import app.' }, { status: error.status === 403 ? 403 : 500 })
	}
}
