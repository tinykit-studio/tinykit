import { setContext, getContext } from 'svelte';
import { pb } from '$lib/pocketbase.svelte';
import * as api from '../lib/api.svelte';
import { apply_builder_theme, builder_themes } from '$lib/builder_themes';
import type { Project, Snapshot, DesignField, ContentField, ProjectSettings } from '../types';

const PROJECT_KEY = Symbol('PROJECT');

export class ProjectStore {
    project = $state<Project | null>(null);
    snapshots = $state<Snapshot[]>([]);
    snapshots_loading = $state(false);
    loading = $state(true);
    error = $state<string | null>(null);

    // Optimistic update tracking
    private _pending_design_saves: Map<string, DesignField> = new Map();
    private _pending_content_saves: Map<string, ContentField> = new Map();
    private _save_timeout: ReturnType<typeof setTimeout> | null = null;
    private readonly SAVE_DELAY = 300;

    // Derived state helpers
    messages = $derived(this.project?.agent_chat || []);
    content = $derived(this.project?.content || []);
    design = $derived(this.project?.design || []);
    data_files = $derived(Object.keys(this.project?.data || {}));
    table_icons = $derived.by(() => {
        const icons: Record<string, string> = {};
        const data = this.project?.data || {};
        for (const file of Object.keys(data)) {
            icons[file] = data[file]?.icon || 'mdi:database';
        }
        return icons;
    });
    code = $derived(this.project?.frontend_code || '');

    // UI state that might be shared
    is_processing = $derived.by(() => {
        const msgs = this.messages;
        const last = msgs[msgs.length - 1];
        return last?.role === 'assistant' && last?.status === 'running';
    });

    project_id = $state("");

    private _initialized = false;

    constructor(initial_project_id: string = "") {
        this.project_id = initial_project_id;
        this.loading = false; // Not loading until init() is called
    }

    async init() {
        if (!this.project_id) return;
        this._initialized = true;
        this.loading = true;
        try {
            this.project = await api.get_project_details(this.project_id);
            this.subscribe();
        } catch (e: any) {
            console.error('[ProjectStore] Failed to load project:', e);
            this.error = e.message || 'Failed to load project';
        } finally {
            this.loading = false;
        }
    }

    async switch_project(new_id: string) {
        // If same ID and already initialized, skip
        if (this.project_id === new_id && this._initialized) {
            return;
        }

        // Cleanup old subscription
        this.dispose();

        // clear state
        this.project = null;
        this.snapshots = [];
        this.error = null;
        this._initialized = false;

        // set new id and load
        this.project_id = new_id;
        await this.init();
    }

    /**
     * No-op kept for backwards compatibility.
     * Realtime now only syncs agent_chat changes, so no pause needed.
     */
    pause_realtime(_ms: number = 2000) {
        // No-op: realtime only syncs agent_chat now
    }

    private unsubscribe_fn: (() => Promise<void>) | null = null

    async subscribe() {
        try {
            this.unsubscribe_fn = await pb.collection('_tk_projects')
                .subscribe(this.project_id, (e) => {
                    if (e.action === 'update') {
                        const incoming = e.record as unknown as Project;

                        // Only sync when agent_chat changes (indicates agent activity)
                        const incoming_chat = JSON.stringify(incoming.agent_chat || []);
                        const current_chat = JSON.stringify(this.project?.agent_chat || []);

                        if (incoming_chat !== current_chat) {
                            // Check if agent just finished (status changed to complete)
                            const incoming_msgs = incoming.agent_chat || [];
                            const last_msg = incoming_msgs[incoming_msgs.length - 1];
                            const agent_just_finished = last_msg?.role === 'assistant' && last_msg?.status === 'complete';

                            // Only sync frontend_code when agent finishes to avoid lockups
                            // During streaming, we skip code sync - CodeMirror can't handle rapid large updates
                            this.project = {
                                ...this.project!,
                                agent_chat: incoming.agent_chat,
                                content: incoming.content,
                                design: incoming.design,
                                data: incoming.data,
                                // Sync code only when agent finishes (prevents lockup during streaming)
                                ...(agent_just_finished ? { frontend_code: incoming.frontend_code } : {})
                            };
                        }
                    }
                });
        } catch (err) {
            console.warn('[ProjectStore] Failed to subscribe to realtime:', err);
        }
    }

    dispose() {
        if (this.unsubscribe_fn) {
            // Catch async errors - SSE connection may already be closed
            this.unsubscribe_fn()?.catch?.(() => {})
            this.unsubscribe_fn = null
        }
    }

    async refresh() {
        // simple re-fetch if needed
        try {
            this.project = await api.get_project_details(this.project_id);
        } catch (e) {
            console.error('[ProjectStore] Failed to refresh:', e);
        }
    }

