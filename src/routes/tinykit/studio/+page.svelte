<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { watch } from "runed";
  import { page } from "$app/stores";
  import { goto, replaceState } from "$app/navigation";
  import {
    Sparkles,
    Code,
    Database,
    Clock,
    Palette,
    FileText,
    Loader2,
  } from "lucide-svelte";
  import { PaneGroup, Pane, PaneResizer, type PaneAPI } from "paneforge";
  import Preview from "$lib/components/Preview.svelte";
  import VibeZone from "./components/VibeZone.svelte";
  // Import components
  import Header from "./components/Header.svelte";
  import TemplatePicker from "./components/TemplatePicker.svelte";
  import DomainPicker from "./components/DomainPicker.svelte";
  import AgentPanel from "./panels/agent/AgentPanel.svelte";
  import CodePanel from "./panels/code/CodePanel.svelte";
  import ContentPanel from "./panels/content/ContentPanel.svelte";
  import DesignPanel from "./panels/design/DesignPanel.svelte";
  import DataPanel from "./panels/data/DataPanel.svelte";
  import HistoryPanel from "./panels/history/HistoryPanel.svelte";

  // Import types and utilities
  import type {
    TabId,
    Snapshot,
    PreviewError,
    EditorLanguage,
    Template,
    PendingPrompt,
    PreviewPosition,
  } from "../types";
  import * as api from "../lib/api.svelte";
  import * as storage from "../lib/storage";
  import { get_saved_theme, apply_builder_theme } from "$lib/builder_themes";
  import { setProjectContext } from "../context";
  import { pb } from "$lib/pocketbase.svelte";
  import { ProjectStore, setProjectStore } from "./project.svelte";
  import { play_complete, play_tap } from "$lib/sounds";

  // Get project_id and domain from server load
  let { data } = $props();

  // Resolve project ID (from URL or by domain lookup)
  let project_id = $state<string | null>(data.project_id);
  let is_resolving = $state(!data.project_id);

  // Sync project_id with data.project_id (handles navigation)
  $effect(() => {
    if (data.project_id && data.project_id !== project_id) {
      project_id = data.project_id;
      is_resolving = false;
    }
  });

  // Initialize Project Store stable instance
  const store = new ProjectStore(project_id || "");
  setProjectStore(store);

  // Set context synchronously so it is available to children immediately
  // We use a getter so logical access always gets current ID
  setProjectContext({
    get project_id() {
      return project_id || "";
    },
  });


  // Determine if we need to wait for something
  // If we have an ID, we load it. If not, we wait for resolution.

  // Resolve project by domain if no ID provided
  $effect(() => {
    if (!data.project_id && data.domain && !project_id) {
      // Look up project by domain using client auth
      pb.collection("_tk_projects")
        .getFirstListItem(`domain = "${data.domain}"`)
        .then((project) => {
          project_id = project.id;
          is_resolving = false;
        })
        .catch(() => {
          // No project for this domain, redirect to new project page
          goto(`/tinykit/new?domain=${encodeURIComponent(data.domain)}`);
        });
    }
  });

  // Load project when ID changes
  $effect(() => {
    if (project_id) {
      store.switch_project(project_id);

      // If store is somehow not initialized (redundancy check)
      if (!store.project && !store.loading && !store.error) {
        store.init();
      }
    }
  });

  // Cleanup store subscription on unmount
  onDestroy(() => {
    store.dispose();
  });

  // Valid tab IDs for validation
  const valid_tabs: TabId[] = [
    "agent",
    "data",
    "content",
    "design",
    "code",
    "history",
  ];

  // Map tool names to their corresponding tabs
  const tool_to_tab: Record<string, TabId> = {
    write_code: "code",
    create_content_field: "content",
    update_content_field: "content",
    create_design_field: "design",
    update_design_field: "design",
    create_data_file: "data",
    insert_records: "data",
    add_data_record: "data",
    update_data_record: "data",
    delete_data_record: "data",
  };

  // Track tool tabs that should flash momentarily
  let active_tool_tabs = $state(new Set<TabId>());
  let seen_tools = $state(new Set<string>()); // Track tools we've already processed

  // Watch for new tools and flash their tabs momentarily
  $effect(() => {
    if (!store) return;
    if (!store.is_processing) {
      // Reset when processing stops
      seen_tools = new Set();
      return;
    }

    const messages = store.messages;
    if (messages.length === 0) return;

    const last_msg = messages[messages.length - 1];
    if (last_msg.role !== "assistant" || !last_msg.stream_items) return;

    // Check for new tools
    for (const item of last_msg.stream_items) {
      if (item.type === "tool" && item.name) {
        // Create unique key for this tool call
        const tool_key = `${item.name}-${item.id || item.name}`;
        if (!seen_tools.has(tool_key)) {
          seen_tools.add(tool_key);
          const tab = tool_to_tab[item.name];
          if (tab) {
            // Flash this tab
            active_tool_tabs.add(tab);
            active_tool_tabs = new Set(active_tool_tabs); // trigger reactivity
            // Remove after brief flash
            setTimeout(() => {
              active_tool_tabs.delete(tab);
              active_tool_tabs = new Set(active_tool_tabs);
            }, 800);
          }
        }
      }
    }
  });

  // Read initial tab from URL query param, default to "data"
  function get_tab_from_url(): TabId {
    const url_tab = $page.url.searchParams.get("tab");
    if (url_tab && valid_tabs.includes(url_tab as TabId)) {
      return url_tab as TabId;
    }
    return "data";
  }

  // Parse hash for field targeting (e.g., #content:field_name or #design:field_name)
  function parse_hash(): { tab: TabId | null; field_name: string | null } {
    if (typeof window === "undefined") return { tab: null, field_name: null };
    const hash = window.location.hash.slice(1); // Remove #
    if (!hash) return { tab: null, field_name: null };

    const [tab, ...field_parts] = hash.split(":");
    const field_name_raw = field_parts.join(":") || null; // Rejoin in case field name has colons
    // Decode URL-encoded characters (spaces become %20 in hash)
    const field_name = field_name_raw
      ? decodeURIComponent(field_name_raw)
      : null;

    if (valid_tabs.includes(tab as TabId)) {
      return { tab: tab as TabId, field_name };
    }
    return { tab: null, field_name: null };
  }

  // Track target field for focusing/expanding
  let target_field = $state<string | null>(null);

  // Preview position state with localStorage persistence
  const PREVIEW_POSITION_KEY = "tinykit:preview_position";
  let preview_position = $state<PreviewPosition>("right");

  // Load saved preview position on mount (avoid SSR issues with localStorage)
  onMount(() => {
    const saved = localStorage.getItem(PREVIEW_POSITION_KEY);
    if (saved === "left" || saved === "right" || saved === "bottom") {
      preview_position = saved;
    }

    // Prevent page scroll on mobile (builder is a full-screen app)
    document.documentElement.classList.add("no-scroll");
    return () => {
      document.documentElement.classList.remove("no-scroll");
    };
  });

  // Persist preview position changes
  $effect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(PREVIEW_POSITION_KEY, preview_position);
    }
  });

  // Core state
  let current_tab = $state<TabId>(get_tab_from_url());
  // Derive title/domain from store project
  let project_title = $derived(store?.project?.name);
  let project_domain = $derived(store?.project?.domain || "");

  let is_deploying = $state(false);
  // Vibe settings from global _tk_settings
  let vibe_zone_enabled = $state(true);

  let vibe_zone_visible = $state(false)
  let vibe_zone_fullscreen = $state(false);
  let vibe_user_prompt = $state("");
  let agent_panel: AgentPanel | undefined = $state();
  let preview_errors = $state<PreviewError[]>([]);

  // Preview state
  let preview_refresh_timeout: ReturnType<typeof setTimeout> | null = null;

  // Template picker state
  let show_template_picker = $state(false);

  // Domain picker state
  let show_domain_picker = $state(false);

  // Pane refs and collapsed state
  let left_pane: PaneAPI | undefined = $state();
  let right_pane: PaneAPI | undefined = $state();
  let left_collapsed = $state(false);
  let right_collapsed = $state(false);

  // Mobile pane refs
  let mobile_top_pane: PaneAPI | undefined = $state();
  let mobile_bottom_pane: PaneAPI | undefined = $state();
  let mobile_top_collapsed = $state(false);
  let mobile_bottom_collapsed = $state(false);

  // Save status for header indicator
  let save_status = $state<{
    is_saving: boolean;
    has_unsaved: boolean;
    last_saved_at: Date | null;
  }>({
    is_saving: false,
    has_unsaved: false,
    last_saved_at: null,
  });

  // Tabs configuration
  const tabs = [
    { id: "data" as TabId, label: "Data", icon: Database, shortcut: "1" },
    {
      id: "content" as TabId,
      label: "Content",
      icon: FileText,
      shortcut: "2",
    },
    {
      id: "design" as TabId,
      label: "Design",
      icon: Palette,
      shortcut: "3",
    },
    { id: "code" as TabId, label: "Code", icon: Code, shortcut: "4" },
    {
      id: "history" as TabId,
      label: "History",
      icon: Clock,
      shortcut: "5",
    },
    {
      id: "agent" as TabId,
      label: "Agent",
      icon: Sparkles,
      shortcut: "6",
    },
  ];

  // External prompt to send to agent
  let pending_agent_prompt = $state<PendingPrompt | null>(null);

  // Update URL when tab changes (without adding to browser history)
  function set_tab(tab: TabId) {
    current_tab = tab;
    const url = new URL(window.location.href);
    if (tab === "data") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", tab);
    }
    replaceState(url.toString(), {});

    // If left panel is collapsed, expand it when switching tabs
    if (left_collapsed && left_pane) {
      left_pane.expand();
    }
    // Same for mobile bottom pane
    if (mobile_bottom_collapsed && mobile_bottom_pane) {
      mobile_bottom_pane.expand();
    }
  }

  // Navigate to a field via hash
  function navigate_to_field(tab: string, field_name?: string) {
    const hash = field_name ? `#${tab}:${field_name}` : `#${tab}`;
    window.location.hash = hash;
  }

  // Handle hash changes (from tool button clicks or browser navigation)
  function handle_hash_change() {
    const { tab, field_name } = parse_hash();
    if (tab) {
      set_tab(tab);
      target_field = field_name;
      // Clear hash after navigation to avoid stale state on refresh
      setTimeout(() => {
        if (window.location.hash) {
          replaceState(window.location.pathname + window.location.search, {});
        }
      }, 100);
    }
  }

  // Load hash and listeners
  onMount(() => {
    // Listen for fix-error events from Preview
    window.addEventListener(
      "tinykit:fix-error",
      handle_fix_error as EventListener
    );

    // Listen for hash changes
    window.addEventListener("hashchange", handle_hash_change);

    // Check for initial hash on mount
    handle_hash_change();

    // Check for initial prompt from sessionStorage (set by /new page)
    const check_initial_prompt = () => {
      const storage_key = `tinykit:initial_prompt:${project_id}`;
      const initial_prompt = sessionStorage.getItem(storage_key);
      if (initial_prompt) {
        // Remove from storage so it doesn't trigger again on refresh
        sessionStorage.removeItem(storage_key);
        pending_agent_prompt = {
          display: initial_prompt,
          full: initial_prompt,
        };
        // Switch to agent tab for the prompt
        set_tab("agent");
      }
    };
    // Check immediately on mount
    check_initial_prompt();

    // Load vibe zone fullscreen preference
    const savedFullscreen = localStorage.getItem("vibezone-fullscreen");
    if (savedFullscreen === "true") {
      vibe_zone_fullscreen = true;
    }

    // Load vibe zone enabled from global settings
    storage.load_vibe_zone_enabled().then((enabled) => {
      vibe_zone_enabled = enabled;
    });

    // Apply saved builder theme
    const theme = get_saved_theme();
    apply_builder_theme(theme);

    return () => {
      window.removeEventListener(
        "tinykit:fix-error",
        handle_fix_error as EventListener
      );
      window.removeEventListener("hashchange", handle_hash_change);
    };
  });

  const fix_messages = [
    "plz fix",
    "fix pls",
    "please please please fix this",
    "I'm begging you",
    "one more try?",
    "surely this time",
    "ok but actually fix it this time",
    "third time's the charm right",
    "I believe in you",
    "we're so close I can feel it",
    "don't let me down now",
    "you got this bestie",
    "manifesting a fix rn",
    "*sends good vibes*",
  ];
  let fix_message_index = 0;

  function handle_fix_error(e: CustomEvent<{ error: string }>) {
    const error = e.detail.error;
    const display = fix_messages[fix_message_index % fix_messages.length];
    fix_message_index++;

    set_tab("agent");
    preview_errors = [];
    pending_agent_prompt = {
      display,
      full: `Fix this compile error. You MUST use the write_code tool to rewrite the COMPLETE code file with the fix applied. Do NOT just show a code snippet - use write_code with the full corrected component.\n\nError:\n\`\`\`\n${error}\n\`\`\``,
    };
  }

  // Toggle vibe lounge function
  async function toggle_vibe_lounge() {
    const new_value = !vibe_zone_enabled;
    vibe_zone_enabled = new_value;
    await storage.save_vibe_zone_enabled(new_value);
  }

  // Save vibe zone fullscreen preference to localStorage
  $effect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "vibezone-fullscreen",
        vibe_zone_fullscreen.toString()
      );
    }
  });

  // Note: Project title is now derived from store.
  // Header should update it via API if editing.

  // Track previous processing state to detect when agent finishes
  let was_processing = $state(false);

  // Reload code from database when agent finishes processing
  watch(
    () => store?.is_processing ?? false,
    (processing) => {
      if (was_processing && !processing) {
        // Agent just finished - play completion sound
        play_complete();
      }
      was_processing = processing;
    }
  );

  // Functions
  async function build_app() {
    try {
      await api.build_app(project_id!);
      preview_errors = preview_errors.filter((e) => e.type !== "compile");
    } catch (err: any) {
      const error_message = err.message || "Unknown build error";
      preview_errors = [
        ...preview_errors.filter((e) => e.type !== "compile"),
        {
          type: "compile",
          message: error_message,
          timestamp: Date.now(),
        },
      ];
    }
  }

  function refresh_preview() {
    // Only refresh the preview iframe (uses in-browser compiler)
    // Production build happens when Deploy button is clicked
    if (preview_refresh_timeout) {
      clearTimeout(preview_refresh_timeout);
    }
    preview_refresh_timeout = setTimeout(() => {
      const iframe = document.getElementById(
        "preview-frame"
      ) as HTMLIFrameElement;
      if (iframe) {
        const url = new URL(iframe.src);
        url.searchParams.set("t", Date.now().toString());
        iframe.src = url.toString();
      }
      preview_refresh_timeout = null;
    }, 500);
  }

  // Header callbacks
  async function handle_deploy() {
    if (is_deploying || !store) return;

    // If no domain assigned, show domain picker first
    if (!store.project?.domain) {
      show_domain_picker = true;
      return;
    }

    await do_deploy();
  }

  async function do_deploy() {
    if (is_deploying) return;
    play_tap();
    is_deploying = true;
    try {
      await build_app();
    } catch (err) {
      console.error("Deploy failed:", err);
    } finally {
      is_deploying = false;
    }
  }

  async function handle_domain_selected(domain: string) {
    show_domain_picker = false;
    if (!store) return;
    // Update project with the selected domain
    try {
      await store.update({ domain });
      // Now deploy
      await do_deploy();
    } catch (err) {
      console.error("Failed to assign domain:", err);
      alert("Failed to assign domain. See console for details.");
    }
  }

  function handle_load_templates() {
    show_template_picker = true;
  }

  async function handle_template_selected(template: Template) {
    show_template_picker = false;
    try {
      const timestamp = new Date().toLocaleString();
      await api.create_snapshot(
        project_id!,
        `Before loading template "${template.name}" - ${timestamp}`
      );
      await api.load_template(project_id!, template.id);
      // Refresh store
      await store?.refresh();
      refresh_preview();
    } catch (err) {
      console.error("Failed to load template:", err);
      alert("Failed to load template. See console for details.");
    }
  }

  async function handle_download_project() {
    try {
      const response = await fetch(`/api/projects/${project_id}/export`);
      if (!response.ok) {
        throw new Error(`Failed to export: ${response.statusText}`);
      }
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(store?.project?.name || "project").toLowerCase().replace(/\s+/g, "-")}-export.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download project:", err);
      alert("Failed to download project. See console for details.");
    }
  }

  async function handle_reset_project() {
    if (
      confirm(
        "Reset project? This will clear all files, config, and data.\n\nA snapshot will be created so you can restore if needed."
      )
    ) {
      try {
        const timestamp = new Date().toLocaleString();
        await api.create_snapshot(project_id!, `Before reset - ${timestamp}`);
        await api.reset_project(project_id!);
        storage.clear_messages();
        await store?.refresh();
        location.reload();
      } catch (err) {
        console.error("Failed to reset project:", err);
        alert("Failed to reset project. See console for details.");
      }
    }
  }

  // History callbacks
  async function handle_snapshot_created() {
    await store?.loadSnapshots();
  }

  async function handle_snapshot_restored() {
    // Store will auto-update via realtime usually, but forced refresh is safer
    await store?.refresh();
    await store?.loadSnapshots();
    refresh_preview();
  }
