# Docker deployment

## Quick start

From a fresh checkout:

```bash
git clone https://github.com/tinykit-studio/tinykit.git
cd tinykit
docker compose -f deploy/docker/docker-compose.yml up -d --build
```

Visit http://localhost:3000/setup to create your account. Then open http://localhost:3000/tinykit. AI configuration is optional: use templates and the editor, or configure a provider in Settings.

For environment-based AI configuration, copy `.env.example` to `.env`, uncomment your provider's settings, and run:

```bash
docker compose --env-file .env -f deploy/docker/docker-compose.yml up -d --build
```

See [AI providers](../../docs/ai-providers.md) for DeepSeek, custom URLs, and reaching local models from Docker.

## Build and run without Compose

```bash
docker build -f deploy/docker/Dockerfile -t tinykit .
docker run -d --name tinykit -p 3000:3000 \
  -v tinykit_data:/app/pocketbase/pb_data \
  tinykit
```

The image uses Node.js 22, includes bash and curl for startup, and downloads the Linux PocketBase binary during installation. The build context excludes local credentials, databases, build output, and host binaries.

## Existing installations and updates

The Compose service and volume names are retained for existing installations. Run updates with the same Compose project name and directory as before so Docker reuses your data volumes. Back up your database before updating.

```bash
git pull
docker compose -f deploy/docker/docker-compose.yml up -d --build
```

If you use `.env`, include `--env-file .env` as in the setup command.

## Storage and backups

`/app/pocketbase/pb_data` contains the database, uploaded files, and setup credentials. Keep its volume when recreating the container. The Compose file also retains the existing workspace volume for compatibility.

To make a consistent backup, stop Tinykit, archive the PocketBase volume, and restart it. Find the actual volume name with `docker volume ls`; Compose prefixes it with the project name. Store backups securely because they include app data and credentials.

`docker compose down` keeps named volumes. Adding `-v` deletes them and is not an update or troubleshooting step.

## Hosting publicly

Put a reverse proxy such as Caddy or nginx in front of port 3000 and configure HTTPS. Complete account setup before exposing a new installation publicly.

## Troubleshooting

```bash
docker compose -f deploy/docker/docker-compose.yml logs --tail=100
docker compose -f deploy/docker/docker-compose.yml ps
```

- **Docker cannot connect:** start your Docker engine.
- **Model connection refused:** check the URL from the container's network. Use `host.docker.internal` for a model on the Docker host, and ensure that server accepts connections from Docker.
- **Changed AI settings have no effect:** remove nonempty `LLM_API_KEY` and `LLM_BASE_URL` environment overrides to use saved settings.
- **Port already in use:** change the host side of `3000:3000` in the Compose file.
