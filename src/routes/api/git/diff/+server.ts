import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.cwd(), 'workspace');

export const GET: RequestHandler = async ({ url }) => {
	const sha = url.searchParams.get('sha');

	if (!sha) {
		return json({ error: 'SHA parameter required' }, { status: 400 });
	}

	try {
		const { stdout } = await execAsync(`git show ${sha}`, { cwd: WORKSPACE_DIR });
		return json({ diff: stdout });
	} catch (error) {
		return json({ error: 'Failed to get diff' }, { status: 500 });
	}
};
