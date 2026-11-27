onRecordCreateRequest((e) => {
  if (e.auth && !e.auth.isSuperuser()) {
    if (e.record.getString('owner') && e.record.getString('owner') !== e.auth.id) throw new ForbiddenError('Choose your own account as the app owner.');
    e.record.set('owner', e.auth.id);
  }
  const settings = JSON.parse(e.record.getString('settings') || '{}') || {};
  if (settings.template_id === 'personal-crm') e.record.set('visibility', 'private');
  if (e.record.getString('visibility') === 'private' && !e.record.getString('owner')) throw new BadRequestError('A private app needs an owner.');
  e.next();
}, '_tk_projects');

// Internal hosted publication writes use app.save rather than HTTP record
// requests, so this relation is maintained in model hooks too.
onRecordCreate((e) => {
  e.record.set('project_access', e.record.getString('project'));
  e.next();
}, '_tk_source_assets');

onRecordUpdate((e) => {
  e.record.set('project_access', e.record.getString('project'));
  e.next();
}, '_tk_source_assets');

onRecordUpdateRequest((e) => {
  const original = e.record.original();
  if (!e.auth?.isSuperuser()) {
    if (e.record.getString('owner') !== original.getString('owner')) throw new ForbiddenError('App ownership cannot be changed here.');
    if (e.record.getString('visibility') !== original.getString('visibility') && e.auth?.id !== original.getString('owner')) throw new ForbiddenError('Only the owner can change app access.');
  }
  if (e.record.getString('visibility') === 'private' && !e.record.getString('owner')) throw new BadRequestError('A private app needs an owner.');
  e.next();
}, '_tk_projects');
