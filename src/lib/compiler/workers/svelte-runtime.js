// Resolve Svelte's public exports and relative runtime imports to bundled sources.
// The compiler and runtime always come from the same installed package.
/**
 * @param {Record<string, string>} sources
 * @param {Record<string, string | {types?: string, browser?: string, default?: string}>} package_exports
 * @param {string} clsx_source
 */
export function create_svelte_runtime(sources, package_exports, clsx_source) {
	const prefix = 'virtual:svelte-runtime/'

	/** @param {string} path @param {boolean} server */
	function entry(path, server) {
		const target = package_exports[path]
		if (typeof target === 'string') return target
		return (!server && target?.browser) || target?.default
	}

	return {
		/** @param {string} importee @param {string | null | undefined} importer @param {boolean} [server] */
		resolve(importee, importer, server = false) {
			// CDN-built Svelte components must share the application's runtime instance.
			if (/^https?:/.test(importee) || (importer?.startsWith('https://esm.sh/') && /^[./]/.test(importee))) {
				const url = new URL(importee, importer && /^https?:/.test(importer) ? importer : undefined)
				if (url.origin === 'https://esm.sh') {
					const match = decodeURIComponent(url.pathname).match(/^\/svelte@(?:\^|~)?5(?:\.[^/]*)?(?:\/(.*))?$/)
					if (match) {
						const path = (match[1] || '').replace(/^(?:X-[^/]+\/)?(?:es\d+|esnext|denonext)\//, '').replace(/\.m?js$/, '')
						if (path.startsWith('src/')) {
							const source = path + '.js'
							if (('/node_modules/svelte/' + source) in sources) return prefix + source
						} else {
							const target = entry(!path || path === 'svelte' ? '.' : './' + path, server)
							if (target) return prefix + target.replace(/^\.\//, '')
						}
					}
				}
			}
			if (importee === 'clsx' && importer?.startsWith(prefix)) return prefix + 'clsx.js'
			if (importee === '#client/constants') return prefix + 'src/internal/client/constants.js'
			if (importer?.startsWith(prefix) && importee.startsWith('.')) {
				const path = new URL(importee, 'https://runtime.local/' + importer.slice(prefix.length)).pathname.slice(1)
				return prefix + path
			}
			if (importee === 'svelte' || importee.startsWith('svelte/')) {
				const path = importee === 'svelte' ? '.' : './' + importee.slice(7)
				const target = entry(path, server)
				if (!target) throw new Error(`Unsupported Svelte runtime import: ${importee}`)
				return prefix + target.replace(/^\.\//, '')
			}
			return null
		},
		/** @param {string} id */
		load(id) {
			if (!id.startsWith(prefix)) return null
			if (id === prefix + 'clsx.js') return clsx_source
			const path = '/node_modules/svelte/' + id.slice(prefix.length)
			if (!(path in sources)) throw new Error(`Missing bundled Svelte runtime module: ${path}`)
			return sources[path]
		}
	}
}