</script>

<svelte:head>
  <title>{project_title || "Loading..."} - tinykit</title>
</svelte:head>

{#if !store || is_resolving}
  <div
    class="h-dvh flex items-center justify-center bg-[var(--builder-bg-primary)]"
  >
    <div class="flex flex-col items-center gap-3">
      <Loader2 class="w-8 h-8 text-[var(--builder-accent)] animate-spin" />
      <p class="text-sm text-[var(--builder-text-secondary)]">
        Loading project...
      </p>
    </div>
  </div>
{:else}
  <div class="h-dvh flex flex-col bg-[var(--builder-bg-primary)] safe-area-top">
    {#key project_id}
      <!-- Desktop Header (hidden on mobile) -->
      <div class="hidden md:block">
        <Header
          project_title={project_title ?? ""}
          project_id={store?.project?.id ?? ""}
          kit_id={store?.project?.kit}
          {vibe_zone_enabled}
          bind:preview_position
          {project_domain}
          {is_deploying}
          {save_status}
          {tabs}
          {current_tab}
          {active_tool_tabs}
          on_tab_change={set_tab}
          on_deploy={handle_deploy}
          on_load_templates={handle_load_templates}
          on_download_project={handle_download_project}
          on_reset_project={handle_reset_project}
          on_toggle_vibe_zone={toggle_vibe_lounge}
        />
      </div>

      <!-- Snippet: Panel Content (reused across layouts) -->
      {#snippet panel_content()}
        {#if current_tab === "agent"}
          <AgentPanel
            bind:this={agent_panel}
            bind:preview_errors
            bind:vibe_zone_visible
            bind:vibe_user_prompt
            pending_prompt={pending_agent_prompt}
            on_navigate_to_field={navigate_to_field}
            on_pending_prompt_consumed={() => (pending_agent_prompt = null)}
          />
        {:else if current_tab === "code"}
          <CodePanel
            on_refresh_preview={refresh_preview}
            on_save_status_change={(status) => (save_status = status)}
          />
        {:else if current_tab === "content"}
          <ContentPanel
            {target_field}
            on_refresh_preview={refresh_preview}
            on_target_consumed={() => (target_field = null)}
          />
        {:else if current_tab === "design"}
          <DesignPanel
            {target_field}
            on_refresh_preview={refresh_preview}
            on_target_consumed={() => (target_field = null)}
          />
        {:else if current_tab === "data"}
          <DataPanel
            {target_field}
            on_refresh_preview={refresh_preview}
            on_target_consumed={() => (target_field = null)}
          />
        {:else if current_tab === "history"}
          <HistoryPanel
            on_snapshot_created={handle_snapshot_created}
            on_snapshot_restored={handle_snapshot_restored}
          />
        {/if}
      {/snippet}

      <!-- Snippet: Preview Pane (reused across layouts) -->
      {#snippet preview_pane()}
        <div class="relative h-full w-full">
          <Preview project_id={project_id!} />
          {#if vibe_zone_visible && vibe_zone_enabled && !vibe_zone_fullscreen}
            <VibeZone
              userPrompt={vibe_user_prompt}
              enabled={vibe_zone_enabled}
              bind:isFullscreen={vibe_zone_fullscreen}
              onDismiss={() => agent_panel?.dismiss_vibe()}
              onToggleEnabled={toggle_vibe_lounge}
            />
          {/if}
        </div>
      {/snippet}

      <!-- Desktop: Configurable layout based on preview_position -->
      <div class="hidden md:flex flex-1 overflow-hidden">
        {#if preview_position === "bottom"}
          <!-- Vertical layout: panels on top, preview on bottom -->
          <PaneGroup
            direction="vertical"
            class="flex-1"
            autoSaveId="tinykit-builder-vertical"
          >
            <Pane
              bind:this={left_pane}
              defaultSize={50}
              minSize={20}
              collapsible
              collapsedSize={0}
              onCollapse={() => (left_collapsed = true)}
              onExpand={() => (left_collapsed = false)}
            >
              <div
                class="h-full border-b border-[var(--builder-border)] flex flex-col overflow-hidden transition-all duration-300 ease-out {left_collapsed
                  ? 'opacity-0 -translate-y-4'
                  : 'opacity-100 translate-y-0'}"
              >
                <div class="flex-1 overflow-hidden relative">
                  {@render panel_content()}
                </div>
              </div>
            </Pane>

            <PaneResizer
              class="relative z-20 bg-[var(--builder-border)] transition-all {left_collapsed ||
              right_collapsed
                ? 'h-6 cursor-pointer'
                : 'h-1 hover:bg-[var(--builder-accent)] cursor-row-resize'}"
            >
              {#if left_collapsed}
                <button
                  class="w-full h-full bg-[var(--builder-bg-secondary)] border-b border-[var(--builder-border)] flex items-center justify-center hover:bg-[var(--builder-bg-tertiary)] transition-colors cursor-pointer"
                  onclick={() => left_pane?.expand()}
                  title="Expand panel"
                >
                  <svg
                    class="w-4 h-4 text-[var(--builder-text-secondary)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              {:else if right_collapsed}
                <button
                  class="w-full h-full bg-[var(--builder-bg-secondary)] border-t border-[var(--builder-border)] flex items-center justify-center hover:bg-[var(--builder-bg-tertiary)] transition-colors cursor-pointer"
                  onclick={() => right_pane?.expand()}
                  title="Expand preview"
                >
                  <svg
                    class="w-4 h-4 text-[var(--builder-text-secondary)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M6 15l6-6 6 6" />
                  </svg>
                </button>
              {/if}
            </PaneResizer>

            <Pane
              bind:this={right_pane}
              defaultSize={50}
              minSize={20}
              collapsible
              collapsedSize={0}
              onCollapse={() => (right_collapsed = true)}
              onExpand={() => (right_collapsed = false)}
            >
              <div
                class="h-full transition-all duration-300 ease-out {right_collapsed
                  ? 'opacity-0 translate-y-4'
                  : 'opacity-100 translate-y-0'}"
              >
                {@render preview_pane()}
              </div>
            </Pane>
          </PaneGroup>
        {:else if preview_position === "left"}
          <!-- Horizontal layout: preview on left, panels on right -->
          <PaneGroup
            direction="horizontal"
            class="flex flex-1"
            autoSaveId="tinykit-builder-left"
          >
            <Pane
              bind:this={right_pane}
              defaultSize={50}
              minSize={25}
              collapsible
              collapsedSize={0}
              onCollapse={() => (right_collapsed = true)}
              onExpand={() => (right_collapsed = false)}
            >
              <div
                class="h-full border-r border-[var(--builder-border)] transition-all duration-300 ease-out {right_collapsed
                  ? 'opacity-0 -translate-x-4'
                  : 'opacity-100 translate-x-0'}"
              >
                {@render preview_pane()}
              </div>
            </Pane>

            <PaneResizer
              class="relative z-20 bg-[var(--builder-border)] transition-all {left_collapsed ||
              right_collapsed
                ? 'w-6 cursor-pointer'
                : 'w-1 hover:bg-[var(--builder-accent)] cursor-col-resize'}"
            >
              {#if right_collapsed}
                <button
                  class="w-full h-full bg-[var(--builder-bg-secondary)] border-r border-[var(--builder-border)] flex items-center justify-center hover:bg-[var(--builder-bg-tertiary)] transition-colors cursor-pointer"
                  onclick={() => right_pane?.expand()}
                  title="Expand preview"
                >
                  <svg
                    class="w-4 h-4 text-[var(--builder-text-secondary)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              {:else if left_collapsed}
                <button
                  class="w-full h-full bg-[var(--builder-bg-secondary)] border-l border-[var(--builder-border)] flex items-center justify-center hover:bg-[var(--builder-bg-tertiary)] transition-colors cursor-pointer"
                  onclick={() => left_pane?.expand()}
                  title="Expand panel"
                >
                  <svg
                    class="w-4 h-4 text-[var(--builder-text-secondary)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
              {/if}
            </PaneResizer>

            <Pane
              bind:this={left_pane}
              defaultSize={50}
              minSize={20}
              collapsible
              collapsedSize={0}
              onCollapse={() => (left_collapsed = true)}
              onExpand={() => (left_collapsed = false)}
            >
              <div
                class="h-full flex flex-col overflow-hidden transition-all duration-300 ease-out {left_collapsed
                  ? 'opacity-0 translate-x-4'
                  : 'opacity-100 translate-x-0'}"
              >
                <div class="flex-1 overflow-hidden relative">
                  {@render panel_content()}
                </div>
              </div>
            </Pane>
          </PaneGroup>
        {:else}
          <!-- Default: Horizontal layout with preview on right -->
          <PaneGroup
            direction="horizontal"
            class="flex flex-1"
            autoSaveId="tinykit-builder-desktop"
          >
            <Pane
              bind:this={left_pane}
              defaultSize={50}
              minSize={20}
              collapsible
              collapsedSize={0}
              onCollapse={() => (left_collapsed = true)}
              onExpand={() => (left_collapsed = false)}
            >
              <div
                class="h-full border-r border-[var(--builder-border)] flex flex-col overflow-hidden transition-all duration-300 ease-out {left_collapsed
                  ? 'opacity-0 -translate-x-4'
                  : 'opacity-100 translate-x-0'}"
              >
                <div class="flex-1 overflow-hidden relative">
                  {@render panel_content()}
                </div>
              </div>
            </Pane>

            <PaneResizer
              class="relative z-20 bg-[var(--builder-border)] transition-all {left_collapsed ||
              right_collapsed
                ? 'w-6 cursor-pointer'
                : 'w-1 hover:bg-[var(--builder-accent)] cursor-col-resize'}"
            >
              {#if left_collapsed}
                <button
                  class="w-full h-full bg-[var(--builder-bg-secondary)] border-r border-[var(--builder-border)] flex items-center justify-center hover:bg-[var(--builder-bg-tertiary)] transition-colors cursor-pointer"
                  onclick={() => left_pane?.expand()}
                  title="Expand left panel"
                >
                  <svg
                    class="w-4 h-4 text-[var(--builder-text-secondary)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              {:else if right_collapsed}
                <button
                  class="w-full h-full bg-[var(--builder-bg-secondary)] border-l border-[var(--builder-border)] flex items-center justify-center hover:bg-[var(--builder-bg-tertiary)] transition-colors cursor-pointer"
                  onclick={() => right_pane?.expand()}
                  title="Expand right panel"
                >
                  <svg
                    class="w-4 h-4 text-[var(--builder-text-secondary)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
              {/if}
            </PaneResizer>

            <Pane
              bind:this={right_pane}
              defaultSize={50}
              minSize={25}
              collapsible
              collapsedSize={0}
              onCollapse={() => (right_collapsed = true)}
              onExpand={() => (right_collapsed = false)}
            >
              <div
                class="h-full transition-all duration-300 ease-out {right_collapsed
                  ? 'opacity-0 translate-x-4'
                  : 'opacity-100 translate-x-0'}"
              >
                {@render preview_pane()}
              </div>
            </Pane>
          </PaneGroup>
        {/if}
      </div>

      <!-- Mobile: Stacked layout -->
      <div class="flex md:hidden flex-col flex-1 overflow-hidden">
        <!-- Mobile Top Toolbar -->
        <Header
          project_title={project_title ?? ""}
          project_id={store?.project?.id ?? ""}
          {vibe_zone_enabled}
          bind:preview_position
          {project_domain}
          {is_deploying}
          {save_status}
          {tabs}
          {current_tab}
          {active_tool_tabs}
          on_tab_change={set_tab}
          on_deploy={handle_deploy}
          on_load_templates={handle_load_templates}
          on_download_project={handle_download_project}
          on_reset_project={handle_reset_project}
          on_toggle_vibe_zone={toggle_vibe_lounge}
          is_mobile={true}
        />

        <PaneGroup
          direction="vertical"
          class="flex-1"
          autoSaveId="tinykit-builder-mobile"
        >
          <!-- Preview (top pane) -->
          <Pane
            bind:this={mobile_top_pane}
            defaultSize={40}
            minSize={20}
            collapsible
            collapsedSize={0}
            onCollapse={() => (mobile_top_collapsed = true)}
            onExpand={() => (mobile_top_collapsed = false)}
          >
            <div
              class="h-full border-b border-[var(--builder-border)] transition-all duration-300 ease-out {mobile_top_collapsed
                ? 'opacity-0 -translate-y-4'
                : 'opacity-100 translate-y-0'}"
            >
              {@render preview_pane()}
            </div>
          </Pane>

          <PaneResizer
            class="relative z-20 bg-[var(--builder-border)] transition-all touch-none {mobile_top_collapsed ||
            mobile_bottom_collapsed
              ? 'h-6 cursor-pointer'
              : 'h-2 hover:bg-[var(--builder-accent)] cursor-row-resize'}"
          >
            {#if mobile_top_collapsed}
              <button
                class="w-full h-full bg-[var(--builder-bg-secondary)] border-b border-[var(--builder-border)] flex items-center justify-center hover:bg-[var(--builder-bg-tertiary)] transition-colors cursor-pointer"
                onclick={() => mobile_top_pane?.expand()}
                title="Expand preview"
              >
                <svg
                  class="w-4 h-4 text-[var(--builder-text-secondary)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            {:else if mobile_bottom_collapsed}
              <button
                class="w-full h-full bg-[var(--builder-bg-secondary)] border-t border-[var(--builder-border)] flex items-center justify-center hover:bg-[var(--builder-bg-tertiary)] transition-colors cursor-pointer"
                onclick={() => mobile_bottom_pane?.expand()}
                title="Expand panel"
              >
                <svg
                  class="w-4 h-4 text-[var(--builder-text-secondary)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M6 15l6-6 6 6" />
                </svg>
              </button>
            {/if}
          </PaneResizer>

          <!-- Active Tab Content (bottom pane) -->
          <Pane
            bind:this={mobile_bottom_pane}
            defaultSize={60}
            minSize={20}
            collapsible
            collapsedSize={0}
            onCollapse={() => (mobile_bottom_collapsed = true)}
            onExpand={() => (mobile_bottom_collapsed = false)}
          >
            <div
              class="h-full overflow-hidden transition-all duration-300 ease-out {mobile_bottom_collapsed
                ? 'opacity-0 translate-y-4'
                : 'opacity-100 translate-y-0'}"
            >
              {@render panel_content()}
            </div>
          </Pane>
        </PaneGroup>
      </div>

      <!-- Template Picker Modal -->
      {#if show_template_picker}
        <TemplatePicker
          on_select={handle_template_selected}
          on_close={() => (show_template_picker = false)}
        />
      {/if}

      <!-- Domain Picker Modal -->
      <DomainPicker
        bind:open={show_domain_picker}
        project_id={store?.project?.id ?? ""}
        on_close={() => (show_domain_picker = false)}
        on_select={handle_domain_selected}
        on_deploy={async () => {
          await do_deploy();
        }}
      />
    {/key}
  </div>
{/if}

{#if vibe_zone_visible && vibe_zone_enabled && vibe_zone_fullscreen}
  <VibeZone
    userPrompt={vibe_user_prompt}
    enabled={vibe_zone_enabled}
    bind:isFullscreen={vibe_zone_fullscreen}
    onDismiss={() => agent_panel?.dismiss_vibe()}
    onToggleEnabled={toggle_vibe_lounge}
  />
{/if}
