# Simple Node.js image - no browser needed!
FROM node:20-slim

# Install only essential packages (no chromium)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Copy public files (frontend)
COPY public/ ./public/

# Create logs directory
RUN mkdir -p logs

# Create non-root user for security
RUN groupadd -r weatherapi && useradd -r -g weatherapi weatherapi
RUN chown -R weatherapi:weatherapi /app
USER weatherapi

# Expose port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1))"

# Start the server
CMD ["node", "src/index.js"]
