#!/bin/bash

# 🔒 Automated HTTPS Setup (host Nginx + Certbot)
# Run this script on your VPS as root.
#
# Usage (recommended):
#   DOMAIN=api.example.com EMAIL=you@example.com bash setup-https-automated.sh
#
# Optional:
#   INCLUDE_WWW=1                 # also request a cert for www.${DOMAIN}
#   UPSTREAM_PORT=3002            # where your Docker stack listens on localhost
#
# Security note:
# - Do NOT expose Inngest UI publicly by default. Access it via SSH tunnel:
#     ssh -L 8288:127.0.0.1:8288 root@your-vps

set -euo pipefail

DOMAIN="${DOMAIN:-${1:-}}"
EMAIL="${EMAIL:-${2:-}}"
INCLUDE_WWW="${INCLUDE_WWW:-0}"
UPSTREAM_PORT="${UPSTREAM_PORT:-3002}"

if [ -z "${DOMAIN}" ] || [ -z "${EMAIL}" ]; then
  echo "Usage:"
  echo "  DOMAIN=api.example.com EMAIL=you@example.com bash setup-https-automated.sh"
  echo ""
  echo "Optional:"
  echo "  INCLUDE_WWW=1 UPSTREAM_PORT=3002"
  exit 1
fi

SERVER_NAMES="${DOMAIN}"
if [ "${INCLUDE_WWW}" = "1" ]; then
  SERVER_NAMES="${SERVER_NAMES} www.${DOMAIN}"
fi

echo "================================================================"
echo "🔒 Setting up HTTPS for ${DOMAIN}"
echo "================================================================"

if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run as root (use: sudo -E bash setup-https-automated.sh)"
  exit 1
fi

echo ""
echo "📦 Installing Nginx + Certbot..."
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

echo ""
echo "⚙️  Writing Nginx site config..."
cat > /etc/nginx/sites-available/ai-audit << EOF
server {
  listen 80;
  server_name ${SERVER_NAMES};

  client_max_body_size 50m;

  add_header X-Request-Id \$request_id always;

  location /api/realtime/ {
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Request-Id \$request_id;

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    proxy_pass http://127.0.0.1:${UPSTREAM_PORT};
  }

  location /api/inngest {
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Request-Id \$request_id;

    proxy_request_buffering off;
    proxy_buffering off;
    proxy_cache off;

    proxy_connect_timeout 5s;
    proxy_next_upstream error timeout http_502 http_503 http_504 non_idempotent;
    proxy_next_upstream_tries 3;
    proxy_next_upstream_timeout 15s;

    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    proxy_pass http://127.0.0.1:${UPSTREAM_PORT};
  }

  location / {
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Request-Id \$request_id;

    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    proxy_pass http://127.0.0.1:${UPSTREAM_PORT};
  }
}
EOF

echo ""
echo "🔗 Enabling Nginx site..."
ln -sf /etc/nginx/sites-available/ai-audit /etc/nginx/sites-enabled/ai-audit
rm -f /etc/nginx/sites-enabled/default || true

echo ""
echo "🧪 Testing Nginx configuration..."
nginx -t

echo ""
echo "♻️  Restarting Nginx..."
systemctl enable nginx
systemctl restart nginx

echo ""
echo "🔒 Requesting Let's Encrypt certificate..."
CERTBOT_DOMAINS=(-d "${DOMAIN}")
if [ "${INCLUDE_WWW}" = "1" ]; then
  CERTBOT_DOMAINS+=(-d "www.${DOMAIN}")
fi

certbot --nginx \
  "${CERTBOT_DOMAINS[@]}" \
  --non-interactive \
  --agree-tos \
  --email "${EMAIL}" \
  --redirect \
  --keep-until-expiring

echo ""
echo "🔄 Enabling automatic SSL renewal..."
systemctl enable certbot.timer
systemctl start certbot.timer

echo ""
echo "🧪 Quick health check (may fail if app isn't up yet)..."
curl -fsS "https://${DOMAIN}/health" >/dev/null && echo "✅ Health check OK" || echo "⚠️  Health check failed (app may not be running yet)"

echo ""
echo "✅ Done."
echo "API should be available at: https://${DOMAIN}"
echo "Swagger UI: https://${DOMAIN}/api-docs"



