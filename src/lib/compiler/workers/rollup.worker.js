// @ts-nocheck
import { rollup } from '@rollup/browser'
import svelteWorker from './svelte.worker?worker'
import PromiseWorker from 'promise-worker'
import registerPromiseWorker from 'promise-worker/register'
import commonjs from './plugins/commonjs'
import json from './plugins/json'
import glsl from './plugins/glsl'
import { VERSION as SVELTE_VERSION } from 'svelte/compiler'
import IconifyShim from '../shims/IconifyIcon.svelte?raw'

const sveltePromiseWorker = new PromiseWorker(new svelteWorker())

// Based on https://github.com/pngwn/REPLicant & the Svelte REPL package (https://github.com/sveltejs/sites/tree/master/packages/repl)

// Use esm.sh for all npm packages (better ESM support, handles subpaths correctly)
const CDN_URL = 'https://esm.sh'
const SVELTE_CDN = `${CDN_URL}/svelte@${SVELTE_VERSION}`

// In-memory cache for external modules (persists for worker lifetime)
const module_cache = new Map()

// Transform <style global> to :global { } wrapper (svelte-preprocess syntax)
function processGlobalStyles(code) {
	return code.replace(
		/<style(\s+global)(\s[^>]*)?>([^]*?)<\/style>/gi,
		(match, globalAttr, otherAttrs, css) => `<style${otherAttrs || ''}>:global {${css}}</style>`
	)
}

