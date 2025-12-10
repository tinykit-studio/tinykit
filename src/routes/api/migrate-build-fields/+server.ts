import { json } from '@sveltejs/kit'
import { pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async () => {
	try {
		// Get the _tk_projects collection
		const collection = await pb.collections.getOne('_tk_projects')

		// Add built_file (file field) and last_built_at (date field) if they don't exist
		const schema = collection.schema || []

		const hasBuiltFile = schema.some((field: any) => field.name === 'built_file')
		const hasLastBuiltAt = schema.some((field: any) => field.name === 'last_built_at')

		if (!hasBuiltFile || !hasLastBuiltAt) {
			const newSchema = [...schema]

			if (!hasBuiltFile) {
				newSchema.push({
					name: 'built_file',
					type: 'file',
					required: false,
					system: false,
					options: {
						maxSelect: 1,
						maxSize: 10485760, // 10MB
						mimeTypes: ['text/html']
					}
				})
			}

			if (!hasLastBuiltAt) {
				newSchema.push({
					name: 'last_built_at',
					type: 'date',
					required: false,
					system: false,
					options: {}
				})
			}

			// Update the collection schema
			await pb.collections.update(collection.id, {
				schema: newSchema
			})

			return json({
				success: true,
				message: 'Migration complete',
				added: {
					built_file: !hasBuiltFile,
					last_built_at: !hasLastBuiltAt
				}
			})
		}

		return json({
			success: true,
			message: 'Fields already exist'
		})
	} catch (error: any) {
		console.error('[Migration] Error:', error)
		return json(
			{
				success: false,
				error: error.message || 'Migration failed'
			},
			{ status: 500 }
		)
	}
}
