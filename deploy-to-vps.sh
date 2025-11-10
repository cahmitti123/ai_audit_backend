#!/bin/bash
# AI Audit Backend - VPS Deployment Script
# Run this on your VPS after SSH login

set -e  # Exit on error

echo "=================================================="
echo "🚀 AI Audit Backend Deployment to VPS"
echo "=================================================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
else
    echo "✅ Docker already installed: $(docker --version)"
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    sudo apt-get update
    sudo apt-get install -y docker-compose-plugin
else
    echo "✅ Docker Compose already installed: $(docker-compose --version)"
fi

# Clone repository
echo ""
echo "📥 Cloning repository..."
cd /root
if [ -d "ai_audit_backend" ]; then
    echo "⚠️  Directory exists, pulling latest changes..."
    cd ai_audit_backend
    git pull
else
    git clone https://github.com/cahmitti123/ai_audit_backend.git
    cd ai_audit_backend
fi

echo ""
echo "=================================================="
echo "⚙️  CONFIGURATION REQUIRED"
echo "=================================================="
echo "Please edit the .env file with your credentials:"
echo ""
echo "1. Copy example: cp .env.example .env"
echo "2. Edit file: nano .env"
echo "3. Update these values:"
echo "   - DATABASE_URL (your production PostgreSQL)"
echo "   - OPENAI_API_KEY"
echo "   - ELEVENLABS_API_KEY"
echo "   - FICHE_API_AUTH_TOKEN"
echo "   - Generate INNGEST keys:"
echo "     INNGEST_EVENT_KEY=\"prod-$(openssl rand -hex 16)\""
echo "     INNGEST_SIGNING_KEY=\"$(openssl rand -hex 32)\""
echo ""
echo "Run this command to edit: nano .env"
echo ""
echo "After editing, run: docker-compose -f docker-compose.prod.yml up -d"
echo "=================================================="