registerPromiseWorker(rollup_worker)
async function rollup_worker({ component, head = { code: '', data: {} }, hydrated, buildStatic = true, css = 'external', format = 'esm', dev_mode = false, sourcemap = false, runtime = [], tinykit_modules = {} }) {
	const final = {
		ssr: '',
		dom: '',
		error: ''
	}

	// Virtual modules for $content, $design, $data, $tinykit, $backend
	// For SSR: inline the data. For client: leave as external (import map resolves them)
	const { content = {}, design = {}, data = {}, project_id = '' } = tinykit_modules

	const component_lookup = new Map()

	const App_Wrapper = (components, head = { code: '', data: {} }) => {
		const field_keys = Object.entries(head?.data || {}).filter((field) => field[0])
		return `
			<svelte:head>
				${head?.code || ''}
			</svelte:head>
			<script>
			  let props = $props();

				${components.map((_, i) => `import Component_${i} from './Component_${i}.svelte';`).join('\n')}
				${components.map((_, i) => `let { component_${i}_props } = props;`).join(`\n`)}

				let { head_props } = props;
				${field_keys.map((field) => `let ${field[0]} = head_props['${field[0]}'];`).join(`\n`)}
			</script>
			${components.map((component, i) => (component.wrapper_start ?? '') + `<Component_${i} {...component_${i}_props} />` + (component.wrapper_end ?? '')).join('\n')}
		`
	}

	const Component = (component) => {
		// If component is a string, it's already a complete Svelte file
		if (typeof component === 'string') {
			return component
		}

		let { html, css, js, data = {} } = component

		// If html already contains a complete Svelte component (has <script> tag), return as-is
		if (html && html.includes('<script')) {
			return html
		}

		const field_keys = Object.keys(data || {}).filter((key) => !!key)

		// html must come first for LoC (inspector) to work
		return `\
					${html}
          <script>
            ${`let { ${field_keys.join(', ')} } = $props();` /* e.g. let { heading, body } = $props(); */}
            ${js}
          </script>
          ${css ? `<style>${css}</style>` : ``}`
	}

	const Entrypoint = () => {
		let code = `export { default } from './App.svelte';\n`
		if (runtime.length > 0) code += `export { ${runtime.join(', ')} } from 'svelte'\n`
		return code
	}

	function generate_lookup(component, head) {
		if (Array.isArray(component)) {
			// build page (sections as components)
			component.forEach((section, i) => {
				const code = Component(section)
				component_lookup.set(`./Component_${i}.svelte`, code)
			})
			component_lookup.set(`./App.svelte`, App_Wrapper(component, head))
			component_lookup.set(`./entry.js`, Entrypoint())
		} else {
			// build individual component
			const appCode = Component(component)
			component_lookup.set(`./App.svelte`, appCode)
			component_lookup.set(`./entry.js`, Entrypoint())
		}
	}

	generate_lookup(component, head)

	if (buildStatic) {
		try {
			const bundle = await compile({
				generate: 'server',
				css: 'injected',
				runes: true
			})

			const result = await bundle.generate({ format, sourcemap: sourcemap ? 'inline' : false })
			final.ssr = result.output[0].code
		} catch (error) {
			noteBuildError(error)
			return final
		}
	} else {
		try {
			const bundle = await compile({
				generate: 'client',
				css,
				dev: dev_mode,
				runes: true
			})

			const result = await bundle.generate({ format, sourcemap: sourcemap ? 'inline' : false })
			final.dom = result.output[0].code
		} catch (error) {
			noteBuildError(error)
			return final
		}
	}

	// If static build needs to be hydrated, include Svelte JS (or just render normal component)
	if (hydrated) {
		try {
			const bundle = await compile({
				generate: 'client',
				css: 'external',
				dev: dev_mode,
				runes: true
			})
			const result = await bundle.generate({ format, sourcemap: sourcemap ? 'inline' : false })
			final.dom = result.output[0].code
		} catch (error) {
			noteBuildError(error)
			return final
		}
	}

	async function compile(svelteOptions = {}) {
		const isSSR = svelteOptions.generate === 'server'

		try {
			return await rollup({
				input: './entry.js',
				external: (id) => {
					// For client builds: mark $content, $design, $data, $backend as external
					// (browser import map resolves them)
					// For SSR builds: inline them (no import map available)
					if (id === '$content' || id === '$design' || id === '$data' || id === '$tinykit' || id === '$backend') {
						return !isSSR // external for client, not for SSR
					}
					return false
				},
				onwarn(warning, warn) {
					// Suppress circular dependency warnings from CDN modules
					if (warning.code === 'CIRCULAR_DEPENDENCY' && warning.ids?.some((id) => id.includes('esm.sh'))) {
						return
					}
					if (warning.code === "SOURCEMAP_BROKEN") return
					// Use default warning handler for other warnings
					warn(warning)
				},
				plugins: [
					commonjs,
					{
						name: 'tinykit-resolver',
						async resolveId(importee, importer) {
							// 1) Virtual esm-env
							if (importee === 'esm-env') return 'virtual:esm-env'

							// 2) Tinykit virtual modules ($content, $design, $data, $tinykit, $backend)
							if (importee === '$content' || importee === '$design' || importee === '$data' || importee === '$tinykit' || importee === '$backend') {
								if (isSSR) {
									// For SSR: resolve to virtual module (will be loaded below)
									return `virtual:${importee}`
								} else {
									// For client: mark as external (import map resolves)
									return { id: importee, external: true }
								}
							}

							// 3) Local virtual files (in-memory Svelte sources)
							if (component_lookup.has(importee)) return importee

							// 4) Absolute remote URL stays as-is
							if (/^https?:/.test(importee)) return importee

							// 5) Resolve relative from remote importer
							if (importee.startsWith('.')) {
								if (importer && /^https?:/.test(importer)) return new URL(importee, importer).href
								return importee
							}

							// 6) Handle absolute subpaths from CDN imports
							if (importee.startsWith('/') && importer && /^https?:/.test(importer)) {
								// Resolve absolute paths relative to the CDN origin
								const origin = new URL(importer).origin
								return `${origin}${importee}`
							}

							// 7) Handle esm.sh internal imports
							if (importer && importer.startsWith(`${CDN_URL}/`)) {
								if (importee.startsWith(`${CDN_URL}/`)) return importee
							}

							// 8) Svelte runtime pinned
							// For SSR: use a shim that makes lifecycle hooks no-ops
							if (importee === 'svelte') {
								return isSSR ? 'virtual:svelte-ssr' : SVELTE_CDN
							}
							if (importee.startsWith('svelte/')) return `${CDN_URL}/svelte@${SVELTE_VERSION}/${importee.slice('svelte/'.length)}`

							// 9) Iconify shim
							if (importee === '@iconify/svelte') return 'virtual:IconifyIcon.svelte'

							// 10) Bare package → resolve via esm.sh
							if (importee.includes('.mjs') || importee.includes('.js')) {
								// Already a resolved module path, return as-is
								return importee
							}
							return `${CDN_URL}/${importee}`
						},
						async load(id) {
							if (id === 'virtual:esm-env') {
								return `export const DEV = false; export const PROD = true; export const BROWSER = ${isSSR ? 'false' : 'true'};`
							}

							// SSR shim for svelte - re-exports everything but makes lifecycle hooks no-ops
							if (id === 'virtual:svelte-ssr') {
								return `
// Re-export everything from real svelte
export * from '${SVELTE_CDN}';

// Override lifecycle hooks with no-ops for SSR
export function onMount(fn) { /* no-op in SSR */ }
export function onDestroy(fn) { /* no-op in SSR */ }
export function beforeUpdate(fn) { /* no-op in SSR */ }
export function afterUpdate(fn) { /* no-op in SSR */ }
export function tick() { return Promise.resolve(); }
`
							}

							// Iconify shim - a Svelte 5 component that wraps iconify-icon web component
							if (id === 'virtual:IconifyIcon.svelte') {
								return IconifyShim
							}

							// Virtual tinykit modules (SSR only - client uses import map)
							if (id === 'virtual:$content') {
								return `export default ${JSON.stringify(content)};`
							}
							if (id === 'virtual:$design') {
								return `export default ${JSON.stringify(design)};`
							}
							if (id === 'virtual:$data') {
								// For SSR, $data returns collection stubs with no-op subscribe methods
								// (actual data is fetched client-side after hydration)
								const collection_names = Object.keys(data || {})
								const stubs = collection_names.map(name => {
									const records = data[name]?.records || data[name] || []
									return `  ${name}: {
    list: () => Promise.resolve(${JSON.stringify(records)}),
    get: (id) => Promise.resolve(${JSON.stringify(records)}.find(r => r.id === id) || null),
    create: () => Promise.resolve({}),
    update: () => Promise.resolve({}),
    delete: () => Promise.resolve(true),
    subscribe: (cb) => { cb(${JSON.stringify(records)}); return () => {}; },
    _notify: () => {},
    _set_cooldown: () => {},
    _refresh: () => Promise.resolve()
  }`
								}).join(',\n')
								return `
const _collections = {
${stubs}
}

// Proxy to return stub for unknown collections
const db = new Proxy(_collections, {
  get(target, prop) {
    if (prop in target) return target[prop]
    if (typeof prop === 'string' && !prop.startsWith('_')) {
      return {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(null),
        create: () => Promise.resolve({}),
        update: () => Promise.resolve({}),
        delete: () => Promise.resolve(true),
        subscribe: (cb) => { cb([]); return () => {}; },
        _notify: () => {},
        _set_cooldown: () => {},
        _refresh: () => Promise.resolve()
      }
    }
    return undefined
  }
})

export default db
`
							}
							if (id === 'virtual:$tinykit') {
								return `
export function asset(filename, options) {
	if (!filename) return '';
	if (filename.startsWith('http://') || filename.startsWith('https://')) {
		return filename;
	}
	let url = '/_tk/assets/' + filename;
	const params = [];
	if (options?.thumb) params.push('thumb=' + options.thumb);
	if (options?.download) params.push('download=1');
	if (params.length) url += '?' + params.join('&');
	return url;
}

export async function proxy(url, options = {}) {
	const proxy_url = '/api/proxy?url=' + encodeURIComponent(url);
	return fetch(proxy_url, options);
}
proxy.json = async function(url) {
	const response = await proxy(url);
	if (!response.ok) throw new Error('Failed to fetch: ' + response.status);
	return response.json();
};
proxy.text = async function(url) {
	const response = await proxy(url);
	if (!response.ok) throw new Error('Failed to fetch: ' + response.status);
	return response.text();
};
proxy.url = function(url) {
	return '/api/proxy?url=' + encodeURIComponent(url);
};
`
							}
							if (id === 'virtual:$backend') {
								// Backend SDK - provides auth, ai, utils primitives + custom functions
								// For SSR: returns stubs (backend runs on client)
								return `
// SSR stubs - these run on client only
const auth = {
	user: null,
	token: null,
	login: async () => { throw new Error('Auth only available in browser') },
	signup: async () => { throw new Error('Auth only available in browser') },
	signout: () => {},
	me: async () => null
};

const ai = async () => { throw new Error('AI only available in browser') };
ai.stream = async () => { throw new Error('AI only available in browser') };

const utils = {
	proxy: async () => { throw new Error('Proxy only available in browser') }
};
utils.proxy.json = async () => { throw new Error('Proxy only available in browser') };
utils.proxy.text = async () => { throw new Error('Proxy only available in browser') };
utils.proxy.url = () => '';

const custom = new Proxy({}, {
	get() { return async () => { throw new Error('Backend only available in browser') } }
});

const backend = { auth, ai, utils, custom };
export default backend;
export { auth, ai, utils };
`
							}

							if (component_lookup.has(id)) {
								return component_lookup.get(id)
							}

							// Fetch external modules with caching
							if (/^https?:/.test(id)) {
								// Check cache first
								if (module_cache.has(id)) {
									return module_cache.get(id)
								}

								try {
									const response = await fetch(id)
									if (!response.ok) {
										throw new Error(`Failed to fetch ${id}: ${response.status} ${response.statusText}`)
									}
									const code = await response.text()

									// Cache the result
									module_cache.set(id, code)
									return code
								} catch (error) {
									console.error(`Error loading external module: ${id}`, error)
									throw error
								}
							}

							return null
						},
						async transform(code, id) {
							// our only transform is to compile svelte components
							//@ts-ignore
							if (!/.*\.svelte/.test(id)) return null

							// Process <style global> before compilation
							const processedCode = processGlobalStyles(code)

							try {
								const res = await sveltePromiseWorker.postMessage({
									code: processedCode,
									svelteOptions
								})

								// Handle structured error from svelte worker
								if (res.error) {
									noteBuildError(res.error, id, code)
									return ''
								}

								// Return code with sourcemap if available
								return {
									code: res.code,
									map: res.map || null
								}
							} catch (e) {
								noteBuildError(e, id, code)
								return ''
							}
						}
					},
					json,
					glsl
					// replace({
					//   'process.env.NODE_ENV': JSON.stringify('production'),
					// }),
				]
				// inlineDynamicImports: true
			})
		} catch (error) {
			noteBuildError(error)
			throw error
		}
	}

	return final

	function noteBuildError(error, id, source) {
		const error_message = error instanceof Error ? error.message : String(error)
		console.error('Build error:', error_message, error)

		if (final.error) return
		final.error = formatRollupError(error, id, source)
	}
}

