<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  let { on_download, on_close }: {
    on_download: (options: { include_records: boolean; include_assets: boolean }) => Promise<void>;
    on_close: () => void;
  } = $props();
  let include_records = $state(false);
  let include_assets = $state(false);
  let downloading = $state(false);
  let download_error = $state('');
  async function download() {
    downloading = true;
    download_error = '';
    try { await on_download({ include_records, include_assets }); on_close(); }
    catch (error) { download_error = error instanceof Error ? error.message : 'Could not download project.'; }
    finally { downloading = false; }
  }
</script>

<Dialog.Root open onOpenChange={(open) => { if (!open) on_close(); }}>
  <Dialog.Content class="sm:max-w-[460px]">
    <Dialog.Header>
      <Dialog.Title>Download project</Dialog.Title>
      <Dialog.Description>Export your app's code, content, design, and collection definitions for local editing.</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-4 py-4">
      <label class="flex items-start gap-3 text-sm"><input type="checkbox" bind:checked={include_records} disabled={downloading} class="mt-1" /><span>Include current app records<span class="block text-xs opacity-70 mt-1">Copy submissions and other live data into the local app's starting data.</span></span></label>
      <label class="flex items-start gap-3 text-sm"><input type="checkbox" bind:checked={include_assets} disabled={downloading} class="mt-1" /><span>Include uploaded files<span class="block text-xs opacity-70 mt-1">Copy images and uploads, including files submitted by app users. Up to 50 MB.</span></span></label>
      {#if include_records || include_assets}<p class="text-xs opacity-70">Keep this download private if it contains personal records or uploads.</p>{/if}
      {#if download_error}<p role="alert" class="text-sm text-red-500">{download_error}</p>{/if}
    </div>
    <Dialog.Footer>
      <Button variant="outline" disabled={downloading} onclick={on_close}>Cancel</Button>
      <Button disabled={downloading} onclick={download}>{downloading ? 'Preparing download…' : 'Download'}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
