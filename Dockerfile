# Use official Node.js image with Puppeteer support
FROM node:20-slim

# Install Chromium and dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Environment variables for Puppeteer with system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium
ENV CHROMIUM_FLAGS="--no-sandbox --disable-dev-shm-usage"

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (puppeteer-core doesn't download Chromium)
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Copy public files (frontend)
COPY public/ ./public/

# Create logs directory and puppeteer cache directory
RUN mkdir -p logs .cache/puppeteer

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



