<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import SnakeGame from "./vibes/SnakeGame.svelte";
  import Game2048 from "./vibes/Game2048.svelte";
  import Tetris from "./vibes/Tetris.svelte";
  import Wordle from "./vibes/Wordle.svelte";
  import CatVideo from "./vibes/CatVideo.svelte";
  import LofiMusic from "./vibes/LofiMusic.svelte";
  import FancyArt from "./vibes/FancyArt.svelte";
  import MusicVibe from "./vibes/MusicVibe.svelte";
  import { vibe_zone_state } from "$lib/stores/vibe_zone.svelte";
  import Icon from "@iconify/svelte";

  let {
    enabled = true,
    isFullscreen = $bindable(false),
    onDismiss = () => {},
    onToggleEnabled = () => {},
  }: {
    userPrompt?: string;
    enabled?: boolean;
    isFullscreen?: boolean;
    onDismiss?: () => void;
    onToggleEnabled?: () => void;
  } = $props();

  type VibeId =
    | "snake"
    | "2048"
    | "tetris"
    | "wordle"
    | "video"
    | "lofi"
    | "museum"
    | "music";

  const vibeNames: Record<VibeId, string> = {
    snake: "Snake",
    "2048": "2048",
    tetris: "Tetris",
    wordle: "Wordle",
    video: "Cat Video",
    lofi: "Lo-fi Music",
    museum: "Fancy Art",
    music: "Music Maker",
  };

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (isFullscreen) {
        toggleFullscreen();
      } else {
        onDismiss();
      }
    }
  }

  // Setup keyboard handler on mount
  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });
</script>

<div
  transition:fade={{ duration: 200 }}
  class="fixed inset-0 bg-[var(--builder-bg-secondary)] z-50 flex flex-col"
>
  <!-- Top controls -->
  <div
    class="flex flex-wrap gap-2 justify-between items-center p-3 border-b border-[var(--builder-border)]"
  >
    <div class="text-[var(--builder-text-secondary)] text-sm font-sans">
      Vibe Zone{vibe_zone_state.current_vibe
        ? ` - ${vibeNames[vibe_zone_state.current_vibe]}`
        : ""}
    </div>
    <div class="flex items-center space-x-2">
      <button
        onclick={() => vibe_zone_state.hide_current_vibe()}
        class="px-2 py-1 text-xs border border-[var(--builder-border)] hover:border-red-500 text-[var(--builder-text-secondary)] hover:text-red-500 transition-colors rounded"
      >
        Hide
      </button>
      <button
        onclick={toggleFullscreen}
        class="px-2 py-1 text-xs border border-[var(--builder-border)] hover:border-[var(--builder-accent)] text-[var(--builder-text-secondary)] hover:text-[var(--builder-accent)] transition-colors rounded"
        title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      >
        <Icon
          icon={isFullscreen
            ? "heroicons:arrows-pointing-in-20-solid"
            : "heroicons:arrows-pointing-out-20-solid"}
          class="w-3.5 h-3.5"
        />
      </button>
      <button
        onclick={() => vibe_zone_state.next_vibe()}
        class="px-2 py-1 text-xs border border-[var(--builder-border)] hover:border-[var(--builder-accent)] text-[var(--builder-text-secondary)] hover:text-[var(--builder-accent)] transition-colors rounded"
      >
        Next →
      </button>
      <button
        onclick={onDismiss}
        class="px-2 py-1 text-xs border border-[var(--builder-border)] hover:border-[var(--builder-accent)] text-[var(--builder-text-secondary)] hover:text-[var(--builder-accent)] transition-colors rounded"
      >
        Close
      </button>
      <div class="h-4 w-px bg-[var(--builder-border)] mx-1"></div>
      <button
        type="button"
        onclick={onToggleEnabled}
        class="flex items-center gap-2 px-2 py-1 text-xs text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] transition-colors"
      >
        <span>Enable</span>
        <span
          role="switch"
          aria-checked={enabled}
          class="relative inline-flex h-4 w-7 items-center rounded-full transition-colors {enabled
            ? 'bg-[var(--builder-accent)]'
            : 'bg-[var(--builder-border)]'}"
        >
          <span
            class="inline-block h-3 w-3 transform rounded-full bg-white transition-transform {enabled
              ? 'translate-x-3.5'
              : 'translate-x-0.5'}"
          ></span>
        </span>
      </button>
    </div>
  </div>

  <!-- Vibe content (scrollable, centered) -->
  <div class="flex-1 overflow-y-auto p-4 flex items-center justify-center">
    {#key vibe_zone_state.current_vibe}
      {#if vibe_zone_state.is_loading}
        <div class="flex flex-col items-center space-y-4 py-8">
          <div class="text-[var(--builder-accent)] animate-spin">
            <Icon icon="heroicons:bolt-20-solid" class="w-8 h-8" />
          </div>
          <div
            class="text-[var(--builder-text-secondary)] font-sans text-sm animate-pulse"
          >
            Loading vibe...
          </div>
        </div>
      {:else if vibe_zone_state.shuffled_vibes.length === 0}
        <div class="flex flex-col items-center space-y-4 py-8">
          <div class="text-[var(--builder-accent)]">
            <Icon icon="heroicons:eye-slash-20-solid" class="w-12 h-12" />
          </div>
          <div class="text-[var(--builder-text-secondary)] font-sans text-sm">
            All vibes hidden!
          </div>
          <button
            onclick={() => vibe_zone_state.restore_all_vibes()}
            class="px-4 py-2 bg-[var(--builder-accent)] text-[var(--builder-bg-primary)] font-sans text-sm hover:opacity-90 transition-opacity rounded"
          >
            Restore All Vibes
          </button>
        </div>
      {:else if vibe_zone_state.current_vibe === "snake"}
        <SnakeGame />
      {:else if vibe_zone_state.current_vibe === "2048"}
        <Game2048 />
      {:else if vibe_zone_state.current_vibe === "tetris"}
        <Tetris />
      {:else if vibe_zone_state.current_vibe === "wordle"}
        <Wordle />
      {:else if vibe_zone_state.current_vibe === "video"}
        <CatVideo />
      {:else if vibe_zone_state.current_vibe === "lofi"}
        <LofiMusic />
      {:else if vibe_zone_state.current_vibe === "museum"}
        <FancyArt />
      {:else if vibe_zone_state.current_vibe === "music"}
        <MusicVibe />
      {/if}
    {/key}
  </div>
</div>
