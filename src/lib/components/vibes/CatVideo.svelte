<script lang="ts">
  import { onMount } from "svelte";

  let catImageUrl = $state("");
  let loading = $state(true);
  let error = $state(false);

  onMount(() => {
    fetchCatImage();
  });

  async function fetchCatImage() {
    loading = true;
    error = false;
    try {
      // Using The Cat API for random cat images/gifs
      const response = await fetch(
        "https://api.thecatapi.com/v1/images/search?mime_types=gif,jpg"
      );
      const data = await response.json();
      if (data && data[0] && data[0].url) {
        catImageUrl = data[0].url;
      } else {
        error = true;
      }
    } catch (e) {
      console.error("Failed to fetch cat:", e);
      error = true;
    } finally {
      loading = false;
    }
  }

  function nextCat() {
    fetchCatImage();
  }
</script>

<div class="flex flex-col items-center justify-center space-y-4">
  <div
    class="relative bg-black border-2 border-[#2a2a2a] rounded overflow-hidden"
    style="width: 600px; height: 400px;"
  >
    {#if loading}
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="text-gray-500 font-sans animate-pulse">Loading...</div>
      </div>
    {:else if error}
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="text-center">
          <div class="text-red-500 font-sans mb-4">Failed to load content</div>
          <button
            onclick={fetchCatImage}
            class="px-4 py-2 bg-orange-500 text-black font-sans hover:bg-orange-600 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    {:else}
      <img
        src={catImageUrl}
        alt="Random cat"
        class="w-full h-full object-contain"
      />
    {/if}
  </div>

  <div class="flex items-center space-x-4">
    <button
      onclick={nextCat}
      class="px-4 py-2 bg-orange-500 text-black font-sans hover:bg-orange-600 transition-colors disabled:opacity-50"
      disabled={loading}
    >
      Next Cat
    </button>
  </div>

  <div class="text-gray-500 text-sm font-sans text-center">
    <p>Powered by The Cat API</p>
    <p class="text-gray-600 text-xs mt-1">Random cat photos & GIFs</p>
  </div>
</div>
