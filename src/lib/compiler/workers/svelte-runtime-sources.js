import svelte_package from 'svelte/package.json'
import clsx_source from '/node_modules/clsx/dist/clsx.mjs?raw'
import { create_svelte_runtime } from './svelte-runtime.js'

// Raw sources are included in the worker asset at build time, not fetched at runtime.
const sources = /** @type {Record<string, string>} */ (import.meta.glob([
	'/node_modules/svelte/src/**/*.js',
	'!/node_modules/svelte/src/compiler/**'
], { eager: true, query: '?raw', import: 'default' }))

export const svelte_runtime = create_svelte_runtime(sources, svelte_package.exports, clsx_source)
