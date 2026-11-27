const $ = id => document.getElementById(id);
let state = null, requestId = sessionStorage.getItem('tinykit-start-request') || crypto.randomUUID();
sessionStorage.setItem('tinykit-start-request', requestId);
let working = false;
async function call(path, values) {
  const response = await fetch(path, values ? { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(values) } : {});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Could not complete that step. Please try again.');
  return result;
}
function showError(error) { $('error').textContent = error.message || String(error); $('error').hidden = false; }
function setWorking(value, creating = false) {
  working = value; $('error').hidden = true;
  $('login-button').disabled = value;
  $('create-button').disabled = value || !state?.connected;
  $('switch-account').disabled = value;
  $('progress').hidden = !value || !creating;
  for (const button of document.querySelectorAll('.saved-app')) button.disabled = value;
}
function render(next) {
  state = next; $('loading').hidden = true;
  $('account').hidden = !state.connected;
  $('login-form').hidden = state.connected;
  $('account-server').textContent = state.server;
  $('server').value = state.server || '';
  $('create-button').disabled = working || !state.connected;
  $('apps').replaceChildren();
  $('recent').hidden = !state.apps.length;
  for (const app of state.apps) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'saved-app'; button.disabled = working;
    const label = document.createElement('span'), name = document.createElement('strong'), info = document.createElement('small'), action = document.createElement('span');
    name.textContent = app.name; info.textContent = new URL(app.server).hostname; action.textContent = app.state === 'ready' ? 'Continue ↗' : 'Finish setup ↗';
    label.append(name, info); button.append(label, action);
    button.addEventListener('click', () => prepare('/api/open', {id:app.id})); $('apps').append(button);
  }
}
async function refresh() { render(await call('/api/state')); }
async function prepare(path, values) {
  if (working) return; setWorking(true, true);
  $('progress-title').textContent = path === '/api/open' ? 'Reopening your app…' : 'Preparing your app…';
  $('progress-detail').textContent = path === '/api/open' ? 'Getting your preview ready. Your changes and connection are already here.' : 'Creating its home, getting your files ready, and opening the preview.';
  try {
    const result = await call(path, values);
    if (!/^http:\/\/127\.0\.0\.1:\d+\/companion$/.test(result.url)) throw new Error('The preview address could not be verified.');
    sessionStorage.removeItem('tinykit-start-request'); location.assign(result.url);
  } catch (error) { setWorking(false); showError(error); try { await refresh(); } catch {} }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); if (working) return; setWorking(true);
  const values = {server:$('server').value, email:$('email').value, password:$('password').value}; $('password').value = '';
  try { await call('/api/login', values); await refresh(); setWorking(false); }
  catch (error) { setWorking(false); showError(error); }
});
$('create-form').addEventListener('submit', event => { event.preventDefault(); prepare('/api/create', {name:$('app-name').value, request_id:requestId, template_id:$('starter-select').value}); });
$('switch-account').addEventListener('click', () => { $('account').hidden = true; $('login-form').hidden = false; $('email').focus(); });
refresh().catch(error => { $('loading').hidden = true; $('login-form').hidden = false; showError(error); });

$('starter-select').addEventListener('change', () => {
  const crm = $('starter-select').value === 'personal-crm';
  requestId = crypto.randomUUID(); sessionStorage.setItem('tinykit-start-request', requestId);
  $('app-name').value = crm ? 'My CRM' : 'Project tracker';
  $('starter-title').textContent = crm ? 'Private CRM' : 'Project tracker';
  $('starter-title').nextElementSibling.textContent = crm ? 'Contacts, companies, deals, notes, and follow-ups. A private home for the relationships that matter.' : 'Projects, people, and small next steps. A little clarity for the work that matters.';
  document.querySelector('.mini-app').hidden = crm;
  document.querySelector('.includes').innerHTML = crm ? '<li>Contacts, companies & deal pipeline</li><li>Notes, follow-ups & CSV import/export</li><li>Only you can access the published app</li>' : '<li>Project status, owners & deadlines</li><li>Tasks, progress & notes</li><li>A live preview while you customize</li>';
  $('create-button').firstChild.textContent = crm ? 'Create my private CRM ' : 'Create my tracker ';
  document.querySelector('.quiet').textContent = crm ? 'Sample contacts stay local. Your live CRM starts empty and requires your sign-in.' : 'You’ll try sample projects locally. Your live tracker starts fresh.';
});
