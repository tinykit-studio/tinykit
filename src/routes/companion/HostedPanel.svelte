<script lang="ts">
  import { onMount } from 'svelte';
  import { watch } from 'runed';

  let { source_revision = '', import_error = '' }: { source_revision?: string; import_error?: string } = $props();
  let server = $state('');
  let projectId = $state('');
  let email = $state('');
  let password = $state('');
  let showConnection = $state(false);
  let review = $state<any>(null);
  let busy = $state('');
  let failure = $state('');
  let message = $state('');
  let available = $state(false);
  let initializing = $state(true);
  let showChanges = $state(false);
  let showPublishReview = $state(false);
  let reviewValid = $state(false);
  let reviewRequest = 0;
  const changedFiles = $derived(review?.changes?.filter((file: any) => file.local !== file.hosted) || []);
  const unpublishedFiles = $derived(review?.changes?.filter((file: any) => file.hosted !== file.published) || []);
  const stale = $derived(Boolean(review && source_revision && review.review.local_revision !== source_revision));
  const canAct = $derived(available && reviewValid && (review?.linked || review?.new_target) && !review?.conflict && !stale && !busy && !import_error);

  async function request(action: string, values: any = {}) {
    const response = await fetch('/companion/hosted', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...values })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      let detail = result.error || result.message || 'Could not contact the hosted app.';
      if (result.push?.state === 'succeeded') detail = 'Draft saved. ' + detail;
      throw new Error(detail);
    }
    return result;
  }
  async function refresh() {
    const ticket = ++reviewRequest;
    let next;
    try { next = await request('review'); }
    catch (error) { if (ticket === reviewRequest) reviewValid = false; throw error; }
    if (ticket !== reviewRequest) return;
    review = next;
    reviewValid = true;
    available = true;
    server = review.server;
    projectId = review.project_id;
  }
  async function run(action: string, publish = false) {
    if (busy) return;
    busy = action === 'push' && publish ? 'Publishing local files…' : action === 'publish' ? 'Building hosted draft…' : action === 'connect' ? 'Connecting…' : action === 'push' ? 'Saving draft…' : 'Checking hosted app…';
    reviewRequest++;
    failure = '';
    message = '';
    try {
      if (action === 'review') await refresh();
      else {
        const values = action === 'connect' ? { server, project_id: projectId, email, password } : { review: review?.review, publish };
        // Clear the form immediately; the server never saves the password.
        if (action === 'connect') password = '';
        const result = await request(action, values);
        if (action === 'connect') { review = result; reviewValid = true; available = true; showConnection = false; }
        else {
          message = action === 'link' ? 'Review accepted. You can now save your local files to the hosted draft.' : result.message || 'Published successfully.';
          await refresh();
        }
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Hosted operation failed.';
      reviewValid = false;
      // A failed build may still have saved the draft. Reconcile the displayed versions.
      if (action === 'push' || action === 'publish') {
        try { await refresh(); } catch { /* Keep the actual operation error visible. */ }
      }
    } finally { busy = ''; }
  }
  async function reviewChanges() { await run('review'); if (reviewValid) showChanges = true; }
  async function preparePublish() { await run('review'); if (reviewValid) { if (review.conflict || (!review.linked && !review.new_target)) showChanges = true; else showPublishReview = true; } }
  watch(() => source_revision, () => {
    if (available && !busy && !showChanges && !showConnection && !showPublishReview) refresh().catch(error => failure = error.message);
  });
  onMount(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function initialize() {
      try {
        const connection = await request('connection');
        if (stopped) return;
        server = connection.server; projectId = connection.project_id;
        if (server) await run('review');
        else showConnection = true;
      } catch (error) { failure = error instanceof Error ? error.message : 'Could not read connection.'; }
      initializing = false;
      if (!stopped) schedule();
    }
    function schedule() {
      timer = setTimeout(async () => {
        if (!busy && available && !showConnection && !showChanges && !showPublishReview) {
          try { await refresh(); } catch (error) { failure = error instanceof Error ? error.message : 'Connection lost.'; }
        }
        if (!stopped) schedule();
      }, 15000);
    }
    initialize();
    return () => { stopped = true; clearTimeout(timer); };
  });
  function openReview(node: HTMLDialogElement) { node.showModal(); }
  const collectionLabel = (name: string, count: number) => `${count} ${name.replaceAll('_', ' ').replace(/s$/, count === 1 ? '' : 's')}`;
</script>

