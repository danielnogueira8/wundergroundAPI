import { Router } from 'express';
import { scraper } from '../services/scraper.js';
import { cache } from '../services/cache.js';
import { logger } from '../utils/logger.js';
import { z } from 'zod';

const router = Router();

// Validation schema for analysis endpoint
const analysisSchema = z.object({
  location: z.string()
    .min(5)
    .regex(/^[a-z]{2}\/[a-z0-9-]+\/[A-Z0-9]+$/i, 'Location must be in format: country/city/station_code'),
  days: z.string()
    .optional()
    .transform(val => parseInt(val) || 30)
    .refine(val => val >= 7 && val <= 30, 'Days must be between 7 and 30')
});

/**
 * GET /api/analysis/temperature
 * Analyze temperature patterns over the past N days
 */
router.get('/temperature', async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    // Validate query params
    const parsed = analysisSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: parsed.error.errors
        }
      });
    }
    
    const { location, days } = parsed.data;
    
    // Check cache first
    const cacheKey = `analysis:${location}:${days}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return res.json({
        success: true,
        data: cachedResult,
        metadata: {
          cache_hit: true,
          response_time_ms: Date.now() - startTime
        }
      });
    }
    
    logger.info(`Starting ${days}-day temperature analysis for ${location}`);
    
    // Fetch data for each day
    const today = new Date();
    const allObservations = [];
    const dailySummaries = [];
    const errors = [];
    
    for (let i = 1; i <= days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      try {
        // Check if we have this day cached
        const dayCacheKey = cache.generateKey(location, dateStr);
        let dayData = cache.get(dayCacheKey);
        
        if (!dayData) {
          // Add delay between requests to be polite
          if (i > 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          dayData = await scraper.scrapeWeatherDataWithFallback(location, dateStr, null);
          cache.set(dayCacheKey, dayData);
        }
        
        if (dayData && dayData.hourly_data) {
          // Add date to each observation
          const observations = dayData.hourly_data.map(obs => ({
            ...obs,
            date: dateStr
          }));
          allObservations.push(...observations);
          
          // Store daily summary
          dailySummaries.push({
            date: dateStr,
            min: dayData.daily?.temperature?.min,
            max: dayData.daily?.temperature?.max,
            average: dayData.daily?.temperature?.average
          });
        }
        
        logger.info(`Fetched data for ${dateStr} (${i}/${days})`);
        
      } catch (error) {
        logger.warn(`Failed to fetch data for ${dateStr}: ${error.message}`);
        errors.push({ date: dateStr, error: error.message });
      }
    }
    
    // Analyze the data
    const analysis = analyzeTemperatureData(allObservations, dailySummaries, location, days);
    
    // Cache the result for 1 hour
    cache.set(cacheKey, analysis, 60 * 60 * 1000);
    
    const duration = Date.now() - startTime;
    logger.info(`Analysis completed in ${duration}ms`);
    
    res.json({
      success: true,
      data: analysis,
      errors: errors.length > 0 ? errors : undefined,
      metadata: {
        analyzed_at: new Date().toISOString(),
        cache_hit: false,
        response_time_ms: duration
      }
    });
    
  } catch (error) {
    logger.error(`Analysis failed: ${error.message}`);
    next(error);
  }
});

/**
 * Analyze temperature data and extract statistics
 */
function analyzeTemperatureData(observations, dailySummaries, location, days) {
  const locationParts = location.split('/');
  
  // Filter valid temperature readings
  const validObs = observations.filter(o => o.temperature_c !== null && o.temperature_c !== undefined);
  const allTemps = validObs.map(o => o.temperature_c);
  
  if (allTemps.length === 0) {
    return {
      location: {
        city: capitalizeWords(locationParts[1]?.replace(/-/g, ' ') || ''),
        country: locationParts[0]?.toUpperCase(),
        station: locationParts[2]
      },
      period: { days, observations: 0 },
      error: 'No temperature data available'
    };
  }
  
  // Get daily max temperatures
  const dailyMaxTemps = dailySummaries
    .filter(d => d.max !== null && d.max !== undefined)
    .map(d => d.max);
  
  // Find when highest temperatures occur (by hour)
  const hourlyMaxCounts = {};
  const hourlyTemps = {};
  
  validObs.forEach(obs => {
    const hour = obs.time; // e.g., "2:00 PM"
    if (!hourlyTemps[hour]) {
      hourlyTemps[hour] = [];
    }
    hourlyTemps[hour].push(obs.temperature_c);
  });
  
  // Calculate average temp for each hour slot
  const hourlyAverages = Object.entries(hourlyTemps).map(([hour, temps]) => ({
    hour,
    average: Math.round(temps.reduce((a, b) => a + b, 0) / temps.length * 10) / 10,
    count: temps.length
  })).sort((a, b) => b.average - a.average);
  
  // Find the hottest time of day
  const hottestHour = hourlyAverages[0];
  const coldestHour = hourlyAverages[hourlyAverages.length - 1];
  
  // Calculate statistics
  const stats = {
    location: {
      city: capitalizeWords(locationParts[1]?.replace(/-/g, ' ') || ''),
      country: getCountryName(locationParts[0] || ''),
      station: locationParts[2]
    },
    period: {
      days,
      start_date: dailySummaries[dailySummaries.length - 1]?.date,
      end_date: dailySummaries[0]?.date,
      total_observations: validObs.length,
      days_with_data: dailySummaries.length
    },
    temperature: {
      // Overall stats
      absolute_min: Math.min(...allTemps),
      absolute_max: Math.max(...allTemps),
      overall_average: Math.round(allTemps.reduce((a, b) => a + b, 0) / allTemps.length * 10) / 10,
      
      // Daily highs analysis
      daily_highs: {
        median: calculateMedian(dailyMaxTemps),
        average: Math.round(dailyMaxTemps.reduce((a, b) => a + b, 0) / dailyMaxTemps.length * 10) / 10,
        min: Math.min(...dailyMaxTemps),
        max: Math.max(...dailyMaxTemps)
      },
      
      // Daily lows analysis
      daily_lows: {
        median: calculateMedian(dailySummaries.filter(d => d.min !== null).map(d => d.min)),
        average: Math.round(dailySummaries.filter(d => d.min !== null).map(d => d.min).reduce((a, b) => a + b, 0) / dailySummaries.filter(d => d.min !== null).length * 10) / 10
      }
    },
    patterns: {
      hottest_time_of_day: {
        time: hottestHour?.hour,
        average_temp: hottestHour?.average,
        observation_count: hottestHour?.count
      },
      coldest_time_of_day: {
        time: coldestHour?.hour,
        average_temp: coldestHour?.average,
        observation_count: coldestHour?.count
      },
      // Top 5 hottest hours
      warmest_hours: hourlyAverages.slice(0, 5).map(h => ({
        time: h.hour,
        avg_temp: h.average
      })),
      // Top 5 coldest hours
      coldest_hours: hourlyAverages.slice(-5).reverse().map(h => ({
        time: h.hour,
        avg_temp: h.average
      }))
    },
    daily_breakdown: dailySummaries.map(d => ({
      date: d.date,
      min: d.min,
      max: d.max,
      average: d.average
    })),
    insights: generateInsights(allTemps, dailyMaxTemps, hourlyAverages, days)
  };
  
  return stats;
}

/**
 * Calculate median of an array
 */
function calculateMedian(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Generate human-readable insights
 */
function generateInsights(allTemps, dailyMaxTemps, hourlyAverages, days) {
  const insights = [];
  
  const avgTemp = allTemps.reduce((a, b) => a + b, 0) / allTemps.length;
  const medianHigh = calculateMedian(dailyMaxTemps);
  const hottestHour = hourlyAverages[0];
  const coldestHour = hourlyAverages[hourlyAverages.length - 1];
  
  // Temperature range insight
  const range = Math.max(...allTemps) - Math.min(...allTemps);
  insights.push(`Temperature varied by ${range}°C over the ${days}-day period`);
  
  // Median high insight
  if (medianHigh !== null) {
    insights.push(`The median daily high was ${medianHigh}°C`);
  }
  
  // Best time for warmth
  if (hottestHour) {
    insights.push(`The warmest time of day is typically around ${hottestHour.hour} (avg ${hottestHour.average}°C)`);
  }
  
  // Coldest time
  if (coldestHour) {
    insights.push(`The coldest time is typically around ${coldestHour.hour} (avg ${coldestHour.average}°C)`);
  }
  
  // Temperature trend (comparing first half to second half of period)
  const midpoint = Math.floor(dailyMaxTemps.length / 2);
  const firstHalfAvg = dailyMaxTemps.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint;
  const secondHalfAvg = dailyMaxTemps.slice(midpoint).reduce((a, b) => a + b, 0) / (dailyMaxTemps.length - midpoint);
  
  if (Math.abs(firstHalfAvg - secondHalfAvg) >= 2) {
    if (secondHalfAvg > firstHalfAvg) {
      insights.push(`Temperatures are trending warmer (↑${Math.round(secondHalfAvg - firstHalfAvg)}°C)`);
    } else {
      insights.push(`Temperatures are trending cooler (↓${Math.round(firstHalfAvg - secondHalfAvg)}°C)`);
    }
  } else {
    insights.push('Temperatures have been relatively stable');
  }
  
  return insights;
}

function capitalizeWords(str) {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

function getCountryName(code) {
  const countries = {
    'kr': 'South Korea', 'us': 'United States', 'gb': 'United Kingdom',
    'de': 'Germany', 'fr': 'France', 'jp': 'Japan', 'cn': 'China',
    'ca': 'Canada', 'au': 'Australia', 'br': 'Brazil', 'in': 'India'
  };
  return countries[code.toLowerCase()] || code.toUpperCase();
}

export default router;

