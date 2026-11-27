migrate((app) => {
  const projects = app.findCollectionByNameOrId('_tk_projects');
  projects.fields.push(new RelationField({ name: 'owner', collectionId: app.findCollectionByNameOrId('users').id, maxSelect: 1 }));
  projects.fields.push(new SelectField({ name: 'visibility', values: ['public', 'private'], maxSelect: 1 }));
  // Empty visibility preserves the behavior of existing public apps.
  const access = "(visibility != 'private' || owner = @request.auth.id)";
  for (const name of ['listRule', 'viewRule', 'updateRule', 'deleteRule']) {
    if (projects[name] !== null) projects[name] = projects[name] ? '(' + projects[name] + ') && ' + access : access;
  }
  for (const name of ['assets', 'published_html']) projects.fields.getByName(name).protected = true;
  app.save(projects);
  const assets = app.findCollectionByNameOrId('_tk_source_assets');
  // Keep the original text field and its file references byte-for-byte. The
  // separate relation supports authorization without a destructive type change.
  assets.fields.push(new RelationField({ name: 'project_access', collectionId: projects.id, maxSelect: 1 }));
  const sourceAccess = "(project_access != '' && (project_access.visibility != 'private' || project_access.owner = @request.auth.id))";
  for (const name of ['listRule', 'viewRule']) {
    if (assets[name] !== null) assets[name] = assets[name] ? '(' + assets[name] + ') && ' + sourceAccess : sourceAccess;
  }
  app.save(assets);
  for (const asset of app.findAllRecords('_tk_source_assets')) {
    try { app.findRecordById('_tk_projects', asset.getString('project')); }
    catch { continue; } // Retain old orphan files, but grant no builder access.
    asset.set('project_access', asset.getString('project'));
    app.save(asset);
  }
}, (app) => {
  const assets = app.findCollectionByNameOrId('_tk_source_assets');
  const sourceSuffix = " && (project_access != '' && (project_access.visibility != 'private' || project_access.owner = @request.auth.id))";
  for (const name of ['listRule', 'viewRule']) if (assets[name] !== null) assets[name] = assets[name].endsWith(sourceSuffix) ? assets[name].slice(1, -sourceSuffix.length - 1) : '';
  assets.fields.removeByName('project_access');
  app.save(assets);
  const projects = app.findCollectionByNameOrId('_tk_projects');
  for (const name of ['owner', 'visibility']) projects.fields.removeByName(name);
  for (const name of ['assets', 'published_html']) projects.fields.getByName(name).protected = false;
  const suffix = " && (visibility != 'private' || owner = @request.auth.id)";
  for (const name of ['listRule', 'viewRule', 'updateRule', 'deleteRule']) if (projects[name] !== null) projects[name] = projects[name].endsWith(suffix) ? projects[name].slice(1, -suffix.length - 1) : '';
  app.save(projects);
});
