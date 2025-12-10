<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null;
  let animationId: number;
  let currentPattern = 0;

  const patterns = [
    { name: "Spiral Waves", draw: drawSpiralWaves },
    { name: "Particle Flow", draw: drawParticleFlow },
    { name: "Geometric Dance", draw: drawGeometricDance },
    { name: "Color Waves", draw: drawColorWaves },
  ];

  let time = 0;

  function drawSpiralWaves(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    t: number
  ) {
    ctx.fillStyle = "rgba(26, 26, 26, 0.1)";
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;

    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + t * 0.001;
      const radius = 80 + Math.sin(t * 0.002 + i) * 40;

      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;

      ctx.beginPath();
      ctx.arc(x, y, 5 + Math.sin(t * 0.003 + i) * 3, 0, Math.PI * 2);

      const hue = (t * 0.05 + i * 30) % 360;
      ctx.fillStyle = `hsla(${hue}, 70%, 60%, 0.8)`;
      ctx.fill();

      // Draw connecting lines
      for (let j = i + 1; j < 12; j++) {
        const angle2 = (j / 12) * Math.PI * 2 + t * 0.001;
        const radius2 = 80 + Math.sin(t * 0.002 + j) * 40;
        const x2 = centerX + Math.cos(angle2) * radius2;
        const y2 = centerY + Math.sin(angle2) * radius2;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `hsla(${hue}, 70%, 60%, 0.1)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  function drawParticleFlow(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    t: number
  ) {
    ctx.fillStyle = "rgba(26, 26, 26, 0.05)";
    ctx.fillRect(0, 0, width, height);

    const particles = 50;
    for (let i = 0; i < particles; i++) {
      const progress = (t * 0.0005 + i / particles) % 1;
      const x = width * progress;
      const y = height / 2 + Math.sin(progress * Math.PI * 4 + i) * 100;

      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);

      const hue = (progress * 360 + t * 0.1) % 360;
      ctx.fillStyle = `hsla(${hue}, 80%, 60%, ${1 - progress})`;
      ctx.fill();
    }
  }

  function drawGeometricDance(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    t: number
  ) {
    ctx.fillStyle = "rgba(26, 26, 26, 0.1)";
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;

    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(t * 0.001 + (i * Math.PI) / 3);

      const size = 60 + Math.sin(t * 0.002 + i) * 20;

      ctx.beginPath();
      for (let j = 0; j < 6; j++) {
        const angle = (j / 6) * Math.PI * 2;
        const x = Math.cos(angle) * size;
        const y = Math.sin(angle) * size;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      const hue = (t * 0.05 + i * 60) % 360;
      ctx.strokeStyle = `hsla(${hue}, 70%, 60%, 0.6)`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();
    }
  }

  function drawColorWaves(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    t: number
  ) {
    ctx.fillStyle = "rgb(26, 26, 26)";
    ctx.fillRect(0, 0, width, height);

    const waves = 8;
    for (let i = 0; i < waves; i++) {
      ctx.beginPath();
      ctx.moveTo(0, height / 2);

      for (let x = 0; x <= width; x += 5) {
        const y =
          height / 2 +
          Math.sin(x * 0.01 + t * 0.001 + i * 0.5) * 30 +
          Math.sin(x * 0.02 + t * 0.002 - i * 0.3) * 20;
        ctx.lineTo(x, y);
      }

      const hue = (t * 0.05 + i * 45) % 360;
      ctx.strokeStyle = `hsla(${hue}, 70%, 60%, 0.5)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function animate() {
    if (!ctx || !canvas) return;

    time += 16;
    const pattern = patterns[currentPattern];
    pattern.draw(ctx, canvas.width, canvas.height, time);

    animationId = requestAnimationFrame(animate);
  }

  function nextPattern() {
    currentPattern = (currentPattern + 1) % patterns.length;
    time = 0;
    if (ctx && canvas) {
      ctx.fillStyle = "rgb(26, 26, 26)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  onMount(() => {
    if (canvas) {
      ctx = canvas.getContext("2d");
      canvas.width = 600;
      canvas.height = 400;
      animate();
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  });

  onDestroy(() => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
  });
</script>

<div class="flex flex-col items-center justify-center space-y-6">
  <!-- Canvas -->
  <div class="border-2 border-[#2a2a2a] rounded-lg overflow-hidden">
    <canvas bind:this={canvas} class="block"></canvas>
  </div>

  <!-- Pattern Info -->
  <div class="text-center">
    <div class="text-white font-sans text-lg">
      {patterns[currentPattern].name}
    </div>
    <div class="text-gray-500 text-sm">
      Pattern {currentPattern + 1} of {patterns.length}
    </div>
  </div>

  <!-- Controls -->
  <div class="flex items-center space-x-4">
    <button
      onclick={nextPattern}
      class="px-6 py-3 bg-orange-500 text-black font-sans hover:bg-orange-600 transition-colors"
    >
      Next Pattern
    </button>
  </div>

  <!-- Description -->
  <div class="text-gray-600 text-xs font-sans text-center max-w-md">
    <p>Hypnotic patterns generated in real-time</p>
    <p class="mt-1">Let the colors flow while the AI works ✨</p>
  </div>
</div>
