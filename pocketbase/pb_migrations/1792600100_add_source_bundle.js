migrate((app) => {
  const projects = app.findCollectionByNameOrId('_tk_projects');
  projects.fields.push(new JSONField({ name: 'source_bundle', maxSize: 10000000 }));
  app.save(projects);
}, (app) => {
  const projects = app.findCollectionByNameOrId('_tk_projects');
  projects.fields.removeByName('source_bundle');
  app.save(projects);
});
