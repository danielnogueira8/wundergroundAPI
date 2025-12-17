import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger.js';
import weatherRoutes from './routes/weather.js';
import analysisRoutes from './routes/analysis.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { scraper } from './services/scraper.js';
import { cache } from './services/cache.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware (allow inline scripts for frontend)
app.use(helmet({
  contentSecurityPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON bodies
app.use(express.json());

// Serve static files (frontend)
app.use(express.static(path.join(__dirname, '../public')));

// Rate limiting - as per PDR: max 10 requests/minute
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.RATE_LIMIT || 10,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_ERROR',
      message: 'Too many requests, please try again later',
      details: 'Maximum 10 requests per minute allowed'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', limiter);

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress
    });
  });
  
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cache: cache.stats()
  });
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    name: 'Wunderground Weather History Scraper API',
    version: '1.0.0',
    description: 'RESTful API to scrape historical weather data from Wunderground',
    endpoints: {
      'GET /health': 'Health check endpoint',
      'GET /api/weather/history': 'Fetch historical weather data for a specific location and date',
      'GET /api/weather/latest': 'Fetch only the latest data point (most recent hour)',
      'GET /api/weather/range': 'Fetch data for a date range',
      'GET /api/weather/cache/stats': 'Get cache statistics',
      'DELETE /api/weather/cache': 'Clear the cache'
    },
    parameters: {
      location: {
        description: 'Station code or city/country combo',
        format: 'country/city/station_code',
        example: 'kr/incheon/RKSI'
      },
      date: {
        description: 'Date in YYYY-MM-DD format',
        example: '2025-12-16'
      },
      metric: {
        description: 'Optional specific metric to fetch',
        values: ['temperature', 'precipitation', 'wind']
      },
      start_date: {
        description: 'Start date for range queries (YYYY-MM-DD)',
        example: '2025-12-01'
      },
      end_date: {
        description: 'End date for range queries (YYYY-MM-DD)',
        example: '2025-12-16'
      }
    },
    examples: {
      history: '/api/weather/history?location=kr/incheon/RKSI&date=2025-12-16',
      latest: '/api/weather/latest?location=kr/incheon/RKSI',
      range: '/api/weather/range?location=kr/incheon/RKSI&start_date=2025-12-01&end_date=2025-12-05',
      temperature_only: '/api/weather/history?location=kr/incheon/RKSI&date=2025-12-16&metric=temperature'
    },
    source: 'https://www.wunderground.com'
  });
});

// Weather API routes
app.use('/api/weather', weatherRoutes);

// Analysis API routes
app.use('/api/analysis', analysisRoutes);

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  // Close browser instance
  await scraper.close();
  
  // Destroy cache cleanup interval
  cache.destroy();
  
  logger.info('Cleanup complete, exiting');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason: reason?.message || reason });
});

// Start server
app.listen(PORT, () => {
  logger.info(`🌤️  Wunderground Weather API server running on port ${PORT}`);
  logger.info(`📖 API documentation: http://localhost:${PORT}/`);
  logger.info(`💊 Health check: http://localhost:${PORT}/health`);
});

export default app;

