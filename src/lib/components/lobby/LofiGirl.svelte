<script lang="ts">
  let isMuted = $state(true); // Start muted so autoplay works (browser requirement)
</script>

<div
  class="flex flex-col items-center justify-center space-y-6 max-w-3xl mx-auto px-8"
>
  <!-- YouTube Player -->
  <div
    class="border-2 border-[#2a2a2a] rounded-lg overflow-hidden bg-black"
    style="width: 600px; height: 340px;"
  >
    <iframe
      width="600"
      height="340"
      src="https://www.youtube.com/embed/jfKfPfyJRdk?autoplay=1&mute={isMuted
        ? '1'
        : '0'}&loop=1&playlist=jfKfPfyJRdk"
      title="Lofi Girl - 24/7 Stream"
      frameborder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
    ></iframe>
  </div>

  <!-- Controls -->
  <div class="flex items-center space-x-4">
    <button
      onclick={() => (isMuted = !isMuted)}
      class="px-6 py-3 border border-[#2a2a2a] text-gray-400 font-sans hover:border-orange-500 hover:text-orange-500 transition-colors"
    >
      {isMuted ? "🔇 Unmute" : "🔊 Mute"}
    </button>
  </div>

  <!-- Info -->
  <div class="text-gray-600 text-xs font-sans text-center space-y-1">
    <p>🎵 Study beats for deep focus</p>
    <p class="text-gray-700 mt-2">Click unmute to hear the music ✨</p>
  </div>
</div>
