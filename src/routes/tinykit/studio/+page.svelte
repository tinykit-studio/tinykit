<script lang="ts">
	import { onMount } from "svelte";
	import { watch } from "runed";
	import { page } from "$app/stores";
	import { goto, replaceState } from "$app/navigation";
	import {
		Sparkles,
		Code,
		Database,
		Clock,
		Settings,
		Palette,
		FileText,
	} from "lucide-svelte";
	import { PaneGroup, Pane, PaneResizer, type PaneAPI } from "paneforge";
	import Preview from "$lib/components/Preview.svelte";
	import VibeZone from "$lib/components/VibeZone.svelte";

	// Import components
	import Header from "../components/Header.svelte";
	import TemplatePicker from "../components/TemplatePicker.svelte";
	import AgentPanel from "../panels/agent/AgentPanel.svelte";
	import CodePanel from "../panels/code/CodePanel.svelte";
	import ContentPanel from "../panels/content/ContentPanel.svelte";
	import DesignPanel from "../panels/design/DesignPanel.svelte";
	import DataPanel from "../panels/data/DataPanel.svelte";
	import HistoryPanel from "../panels/history/HistoryPanel.svelte";
	import ConfigPanel from "../panels/config/ConfigPanel.svelte";

	// Import types and utilities
	import type {
		TabId,
		Message,
		ConfigSubTab,
		ApiEndpoint,
		ContentField,
		DesignField,
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

	// Get project_id from server load
	let { data } = $props();
	const project_id = data.project_id;

	// Valid tab IDs for validation
	const valid_tabs: TabId[] = [
		"agent",
		"code",
		"content",
		"design",
		"data",
		"history",
		"config",
	];

	// Set project context for child components
	setProjectContext({ project_id });

	// Read initial tab from URL query param, default to "agent"
	function get_tab_from_url(): TabId {
		const url_tab = $page.url.searchParams.get("tab");
		if (url_tab && valid_tabs.includes(url_tab as TabId)) {
			return url_tab as TabId;
		}
		return "agent";
	}

	// Parse hash for field targeting (e.g., #content:field_name or #design:field_name)
	function parse_hash(): { tab: TabId | null; field_name: string | null } {
		if (typeof window === "undefined")
			return { tab: null, field_name: null };
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
	let project_title = $state("My Project");
	let project_domain = $state("");
	let project_title_loaded = $state(false);
	let is_deploying = $state(false);
	let vibe_zone_enabled = $state(true);
	let vibe_zone_loaded = $state(false);
	let vibe_zone_visible = $state(false);
	let vibe_user_prompt = $state("");
	let agent_panel: AgentPanel | undefined = $state();

	// Agent state
	let messages = $state<Message[]>([]);
	let is_processing = $state(false);
	let is_loading_messages = $state(true);
	let preview_errors = $state<PreviewError[]>([]);

	// Code state
	let current_file = $state("");
	let file_content = $state("");
	let editor_language = $state<EditorLanguage>("javascript");
	let is_loading_file = $state(false);

	// Content state
	let content_fields = $state<ContentField[]>([]);

	// Design state
	let design_fields = $state<DesignField[]>([]);

	// Config state
	let config_subtab = $state<ConfigSubTab>("env");
	let env_vars = $state<Record<string, string>>({});
	let endpoints = $state<ApiEndpoint[]>([]);

	// Data state
	let data_files = $state<string[]>([]);
	let table_icons = $state<Record<string, string>>({});

	// History state
	let snapshots = $state<Snapshot[]>([]);
	let snapshots_loaded = $state(false);
	let is_loading_snapshots = $state(false);
	let is_restoring = $state(false);

	// Preview state
	let preview_refresh_timeout: ReturnType<typeof setTimeout> | null = null;

	// Template picker state
	let show_template_picker = $state(false);

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
		{
			id: "agent" as TabId,
			label: "Agent",
			icon: Sparkles,
			shortcut: "1",
		},
		{ id: "code" as TabId, label: "Code", icon: Code, shortcut: "2" },
		{
			id: "content" as TabId,
			label: "Content",
			icon: FileText,
			shortcut: "3",
		},
		{
			id: "design" as TabId,
			label: "Design",
			icon: Palette,
			shortcut: "4",
		},
		{ id: "data" as TabId, label: "Data", icon: Database, shortcut: "5" },
		{
			id: "history" as TabId,
			label: "History",
			icon: Clock,
			shortcut: "6",
		},
	];

	// External prompt to send to agent
	let pending_agent_prompt = $state<PendingPrompt | null>(null);

	// Update URL when tab changes (without adding to browser history)
	function set_tab(tab: TabId) {
		current_tab = tab;
		const url = new URL(window.location.href);
		if (tab === "agent") {
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
					replaceState(
						window.location.pathname + window.location.search,
						{}
					);
				}
			}, 100);
		}
	}

	// Load initial data
	onMount(() => {
		// Listen for fix-error events from Preview
		window.addEventListener(
			"tinykit:fix-error",
			handle_fix_error as EventListener,
		);

		// Listen for hash changes
		window.addEventListener("hashchange", handle_hash_change);

		// Check for initial hash on mount
		handle_hash_change();

		// Async initialization
		(async () => {
			// Load project data from Pocketbase SDK
			try {
				const project = await api.get_project_details(project_id);
				messages = project.agent_chat || [];
				project_title = project.name || "My Project";
				project_domain = project.domain || "";
				project_title_loaded = true;

				// Check if there's an initial prompt that hasn't been processed yet
				if (
					messages.length === 1 &&
					messages[0].role === "user" &&
					messages[0].content
				) {
					const initial_prompt = messages[0].content;
					pending_agent_prompt = {
						display: initial_prompt,
						full: initial_prompt,
					};
					messages = [];
				}

				// Load vibe zone setting from project settings (defaults to true)
				vibe_zone_enabled =
					project.settings?.vibe_zone_enabled ?? true;
				vibe_zone_loaded = true;
			} catch (err) {
				console.error("Failed to load project:", err);
				messages = [];
				vibe_zone_enabled = true;
				vibe_zone_loaded = true;
			} finally {
				is_loading_messages = false;
			}

			// Apply saved theme immediately on load
			const theme = get_saved_theme();
			apply_builder_theme(theme);

			// Auto-load first file
			load_initial_file();
		})();

		return () => {
			window.removeEventListener(
				"tinykit:fix-error",
				handle_fix_error as EventListener,
			);
			window.removeEventListener("hashchange", handle_hash_change);
		};
	});

	function handle_fix_error(e: CustomEvent<{ error: string }>) {
		const error = e.detail.error;
		set_tab("agent");
		preview_errors = [];
		pending_agent_prompt = {
			display: `Fix this error:\n\`\`\`\n${error}\n\`\`\``,
			full: `Fix this compile error. You MUST use the write_code tool to rewrite the COMPLETE App.svelte file with the fix applied. Do NOT just show a code snippet - use write_code with the full corrected component.\n\nError:\n\`\`\`\n${error}\n\`\`\``,
		};
	}

	function handle_code_written(content: string) {
		if (!content || content.length === 0) return;
		file_content = content;
	}

	// Save vibe zone preference to project settings (only after initial load)
	$effect(() => {
		if (typeof window !== "undefined" && vibe_zone_loaded && project_id) {
			api.update_project_settings(project_id, {
				vibe_zone_enabled,
			}).catch(console.error);
		}
	});

	// Save project title whenever it changes (only after initial load)
	$effect(() => {
		if (
			typeof window !== "undefined" &&
			project_title_loaded &&
			project_title &&
			project_id
		) {
			api.update_project_name(project_id, project_title).catch(
				console.error,
			);
		}
	});

	// Auto-save messages when they change
	$effect(() => {
		if (
			typeof window !== "undefined" &&
			!is_loading_messages &&
			messages.length > 0
		) {
			api.save_messages(project_id, messages).catch(console.error);
		}
	});

	// Load config when config tab is opened
	$effect(() => {
		if (current_tab === "config" && Object.keys(env_vars).length === 0) {
			load_config();
		}
	});

	// Load content when content tab is opened
	$effect(() => {
		if (current_tab === "content" && content_fields.length === 0) {
			load_config();
		}
	});

	// Load design when design tab is opened
	$effect(() => {
		if (current_tab === "design" && design_fields.length === 0) {
			load_config();
		}
	});

	// Load data files when data tab is opened
	$effect(() => {
		if (current_tab === "data" && data_files.length === 0) {
			load_data_files();
		}
	});

	// Load snapshots when history tab is opened
	$effect(() => {
		if (
			current_tab === "history" &&
			!snapshots_loaded &&
			!is_loading_snapshots
		) {
			load_snapshots();
		}
	});

	// Track previous processing state to detect when agent finishes
	let was_processing = $state(false);

	// Reload code from database when agent finishes processing
	watch(
		() => is_processing,
		(processing) => {
			if (was_processing && !processing) {
				// Agent just finished - reload code from database to ensure editor is in sync
				api.read_code(project_id).then((code) => {
					if (code && code.length > 0) {
						file_content = code;
					}
				}).catch(console.error);
			}
			was_processing = processing;
		}
	);

	// Functions
	async function load_initial_file() {
		const default_file = `${project_id}/src/App.svelte`;
		await handle_file_select(default_file);
	}

	async function handle_file_select(path: string) {
		is_loading_file = true;
		current_file = path;
		try {
			file_content = await api.read_code(project_id);
			const ext = path.split(".").pop()?.toLowerCase();
			if (ext === "svelte") editor_language = "svelte";
			else if (ext === "html") editor_language = "html";
			else if (ext === "css") editor_language = "css";
			else if (ext === "js") editor_language = "javascript";
			else if (ext === "json") editor_language = "json";
			else if (ext === "ts") editor_language = "typescript";
			else editor_language = "html";
		} catch (err) {
			console.error("Failed to load file:", err);
		} finally {
			is_loading_file = false;
		}
	}

	async function load_config() {
		try {
			const config = await api.load_config(project_id);
			env_vars = config.env;
			endpoints = config.endpoints;
			content_fields = config.fields;
			design_fields = config.design;
		} catch (err) {
			console.error("Failed to load config:", err);
		}
	}

	function toggle_vibe_lounge() {
		vibe_zone_enabled = !vibe_zone_enabled;
	}

	async function load_data_files() {
		try {
			data_files = await api.load_data_files(project_id);
			for (const file of data_files) {
				if (!table_icons[file]) {
					try {
						table_icons[file] = await api.get_data_file_icon(file);
					} catch {
						table_icons[file] = "mdi:database";
					}
				}
			}
		} catch (err) {
			console.error("Failed to load data files:", err);
		}
	}

	async function load_snapshots() {
		is_loading_snapshots = true;
		try {
			snapshots = await api.load_snapshots(project_id);
			snapshots_loaded = true;
		} catch (err) {
			console.error("Failed to load snapshots:", err);
		} finally {
			is_loading_snapshots = false;
		}
	}

	async function build_app() {
		try {
			await api.build_app(project_id);
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
				"preview-frame",
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
		if (is_deploying) return;
		is_deploying = true;
		try {
			await build_app();
		} catch (err) {
			console.error("Deploy failed:", err);
		} finally {
			is_deploying = false;
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
				project_id,
				`Before loading template "${template.name}" - ${timestamp}`,
			);
			await api.load_template(project_id, template.id);
			await load_config();
			refresh_preview();
			if (current_file) {
				handle_file_select(current_file);
			}
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
			a.download = `${project_title.toLowerCase().replace(/\s+/g, "-")}-export.json`;
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
				"Reset project? This will clear all files, config, and data.\n\nA snapshot will be created so you can restore if needed.",
			)
		) {
			try {
				const timestamp = new Date().toLocaleString();
				await api.create_snapshot(
					project_id,
					`Before reset - ${timestamp}`,
				);
				await api.reset_project(project_id);
				messages = [];
				storage.clear_messages();
				location.reload();
			} catch (err) {
				console.error("Failed to reset project:", err);
				alert("Failed to reset project. See console for details.");
			}
		}
	}

	// History callbacks
	async function handle_snapshot_created() {
		await load_snapshots();
	}

	async function handle_snapshot_restored() {
		// Reload code from database after restore
		if (current_file) {
			await handle_file_select(current_file);
		}
		// Reload design and content fields
		await load_config();
		// Rebuild and refresh preview
		refresh_preview();
	}
