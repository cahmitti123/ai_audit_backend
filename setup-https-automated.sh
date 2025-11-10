#!/bin/bash

# 🔒 Automated HTTPS Setup for qa-audit.site
# Run this script on your VPS as root

set -e  # Exit on error

echo "================================================================"
echo "🔒 Setting up HTTPS for qa-audit.site"
echo "================================================================"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "❌ Please run as root (use: sudo bash setup-https-automated.sh)"
  exit 1
fi

# STEP 1: Install Nginx
echo ""
echo "📦 Step 1: Installing Nginx..."
apt-get update
apt-get install -y nginx

# STEP 2: Create Nginx Configuration
echo ""
echo "⚙️  Step 2: Creating Nginx configuration..."
cat > /etc/nginx/sites-available/ai-audit << 'EOF'
server {
    listen 80;
    server_name qa-audit.site www.qa-audit.site;

    client_max_body_size 50M;

    # API endpoints
    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
}

# Inngest on separate subdomain or port
server {
    listen 8288;
    server_name qa-audit.site;

    location / {
        proxy_pass http://localhost:8288;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# STEP 3: Enable Configuration
echo ""
echo "🔗 Step 3: Enabling Nginx configuration..."
ln -sf /etc/nginx/sites-available/ai-audit /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default  # Remove default config

# Test Nginx configuration
nginx -t

# Start/Reload Nginx
systemctl enable nginx
systemctl restart nginx

echo ""
echo "✅ Nginx configured and running"

# STEP 4: Install Certbot
echo ""
echo "🔐 Step 4: Installing Certbot (for SSL certificates)..."
apt-get install -y certbot python3-certbot-nginx

# STEP 5: Get SSL Certificate
echo ""
echo "🔒 Step 5: Obtaining SSL certificate from Let's Encrypt..."
echo ""
echo "⚠️  Please enter your email address for SSL certificate notifications:"
read -p "Email: " email

certbot --nginx \
  -d qa-audit.site \
  -d www.qa-audit.site \
  --non-interactive \
  --agree-tos \
  --email "$email" \
  --redirect

# STEP 6: Test HTTPS
echo ""
echo "🧪 Step 6: Testing HTTPS..."
sleep 2

if curl -f -s https://qa-audit.site/health > /dev/null; then
    echo ""
    echo "================================================================"
    echo "✅ SUCCESS! HTTPS is now enabled!"
    echo "================================================================"
    echo ""
    echo "Your API is now available at:"
    echo "  • https://qa-audit.site"
    echo "  • https://qa-audit.site/api-docs"
    echo "  • https://www.qa-audit.site"
    echo ""
    echo "Inngest Dashboard:"
    echo "  • http://qa-audit.site:8288 (or set up subdomain)"
    echo ""
    echo "SSL certificate will auto-renew every 90 days."
    echo "================================================================"
else
    echo ""
    echo "⚠️  HTTPS setup completed, but health check failed."
    echo "This might be normal if your API isn't running yet."
    echo ""
    echo "Try accessing: https://qa-audit.site"
    echo "================================================================"
fi

# STEP 7: Setup Auto-Renewal
echo ""
echo "🔄 Setting up automatic SSL renewal..."
systemctl enable certbot.timer
systemctl start certbot.timer

echo ""
echo "✅ All done! Your server now has HTTPS enabled."
echo ""
echo "Next steps:"
echo "  1. Update your frontend to use: https://qa-audit.site"
echo "  2. Update CORS settings if needed"
echo "  3. Test all API endpoints"
echo ""



