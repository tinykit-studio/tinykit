// Share successful downloads and in-flight requests across compilations.
// CDN cold builds and brief outages should not immediately break the preview.
/** @param {{fetch_module?: (url: string) => Promise<Response>, wait?: (ms: number) => Promise<unknown>}} [options] */
export function create_module_loader({
	fetch_module = (url) => fetch(url, { signal: AbortSignal.timeout(15000) }),
	wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
	const cache = new Map()
	const pending = new Map()

	/** @param {string} url */
	async function download(url) {
		for (let attempt = 0; attempt < 3; attempt++) {
			let retryable = true
			try {
				const response = await fetch_module(url)
				if (!response.ok) {
					retryable = response.status === 408 || response.status === 429 || response.status >= 500
					throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
				}
				const code = await response.text()
				cache.set(url, code)
				return code
			} catch (error) {
				if (!retryable || attempt === 2) throw error
				await wait(300 * 3 ** attempt)
			}
		}
	}

	/** @param {string} url */
	return async function load_module(url) {
		if (cache.has(url)) return cache.get(url)
		if (pending.has(url)) return pending.get(url)
		const request = download(url)
		pending.set(url, request)
		try {
			return await request
		} finally {
			// Never cache a failure: a later compile can retry the same URL.
			pending.delete(url)
		}
	}
}
