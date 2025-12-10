<script lang="ts">
  import { onMount } from 'svelte';
  import type { SymbolRegistryEntry } from '$lib/types/custom-fields';

  let {
    customType,
    value,
    disabled = false,
    config = {},
    onChange = () => {}
  }: {
    customType: string
    value: any
    disabled?: boolean
    config?: any
    onChange?: (value: any) => void
  } = $props()

  let symbol = $state<SymbolRegistryEntry | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let componentModule = $state<any>(null);

  async function loadCustomField() {
    try {
      // Fetch symbol metadata
      const response = await fetch(`/api/symbols/${customType}`);

      if (!response.ok) {
        throw new Error(`Custom field "${customType}" not found`);
      }

      symbol = await response.json();

      // Dynamically import the component
      // Note: This requires the component to be in the static directory or bundled
      // For now, we'll use a placeholder approach

      loading = false;
    } catch (err: any) {
      console.error('Failed to load custom field:', err);
      error = err.message;
      loading = false;
    }
  }

  function handleChange(event: CustomEvent) {
    onChange(event.detail.value);
  }

  onMount(() => {
    loadCustomField();
  });
</script>

{#if loading}
  <div class="custom-field-loading">
    <div class="spinner"></div>
    <span>Loading {customType}...</span>
  </div>
{:else if error}
  <div class="custom-field-error">
    <span class="error-icon">⚠️</span>
    <div class="error-content">
      <strong>Failed to load custom field</strong>
      <p>{error}</p>
      <small>Field type: {customType}</small>
    </div>
  </div>
{:else if symbol}
  <div class="custom-field-container">
    <div class="custom-field-header">
      <span class="field-icon">{symbol.manifest.icon || '🔧'}</span>
      <span class="field-type">{symbol.manifest.name}</span>
    </div>

    <!--
      For full implementation, we would dynamically import and render the component here.
      Since Svelte doesn't support truly dynamic component loading in the browser without
      additional build configuration, we'll need to either:

      1. Use a component registry with pre-imported components
      2. Load components from a CDN/static directory
      3. Use iframe/web components

      For now, we'll show a placeholder that indicates the field type and value
    -->
    <div class="custom-field-placeholder">
      <p><strong>Custom Field:</strong> {symbol.manifest.name}</p>
      <p><strong>Type:</strong> {customType}</p>
      <p><strong>Current Value:</strong></p>
      <pre>{JSON.stringify(value, null, 2)}</pre>

      {#if !disabled}
        <p class="note">
          <em>Note: Full custom field rendering requires dynamic component loading.
          For now, you can edit the value via the API or agent tools.</em>
        </p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .custom-field-loading {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: #f5f5f5;
    border-radius: 8px;
    color: #666;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 3px solid #e0e0e0;
    border-top-color: #666;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .custom-field-error {
    display: flex;
    gap: 12px;
    padding: 16px;
    background: #fff3f3;
    border: 1px solid #ffcdd2;
    border-radius: 8px;
    color: #c62828;
  }

  .error-icon {
    font-size: 24px;
  }

  .error-content strong {
    display: block;
    margin-bottom: 4px;
  }

  .error-content p {
    margin: 4px 0;
    font-size: 14px;
  }

  .error-content small {
    display: block;
    margin-top: 8px;
    opacity: 0.7;
    font-family: monospace;
  }

  .custom-field-container {
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    overflow: hidden;
  }

  .custom-field-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    background: #f8f8f8;
    border-bottom: 1px solid #e0e0e0;
    font-weight: 600;
    font-size: 14px;
  }

  .field-icon {
    font-size: 18px;
  }

  .field-type {
    color: #333;
  }

  .custom-field-placeholder {
    padding: 16px;
    background: #fafafa;
  }

  .custom-field-placeholder p {
    margin: 8px 0;
    font-size: 14px;
  }

  .custom-field-placeholder pre {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 12px;
    overflow-x: auto;
    font-size: 12px;
    font-family: 'Monaco', 'Courier New', monospace;
  }

  .note {
    margin-top: 12px;
    padding: 12px;
    background: #e3f2fd;
    border-left: 3px solid #2196f3;
    color: #1565c0;
    font-size: 13px;
  }

  .note em {
    font-style: normal;
  }
</style>
