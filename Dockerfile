# Use official Node.js image with Puppeteer support
FROM node:20-slim

# Install dependencies required for Puppeteer (system libraries only)
RUN apt-get update && apt-get install -y \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    libxss1 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libnss3 \
    libnspr4 \
    ca-certificates \
    wget \
    gnupg \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Environment variables to disable crash reporting (fixes crashpad error)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
ENV CHROME_CRASHPAD_HANDLER_TRAMPOLINE_DISABLE=1
ENV CHROME_HEADLESS=1
ENV DISPLAY=:99

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including Puppeteer which will download Chromium)
RUN npm ci

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



