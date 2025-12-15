# AI Audit System - Dockerfile
# Multi-stage build for optimal image size

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript (if needed)
RUN npm run build || echo "No build step defined"

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install OpenSSL 3 for Prisma
RUN apk add --no-cache openssl

# Install all dependencies (including tsx for runtime)
COPY package*.json ./
COPY prisma ./prisma/

RUN npm install && \
    npx prisma generate

# Copy built artifacts from builder
COPY --from=builder /app/src ./src
COPY --from=builder /app/config ./config
# COPY --from=builder /app/scripts ./scripts  # Directory doesn't exist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose ports
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3002/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Default command (can be overridden in docker-compose)
CMD ["sh", "-c", "npx prisma migrate deploy && exec npm start"]

