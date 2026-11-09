import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Hosted app uploads may come from opaque origins. The request hook
		// limits those writes to the public data API.
		csrf: { trustedOrigins: ['null'] },
		alias: {
			$lib: 'src/lib',
			$tinykit: 'src/routes/tinykit'
		}
	}
};

export default config;