<section class="hosting" aria-label="Hosted publishing">
  <div class="section-heading"><h2>Hosted app</h2><button class="text-button" onclick={() => { showConnection = !showConnection; password = ''; }} disabled={!!busy || initializing}>{showConnection ? 'Close' : review ? 'Connection' : 'Connect'}</button></div>
  {#if initializing}<p class="hint" role="status">Connecting your app…</p>{/if}
  {#if showConnection || (!review && !busy && !initializing)}
    <form onsubmit={(event) => { event.preventDefault(); run('connect'); }}>
      <label>Server address<input type="url" bind:value={server} placeholder="https://tinykit.example.com" required disabled={!!busy} /></label>
      <label>Project ID<input bind:value={projectId} minlength="15" maxlength="15" pattern="[a-z0-9]{15}" required disabled={!!busy} /></label>
      <label>Email<input type="email" autocomplete="username" bind:value={email} placeholder="Reuse saved login if empty" disabled={!!busy} /></label>
      {#if email}<label>Password<input type="password" autocomplete="current-password" bind:value={password} required disabled={!!busy} /></label>{/if}
      <button class="primary" type="submit" disabled={!!busy}>Connect to app</button>
      <p class="hint">Use your hosted Tinykit account. Your login stays in this app’s local folder.</p>
    </form>
  {/if}
  {#if review}
    <p class="destination" title={review.server}>{review.server.replace(/^https?:\/\//, '')}<span>Publishing destination connected</span></p>
    <div class="versions">
      <div><span class="dot local"></span><div><strong>Your app</strong><small>{stale ? 'Checking your latest changes' : changedFiles.length ? 'Unpublished changes' : 'Matches the saved draft'}</small></div></div>
      <div><span class="dot draft"></span><div><strong>Saved draft</strong><small>{review.draft_stale ? 'Needs your latest changes' : review.draft_revision ? 'Saved on Tinykit' : 'Ready for your first publish'}</small></div></div>
      <div><span class="dot live"></span><div><strong>Live app</strong><small>{review.published_at ? `Published ${new Date(review.published_at).toLocaleDateString()}` : 'Not published yet'}</small></div>{#if review.published_revision}<a href={review.public_url} target="_blank" rel="noreferrer">Open ↗</a>{/if}</div>
    </div>
    <div class="review-actions"><button onclick={reviewChanges} disabled={!!busy}>Review changes</button><button class="text-button" onclick={() => run('review')} disabled={!!busy}>Refresh</button></div>
    {#if review.new_target}
      <p class="notice">Saving a draft or publishing creates a new {review.visibility} app on this server. Local records stay in this preview.</p>
    {:else if review.conflict || !review.linked}
      <div class="notice"><strong>{review.conflict ? 'Hosted changes need review' : 'Review before your first push'}</strong><p>Compare the versions, then accept them to allow your local files to replace the hosted draft.</p><button onclick={reviewChanges} disabled={!!busy}>Compare versions</button></div>
    {:else if stale}<p class="notice">Files changed. Refresh the review before publishing.</p>{/if}
    <div class="publish-actions">
      <button onclick={() => run('push')} disabled={!canAct}>Save draft</button>
      <button class="primary" onclick={preparePublish} disabled={!canAct}>Review &amp; publish</button>
    </div>
    {#if review.draft_revision && review.draft_revision !== review.published_revision}<button class="text-button saved-publish" onclick={() => run('publish')} disabled={!canAct || review.draft_stale}>Publish saved hosted draft</button>{/if}
    <p class="hint">Publishing keeps live records, user uploads, and hosted settings.</p>
  {/if}
  {#if busy}<p class="progress" role="status"><span class="spinner"></span>{busy}</p>{/if}
  {#if message}<p class="success" role="status">{message}</p>{/if}
  {#if failure}<div class="failure" role="alert"><strong>Could not complete the action</strong><pre>{failure}</pre><button class="text-button" onclick={() => run('review')} disabled={!!busy}>Check hosted versions</button></div>{/if}
</section>

{#if showPublishReview && review}
  <dialog class="publish-dialog" aria-labelledby="publish-title" use:openReview oncancel={() => { if (!busy) showPublishReview = false; }}>
    
    <h2 id="publish-title">{review.published_revision ? 'Ready to publish your changes?' : 'Ready to use your app?'}</h2>
    {#if review.visibility === 'private'}<p>This app is private. Only you can open it and access its records after signing in.</p>{:else}<p>This is a public app. Anyone with the link can view and edit its records.</p>{/if}
    <div class="preserved"><strong>Your existing work stays.</strong>
      {#if review.live_data_summary?.total > 0}<p>Keeps {review.live_data_summary.collections.filter((collection: any) => collection.count > 0).map((collection: any) => collectionLabel(collection.name, collection.count)).join(' and ')}.</p>{:else if review.live_data_summary?.total === 0}<p>Your live app starts fresh. Local sample records will stay in this preview.</p>{:else}<p>Live records stay on the server. Local sample data is never uploaded.</p>{/if}
      <p>Live uploads and hosted settings are preserved too.</p>
    </div>
    <p class="publish-address">{review.public_url}</p>
    {#if stale}<p class="failure" role="alert">Your files changed during this review. Close it and review the latest version before publishing.</p>{/if}
    {#if failure}<p class="failure" role="alert">{failure}</p>{/if}
    {#if busy}<p role="status">{busy}</p>{/if}
    <footer><button disabled={!!busy} onclick={() => showPublishReview = false}>Keep editing</button><button class="primary" disabled={!canAct} onclick={async () => { await run('push', true); if (!failure) showPublishReview = false; }}>{busy ? 'Publishing…' : 'Publish app'}</button></footer>
  </dialog>
{/if}

{#if showChanges && review}
  <dialog class="review-dialog" aria-labelledby="review-title" use:openReview oncancel={() => showChanges = false}>
      <div class="dialog-heading"><div><h2 id="review-title">Review your app</h2><p>{changedFiles.length} {changedFiles.length === 1 ? 'file differs' : 'files differ'} from the hosted draft · {unpublishedFiles.length} hosted files differ from the last companion publication</p></div><button onclick={() => showChanges = false}>Close</button></div>
      <p class="review-note">The hosted column shows the saved draft, or current hosted source when there is no draft. Records and user uploads are excluded. An app published in Studio may have no companion publication to compare yet.</p>
      <div class="diffs">
        {#each review.changes as file}
          <details open={file.local !== file.hosted || file.source !== file.hosted}>
            <summary><code>{file.file}</code><span>{file.local !== file.hosted ? 'Local changes' : file.hosted !== file.published ? 'Unpublished changes' : file.source !== file.hosted ? 'Hosted source changed' : 'Unchanged'}</span></summary>
            <div class="diff-columns" class:has-source={file.source !== file.hosted}><div><h3>Local files</h3><pre>{file.local || '(empty)'}</pre></div><div><h3>Hosted draft</h3><pre>{file.hosted || '(empty)'}</pre></div><div><h3>Last companion publication</h3><pre>{file.published || '(none)'}</pre></div>{#if file.source !== file.hosted}<div><h3>Current hosted source</h3><pre>{file.source || '(empty)'}</pre></div>{/if}</div>
          </details>
        {/each}
      </div>
      <footer>
        <p>Only app definitions are pushed. Live data stays on the server.</p>
        {#if review.conflict || (!review.linked && !review.new_target)}<button class="primary" disabled={!!busy || stale || !reviewValid} onclick={async () => { await run('link'); if (reviewValid && !review?.conflict) showChanges = false; }}>Accept reviewed versions</button>{:else}<button class="primary" onclick={() => showChanges = false}>Done reviewing</button>{/if}
      </footer>
  </dialog>
{/if}

<style>
  .publish-dialog { width: min(510px, calc(100vw - 32px)); border: 1px solid #dce5d6; border-radius: 14px; padding: 30px; color: #29432e; background: #fcfdf9; }
  .publish-dialog::backdrop { background: #17271cb3; }
  .publish-dialog h2 { font-size: 24px; letter-spacing: -.8px; line-height: 1.25; margin: 15px 0; }
  .publish-dialog > p { font-size: 12px; line-height: 1.7; color: #839477; }
  .preserved { background: #edf3e6; border: 1px solid #dce7d3; border-radius: 8px; padding: 17px; margin: 22px 0; font-size: 13px; }
  .preserved p { font-size: 12px; color: #758a66; line-height: 1.7; margin: 7px 0 0; }
  .publish-dialog .publish-address { font-size: 10px; overflow-wrap: anywhere; margin-bottom: 25px; }
  .hosting { margin: 28px 0 0; border-top: 1px solid #dce2df; padding-top: 22px; font-size: 12px; }
  .section-heading, .review-actions, .publish-actions, .dialog-heading, footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  h2 { font-size: 14px; font-weight: 650; margin: 0; color: #1d332a; }
  button, input { font: inherit; }
  button { border: 1px solid #cfdad3; background: white; color: #244e37; border-radius: 7px; padding: 8px 11px; cursor: pointer; font-weight: 550; }
  button:hover:enabled { background: #edf5ef; }
  button:disabled { opacity: .45; cursor: default; }
  button:focus-visible, input:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid #308754; outline-offset: 3px; }
  .primary { background: #286444; border-color: #286444; color: white; }
  .primary:hover:enabled { background: #1f5136; }
  .text-button { border: 0; background: transparent; padding: 5px 0; color: #50715b; }
  form { display: grid; gap: 12px; margin-top: 18px; }
  label { display: grid; gap: 6px; color: #53685a; }
  input { border: 1px solid #cfdad3; border-radius: 6px; padding: 9px 10px; width: 100%; min-width: 0; background: white; color: #183226; }
  .hint, .review-note { font-size: 11px; color: #718077; line-height: 1.65; margin: 12px 0 0; }
  .destination { margin: 16px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #4d6656; }
  .destination span { display: block; font-family: monospace; font-size: 10px; color: #829087; margin-top: 3px; }
  .versions { border: 1px solid #dce5de; border-radius: 9px; background: white; padding: 3px 12px; }
  .versions > div { display: flex; gap: 10px; align-items: center; padding: 11px 0; }
  .versions > div + div { border-top: 1px solid #edf0ed; }
  .versions strong { display: block; font-weight: 550; }
  small { display: block; color: #7a8a7f; font-size: 10px; margin-top: 4px; }
  .dot { height: 7px; width: 7px; border-radius: 50%; flex-shrink: 0; background: #a6b3aa; }
  .local { background: #759ac0; } .draft { background: #bda46a; } .live { background: #57a370; }
  a { margin-left: auto; font-size: 11px; color: #286444; text-decoration: none; }
  .review-actions { margin: 13px 0; }
  .publish-actions { margin-top: 16px; }
  .publish-actions > button { flex: 1; padding: 10px 7px; white-space: nowrap; }
  .saved-publish { display: block; margin: 8px auto 0; font-size: 11px; }
  .notice, .failure { background: #fff8e9; color: #7d5d28; border: 1px solid #e8dabc; border-radius: 7px; padding: 12px; margin-top: 14px; line-height: 1.6; }
  .notice p { margin: 6px 0 10px; }
  .failure { color: #913d2b; background: #fff1ec; border-color: #edcdbf; }
  .failure pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.6 monospace; max-height: 240px; overflow: auto; }
  .progress { display: flex; gap: 8px; align-items: center; color: #426a50; margin-top: 14px; }
  .spinner { width: 11px; height: 11px; border: 2px solid #d8e6dc; border-top-color: #407754; border-radius: 50%; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .success { color: #2c7347; line-height: 1.6; padding: 10px 0; }
  .review-dialog::backdrop { background: #14291c66; }
  .review-dialog { width: min(1100px, calc(100% - 48px)); margin: auto; max-height: 90dvh; background: #f9fbf9; color: #20382a; border: 1px solid #d7e1d9; box-shadow: 0 16px 80px #0e241f33; border-radius: 13px; display: flex; flex-direction: column; padding: 22px; font: 12px system-ui, sans-serif; }
  .dialog-heading h2 { font-size: 21px; }
  .dialog-heading p, footer p { color: #718077; font-size: 11px; margin: 7px 0 0; }
  .review-note { margin: 12px 0; }
  .diffs { overflow: auto; flex: 1; min-height: 0; }
  details { border: 1px solid #dce5de; border-radius: 8px; margin-bottom: 10px; background: white; overflow: hidden; }
  summary { cursor: pointer; padding: 13px; }
  summary span { float: right; font-size: 11px; color: #7a8d7e; }
  .diff-columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid #dce5de; }
  .diff-columns.has-source { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .diff-columns > div + div { border-left: 1px solid #dce5de; }
  h3 { margin: 0; padding: 9px 12px; font-size: 10px; color: #617b69; background: #f1f6f2; }
  .diff-columns pre { padding: 12px; margin: 0; max-height: 320px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.6 monospace; }
  footer { padding-top: 18px; }
  @media (max-width: 700px) { .diff-columns, .diff-columns.has-source { grid-template-columns: 1fr; } .diff-columns > div + div { border-left: 0; border-top: 1px solid #dce5de; } .review-dialog { padding: 14px; } footer { align-items: flex-start; } }
</style>
