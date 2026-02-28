# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:24-bookworm AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run dist

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:24-bookworm-slim

# Install adb client only (no native module build tools needed — node-pty removed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    android-tools-adb \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder /app/dist ./

# Install production dependencies
RUN npm install --omit=dev

EXPOSE 8000

CMD ["npm", "start"]
