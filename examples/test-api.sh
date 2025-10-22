#!/bin/bash

# Test API Script
# ===============
# Quick script to test the API endpoints

API_URL="http://localhost:3000"

echo "================================"
echo "AI Audit System - API Test"
echo "================================"
echo ""

# 1. Health Check
echo "1. Health Check..."
curl -s $API_URL/health | jq
echo ""

# 2. List Audit Configs
echo "2. List Audit Configurations..."
curl -s $API_URL/api/audit-configs | jq '.data[] | {id, name, stepsCount}'
echo ""

# 3. Get Specific Config
echo "3. Get Audit Config Details (ID=3)..."
curl -s $API_URL/api/audit-configs/3 | jq '.data | {id, name, stepsCount: (.steps | length)}'
echo ""

# 4. Run Audit
echo "4. Running Audit (audit_id=3, fiche_id=1762209)..."
echo "This will take 30-120 seconds..."
echo ""

curl -s -X POST $API_URL/api/audit/run \
  -H "Content-Type: application/json" \
  -d '{
    "audit_id": 3,
    "fiche_id": "1762209"
  }' | jq '{
    success,
    audit: {
      config: .data.audit.config.name,
      fiche: .data.audit.fiche.prospect_name,
      score: .data.audit.compliance.score,
      niveau: .data.audit.compliance.niveau,
      points_critiques: .data.audit.compliance.points_critiques
    },
    stats: {
      recordings: .data.statistics.recordings_count,
      steps: .data.statistics.successful_steps,
      duration_s: (.data.metadata.duration_ms / 1000)
    }
  }'

echo ""
echo "================================"
echo "Test Complete!"
echo "================================"

