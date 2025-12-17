import { Router } from 'express';
import { scraper } from '../services/scraper.js';
import { cache } from '../services/cache.js';
import { logger } from '../utils/logger.js';
import { 
  weatherHistorySchema, 
  dateRangeSchema,
  latestWeatherSchema,
  validateQuery 
} from '../utils/validators.js';

const router = Router();

/**
 * GET /api/weather/history
 * Fetch historical weather data for a specific location and date
 */
router.get('/history', validateQuery(weatherHistorySchema), async (req, res, next) => {
  const { location, date, metric } = req.validatedQuery;
  const startTime = Date.now();
  
  try {
    // Check cache first
    const cacheKey = cache.generateKey(location, date);
    let data = cache.get(cacheKey);
    let cacheHit = true;
    
    if (!data) {
      cacheHit = false;
      logger.info(`Fetching weather data for ${location} on ${date}`);
      
      // Scrape data (with fallback)
      data = await scraper.scrapeWeatherDataWithFallback(location, date, metric);
      
      // Cache the result (1 hour for historical data)
      cache.set(cacheKey, data);
    }
    
    const duration = Date.now() - startTime;
    
    logger.info(`Weather data served`, {
      location,
      date,
      cacheHit,
      duration: `${duration}ms`
    });
    
    res.json({
      success: true,
      data,
      metadata: {
        scraped_at: new Date().toISOString(),
        source: 'wunderground.com',
        cache_hit: cacheHit,
        response_time_ms: duration
      }
    });
    
  } catch (error) {
    logger.error(`Failed to fetch weather data`, {
      location,
      date,
      error: error.message
    });
    
    next(error);
  }
});

/**
 * GET /api/weather/latest
 * Fetch only the latest/current temperature from the main weather page
 */
router.get('/latest', validateQuery(latestWeatherSchema), async (req, res, next) => {
  const { location } = req.validatedQuery;
  const startTime = Date.now();
  
  try {
    // Check cache with shorter TTL for latest data (15 minutes)
    const cacheKey = cache.generateKey(location, 'latest');
    let data = cache.get(cacheKey);
    let cacheHit = true;
    
    if (!data) {
      cacheHit = false;
      logger.info(`Fetching current temperature for ${location}`);
      
      // Fetch current temperature from main weather page
      const temperature = await scraper.fetchCurrentTemperature(location);
      
      // Parse location parts
      const locationParts = location.split('/');
      
      // Build response data
      data = {
        location: {
          city: locationParts[1]?.replace(/-/g, ' ') || '',
          country: locationParts[0]?.toUpperCase() || '',
          station: locationParts[2] || '',
          raw: location
        },
        timestamp: new Date().toISOString(),
        current: {
          temperature: {
            celsius: temperature.celsius,
            fahrenheit: temperature.fahrenheit
          }
        }
      };
      
      // Cache for 15 minutes for latest data
      cache.set(cacheKey, data, 15 * 60 * 1000);
    }
    
    const duration = Date.now() - startTime;
    
    res.json({
      success: true,
      data,
      metadata: {
        scraped_at: new Date().toISOString(),
        source: 'wunderground.com',
        cache_hit: cacheHit,
        response_time_ms: duration
      }
    });
    
  } catch (error) {
    logger.error(`Failed to fetch latest weather data`, {
      location,
      error: error.message
    });
    
    next(error);
  }
});

/**
 * GET /api/weather/range
 * Fetch data for a date range
 */
router.get('/range', validateQuery(dateRangeSchema), async (req, res, next) => {
  const { location, start_date, end_date, metric } = req.validatedQuery;
  const startTime = Date.now();
  
  try {
    const results = [];
    const errors = [];
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    
    // Iterate through each day in the range
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      
      try {
        // Check cache first
        const cacheKey = cache.generateKey(location, dateStr);
        let data = cache.get(cacheKey);
        
        if (!data) {
          // Add small delay between requests to be polite
          if (results.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          
          data = await scraper.scrapeWeatherData(location, dateStr, metric);
          cache.set(cacheKey, data);
        }
        
        results.push({
          date: dateStr,
          ...data
        });
        
      } catch (error) {
        logger.warn(`Failed to fetch data for ${dateStr}`, {
          error: error.message
        });
        errors.push({
          date: dateStr,
          error: error.message
        });
      }
    }
    
    const duration = Date.now() - startTime;
    
    res.json({
      success: true,
      data: {
        location: results[0]?.location || location,
        date_range: {
          start: start_date,
          end: end_date
        },
        days: results,
        summary: {
          total_days: results.length,
          failed_days: errors.length,
          temperature_avg: calculateAverage(results, 'daily.temperature.average'),
          precipitation_total: calculateSum(results, 'daily.precipitation_total')
        }
      },
      errors: errors.length > 0 ? errors : undefined,
      metadata: {
        scraped_at: new Date().toISOString(),
        source: 'wunderground.com',
        response_time_ms: duration
      }
    });
    
  } catch (error) {
    logger.error(`Failed to fetch weather range data`, {
      location,
      start_date,
      end_date,
      error: error.message
    });
    
    next(error);
  }
});

/**
 * GET /api/weather/cache/stats
 * Get cache statistics
 */
router.get('/cache/stats', (req, res) => {
  const stats = cache.stats();
  res.json({
    success: true,
    data: stats
  });
});

/**
 * DELETE /api/weather/cache
 * Clear the cache
 */
router.delete('/cache', (req, res) => {
  cache.clear();
  res.json({
    success: true,
    message: 'Cache cleared successfully'
  });
});

// Helper functions
function calculateAverage(items, path) {
  const values = items.map(item => getNestedValue(item, path)).filter(v => v !== null && v !== undefined);
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10;
}

function calculateSum(items, path) {
  const values = items.map(item => getNestedValue(item, path)).filter(v => v !== null && v !== undefined);
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

export default router;

