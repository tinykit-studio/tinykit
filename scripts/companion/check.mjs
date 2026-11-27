import { mkdir, realpath, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { readWorkspace, readWorkspaceFile, writeAtomic } from './workspace.mjs';
import { buildHostedDefinition } from './build.mjs';
import { claimWorkspace, syntaxDiagnostic } from './dev.mjs';

export async function checkWorkspace(directory) {
  const root = await realpath(directory),
    runtime = join(root, '.tinykit');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  if ((await realpath(runtime)) !== runtime)
    throw Error('.tinykit must stay inside the app folder.');
  const release = await claimWorkspace(runtime, 'hosted.lock');
  try {
    const workspace = await readWorkspace(root),
      diagnostics = [];
    const result = {
      ok: false,
      runtime: 'companion',
      source_revision: workspace.revision,
      build: { state: 'pending' },
      tests: {
        state: 'skipped',
        reason: 'No application test runner is configured for this single-component app.'
      },
      browser: { state: 'not_checked' },
      diagnostics
    };
    const syntax = syntaxDiagnostic(workspace.project.frontend_code);
    if (syntax) {
      result.build.state = 'error';
      diagnostics.push({ stage: 'build', ...syntax });
    } else
      try {
        const definition = { ...workspace.project, schema: workspace.schema, assets: {} },
          localAssets = {};
        const mime = {
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.avif': 'image/avif',
          '.woff2': 'font/woff2',
          '.pdf': 'application/pdf'
        };
        for (const name of await readdir(join(root, 'assets'))) {
          if (name.startsWith('.')) continue;
          const bytes = await readWorkspaceFile(root, join('assets', name));
          definition.assets[name] = { digest: createHash('sha256').update(bytes).digest('hex') };
          localAssets[name] =
            `data:${mime[extname(name).toLowerCase()] || 'application/octet-stream'};base64,${bytes.toString('base64')}`;
        }
        await buildHostedDefinition(definition, workspace.config.project_id, workspace.revision, {
          localAssets
        });
        result.build.state = 'success';
      } catch (error) {
        result.build.state = 'error';
        diagnostics.push({
          stage: 'build',
          message: error.message,
          file: error.loc?.file?.endsWith('App.svelte') ? 'App.svelte' : undefined,
          line: error.loc?.line,
          column: error.loc?.column
        });
      }
    if ((await readWorkspace(root)).revision !== workspace.revision)
      diagnostics.push({
        stage: 'source',
        message: 'Source changed during validation. Run check again for the current revision.'
      });
    result.ok = result.build.state === 'success' && !diagnostics.length;
    result.message = result.ok
      ? 'Current source builds successfully. Browser interactions have not been checked.'
      : diagnostics.map((item) => item.message).join('\n');
    await writeAtomic(join(runtime, 'check.json'), result);
    return result;
  } finally {
    await release();
  }
}
