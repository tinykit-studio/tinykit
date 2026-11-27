// Run Vite in a child process: its signal handlers must not interrupt the CLI's
// database shutdown and workspace-lock cleanup.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const server = await createServer({ server: {
  host: '127.0.0.1', port: Number(process.argv[2]), strictPort: true, open: false,
  fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.tinykit/**', '**/pocketbase/pb_data*/**'] }
} });
await server.listen();
