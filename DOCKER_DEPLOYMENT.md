# Docker Deployment Guide

## 🐳 Quick Start

### 1. Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 2GB RAM minimum
- PostgreSQL database (external or via separate container)

### 2. Setup Environment

```bash
# Copy environment template
cp .env.docker .env

# Edit with your configuration
nano .env
```

**Required environment variables:**

- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - For GPT-5 and vector store
- `ELEVENLABS_API_KEY` - For transcription
- `FICHE_API_URL` & `FICHE_API_AUTH_TOKEN` - Fiche API access
- `INNGEST_EVENT_KEY` & `INNGEST_SIGNING_KEY` - Inngest credentials

### 3. Build and Run

```bash
# Development
docker-compose up -d

# Production
docker-compose -f docker-compose.prod.yml up -d
```

### 4. Verify Services

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs -f server
docker-compose logs -f inngest

# Test health endpoint
curl http://localhost:3002/health
```

---

## 📋 Available Commands

### Build

```bash
# Build images
docker-compose build

# Build without cache
docker-compose build --no-cache

# Build specific service
docker-compose build server
```

### Start/Stop

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v

# Restart specific service
docker-compose restart server
```

### Logs

```bash
# All logs
docker-compose logs -f

# Specific service
docker-compose logs -f server
docker-compose logs -f inngest

# Last 100 lines
docker-compose logs --tail=100 server
```

### Shell Access

```bash
# Access server container
docker-compose exec server sh

# Access inngest container
docker-compose exec inngest sh

# Run commands in container
docker-compose exec server npm run seed
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Network                       │
│                  (ai-audit-network)                     │
│                                                         │
│  ┌──────────────────┐         ┌──────────────────┐    │
│  │   Server         │         │   Inngest        │    │
│  │   Container      │◄────────│   Container      │    │
│  │   Port: 3002     │         │   Port: 8288     │    │
│  └────────┬─────────┘         └──────────────────┘    │
│           │                                             │
└───────────┼─────────────────────────────────────────────┘
            │
            ▼
    External Services:
    • PostgreSQL Database
    • OpenAI API
    • ElevenLabs API
    • Fiche API
```

---

## 📦 Services

### Server Container

- **Port**: 3002
- **Purpose**: Main REST API
- **Health Check**: `GET /health`
- **Restart Policy**: `unless-stopped` (dev) / `always` (prod)

### Inngest Container

- **Port**: 8288
- **Purpose**: Background job processing
- **Dependencies**: Waits for server health check
- **Restart Policy**: `unless-stopped` (dev) / `always` (prod)

---

## 🔧 Configuration

### Environment Variables

All environment variables are loaded from `.env` file:

| Variable               | Required | Description                  |
| ---------------------- | -------- | ---------------------------- |
| `DATABASE_URL`         | ✅       | PostgreSQL connection string |
| `OPENAI_API_KEY`       | ✅       | OpenAI API key               |
| `ELEVENLABS_API_KEY`   | ✅       | ElevenLabs API key           |
| `FICHE_API_URL`        | ✅       | Fiche API endpoint           |
| `FICHE_API_AUTH_TOKEN` | ✅       | Fiche API token              |
| `INNGEST_EVENT_KEY`    | ✅       | Inngest event key            |
| `INNGEST_SIGNING_KEY`  | ✅       | Inngest signing key          |
| `VECTOR_STORE_ID`      | ❌       | OpenAI vector store ID       |
| `WEBHOOK_SECRET`       | ❌       | Frontend webhook secret      |

### Ports

Default ports (configurable in `.env`):

- **Server**: 3002
- **Inngest**: 8288

To change ports:

```env
SERVER_PORT=8080
INNGEST_PORT=9000
```

### Volumes

**Development** (`docker-compose.yml`):

- `./data:/app/data` - Local data persistence

**Production** (`docker-compose.prod.yml`):

- `audit-data:/app/data` - Named volume for data

---

## 🚀 Production Deployment

### Using Production Compose

```bash
# Build and start
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop
docker-compose -f docker-compose.prod.yml down
```

### Resource Limits

Production configuration includes resource limits:

**Server:**

- CPU: 1-2 cores
- Memory: 512MB-2GB

**Inngest:**

- CPU: 0.5-1 core
- Memory: 256MB-1GB

### Logging

Production logs are rotated automatically:

- Max size: 10MB per file
- Max files: 3
- Format: JSON

### Health Checks

Both services include health checks:

- **Interval**: 30 seconds
- **Timeout**: 10 seconds
- **Retries**: 3 (dev) / 5 (prod)
- **Start Period**: 40s (dev) / 60s (prod)

---

## 🔍 Monitoring

### Check Container Health

