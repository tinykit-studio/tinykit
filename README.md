# tinykit [![Discord](https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white)](https://discord.gg/NfMjt3yUtn) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![X](https://img.shields.io/badge/@tinykit--studio-22c55e?logo=x)](https://x.com/tinykit_studio) [![Bluesky](https://img.shields.io/badge/@tinykit--studio-22c55e?logo=bluesky)](https://bsky.app/profile/tinykit-studio.bsky.social)

**Open-source agentic app builder.** Think Lovable, Replit, or v0—but self-hostable and self-contained. Build, tweak, and deploy all your tiny web apps on a single server controlled entirely by you.

Build at `/tinykit`, deploy to `/`

![Screenshot](./screenshot.png)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/tinykit)

---

## Features

| Feature | Description |
|---------|-------------|
| **Self-hosted** | Your server, your data. Powered by PocketBase. Docker optional. |
| **Agentic** | Prompt the agent to write code, create fields and tables, wire it all up. |
| **Realtime Database** | Auto-generated database tables that sync in real-time. |
| **Image uploads** | Built-in asset storage. Upload images and files directly from your apps. |
| **Code Editor** | Direct access to your source code. One [Svelte](https://svelte.dev) file per app. |
| **Content Fields** | Edit text without touching code. |
| **Design System** | Update colors, fonts, shadows from a visual editor. |
| **Time Travel** | Snapshots on every change. Undo anything. |
| **Bring Your Own LLM** | OpenAI, Anthropic, or Gemini (more coming soon). |
| **Backend Functionality** *(soon)* | Background jobs, CRON, and server-side routes. |
| **Authentication** *(soon)* | Enable email and OAuth signup in your built apps. |
| **Showcase** *(soon)* | Browse and one-click install community apps. |

**Run hundreds of apps on one server.** Point any domain → get a working app.

---

## Templates

12+ starter templates included:

| Category | Templates |
|----------|-----------|
| **Productivity** | Kanban, Notes, Canvas, Timer |
| **Finance** | Expense tracker, Invoice generator |
| **Content** | Bookmarks, Recipes |
| **Social** | Linktree, Poll, Event RSVP |
| **News** | HN reader, RSS reader |

---

## Quick Start

### Railway (Easiest)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/tinykit)

One-click deploy. Configure your LLM from the app (optionally, add key as ENV var).

### Docker (Self-Hosted)

```bash
git clone https://github.com/tinykit-studio/tinykit.git
cd tinykit/deploy/docker
docker-compose up -d
```

Works on any VPS. See [deploy/docker/README.md](./deploy/docker/README.md) for details.

---


## Docs

- [Quickstart](https://docs.tinykit.studio/quickstart)
- [Architecture](https://docs.tinykit.studio/architecture)
- [Security](https://docs.tinykit.studio/security)
- [Contributing](./CONTRIBUTING.md)

---

## License

MIT — see [LICENSE](./LICENSE)

---

*Build your digital homestead.*
