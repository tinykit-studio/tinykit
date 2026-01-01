// @ts-nocheck
import * as _ from 'lodash-es'
import PromiseWorker from 'promise-worker'
import { render } from 'svelte/server'

let postcss_worker
let rollup_worker
let workers_initialized = false
let worker_init_error = null

// Initialize workers (browser-only)
async function initWorkers() {
	if (workers_initialized || typeof window === 'undefined') {
		return
	}

	if (worker_init_error) {
		throw worker_init_error
	}

	try {
		const [postCSSWorkerModule, rollupWorkerModule] = await Promise.all([
			import('./workers/postcss.worker.js?worker'),
			import('./workers/rollup.worker.js?worker')
		])

		postcss_worker = new PromiseWorker(new postCSSWorkerModule.default())
		rollup_worker = new PromiseWorker(new rollupWorkerModule.default())
		workers_initialized = true
	} catch (err) {
		console.error('[Compiler] Failed to initialize workers:', err)
		worker_init_error = err
		throw err
	}
}

async function getPostCSSWorker() {
	if (!workers_initialized) {
		await initWorkers()
	}
	return postcss_worker
}

async function getRollupWorker() {
	if (!workers_initialized) {
		await initWorkers()
	}
	return rollup_worker
}

const COMPILED_COMPONENTS_CACHE = new Map()

/**
 * Compiles and renders a given component or page, caching the result.
 * @async
 * @param {Object} options - The options for rendering.
 * @param {Object|Object[]} options.component - The component(s) to be rendered. Can be a single component or an array of components for a page.
 * @param {{ code: string, data: Object }} options.head
 * @param {boolean} [options.buildStatic=true] - Indicates whether to build the component statically or not.
 * @param {"injected" | "external"} [options.css] - Indicates whether to include CSS in the JavaScript bundle.
 * @param {string} [options.format='esm'] - The module format to use, such as 'esm' for ES Modules.
 * @param {boolean} [options.dev_mode=false] - Whether Svelte should be compiled in dev mode (better error messages, $inspect support).
 * @param {boolean} [options.sourcemap=false] - Whether to generate inline sourcemaps for debugging.
 * @param {string[]} [options.runtime=[]] - Svelte runtime functions to include in bundle (eg. mount, unmount, hydrate).
 * @param {Object} [options.tinykit_modules={}] - Content/design/data for SSR (inlined during server render).
 * @returns {Promise<Object>} Returns a payload containing the rendered HTML, CSS, JS, and other relevant data.
 * @throws {Error} Throws an error if the compilation or rendering fails.
 */
export async function html({ component, head, buildStatic = true, css = 'external', format = 'esm', dev_mode = false, sourcemap = false, runtime = [], tinykit_modules = {} }) {
	let cache_key
	if (!buildStatic) {
		cache_key = JSON.stringify({
			component,
			format,
			dev_mode,
			sourcemap,
			runtime
		})
		if (COMPILED_COMPONENTS_CACHE.has(cache_key)) {
			return COMPILED_COMPONENTS_CACHE.get(cache_key)
		}
	}

	const compile_page = Array.isArray(component)

	let res
	try {
		// Handle component as string (complete Svelte file) or object
		const has_js = typeof component === 'string'
			? component.includes('<script')
			: compile_page
				? component.some((s) => !!s.js)
				: !!component.js
		const worker = await getRollupWorker()
		res = await worker.postMessage({
			component,
			head,
			hydrated: buildStatic && has_js,
			buildStatic,
			css,
			format,
			dev_mode,
			sourcemap,
			runtime,
			tinykit_modules
		})
	} catch (e) {
		console.error('Rollup worker error:', e)
		res = {
			error: e instanceof Error ? e.message : String(e)
		}
	}

	let payload

	if (!res) {
		console.error('Compilation failed: No response from rollup worker')
		payload = {
			html: '<h1 style="text-align: center">could not render</h1>',
			error: 'No response from rollup worker'
		}
		res = {}
	} else if (res.error) {
		console.error('Compilation error from rollup worker:', res.error)
		payload = {
			error: res.error
		}
	} else if (buildStatic) {
		const blob = new Blob([res.ssr], { type: 'text/javascript' })
		const url = URL.createObjectURL(blob)
		const { default: App } = await import(/* @vite-ignore */ url)
		URL.revokeObjectURL(url)

		let component_data
		if (compile_page) {
			// get the component data for the page (array of sections)
			component_data = component.reduce((accumulator, item, i) => {
				if (!_.isEmpty(item.data)) {
					accumulator[`component_${i}_props`] = item.data
				}
				return accumulator
			}, {})
			component_data.head_props = head.data
		} else if (typeof component === 'string') {
			// String component (complete Svelte file) - no props needed
			// Data comes from $content, $design, $data imports
			component_data = {}
		} else {
			// Object component with explicit data
			component_data = component.data || {}
		}

		try {
			const rendered = render(App, { props: component_data })
			payload = {
				head: rendered.head,
				body: rendered.body,
				js: res.dom
			}
		} catch (e) {
			console.error('Svelte render error:', e)
			const error_msg = e instanceof Error ? e.message : String(e)
			payload = {
				head: '',
				body: '',
				js: '',
				error: `Render error: ${error_msg}`
			}
		}
	} else {
		payload = {
			js: res.dom
		}
	}

	if (!buildStatic) {
		COMPILED_COMPONENTS_CACHE.set(cache_key, payload)
	}

	return payload
}

const cssMap = new Map()
export async function css(raw) {
	// return {
	//   css: ''
	// }
	if (cssMap.has(raw)) {
		return { css: cssMap.get(raw) }
	}
	let payload
	try {
		const worker = await getPostCSSWorker()
		payload = await worker.postMessage({
			css: raw
		})
	} catch (error) {
		return {
			error: serializeCssWorkerError(error)
		}
	}

	if (!payload) {
		return { css: '' }
	}

	if (payload.error) {
		return {
			error: serializeCssWorkerError(payload.error)
		}
	}

	const processedCss = typeof payload.css === 'string' ? payload.css : typeof payload === 'string' ? payload : ''

	if (!processedCss) {
		return { css: '' }
	}

	cssMap.set(raw, processedCss)
	return {
		css: processedCss
	}
}

function serializeCssWorkerError(error) {
	if (!error) return 'Unknown CSS error'
	if (typeof error === 'string') return error

	const name = error.name || 'CssError'
	const reason = error.reason || error.message || String(error)
	const line = error.line || error?.input?.line
	const column = error.column || error?.input?.column
	const location = line || column ? ` (line ${line ?? '?'}${column ? `, column ${column}` : ''})` : ''

	let message = `${name}: ${reason}${location}`

	return message
}
