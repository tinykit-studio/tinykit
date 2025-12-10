# tinykit

**Open-source agentic app builder.** Think Lovable, Replit, or v0—but self-hostable, self-contained, and single-file. Build, tweak, and deploy all your tiny web apps on a single server controlled by you.

> Build at `/tinykit`, deploy to `/`

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/tinykit)

---

## What is tinykit?

tinykit is an AI-powered development platform that generates, edits, and hosts your apps—all in one place. Unlike other platforms where you build locally and deploy separately, tinykit runs the builder AND your app on the same server.

**One deployment. Zero complexity.**

```
You: "Build a recipe box for my family"
AI: *writes code, sets up database*
You: *tweak colors, add a field*
You: *point recipes.yourfamily.com → your server*
Done.
```

---

## Features

### Batteries Included

| Feature | Description |
|---------|-------------|
| **Self-hosted** | Your server, your data. All your apps live on a self-contained server powered by PocketBase. |
| **Agentic** | Prompt the agent and watch it write code, connect fields, and wire up the database. |
| **Database baked-in** | Store your app's data in simple JSON collections. Good for todos, notes, and more. |
| **Full code access** | Development environment built-in. Get direct access to your code (a single Svelte file!). |
| **Content Fields** | Edit text, labels, and copy without touching code. Perfect for non-technical collaborators. |
| **Design System** | Update CSS variables from a visual editor: colors, fonts, shadows and more. |
| **Time Travel** | Snapshots on every change. Undo anything. |
| **Deploys Static** | Your apps get built as static HTML for near-instant page loading. |
| **Works on mobile** | Build, tweak, and deploy apps from your phone—no desktop required. |
| **Bring Your Own LLM** | OpenAI, Anthropic, Google Gemini, or [z.ai](https://z.ai). Switch anytime. |
| **7-Tab Builder** | Agent, Code, Content, Design, Data, History, Config—everything in one place. |

### Hundreds of apps, one server

Run all your apps on a single server. Point any domain:

```
recipes.balefamily.life  → Recipe Box
crm.mateo.dev           → Personal CRM
books.moores.xyz        → Reading List
habits.you.com          → Habit Tracker
```

---

## What you can build

**13 starter templates included:**

| Category | Templates |
|----------|-----------|
| **Productivity** | Kanban board, Notes, Canvas, Timer |
| **Finance** | Expense tracker, Invoice generator |
| **Content** | Bookmarks, Recipes |
| **Social** | Linktree, Poll, Event RSVP |
| **News** | Hacker News reader, RSS reader |

Or start from scratch and build anything: admin dashboards, personal CRMs, landing pages, SaaS MVPs.

Perfect for freelancers, agencies, indie hackers, and anyone who needs a CRUD app yesterday.

---

## Quick Start

### Deploy to Railway (Fastest)

1. Click the button above
2. Add your OpenAI/Anthropic API key
3. Deploy
4. Visit your Railway URL
5. Start building at `/tinykit`

### Local Development

```bash
# Clone and install
git clone https://github.com/matthewmateo/tinykit.git
cd tinykit
npm install

# Configure
cp .env.example .env
# Edit .env with your LLM API key

# Download and start Pocketbase
npm run pocketbase:download
./pocketbase/pocketbase serve --http=127.0.0.1:8091 &

# Initialize database (first time only)
./pocketbase/pocketbase superuser upsert admin@tinykit adminpassword123
node scripts/init-pocketbase.js

# Start dev server
npm run dev

# Open http://localhost:5173/tinykit
```

See [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) for detailed setup instructions.

---

## Architecture

```
tinykit Server
├── /                 → Your production app (served to users)
├── /tinykit          → Builder interface (for you)
│   ├── /dashboard    → All your projects
│   ├── /studio       → Edit a project
│   └── /new          → Create new project
├── /api/agent        → AI endpoints
├── /api/build        → Svelte compilation
└── /_pb              → Pocketbase API
```

**Tech Stack:**
- SvelteKit + TypeScript
- Svelte 5 with Runes
- PocketBase (embedded database)
- CodeMirror 6
- Tailwind CSS
- OpenAI / Anthropic / Gemini / z.ai

---

## Cost

**Your Monthly Costs** (bring your own API keys):
- Railway Hobby: **$5/month**
- LLM API usage: **~$3-5/month** (casual use)
- **Total: ~$10/month**

No subscription fees. No markup on AI. You control your costs.

---

## Environment Variables

```env
# LLM Configuration
LLM_PROVIDER=anthropic # openai | anthropic | gemini | zai
LLM_API_KEY=sk-...
LLM_MODEL=claude-sonnet-4-5-20250514

# Pocketbase
POCKETBASE_URL=http://127.0.0.1:8091
POCKETBASE_ADMIN_EMAIL=admin@tinykit
POCKETBASE_ADMIN_PASSWORD=adminpassword123
```

---

## Documentation

- **[Local Development](./LOCAL_DEVELOPMENT.md)** — Setup instructions
- **[Technical Spec](./SPEC.md)** — How everything works
- **[Roadmap](./ROADMAP.md)** — Planned features
- **[Contributing](./CONTRIBUTING.md)** — How to contribute
- **[Architecture](./ARCHITECTURE.md)** — System design

---

## Roadmap

- [x] SvelteKit + PocketBase foundation
- [x] CodeMirror editor with live preview
- [x] AI agent with streaming
- [x] Content Fields + Design System
- [x] Snapshots (time travel)
- [x] Domain-based routing
- [ ] Multi-file support
- [ ] Template marketplace
- [ ] Export to Vercel/Railway
- [ ] Real-time collaboration

See [ROADMAP.md](./ROADMAP.md) for the full plan.

---

## Security

- Origin checking for cross-origin requests
- Path traversal protection
- PocketBase authentication

**Note:** Don't expose `/tinykit` publicly without authentication in production.

---

## Contributing

We welcome contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

---

## License

MIT License — see [LICENSE](./LICENSE)

---

## Links

- [GitHub](https://github.com/matthewmateo/tinykit)
- [Issues](https://github.com/matthewmateo/tinykit/issues)
- [Documentation](./CLAUDE.md)

---

**Don't want to manage a server?** Join the waitlist for tinykit Cloud at [tinykit.dev](https://tinykit.dev)

---

*Build your digital homestead.*
