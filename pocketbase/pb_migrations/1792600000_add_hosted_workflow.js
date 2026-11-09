migrate((app) => {
  const projects = app.findCollectionByNameOrId('_tk_projects');
  for (const name of ['cli_draft', 'cli_publication', 'cli_schema']) projects.fields.push(new JSONField({ name, maxSize: 10000000 }));
  app.save(projects);
  const assets = new Collection({
    name: '_tk_source_assets', type: 'base',
    fields: [
      { name: 'project', type: 'text', required: true },
      { name: 'digest', type: 'text', required: true },
      { name: 'filename', type: 'text', required: true },
      { name: 'published', type: 'bool' },
      { name: 'file', type: 'file', required: true, maxSelect: 1, maxSize: 8000000, protected: true }
    ],
    indexes: ['CREATE UNIQUE INDEX idx_source_asset ON _tk_source_assets (project, digest, filename)'],
    listRule: "@request.auth.id != ''", viewRule: "@request.auth.id != ''", createRule: null, updateRule: null, deleteRule: null
  });
  app.save(assets);
}, (app) => {
  app.delete(app.findCollectionByNameOrId('_tk_source_assets'));
  const projects = app.findCollectionByNameOrId('_tk_projects');
  for (const name of ['cli_draft', 'cli_publication', 'cli_schema']) projects.fields.removeByName(name);
  app.save(projects);
});
