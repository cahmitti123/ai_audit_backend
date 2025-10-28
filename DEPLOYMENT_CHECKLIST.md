# ✅ VPS Deployment Checklist

## 🎯 Current Status: READY TO DEPLOY

Your Docker containers are built and tested locally. Here's what's ready:

### ✅ Local Testing Complete

- ✅ Server container: **Running & Healthy** (http://localhost:3002)
- ✅ Inngest container: **Running** (http://localhost:8288)
- ✅ Health checks: **Passing**
- ✅ Environment configured: **Yes**
- ✅ Docker images built: **664MB each**

---

## 📋 Pre-Deployment Checklist

### Before You Start

- [ ] VPS access (SSH credentials)
- [ ] Docker installed on VPS (`docker --version`)
- [ ] Docker Compose installed on VPS (`docker-compose --version`)
- [ ] Production database URL ready
- [ ] API keys ready (OpenAI, ElevenLabs, Fiche)

---

## 🚀 Deployment Steps

### STEP 1: Prepare VPS

```bash
# SSH into your VPS
ssh user@your-vps-ip

# Install Docker if needed
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose if needed
sudo apt-get update
sudo apt-get install docker-compose-plugin
```

### STEP 2: Transfer Project

**Method A - Git (Recommended):**

```bash
# On VPS
cd /home/user
git clone <your-repo-url>
cd ai-audit
```

**Method B - SCP from Windows:**

```powershell
# On your Windows machine
scp -r C:\Users\chouaib\NCA\ragger\ai-audit user@vps-ip:/home/user/ai-audit
```

### STEP 3: Configure Environment

```bash
# On VPS
cd /home/user/ai-audit

# Create .env file
cp .env.example .env
nano .env
```

**Edit these required values:**

```env
# Database (YOUR PRODUCTION DB)
DATABASE_URL="postgresql://user:password@your-db-host:5432/ai_audit"
DIRECT_URL="postgresql://user:password@your-db-host:5432/ai_audit"

# API Keys (YOUR REAL KEYS)
OPENAI_API_KEY="sk-your-real-key"
ELEVENLABS_API_KEY="your-real-key"

# Fiche API (YOUR REAL ENDPOINT)
FICHE_API_URL="https://api.devis-mutuelle-pas-cher.com"
FICHE_API_AUTH_TOKEN="your-auth-token"

# Inngest (Generate secure keys)
INNGEST_EVENT_KEY="production-event-key-$(openssl rand -hex 16)"
INNGEST_SIGNING_KEY="$(openssl rand -hex 32)"

# Frontend Webhooks (Leave empty for now)
WEBHOOK_SECRET=""

# Vector Store (Keep this)
VECTOR_STORE_ID="vs_68e5139a7f848191af1a05a7e5d3452d"
```

### STEP 4: Deploy

```bash
# On VPS - Build and start
docker-compose -f docker-compose.prod.yml up -d

# Wait for containers to start (1-2 minutes)
sleep 60

# Check status
docker-compose -f docker-compose.prod.yml ps
```

### STEP 5: Verify

```bash
# Test health endpoints
curl http://localhost:3002/health
curl http://localhost:8288/health

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

### STEP 6: Open Firewall (Optional - for external access)

```bash
# Allow API port
sudo ufw allow 3002/tcp

# Allow Inngest port
sudo ufw allow 8288/tcp

# Enable firewall
sudo ufw enable
```

---

## 🌐 Access Your Deployed API

### From VPS (Local)

```bash
http://localhost:3002
http://localhost:8288
```

### From Internet (if firewall opened)

```bash
http://your-vps-ip:3002
http://your-vps-ip:8288
```

### With Domain (Recommended)

**Setup Nginx:**

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

**Setup SSL with Certbot:**

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

---

## 🔧 Post-Deployment Commands

### View Status

```bash
docker-compose -f docker-compose.prod.yml ps
```

### View Logs

```bash
docker-compose -f docker-compose.prod.yml logs -f server
docker-compose -f docker-compose.prod.yml logs -f inngest
```

### Restart Services

```bash
docker-compose -f docker-compose.prod.yml restart
```

### Update After Code Changes

```bash
git pull
docker-compose -f docker-compose.prod.yml up -d --build
```

### Stop Everything

```bash
docker-compose -f docker-compose.prod.yml down
```

---

## 🆘 Troubleshooting

### Container Won't Start

```bash
docker-compose -f docker-compose.prod.yml logs server
```

### Database Connection Failed

```bash
docker-compose -f docker-compose.prod.yml exec server npm run test:db
```

### Port Already in Use

```bash
# Check what's using the port
sudo lsof -i :3002

# Stop conflicting service or change port in .env
```

### Out of Memory

```bash
# Check memory
free -h

# Add swap if needed
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 📊 What's Deployed

When deployment is complete, you'll have:

| Service        | URL                           | Purpose           |
| -------------- | ----------------------------- | ----------------- |
| API Server     | `http://vps-ip:3002`          | Main REST API     |
| Swagger Docs   | `http://vps-ip:3002/api-docs` | API Documentation |
| Inngest Server | `http://vps-ip:8288`          | Workflow Engine   |
| Inngest UI     | `http://vps-ip:8288`          | Job Monitoring    |

---

## ✅ Success Criteria

You'll know deployment succeeded when:

1. ✅ Both containers show "healthy" status
2. ✅ Health endpoints return 200 OK
3. ✅ Swagger UI is accessible
4. ✅ Inngest UI shows synced apps
5. ✅ You can run an audit successfully

---

## 🎯 Your Current Position

**You are here:** ✅ Docker images built and tested locally

**Next step:** Transfer to VPS and deploy

**Estimated time:** 10-15 minutes

---

**Questions? Ask about any specific step!**
