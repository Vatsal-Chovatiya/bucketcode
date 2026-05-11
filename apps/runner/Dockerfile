FROM node:20-slim AS builder

WORKDIR /app

# Install native build tools for node-pty
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Assuming you'll copy the monorepo root or build context appropriately
# This is a simplified Dockerfile specifically for the runner app.
COPY package.json .
COPY apps/runner/package.json ./apps/runner/
# You would normally run `npm install` or `bun install` here.

COPY . .

WORKDIR /app/apps/runner
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
COPY --from=builder /app /app

# Non-root user setup
RUN chown -R node:node /app
USER node

# We'll expose port 3001 for the WebSocket server
EXPOSE 3001

# Run the guard script which will spawn the runner
ENTRYPOINT ["node", "apps/runner/guard.js"]
