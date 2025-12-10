<script lang="ts">
  import { fade } from "svelte/transition"
  import * as Popover from "$lib/components/ui/popover"

  type TokenCostProps = {
    usage: {
      model?: string
      promptTokens?: number
      completionTokens?: number
      totalTokens?: number
      webSearches?: number
      cost?: number
    } | null
  }

  let { usage }: TokenCostProps = $props()

  // Map model names/IDs to iconify icons
  const model_icons: Record<string, string> = {
    // Anthropic Claude models
    "claude": "simple-icons:anthropic",
    "claude-3": "simple-icons:anthropic",
    "claude-3.5": "simple-icons:anthropic",
    "claude-3-opus": "simple-icons:anthropic",
    "claude-3-sonnet": "simple-icons:anthropic",
    "claude-3-haiku": "simple-icons:anthropic",
    "claude-3.5-sonnet": "simple-icons:anthropic",
    "claude-3-5-sonnet": "simple-icons:anthropic",
    "claude-sonnet-4": "simple-icons:anthropic",
    // OpenAI models
    "gpt-4": "simple-icons:openai",
    "gpt-4o": "simple-icons:openai",
    "gpt-4o-mini": "simple-icons:openai",
    "gpt-4-turbo": "simple-icons:openai",
    "gpt-3.5": "simple-icons:openai",
    "gpt-3.5-turbo": "simple-icons:openai",
    "o1": "simple-icons:openai",
    "o1-mini": "simple-icons:openai",
    "o1-preview": "simple-icons:openai",
    // Google Gemini models
    "gemini": "simple-icons:googlegemini",
    "gemini-pro": "simple-icons:googlegemini",
    "gemini-1.5": "simple-icons:googlegemini",
    "gemini-1.5-pro": "simple-icons:googlegemini",
    "gemini-1.5-flash": "simple-icons:googlegemini",
    "gemini-2.0-flash": "simple-icons:googlegemini",
    // Meta Llama models
    "llama": "simple-icons:meta",
    "llama-2": "simple-icons:meta",
    "llama-3": "simple-icons:meta",
    // Mistral models
    "mistral": "simple-icons:mistral",
    "mixtral": "simple-icons:mistral",
  }

  function get_model_icon(model: string | undefined): string {
    if (!model) return "lucide:bot"
    const model_lower = model.toLowerCase()
    // Check for exact match first
    if (model_icons[model_lower]) return model_icons[model_lower]
    // Check for partial match (e.g., "claude-3-5-sonnet-20241022" matches "claude")
    for (const [key, icon] of Object.entries(model_icons)) {
      if (model_lower.includes(key)) return icon
    }
    return "lucide:bot"
  }

  function get_model_display_name(model: string | undefined): string {
    if (!model) return "Unknown"
    // Extract a friendly name from the model ID
    const model_lower = model.toLowerCase()
    if (model_lower.includes("claude")) return "Claude"
    if (model_lower.includes("gpt-4o")) return "GPT-4o"
    if (model_lower.includes("gpt-4")) return "GPT-4"
    if (model_lower.includes("gpt-3")) return "GPT-3.5"
    if (model_lower.includes("o1")) return "o1"
    if (model_lower.includes("gemini")) return "Gemini"
    if (model_lower.includes("llama")) return "Llama"
    if (model_lower.includes("mistral")) return "Mistral"
    if (model_lower.includes("mixtral")) return "Mixtral"
    return model.split("-")[0] || "Unknown"
  }

  function format_cost_cents(cost: number | undefined): string {
    if (cost === undefined || cost === null) return "0c"
    const cents = Math.round(cost * 100)
    return `${cents}c`
  }

  function format_tokens(count: number | undefined): string {
    if (count === undefined || count === null) return "0"
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`
    }
    return count.toLocaleString()
  }

  let model_icon = $derived(get_model_icon(usage?.model))
  let model_name = $derived(get_model_display_name(usage?.model))
</script>

{#if usage}
  <Popover.Root>
    <Popover.Trigger class="flex items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity cursor-help">
      <iconify-icon icon={model_icon} class="w-3 h-3" style="font-size: 12px;"></iconify-icon>
      <span
        in:fade={{ duration: 150 }}
        class="text-[0.625rem] text-[var(--builder-text-secondary)]"
      >
        {format_cost_cents(usage.cost)}
      </span>
    </Popover.Trigger>
    <Popover.Content
      class="w-auto p-3 bg-[var(--builder-bg-secondary)] border-[var(--builder-border)]"
      align="end"
      side="top"
      sideOffset={8}
    >
      <div class="text-xs space-y-1.5">
        <div class="flex items-center gap-2 font-medium text-[var(--builder-text-primary)] mb-2">
          <iconify-icon icon={model_icon} style="font-size: 14px;"></iconify-icon>
          <span>{model_name}</span>
        </div>
        <div class="flex justify-between gap-6 text-[var(--builder-text-secondary)]">
          <span>Input</span>
          <span class="text-[var(--builder-text-primary)] font-mono">{format_tokens(usage.promptTokens)}</span>
        </div>
        <div class="flex justify-between gap-6 text-[var(--builder-text-secondary)]">
          <span>Output</span>
          <span class="text-[var(--builder-text-primary)] font-mono">{format_tokens(usage.completionTokens)}</span>
        </div>
        <div class="flex justify-between gap-6 text-[var(--builder-text-secondary)]">
          <span>Total</span>
          <span class="text-[var(--builder-text-primary)] font-mono">{format_tokens(usage.totalTokens)}</span>
        </div>
        {#if usage.webSearches && usage.webSearches > 0}
          <div class="flex justify-between gap-6 text-[var(--builder-text-secondary)] pt-1 border-t border-[var(--builder-border)]">
            <span>Web Searches</span>
            <span class="text-[var(--builder-text-primary)] font-mono">{usage.webSearches}</span>
          </div>
        {/if}
        <div class="flex justify-between gap-6 pt-1 border-t border-[var(--builder-border)]">
          <span class="text-[var(--builder-text-secondary)]">Cost</span>
          <span class="text-[var(--builder-accent)] font-mono font-medium">{format_cost_cents(usage.cost)}</span>
        </div>
      </div>
    </Popover.Content>
  </Popover.Root>
{/if}
