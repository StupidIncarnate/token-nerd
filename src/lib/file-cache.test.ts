import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileCache, tokenCountCache, messageCountCache, sessionMetadataCache } from './file-cache';

describe('FileCache', () => {
  let tempDir: string;
  let testFilePath: string;
  let cache: FileCache<string>;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'file-cache-test-'));
    testFilePath = path.join(tempDir, 'test-file.txt');
    cache = new FileCache<string>();
  });

  afterEach(async () => {
    cache.clear();
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('basic functionality', () => {
    it('should compute value when file does not exist in cache', async () => {
      await fs.promises.writeFile(testFilePath, 'test content');
      
      const computeFn = jest.fn().mockResolvedValue('computed value');
      
      const result = await cache.get({
        key: 'test-key',
        filePath: testFilePath,
        computeFn
      });
      
      expect(result).toBe('computed value');
      expect(computeFn).toHaveBeenCalledTimes(1);
    });

    it('should return cached value when file has not changed', async () => {
      await fs.promises.writeFile(testFilePath, 'test content');
      
      const computeFn = jest.fn().mockResolvedValue('computed value');
      
      // First call - should compute
      const result1 = await cache.get({
        key: 'test-key',
        filePath: testFilePath,
        computeFn
      });
      
      // Second call - should use cache
      const result2 = await cache.get({
        key: 'test-key',
        filePath: testFilePath,
        computeFn
      });
      
      expect(result1).toBe('computed value');
      expect(result2).toBe('computed value');
      expect(computeFn).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should recompute value when file has changed', async () => {
      await fs.promises.writeFile(testFilePath, 'initial content');
      
      const computeFn = jest.fn()
        .mockResolvedValueOnce('first value')
        .mockResolvedValueOnce('second value');
      
      // First call
      const result1 = await cache.get({
        key: 'test-key',
        filePath: testFilePath,
        computeFn
      });
      
      // Wait a bit and modify file to change mtime
      await new Promise(resolve => setTimeout(resolve, 10));
      await fs.promises.writeFile(testFilePath, 'modified content');
      
      // Second call - should recompute because mtime changed
      const result2 = await cache.get({
        key: 'test-key',
        filePath: testFilePath,
        computeFn
      });
      
      expect(result1).toBe('first value');
      expect(result2).toBe('second value');
      expect(computeFn).toHaveBeenCalledTimes(2);
    });

    it('should handle different keys independently', async () => {
      await fs.promises.writeFile(testFilePath, 'test content');
      
      const computeFn1 = jest.fn().mockResolvedValue('value 1');
      const computeFn2 = jest.fn().mockResolvedValue('value 2');
      
      const result1 = await cache.get({
        key: 'key-1',
        filePath: testFilePath,
        computeFn: computeFn1
      });
      
      const result2 = await cache.get({
        key: 'key-2',
        filePath: testFilePath,
        computeFn: computeFn2
      });
      
      expect(result1).toBe('value 1');
      expect(result2).toBe('value 2');
      expect(computeFn1).toHaveBeenCalledTimes(1);
      expect(computeFn2).toHaveBeenCalledTimes(1);
    });
  });

  describe('file handling edge cases', () => {
    it('should compute without caching when file does not exist', async () => {
      const computeFn = jest.fn().mockResolvedValue('fallback value');
      
      const result = await cache.get({
        key: 'test-key',
        filePath: '/nonexistent/file.txt',
        computeFn
      });
      
      expect(result).toBe('fallback value');
      expect(computeFn).toHaveBeenCalledTimes(1);
      
      // Should still compute on second call since file doesn't exist
      const result2 = await cache.get({
        key: 'test-key',
        filePath: '/nonexistent/file.txt',
        computeFn
      });
      
      expect(result2).toBe('fallback value');
      expect(computeFn).toHaveBeenCalledTimes(2);
    });

    it('should handle file access errors gracefully', async () => {
      const computeFn = jest.fn().mockResolvedValue('error fallback');
      
      // Use an invalid path that should cause fs.statSync to fail
      const result = await cache.get({
        key: 'test-key',
        filePath: '\0invalid\0path',
        computeFn
      });
      
      expect(result).toBe('error fallback');
      expect(computeFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache management', () => {
    it('should support manual invalidation', async () => {
      await fs.promises.writeFile(testFilePath, 'test content');
      
      const computeFn = jest.fn()
        .mockResolvedValueOnce('first value')
        .mockResolvedValueOnce('second value');
      
      // First call
      const result1 = await cache.get({
        key: 'test-key',
        filePath: testFilePath,
        computeFn
      });
      
      // Invalidate cache
      cache.invalidate({ key: 'test-key' });
      
      // Second call - should recompute because cache was invalidated
      const result2 = await cache.get({
        key: 'test-key',
        filePath: testFilePath,
        computeFn
      });
      
      expect(result1).toBe('first value');
      expect(result2).toBe('second value');
      expect(computeFn).toHaveBeenCalledTimes(2);
    });

    it('should support clearing entire cache', async () => {
      await fs.promises.writeFile(testFilePath, 'test content');
      
      const computeFn = jest.fn()
        .mockResolvedValueOnce('first value')
        .mockResolvedValueOnce('second value');
      
      // First call
      await cache.get({
        key: 'test-key',
        filePath: testFilePath,
        computeFn
      });
      
      expect(cache.getStats().size).toBe(1);
      
      // Clear entire cache
      cache.clear();
      
      expect(cache.getStats().size).toBe(0);
      
      // Second call - should recompute because cache was cleared
      await cache.get({
        key: 'test-key',
        filePath: testFilePath,
        computeFn
      });
      
      expect(computeFn).toHaveBeenCalledTimes(2);
    });

    it('should provide accurate cache statistics', async () => {
      await fs.promises.writeFile(testFilePath, 'test content');
      
      const computeFn = jest.fn().mockResolvedValue('test value');
      
      // Initially empty
      expect(cache.getStats()).toEqual({ size: 0, keys: [] });
      
      // Add first entry
      await cache.get({
        key: 'key-1',
        filePath: testFilePath,
        computeFn
      });
      
      expect(cache.getStats()).toEqual({ 
        size: 1, 
        keys: ['key-1'] 
      });
      
      // Add second entry
      await cache.get({
        key: 'key-2',
        filePath: testFilePath,
        computeFn
      });
      
      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain('key-1');
      expect(stats.keys).toContain('key-2');
    });
  });

  describe('async computeFn support', () => {
    it('should support synchronous compute functions', async () => {
      await fs.promises.writeFile(testFilePath, 'test content');
      
      const syncComputeFn = jest.fn().mockReturnValue('sync value');
      
      const result = await cache.get({
        key: 'test-key',
        filePath: testFilePath,
        computeFn: syncComputeFn
      });
      
      expect(result).toBe('sync value');
      expect(syncComputeFn).toHaveBeenCalledTimes(1);
    });

    it('should support asynchronous compute functions', async () => {
      await fs.promises.writeFile(testFilePath, 'test content');
      
      const asyncComputeFn = jest.fn().mockResolvedValue('async value');
      
      const result = await cache.get({
        key: 'test-key',
        filePath: testFilePath,
        computeFn: asyncComputeFn
      });
      
      expect(result).toBe('async value');
      expect(asyncComputeFn).toHaveBeenCalledTimes(1);
    });

    it('should handle compute function errors', async () => {
      await fs.promises.writeFile(testFilePath, 'test content');
      
      const errorComputeFn = jest.fn().mockRejectedValue(new Error('Compute failed'));
      
      await expect(cache.get({
        key: 'test-key',
        filePath: testFilePath,
        computeFn: errorComputeFn
      })).rejects.toThrow('Compute failed');
    });
  });

  describe('type safety', () => {
    it('should work with different value types', async () => {
      await fs.promises.writeFile(testFilePath, 'test content');
      
      const numberCache = new FileCache<number>();
      const objectCache = new FileCache<{ value: string }>();
      
      const numberResult = await numberCache.get({
        key: 'number-key',
        filePath: testFilePath,
        computeFn: () => 42
      });
      
      const objectResult = await objectCache.get({
        key: 'object-key',
        filePath: testFilePath,
        computeFn: () => ({ value: 'test' })
      });
      
      expect(numberResult).toBe(42);
      expect(objectResult).toEqual({ value: 'test' });
    });
  });
});

describe('Global cache instances', () => {
  afterEach(() => {
    // Clean up global caches after each test
    tokenCountCache.clear();
    messageCountCache.clear();
    sessionMetadataCache.clear();
  });

  it('should have separate global cache instances', () => {
    expect(tokenCountCache).toBeInstanceOf(FileCache);
    expect(messageCountCache).toBeInstanceOf(FileCache);
    expect(sessionMetadataCache).toBeInstanceOf(FileCache);
    
    expect(tokenCountCache).not.toBe(messageCountCache);
    expect(messageCountCache).not.toBe(sessionMetadataCache);
    expect(tokenCountCache).not.toBe(sessionMetadataCache);
  });

  it('should maintain independent state across global caches', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'global-cache-test-'));
    const testFile = path.join(tempDir, 'test.jsonl');
    
    try {
      await fs.promises.writeFile(testFile, 'test content');
      
      await tokenCountCache.get({
        key: 'test',
        filePath: testFile,
        computeFn: () => 100
      });
      
      await messageCountCache.get({
        key: 'test',
        filePath: testFile,
        computeFn: () => 5
      });
      
      expect(tokenCountCache.getStats().size).toBe(1);
      expect(messageCountCache.getStats().size).toBe(1);
      
      tokenCountCache.clear();
      
      expect(tokenCountCache.getStats().size).toBe(0);
      expect(messageCountCache.getStats().size).toBe(1); // Should remain unchanged
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
});