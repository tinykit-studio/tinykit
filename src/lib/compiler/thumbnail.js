/**
 * Build a self-contained srcdoc for thumbnail preview
 * This is extracted to a separate file to avoid PostCSS parsing issues
 * when <style> tags appear in template literals within .svelte files
 *
 * @param {string} js_code - The compiled JavaScript code
 * @param {string} design_css - CSS variables from design fields
 * @returns {string} Complete HTML document as srcdoc
 */
export function build_thumbnail_srcdoc(js_code, design_css) {
	const import_map = JSON.stringify({
		imports: {
			"svelte": "https://esm.sh/svelte@5",
			"svelte/": "https://esm.sh/svelte@5/",
			"$content": "data:text/javascript,export default {}",
			"$design": "data:text/javascript,export default {}",
			"$data": "data:text/javascript,export default {}",
			"$tinykit": "data:text/javascript,export async function proxy(url, options = {}) { return fetch('/api/proxy?url=' + encodeURIComponent(url), options); }; proxy.json = async function(url) { const r = await proxy(url); if (!r.ok) throw new Error('Failed: ' + r.status); return r.json(); }; proxy.text = async function(url) { const r = await proxy(url); if (!r.ok) throw new Error('Failed: ' + r.status); return r.text(); }; proxy.url = function(url) { return '/api/proxy?url=' + encodeURIComponent(url); };"
		}
	})

	const escaped_code = JSON.stringify(js_code)

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/modern-normalize@2.0.0/modern-normalize.min.css">
<style>${design_css}</style>
<script type="importmap">${import_map}</script>
<style>body{margin:0;overflow:hidden;pointer-events:none;user-select:none}</style>
</head>
<body>
<script type="module">
const code = ${escaped_code};
const blob = new Blob([code], { type: 'text/javascript' });
const url = URL.createObjectURL(blob);
import(url).then(mod => {
  mod.mount(mod.default, { target: document.body });
  URL.revokeObjectURL(url);
}).catch(err => console.error('Failed to mount:', err));
</script>
</body>
</html>`
}
