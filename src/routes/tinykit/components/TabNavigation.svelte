<script lang="ts">
  import { fade } from "svelte/transition";
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import type { TabId } from "../types";
  import type { ComponentType } from "svelte";

  type Tab = {
    id: TabId;
    label: string;
    icon: ComponentType;
    shortcut: string;
  };

  type TabNavigationProps = {
    tabs: Tab[];
    current_tab: TabId;
    on_tab_change: (tab: TabId) => void;
  };

  let {
    tabs,
    current_tab = $bindable(),
    on_tab_change,
  }: TabNavigationProps = $props();

  let tab_nav_ref: HTMLElement | null = null;
  let show_left_shadow = $state(false);
  let show_right_shadow = $state(false);
  let left_shadow_opacity = $state(0);
  let right_shadow_opacity = $state(0);
  let mod_key_held = writable(false);

  // Update scroll shadows based on scroll position
  function update_scroll_shadows() {
    if (!tab_nav_ref) return;

    const { scrollLeft, scrollWidth, clientWidth } = tab_nav_ref;
    const max_scroll = scrollWidth - clientWidth;
    const fade_distance = 80; // pixels over which to fade in

    // Calculate left shadow opacity (fades in as you scroll right)
    const left_opacity = Math.min(scrollLeft / fade_distance, 1);
    show_left_shadow = scrollLeft > 0;
    left_shadow_opacity = left_opacity;

    // Calculate right shadow opacity (fades in as you approach the right edge)
    const distance_from_right = max_scroll - scrollLeft;
    const right_opacity = Math.min(distance_from_right / fade_distance, 1);
    show_right_shadow = scrollLeft < max_scroll - 1;
    right_shadow_opacity = right_opacity;
  }

  // Keyboard shortcuts
  function handle_key_down(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey) {
      mod_key_held.set(true);

      // Map number keys to tabs (works even when focused on input/textarea)
      const key_number = parseInt(e.key);
      if (key_number >= 1 && key_number <= tabs.length) {
        e.preventDefault();
        const tab = tabs[key_number - 1];
        if (tab) {
          current_tab = tab.id;
          on_tab_change(tab.id);
        }
      }
    }
  }

  function handle_key_up(e: KeyboardEvent) {
    if (!e.metaKey && !e.ctrlKey) {
      mod_key_held.set(false);
    }
  }

  // Set up keyboard shortcuts
  onMount(() => {
    window.addEventListener("keydown", handle_key_down);
    window.addEventListener("keyup", handle_key_up);

    return () => {
      window.removeEventListener("keydown", handle_key_down);
      window.removeEventListener("keyup", handle_key_up);
    };
  });

  // Set up scroll shadows when tab_nav_ref is available
  $effect(() => {
    if (!tab_nav_ref) return;

    // Initial calculation after small delay
    const timeout = setTimeout(() => {
      update_scroll_shadows();
    }, 100);

    const resize_observer = new ResizeObserver(() => {
      update_scroll_shadows();
    });
    resize_observer.observe(tab_nav_ref);

    // Update shadows on scroll
    tab_nav_ref.addEventListener("scroll", update_scroll_shadows);

    // Cleanup
    return () => {
      clearTimeout(timeout);
      resize_observer.disconnect();
      tab_nav_ref?.removeEventListener("scroll", update_scroll_shadows);
    };
  });
</script>

<nav class="h-10 border-b border-[var(--builder-border)] relative">
  <div
    bind:this={tab_nav_ref}
    class="flex h-full overflow-x-auto"
    style="scrollbar-width: none; -ms-overflow-style: none;"
  >
    {#each tabs as tab}
      <button
        data-tab-id={tab.id}
        class="px-6 h-full flex items-center space-x-2 text-xs font-sans relative transition-colors whitespace-nowrap flex-shrink-0 {current_tab ===
        tab.id
          ? 'text-[var(--builder-text-primary)]'
          : 'text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)]'}"
        onclick={() => {
          current_tab = tab.id;
          on_tab_change(tab.id);
        }}
      >
        <span
          class="flex items-center space-x-2"
          class:invisible={$mod_key_held}
        >
          <svelte:component this={tab.icon} class="w-3 h-3" />
          <span>{tab.label}</span>
        </span>
        {#if $mod_key_held}
          <span
            class="absolute inset-0 flex items-center justify-center text-xs"
            >⌘{tab.shortcut}</span
          >
        {/if}
        {#if current_tab === tab.id}
          <div
            in:fade={{ duration: 200 }}
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--builder-accent)]"
          ></div>
        {/if}
      </button>
    {/each}
  </div>
  <!-- Scroll shadows -->
  {#if show_left_shadow}
    <div
      class="absolute left-0 top-0 bottom-0 w-20 pointer-events-none transition-opacity duration-150"
      style="opacity: {left_shadow_opacity}; background: linear-gradient(to right, var(--builder-bg-primary) 0%, color-mix(in srgb, var(--builder-bg-primary) 80%, transparent) 30%, transparent 100%);"
    ></div>
  {/if}
  {#if show_right_shadow}
    <div
      class="absolute right-0 top-0 bottom-0 w-20 pointer-events-none transition-opacity duration-150"
      style="opacity: {right_shadow_opacity}; background: linear-gradient(to left, var(--builder-bg-primary) 0%, color-mix(in srgb, var(--builder-bg-primary) 80%, transparent) 30%, transparent 100%);"
    ></div>
  {/if}
</nav>
