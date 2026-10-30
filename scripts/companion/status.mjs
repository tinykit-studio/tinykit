// @ts-nocheck
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readWorkspace } from './workspace.mjs';

export function compileStatus(source, report) {
  const revision = `${source.session_id}:${source.source_revision}`;
  if (source.import_error) return { revision, state: 'blocked', error: source.import_error, requires_browser: false };
  if (source.diagnostic) return { revision, state: 'error', error: source.diagnostic.message, file: source.diagnostic.file, line: source.diagnostic.line, requires_browser: false };
  if (report?.revision === revision) return { ...report, requires_browser: true };
  return { revision, state: 'pending', message: 'Open the companion preview to compile this revision.', requires_browser: true };
}

export async function readStatus(root) {
  let source, workspace;
  try { workspace = await readWorkspace(root); } catch {}
  try { source = JSON.parse(await readFile(join(root, '.tinykit/status.json'), 'utf8')); }
  catch(error) {
    if(error.code !== 'ENOENT' || !workspace) throw error;
    source={project_id:workspace.config.project_id,revision:0,source_revision:workspace.revision,session_id:null};
  }
  let report = null, runtime = null, running = false;
  try { report = JSON.parse(await readFile(join(root, '.tinykit/compile.json'), 'utf8')); } catch {}
  try {
    runtime = JSON.parse(await readFile(join(root, '.tinykit/dev-server.json'), 'utf8'));
    try { process.kill(runtime.pid, 0); running = true; }
    catch (error) { if (error.code === 'EPERM') running = null; else runtime = null; }
  } catch { runtime = null; }
  let check=null;
  try {check=JSON.parse(await readFile(join(root,'.tinykit/check.json'),'utf8'));}catch{}
  const headless_check=check ? (check.source_revision===workspace?.revision ? {state:check.ok?'success':'error',source_revision:check.source_revision,diagnostics:check.diagnostics} : {state:'stale',source_revision:check.source_revision}) : {state:'missing'};
  return { ...source, running, url: (workspace?.config.local_first ? runtime?.preview_url || runtime?.url : runtime?.url) || null, editor_url:runtime?.url || null,
    compile: source.session_id ? compileStatus(source, report) : {state:'not_started',requires_browser:true,message:'Start tinykit dev to open the app preview.'},headless_check };
}
