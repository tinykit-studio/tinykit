<script>
	let { icon = '', width, height, size, class: className = '', style = '', ...rest } = $props()

	let el = $state(null)

	// Lazy-load Iconify script on first use (SSR-safe)
	$effect(() => {
		if (typeof window === 'undefined') return
		const win = /** @type {any} */ (window)
		if (win._iconifyLoaded || document.querySelector('script[data-iconify]')) return
		win._iconifyLoaded = true
		const script = document.createElement('script')
		script.src = 'https://code.iconify.design/iconify-icon/2.3.0/iconify-icon.min.js'
		script.setAttribute('data-iconify', 'true')
		document.head.appendChild(script)
	})

	let computed_width = $derived(width || size || undefined)
	let computed_height = $derived(height || size || undefined)
</script>

<iconify-icon
	bind:this={el}
	{icon}
	width={computed_width}
	height={computed_height}
	class={className}
	{style}
	{...rest}
></iconify-icon>
