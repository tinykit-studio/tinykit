<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    value: number;
    steps: number[];
    onchange: (value: number) => void;
    format_label?: (step: number) => string;
    format_display?: (value: number) => string;
    preview?: Snippet<[number]>;
  };

  let {
    value = $bindable(),
    steps,
    onchange,
    format_label = (s) => String(s),
    format_display = (v) => `${v}px`,
    preview,
  }: Props = $props();

  function get_step_index(val: number): number {
    let nearest = 0;
    let min_diff = Math.abs(val - steps[0]);
    for (let i = 1; i < steps.length; i++) {
      const diff = Math.abs(val - steps[i]);
      if (diff < min_diff) {
        min_diff = diff;
        nearest = i;
      }
    }
    return nearest;
  }

  function handle_input(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    value = steps[parseInt(target.value)];
    onchange(value);
  }

  function handle_step(step: number) {
    value = step;
    onchange(value);
  }
</script>

<div class="step-slider" class:has-preview={preview}>
  <div class="slider-section">
    <input
      type="range"
      min="0"
      max={steps.length - 1}
      step="1"
      value={get_step_index(value)}
      oninput={handle_input}
      class="slider"
    />
    <div class="steps" style="--step-count: {steps.length}">
      {#each steps as step, i (step)}
        <button
          type="button"
          class="step-btn"
          class:active={value === step}
          onclick={() => handle_step(step)}
          style="--step-index: {i}"
        >
          {format_label(step)}
        </button>
      {/each}
    </div>
  </div>
  {#if preview}
    <div class="preview">
      {@render preview(value)}
    </div>
  {:else}
    <div class="display">{format_display(value)}</div>
  {/if}
</div>

<style>
  .step-slider {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .step-slider.has-preview {
    flex-direction: row;
    align-items: center;
    gap: 16px;
  }

  .slider-section {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .slider {
    width: 100%;
    height: 16px;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }

  .slider::-webkit-slider-runnable-track {
    width: 100%;
    height: 6px;
    background: var(--builder-bg-tertiary);
    border-radius: 3px;
  }

  .slider::-moz-range-track {
    width: 100%;
    height: 6px;
    background: var(--builder-bg-tertiary);
    border-radius: 3px;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--builder-accent);
    cursor: pointer;
    border: 2px solid var(--builder-bg-secondary);
    margin-top: -5px;
  }

  .slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--builder-accent);
    cursor: pointer;
    border: 2px solid var(--builder-bg-secondary);
  }

  .steps {
    position: relative;
    height: 20px;
  }

  .step-btn {
    position: absolute;
    font-size: 9px;
    color: var(--builder-text-secondary);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 2px;
    background: transparent;
    border: none;
    transition: all 0.15s;
    transform: translateX(-50%);
    /* Position each label to match slider thumb position */
    /* Thumb moves from 8px to (100% - 8px), so we interpolate within that range */
    left: calc(8px + (100% - 16px) * var(--step-index) / (var(--step-count) - 1));
  }

  .step-btn:hover {
    color: var(--builder-text-primary);
  }

  .step-btn.active {
    color: var(--builder-accent);
    background: var(--builder-bg-tertiary);
  }

  .display {
    font-size: 12px;
    font-family: ui-monospace, monospace;
    color: var(--builder-text-secondary);
    text-align: center;
  }

  .preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
</style>
