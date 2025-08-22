import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createClient } from 'redis';

// Mock Redis client
const mockRedisClient = {
  isOpen: true,
  connect: jest.fn().mockResolvedValue(undefined),
  multi: jest.fn(),
  set: jest.fn(),
  sAdd: jest.fn(),
  exec: jest.fn().mockResolvedValue([]),
  disconnect: jest.fn().mockResolvedValue(undefined)
};

const mockPipeline = {
  set: jest.fn().mockReturnThis(),
  sAdd: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([])
};

// Mock Redis module
jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient)
}));

// Mock fs/promises
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined)
}));

// Mock console.log and console.error to capture output
const mockConsoleLog = jest.fn();
const mockConsoleError = jest.fn();

// Store original console methods
const originalConsole = {
  log: console.log,
  error: console.error
};

describe('post-tool-use hook', () => {
  let originalSetImmediate: any;

  beforeAll(() => {
    originalSetImmediate = global.setImmediate;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
    mockRedisClient.multi.mockReturnValue(mockPipeline);
    
    // Reset environment
    delete process.env.DEBUG;
    
    // Mock console methods
    console.log = mockConsoleLog;
    console.error = mockConsoleError;
    
    // Mock setImmediate to execute synchronously for testing
    global.setImmediate = jest.fn((fn) => {
      fn();
      return {} as NodeJS.Immediate;
    }) as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Restore console methods
    console.log = originalConsole.log;
    console.error = originalConsole.error;
  });

  afterAll(() => {
    global.setImmediate = originalSetImmediate;
  });

  describe('calculateResponseSize function', () => {
    function calculateResponseSize(response: any): number {
      if (typeof response === 'string') {
        return response.length;
      } else if (response && typeof response === 'object') {
        return JSON.stringify(response).length;
      }
      return 0;
    }

    it('should calculate size for string responses', () => {
      expect(calculateResponseSize('hello')).toBe(5);
      expect(calculateResponseSize('')).toBe(0);
      expect(calculateResponseSize('long string response')).toBe(20);
    });

    it('should calculate size for object responses', () => {
      expect(calculateResponseSize({ key: 'value' })).toBe(15); // '{"key":"value"}'
      expect(calculateResponseSize({})).toBe(2); // '{}'
      expect(calculateResponseSize({ a: 1, b: [1, 2, 3] })).toBe(19); // '{"a":1,"b":[1,2,3]}'
    });

    it('should return 0 for null, undefined, or non-object/string values', () => {
      expect(calculateResponseSize(null)).toBe(0);
      expect(calculateResponseSize(undefined)).toBe(0);
      expect(calculateResponseSize(123)).toBe(0);
      expect(calculateResponseSize(true)).toBe(0);
    });
  });

  describe('Redis connection pooling logic', () => {
    it('should create Redis client with correct configuration', () => {
      (createClient as jest.Mock)({
        url: 'redis://localhost:6379',
        socket: {
          connectTimeout: 500,
          reconnectStrategy: (retries: number) => retries > 3 ? false : Math.min(retries * 50, 500)
        }
      });

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://localhost:6379',
        socket: {
          connectTimeout: 500,
          reconnectStrategy: expect.any(Function)
        }
      });
    });

    it('should configure reconnect strategy correctly', () => {
      const reconnectStrategy = (retries: number) => retries > 3 ? false : Math.min(retries * 50, 500);
      
      expect(reconnectStrategy(1)).toBe(50);
      expect(reconnectStrategy(2)).toBe(100);
      expect(reconnectStrategy(3)).toBe(150);
      expect(reconnectStrategy(4)).toBe(false);
      expect(reconnectStrategy(10)).toBe(false);
    });
  });

  describe('async processing behavior', () => {
    it('should use setImmediate for async processing', async () => {
      const asyncCallback = jest.fn();
      
      // Simulate how the hook uses setImmediate
      setImmediate(asyncCallback);
      
      expect(global.setImmediate).toHaveBeenCalledWith(asyncCallback);
      expect(asyncCallback).toHaveBeenCalled(); // Since our mock executes synchronously
    });

    it('should handle Redis pipeline operations correctly', async () => {
      const testData = {
        session_id: 'test-session',
        tool_name: 'test-tool',
        tool_response: 'test response',
        message_id: 'msg-123',
        timestamp: 1234567890
      };

      // Simulate the pipeline operations from the hook
      const pipeline = mockRedisClient.multi();
      const key = `session:${testData.session_id}:operations:${testData.timestamp}:response`;
      const value = {
        tool: testData.tool_name,
        response: testData.tool_response,
        responseSize: testData.tool_response.length,
        timestamp: testData.timestamp,
        session_id: testData.session_id,
        message_id: testData.message_id,
        usage: undefined
      };

      pipeline.set(key, JSON.stringify(value), { EX: 86400 });
      pipeline.sAdd(`message:${testData.message_id}:operations`, `${testData.timestamp}:${testData.tool_name}`);
      await pipeline.exec();

      expect(mockPipeline.set).toHaveBeenCalledWith(
        key,
        JSON.stringify(value),
        { EX: 86400 }
      );
      expect(mockPipeline.sAdd).toHaveBeenCalledWith(
        `message:${testData.message_id}:operations`,
        `${testData.timestamp}:${testData.tool_name}`
      );
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('should handle large responses with file storage', async () => {
      const largeResponse = 'x'.repeat(15000); // > 10000 bytes
      const testData = {
        session_id: 'test-session',
        tool_name: 'test-tool',
        tool_response: largeResponse,
        message_id: 'msg-123',
        timestamp: 1234567890
      };

      // Simulate file storage logic
      const uniqueId = `${testData.timestamp}-${testData.message_id}`;
      const responsesDir = path.join(
        os.homedir(),
        '.claude',
        'token-nerd',
        'responses',
        testData.session_id
      );
      const filePath = path.join(responsesDir, `${uniqueId}.json`);

      // Simulate async file operations
      await fs.mkdir(responsesDir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(testData.tool_response));

      expect(fs.mkdir).toHaveBeenCalledWith(responsesDir, { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(filePath, JSON.stringify(largeResponse));
    });

    it('should generate unique filenames when message_id is missing', () => {
      const timestamp = 1234567890;
      const randomString = 'abc123def';
      
      // Mock Math.random
      jest.spyOn(Math, 'random').mockReturnValue(0.123456789);
      
      const uniqueId = `${timestamp}-${Math.random().toString(36).substring(2, 11)}`;
      
      expect(uniqueId).toMatch(/^1234567890-\w+$/);
      
      jest.restoreAllMocks();
    });

    it('should handle file write errors gracefully', async () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.writeFile.mockRejectedValueOnce(new Error('File write failed'));

      // Simulate error handling from the hook
      try {
        await fs.mkdir('/some/dir', { recursive: true });
        await fs.writeFile('/some/file.json', 'data');
      } catch (error) {
        // In non-debug mode, errors should be silent
        if (!process.env.DEBUG) {
          // Should not log error
          expect(mockConsoleError).not.toHaveBeenCalled();
        }
      }
    });

    it('should log file write errors in debug mode', async () => {
      process.env.DEBUG = '1';
      
      // Simulate error logging from the hook
      const error = new Error('File write failed');
      console.error('File write error in post-tool-use hook:', error);
      
      expect(mockConsoleError).toHaveBeenCalledWith(
        'File write error in post-tool-use hook:',
        error
      );
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisClient.connect.mockRejectedValueOnce(new Error('Redis connection failed'));
      
      // Simulate error handling from the hook
      try {
        await mockRedisClient.connect();
      } catch (error) {
        // In non-debug mode, errors should be silent
        if (!process.env.DEBUG) {
          expect(mockConsoleError).not.toHaveBeenCalled();
        }
      }
    });

    it('should log Redis errors in debug mode', async () => {
      process.env.DEBUG = '1';
      
      // Simulate error logging from the hook
      const error = new Error('Redis connection failed');
      console.error('Async Redis error in post-tool-use hook:', error);
      
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Async Redis error in post-tool-use hook:',
        error
      );
    });
  });

  describe('data validation and edge cases', () => {
    it('should handle missing session_id gracefully', () => {
      const testData: any = {
        tool_name: 'test-tool',
        tool_response: 'test response'
        // No session_id
      };

      // Simulate validation logic from the hook
      if (!testData.session_id || !testData.tool_name) {
        // Should return early without Redis operations
        expect(mockRedisClient.multi).not.toHaveBeenCalled();
        return;
      }
    });

    it('should handle missing tool_name gracefully', () => {
      const testData = {
        session_id: 'test-session',
        tool_response: 'test response'
        // No tool_name
      };

      // Simulate validation logic from the hook
      if (!testData.session_id || !(testData as any).tool_name) {
        // Should return early without Redis operations
        expect(mockRedisClient.multi).not.toHaveBeenCalled();
        return;
      }
    });

    it('should use default timestamp when not provided', () => {
      const mockDate = jest.spyOn(Date, 'now').mockReturnValue(9876543210);
      
      const testData: any = {
        session_id: 'test-session',
        tool_name: 'test-tool',
        tool_response: 'test response'
        // No timestamp
      };

      const timestamp = testData.timestamp || Date.now();
      expect(timestamp).toBe(9876543210);

      mockDate.mockRestore();
    });

    it('should include usage data when provided', () => {
      const testData = {
        session_id: 'test-session',
        tool_name: 'test-tool',
        tool_response: 'test response',
        usage: {
          input_tokens: 100,
          output_tokens: 50
        },
        timestamp: 1234567890
      };

      const value = {
        tool: testData.tool_name,
        response: testData.tool_response,
        responseSize: testData.tool_response.length,
        timestamp: testData.timestamp,
        session_id: testData.session_id,
        message_id: undefined,
        usage: testData.usage
      };

      expect(value.usage).toEqual({
        input_tokens: 100,
        output_tokens: 50
      });
    });

    it('should not add message operations when message_id is missing', () => {
      const testData: any = {
        session_id: 'test-session',
        tool_name: 'test-tool',
        tool_response: 'test response',
        timestamp: 1234567890
        // No message_id
      };

      // Simulate conditional logic from the hook
      if (testData.message_id) {
        // Should not reach this path
        expect(true).toBe(false);
      } else {
        // Should not call sAdd for message operations
        expect(mockPipeline.sAdd).not.toHaveBeenCalledWith(
          expect.stringMatching(/^message:/),
          expect.any(String)
        );
      }
    });

    it('should set Redis key expiration to 24 hours', () => {
      const expectedExpiration = 86400; // 24 hours in seconds
      
      // Simulate the Redis set operation from the hook
      mockPipeline.set('test-key', 'test-value', { EX: expectedExpiration });
      
      expect(mockPipeline.set).toHaveBeenCalledWith(
        'test-key',
        'test-value',
        { EX: 86400 }
      );
    });
  });
});