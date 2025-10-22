# 🎯 Système d'Audit AI - API REST

**Système complet TypeScript avec AI SDK, GPT-5, API REST, et Prisma.**

API REST pour audits automatisés de fiches avec IA - production-ready.

## 📁 Structure

```
ai-audit/
├── package.json          # Dépendances
├── tsconfig.json         # Config TS
├── .env                  # Variables d'environnement (à créer)
├── .env.example          # Template configuration
├── config/               # Configs
│   └── audit_config_18_points.json
├── data/                 # Données (générées)
│   ├── transcription_cache.json
│   ├── timeline.json
│   └── audit_results.json
└── src/
    ├── types.ts          # Types stricts
    ├── schemas.ts        # Schémas Zod
    ├── prompts.ts        # Construction prompts
    ├── main.ts           # Audit seul
    ├── main-pipeline.ts  # Pipeline complet (avec fetch API)
    ├── services/
    │   ├── audit.ts      # Logique audit
    │   ├── transcription.ts
    │   └── timeline-generator.ts
    └── agents/
        └── query-enhancer.ts
```

## 🚀 Quick Start

```bash
cd ai-audit

# 1. Installer dépendances
npm install

# 2. Créer fichier .env (voir .env.example)
cp .env.example .env
# Éditer .env avec vos clés API et credentials database

# 3. Tester la connexion database
npm run test:db

# 4. Démarrer le serveur API
npm start
```

**Le serveur est maintenant accessible sur:** `http://localhost:3000`

## ⚙️ Configuration

Créez un fichier `.env` avec les variables suivantes:

```bash
# API Keys
OPENAI_API_KEY="your_key_here"
ELEVENLABS_API_KEY="your_key_here"

# Fiche Configuration
FICHE_ID="1762209"
FICHE_API_BASE_URL="https://api.devis-mutuelle-pas-cher.com"

# Audit Config Database (External - Read Only)
AUDIT_CONFIG_DATABASE_URL="postgresql://postgres.xxx:password@host:6543/postgres?pgbouncer=true"
AUDIT_CONFIG_DIRECT_URL="postgresql://postgres.xxx:password@host:5432/postgres"
```

**📋 See [DATABASE_SETUP.md](./DATABASE_SETUP.md) for detailed database configuration guide.**

### Changer de Fiche

Pour auditer une autre fiche, modifiez simplement le `FICHE_ID` dans `.env`:

```bash
FICHE_ID="1234567"
```

Ou lancez avec une variable d'environnement:

```bash
FICHE_ID=1234567 npm run pipeline
```

### Tester la Connexion Database

```bash
npm run test:db
```

## ⚡ Usage API

### Start Server

```bash
# Development mode (auto-reload)
npm run dev

# Production mode
npm start
```

### Run an Audit

```bash
curl -X POST http://localhost:3000/api/audit/run \
  -H "Content-Type: application/json" \
  -d '{
    "audit_id": 3,
    "fiche_id": "1762209"
  }'
```

### List Available Audits

```bash
curl http://localhost:3000/api/audit-configs
```

**📖 Full API documentation:** [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)

### What Happens During an Audit:

1. ✅ Récupère données fiche via API
2. ✅ Charge config audit depuis database
3. ✅ Transcrit audios (ElevenLabs + cache)
4. ✅ Génère timeline conversationnelle
5. ✅ Analyse avec GPT-5 (étapes parallèles)
6. ✅ Retourne résultats JSON

**Temps:** ~30-120 secondes (selon nombre d'étapes)

## 📊 Response Example

```json
{
  "success": true,
  "data": {
    "audit": {
      "config": {
        "id": "3",
        "name": "Audit Rapide - 5 Points"
      },
      "fiche": {
        "fiche_id": "1762209",
        "prospect_name": "Christine BADIN",
        "groupe": "NCA R3"
      },
      "compliance": {
        "score": 85.5,
        "niveau": "BON",
        "points_critiques": "5/5"
      }
    },
    "statistics": {
      "recordings_count": 14,
      "successful_steps": 5,
      "total_tokens": 125000
    }
  }
}
```

**Full response structure:** See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)

## 🔧 Configuration GPT-5

Dans `src/audit.ts`:

```typescript
{
  model: 'gpt-5',
  reasoningEffort: 'high',
  textVerbosity: 'high'
}
```

## 📋 Prérequis

**Avant de lancer le pipeline:**

- `.env` avec les clés API et credentials database
- Accès à la base de données externe pour les configs audit
- Accès API à l'endpoint des fiches

## ✨ Features

✅ **REST API** - Standard HTTP endpoints
✅ **Flexible** - Choose audit config by ID
✅ **Type-safe** - TypeScript + Zod + Prisma
✅ **Database-driven** - Centralized configs
✅ **Real-time** - Live data from APIs
✅ **Cached** - Fast transcription cache
✅ **Parallel** - Concurrent step analysis
✅ **GPT-5** - Advanced AI reasoning
✅ **Production-ready** - Error handling, logs

## 🧹 Nettoyage Parent

Une fois validé:

```bash
cd ..
# Vous pouvez supprimer tous les anciens scripts Python
# Tout est dans ai-audit/
```

---

**Système autonome prêt à l'emploi** 🚀
