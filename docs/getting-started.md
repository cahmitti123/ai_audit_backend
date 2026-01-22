# Getting Started

## Prerequisites

- Node.js **20+**
- PostgreSQL (Prisma)
- (Optional but recommended) Redis for realtime/SSE scaling

## Local development

1. Install dependencies:

```bash
npm install
```

2. Create your local environment file:

```bash
cp .env.example .env
```

3. Update at least these values in `.env`:

- `DATABASE_URL`, `DIRECT_URL`
- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `FICHE_API_BASE_URL` (+ `FICHE_API_AUTH_TOKEN` if required)

Full reference: `docs/env.md`.

4. Apply database migrations and generate Prisma client:

```bash
npx prisma migrate dev
```

5. Start the API:

```bash
npm run dev
```

6. (Optional) Start Inngest Dev Server (UI + runner):

```bash
npm run inngest
```

## Key URLs

- Server: `http://localhost:3002`
- Health: `http://localhost:3002/health`
- Swagger UI: `http://localhost:3002/api-docs`
- Inngest endpoint: `http://localhost:3002/api/inngest`

## Docker (local / VPS)

1. Create a `.env` for Docker:

```bash
cp .env.example .env
```

2. Start services (API + Redis + self-hosted Inngest):

```bash
docker compose up -d --build
```

For production compose files and scaling patterns, see `docs/deployment.md`.





