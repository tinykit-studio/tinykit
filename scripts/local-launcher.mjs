import { access, chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serverOrigin } from './companion/auth.mjs';
import { agentEnvironment } from './companion/agent-environment.mjs';
import { editProject } from './edit-project.mjs';
import { requireNode } from './static-project/cli.mjs';

const execute = promisify(execFile);
const bundleId = 'studio.tinykit.local-launcher';
export function parseLocalEditLink(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value) || /%(?![a-f0-9]{2})/i.test(value)) throw new Error('Invalid Tinykit editing link.');
  const url = new URL(value);
  if (url.protocol !== 'tinykit:' || url.hostname !== 'edit' || url.port || url.username || url.password || url.pathname || url.hash) throw new Error('Only tinykit://edit links are supported.');
  const entries = [...url.searchParams];
  if (entries.length !== 2 || url.searchParams.getAll('server').length !== 1 || url.searchParams.getAll('project').length !== 1) throw new Error('The editing link needs exactly one server and project.');
  const id = url.searchParams.get('project');
  if (!/^[a-z0-9]{15}$/.test(id)) throw new Error('Invalid Tinykit app ID.');
  const server = serverOrigin(url.searchParams.get('server'));
  return { input: id, server, agent: 'codex', launch: true, json: true, registeredOnly: true };
}
export async function openLocalEditLink(value, adapters) {
  return editProject(parseLocalEditLink(value), adapters);
}
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function launcherPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${xml(bundleId)}</string>
<key>CFBundleName</key><string>Tinykit Launcher</string>
<key>CFBundleExecutable</key><string>TinykitLauncher</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSDesktopFolderUsageDescription</key><string>Tinykit opens your registered app folder and its local preview when you choose Edit with local agent in Studio.</string>
<key>CFBundleURLTypes</key><array><dict>
<key>CFBundleURLName</key><string>${xml(bundleId)}.edit</string>
<key>CFBundleTypeRole</key><string>Viewer</string>
<key>CFBundleURLSchemes</key><array><string>tinykit</string></array>
</dict></array>
</dict></plist>\n`;
}
export async function installLauncher() {
  requireNode();
  if (process.platform !== 'darwin') throw new Error('The Studio launcher currently supports macOS. Use tinykit edit from a terminal instead.');
  const config = resolve(process.env.TINYKIT_CONFIG_DIR || join(homedir(), '.config/tinykit'));
  const parent = join(homedir(), 'Applications'), target = join(parent, 'Tinykit Launcher.app');
  for (const path of [parent, target, config]) {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Launcher paths must not be symlinks.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try {
    await access(target);
    const marker = await readFile(join(target, 'Contents/Resources/tinykit-launcher.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (marker?.bundle_id !== bundleId) throw new Error('Another app already occupies the Tinykit Launcher location. Move it before installing.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = await mkdtemp(join(tmpdir(), 'tinykit-launcher-'));
  const bundle = join(temporary, 'Tinykit Launcher.app'), contents = join(bundle, 'Contents');
  let backup;
  try {
    await mkdir(join(contents, 'MacOS'), { recursive: true });
    await mkdir(join(contents, 'Resources'));
    const configuration = { bundle_id: bundleId, node: await realpath(process.execPath), cli: await realpath(fileURLToPath(new URL('./tinykit.mjs', import.meta.url))), config_directory: config };
    await writeFile(join(contents, 'Resources/tinykit-launcher.json'), JSON.stringify(configuration, null, 2), { mode: 0o600 });
    await writeFile(join(contents, 'Info.plist'), launcherPlist());
    try {
      await execute('/usr/bin/xcrun', ['swiftc', fileURLToPath(new URL('./macos/TinykitLauncher.swift', import.meta.url)), '-o', join(contents, 'MacOS/TinykitLauncher'), '-framework', 'AppKit', '-module-cache-path', join(temporary, 'module-cache')], { timeout: 180000, maxBuffer: 1000000 });
    } catch (error) { throw new Error(`Could not build the launcher. Install Apple’s Command Line Tools, then retry tinykit launcher install.\n${String(error.stderr || error.message).slice(-2000)}`); }
    await execute('/usr/bin/codesign', ['--force', '--sign', '-', bundle], { timeout: 30000 });
    await mkdir(parent, { recursive: true });
    await mkdir(config, { recursive: true, mode: 0o700 });
    await chmod(config, 0o700);
    try { await access(target); backup = join(parent, `.Tinykit-Launcher-backup-${Date.now()}.app`); await rename(target, backup); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      await rename(bundle, target);
      await execute('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', target], { timeout: 30000, env: agentEnvironment() });
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      if (backup) { await rename(backup, target); backup = null; }
      throw error;
    }
    if (backup) await rm(backup, { recursive: true });
    return { ok: true, app: target, scheme: 'tinykit', message: `Installed Tinykit Launcher at ${target}. Studio can now open registered apps directly. Keep this Tinykit checkout and Node installation in place; rerun tinykit launcher install after moving them.` };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
