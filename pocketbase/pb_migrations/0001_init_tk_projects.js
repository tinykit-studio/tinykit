/// <reference path="../pb_data/types.d.ts" />

// Creates tinykit collections: _tk_projects and _tk_settings
migrate((app) => {
	// _tk_projects - stores user projects
	const projects = new Collection({
		name: "_tk_projects",
		type: "base",
		fields: [
			{ name: "name", type: "text", required: false },
			{ name: "domain", type: "text", required: true },
			{ name: "frontend_code", type: "text", required: false, max: 10000000 },
			{ name: "backend_code", type: "text", required: false, max: 10000000 },
			{ name: "custom_instructions", type: "text", required: false, max: 1000000 },
			{ name: "design", type: "json", required: false },
			{ name: "content", type: "json", required: false },
			{ name: "snapshots", type: "json", required: false },
			{ name: "agent_chat", type: "json", required: false },
			{ name: "data", type: "json", required: false },
			{
				name: "assets",
				type: "file",
				required: false,
				maxSelect: 1000,
				maxSize: 0,
				mimeTypes: [],
				thumbs: []
			},
			{ name: "settings", type: "json", required: false },
			{
				name: "published_html",
				type: "file",
				required: false,
				maxSelect: 1,
				maxSize: 0,
				mimeTypes: [],
				thumbs: []
			}
		],
		indexes: [],
		listRule: "@request.auth.id != ''",
		viewRule: "@request.auth.id != ''",
		createRule: "@request.auth.id != ''",
		updateRule: "@request.auth.id != ''",
		deleteRule: "@request.auth.id != ''"
	})
	app.save(projects)

	// _tk_settings - stores app configuration (LLM keys, etc)
	// Uses record ID as the key (e.g., id="llm" for LLM settings)
	const settings = new Collection({
		name: "_tk_settings",
		type: "base",
		fields: [
			{
				name: "id",
				type: "text",
				primaryKey: true,
				required: true,
				min: 0,
				max: 0,
				pattern: ""
			},
			{ name: "value", type: "json", required: false }
		],
		listRule: "@request.auth.id != ''",
		viewRule: "@request.auth.id != ''",
		createRule: "@request.auth.id != ''",
		updateRule: "@request.auth.id != ''",
		deleteRule: "@request.auth.id != ''"
	})
	return app.save(settings)
}, (app) => {
	const projects = app.findCollectionByNameOrId("_tk_projects")
	app.delete(projects)
	const settings = app.findCollectionByNameOrId("_tk_settings")
	return app.delete(settings)
})
