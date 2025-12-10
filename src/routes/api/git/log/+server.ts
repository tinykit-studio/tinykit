import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.cwd(), 'workspace');

interface GitCommit {
	sha: string;
	message: string;
	author: string;
	date: string;
	files?: string[];
}

export const GET: RequestHandler = async ({ url }) => {
	const limit = parseInt(url.searchParams.get('limit') || '20');

	try {
		// Get git log
		const { stdout: logOutput } = await execAsync(
			`git log --pretty=format:"%H|%an|%ai|%s" -n ${limit}`,
			{ cwd: WORKSPACE_DIR }
		);

		if (!logOutput) {
			return json({ commits: [] });
		}

		const commits: GitCommit[] = [];
		const lines = logOutput.trim().split('\n');

		for (const line of lines) {
			const [sha, author, date, ...messageParts] = line.split('|');
			const message = messageParts.join('|'); // In case message contains |

			// Get files changed in this commit
			try {
				const { stdout: filesOutput } = await execAsync(
					`git diff-tree --no-commit-id --name-only -r ${sha}`,
					{ cwd: WORKSPACE_DIR }
				);
				const files = filesOutput.trim().split('\n').filter(Boolean);

				commits.push({
					sha: sha.substring(0, 7), // Short SHA
					author,
					date,
					message,
					files
				});
			} catch {
				commits.push({
					sha: sha.substring(0, 7),
					author,
					date,
					message
				});
			}
		}

		return json({ commits });
	} catch (error) {
		// No git repo or no commits yet
		return json({ commits: [], error: 'No git history found' });
	}
};
