import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5173,
		strictPort: false
	},
	optimizeDeps: {
		exclude: ['@rollup/browser'],
		esbuildOptions: {
			target: 'esnext'
		}
	},
	worker: {
		format: 'es'
	},
	assetsInclude: ['**/*.wasm']
});
