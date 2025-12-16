import { logger } from '../utils/logger.js';

/**
 * Simple in-memory cache with TTL support
 * For production, consider using Redis
 */
class CacheService {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 60 * 60 * 1000; // 1 hour in milliseconds
    
    // Cleanup expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Generate cache key for weather data
   * @param {string} location - Location string
   * @param {string} date - Date string
   */
  generateKey(location, date) {
    return `weather:${location}:${date}`;
  }

  /**
   * Get item from cache
   * @param {string} key - Cache key
   * @returns {object|null} Cached data or null if not found/expired
   */
  get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      logger.debug(`Cache miss: ${key}`);
      return null;
    }

    // Check if expired
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      logger.debug(`Cache expired: ${key}`);
      return null;
    }

    logger.debug(`Cache hit: ${key}`);
    return item.data;
  }

  /**
   * Set item in cache
   * @param {string} key - Cache key
   * @param {any} data - Data to cache
   * @param {number} ttl - Time to live in milliseconds (optional)
   */
  set(key, data, ttl = this.defaultTTL) {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now()
    });
    logger.debug(`Cache set: ${key}, TTL: ${ttl}ms`);
  }

  /**
   * Delete item from cache
   * @param {string} key - Cache key
   */
  delete(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      logger.debug(`Cache deleted: ${key}`);
    }
    return deleted;
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
    logger.info('Cache cleared');
  }

  /**
   * Get cache statistics
   */
  stats() {
    let validEntries = 0;
    let expiredEntries = 0;
    const now = Date.now();

    for (const [key, item] of this.cache) {
      if (now > item.expiresAt) {
        expiredEntries++;
      } else {
        validEntries++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries
    };
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, item] of this.cache) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cache cleanup: removed ${cleaned} expired entries`);
    }
  }

  /**
   * Stop the cleanup interval
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Export singleton instance
export const cache = new CacheService();
export default cache;

