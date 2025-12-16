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
  
  // Find the hottest time of day (by average)
  const hottestHourByAvg = hourlyAverages[0];
  const coldestHourByAvg = hourlyAverages[hourlyAverages.length - 1];
  
  // Find MEDIAN time when peak temperature occurs each day
  // Group observations by date to find peak time per day
  const obsByDate = {};
  validObs.forEach(obs => {
    if (!obsByDate[obs.date]) {
      obsByDate[obs.date] = [];
    }
    obsByDate[obs.date].push(obs);
  });
  
  // For each day, find the time(s) when the highest temperature occurred
  const peakTimes = [];
  const troughTimes = [];
  
  Object.entries(obsByDate).forEach(([date, dayObs]) => {
    const maxTemp = Math.max(...dayObs.map(o => o.temperature_c));
    const minTemp = Math.min(...dayObs.map(o => o.temperature_c));
    
    // Find the time(s) at max temp - take the first occurrence
    const peakObs = dayObs.find(o => o.temperature_c === maxTemp);
    if (peakObs) {
      peakTimes.push(peakObs.time);
    }
    
    // Find the time(s) at min temp - take the first occurrence
    const troughObs = dayObs.find(o => o.temperature_c === minTemp);
    if (troughObs) {
      troughTimes.push(troughObs.time);
    }
  });
  
  // Calculate median peak time
  const medianPeakTime = calculateMedianTime(peakTimes);
  const medianTroughTime = calculateMedianTime(troughTimes);
  
  // Count frequency of peak times
  const peakTimeFrequency = {};
  peakTimes.forEach(t => {
    peakTimeFrequency[t] = (peakTimeFrequency[t] || 0) + 1;
  });
  const mostCommonPeakTime = Object.entries(peakTimeFrequency)
    .sort((a, b) => b[1] - a[1])[0];
  
  const troughTimeFrequency = {};
  troughTimes.forEach(t => {
    troughTimeFrequency[t] = (troughTimeFrequency[t] || 0) + 1;
  });
  const mostCommonTroughTime = Object.entries(troughTimeFrequency)
    .sort((a, b) => b[1] - a[1])[0];
  
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
        median_time: medianPeakTime,
        most_common_time: mostCommonPeakTime ? mostCommonPeakTime[0] : null,
        frequency: mostCommonPeakTime ? mostCommonPeakTime[1] : 0,
        all_peak_times: peakTimes,
        // Keep average for reference
        average_hottest_hour: hottestHourByAvg?.hour,
        average_temp_at_hottest: hottestHourByAvg?.average
      },
      coldest_time_of_day: {
        median_time: medianTroughTime,
        most_common_time: mostCommonTroughTime ? mostCommonTroughTime[0] : null,
        frequency: mostCommonTroughTime ? mostCommonTroughTime[1] : 0,
        all_trough_times: troughTimes,
        // Keep average for reference
        average_coldest_hour: coldestHourByAvg?.hour,
        average_temp_at_coldest: coldestHourByAvg?.average
      },
      // Top 5 hottest hours (by average temp)
      warmest_hours: hourlyAverages.slice(0, 5).map(h => ({
        time: h.hour,
        avg_temp: h.average
      })),
      // Top 5 coldest hours (by average temp)
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
    insights: generateInsights(allTemps, dailyMaxTemps, hourlyAverages, days, medianPeakTime, medianTroughTime)
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
 * Convert time string to minutes from midnight
 * e.g., "2:30 PM" -> 870 (14:30 = 14*60 + 30)
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return 0;
  
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  
  // Convert to 24-hour format
  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }
  
  return hours * 60 + minutes;
}

/**
 * Convert minutes from midnight back to time string
 * e.g., 870 -> "2:30 PM"
 */
function minutesToTime(minutes) {
  let hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  const period = hours >= 12 ? 'PM' : 'AM';
  
  if (hours > 12) hours -= 12;
  if (hours === 0) hours = 12;
  
  return `${hours}:${mins.toString().padStart(2, '0')} ${period}`;
}

/**
 * Calculate median time from an array of time strings
 */
function calculateMedianTime(times) {
  if (times.length === 0) return null;
  
  // Convert all times to minutes
  const minutesArray = times.map(timeToMinutes);
  
  // Sort and find median
  const sorted = [...minutesArray].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  
  let medianMinutes;
  if (sorted.length % 2 !== 0) {
    medianMinutes = sorted[mid];
  } else {
    medianMinutes = (sorted[mid - 1] + sorted[mid]) / 2;
  }
  
  return minutesToTime(medianMinutes);
}

/**
 * Generate human-readable insights
 */
function generateInsights(allTemps, dailyMaxTemps, hourlyAverages, days, medianPeakTime, medianTroughTime) {
  const insights = [];
  
  const medianHigh = calculateMedian(dailyMaxTemps);
  
  // Temperature range insight
  const range = Math.max(...allTemps) - Math.min(...allTemps);
  insights.push(`Temperature varied by ${range}°C over the ${days}-day period`);
  
  // Median high insight
  if (medianHigh !== null) {
    insights.push(`The median daily high was ${medianHigh}°C`);
  }
  
  // Median peak time insight
  if (medianPeakTime) {
    insights.push(`Peak daily temperature typically occurs around ${medianPeakTime} (median)`);
  }
  
  // Median trough time insight
  if (medianTroughTime) {
    insights.push(`Lowest daily temperature typically occurs around ${medianTroughTime} (median)`);
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

