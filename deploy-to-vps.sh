#!/bin/bash
# AI Audit Backend - VPS Deployment Script
# Run this on your VPS after SSH login

set -e  # Exit on error

echo "=================================================="
echo "🚀 AI Audit Backend Deployment to VPS"
echo "=================================================="

# Config (override via env vars)
APP_DIR="${APP_DIR:-/opt/ai-audit}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.scale.yml}"
SERVER_REPLICAS="${SERVER_REPLICAS:-1}"

# Prefer modern docker compose, fall back to docker-compose if needed.
if command -v docker &> /dev/null && docker compose version &> /dev/null; then
  COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
  COMPOSE="docker-compose"
else
  COMPOSE=""
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
else
    echo "✅ Docker already installed: $(docker --version)"
fi

# Check if Docker Compose is installed (plugin)
if [ -z "${COMPOSE}" ]; then
  echo "📦 Installing Docker Compose plugin..."
  sudo apt-get update
  sudo apt-get install -y docker-compose-plugin
  COMPOSE="docker compose"
else
  echo "✅ Docker Compose available: $(${COMPOSE} version | head -n 1)"
fi

# Clone / update repository
echo ""
echo "📥 Cloning repository..."
if [ -d "${APP_DIR}/.git" ]; then
  echo "⚠️  ${APP_DIR} exists, pulling latest changes..."
  cd "${APP_DIR}"
  git fetch --all
  git checkout "${BRANCH}"
  git pull --ff-only
else
  if [ -z "${REPO_URL}" ]; then
    echo "❌ REPO_URL is required for first-time clone."
    echo "Example:"
    echo "  REPO_URL=git@github.com:your-org/your-repo.git APP_DIR=/opt/ai-audit bash deploy-to-vps.sh"
    exit 1
  fi
  sudo mkdir -p "$(dirname "${APP_DIR}")"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
  cd "${APP_DIR}"
fi

echo ""
echo "=================================================="
echo "⚙️  CONFIGURATION REQUIRED"
echo "=================================================="
echo "Please edit the .env file with your credentials:"
echo ""
echo "1. Copy example: cp .env.production.example ${ENV_FILE}"
echo "2. Edit file: nano ${ENV_FILE}"
echo "3. Update these values:"
echo "   - DATABASE_URL (your production PostgreSQL)"
echo "   - OPENAI_API_KEY"
echo "   - ELEVENLABS_API_KEY"
echo "   - FICHE_API_AUTH_TOKEN"
echo "   - Generate INNGEST keys:"
echo "     INNGEST_EVENT_KEY=\"prod-$(openssl rand -hex 16)\""
echo "     INNGEST_SIGNING_KEY=\"$(openssl rand -hex 32)\""
echo ""
echo "Run this command to edit: nano ${ENV_FILE}"
echo ""
if [ ! -f "${ENV_FILE}" ]; then
  echo "🔧 Creating ${ENV_FILE} from template..."
  cp .env.production.example "${ENV_FILE}"
  echo ""
  echo "✅ Created ${ENV_FILE}. Edit it now, then re-run this script."
  exit 0
fi

echo "=================================================="
echo "🐳 Deploying with Docker Compose"
echo "=================================================="
echo ""
echo "Compose file: ${COMPOSE_FILE}"
echo "Env file:     ${ENV_FILE}"
echo "Replicas:     server=${SERVER_REPLICAS}"
echo ""

${COMPOSE} -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --build --remove-orphans --scale server="${SERVER_REPLICAS}"

echo ""
echo "✅ Deployment complete."
echo ""
echo "Logs:"
echo "  ${COMPOSE} -f ${COMPOSE_FILE} --env-file ${ENV_FILE} logs -f --tail=100"
echo ""
echo "Next: set up host Nginx + HTTPS (recommended):"
echo "  DOMAIN=api.example.com EMAIL=you@example.com bash setup-https-automated.sh"
echo "=================================================="







