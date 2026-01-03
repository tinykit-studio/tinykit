<script lang="ts">
  let {
    value = $bindable(""),
    language = "javascript",
    onchange = (value: string) => {}
  } = $props()

  function handle_input(e: Event) {
    const target = e.target as HTMLTextAreaElement
    onchange(target.value)
  }
</script>

<textarea
  class="w-full h-full bg-[var(--builder-bg-primary)] text-[var(--builder-text-primary)] p-4 font-sans text-sm resize-none focus:outline-none"
  bind:value
  oninput={handle_input}
  spellcheck="false"
></textarea>

<style>
  textarea {
    tab-size: 2;
    -moz-tab-size: 2;
  }
</style>
