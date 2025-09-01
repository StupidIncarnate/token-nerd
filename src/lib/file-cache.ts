import * as fs from 'fs';

/**
 * Simple file-based cache with mtime invalidation
 * Prevents redundant file reads for session metadata
 */
export class FileCache<T> {
  private cache = new Map<string, { value: T; mtime: number }>();

  /**
   * Get cached value if file hasn't changed, otherwise compute new value
   */
  async get({ 
    key, 
    filePath, 
    computeFn 
  }: { 
    key: string; 
    filePath: string; 
    computeFn: () => Promise<T> | T;
  }): Promise<T> {
    try {
      const stats = fs.statSync(filePath);
      const currentMtime = stats.mtimeMs;
      
      const cached = this.cache.get(key);
      
      // Return cached value if file hasn't changed
      if (cached && cached.mtime === currentMtime) {
        return cached.value;
      }
      
      // Compute new value and cache it
      const newValue = await computeFn();
      this.cache.set(key, { value: newValue, mtime: currentMtime });
      
      return newValue;
    } catch (error) {
      // If file doesn't exist or can't be accessed, compute without caching
      return await computeFn();
    }
  }

  /**
   * Invalidate cache entry for a specific key
   */
  invalidate({ key }: { key: string }): void {
    this.cache.delete(key);
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

// Global cache instances for different data types
export const tokenCountCache = new FileCache<number>();
export const messageCountCache = new FileCache<number>();
export const sessionMetadataCache = new FileCache<{
  tokens: number;
  messageCount: number;
  lastMessage: any;
}>();