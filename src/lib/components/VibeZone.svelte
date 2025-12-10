<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import SnakeGame from "./lobby/SnakeGame.svelte";
  import Game2048 from "./lobby/Game2048.svelte";
  import Tetris from "./lobby/Tetris.svelte";
  import Wordle from "./lobby/Wordle.svelte";
  import CatVideo from "./lobby/CatVideo.svelte";
  import GenerativeArt from "./lobby/GenerativeArt.svelte";
  import LofiGirl from "./lobby/LofiGirl.svelte";
  import Chillhop from "./lobby/Chillhop.svelte";
  import Daybreak from "./lobby/Daybreak.svelte";
  import MuseumMasterpiece from "./lobby/MuseumMasterpiece.svelte";
  import PhotographyShowcase from "./lobby/PhotographyShowcase.svelte";

  let {
    visible = false,
    userPrompt = "",
    enabled = true,
    onDismiss = () => {},
    onToggleEnabled = () => {},
  }: {
    visible?: boolean;
    userPrompt?: string;
    enabled?: boolean;
    onDismiss?: () => void;
    onToggleEnabled?: () => void;
  } = $props();

  type VibeId =
    | "snake"
    | "2048"
    | "tetris"
    | "wordle"
    | "art"
    | "video"
    | "lofigirl"
    | "chillhop"
    | "daybreak"
    | "museum"
    | "photography";

  const vibeNames: Record<VibeId, string> = {
    snake: "Snake",
    "2048": "2048",
    tetris: "Tetris",
    wordle: "Wordle",
    art: "Generative Art",
    video: "Cat Video",
    lofigirl: "Lo-fi Girl",
    chillhop: "Chillhop",
    daybreak: "Daybreak",
    museum: "Museum Masterpiece",
    photography: "Photography",
  };

  let currentVibeIndex = $state(0);
  let isLoading = $state(true);
  let isFullscreen = $state(false);
  const allVibes: VibeId[] = [
    "snake",
    "2048",
    "tetris",
    "wordle",
    "art",
    "video",
    "lofigirl",
    "chillhop",
    "daybreak",
    "museum",
    "photography",
  ];

  let hiddenVibes = $state<string[]>([]);
  let shuffledVibes = $state<VibeId[]>([]);

  function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  function loadHiddenVibes() {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("vibezone-hidden");
    hiddenVibes = saved ? JSON.parse(saved) : [];
  }

  function saveHiddenVibes() {
    if (typeof window === "undefined") return;
    localStorage.setItem("vibezone-hidden", JSON.stringify(hiddenVibes));
  }

  function updateShuffledVibes() {
    const visibleVibes = allVibes.filter((vibe) => !hiddenVibes.includes(vibe));
    shuffledVibes = shuffleArray(visibleVibes);
  }

  function nextVibe() {
    if (shuffledVibes.length === 0) return;
    currentVibeIndex = (currentVibeIndex + 1) % shuffledVibes.length;
    saveCurrentVibe();
  }

  function saveCurrentVibe() {
    if (typeof window === "undefined") return;
    const vibe = shuffledVibes[currentVibeIndex];
    if (vibe) {
      localStorage.setItem("vibezone-current-vibe", vibe);
    }
  }

  function loadCurrentVibe() {
    if (typeof window === "undefined") return;
    const savedVibe = localStorage.getItem("vibezone-current-vibe") as VibeId | null;
    if (savedVibe && shuffledVibes.includes(savedVibe)) {
      const index = shuffledVibes.indexOf(savedVibe);
      if (index !== -1) {
        currentVibeIndex = index;
      }
    }
  }

  function hideCurrentVibe() {
    if (shuffledVibes.length === 0) return;
    const vibeToHide = shuffledVibes[currentVibeIndex];
    hiddenVibes = [...hiddenVibes, vibeToHide];
    saveHiddenVibes();
    updateShuffledVibes();

    // Move to next vibe or wrap to 0 if we're at the end
    if (currentVibeIndex >= shuffledVibes.length) {
      currentVibeIndex = 0;
    }
    saveCurrentVibe();
  }

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    if (typeof window !== "undefined") {
      localStorage.setItem("vibezone-fullscreen", isFullscreen.toString());
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && visible) {
      e.preventDefault();
      e.stopPropagation();
      if (isFullscreen) {
        // Exit fullscreen first
        toggleFullscreen();
      } else {
        // Close vibe lounge
        onDismiss();
      }
    }
  }

  // Load saved vibes and setup keyboard handler on mount
  onMount(() => {
    loadHiddenVibes();
    updateShuffledVibes();
    loadCurrentVibe();

    // Load fullscreen preference
    if (typeof window !== "undefined") {
      const savedFullscreen = localStorage.getItem("vibezone-fullscreen");
      isFullscreen = savedFullscreen === "true";
    }

    // Small delay to ensure components are ready
    setTimeout(() => {
      isLoading = false;
    }, 100);

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  let currentVibe = $derived(shuffledVibes[currentVibeIndex]);
</script>

{#if visible}
  <!-- Vibe Overlay - chat mode (absolute) or fullscreen mode (fixed) -->
  <div
    transition:fade={{ duration: 200 }}
    class="{isFullscreen
      ? 'fixed'
      : 'absolute'} inset-0 bg-[var(--builder-bg-secondary)] {isFullscreen
      ? 'z-50'
      : 'z-10'} flex flex-col"
  >
    <!-- Top controls -->
    <div
      class="flex justify-between items-center p-3 border-b border-[var(--builder-border)]"
    >
      <div class="text-[var(--builder-text-secondary)] text-sm font-sans">
        Vibe Zone{currentVibe ? ` - ${vibeNames[currentVibe]}` : ""}
      </div>
      <div class="flex items-center space-x-2">
        <button
          onclick={hideCurrentVibe}
          class="px-2 py-1 text-xs border border-[var(--builder-border)] hover:border-red-500 text-[var(--builder-text-secondary)] hover:text-red-500 transition-colors rounded"
        >
          Hide
        </button>
        <button
          onclick={toggleFullscreen}
          class="px-2 py-1 text-xs border border-[var(--builder-border)] hover:border-[var(--builder-accent)] text-[var(--builder-text-secondary)] hover:text-[var(--builder-accent)] transition-colors rounded"
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? "⛶" : "⛶"}
        </button>
        <button
          onclick={nextVibe}
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
      {#key currentVibe}
      {#if isLoading}
        <div class="flex flex-col items-center space-y-4 py-8">
          <div class="text-[var(--builder-accent)] text-3xl animate-spin">
            ⚡
          </div>
          <div
            class="text-[var(--builder-text-secondary)] font-sans text-sm animate-pulse"
          >
            Loading vibe...
          </div>
        </div>
      {:else if shuffledVibes.length === 0}
        <div class="flex flex-col items-center space-y-4 py-8">
          <div class="text-[var(--builder-accent)] text-3xl">🫥</div>
          <div class="text-[var(--builder-text-secondary)] font-sans text-sm">
            All vibes hidden!
          </div>
          <button
            onclick={() => {
              hiddenVibes = [];
              saveHiddenVibes();
              updateShuffledVibes();
            }}
            class="px-4 py-2 bg-[var(--builder-accent)] text-[var(--builder-bg-primary)] font-sans text-sm hover:opacity-90 transition-opacity rounded"
          >
            Restore All Vibes
          </button>
        </div>
      {:else if currentVibe === "snake"}
        <SnakeGame />
      {:else if currentVibe === "2048"}
        <Game2048 />
      {:else if currentVibe === "tetris"}
        <Tetris />
      {:else if currentVibe === "wordle"}
        <Wordle />
      {:else if currentVibe === "art"}
        <GenerativeArt />
      {:else if currentVibe === "video"}
        <CatVideo />
      {:else if currentVibe === "lofigirl"}
        <LofiGirl />
      {:else if currentVibe === "chillhop"}
        <Chillhop />
      {:else if currentVibe === "daybreak"}
        <Daybreak />
      {:else if currentVibe === "museum"}
        <MuseumMasterpiece />
      {:else if currentVibe === "photography"}
        <PhotographyShowcase />
      {/if}
      {/key}
    </div>
  </div>
{/if}
