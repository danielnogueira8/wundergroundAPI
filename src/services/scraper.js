import { logger } from '../utils/logger.js';
import https from 'https';

/**
 * WeatherScraper - Fetches weather data from Weather.com API (powers Wunderground)
 * No Puppeteer needed - uses simple HTTP requests
 */
class WeatherScraper {
  constructor() {
    this.apiKey = 'e1f10a1e78da46f5b10a1e78da96f525'; // Public API key from Wunderground
    this.baseApiUrl = 'https://api.weather.com';
  }

  /**
   * Make an HTTPS GET request and return JSON
   */
  async fetchJson(url) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      };

      https.get(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Fetch current temperature using Weather.com v3 API
   * @param {string} location - Location in format: country/city/station_code (e.g., gb/london/EGLC)
   */
  async fetchCurrentTemperature(location) {
    const startTime = Date.now();
    const locationParts = location.split('/');
    const stationCode = locationParts[2]?.toUpperCase() || '';

    if (!stationCode) {
      throw new Error('Invalid location format. Expected: country/city/STATION_CODE');
    }

    const apiUrl = `${this.baseApiUrl}/v3/wx/observations/current?icaoCode=${stationCode}&language=en-US&format=json&units=m&apiKey=${this.apiKey}`;

    logger.info(`Fetching current weather for station: ${stationCode}`);

    try {
      const data = await this.fetchJson(apiUrl);

      if (!data || data.temperature === undefined) {
        throw new Error('No temperature data in API response');
      }

      const duration = Date.now() - startTime;
      logger.info(`Current temperature fetched: ${data.temperature}°C in ${duration}ms`, {
        location,
        stationCode,
        temperature: data.temperature
      });

      return {
        celsius: data.temperature,
        fahrenheit: this.celsiusToFahrenheit(data.temperature),
        feels_like_c: data.temperatureFeelsLike,
        feels_like_f: this.celsiusToFahrenheit(data.temperatureFeelsLike),
        humidity_percent: data.relativeHumidity,
        wind_speed_kmh: data.windSpeed,
        wind_direction: data.windDirectionCardinal,
        condition: data.wxPhraseLong,
        uv_index: data.uvIndex,
        visibility_km: data.visibility,
        pressure_hpa: data.pressureMeanSeaLevel,
        timestamp: data.validTimeLocal
      };

    } catch (error) {
      logger.error(`Failed to fetch current temperature for ${location}`, {
        error: error.message,
        stationCode
      });
      throw error;
    }
  }

  /**
   * Fetch historical weather data for a specific date
   * @param {string} location - Location in format: country/city/station_code
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} metric - Optional specific metric to return
   */
  async scrapeWeatherData(location, date, metric = null) {
    const startTime = Date.now();
    const locationParts = location.split('/');
    const countryCode = locationParts[0]?.toUpperCase() || '';
    const stationCode = locationParts[2]?.toUpperCase() || '';

    if (!stationCode) {
      throw new Error('Invalid location format. Expected: country/city/STATION_CODE');
    }

    // Format date as YYYYMMDD
    const dateFormatted = date.replace(/-/g, '');

    const apiUrl = `${this.baseApiUrl}/v1/location/${stationCode}:9:${countryCode}/observations/historical.json?apiKey=${this.apiKey}&startDate=${dateFormatted}&endDate=${dateFormatted}&units=m`;

    logger.info(`Fetching historical weather for ${stationCode} on ${date}`);

    try {
      const data = await this.fetchJson(apiUrl);

      if (!data || !data.observations || data.observations.length === 0) {
        throw new Error('No historical data available for this date');
      }

      const formattedData = this.formatApiResponse(data, location, date);
      const duration = Date.now() - startTime;

      logger.info(`Historical data fetched in ${duration}ms`, {
        location,
        date,
        dataPoints: data.observations.length
      });

      return metric ? this.filterByMetric(formattedData, metric) : formattedData;

    } catch (error) {
      logger.error(`Failed to fetch historical data for ${location} on ${date}`, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Alias for scrapeWeatherData for backward compatibility
   */
  async scrapeWeatherDataWithFallback(location, date, metric = null) {
    return this.scrapeWeatherData(location, date, metric);
  }

  /**
   * Format Weather.com API response into our standard format
   */
  formatApiResponse(apiData, location, date) {
    const locationParts = location.split('/');
    const observations = apiData.observations || [];

    // Get timezone for this location
    const timezone = this.getTimezoneForLocation(locationParts[0], locationParts[2]);

    // Extract all temperatures, wind speeds, etc.
    const temps = observations.map(o => o.temp).filter(t => t !== null && t !== undefined);
    const winds = observations.map(o => o.wspd).filter(w => w !== null && w !== undefined);
    const humidities = observations.map(o => o.rh).filter(h => h !== null && h !== undefined);

    // Get the latest observation
    const latest = observations[observations.length - 1] || {};

    return {
      location: {
        city: this.capitalizeWords(locationParts[1]?.replace(/-/g, ' ') || ''),
        country: this.getCountryName(locationParts[0] || ''),
        station: locationParts[2] || '',
        station_name: latest.obs_name || '',
        timezone: timezone,
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
        time: this.formatLocalTime(obs.valid_time_gmt, timezone),
        temperature_c: obs.temp,
        humidity_percent: obs.rh,
        wind_speed_kmh: obs.wspd,
        condition: obs.wx_phrase
      }))
    };
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
              time: h.time,
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
            daily_total: response.daily.precipitation_total
          }
        };
      case 'wind':
        return {
          location: response.location,
          date: response.date,
          wind: {
            current: response.current.wind,
            daily: response.daily.wind
          }
        };
      default:
        return response;
    }
  }

  /**
   * Format Unix timestamp to local time string
   */
  formatLocalTime(unixTimestamp, timezone = 'UTC') {
    const date = new Date(unixTimestamp * 1000);
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone
    });
    return formatter.format(date);
  }

  /**
   * Get timezone for a location
   */
  getTimezoneForLocation(countryCode, stationCode) {
    const timezones = {
      'gb': 'Europe/London',
      'uk': 'Europe/London',
      'us': 'America/New_York',
      'kr': 'Asia/Seoul',
      'jp': 'Asia/Tokyo',
      'de': 'Europe/Berlin',
      'fr': 'Europe/Paris',
      'au': 'Australia/Sydney'
    };
    return timezones[countryCode?.toLowerCase()] || 'UTC';
  }

  // Utility methods
  celsiusToFahrenheit(celsius) {
    if (celsius === null || celsius === undefined) return null;
    return Math.round((celsius * 9 / 5 + 32) * 10) / 10;
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

  // No-op methods for backward compatibility
  async init() {
    logger.info('WeatherScraper initialized (HTTP mode - no browser needed)');
  }

  async close() {
    // No browser to close
  }
}

// Export singleton instance
export const scraper = new WeatherScraper();
export default scraper;
