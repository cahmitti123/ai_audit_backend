# AI Audit System - Dockerfile
# Multi-stage build for optimal image size

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript (if needed)
RUN npm run build || echo "No build step defined"

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install OpenSSL 3 for Prisma and create a non-root user.
# Create the user before COPY so we can use --chown and avoid an expensive chown -R.
RUN apk add --no-cache openssl && \
    addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nodejs

# Runtime files (deps installed in builder and copied here)
COPY --chown=nodejs:nodejs package*.json ./
COPY --chown=nodejs:nodejs prisma.config.ts ./
COPY --chown=nodejs:nodejs prisma ./prisma/
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# App code
COPY --from=builder --chown=nodejs:nodejs /app/src ./src
COPY --from=builder --chown=nodejs:nodejs /app/config ./config
# COPY --from=builder --chown=nodejs:nodejs /app/scripts ./scripts  # Directory doesn't exist

# Switch to non-root user
USER nodejs

# Expose ports
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3002/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Default command (can be overridden in docker-compose)
CMD ["sh", "-c", "npx prisma migrate deploy && npm run seed:auth && exec npm start"]

