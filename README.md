# AI Audit System

**REST API for AI-powered quality audit system with OpenAI, Inngest, and Prisma.**

Production-ready backend service that analyzes sales call recordings, transcribes them with ElevenLabs, and performs comprehensive compliance audits using GPT-5.

Built with **domain-driven design** and **event-driven workflows**.

---

## 🚀 Quick Start

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. Setup environment
cp .env.example .env
# Edit .env with your connection strings and API keys

# 3. Apply database migrations (dev) + generate Prisma client
npx prisma migrate dev

# 4. Start the server
npm run dev
```

### 🐳 Docker Deployment

```bash
# 1. Setup environment
cp .env.docker.example .env
# Edit .env with your configuration

# 2. Build and start services
docker compose up -d --build

# 3. View logs
docker compose logs -f

# 4. Stop services
docker compose down
```

**📖 Deployment docs**: [`docs/deployment.md`](./docs/deployment.md)

**Server:** http://localhost:3002  
**Swagger UI:** http://localhost:3002/api-docs  
**Health Check:** http://localhost:3002/health  
**Inngest Dev Server:** http://localhost:8288

---

## 📂 Architecture

```
src/
├── modules/              → Domain modules (fiches, audits, automation, products, chat, ...)
├── shared/               → Utilities (prisma, constants, errors, logger)
├── inngest/              → Event-driven workflows
├── app.ts                → Express factory
└── server.ts             → Entry point
```

**See [`docs/architecture.md`](./docs/architecture.md) for architecture documentation.**

---

## 🎯 API Endpoints

### Fiches

- `GET /api/fiches/search?date=YYYY-MM-DD` - Search fiches
- `GET /api/fiches/:fiche_id` - Get fiche details
- `GET /api/fiches/:fiche_id/cache` - Get cached fiche

### Recordings

- `GET /api/recordings/:fiche_id` - Get recordings

### Transcriptions

- `POST /api/transcriptions/:fiche_id` - Transcribe fiche
- `GET /api/transcriptions/:fiche_id/status` - Get status
- `POST /api/transcriptions/batch` - Batch transcribe

### Audit Configs

- `GET /api/audit-configs` - List configs
- `GET /api/audit-configs/:id` - Get config
- `POST /api/audit-configs` - Create config
- `PUT /api/audit-configs/:id` - Update config
- `DELETE /api/audit-configs/:id` - Delete config

### Audits

- `POST /api/audits/run` - Run audit
- `POST /api/audits/run-latest` - Run with latest config
- `POST /api/audits/batch` - Batch audit
- `GET /api/audits/by-fiche/:fiche_id` - Get audit history
- `GET /api/audits/:audit_id` - Get audit details

### Realtime (Pusher)

Realtime domain events are delivered via **Pusher Channels**.

- `POST /api/realtime/pusher/auth` - Authenticate private/presence channel subscriptions
- `POST /api/realtime/pusher/test` - Trigger a test event

Channel/event catalog: `docs/FRONTEND_PUSHER_EVENTS.md`

**Interactive docs:** http://localhost:3002/api-docs

---

## 🔍 Product Verification (Vector Store)

The system now supports **automatic product information verification** using OpenAI's Vector Store. When analyzing audit steps with `verifyProductInfo: true`, the system:

1. **Searches** your vector store for relevant product documentation
2. **Retrieves** official guarantee tables, terms, and conditions
3. **Compares** advisor statements against official documentation
4. **Flags** any discrepancies or inaccuracies

### Quick Setup

```bash
# 1. Add to .env
VECTOR_STORE_ID=vs_...

# 2. Enable on audit steps
{
  "position": 13,
  "name": "Devoir de conseil",
  "verifyProductInfo": true  // ← Enable verification
}

# 3. Run an audit (see the curl example below)
```

**📖 Documentation:**

- **Docs index:** [`docs/README.md`](./docs/README.md)
- **Operations (webhooks/security):** [`docs/operations.md`](./docs/operations.md)
- **Example Config:** [`config/audit_config_with_verification_example.json`](./config/audit_config_with_verification_example.json)

---

## ⚡ Inngest Workflows

Start Inngest dev server:

```bash
npm run inngest
```

See the Inngest UI for the full list of registered functions and executions.

---

## 🛠️ Scripts

```bash
npm run dev          # Start development server
npm run inngest      # Start Inngest dev server
npm run seed         # Seed audit configurations
npm run build        # Build TypeScript
npx prisma migrate dev # Apply migrations (dev)
npx prisma studio    # Explore DB
```

Use Swagger UI: http://localhost:3002/api-docs

---

## 📊 Example: Run an Audit

```bash
curl -X POST http://localhost:3002/api/audits/run \
  -H "Content-Type: application/json" \
  -d '{
    "audit_id": 13,
    "fiche_id": "1762209"
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "audit": {
      "id": "123",
      "config": { "id": "13", "name": "Audit Rapide" },
      "fiche": {
        "fiche_id": "1762209",
        "prospect_name": "Christine BADIN",
        "groupe": "NCA R3"
      },
      "compliance": {
        "score": 85.5,
        "niveau": "BON",
        "points_critiques": "5/5",
        "poids_obtenu": 42,
        "poids_total": 50
      }
    },
    "statistics": {
      "recordings_count": 14,
      "successful_steps": 5,
      "total_tokens": 125000,
      "total_time_seconds": 45
    }
  }
}
```

---

## 🔑 Environment Variables

```bash
# API Keys
OPENAI_API_KEY="sk-..."
ELEVENLABS_API_KEY="sk_..."

# Server
PORT="3002"
NODE_ENV="development"

# External API
FICHE_API_BASE_URL="https://api.devis-mutuelle-pas-cher.com"

# Database (Supabase)
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."

# Inngest (optional - for production)
INNGEST_EVENT_KEY="..."
```

---

## ✨ Features

- ✅ **Domain-Driven Design** - Clean module architecture
- ✅ **Event-Driven Workflows** - Inngest for background jobs
- ✅ **Type-Safe** - TypeScript + Zod schemas + Prisma
- ✅ **Real-Time** - Live data from external APIs
- ✅ **Cached** - Smart caching for performance
- ✅ **Parallel Processing** - Concurrent step analysis
- ✅ **GPT-5 Powered** - Advanced AI reasoning
- ✅ **Production-Ready** - Error handling, logging, monitoring
- ✅ **Swagger Docs** - Interactive API documentation
- ✅ **Database-Driven** - Centralized audit configurations

---

## 📈 Tech Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** Express.js
- **AI:** OpenAI GPT-5 (AI SDK)
- **Transcription:** ElevenLabs
- **Workflows:** Inngest
- **Database:** PostgreSQL + Prisma
- **Validation:** Zod
- **Documentation:** Swagger/OpenAPI

---

## 🧪 Testing

Use Swagger UI: http://localhost:3002/api-docs

---

## 📖 Documentation

- **[`docs/README.md`](./docs/README.md)** - Canonical docs for this repo

---

**Production-ready AI audit system** 🚀
