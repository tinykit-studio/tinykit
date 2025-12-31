import type { RequestHandler } from './$types'
import { pb } from '$lib/server/pb'
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
export const GET: RequestHandler = async ({ params }) => {
	const { project_id } = params

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
				unsubscribe = await pb.collection('_tk_projects').subscribe(project_id, (e) => {
					if (e.action === 'update' && e.record.data) {
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
			ping_interval = setInterval(() => {
				try {
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
