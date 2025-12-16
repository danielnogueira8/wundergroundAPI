import { z } from 'zod';

/**
 * Location validation schema
 * Format: country/city/station_code (e.g., kr/incheon/RKSI)
 */
const locationSchema = z.string()
  .min(5, 'Location must be at least 5 characters')
  .regex(
    /^[a-z]{2}\/[a-z0-9-]+\/[A-Z0-9]+$/i,
    'Location must be in format: country/city/station_code (e.g., kr/incheon/RKSI)'
  )
  .transform(val => val.toLowerCase().replace(/\/([^/]+)$/, (_, p1) => '/' + p1.toUpperCase()));

/**
 * Date validation schema
 * Format: YYYY-MM-DD
 */
const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(val => {
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, 'Invalid date')
  .refine(val => {
    const date = new Date(val);
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    return date <= now;
  }, 'Date cannot be in the future');

/**
 * Metric validation schema
 */
const metricSchema = z.enum(['temperature', 'precipitation', 'wind'])
  .optional();

/**
 * Weather history query parameters schema
 */
export const weatherHistorySchema = z.object({
  location: locationSchema,
  date: dateSchema,
  metric: metricSchema
});

/**
 * Date range query parameters schema
 */
export const dateRangeSchema = z.object({
  location: locationSchema,
  start_date: dateSchema,
  end_date: dateSchema,
  metric: metricSchema
}).refine(data => {
  const start = new Date(data.start_date);
  const end = new Date(data.end_date);
  return start <= end;
}, {
  message: 'start_date must be before or equal to end_date',
  path: ['start_date']
}).refine(data => {
  const start = new Date(data.start_date);
  const end = new Date(data.end_date);
  const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  return diffDays <= 30;
}, {
  message: 'Date range cannot exceed 30 days',
  path: ['end_date']
});

/**
 * Validate request query parameters
 * @param {object} schema - Zod schema to validate against
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    try {
      const validated = schema.parse(req.query);
      req.validatedQuery = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
            details: error.errors.map(e => ({
              field: e.path.join('.'),
              message: e.message
            }))
          }
        });
      }
      next(error);
    }
  };
}

/**
 * Validate temperature value is within reasonable range
 */
export function isValidTemperature(temp) {
  return typeof temp === 'number' && temp >= -90 && temp <= 60;
}

/**
 * Validate wind speed is within reasonable range
 */
export function isValidWindSpeed(speed) {
  return typeof speed === 'number' && speed >= 0 && speed <= 500;
}

/**
 * Validate precipitation is within reasonable range
 */
export function isValidPrecipitation(precip) {
  return typeof precip === 'number' && precip >= 0 && precip <= 1000;
}

export default {
  weatherHistorySchema,
  dateRangeSchema,
  validateQuery,
  isValidTemperature,
  isValidWindSpeed,
  isValidPrecipitation
};