    async loadSnapshots() {
        if (this.snapshots_loading) return;
        this.snapshots_loading = true;
        try {
            this.snapshots = await api.load_snapshots(this.project_id);
        } catch (e) {
            console.error('[ProjectStore] Failed to load snapshots:', e);
        } finally {
            this.snapshots_loading = false;
        }
    }

    // ============ Optimistic Updates ============

    /**
     * Update a design field optimistically (instant local update, debounced save)
     */
    update_design_field(field_id: string, value: string) {
        if (!this.project) return;

        // Update local state immediately
        const design = [...(this.project.design || [])];
        const idx = design.findIndex(f => f.id === field_id);
        if (idx === -1) return;

        design[idx] = { ...design[idx], value };
        this.project = { ...this.project, design };

        // Queue the save
        this._pending_design_saves.set(field_id, design[idx]);
        this._schedule_save();
    }

    /**
     * Update a content field optimistically
     */
    update_content_field(field_id: string, value: any) {
        if (!this.project) return;

        // Update local state immediately
        const content = [...(this.project.content || [])];
        const idx = content.findIndex(f => f.id === field_id);
        if (idx === -1) return;

        content[idx] = { ...content[idx], value };
        this.project = { ...this.project, content };

        // Queue the save
        this._pending_content_saves.set(field_id, content[idx]);
        this._schedule_save();
    }

    private _schedule_save() {
        if (this._save_timeout) clearTimeout(this._save_timeout);
        this._save_timeout = setTimeout(() => this._flush_saves(), this.SAVE_DELAY);
    }

    private async _flush_saves() {
        const design_saves = Array.from(this._pending_design_saves.values());
        const content_saves = Array.from(this._pending_content_saves.values());

        this._pending_design_saves.clear();
        this._pending_content_saves.clear();

        // Save design fields
        for (const field of design_saves) {
            try {
                await api.update_design_field(this.project_id, field.id, field.value);
            } catch (e) {
                console.error('[ProjectStore] Failed to save design field:', e);
            }
        }

        // Save content fields
        for (const field of content_saves) {
            try {
                await api.update_content_field(this.project_id, field.id, field.value);
            } catch (e) {
                console.error('[ProjectStore] Failed to save content field:', e);
            }
        }
    }

    /**
     * Optimistically update code - updates local state immediately
     * so the store stays in sync with what's being saved.
     */
    update_code(code: string) {
        if (!this.project) return;
        this.project = { ...this.project, frontend_code: code };
    }

    /**
     * Optimistically update backend code - updates local state immediately
     */
    update_backend_code(code: string) {
        if (!this.project) return;
        this.project = { ...this.project, backend_code: code };
    }

    /**
     * Add a content field optimistically (caller handles API save)
     */
    add_content_field(field: ContentField) {
        if (!this.project) return;
        const existing = this.project.content || [];
        // Skip if already exists (e.g., realtime beat us to it)
        if (existing.some(f => f.id === field.id)) return;
        this.project = { ...this.project, content: [...existing, field] };
    }

    /**
     * Delete a content field optimistically (caller handles API save)
     */
    delete_content_field(field_id: string) {
        if (!this.project) return;
        const content = (this.project.content || []).filter(f => f.id !== field_id);
        this.project = { ...this.project, content };
    }

    /**
     * Add a design field optimistically (caller handles API save)
     */
    add_design_field(field: DesignField) {
        if (!this.project) return;
        const existing = this.project.design || [];
        // Skip if already exists (e.g., realtime beat us to it)
        if (existing.some(f => f.id === field.id)) return;
        this.project = { ...this.project, design: [...existing, field] };
    }

    /**
     * Delete a design field optimistically (caller handles API save)
     */
    delete_design_field(field_id: string) {
        if (!this.project) return;
        const design = (this.project.design || []).filter(f => f.id !== field_id);
        this.project = { ...this.project, design };
    }

    /**
     * Update project settings (merges with existing)
     */
    async update_settings(updates: Partial<ProjectSettings>) {
        if (!this.project) return;
        const new_settings = { ...this.project.settings, ...updates };
        this.project = { ...this.project, settings: new_settings };
        await api.update_project_settings(this.project_id, updates);
    }

    /**
     * Set the studio theme for this project
     */
    async set_builder_theme(theme_id: string) {
        if (!this.project) return;
        apply_builder_theme(theme_id);
        await this.update_settings({ builder_theme_id: theme_id });
    }
}

export function setProjectStore(store: ProjectStore) {
    setContext(PROJECT_KEY, store);
}

export function getProjectStore(): ProjectStore {
    const store = getContext<ProjectStore>(PROJECT_KEY);
    if (!store) throw new Error('ProjectStore not found in context');
    return store;
}
