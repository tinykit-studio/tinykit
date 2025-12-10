/// <reference path="../pb_data/types.d.ts" />

// Consolidated migration: creates _tk_projects collection with full schema
migrate((app) => {
	const collection = new Collection({
		name: "_tk_projects",
		type: "base",
		fields: [
			{ name: "name", type: "text", required: true },
			{ name: "domain", type: "text", required: true },
			{ name: "frontend_code", type: "text", required: false, max: 10000000 },
			{ name: "backend_code", type: "text", required: false, max: 10000000 },
			{ name: "custom_instructions", type: "text", required: false, max: 1000000 },
			{ name: "design", type: "json", required: false },
			{ name: "content", type: "json", required: false },
			{ name: "snapshots", type: "json", required: false },
			{ name: "agent_chat", type: "json", required: false },
			{ name: "data", type: "json", required: false },
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
		indexes: [
			"CREATE UNIQUE INDEX idx_domain ON _tk_projects (domain)"
		],
		listRule: "@request.auth.id != ''",
		viewRule: "@request.auth.id != ''",
		createRule: "@request.auth.id != ''",
		updateRule: "@request.auth.id != ''",
		deleteRule: "@request.auth.id != ''"
	})

	return app.save(collection)
}, (app) => {
	const collection = app.findCollectionByNameOrId("_tk_projects")
	return app.delete(collection)
})
