import { setContext, getContext } from 'svelte';
import { pb } from '$lib/pocketbase.svelte';
import * as api from '../lib/api.svelte';
import type { Project, Snapshot, DesignField, ContentField } from '../types';

const PROJECT_KEY = Symbol('PROJECT');

export class ProjectStore {
    project = $state<Project | null>(null);
    snapshots = $state<Snapshot[]>([]);
    snapshots_loading = $state(false);
    loading = $state(true);
    error = $state<string | null>(null);

    // Optimistic update tracking
    private _ignore_realtime_until = 0;
    private _last_local_update: string | null = null; // Hash of last local change
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
    backend_code = $derived(this.project?.backend_code || '');

    // UI state that might be shared
    is_processing = $derived.by(() => {
        const msgs = this.messages;
        const last = msgs[msgs.length - 1];
        return last?.role === 'assistant' && last?.status === 'running';
    });

    constructor(public project_id: string) { }

    async init() {
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

    /**
     * Call this before any local save to prevent realtime echo from overwriting.
     */
    pause_realtime(ms: number = 2000) {
        this._ignore_realtime_until = Date.now() + ms;
    }

    private _hash_project(p: Project | null): string {
        if (!p) return '';
        // Hash the mutable fields that we care about for echo detection
        const code = p.frontend_code || '';
        const backend = p.backend_code || '';
        return JSON.stringify({
            // Use length + start + end for code (catches changes anywhere)
            code_len: code.length,
            code_start: code.slice(0, 50),
            code_end: code.slice(-50),
            backend_len: backend.length,
            backend_start: backend.slice(0, 50),
            backend_end: backend.slice(-50),
            design: p.design?.map(d => d.id + ':' + d.value).join(','),
            content: p.content?.map(c => c.id + ':' + c.value).join(',')
        });
    }

    subscribe() {
        pb.collection('_tk_projects')
            .subscribe(this.project_id, (e) => {
                if (e.action === 'update') {
                    const incoming = e.record as unknown as Project;
                    const incoming_hash = this._hash_project(incoming);
                    const current_hash = this._hash_project(this.project);
                    const within_timeout = Date.now() < this._ignore_realtime_until;
                    const is_echo = this._last_local_update && incoming_hash === this._last_local_update;

                    // Check if agent_chat changed (always allow these through)
                    const incoming_chat = JSON.stringify(incoming.agent_chat || []);
                    const current_chat = JSON.stringify(this.project?.agent_chat || []);
                    const chat_changed = incoming_chat !== current_chat;

                    // For code/design/content: filter echoes of our own saves
                    if (incoming_hash !== current_hash) {
                        if (within_timeout || is_echo) {
                            if (is_echo) this._last_local_update = null;
                            // When agent chat changes, also apply content/design/data changes
                            // because they likely came from agent tool calls
                            if (chat_changed) {
                                this.project = {
                                    ...this.project!,
                                    agent_chat: incoming.agent_chat,
                                    content: incoming.content,
                                    design: incoming.design,
                                    data: incoming.data
                                };
                            }
                            return;
                        }
                    }

                    // Skip if nothing changed
                    if (incoming_hash === current_hash && !chat_changed) return;

                    // Apply the update
                    this._last_local_update = null;
                    this.project = incoming;
                }
            })
            .catch((err) => {
                console.warn('[ProjectStore] Failed to subscribe to realtime:', err);
            });
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
        this._last_local_update = this._hash_project(this.project); // Track for echo detection

        // Queue the save
        this._pending_design_saves.set(field_id, design[idx]);
        this._schedule_save();

        // Ignore realtime echoes for a bit
        this._ignore_realtime_until = Date.now() + 1000;
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
        this._last_local_update = this._hash_project(this.project); // Track for echo detection

        // Queue the save
        this._pending_content_saves.set(field_id, content[idx]);
        this._schedule_save();

        // Ignore realtime echoes for a bit
        this._ignore_realtime_until = Date.now() + 1000;
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
        this._last_local_update = this._hash_project(this.project);
        this._ignore_realtime_until = Date.now() + 2000;
    }

    /**
     * Optimistically update backend code - updates local state immediately
     */
    update_backend_code(code: string) {
        if (!this.project) return;
        this.project = { ...this.project, backend_code: code };
        this._last_local_update = this._hash_project(this.project);
        this._ignore_realtime_until = Date.now() + 2000;
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
        this._last_local_update = this._hash_project(this.project);
        this._ignore_realtime_until = Date.now() + 2000;
    }

    /**
     * Delete a content field optimistically (caller handles API save)
     */
    delete_content_field(field_id: string) {
        if (!this.project) return;
        const content = (this.project.content || []).filter(f => f.id !== field_id);
        this.project = { ...this.project, content };
        this._last_local_update = this._hash_project(this.project);
        this._ignore_realtime_until = Date.now() + 2000;
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
        this._last_local_update = this._hash_project(this.project);
        this._ignore_realtime_until = Date.now() + 2000;
    }

    /**
     * Delete a design field optimistically (caller handles API save)
     */
    delete_design_field(field_id: string) {
        if (!this.project) return;
        const design = (this.project.design || []).filter(f => f.id !== field_id);
        this.project = { ...this.project, design };
        this._last_local_update = this._hash_project(this.project);
        this._ignore_realtime_until = Date.now() + 2000;
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
