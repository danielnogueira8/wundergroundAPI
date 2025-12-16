import puppeteer from 'puppeteer';
import { logger } from '../utils/logger.js';
import https from 'https';
import http from 'http';

/**
 * WeatherScraper - Scrapes weather data from Wunderground/Weather.com
 */
class WeatherScraper {
  constructor() {
    this.browser = null;
    this.baseUrl = 'https://www.wunderground.com/history/daily';
    this.apiUrl = 'https://api.weather.com/v1/location';
    this.apiKey = 'e1f10a1e78da46f5b10a1e78da96f525'; // Public API key from Wunderground
  }

  /**
   * Initialize the browser instance
   */
  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--window-size=1920,1080',
          '--ignore-certificate-errors'
        ],
        timeout: 60000
      });
      logger.info('Browser initialized');
    }
    return this.browser;
  }

  /**
   * Close the browser instance
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Browser closed');
    }
  }

  /**
   * Build the URL for weather history page
   * @param {string} location - Location in format: country/city/station_code
   * @param {string} date - Date in YYYY-MM-DD format
   */
  buildUrl(location, date) {
    return `${this.baseUrl}/${location}/date/${date}`;
  }

  /**
   * Scrape weather data for a specific location and date
   * @param {string} location - Location string (e.g., 'kr/incheon/RKSI')
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} metric - Optional specific metric to fetch
   */
  async scrapeWeatherData(location, date, metric = null) {
    const startTime = Date.now();
    const url = this.buildUrl(location, date);
    
    logger.info(`Scraping weather data from: ${url}`);
    
    await this.init();
    const page = await this.browser.newPage();
    
    try {
      // Set a realistic user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Set extra headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      });

      // Navigate to the page with retry logic
      let retries = 3;
      let lastError;
      
      while (retries > 0) {
        try {
          await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 45000 
          });
          break;
        } catch (navError) {
          lastError = navError;
          retries--;
          if (retries > 0) {
            logger.warn(`Navigation failed, retrying... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      
      if (retries === 0 && lastError) {
        throw lastError;
      }

      // Wait for charts to load
      await page.waitForSelector('.observation-table, .history-graph, [class*="chart"]', {
        timeout: 15000
      }).catch(() => {
        logger.warn('Chart selector not found, trying alternative approach');
      });

      // Additional wait for JavaScript rendering
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Extract weather data
      const weatherData = await page.evaluate(() => {
        const data = {
          location: {},
          temperature: { hourly: [], current: null, min: null, max: null, average: null },
          precipitation: { hourly: [], total: 0 },
          wind: { hourly: [], current: null },
          humidity: { hourly: [], current: null },
          pressure: { hourly: [], current: null }
        };

        // Try to extract location info from page
        const locationHeader = document.querySelector('h1, [class*="location"], [class*="city-header"]');
        if (locationHeader) {
          data.location.displayName = locationHeader.textContent?.trim();
        }

        // Strategy 1: Look for embedded JSON data in script tags
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const content = script.textContent || '';
          
          // Look for chart data patterns
          if (content.includes('Highcharts') || content.includes('chartData') || content.includes('seriesData')) {
            // Try to extract temperature data
            const tempMatch = content.match(/temperature['":\s]+(\[[\d\s,.-]+\])/i);
            if (tempMatch) {
              try {
                data.temperature.hourly = JSON.parse(tempMatch[1]);
              } catch (e) { /* ignore parse errors */ }
            }

            // Try to extract from Highcharts series
            const seriesMatch = content.match(/series\s*:\s*\[([\s\S]*?)\]/);
            if (seriesMatch) {
              try {
                // Look for data arrays
                const dataArrays = content.match(/data\s*:\s*\[([\d\s,.-]+)\]/g);
                if (dataArrays) {
                  dataArrays.forEach((match, index) => {
                    const values = match.match(/\[([\d\s,.-]+)\]/);
                    if (values) {
                      const parsed = values[1].split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
                      if (parsed.length > 0) {
                        if (index === 0) data.temperature.hourly = parsed;
                        else if (index === 1) data.precipitation.hourly = parsed;
                        else if (index === 2) data.wind.hourly = parsed;
                      }
                    }
                  });
                }
              } catch (e) { /* ignore */ }
            }
          }

          // Look for wu.obsTimeLocal or similar patterns
          if (content.includes('wu.') || content.includes('observation')) {
            const tempValMatch = content.match(/temp[eratur]*['":\s]+(-?\d+\.?\d*)/gi);
            if (tempValMatch && tempValMatch.length > 0) {
              const temps = tempValMatch.map(m => {
                const num = m.match(/-?\d+\.?\d*/);
                return num ? parseFloat(num[0]) : null;
              }).filter(v => v !== null);
              if (temps.length > 0) {
                data.temperature.current = temps[temps.length - 1];
              }
            }
          }
        }

        // Strategy 2: Extract from observation table
        const observationTable = document.querySelector('.observation-table, table[class*="history"]');
        if (observationTable) {
          const rows = observationTable.querySelectorAll('tr');
          rows.forEach(row => {
            const cells = row.querySelectorAll('td, th');
            if (cells.length >= 2) {
              const label = cells[0].textContent?.toLowerCase() || '';
              const value = cells[1].textContent?.trim() || '';
              
              if (label.includes('temp') && !label.includes('dew')) {
                const numVal = parseFloat(value);
                if (!isNaN(numVal)) {
                  data.temperature.current = numVal;
                }
              }
              if (label.includes('precip')) {
                const numVal = parseFloat(value);
                if (!isNaN(numVal)) {
                  data.precipitation.total = numVal;
                }
              }
              if (label.includes('wind') && !label.includes('gust')) {
                const numVal = parseFloat(value);
                if (!isNaN(numVal)) {
                  data.wind.current = numVal;
                }
              }
              if (label.includes('humid')) {
                const numVal = parseFloat(value);
                if (!isNaN(numVal)) {
                  data.humidity.current = numVal;
                }
              }
            }
          });
        }

        // Strategy 3: Look for summary/current conditions
        const summaryElements = document.querySelectorAll('[class*="summary"], [class*="current"], [class*="conditions"]');
        summaryElements.forEach(el => {
          const text = el.textContent || '';
          
          // Temperature pattern: "45°F" or "7°C"
          const tempMatch = text.match(/(-?\d+)\s*°\s*([FC])/i);
          if (tempMatch && !data.temperature.current) {
            let temp = parseInt(tempMatch[1], 10);
            const unit = tempMatch[2].toUpperCase();
            if (unit === 'F') {
              // Convert to Celsius
              data.temperature.fahrenheit = temp;
              temp = Math.round((temp - 32) * 5 / 9 * 10) / 10;
            }
            data.temperature.current = temp;
          }

          // Wind pattern: "10 mph" or "16 km/h"
          const windMatch = text.match(/(\d+)\s*(mph|km\/h|kmh)/i);
          if (windMatch && !data.wind.current) {
            data.wind.current = parseInt(windMatch[1], 10);
            data.wind.unit = windMatch[2].toLowerCase();
          }

          // Humidity pattern: "65%"
          const humidMatch = text.match(/(\d+)\s*%/);
          if (humidMatch && !data.humidity.current) {
            data.humidity.current = parseInt(humidMatch[1], 10);
          }
        });

        // Strategy 4: Extract from daily history table rows
        const historyRows = document.querySelectorAll('[class*="history"] tr, .daily-history tr');
        const hourlyData = [];
        historyRows.forEach(row => {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length >= 3) {
            const timeCell = cells[0]?.textContent?.trim();
            const tempCell = cells[1]?.textContent?.trim();
            
            if (timeCell && tempCell) {
              const timeMatch = timeCell.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
              const tempVal = parseFloat(tempCell);
              
              if (timeMatch && !isNaN(tempVal)) {
                hourlyData.push({
                  time: timeCell,
                  temperature: tempVal
                });
              }
            }
          }
        });
        
        if (hourlyData.length > 0) {
          data.hourlyObservations = hourlyData;
        }

        // Calculate min/max/average for temperature
        const allTemps = data.temperature.hourly.length > 0 
          ? data.temperature.hourly 
          : hourlyData.map(h => h.temperature).filter(t => !isNaN(t));
        
        if (allTemps.length > 0) {
          data.temperature.min = Math.min(...allTemps);
          data.temperature.max = Math.max(...allTemps);
          data.temperature.average = Math.round(allTemps.reduce((a, b) => a + b, 0) / allTemps.length * 10) / 10;
          
          if (!data.temperature.current) {
            data.temperature.current = allTemps[allTemps.length - 1];
          }
        }

        // Calculate total precipitation
        if (data.precipitation.hourly.length > 0) {
          data.precipitation.total = data.precipitation.hourly.reduce((a, b) => a + b, 0);
        }

        return data;
      });

      // Parse location from the URL
      const locationParts = location.split('/');
      weatherData.location = {
        ...weatherData.location,
        country: locationParts[0]?.toUpperCase() || '',
        city: locationParts[1] || '',
        station: locationParts[2] || ''
      };

      const duration = Date.now() - startTime;
      logger.info(`Scraping completed in ${duration}ms`, {
        location,
        date,
        dataPoints: weatherData.temperature.hourly?.length || 0
      });

      return this.formatResponse(weatherData, location, date, metric);

    } catch (error) {
      logger.error(`Scraping failed for ${location} on ${date}`, {
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      await page.close();
    }
  }

  /**
   * Format the raw scraped data into the API response format
   */
  formatResponse(rawData, location, date, metric) {
    const locationParts = location.split('/');
    
    const response = {
      location: {
        city: this.capitalizeWords(locationParts[1]?.replace(/-/g, ' ') || ''),
        country: this.getCountryName(locationParts[0] || ''),
        station: locationParts[2] || '',
        raw: location
      },
      date: date,
      timestamp: new Date().toISOString(),
      current: {
        temperature: {
          celsius: rawData.temperature.current,
          fahrenheit: rawData.temperature.fahrenheit || this.celsiusToFahrenheit(rawData.temperature.current)
        },
        precipitation: {
          mm: rawData.precipitation.total || 0,
          inches: this.mmToInches(rawData.precipitation.total || 0)
        },
        wind: {
          speed_kmh: rawData.wind.current || null,
          speed_mph: rawData.wind.current ? this.kmhToMph(rawData.wind.current) : null
        },
        humidity_percent: rawData.humidity.current || null,
        pressure_hpa: rawData.pressure?.current || null
      },
      daily: {
        temperature: {
          min: rawData.temperature.min,
          max: rawData.temperature.max,
          average: rawData.temperature.average
        },
        precipitation_total: rawData.precipitation.total || 0,
        data_points: rawData.temperature.hourly?.length || rawData.hourlyObservations?.length || 0
      },
      hourly_data: this.formatHourlyData(rawData)
    };

    // Filter by metric if specified
    if (metric) {
      return this.filterByMetric(response, metric);
    }

    return response;
  }

  /**
   * Format hourly data for the response
   */
  formatHourlyData(rawData) {
    // If we have detailed observation data from the Daily Observations table, use it
    if (rawData.hourlyObservations?.length > 0) {
      return rawData.hourlyObservations.map(obs => ({
        time: obs.time,
        temperature_c: obs.temperature_c,
        dew_point_c: obs.dew_point_c,
        humidity_percent: obs.humidity,
        wind_direction: obs.wind_direction,
        wind_speed_kmh: obs.wind_speed_kmh,
        wind_gust_kmh: obs.wind_gust_kmh,
        pressure_hpa: obs.pressure_hpa,
        precipitation_mm: obs.precipitation_mm,
        condition: obs.condition
      }));
    }

    // Fallback: construct from separate arrays
    const hourlyData = [];
    const hours = rawData.temperature.hourly?.length || 24;
    
    for (let i = 0; i < hours; i++) {
      const hour = String(i).padStart(2, '0') + ':00';
      hourlyData.push({
        time: hour,
        temperature_c: rawData.temperature.hourly?.[i] ?? null,
        precipitation_mm: rawData.precipitation.hourly?.[i] ?? 0,
        wind_speed_kmh: rawData.wind.hourly?.[i] ?? null
      });
    }

    return hourlyData.filter(h => h.temperature_c !== null);
  }

  /**
   * Filter response by specific metric
   */
  filterByMetric(response, metric) {
    if (!metric) return response;
    
    switch (metric.toLowerCase()) {
      case 'temperature':
        return {
          location: response.location,
          date: response.date,
          temperature: {
            current: response.current.temperature,
            daily: response.daily.temperature,
            hourly: response.hourly_data.map(h => ({
              hour: h.hour,
              temperature_c: h.temperature_c
            }))
          }
        };
      case 'precipitation':
        return {
          location: response.location,
          date: response.date,
          precipitation: {
            current: response.current.precipitation,
            daily_total: response.daily.precipitation_total,
            hourly: response.hourly_data.map(h => ({
              hour: h.hour,
              precipitation_mm: h.precipitation_mm
            }))
          }
        };
      case 'wind':
        return {
          location: response.location,
          date: response.date,
          wind: {
            current: response.current.wind,
            hourly: response.hourly_data.map(h => ({
              hour: h.hour,
              wind_speed_kmh: h.wind_speed_kmh
            }))
          }
        };
      default:
        return response;
    }
  }

  // Utility methods
  celsiusToFahrenheit(celsius) {
    if (celsius === null || celsius === undefined) return null;
    return Math.round((celsius * 9/5 + 32) * 10) / 10;
  }

  mmToInches(mm) {
    return Math.round(mm * 0.0394 * 100) / 100;
  }

  kmhToMph(kmh) {
    return Math.round(kmh * 0.621371 * 10) / 10;
  }

  capitalizeWords(str) {
    return str.replace(/\b\w/g, char => char.toUpperCase());
  }

  getCountryName(code) {
    const countries = {
      'kr': 'South Korea',
      'us': 'United States',
      'gb': 'United Kingdom',
      'uk': 'United Kingdom',
      'de': 'Germany',
      'fr': 'France',
      'jp': 'Japan',
      'cn': 'China',
      'ca': 'Canada',
      'au': 'Australia',
      'br': 'Brazil',
      'in': 'India',
      'mx': 'Mexico',
      'es': 'Spain',
      'it': 'Italy'
    };
    return countries[code.toLowerCase()] || code.toUpperCase();
  }

  /**
   * Fallback: Fetch page content using simple HTTP request
   * This won't get JavaScript-rendered data but can extract some basic info
   */
  async fetchWithHttp(url) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      };

      const req = protocol.get(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('HTTP request timeout'));
      });
    });
  }

  /**
   * Scrape weather data - tries API first, then fallbacks
   */
  async scrapeWeatherDataWithFallback(location, date, metric = null) {
    // Try the Weather.com API first (most reliable)
    try {
      const apiData = await this.fetchFromWeatherApi(location, date);
      if (apiData && apiData.observations && apiData.observations.length > 0) {
        logger.info(`Successfully fetched ${apiData.observations.length} observations from Weather.com API`);
        const formattedData = this.formatApiResponse(apiData, location, date);
        return this.filterByMetric(formattedData, metric);
      }
    } catch (apiError) {
      logger.warn(`Weather.com API failed: ${apiError.message}`);
    }

    // Try Puppeteer as second option
    try {
      return await this.scrapeWeatherData(location, date, metric);
    } catch (puppeteerError) {
      logger.warn(`Puppeteer scraping failed: ${puppeteerError.message}`);
    }
    
    // Fallback to HTTP scraping
    try {
      const url = this.buildUrl(location, date);
      const html = await this.fetchWithHttp(url);
      const data = this.extractFromHtml(html, location, date);
      return this.formatResponse(data, location, date, metric);
    } catch (httpError) {
      logger.error(`All scraping methods failed: ${httpError.message}`);
      throw httpError;
    }
  }

  /**
   * Fetch data directly from Weather.com API
   */
  async fetchFromWeatherApi(location, date) {
    const locationParts = location.split('/');
    const countryCode = locationParts[0]?.toUpperCase() || '';
    const stationCode = locationParts[2]?.toUpperCase() || '';
    
    // Format date as YYYYMMDD
    const dateFormatted = date.replace(/-/g, '');
    
    // Build API URL: https://api.weather.com/v1/location/{STATION}:9:{COUNTRY}/observations/historical.json
    const apiEndpoint = `${this.apiUrl}/${stationCode}:9:${countryCode}/observations/historical.json?apiKey=${this.apiKey}&startDate=${dateFormatted}&endDate=${dateFormatted}&units=m`;
    
    logger.info(`Fetching from Weather.com API: ${stationCode}:9:${countryCode} for ${date}`);
    
    const response = await this.fetchWithHttp(apiEndpoint);
    return JSON.parse(response);
  }

  /**
   * Format Weather.com API response into our standard format
   */
  formatApiResponse(apiData, location, date) {
    const locationParts = location.split('/');
    const observations = apiData.observations || [];
    
    // Extract all temperatures, wind speeds, etc.
    const temps = observations.map(o => o.temp).filter(t => t !== null && t !== undefined);
    const winds = observations.map(o => o.wspd).filter(w => w !== null && w !== undefined);
    const humidities = observations.map(o => o.rh).filter(h => h !== null && h !== undefined);
    const pressures = observations.map(o => o.pressure).filter(p => p !== null && p !== undefined);
    
    // Get the latest observation
    const latest = observations[observations.length - 1] || {};
    
    return {
      location: {
        city: this.capitalizeWords(locationParts[1]?.replace(/-/g, ' ') || ''),
        country: this.getCountryName(locationParts[0] || ''),
        station: locationParts[2] || '',
        station_name: latest.obs_name || '',
        raw: location
      },
      date: date,
      timestamp: new Date().toISOString(),
      current: {
        temperature: {
          celsius: latest.temp ?? null,
          fahrenheit: latest.temp !== null ? this.celsiusToFahrenheit(latest.temp) : null
        },
        dew_point: {
          celsius: latest.dewPt ?? null,
          fahrenheit: latest.dewPt !== null ? this.celsiusToFahrenheit(latest.dewPt) : null
        },
        precipitation: {
          mm: latest.precip_hrly || 0,
          inches: this.mmToInches(latest.precip_hrly || 0)
        },
        wind: {
          speed_kmh: latest.wspd ?? null,
          speed_mph: latest.wspd !== null ? this.kmhToMph(latest.wspd) : null,
          gust_kmh: latest.gust ?? null,
          direction: latest.wdir ?? null,
          direction_cardinal: latest.wdir_cardinal ?? null
        },
        humidity_percent: latest.rh ?? null,
        pressure_hpa: latest.pressure ?? null,
        visibility_km: latest.vis ?? null,
        feels_like_c: latest.feels_like ?? null,
        condition: latest.wx_phrase ?? null,
        uv_index: latest.uv_index ?? null
      },
      daily: {
        temperature: {
          min: temps.length > 0 ? Math.min(...temps) : null,
          max: temps.length > 0 ? Math.max(...temps) : null,
          average: temps.length > 0 ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length * 10) / 10 : null
        },
        wind: {
          average_kmh: winds.length > 0 ? Math.round(winds.reduce((a, b) => a + b, 0) / winds.length * 10) / 10 : null,
          max_kmh: winds.length > 0 ? Math.max(...winds) : null
        },
        humidity: {
          average: humidities.length > 0 ? Math.round(humidities.reduce((a, b) => a + b, 0) / humidities.length) : null
        },
        precipitation_total: observations.reduce((sum, o) => sum + (o.precip_hrly || 0), 0),
        data_points: observations.length
      },
      hourly_data: observations.map(obs => ({
        time: this.formatLocalTime(obs.valid_time_gmt),
        temperature_c: obs.temp
      }))
    };
  }

  /**
   * Format Unix timestamp to local time string
   */
  formatLocalTime(unixTimestamp) {
    const date = new Date(unixTimestamp * 1000);
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }

  /**
   * Extract weather data from raw HTML (fallback method)
   * Parses the "Daily Observations" table from Wunderground
   */
  extractFromHtml(html, location, date) {
    const data = {
      location: {},
      temperature: { hourly: [], current: null, min: null, max: null, average: null },
      precipitation: { hourly: [], total: 0 },
      wind: { hourly: [], current: null },
      humidity: { hourly: [], current: null },
      pressure: { hourly: [], current: null },
      hourlyObservations: []
    };

    // Parse the Daily Observations table
    // Look for table rows with observation data
    // Pattern: Time | Temperature | Dew Point | Humidity | Wind | Wind Speed | Wind Gust | Pressure | Precip. | Condition
    
    // Find all table rows that contain observation data
    // The table structure has rows with time like "12:00 AM", "12:30 AM", etc.
    const rowPattern = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = html.match(rowPattern) || [];
    
    const observations = [];
    
    for (const row of rows) {
      // Extract cell data - look for td elements
      const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells = [];
      let cellMatch;
      
      while ((cellMatch = cellPattern.exec(row)) !== null) {
        // Clean up the cell content
        let content = cellMatch[1]
          .replace(/<[^>]+>/g, '') // Remove HTML tags
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        cells.push(content);
      }
      
      // Check if this looks like an observation row (has time pattern)
      if (cells.length >= 8) {
        const timeMatch = cells[0]?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        
        if (timeMatch) {
          const observation = {
            time: cells[0].trim(),
            temperature_c: this.parseTemperature(cells[1]),
            dew_point_c: this.parseTemperature(cells[2]),
            humidity: this.parsePercentage(cells[3]),
            wind_direction: cells[4]?.trim() || null,
            wind_speed_kmh: this.parseWindSpeed(cells[5]),
            wind_gust_kmh: this.parseWindSpeed(cells[6]),
            pressure_hpa: this.parsePressure(cells[7]),
            precipitation_mm: this.parsePrecipitation(cells[8]),
            condition: cells[9]?.trim() || null
          };
          
          observations.push(observation);
        }
      }
    }
    
    // If we found observations, process them
    if (observations.length > 0) {
      data.hourlyObservations = observations;
      
      // Extract temperature data
      const temps = observations
        .map(o => o.temperature_c)
        .filter(t => t !== null && !isNaN(t));
      
      if (temps.length > 0) {
        data.temperature.hourly = temps;
        data.temperature.current = temps[temps.length - 1]; // Most recent
        data.temperature.min = Math.min(...temps);
        data.temperature.max = Math.max(...temps);
        data.temperature.average = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length * 10) / 10;
      }
      
      // Extract wind data
      const winds = observations
        .map(o => o.wind_speed_kmh)
        .filter(w => w !== null && !isNaN(w));
      
      if (winds.length > 0) {
        data.wind.hourly = winds;
        data.wind.current = winds[winds.length - 1];
      }
      
      // Extract humidity data
      const humidities = observations
        .map(o => o.humidity)
        .filter(h => h !== null && !isNaN(h));
      
      if (humidities.length > 0) {
        data.humidity.hourly = humidities;
        data.humidity.current = humidities[humidities.length - 1];
      }
      
      // Extract precipitation data
      const precips = observations
        .map(o => o.precipitation_mm)
        .filter(p => p !== null && !isNaN(p));
      
      if (precips.length > 0) {
        data.precipitation.hourly = precips;
        data.precipitation.total = precips.reduce((a, b) => a + b, 0);
      }
      
      // Extract pressure data
      const pressures = observations
        .map(o => o.pressure_hpa)
        .filter(p => p !== null && !isNaN(p));
      
      if (pressures.length > 0) {
        data.pressure.hourly = pressures;
        data.pressure.current = pressures[pressures.length - 1];
      }
    }
    
    // Fallback: try simple pattern matching if table parsing didn't work
    if (observations.length === 0) {
      // Try to extract temperature from the page
      const tempMatches = html.match(/(-?\d+)\s*°\s*([FC])/gi);
      if (tempMatches && tempMatches.length > 0) {
        const temps = tempMatches.map(match => {
          const parsed = match.match(/(-?\d+)\s*°\s*([FC])/i);
          if (parsed) {
            let temp = parseInt(parsed[1], 10);
            if (parsed[2].toUpperCase() === 'F') {
              temp = Math.round((temp - 32) * 5 / 9 * 10) / 10;
            }
            return temp;
          }
          return null;
        }).filter(t => t !== null && t > -50 && t < 60);
        
        if (temps.length > 0) {
          data.temperature.current = temps[0];
          data.temperature.min = Math.min(...temps);
          data.temperature.max = Math.max(...temps);
          data.temperature.average = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length * 10) / 10;
        }
      }

      // Try to extract wind speed
      const windMatch = html.match(/(\d+)\s*(mph|km\/h|kmh)/i);
      if (windMatch) {
        data.wind.current = parseInt(windMatch[1], 10);
      }

      // Try to extract humidity
      const humidMatch = html.match(/humidity[:\s]*(\d+)\s*%/i);
      if (humidMatch) {
        data.humidity.current = parseInt(humidMatch[1], 10);
      }
    }

    logger.info(`Extracted ${observations.length} observations from HTML`);
    return data;
  }

  /**
   * Parse temperature value from string (e.g., "5 °C" -> 5)
   */
  parseTemperature(str) {
    if (!str) return null;
    const match = str.match(/(-?\d+\.?\d*)\s*°?\s*([CF])?/i);
    if (match) {
      let temp = parseFloat(match[1]);
      // Convert Fahrenheit to Celsius if needed
      if (match[2]?.toUpperCase() === 'F') {
        temp = Math.round((temp - 32) * 5 / 9 * 10) / 10;
      }
      return temp;
    }
    return null;
  }

  /**
   * Parse percentage value (e.g., "76 %" -> 76)
   */
  parsePercentage(str) {
    if (!str) return null;
    const match = str.match(/(\d+)\s*%?/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Parse wind speed (e.g., "13 km/h" -> 13)
   */
  parseWindSpeed(str) {
    if (!str) return null;
    const match = str.match(/(\d+\.?\d*)\s*(km\/h|mph|kmh)?/i);
    if (match) {
      let speed = parseFloat(match[1]);
      // Convert mph to km/h if needed
      if (match[2]?.toLowerCase() === 'mph') {
        speed = Math.round(speed * 1.60934 * 10) / 10;
      }
      return speed;
    }
    return null;
  }

  /**
   * Parse pressure (e.g., "1,022.15 hPa" -> 1022.15)
   */
  parsePressure(str) {
    if (!str) return null;
    const match = str.match(/([\d,]+\.?\d*)\s*(hPa|mb)?/i);
    if (match) {
      return parseFloat(match[1].replace(/,/g, ''));
    }
    return null;
  }

  /**
   * Parse precipitation (e.g., "0.0 mm" -> 0.0)
   */
  parsePrecipitation(str) {
    if (!str) return null;
    const match = str.match(/(\d+\.?\d*)\s*(mm|in)?/i);
    if (match) {
      let precip = parseFloat(match[1]);
      // Convert inches to mm if needed
      if (match[2]?.toLowerCase() === 'in') {
        precip = Math.round(precip * 25.4 * 10) / 10;
      }
      return precip;
    }
    return null;
  }
}

// Export singleton instance
export const scraper = new WeatherScraper();
export default scraper;

