# Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Install

```bash
npm install
```

This will automatically install all dependencies and generate the Prisma client.

### Step 2: Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```bash
# Required API Keys
OPENAI_API_KEY="sk-..."
ELEVENLABS_API_KEY="sk_..."

# Fiche API
FICHE_ID="1762209"
FICHE_API_BASE_URL="https://api.devis-mutuelle-pas-cher.com"

# Audit Config Database (provided by admin)
AUDIT_CONFIG_DATABASE_URL="postgresql://..."
AUDIT_CONFIG_DIRECT_URL="postgresql://..."
```

### Step 3: Test Database Connection

```bash
npm run test:db
```

**Expected output:**

```
✓ Connected to audit config database
✓ Found X audit configurations in database
✓ Successfully fetched audit config: Audit Qualité 18 Points
```

### Step 4: Run the Pipeline

```bash
npm run pipeline
```

**The pipeline will:**

1. Fetch fiche data from API
2. Load audit config from database
3. Transcribe audio recordings
4. Generate conversation timeline
5. Run GPT-5 audit analysis
6. Save results to `data/audit_results.json`

**Time:** ~2-3 minutes (with cached transcriptions)

---

## 📊 View Results

```bash
cat data/audit_results.json
```

Results include:

- Overall compliance score
- Step-by-step evaluation
- Evidence citations
- Pass/fail status

---

## 🔄 Audit Another Fiche

### Method 1: Edit .env

```bash
# Edit .env
FICHE_ID="1234567"

# Run pipeline
npm run pipeline
```

### Method 2: Command Line

```bash
FICHE_ID=1234567 npm run pipeline
```

---

## 🆘 Troubleshooting

### Database Connection Failed

```bash
# Test connection
npm run test:db

# Check credentials in .env
cat .env | grep AUDIT_CONFIG
```

### API Error

```bash
# Check FICHE_ID exists
curl -X 'GET' \
  'https://api.devis-mutuelle-pas-cher.com/api/fiches/by-id/YOUR_FICHE_ID' \
  -H 'accept: application/json'
```

### Prisma Client Not Found

```bash
# Regenerate Prisma client
npm run prisma:generate
```

---

## 📚 Additional Documentation

- **[README.md](./README.md)** - Full documentation
- **[DATABASE_SETUP.md](./DATABASE_SETUP.md)** - Database configuration guide
- **[CHANGELOG.md](./CHANGELOG.md)** - Version history
- **[TESTING.md](./TESTING.md)** - Testing guide

---

## ✅ Success Checklist

- [ ] Dependencies installed (`npm install`)
- [ ] `.env` file configured with all credentials
- [ ] Database connection tested (`npm run test:db`)
- [ ] Pipeline runs successfully (`npm run pipeline`)
- [ ] Results saved to `data/audit_results.json`

---

**You're ready to go! 🎉**

Run `npm run pipeline` anytime to audit a new fiche.
