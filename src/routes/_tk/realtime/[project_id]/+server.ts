import type { RequestHandler } from './$types'
import { pb, getProject, validateUserToken } from '$lib/server/pb'
import { SESSION_COOKIE, sessionRequest } from '$lib/server/private-apps'
import { EventSource } from 'eventsource'

// Polyfill EventSource for Node.js (PocketBase SDK needs it for realtime)
if (typeof globalThis.EventSource === 'undefined') {
	(globalThis as any).EventSource = EventSource
}

/**
 * SSE endpoint for realtime data updates
 *
 * GET /_tk/realtime/{project_id}
 *
 * Streams data changes to clients via Server-Sent Events.
 * Server subscribes to PB with admin auth, so this works for unauthenticated clients.
 */
export const GET: RequestHandler = async ({ params, request, cookies }) => {
	const { project_id } = params
	const identity = sessionRequest(request, cookies.get(SESSION_COOKIE))
	const can_read = async (project: any) => project?.visibility !== 'private' || Boolean(project.owner && (await validateUserToken(identity))?.id === project.owner)

	// Verify project exists
	try {
		await pb.collection('_tk_projects').getOne(project_id)
	} catch {
		return new Response('Project not found', { status: 404 })
	}

	// Track cleanup function outside stream scope
	let cleanup: (() => void) | null = null

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder()

			// Send initial connection message
			controller.enqueue(encoder.encode('event: connected\ndata: {}\n\n'))

			// Subscribe to project changes
			let unsubscribe: (() => Promise<void>) | null = null
			let ping_interval: ReturnType<typeof setInterval> | null = null

			try {
				unsubscribe = await pb.collection('_tk_projects').subscribe(project_id, async (e) => {
					if (!await can_read(e.record)) { cleanup?.(); try { controller.close() } catch {} return }
					// Only send data_updated if data exists and is an object (not null/undefined)
					if (e.action === 'update' && e.record.data && typeof e.record.data === 'object') {
						const message = `event: data_updated\ndata: ${JSON.stringify(e.record.data)}\n\n`
						try {
							controller.enqueue(encoder.encode(message))
						} catch {
							// Stream closed, trigger cleanup
							cleanup?.()
						}
					}
				})
			} catch (err) {
				console.error('[SSE] Failed to subscribe:', err)
				controller.enqueue(encoder.encode(`event: error\ndata: {"message": "Failed to subscribe"}\n\n`))
				controller.close()
				return
			}

			// Keep connection alive with periodic pings
			ping_interval = setInterval(async () => {
				try {
						const project = await getProject(project_id)
						if (!project || !await can_read(project)) { cleanup?.(); controller.close(); return }
					controller.enqueue(encoder.encode(': ping\n\n'))
				} catch {
					// Stream closed, trigger cleanup
					cleanup?.()
				}
			}, 30000)

			// Setup cleanup function
			cleanup = () => {
				if (ping_interval) {
					clearInterval(ping_interval)
					ping_interval = null
				}
				if (unsubscribe) {
					// Catch async errors - SSE connection may already be closed
					unsubscribe()?.catch?.(() => {})
					unsubscribe = null
				}
			}
		},

		cancel() {
			// Stream was cancelled by client
			cleanup?.()
		}
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive'
		}
	})
}
