import { getContext, setContext } from 'svelte'

const PROJECT_CONTEXT_KEY = Symbol('tinykit-project')

export type ProjectContext = {
	project_id: string
}

export function setProjectContext(ctx: ProjectContext) {
	setContext(PROJECT_CONTEXT_KEY, ctx)
}

export function getProjectContext(): ProjectContext {
	const ctx = getContext<ProjectContext>(PROJECT_CONTEXT_KEY)
	if (!ctx) {
		throw new Error('Project context not found. Make sure you are inside a /tinykit/[id] route.')
	}
	return ctx
}
