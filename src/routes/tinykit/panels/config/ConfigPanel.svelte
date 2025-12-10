<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import type { ApiEndpoint, ConfigSubTab } from "../../types";
  import * as api from "../../lib/api.svelte";
  import { getProjectContext } from "../../context";

  const { project_id } = getProjectContext();

  type ConfigPanelProps = {
    env_vars: Record<string, string>;
    endpoints: ApiEndpoint[];
    current_subtab: ConfigSubTab;
    on_subtab_change: (subtab: ConfigSubTab) => void;
  };

  let {
    env_vars = $bindable(),
    endpoints = $bindable(),
    current_subtab = $bindable(),
    on_subtab_change,
  }: ConfigPanelProps = $props();

  let new_env_key = $state("");
  let new_env_value = $state("");
  let new_endpoint_name = $state("");
  let new_endpoint_url = $state("");
  let new_endpoint_method = $state("GET");
  let new_endpoint_proxy = $state(false);

  async function add_env_var() {
    if (!new_env_key.trim() || !new_env_value.trim()) return;

    try {
      await api.add_env_var(project_id, new_env_key, new_env_value);
      env_vars = { ...env_vars, [new_env_key]: new_env_value };
      new_env_key = "";
      new_env_value = "";
    } catch (error) {
      console.error("Failed to add env var:", error);
    }
  }

  async function delete_env_var(key: string) {
    if (!confirm(`Delete ${key}?`)) return;

    try {
      await api.delete_env_var(project_id, key);
      const updated_env = { ...env_vars };
      delete updated_env[key];
      env_vars = updated_env;
    } catch (error) {
      console.error("Failed to delete env var:", error);
    }
  }

  async function add_endpoint() {
    if (!new_endpoint_name.trim() || !new_endpoint_url.trim()) return;

    const new_endpoint: Omit<ApiEndpoint, "id"> = {
      name: new_endpoint_name,
      url: new_endpoint_url,
      method: new_endpoint_method,
      headers: {},
      proxy: new_endpoint_proxy,
    };

    try {
      await api.add_endpoint(project_id, new_endpoint);
      // Reload to get the generated ID
      const config = await api.load_config(project_id);
      endpoints = config.endpoints;
      new_endpoint_name = "";
      new_endpoint_url = "";
      new_endpoint_method = "GET";
      new_endpoint_proxy = false;
    } catch (error) {
      console.error("Failed to add endpoint:", error);
    }
  }

  async function delete_endpoint(id: string) {
    if (!confirm("Delete this endpoint?")) return;

    try {
      await api.delete_endpoint(project_id, id);
      endpoints = endpoints.filter((e) => e.id !== id);
    } catch (error) {
      console.error("Failed to delete endpoint:", error);
    }
  }
</script>

