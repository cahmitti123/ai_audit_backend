# AI Audit System

**REST API for AI-powered quality audit system with GPT-5, Inngest, and Prisma.**

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
# Edit .env with your API keys (including VECTOR_STORE_ID for product verification)

# 3. Generate Prisma client
npx prisma generate

# 4. Test database connection
npm run test:db

# 5. (Optional) Test vector store product verification
npm run test:vector-store

# 6. Start the server
npm run dev
```

### 🐳 Docker Deployment

```bash
# 1. Setup environment
cp .env.docker .env
# Edit .env with your configuration

# 2. Build and start services
docker-compose up -d

# 3. View logs
docker-compose logs -f

# 4. Stop services
docker-compose down
```

**📖 Full Docker guide**: [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md)

**Server:** http://localhost:3002  
**Swagger UI:** http://localhost:3002/api-docs  
**Health Check:** http://localhost:3002/health  
**Inngest Dev Server:** http://localhost:8288

---

## 📂 Architecture

```
src/
├── modules/              → 5 domain modules (fiches, recordings, transcriptions, audit-configs, audits)
├── shared/               → Utilities (prisma, constants, errors, logger)
├── inngest/              → Event-driven workflows
├── app.ts                → Express factory
└── server.ts             → Entry point
```

**See [ARCHITECTURE.md](./ARCHITECTURE.md) for complete architecture documentation.**

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

**Interactive docs:** http://localhost:3002/api-docs

---

## 🔍 Vector Store Product Verification (NEW)

The system now supports **automatic product information verification** using OpenAI's Vector Store. When analyzing audit steps with `verifyProductInfo: true`, the system:

1. **Searches** your vector store for relevant product documentation
2. **Retrieves** official guarantee tables, terms, and conditions
3. **Compares** advisor statements against official documentation
4. **Flags** any discrepancies or inaccuracies

### Quick Setup

```bash
# 1. Add to .env
VECTOR_STORE_ID=vs_68e5139a7f848191af1a05a7e5d3452d

# 2. Test the integration
npm run test:vector-store

# 3. Enable on audit steps
{
  "position": 13,
  "name": "Devoir de conseil",
  "verifyProductInfo": true  // ← Enable verification
}
```

**📖 Documentation:**

- **Quick Start:** [VECTOR_STORE_QUICK_START.md](./VECTOR_STORE_QUICK_START.md)
- **Full Guide:** [VECTOR_STORE_PRODUCT_VERIFICATION.md](./VECTOR_STORE_PRODUCT_VERIFICATION.md)
- **Example Config:** [config/audit_config_with_verification_example.json](./config/audit_config_with_verification_example.json)

---

## ⚡ Inngest Workflows

Start Inngest dev server:

```bash
npm run inngest
```

**Registered Functions:**

1. `fetch-fiche` - Fetch and cache fiche data
2. `transcribe-fiche` - Transcribe recordings
3. `run-audit` - Execute complete audit pipeline
4. `batch-audit` - Process multiple audits
5. `cleanup-old-caches` - Daily cleanup (2 AM)

All workflows feature:

- ✅ Automatic retries
- ✅ Rate limiting
- ✅ Concurrency control
- ✅ Timeouts
- ✅ Event deduplication
- ✅ Durable execution

---

## 🛠️ Scripts

```bash
npm run dev          # Start development server
npm run inngest      # Start Inngest dev server
npm run test:api     # Test API endpoints (requires server running)
npm run test:direct  # Test modules directly
npm run test:db           # Test database connection
npm run test:vector-store # Test vector store integration (requires OPENAI_API_KEY)
npm run seed              # Seed audit configurations
npm run build        # Build TypeScript
```

### Test via HTTP API (Recommended)

```bash
# Make sure server is running first:
npm run dev

# In another terminal, test with known working fiche
npm run test:api 1762209 13

# Test with default fiche (1762209)
npm run test:api

# Test with custom config
npm run test:api 1762209 11  # Use Comprehensive Audit (18 steps)
```

### Test Direct (bypasses HTTP)

```bash
# Test by calling modules directly
npm run test:direct 1762209 13

# Note: May fail if external API requires authentication
# Use API test instead
```

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

Use the included HTTP file:

```
test-fiche-endpoints.http
```

Or use Swagger UI: http://localhost:3002/api-docs

---

## 📖 Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Complete architecture guide with flows and patterns

---

**Production-ready AI audit system** 🚀
