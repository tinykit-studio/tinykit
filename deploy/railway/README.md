# Deploying tinykit to Railway

## Prerequisites

- Railway account (free tier available)
- GitHub repository (or use Railway CLI)
- LLM API key (OpenAI, Anthropic, or z.ai)

## Quick Deploy

### Option 1: Deploy from GitHub (Recommended)

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Prepare for Railway deployment"
   git push origin master
   ```

2. **Create Railway Project:**
   - Go to [railway.app](https://railway.app)
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your tinykit repository
   - Railway will auto-detect the configuration from `railway.toml`

3. **Add Persistent Volume (CRITICAL):**
   - In Railway dashboard, click your service
   - Go to "Variables" tab
   - Click "New Variable" → Select "Volume"
   - Mount path: `/app/pocketbase/pb_data`
   - Size: 1GB (500MB minimum, 5GB if using file uploads)

   **Add another volume for workspace:**
   - Click "New Variable" → Select "Volume"
   - Mount path: `/app/workspace`
   - Size: 1GB (500MB minimum, 2GB for heavy use)

   **Why these sizes?**
   - Workspace stores only source code (~KB per file) and compiled HTML (~100KB)
   - No node_modules stored at runtime
   - 1GB = ~10-20 projects with moderate data
   - Pocketbase stores database + auth (grows with user accounts/file uploads)

4. **Configure Environment Variables:**
   Go to "Variables" tab and add:

   ```bash
   # Required: AI Provider
   LLM_PROVIDER=openai
   LLM_API_KEY=sk-your-api-key-here
   LLM_MODEL=gpt-4

   # Optional: Security (RECOMMENDED)
   ADMIN_PASSWORD=your-secure-admin-password
   APP_PASSWORD=your-app-password

   # Server config (Railway sets PORT automatically)
   HOST=0.0.0.0
   WORKSPACE_DIR=/app/workspace
   ```

5. **Deploy:**
   - Railway will automatically build and deploy
   - Wait for deployment to complete (~2-3 minutes)
   - Click "Open App" to access your instance

### Option 2: Deploy with Railway CLI

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Add volumes (do this in dashboard - see step 3 above)

# Set environment variables
railway variables set LLM_PROVIDER=openai
railway variables set LLM_API_KEY=sk-...
railway variables set LLM_MODEL=gpt-4
railway variables set ADMIN_PASSWORD=your-password

# Deploy
railway up
```

## Post-Deployment Setup

### 1. Access Your Instance
Your app will be available at: `https://your-project.up.railway.app`

### 2. Initial Access
- Navigate to `https://your-project.up.railway.app/tinykit`
- If you set `ADMIN_PASSWORD`, you'll be prompted to log in
- Start building your first app!

### 3. Custom Domain (Optional)
1. In Railway dashboard, go to "Settings"
2. Click "Generate Domain" or add your own
3. For custom domain:
   - Add CNAME record: `your-domain.com` → `your-project.up.railway.app`
   - Add domain in Railway settings
   - Wait for SSL certificate (automatic)

## Environment Variables Reference

### Required
| Variable | Description | Example |
|----------|-------------|---------|
| `LLM_PROVIDER` | AI provider | `openai`, `anthropic`, `zai` |
| `LLM_API_KEY` | API key for LLM provider | `sk-...` |
| `LLM_MODEL` | Model to use | `gpt-4`, `claude-sonnet-4.5` |

### Recommended
| Variable | Description | Example |
|----------|-------------|---------|
| `ADMIN_PASSWORD` | Protects `/tinykit` builder | Any secure password |
| `APP_PASSWORD` | Protects generated app APIs | Any secure password |

### Optional
| Variable | Description | Default |
|----------|-------------|---------|
| `HOST` | Server host | `0.0.0.0` |
| `PORT` | Server port (Railway sets this) | Auto |
| `WORKSPACE_DIR` | Project storage path | `/app/workspace` |
| `LLM_BASE_URL` | Custom LLM endpoint | Provider default |

## Persistent Storage

**CRITICAL:** Railway services are ephemeral. Without volumes, all data is lost on restart.

### Required Volumes

1. **Pocketbase Data** (`/app/pocketbase/pb_data`)
   - Stores database, auth, uploaded files
   - Minimum: 500MB (database only)
   - Recommended: 1GB (moderate usage)
   - Heavy use: 5GB+ (lots of file uploads)

