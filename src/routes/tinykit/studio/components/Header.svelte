<script lang="ts">
  import Logo from "$lib/assets/Logo.svelte";
  import { fade } from "svelte/transition";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as Popover from "$lib/components/ui/popover";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { HelpCircle, ChevronRight, ChevronDown, LogOut } from "lucide-svelte";
  import BuilderThemePicker from "./BuilderThemePicker.svelte";
  import { auth } from "$lib/pocketbase.svelte";
  import { watch } from "runed";

  import { ExternalLink, Check, Loader2, Rocket } from "lucide-svelte";

  import type { TabId, PreviewPosition } from "../../types";
  import type { ComponentType } from "svelte";
  import { PanelLeft, PanelRight, PanelBottom } from "lucide-svelte";

  type Tab = {
    id: TabId;
    label: string;
    icon: ComponentType;
    shortcut: string;
  };

  type HeaderProps = {
    project_title: string;
    project_domain: string;
    is_deploying: boolean;
    vibe_zone_enabled: boolean;
    preview_position: PreviewPosition;
    save_status: {
      is_saving: boolean;
      has_unsaved: boolean;
      last_saved_at: Date | null;
    };
    tabs: Tab[];
    current_tab: TabId;
    active_tool_tabs?: Set<TabId>;
    on_tab_change: (tab: TabId) => void;
    on_deploy: () => void;
    on_load_templates: () => void;
    on_download_project: () => void;
    on_reset_project: () => void;
    on_toggle_vibe_zone?: () => void;
    is_mobile?: boolean;
  };

  let {
    project_title = $bindable(),
    project_domain = "",
    is_deploying,
    vibe_zone_enabled,
    preview_position = $bindable(),
    save_status = { is_saving: false, has_unsaved: false, last_saved_at: null },
    tabs,
    current_tab,
    active_tool_tabs = new Set(),
    on_tab_change,
    on_deploy,
    on_load_templates,
    on_download_project,
    on_reset_project,
    on_toggle_vibe_zone,
    is_mobile = false,
  }: HeaderProps = $props();

  const position_options: {
    id: PreviewPosition;
    label: string;
    icon: typeof PanelRight;
  }[] = [
    { id: "left", label: "Left", icon: PanelLeft },
    { id: "bottom", label: "Bottom", icon: PanelBottom },
    { id: "right", label: "Right", icon: PanelRight },
  ];

  let mod_key_held = $state(false);

  // Keyboard shortcuts for tabs
  function handle_key_down(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey) {
      mod_key_held = true;

      const key_number = parseInt(e.key);
      if (key_number >= 1 && key_number <= tabs.length) {
        e.preventDefault();
        const tab = tabs[key_number - 1];
        if (tab) {
          on_tab_change(tab.id);
        }
      }
    } else {
      // Reset if modifier not held (defensive)
      mod_key_held = false;
    }
  }

  function handle_key_up(e: KeyboardEvent) {
    if (!e.metaKey && !e.ctrlKey) {
      mod_key_held = false;
    }
  }

  function reset_mod_key() {
    mod_key_held = false;
  }

  onMount(() => {
    window.addEventListener("keydown", handle_key_down);
    window.addEventListener("keyup", handle_key_up);
    // Reset when window loses focus (prevents stuck state)
    window.addEventListener("blur", reset_mod_key);
    document.addEventListener("visibilitychange", reset_mod_key);

    return () => {
      window.removeEventListener("keydown", handle_key_down);
      window.removeEventListener("keyup", handle_key_up);
      window.removeEventListener("blur", reset_mod_key);
      document.removeEventListener("visibilitychange", reset_mod_key);
    };
  });

  let show_deploy_popover = $state(false);
  let deploy_url = $state("");
  let deploy_success = $state(false);

  // Watch for deploy completion
  let was_deploying = $state(false);

  // Check if this header instance should show popover based on screen size
  function should_show_popover(): boolean {
    if (typeof window === "undefined") return false;
    const is_mobile_screen = window.innerWidth < 768; // md breakpoint
    // Show popover only if this instance matches the current screen size
    return is_mobile === is_mobile_screen;
  }

  watch(
    () => is_deploying,
    (current_deploying) => {
      if (was_deploying && !current_deploying) {
        // Deploy just finished - show popover immediately
        // Use project's domain if available, otherwise fall back to current origin
        if (project_domain) {
          // Check if the domain already has a protocol
          deploy_url = project_domain.startsWith("http")
            ? project_domain
            : `https://${project_domain}`;
        } else {
          deploy_url = window.location.origin;
        }
        deploy_success = true;
        // Only show popover on the header that matches current screen size
        if (should_show_popover()) {
          show_deploy_popover = true;
        }
        // Reset everything after 10 seconds
        setTimeout(() => {
          show_deploy_popover = false;
          deploy_success = false;
        }, 10000);
      }
      was_deploying = current_deploying;
    },
  );

  let show_help_dialog = $state(false);
  let expanded_sections = $state({
    design: false,
    content: false,
    data: false,
    snapshots: false,
    shortcuts: false,
  });

  function format_time(date: Date): string {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  let is_editing_title = $state(false);
  let title_input_value = $state(project_title);

  function start_editing_title() {
    is_editing_title = true;
    title_input_value = project_title;
    setTimeout(() => {
      const input = document.querySelector("header input") as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  function finish_editing_title() {
    is_editing_title = false;
    project_title = title_input_value;
  }

  function handle_title_keydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      title_input_value = project_title;
      (e.target as HTMLInputElement).blur();
    }
  }

  function handle_logout() {
    auth.logout();
    goto("/login");
  }
</script>

{#if is_mobile}
  <!-- Mobile Bottom Toolbar -->
  <header
    class="h-14 border-t border-[var(--builder-border)] bg-[var(--builder-bg-primary)] flex items-center justify-between px-4 flex-shrink-0 relative z-30"
  >
    <!-- Left: Logo -->
    <a href="/tinykit/dashboard" class="logo">
      <Logo />
    </a>

    <!-- Center: Tab Dropdown -->
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button
          variant="ghost"
          size="sm"
          class="font-sans text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)] gap-2"
        >
          {#each tabs as tab}
            {#if tab.id === current_tab}
              {@const Icon = tab.icon}
              <Icon class="w-4 h-4" />
              <span>{tab.label}</span>
            {/if}
          {/each}
          <ChevronDown class="w-3 h-3 text-[var(--builder-text-secondary)]" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="center" class="w-48">
        {#each tabs as tab}
          {@const Icon = tab.icon}
          {@const is_tool_active = active_tool_tabs.has(tab.id)}
          {@const tool_class = is_tool_active ? `tool-active tool-active--${tab.id}` : ''}
          <DropdownMenu.Item
            onclick={() => on_tab_change(tab.id)}
            class="cursor-pointer hover:bg-[var(--builder-bg-secondary)] flex items-center gap-3 py-3 text-base {current_tab ===
            tab.id
              ? 'bg-[var(--builder-bg-secondary)]'
              : ''} {tool_class}"
          >
            <Icon class="w-5 h-5" />
            <span>{tab.label}</span>
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>

    <!-- Right: Deploy -->
    <div class="relative">
      <Button
        onclick={on_deploy}
        disabled={is_deploying}
        size="sm"
        class="font-sans relative"
      >
        <span class={is_deploying || deploy_success ? "invisible" : ""}
          >Deploy</span
        >
        {#if is_deploying}
          <span class="absolute inset-0 flex items-center justify-center">
            <Loader2 size={16} class="animate-spin" />
          </span>
        {:else if deploy_success}
          <span class="absolute inset-0 flex items-center justify-center">
            <Check size={16} class="text-green-400" />
          </span>
        {/if}
      </Button>
      <Popover.Root bind:open={show_deploy_popover}>
        <Popover.Trigger
          class="absolute inset-0 opacity-0 pointer-events-none"
        />
        <Popover.Content
          class="w-auto p-3 bg-[var(--builder-bg-secondary)] border-[var(--builder-border)]"
          align="end"
          side="top"
        >
          <div class="flex items-center gap-2 text-sm">
            <Rocket size={16} class="text-[var(--builder-accent)]" />
            <span class="text-[var(--builder-text-primary)]">Deployed!</span>
          </div>
          <a
            href={deploy_url}
            target="_blank"
            rel="noopener noreferrer"
            class="mt-2 flex items-center gap-1.5 text-xs text-[var(--builder-accent)] hover:underline"
          >
            <ExternalLink size={12} />
            {deploy_url}
          </a>
        </Popover.Content>
      </Popover.Root>
    </div>
  </header>
{:else}
  <!-- Desktop Header -->
  <header
    class="h-12 border-b bg-[var(--builder-bg-primary)] flex items-center justify-between px-4 relative z-30"
    style="border-color: color-mix(in srgb, var(--builder-border) 40%, transparent)"
  >
    <!-- Left: Logo -->
    <div class="flex items-center space-x-3 flex-shrink-0">
      <a href="/tinykit/dashboard" class="logo">
        <Logo />
      </a>
      <!-- Project name and save status -->
      <span class="text-[var(--builder-text-secondary)]">·</span>
      <div class="flex items-center">
        {#if is_editing_title}
          <input
            type="text"
            bind:value={title_input_value}
            onblur={finish_editing_title}
            onkeydown={handle_title_keydown}
            class="text-[var(--builder-text-primary)] text-sm bg-transparent border-b border-[var(--builder-accent)] focus:outline-none px-1"
          />
        {:else}
          <button
            onclick={start_editing_title}
            class="text-[var(--builder-text-secondary)] text-sm hover:text-[var(--builder-text-primary)] transition-colors"
          >
            {project_title}
          </button>
        {/if}
        <!-- Save status indicator -->
        {#if save_status.is_saving || save_status.has_unsaved || save_status.last_saved_at}
          <Popover.Root>
            <Popover.Trigger>
              {#if save_status.is_saving}
                <span
                  class="w-2 h-2 rounded-full bg-amber-400 animate-pulse cursor-help"
                ></span>
              {:else if save_status.has_unsaved}
                <span class="w-2 h-2 rounded-full bg-amber-400 cursor-help"
                ></span>
              {:else}
                <span class="w-2 h-2 rounded-full bg-green-400 cursor-help"
                ></span>
              {/if}
            </Popover.Trigger>
            <Popover.Content class="w-auto px-3 py-2 text-xs">
              {#if save_status.is_saving}
                <span class="text-amber-400">Saving...</span>
              {:else if save_status.has_unsaved}
                <span class="text-amber-400">Unsaved changes</span>
              {:else if save_status.last_saved_at}
                <span class="text-green-400"
                  >Saved at {format_time(save_status.last_saved_at)}</span
                >
              {/if}
            </Popover.Content>
          </Popover.Root>
        {/if}
      </div>
    </div>

    <!-- Center: Horizontal Tabs -->
    <nav class="flex flex-1 justify-center">
      <div class="flex items-center">
        {#each tabs as tab}
          {@const Icon = tab.icon}
          {@const is_tool_active = active_tool_tabs.has(tab.id)}
          <button
            data-tab-id={tab.id}
            class="pl-3 pr-4 h-12 flex items-center gap-1.5 text-xs font-sans relative transition-colors whitespace-nowrap {current_tab ===
            tab.id
              ? 'text-[var(--builder-text-primary)]'
              : 'text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)]'}"
            class:tool-active={is_tool_active}
            class:tool-active--code={is_tool_active && tab.id === "code"}
            class:tool-active--content={is_tool_active && tab.id === "content"}
            class:tool-active--design={is_tool_active && tab.id === "design"}
            class:tool-active--data={is_tool_active && tab.id === "data"}
            onclick={() => on_tab_change(tab.id)}
          >
            <span
              class="flex items-center gap-2"
              class:invisible={mod_key_held}
            >
              <Icon class="w-3 h-3" />
              <span>{tab.label}</span>
            </span>
            {#if mod_key_held}
              <span
                class="absolute inset-0 flex items-center justify-center text-xs"
              >
                ⌘{tab.shortcut}
              </span>
            {/if}
            {#if current_tab === tab.id}
              <div
                in:fade={{ duration: 100 }}
                class="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--builder-accent)]"
              ></div>
            {/if}
          </button>
        {/each}
      </div>
    </nav>

    <!-- Right: Actions -->
    <div class="flex items-center space-x-2 flex-shrink-0">
      <button
        onclick={() => (show_help_dialog = true)}
        class="p-1.5 rounded text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)] transition-colors"
        title="Help"
      >
        <HelpCircle size={18} />
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Button
            variant="ghost"
            size="sm"
            class="font-sans text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)] hover:bg-[var(--builder-bg-secondary)]"
            >⋮</Button
          >
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-64">
          <button
            type="button"
            class="w-full px-2 py-2 hover:bg-[var(--builder-bg-secondary)] cursor-pointer rounded-sm text-left"
            onclick={() => on_toggle_vibe_zone?.()}
          >
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">Vibe Zone</span>
              <span
                role="switch"
                aria-checked={vibe_zone_enabled}
                aria-label="Toggle Vibe Zone"
                class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 {vibe_zone_enabled
                  ? 'bg-[var(--builder-accent)]'
                  : 'bg-[var(--builder-border)]'}"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {vibe_zone_enabled
                    ? 'translate-x-5'
                    : 'translate-x-0.5'}"
                ></span>
              </span>
            </div>
            <p class="text-xs text-[var(--builder-text-secondary)] mt-1">
              Games, music, and art while you wait
            </p>
          </button>
          <DropdownMenu.Separator />
          <BuilderThemePicker />
          <DropdownMenu.Separator />
          <!-- Preview Position Selector -->
          <div class="px-2 py-2">
            <span
              class="text-xs text-[var(--builder-text-secondary)] mb-2 block"
              >Preview Position</span
            >
            <div class="flex gap-1">
              {#each position_options as option}
                {@const Icon = option.icon}
                <button
                  type="button"
                  onclick={() => (preview_position = option.id)}
                  class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors {preview_position ===
                  option.id
                    ? 'bg-[var(--builder-accent)] text-white'
                    : 'bg-[var(--builder-bg-tertiary)] text-[var(--builder-text-secondary)] hover:bg-[var(--builder-bg-secondary)] hover:text-[var(--builder-text-primary)]'}"
                  title="Preview on {option.label}"
                >
                  <Icon size={14} />
                  <span class="hidden sm:inline">{option.label}</span>
                </button>
              {/each}
            </div>
          </div>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            onclick={() => {
              on_load_templates();
            }}
            class="cursor-pointer hover:bg-[var(--builder-bg-secondary)]"
          >
            Load Template
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onclick={on_download_project}
            class="cursor-pointer hover:bg-[var(--builder-bg-secondary)]"
          >
            Download Project File
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            onclick={on_reset_project}
            class="text-red-400 hover:text-red-300 hover:bg-[var(--builder-bg-secondary)] cursor-pointer"
          >
            Reset Project
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            onclick={handle_logout}
            class="cursor-pointer hover:bg-[var(--builder-bg-secondary)] flex items-center gap-2"
          >
            <LogOut size={14} />
            Sign Out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <div class="relative">
        <Button
          onclick={on_deploy}
          disabled={is_deploying}
          size="sm"
          class="font-sans relative"
        >
          <span class={is_deploying || deploy_success ? "invisible" : ""}
            >Deploy</span
          >
          {#if is_deploying}
            <span class="absolute inset-0 flex items-center justify-center">
              <Loader2 size={16} class="animate-spin" />
            </span>
          {:else if deploy_success}
            <span class="absolute inset-0 flex items-center justify-center">
              <Check size={16} class="text-green-400" />
            </span>
          {/if}
        </Button>
        <Popover.Root bind:open={show_deploy_popover}>
          <Popover.Trigger
            class="absolute inset-0 opacity-0 pointer-events-none"
          />
          <Popover.Content
            class="w-auto p-3 bg-[var(--builder-bg-secondary)] border-[var(--builder-border)]"
            align="end"
          >
            <div class="flex items-center gap-2 text-sm">
              <Rocket size={16} class="text-[var(--builder-accent)]" />
              <span class="text-[var(--builder-text-primary)]">Deployed!</span>
            </div>
            <a
              href={deploy_url}
              target="_blank"
              rel="noopener noreferrer"
              class="mt-2 flex items-center gap-1.5 text-xs text-[var(--builder-accent)] hover:underline"
            >
              <ExternalLink size={12} />
              {deploy_url}
            </a>
          </Popover.Content>
        </Popover.Root>
      </div>
    </div>
  </header>
{/if}

<!-- Help Dialog -->
<Dialog.Root bind:open={show_help_dialog}>
  <Dialog.Content class="help-dialog">
    <Dialog.Header>
      <Dialog.Title>tinykit Help</Dialog.Title>
      <Dialog.Description>
        Learn how to use the different features of tinykit.
        <a
          href="https://docs.tinykit.studio"
          target="_blank"
          rel="noopener noreferrer"
          class="ml-1 text-[var(--builder-accent)] hover:underline inline-flex items-center gap-0.5"
        >
          Read the Docs <ExternalLink size={12} />
        </a>
      </Dialog.Description>
    </Dialog.Header>

    <div class="help-sections">
      <!-- Design Fields -->
      <Collapsible.Root bind:open={expanded_sections.design}>
        <Collapsible.Trigger class="help-section-trigger">
          <ChevronRight
            size={16}
            class="chevron {expanded_sections.design ? 'rotated' : ''}"
          />
          <span>Design Fields</span>
        </Collapsible.Trigger>
        <Collapsible.Content class="help-section-content">
          <p>
            Design fields create CSS variables that are automatically included
            in your app. In JS, keys mirror CSS variables.
          </p>
          <div class="code-examples">
            <div class="code-example">
              <span class="code-label">In CSS:</span>
              <code>background: var(--primary-color);</code>
            </div>
            <div class="code-example">
              <span class="code-label">In JS:</span>
              <code
                >import design from '$design';<br
                />console.log(design['--primary-color']);</code
              >
            </div>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>

      <!-- Content Fields -->
      <Collapsible.Root bind:open={expanded_sections.content}>
        <Collapsible.Trigger class="help-section-trigger">
          <ChevronRight
            size={16}
            class="chevron {expanded_sections.content ? 'rotated' : ''}"
          />
          <span>Content Fields</span>
        </Collapsible.Trigger>
        <Collapsible.Content class="help-section-content">
          <p>
            Content fields let you manage app content without code changes.
            Import them directly using the '$content' module.
          </p>
          <div class="code-examples">
            <div class="code-example">
              <span class="code-label">Usage:</span>
              <code
                >{@html `import content from '$content';<br />const title = content.hero_title;`}
              </code>
            </div>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>

      <!-- Data Collections -->
      <Collapsible.Root bind:open={expanded_sections.data}>
        <Collapsible.Trigger class="help-section-trigger">
          <ChevronRight
            size={16}
            class="chevron {expanded_sections.data ? 'rotated' : ''}"
          />
          <span>Data Collections</span>
        </Collapsible.Trigger>
        <Collapsible.Content class="help-section-content">
          <p>
            Data collections store JSON arrays of records. Use the '$data'
            module for a database client with realtime updates.
          </p>
          <div class="code-examples">
            <div class="code-example">
              <span class="code-label">Load data:</span>
              <code
                >{@html `import data from '$data';<br />const todos = await data.todos.list();`}</code
              >
            </div>
            <div class="code-example">
              <span class="code-label">Realtime:</span>
              <code
                >{@html `let todos = [];
data.todos.subscribe(records => {
  todos = records
});`}</code
              >
            </div>
            <div class="code-example">
              <span class="code-label">Create:</span>
              <code
                >{@html `await data.todos.create({ text: 'New Item' });`}</code
              >
            </div>
            <div class="code-example">
              <span class="code-label">Update:</span>
              <code
                >{@html `await data.todos.update('RECORD_ID', { done: true });`}</code
              >
            </div>
            <div class="code-example">
              <span class="code-label">Delete:</span>
              <code>{@html `await data.todos.delete('RECORD_ID');`}</code>
            </div>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>

      <!-- Snapshots -->
      <Collapsible.Root bind:open={expanded_sections.snapshots}>
        <Collapsible.Trigger class="help-section-trigger">
          <ChevronRight
            size={16}
            class="chevron {expanded_sections.snapshots ? 'rotated' : ''}"
          />
          <span>Snapshots & History</span>
        </Collapsible.Trigger>
        <Collapsible.Content class="help-section-content prose">
          <p>
            Snapshots let you save and restore your project state. Use them to
            experiment safely or undo changes.
          </p>
          <ul class="help-list">
            <li>Create snapshots before making big changes</li>
            <li>Restore any previous snapshot to roll back</li>
            <li>Snapshots include code, config, and design fields</li>
          </ul>
        </Collapsible.Content>
      </Collapsible.Root>

      <!-- Keyboard Shortcuts -->
      <Collapsible.Root bind:open={expanded_sections.shortcuts}>
        <Collapsible.Trigger class="help-section-trigger">
          <ChevronRight
            size={16}
            class="chevron {expanded_sections.shortcuts ? 'rotated' : ''}"
          />
          <span>Keyboard Shortcuts</span>
        </Collapsible.Trigger>
        <Collapsible.Content class="help-section-content">
          <div class="shortcuts-grid">
            <div class="shortcut"><kbd>⌘1</kbd> Agent tab</div>
            <div class="shortcut"><kbd>⌘2</kbd> Code tab</div>
            <div class="shortcut"><kbd>⌘3</kbd> Config tab</div>
            <div class="shortcut"><kbd>⌘4</kbd> Design tab</div>
            <div class="shortcut"><kbd>⌘5</kbd> Data tab</div>
            <div class="shortcut"><kbd>⌘6</kbd> History tab</div>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(.help-dialog) {
    max-width: 520px;
  }

  .help-sections {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 16px 0;
    max-height: 400px;
    overflow-y: auto;
  }

  :global(.help-section-trigger) {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--builder-bg-secondary);
    border: none;
    color: var(--builder-text-primary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  :global(.help-section-trigger:hover) {
    background: var(--builder-bg-tertiary);
  }

  :global(.help-section-trigger .chevron) {
    color: var(--builder-text-secondary);
    transition: transform 0.2s;
  }

  :global(.help-section-trigger .chevron.rotated) {
    transform: rotate(90deg);
  }

  :global(.help-section-content) {
    padding: 12px 16px 16px 36px;
    font-size: 12px;
    color: var(--builder-text-secondary);
    line-height: 1.5;
    border-left: 1px solid var(--builder-border);
    border-right: 1px solid var(--builder-border);
  }

  :global(.help-section-content) p {
    margin: 0 0 10px;
  }

  .code-examples {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 10px 0;
  }

  .code-example {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .code-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--builder-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .code-examples code,
  :global(.help-section-content) code {
    display: block;
    padding: 8px 10px;
    background: var(--builder-bg-tertiary);
    border-radius: 4px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: var(--builder-accent);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .help-note {
    font-size: 11px;
    opacity: 0.8;
  }

  .help-note code {
    display: inline;
    padding: 1px 4px;
    font-size: 10px;
  }

  .help-list {
    margin: 8px 0;
    padding-left: 16px;
  }

  .help-list li {
    margin: 4px 0;
  }

  .shortcuts-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .shortcut {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--builder-text-secondary);
  }

  .shortcut kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    padding: 2px 6px;
    background: var(--builder-bg-tertiary);
    border: 1px solid var(--builder-border);
    border-radius: 4px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: var(--builder-text-primary);
  }

  .logo {
    transition: opacity;
  }

  .logo:hover {
    opacity: 0.8;
  }

  /* Tool active glow effects - momentary flash */
  .tool-active {
    animation: tool-flash 0.8s ease-out forwards;
  }

  .tool-active--code {
    color: var(--tool-code) !important;
    text-shadow: 0 0 12px color-mix(in srgb, var(--tool-code) 80%, transparent);
  }

  .tool-active--content {
    color: var(--tool-content) !important;
    text-shadow: 0 0 12px color-mix(in srgb, var(--tool-content) 80%, transparent);
  }

  .tool-active--design {
    color: var(--tool-design) !important;
    text-shadow: 0 0 12px color-mix(in srgb, var(--tool-design) 80%, transparent);
  }

  .tool-active--data {
    color: var(--tool-data) !important;
    text-shadow: 0 0 12px color-mix(in srgb, var(--tool-data) 80%, transparent);
  }

  @keyframes tool-flash {
    0% {
      opacity: 1;
      filter: brightness(1.3);
    }
    100% {
      opacity: 1;
      filter: brightness(1);
    }
  }
</style>
