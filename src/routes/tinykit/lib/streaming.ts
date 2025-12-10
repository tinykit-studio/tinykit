// AI streaming utilities for tinykit admin interface

export type CodeBlock = {
	filename: string
	language: string
	content: string
}

export type StreamingCallbacks = {
	on_chunk?: (chunk: string) => void
	on_code_block_complete?: (block: CodeBlock) => void
	on_tool_calls?: (calls: string[], results: string[]) => void
	on_done?: () => void
	on_error?: (error: Error) => void
}

/**
 * Strip complete and incomplete tool calls from text
 */
export function strip_tool_calls(text: string): {
	cleaned: string
	has_incomplete_tool: boolean
} {
	// Remove complete tool calls
	let cleaned = text.replace(/<tool>[\s\S]*?<\/tool>/g, "").trim()

	// Check for incomplete tool call (opening tag without closing)
	const has_incomplete_tool = cleaned.includes("<tool>")

	// If there's an incomplete tool, truncate at the opening tag
	if (has_incomplete_tool) {
		cleaned = cleaned.substring(0, cleaned.indexOf("<tool>")).trim()
	}

	// Collapse excessive whitespace (more than 2 newlines in a row)
	cleaned = cleaned.replace(/\n{3,}/g, "\n\n")

	return { cleaned, has_incomplete_tool }
}

/**
 * Strip complete and incomplete code blocks from text
 */
export function strip_code_blocks(text: string): {
	cleaned: string
	active_blocks: Array<{ filename: string; language: string }>
} {
	// Remove complete code blocks
	let cleaned = text.replace(/```[\w]+:[^\n]+\n[\s\S]*?```/g, "").trim()

	// Find incomplete code blocks
	const active_blocks: Array<{ filename: string; language: string }> = []
	const incomplete_block_regex = /```(\w+):([^\n]+)(?!\n[\s\S]*?```)/g

	let match
	while ((match = incomplete_block_regex.exec(text)) !== null) {
		active_blocks.push({
			language: match[1],
			filename: match[2].trim()
		})
	}

	// If there are incomplete blocks, truncate at the first one
	if (active_blocks.length > 0) {
		const first_block_index = text.indexOf("```")
		if (first_block_index !== -1) {
			cleaned = text.substring(0, first_block_index).trim()
		}
	}

	// Collapse excessive whitespace (more than 2 newlines in a row)
	cleaned = cleaned.replace(/\n{3,}/g, "\n\n")

	return { cleaned, active_blocks }
}

/**
 * Process a streaming response from the AI agent
 */
export async function process_stream(
	response: Response,
	callbacks: StreamingCallbacks = {}
): Promise<string> {
	const reader = response.body?.getReader()
	if (!reader) {
		throw new Error("No response body reader available")
	}

	const decoder = new TextDecoder()
	let raw_content = ""
	let current_code_block: CodeBlock | null = null

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			const chunk = decoder.decode(value)
			const lines = chunk.split("\n\n")

			for (const line of lines) {
				if (line.startsWith("data: ")) {
					const data = JSON.parse(line.slice(6))

					if (data.chunk) {
						raw_content += data.chunk
						callbacks.on_chunk?.(data.chunk)

						// Extract code blocks
						const code_block_start = /```(\w+):([^\n]+)\n/g
						const match = code_block_start.exec(raw_content)

						if (match && !current_code_block) {
							// Start of a new code block
							current_code_block = {
								language: match[1],
								filename: match[2].trim(),
								content: ""
							}
						}

						if (current_code_block) {
							// Extract content after the opening ```
							const block_start_index = raw_content.indexOf(
								"```" + current_code_block.language + ":" + current_code_block.filename
							)
							const content_start_index = raw_content.indexOf("\n", block_start_index) + 1
							const block_end_index = raw_content.indexOf("```", content_start_index)

							if (block_end_index !== -1) {
								// Complete block
								const final_content = raw_content.substring(
									content_start_index,
									block_end_index
								)
								current_code_block.content = final_content
								callbacks.on_code_block_complete?.(current_code_block)
								current_code_block = null
							} else if (content_start_index > 0) {
								// Track partial content
								const partial_content = raw_content.substring(content_start_index)
								current_code_block.content = partial_content
							}
						}
					}

					if (data.toolCalls && data.toolResults) {
						callbacks.on_tool_calls?.(data.toolCalls, data.toolResults)
					}
				}
			}
		}

		callbacks.on_done?.()
		return raw_content
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		callbacks.on_error?.(err)
		throw err
	}
}