</script>

<svelte:head>
	<title>{project_title} - tinykit</title>
</svelte:head>

<div class="h-dvh flex flex-col bg-[var(--builder-bg-primary)] safe-area-top">
	<!-- Desktop Header (hidden on mobile) -->
	<div class="hidden md:block">
		<Header
			bind:project_title
			bind:vibe_zone_enabled
			bind:preview_position
			{project_domain}
			{is_deploying}
			{save_status}
			{tabs}
			{current_tab}
			on_tab_change={set_tab}
			on_deploy={handle_deploy}
			on_load_templates={handle_load_templates}
			on_download_project={handle_download_project}
			on_reset_project={handle_reset_project}
		/>
	</div>

	<!-- Snippet: Panel Content (reused across layouts) -->
	{#snippet panel_content()}
		{#if current_tab === "agent"}
			<AgentPanel
				bind:this={agent_panel}
				bind:messages
				bind:is_processing
				bind:preview_errors
				bind:vibe_zone_visible
				bind:vibe_user_prompt
				{is_loading_messages}
				{vibe_zone_enabled}
				pending_prompt={pending_agent_prompt}
				on_navigate_to_field={navigate_to_field}
				on_config_subtab_change={(subtab) => (config_subtab = subtab)}
				on_file_select={handle_file_select}
				on_load_data_files={load_data_files}
				on_load_config={load_config}
				on_refresh_preview={refresh_preview}
				on_vibe_lounge_toggle={toggle_vibe_lounge}
				on_vibe_dismiss={() => agent_panel?.dismiss_vibe()}
				on_pending_prompt_consumed={() => (pending_agent_prompt = null)}
				on_code_written={handle_code_written}
			/>
		{:else if current_tab === "code"}
			<CodePanel
				{current_file}
				bind:file_content
				{editor_language}
				is_loading={is_loading_file}
				on_content_change={() => {}}
				on_refresh_preview={refresh_preview}
				on_save_status_change={(status) => (save_status = status)}
			/>
		{:else if current_tab === "content"}
			<ContentPanel
				bind:content_fields
				{target_field}
				on_refresh_preview={refresh_preview}
				on_target_consumed={() => (target_field = null)}
			/>
		{:else if current_tab === "design"}
			<DesignPanel
				bind:design_fields
				{target_field}
				on_refresh_preview={refresh_preview}
				on_target_consumed={() => (target_field = null)}
			/>
		{:else if current_tab === "data"}
			<DataPanel
				{data_files}
				{table_icons}
				{target_field}
				on_refresh_preview={refresh_preview}
				on_target_consumed={() => (target_field = null)}
			/>
		{:else if current_tab === "history"}
			<HistoryPanel
				bind:snapshots
				is_loading={is_loading_snapshots}
				bind:is_restoring
				on_snapshot_created={handle_snapshot_created}
				on_snapshot_restored={handle_snapshot_restored}
			/>
		{:else if current_tab === "config"}
			<ConfigPanel
				bind:env_vars
				bind:endpoints
				bind:current_subtab={config_subtab}
				on_subtab_change={(subtab) => (config_subtab = subtab)}
			/>
		{/if}
	{/snippet}

	<!-- Snippet: Preview Pane (reused across layouts) -->
	{#snippet preview_pane()}
		<Preview
			code={file_content}
			language={editor_language}
			{project_id}
			agent_working={is_processing}
		/>
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
					class="relative z-20 bg-[var(--builder-border)] transition-all {left_collapsed || right_collapsed
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
					class="relative z-20 bg-[var(--builder-border)] transition-all {left_collapsed || right_collapsed
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
					class="relative z-20 bg-[var(--builder-border)] transition-all {left_collapsed || right_collapsed
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
			bind:project_title
			bind:vibe_zone_enabled
			bind:preview_position
			{project_domain}
			{is_deploying}
			{save_status}
			{tabs}
			{current_tab}
			on_tab_change={set_tab}
			on_deploy={handle_deploy}
			on_load_templates={handle_load_templates}
			on_download_project={handle_download_project}
			on_reset_project={handle_reset_project}
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
				class="relative z-20 bg-[var(--builder-border)] transition-all touch-none {mobile_top_collapsed || mobile_bottom_collapsed
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
</div>

<!-- Vibe Zone (rendered at root level for proper fullscreen) -->
<VibeZone
	visible={vibe_zone_visible}
	userPrompt={vibe_user_prompt}
	enabled={vibe_zone_enabled}
	onDismiss={() => agent_panel?.dismiss_vibe()}
	onToggleEnabled={toggle_vibe_lounge}
/>
