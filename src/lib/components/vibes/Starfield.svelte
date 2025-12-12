<script lang="ts">
	import { onMount, onDestroy } from "svelte"

	let canvas: HTMLCanvasElement
	let ctx: CanvasRenderingContext2D | null
	let animationId: number

	type Star = {
		x: number
		y: number
		z: number
	}

	let stars: Star[] = []
	const numStars = 500
	const speed = $state(5)
	let warpSpeed = $state(false)

	function initStars() {
		stars = []
		for (let i = 0; i < numStars; i++) {
			stars.push({
				x: (Math.random() - 0.5) * 2000,
				y: (Math.random() - 0.5) * 2000,
				z: Math.random() * 1000
			})
		}
	}

	function updateStars() {
		if (!canvas) return

		const currentSpeed = warpSpeed ? speed * 4 : speed

		for (let star of stars) {
			star.z -= currentSpeed

			// Reset star if it goes behind camera
			if (star.z <= 0) {
				star.x = (Math.random() - 0.5) * 2000
				star.y = (Math.random() - 0.5) * 2000
				star.z = 1000
			}
		}
	}

	function drawStars() {
		if (!ctx || !canvas) return

		const centerX = canvas.width / 2
		const centerY = canvas.height / 2

		// Clear with fade effect for trails
		ctx.fillStyle = "rgba(0, 0, 0, 0.2)"
		ctx.fillRect(0, 0, canvas.width, canvas.height)

		for (let star of stars) {
			// Project 3D to 2D
			const k = 200 / star.z
			const x = star.x * k + centerX
			const y = star.y * k + centerY

			// Calculate size based on depth
			const size = (1 - star.z / 1000) * 3

			// Skip if off screen
			if (x < 0 || x > canvas.width || y < 0 || y > canvas.height) {
				continue
			}

			// Calculate brightness based on depth
			const brightness = Math.floor((1 - star.z / 1000) * 255)

			// Draw star
			ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`
			ctx.beginPath()
			ctx.arc(x, y, size, 0, Math.PI * 2)
			ctx.fill()

			// Draw trail in warp mode
			if (warpSpeed) {
				const k2 = 200 / (star.z + speed * 8)
				const x2 = star.x * k2 + centerX
				const y2 = star.y * k2 + centerY

				ctx.strokeStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.5)`
				ctx.lineWidth = size / 2
				ctx.beginPath()
				ctx.moveTo(x, y)
				ctx.lineTo(x2, y2)
				ctx.stroke()
			}
		}
	}

	function animate() {
		updateStars()
		drawStars()
		animationId = requestAnimationFrame(animate)
	}

	function toggleWarp() {
		warpSpeed = !warpSpeed
	}

	function resizeCanvas() {
		if (!canvas) return
		canvas.width = window.innerWidth
		canvas.height = window.innerHeight
	}

	onMount(() => {
		if (canvas) {
			ctx = canvas.getContext("2d")
			resizeCanvas()

			// Initial black background
			if (ctx) {
				ctx.fillStyle = "#000"
				ctx.fillRect(0, 0, canvas.width, canvas.height)
			}

			initStars()
			animate()

			window.addEventListener("resize", resizeCanvas)
		}

		return () => {
			if (animationId) {
				cancelAnimationFrame(animationId)
			}
			window.removeEventListener("resize", resizeCanvas)
		}
	})

	onDestroy(() => {
		if (animationId) {
			cancelAnimationFrame(animationId)
		}
	})
</script>

<div class="relative w-full h-full">
	<!-- Canvas fills entire container -->
	<canvas bind:this={canvas} class="absolute inset-0 w-full h-full bg-black"></canvas>
</div>
