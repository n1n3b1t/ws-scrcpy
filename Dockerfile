# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:18-bullseye AS builder

# Install build dependencies for node-gyp and native modules (node-pty)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

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
FROM node:18-bullseye-slim

# Install runtime dependencies and build tools for native modules (node-pty):
# - adb client (connects to host's adb server)
# - python3, make, g++ for node-gyp to compile node-pty
RUN apt-get update && apt-get install -y --no-install-recommends \
    android-tools-adb \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder /app/dist ./

# Install production dependencies (tslib and other externalized modules)
RUN npm install --omit=dev

# Create non-root user for security (optional, requires adjustments for ADB)
# RUN useradd -m -s /bin/bash wsscrcpy && chown -R wsscrcpy:wsscrcpy /app
# USER wsscrcpy

EXPOSE 8000

CMD ["npm", "start"]
