<script lang="ts">
  export let value = "";
  export let language = "javascript";
  export let onChange: (value: string) => void = () => {};

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    onChange(target.value);
  }
</script>

<textarea
  class="w-full h-full bg-[var(--builder-bg-primary)] text-[var(--builder-text-primary)] p-4 font-sans text-sm resize-none focus:outline-none"
  bind:value
  on:input={handleInput}
  spellcheck="false"
></textarea>

<style>
  textarea {
    tab-size: 2;
    -moz-tab-size: 2;
  }
</style>