```bash
# Container status
docker-compose ps

# Health status
docker inspect --format='{{.State.Health.Status}}' ai-audit-server
docker inspect --format='{{.State.Health.Status}}' ai-audit-inngest
```

### Resource Usage

```bash
# Real-time stats
docker stats

# Specific containers
docker stats ai-audit-server ai-audit-inngest
```

### Logs Analysis

```bash
# Error logs only
docker-compose logs | grep ERROR

# Last hour
docker-compose logs --since 1h

# Export logs
docker-compose logs > audit-logs.txt
```

---

## 🛠️ Maintenance

### Database Migrations

```bash
# Run migrations
docker-compose exec server npx prisma migrate deploy

# Generate Prisma client
docker-compose exec server npx prisma generate
```

### Seed Data

```bash
# Seed audit configurations
docker-compose exec server npm run seed
```

### Update Application

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose build
docker-compose up -d
```

### Backup Data

```bash
# Backup data volume
docker run --rm -v ai-audit-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/data-backup.tar.gz /data

# Restore data volume
docker run --rm -v ai-audit-data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/data-backup.tar.gz -C /
```

---

## 🔒 Security

### Best Practices

1. **Never commit `.env` file**

   ```bash
   # Ensure .env is in .gitignore
   echo ".env" >> .gitignore
   ```

2. **Use strong secrets**

   ```bash
   # Generate secure webhook secret
   openssl rand -hex 32
   ```

3. **Run as non-root user**

   - Dockerfile already creates `nodejs` user
   - All processes run as UID 1001

4. **Network isolation**

   - Services communicate via internal network
   - Only necessary ports exposed

5. **Regular updates**
   ```bash
   # Update base images
   docker-compose pull
   docker-compose build --no-cache
   ```

---

## 🐛 Troubleshooting

### Service Won't Start

```bash
# Check logs
docker-compose logs server

# Check specific error
docker-compose logs server | tail -50
```

### Connection Issues

```bash
# Test network connectivity
docker-compose exec server ping inngest

# Check DNS resolution
docker-compose exec server nslookup inngest
```

### Database Connection

```bash
# Test database connection
docker-compose exec server npm run test:db

# Check DATABASE_URL
docker-compose exec server printenv DATABASE_URL
```

### Permission Issues

```bash
# Fix volume permissions
docker-compose down
sudo chown -R 1001:1001 ./data
docker-compose up -d
```

### Memory Issues

```bash
# Increase memory limits in docker-compose.prod.yml
deploy:
  resources:
    limits:
      memory: 4G  # Increase from 2G
```

### Clean Restart

```bash
# Complete cleanup and restart
docker-compose down -v
docker system prune -a
docker-compose build --no-cache
docker-compose up -d
```

---

## 📊 Performance Tuning

### Optimize Build

```bash
# Multi-stage builds (already implemented)
# Cache node_modules
# Use .dockerignore
```

### Production Optimizations

1. **Enable production mode**

   ```env
   NODE_ENV=production
   ```

2. **Adjust worker processes** (if applicable)

   ```env
   NODE_OPTIONS="--max-old-space-size=2048"
   ```

3. **Database connection pooling**
   ```env
   DATABASE_URL="postgresql://...?connection_limit=10"
   ```

---

## 🌐 Cloud Deployment

### AWS ECS

```bash
# Push to ECR
aws ecr get-login-password | docker login --username AWS --password-stdin
docker tag ai-audit-server:latest your-registry/ai-audit-server:latest
docker push your-registry/ai-audit-server:latest
```

### Google Cloud Run

```bash
# Build and push
gcloud builds submit --tag gcr.io/project-id/ai-audit-server
gcloud run deploy --image gcr.io/project-id/ai-audit-server
```

### Azure Container Instances

```bash
# Create container instance
az container create --resource-group myResourceGroup \
  --name ai-audit-server \
  --image your-registry/ai-audit-server:latest
```

---

## 📝 Checklist

Before deploying to production:

- [ ] Environment variables configured in `.env`
- [ ] Database accessible from Docker network
- [ ] All API keys valid and tested
- [ ] Health checks passing
- [ ] Resource limits appropriate
- [ ] Logging configured
- [ ] Backup strategy in place
- [ ] Monitoring configured
- [ ] Security hardening applied
- [ ] Documentation updated

---

## 🆘 Support

### Common Issues

1. **Port already in use**: Change `SERVER_PORT` in `.env`
2. **Database connection failed**: Check `DATABASE_URL` and network
3. **Out of memory**: Increase limits in `docker-compose.prod.yml`
4. **Inngest not connecting**: Verify server is healthy first

### Useful Links

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [Prisma in Docker](https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-vercel)

---

**Version**: 1.0.0  
**Last Updated**: October 2025  
**Status**: ✅ Production Ready