function formatRollupError(error, id, source) {
	if (!error) return 'Unknown build error'
	if (typeof error === 'string') return error

	const name = error.name || error.code || 'BuildError'
	const plugin = error.plugin ? `[${error.plugin}] ` : ''
	const reason = error.message || error.reason || String(error)

	const line = error.loc?.line ?? error.start?.line ?? error.line
	const column = error.loc?.column ?? error.start?.column ?? error.column

	const position = line || column ? [typeof line === 'number' ? `line ${line}` : null, typeof column === 'number' ? `column ${column}` : null].filter(Boolean).join(', ') : ''

	let message = `${plugin}${name}: ${reason}`
	if (position) {
		message += `\n${position}`
	}

	// Use provided frame or generate one from source
	let frame = typeof error.frame === 'string' ? error.frame.trim() : ''
	if (!frame && source && typeof line === 'number') {
		frame = generateCodeFrame(source, line, column)
	}

	const docLinks = collectDocLinks(error)
	if (frame) {
		message += `\n\n${frame}`
	}

	if (docLinks.length) {
		message += `\n\n${docLinks.join('\n')}`
	}

	return message
}

function generateCodeFrame(source, line, column) {
	const lines = source.split('\n')
	const start = Math.max(0, line - 3)
	const end = Math.min(lines.length, line + 2)

	return lines
		.slice(start, end)
		.map((content, i) => {
			const lineNum = start + i + 1
			const marker = lineNum === line ? '> ' : '  '
			const lineNumStr = String(lineNum).padStart(3, ' ')
			let result = `${marker}${lineNumStr} | ${content}`

			// Add column indicator for error line
			if (lineNum === line && typeof column === 'number') {
				const indent = marker.length + lineNumStr.length + 3 + column
				result += `\n${' '.repeat(indent)}^`
			}

			return result
		})
		.join('\n')
}

function collectDocLinks(error) {
	const links = new Set()

	if (typeof error.url === 'string') {
		links.add(error.url)
	}

	const maybeStack = typeof error.stack === 'string' ? error.stack.split('\n') : []
	for (const raw of maybeStack) {
		const line = raw.trim()
		if (!line) continue
		if (/^https?:\/\//.test(line)) {
			links.add(line)
		}
	}

	return Array.from(links)
}
