# 🚀 Deploy to VPS - Simple Guide

## ✅ What's Done

Your Docker containers are now running locally:

- ✅ Server: http://localhost:3002 (healthy)
- ✅ Inngest: http://localhost:8288 (starting)

## 📦 What You Need to Deploy

You have 2 Docker images ready:

1. `ai-audit-server` (664MB) - Your API server
2. Self-hosted Inngest from Docker Hub (`inngest/inngest:latest`)

## 🎯 3 Simple Steps to Deploy to VPS

### Step 1: Transfer Your Project to VPS

**Option A - Using Git (Recommended)**

```bash
# On your VPS
git clone <your-repo-url>
cd ai-audit
```

**Option B - Using SCP**

```bash
# On your local machine
scp -r C:\Users\chouaib\NCA\ragger\ai-audit user@your-vps-ip:/home/user/
```

### Step 2: Configure Environment on VPS

```bash
# On VPS
cd /home/user/ai-audit

# Copy and edit environment
cp .env.example .env
nano .env
```

**Update these values in `.env`:**

- `DATABASE_URL` - Your production PostgreSQL
- `OPENAI_API_KEY` - Your OpenAI key
- `ELEVENLABS_API_KEY` - Your ElevenLabs key
- `FICHE_API_URL` - Your Fiche API
- `INNGEST_EVENT_KEY` - Generate: any string
- `INNGEST_SIGNING_KEY` - Generate: `openssl rand -hex 32`

### Step 3: Start on VPS

```bash
# On VPS
docker-compose -f docker-compose.prod.yml up -d

# Wait 1 minute then check
docker-compose -f docker-compose.prod.yml ps
```

## ✅ Verify Deployment

```bash
# On VPS - test health
curl http://localhost:3002/health
curl http://localhost:8288/health

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

## 🌐 Access Publicly

### Configure Nginx (Optional)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Or Use Port Forwarding

Open firewall ports:

```bash
sudo ufw allow 3002/tcp
sudo ufw allow 8288/tcp
```

Then access: `http://your-vps-ip:3002`

## 🔧 Useful Commands on VPS

```bash
# View all containers
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f server
docker-compose -f docker-compose.prod.yml logs -f inngest

# Restart services
docker-compose -f docker-compose.prod.yml restart

# Stop all
docker-compose -f docker-compose.prod.yml down

# Update after code changes
git pull
docker-compose -f docker-compose.prod.yml up -d --build
```

## 🆘 Troubleshooting

**Problem: Containers won't start on VPS**

```bash
# Check Docker is installed
docker --version

# Check ports are available
sudo lsof -i :3002
sudo lsof -i :8288
```

**Problem: Database connection fails**

```bash
# Test database connection
docker-compose exec server npm run test:db
```

**Problem: Out of memory**

```bash
# Check available resources
free -h

# Increase swap if needed
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 🎯 Summary - Your Next Action

**Right now, you have working Docker containers locally.**

**To deploy to VPS, you need to:**

1. **Connect to your VPS** via SSH: `ssh user@your-vps-ip`
2. **Transfer the project** (git clone or scp)
3. **Run on VPS**: `docker-compose -f docker-compose.prod.yml up -d`

That's it! The same images that work locally will work on your VPS.

---

**Need help with a specific step? Let me know which one!**
