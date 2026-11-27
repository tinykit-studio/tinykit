import config from '../tinykit.json';

export const content = $state({});
export const design = $state({});

function replace(target, values) {
  for (const key of Object.keys(target)) if (!(key in values)) delete target[key];
  for (const [key, value] of Object.entries(values)) target[key] = value;
}

export async function refreshFields() {
  const response = await fetch(`/_tk/config/${config.project_id}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load app fields (${response.status}).`);
  const fields = await response.json();
  for (const key of Object.keys(design)) {
    if (!(key in fields.design)) document.documentElement.style.removeProperty(key);
  }
  replace(content, fields.content);
  replace(design, fields.design);
  for (const [key, value] of Object.entries(design)) {
    if (/^--[\w-]+$/.test(key)) document.documentElement.style.setProperty(key, String(value));
  }
}

// Refresh serially. A failed request retains the last good values and retries.
export function watchFields() {
  let stopped = false, timer;
  async function update() {
    try { if (document.visibilityState !== 'hidden') await refreshFields(); }
    catch (error) { console.warn('[Tinykit fields]', error.message); }
    if (!stopped) timer = setTimeout(update, 2000);
  }
  timer = setTimeout(update, 2000);
  return () => { stopped = true; clearTimeout(timer); };
}
