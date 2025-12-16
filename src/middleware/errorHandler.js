import { logger } from '../utils/logger.js';

/**
 * Error types for categorization
 */
export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SCRAPE_ERROR: 'SCRAPE_ERROR',
  RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR'
};

/**
 * Custom API Error class
 */
export class ApiError extends Error {
  constructor(code, message, statusCode = 500, details = null) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'ApiError';
  }
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    error: {
      code: ErrorCodes.NOT_FOUND,
      message: `Route not found: ${req.method} ${req.path}`,
      details: 'The requested endpoint does not exist'
    }
  });
}

/**
 * Global error handler middleware
 */
export function errorHandler(err, req, res, next) {
  // Log the error
  logger.error('Request error', {
    method: req.method,
    path: req.path,
    query: req.query,
    error: err.message,
    stack: err.stack,
    code: err.code
  });

  // Handle known error types
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    });
  }

  // Handle Puppeteer/scraping errors
  if (err.message?.includes('timeout') || err.message?.includes('Timeout')) {
    return res.status(504).json({
      success: false,
      error: {
        code: ErrorCodes.TIMEOUT_ERROR,
        message: 'Request timed out while fetching weather data',
        details: 'The weather data source took too long to respond. Please try again.'
      }
    });
  }

  if (err.message?.includes('Navigation') || err.message?.includes('net::')) {
    return res.status(503).json({
      success: false,
      error: {
        code: ErrorCodes.SCRAPE_ERROR,
        message: 'Failed to fetch weather data',
        details: 'Could not connect to the weather data source. Please try again later.'
      }
    });
  }

  // Handle validation errors from Zod
  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Validation failed',
        details: err.errors
      }
    });
  }

  // Default internal server error
  res.status(500).json({
    success: false,
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
      details: err.message // Always show error details for debugging
    }
  });
}

export default errorHandler;

