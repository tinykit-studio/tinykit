import { error, type RequestEvent } from '@sveltejs/kit'
import { getProject, pb, validateUserToken, withProjectLock, type Project } from './pb'
import { SESSION_COOKIE, sessionRequest } from './private-apps'

type AppWriteRequest = Pick<RequestEvent, 'request' | 'cookies' | 'url'>
type FileFields = Map<string, File[]>

class StaleAppData extends Error {}

export function withAppDataWrite<T>(projectId: string, mutate: (project: Project) => Promise<T>): Promise<T> {
	return withProjectLock(projectId, async () => {
		for (let attempt = 0; attempt < 20; attempt++) {
			const project = await getProject(projectId, { strict: true })
			if (!project) throw error(404, 'Project not found')
			try {
				return await mutate(project)
			} catch (cause) {
				if (!(cause instanceof StaleAppData)) throw cause
			}
		}
		throw error(409, 'App data is busy. Retry this change.')
	})
}

export async function readAppDataInput(request: Request) {
	const contentType = request.headers.get('content-type') || ''
	const files: FileFields = new Map()
	if (!contentType.includes('multipart/form-data') && !contentType.includes('application/x-www-form-urlencoded')) {
		return { fields: await request.json(), files }
	}
	const fields: Record<string, any> = Object.create(null)
	for (const [key, value] of await request.formData()) {
		if (typeof value !== 'string') {
			const field = key.startsWith('_file:') ? key.slice(6) : key
			if (!field || field === 'id' || field === '__proto__') throw error(400, 'Invalid upload field.')
			const group = files.get(field) || []
			group.push(value)
			files.set(field, group)
		} else if (key === '_data') {
			try { Object.assign(fields, JSON.parse(value)) } catch {}
		} else if (!key.startsWith('_file:')) {
			try { fields[key] = JSON.parse(value) } catch { fields[key] = value }
		}
	}
	return { fields, files }
}

export async function commitAppData(
	event: AppWriteRequest, projectId: string, data: Record<string, any>,
	expectedRevision: string | undefined,
	upload?: { collection: string; index: number; files: FileFields }
): Promise<Record<string, string | string[]>> {
	// A cookie only represents the user for a same-origin write, even if this
	// request originally arrived while the project was public.
	const cookie = event.request.headers.get('Origin') === event.url.origin
		? event.cookies.get(SESSION_COOKIE) : undefined
	const actor = (await validateUserToken(sessionRequest(event.request, cookie)))?.id || ''
	let body: Record<string, any> | FormData = { actor, data, expected_revision: expectedRevision }
	if (upload?.files.size) {
		const form = new FormData()
		form.set('payload', JSON.stringify({
			actor, data, expected_revision: expectedRevision,
			upload: {
				collection: upload.collection,
				index: upload.index,
				groups: Array.from(upload.files, ([field, files]) => ({ field, count: files.length }))
			}
		}))
		for (const files of upload.files.values()) for (const file of files) form.append('files', file)
		body = form
	}
	try {
		const result = await pb.send(`/api/tinykit/projects/${projectId}/app-data-write`, { method: 'POST', body })
		return result.fields
	} catch (cause: any) {
		if (cause.status === 409 && cause.response?.data?.app_data_revision) throw new StaleAppData()
		if ([400, 401, 403, 404].includes(cause.status)) throw error(cause.status, cause.message)
		throw cause
	}
}
