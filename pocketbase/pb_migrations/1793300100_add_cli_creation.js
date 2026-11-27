migrate((app) => {
  const projects = app.findCollectionByNameOrId('_tk_projects');
  projects.fields.push(new JSONField({ name: 'cli_creation', maxSize: 4096 }));
  app.save(projects);
}, (app) => {
  const projects = app.findCollectionByNameOrId('_tk_projects');
  projects.fields.removeByName('cli_creation');
  app.save(projects);
});