<div class="h-full flex flex-col font-sans text-sm">
  <!-- Config Sub-tabs -->
  <div
    class="border-b border-[var(--builder-border)] flex items-center px-4 h-10"
  >
    <button
      class="px-3 py-1.5 text-sm {current_subtab === 'endpoints'
        ? 'text-[var(--builder-text-primary)]'
        : 'text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)]'}"
      onclick={() => {
        current_subtab = "endpoints";
        on_subtab_change("endpoints");
      }}
    >
      Endpoints
    </button>
    <button
      class="px-3 py-1.5 text-sm {current_subtab === 'env'
        ? 'text-[var(--builder-text-primary)]'
        : 'text-[var(--builder-text-secondary)] hover:text-[var(--builder-text-primary)]'}"
      onclick={() => {
        current_subtab = "env";
        on_subtab_change("env");
      }}
    >
      Environment Variables
    </button>
  </div>

  <!-- Config Content -->
  <div class="flex-1 overflow-y-auto p-6">
    {#if current_subtab === "endpoints"}
      <div class="space-y-4">
        <div>
          <h3 class="text-[var(--builder-text-secondary)] mb-2">
            External Endpoints
          </h3>
          <p
            class="text-[var(--builder-text-secondary)] opacity-60 text-xs mb-4"
          >
            Configure third-party API endpoints for your app to use
          </p>
        </div>

        <!-- Add New Endpoint -->
        <div class="space-y-2">
          <input
            type="text"
            bind:value={new_endpoint_name}
            placeholder="Name (e.g., Weather API)"
            class="w-full bg-[var(--builder-bg-secondary)] text-[var(--builder-text-primary)] px-3 py-2 rounded border border-[var(--builder-border)] focus:border-[var(--builder-accent)] focus:outline-none"
          />
          <input
            type="text"
            bind:value={new_endpoint_url}
            placeholder="URL (e.g., https://api.weather.com/v1/forecast)"
            class="w-full bg-[var(--builder-bg-secondary)] text-[var(--builder-text-primary)] px-3 py-2 rounded border border-[var(--builder-border)] focus:border-[var(--builder-accent)] focus:outline-none"
          />
          <div class="flex space-x-2">
            <select
              bind:value={new_endpoint_method}
              class="flex-1 bg-[var(--builder-bg-secondary)] text-[var(--builder-text-primary)] px-3 py-2 rounded border border-[var(--builder-border)] focus:border-[var(--builder-accent)] focus:outline-none"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
              <option value="PATCH">PATCH</option>
            </select>
            <Button onclick={add_endpoint}>Add Endpoint</Button>
          </div>
          <label
            class="flex items-center space-x-2 text-sm text-[var(--builder-text-secondary)] cursor-pointer"
          >
            <input
              type="checkbox"
              bind:checked={new_endpoint_proxy}
              class="rounded bg-[var(--builder-bg-secondary)] border-[var(--builder-border)] text-[var(--builder-accent)] focus:ring-[var(--builder-accent)] focus:ring-offset-0"
            />
            <span
              >Proxy through server (bypasses CORS, keeps secrets server-side)</span
            >
          </label>
        </div>

        <!-- Existing Endpoints -->
        {#if endpoints.length > 0}
          <div class="space-y-2 mt-6">
            {#each endpoints as endpoint (endpoint.id)}
              <div
                class="bg-[var(--builder-bg-secondary)] p-3 rounded border border-[var(--builder-border)] space-y-2"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    <span class="text-[var(--builder-accent)] font-sans"
                      >{endpoint.name}</span
                    >
                    <span
                      class="text-xs bg-[var(--builder-bg-tertiary)] px-2 py-0.5 rounded text-[var(--builder-text-secondary)]"
                      >{endpoint.method}</span
                    >
                    {#if endpoint.proxy}
                      <span
                        class="text-xs bg-green-900/30 border border-green-700 px-2 py-0.5 rounded text-green-400"
                        >Proxied</span
                      >
                    {/if}
                  </div>
                  <button
                    onclick={() => delete_endpoint(endpoint.id)}
                    class="text-[var(--builder-text-secondary)] hover:text-red-500 transition-colors text-sm"
                  >
                    Delete
                  </button>
                </div>
                <div
                  class="text-[var(--builder-text-secondary)] text-sm truncate"
                >
                  {endpoint.url}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="text-[var(--builder-text-secondary)] text-center py-8">
            No endpoints configured yet
          </div>
        {/if}
      </div>
    {:else if current_subtab === "env"}
      <div class="space-y-4">
        <div>
          <h3 class="text-[var(--builder-text-secondary)] mb-2">
            Environment Variables
          </h3>
          <p
            class="text-[var(--builder-text-secondary)] opacity-60 text-xs mb-4"
          >
            Store API keys, secrets, and configuration values
          </p>
        </div>

        <!-- Add New Env Var -->
        <div class="flex space-x-2">
          <Input bind:value={new_env_key} placeholder="KEY" class="flex-1" />
          <Input
            bind:value={new_env_value}
            placeholder="value"
            class="flex-1"
          />
          <Button onclick={add_env_var}>Add</Button>
        </div>

        <!-- Existing Env Vars -->
        {#if Object.keys(env_vars).length > 0}
          <div class="space-y-2 mt-6">
            {#each Object.entries(env_vars) as [key, value] (key)}
              <div
                class="flex items-center space-x-2 bg-[var(--builder-bg-secondary)] p-3 rounded border border-[var(--builder-border)]"
              >
                <span class="text-[var(--builder-accent)] font-sans">{key}</span
                >
                <span class="text-[var(--builder-text-secondary)]">=</span>
                <span
                  class="text-[var(--builder-text-secondary)] flex-1 truncate"
                  >{value}</span
                >
                <button
                  onclick={() => delete_env_var(key)}
                  class="text-[var(--builder-text-secondary)] hover:text-red-500 transition-colors"
                >
                  Delete
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <div class="text-[var(--builder-text-secondary)] text-center py-8">
            No environment variables yet
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
