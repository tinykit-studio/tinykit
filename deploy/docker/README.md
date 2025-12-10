# Docker Deployment

Deploy tinykit using Docker on any host (VPS, DigitalOcean, AWS, etc.)

## Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/matthewmateo/tinykit.git
   cd tinykit
   ```

2. **Set environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env and add your LLM_API_KEY
   ```

3. **Run with Docker Compose:**
   ```bash
   cd deploy/docker
   docker-compose up -d
   ```

4. **Access your instance:**
   - App: http://localhost:3000
   - Builder: http://localhost:3000/tinykit

## Manual Docker Build

```bash
# Build image
docker build -f deploy/docker/Dockerfile -t crud-one .

# Run container
docker run -d \
  -p 3000:3000 \
  -e LLM_PROVIDER=openai \
  -e LLM_API_KEY=sk-your-key \
  -e LLM_MODEL=gpt-4 \
  -v crud_pb_data:/app/pocketbase/pb_data \
  -v crud_workspace:/app/workspace \
  --name crud-one \
  crud-one
```

## Deploy to VPS

### DigitalOcean Droplet

1. Create droplet (Ubuntu 22.04, $6/mo minimum)
2. SSH into droplet
3. Install Docker:
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh
   sh get-docker.sh
   ```
4. Clone repo and run docker-compose (see above)
5. Point domain to droplet IP
6. Add HTTPS with Caddy or nginx

### AWS EC2

1. Launch t3.small instance (Ubuntu 22.04)
2. Configure security group (allow ports 80, 443, 3000)
3. SSH and install Docker
4. Follow same steps as DigitalOcean

### Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Launch app
fly launch --dockerfile deploy/docker/Dockerfile

# Set secrets
fly secrets set LLM_API_KEY=sk-your-key
fly secrets set LLM_PROVIDER=openai
fly secrets set LLM_MODEL=gpt-4

# Deploy
fly deploy
```

## Production Recommendations

### Add HTTPS with Caddy

```dockerfile
# Add to docker-compose.yml
services:
  caddy:
    image: caddy:latest
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    restart: unless-stopped

volumes:
  caddy_data:
  caddy_config:
```

**Caddyfile:**
```
your-domain.com {
  reverse_proxy crud-one:3000
}
```

### Environment Variables

See `.env.example` for all available options.

Required:
- `LLM_PROVIDER` - AI provider (openai, anthropic, zai)
- `LLM_API_KEY` - Your API key
- `LLM_MODEL` - Model to use

Recommended for production:
- `ADMIN_PASSWORD` - Protect /tinykit builder
- `APP_PASSWORD` - Protect generated app APIs

## Volumes

Docker volumes persist data between container restarts:

- `/app/pocketbase/pb_data` - Database, auth, files
- `/app/workspace` - User projects and generated apps

**Backup volumes:**
```bash
docker run --rm -v crud_pb_data:/data -v $(pwd):/backup alpine tar czf /backup/pocketbase-backup.tar.gz -C /data .
docker run --rm -v crud_workspace:/data -v $(pwd):/backup alpine tar czf /backup/workspace-backup.tar.gz -C /data .
```

## Troubleshooting

**Container won't start:**
```bash
docker logs crud-one
```

**Reset everything:**
```bash
docker-compose down -v
docker-compose up -d
```

**Update to latest version:**
```bash
git pull
docker-compose build
docker-compose up -d
```

## Cost Estimate

- **DigitalOcean Droplet:** $6-12/mo
- **AWS t3.small:** ~$15/mo
- **Fly.io:** $5-10/mo
- **LLM API:** $3-10/mo

**Total: $10-25/mo** (comparable to Railway)
