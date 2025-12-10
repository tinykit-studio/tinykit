<script lang="ts">
  let isMuted = $state(true); // Start muted so autoplay works (browser requirement)
</script>

<div
  class="flex flex-col items-center justify-center space-y-6 max-w-3xl mx-auto px-8"
>
  <!-- YouTube Player - Daybreak -->
  <div
    class="border-2 border-[var(--builder-border)] rounded-lg overflow-hidden bg-black"
    style="width: 600px; height: 340px;"
  >
    <iframe
      width="600"
      height="340"
      src="https://www.youtube.com/embed/3TX_W_CMwT8?autoplay=1&mute={isMuted
        ? '1'
        : '0'}&loop=1&playlist=3TX_W_CMwT8"
      title="Daybreak"
      frameborder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
    ></iframe>
  </div>

  <!-- Controls -->
  <div class="flex items-center space-x-4">
    <button
      onclick={() => (isMuted = !isMuted)}
      class="px-6 py-3 border border-[var(--builder-border)] text-[var(--builder-text-secondary)] font-sans hover:border-[var(--builder-accent)] hover:text-[var(--builder-accent)] transition-colors rounded"
    >
      {isMuted ? "🔇 Unmute" : "🔊 Mute"}
    </button>
  </div>

  <!-- Info -->
  <div class="text-[var(--builder-text-muted)] text-xs font-sans text-center space-y-1">
    <p>🌅 Chill vibes while you wait</p>
    <p class="text-[var(--builder-text-muted)] mt-2">Click unmute to hear the music ✨</p>
  </div>
</div>
