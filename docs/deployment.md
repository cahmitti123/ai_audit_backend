# Deployment

## Docker (single instance)

This repo includes:

- `docker-compose.yml` (local-style)
- `docker-compose.prod.yml` (production-style)

### Quick start

1. Create `.env`:

```bash
cp .env.docker.example .env
```

2. Start:

```bash
docker compose up -d --build
```

### Ports

- API: `3002` (container port 3002)
- Inngest (self-hosted UI): `8288`
- Redis: `6379`

## Docker (scaled API replicas)

Use `docker-compose.prod.scale.yml` to run multiple `server` replicas behind an internal nginx load balancer.

Example:

```bash
docker compose -f docker-compose.prod.scale.yml up -d --build --scale server=3
```

The internal LB config lives at `deploy/nginx-lb.conf` and is pre-configured for:

- SSE (`/api/realtime/*`) buffering off
- Longer timeouts for long-lived connections

## VPS notes

- Prefer binding internal ports to localhost and putting a public nginx in front.
- Ensure your public nginx config disables buffering for SSE endpoints.

## HTTPS (Certbot)

Typical flow on Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example --non-interactive --agree-tos --email you@example.com --redirect
```

## VPS deployment (recommended)

This project is designed to run on a single VPS using Docker Compose with:

- **App + background jobs**: `server` (Node.js)
- **Orchestration**: `inngest` (self-hosted)
- **Realtime/event stream + locks**: `redis`
- **Optional scaling**: multiple `server` replicas behind an internal Docker nginx load balancer (`lb`)

### 1) DNS + firewall

- Point your domain to your VPS IP.
- Only open ports **22**, **80**, **443** to the public internet.
- Keep these **localhost-only** (or closed): **3002**, **8288**, **8289**, **6379**.

### 2) Clone + configure env

On the VPS:

```bash
cd /opt
git clone <YOUR_REPO_URL> ai-audit
cd ai-audit

cp .env.production.example .env.production
nano .env.production
```

Fill in at least:

- `DATABASE_URL`, `DIRECT_URL`
- `OPENAI_API_KEY` (and/or `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`)
- `FICHE_API_*`
- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
- `FRONTEND_WEBHOOK_URL`, `WEBHOOK_SECRET`
- `WEBHOOK_ALLOWED_ORIGINS` (recommended allowlist for SSRF protection)

### 3) Start the Docker stack (scaled-ready)

We recommend using the scaled stack even if you start with 1 replica (easy to scale later):

```bash
docker compose -f docker-compose.prod.scale.yml --env-file .env.production up -d --build --remove-orphans --scale server=1
```

Notes:

- `docker-compose.prod.scale.yml` publishes the internal LB at **127.0.0.1:${SERVER_PORT:-3002}**
- Inngest UI ports are bound to **127.0.0.1** for safety.
- If you scale `server`, also set `SERVER_REPLICAS` in `.env.production` to match the number of replicas.

### 4) Host nginx reverse proxy + HTTPS

We ship a host nginx template at `deploy/nginx-vps-external.conf` (HTTP-only pre-certbot) and an automated setup script:

```bash
DOMAIN=api.example.com EMAIL=you@example.com bash setup-https-automated.sh
```

This will:

- Install **nginx + certbot**
- Configure nginx to proxy to `127.0.0.1:${SERVER_PORT:-3002}`
- Enable HTTPS + redirect (Let’s Encrypt)
- Disable nginx buffering for `/api/realtime/*` (SSE) and `/api/inngest` (large bodies/long responses)

### 5) Accessing the Inngest UI safely

By default, Inngest is bound to localhost. Access it via SSH tunnel:

```bash
ssh -L 8288:127.0.0.1:8288 root@your-vps-ip
```

Then open: `http://localhost:8288`

### Updates / redeploy

```bash
cd /opt/ai-audit
git pull
docker compose -f docker-compose.prod.scale.yml --env-file .env.production up -d --build --remove-orphans --scale server=1
```

### Logs

```bash
docker compose -f docker-compose.prod.scale.yml --env-file .env.production logs -f --tail=200
```

### Auto-start on reboot (optional)

Docker restart policies are already enabled (`restart: always`). If you prefer a systemd-managed stack,
see `deploy/ai-audit.service.example`.