2. **Workspace** (`/app/workspace`)
   - Stores source code, compiled output, data files
   - **Does NOT store node_modules** (not needed at runtime)
   - Minimum: 500MB (~5-10 projects)
   - Recommended: 1GB (~10-20 projects with data)
   - Heavy use: 2GB+ (many data-intensive apps)

**Size breakdown per project:**
- Source code: ~50-200KB
- Compiled HTML: ~50-200KB
- Data files: ~10KB - 10MB (depends on your app)
- Total per project: typically 500KB - 20MB

### Backup Strategy (Recommended)

Railway volumes are backed up automatically, but for production:

```bash
# SSH into Railway (if needed)
railway run bash

# Backup Pocketbase
./pocketbase/pocketbase backup-list
./pocketbase/pocketbase backup

# Download backups from Railway dashboard
```

## Monitoring & Logs

### View Logs
```bash
railway logs
```

Or in Railway dashboard → "Deployments" → Click deployment → "View Logs"

### Health Check
Railway automatically monitors: `https://your-app.up.railway.app/tinykit`
- Checks every 10 seconds
- Timeout: 100 seconds
- Auto-restarts on failure (max 10 retries)

### Metrics
Railway dashboard shows:
- CPU usage
- Memory usage
- Network traffic
- Deployment history

## Troubleshooting

### Deployment Failed
1. Check build logs in Railway dashboard
2. Verify `railway.toml` is in repository root
3. Ensure all environment variables are set
4. Check Node.js version compatibility (requires 18+)

### Pocketbase Not Starting
1. Check logs: `railway logs`
2. Verify volume is mounted at `/app/pocketbase/pb_data`
3. Check for port conflicts (should use 8091 internally)
4. Restart: Railway dashboard → "Deployments" → "Restart"

### App Not Accessible
1. Verify deployment completed successfully
2. Check health check status in Railway dashboard
3. Ensure `PORT` env var is not set (Railway sets this automatically)
4. Check firewall/network settings

### Lost Data After Restart
**CAUSE:** Volumes not configured!
**FIX:** Add persistent volumes (see step 3 in Quick Deploy)

### Out of Memory
1. Upgrade Railway plan (free tier: 512MB)
2. Optimize workspace usage (delete old projects)
3. Monitor with: `railway run df -h`

## Scaling & Performance

### Free Tier Limits
- 512MB RAM
- $5/month free credit
- 1GB storage included
- Sleeps after 30min inactivity

### Upgrading
For production use:
- **Hobby Plan** ($5/mo): 8GB RAM, 100GB storage
- **Pro Plan** ($20/mo): 32GB RAM, 500GB storage

### Performance Tips
1. Use aggressive caching for AI responses
2. Monitor LLM API costs (Railway doesn't control this)
3. Enable compression in SvelteKit
4. Use CDN for static assets (future)

## Security Checklist

Before going live:

- [ ] Set strong `ADMIN_PASSWORD` (protects builder)
- [ ] Set `APP_PASSWORD` if hosting public apps
- [ ] Rotate LLM API keys regularly
- [ ] Enable Railway's "Protect Deployments" feature
- [ ] Set up custom domain with HTTPS (auto via Railway)
- [ ] Review Pocketbase security rules (future)
- [ ] Monitor logs for suspicious activity
- [ ] Keep dependencies updated (`npm audit`)

## Cost Estimation

### Railway Costs
- **Starter/Free:** $0-5/mo (includes $5 credit)
- **Hobby:** ~$5/mo base + usage
- **Pro:** ~$20/mo base + usage

### LLM API Costs (Separate)
- **GPT-4:** ~$0.03-0.06 per conversation
- **Claude Sonnet:** ~$0.015-0.03 per conversation
- **Estimated:** $10-50/mo for moderate use

### Total Estimated Cost
- **Personal/Dev:** $5-15/mo
- **Small Team:** $25-75/mo
- **Production:** $50-200/mo

## Alternative: Docker Deployment

If you prefer Docker over Railway:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy app
COPY . .

# Build
RUN npm run build

# Expose port
EXPOSE 3000

# Start
COPY start.sh ./
RUN chmod +x start.sh
CMD ["./start.sh"]
```

Then deploy to:
- **Render** (similar to Railway)
- **Fly.io** (global edge deployment)
- **DigitalOcean App Platform**
- **Your own VPS** (most control, most maintenance)

## Support

- **Issues:** https://github.com/matthewmateo/tinykit/issues
- **Docs:** See README.md and CLAUDE.md
- **Railway Docs:** https://docs.railway.app

---

**Ready to deploy?** Follow the Quick Deploy steps above. You'll be live in ~5 minutes! 🚀
