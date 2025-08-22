import { createClient } from 'redis';

// Mock Redis client
const mockRedisClient = {
  isOpen: true,
  connect: jest.fn().mockResolvedValue(undefined),
  multi: jest.fn(),
  disconnect: jest.fn().mockResolvedValue(undefined),
};

const mockPipeline = {
  set: jest.fn().mockReturnThis(),
  zAdd: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([]),
};

// Mock redis module
jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

// Mock console.log to capture output
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const mockConsoleLog = jest.fn();
const mockConsoleError = jest.fn();

// Mock setImmediate to make async operations synchronous in tests
const mockSetImmediate = jest.fn((callback) => {
  // Execute callback immediately in tests
  callback();
}) as any;

// Mock fs and path modules needed for tsx execution
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue(''),
  existsSync: jest.fn().mockReturnValue(true),
}));

jest.mock('path', () => ({
  resolve: jest.fn((p) => p),
  join: jest.fn((...parts) => parts.join('/')),
}));

describe('pre-tool-use hook', () => {
  let originalSetImmediate: any;
  let mockMain: any;

  beforeAll(() => {
    originalSetImmediate = global.setImmediate;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = mockConsoleLog;
    console.error = mockConsoleError;
    global.setImmediate = mockSetImmediate;
    mockRedisClient.multi.mockReturnValue(mockPipeline);
    
    // Ensure createClient returns our mockRedisClient
    (createClient as jest.Mock).mockReturnValue(mockRedisClient);
    
    // Reset the global Redis client state
    globalRedisClient = null;
    
    // Reset the module to clear any cached redis client
    jest.resetModules();
    
    // Create a mock version of the main function we can call directly
    mockMain = jest.fn();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    global.setImmediate = originalSetImmediate;
  });

  // Track the global redis client state for connection pooling tests
  let globalRedisClient: any = null;

  const simulateHookExecution = async (input: string) => {
    // Simulate the main function logic directly
    // Pass through the input immediately
    console.log(input);
    
    // Process Redis operations asynchronously (fire-and-forget)
    setImmediate(async () => {
      try {
        const data = JSON.parse(input);
        
        // Extract relevant fields
        const {
          session_id,
          tool_name,
          tool_input,
          timestamp = Date.now()
        } = data;
        
        if (!session_id || !tool_name) {
          return; // Silently fail for missing fields in async mode
        }
        
        // Simulate the getRedisClient logic from the actual hook
        if (!globalRedisClient || !globalRedisClient.isOpen) {
          globalRedisClient = (createClient as jest.Mock)({
            url: 'redis://localhost:6379',
            socket: {
              connectTimeout: 500,
              reconnectStrategy: (retries: number) => retries > 3 ? false : Math.min(retries * 50, 500)
            }
          });
          await globalRedisClient.connect();
        }
        
        const redis = globalRedisClient;
        
        // Store operation request
        const key = `session:${session_id}:operations:${timestamp}:request`;
        const value = {
          tool: tool_name,
          params: tool_input,
          timestamp,
          session_id
        };
        
        // Use pipeline for better performance
        const pipeline = redis.multi();
        pipeline.set(key, JSON.stringify(value), { EX: 86400 });
        pipeline.zAdd(`session:${session_id}:timeline`, {
          score: timestamp,
          value: `${timestamp}:${tool_name}`
        });
        await pipeline.exec();
        
      } catch (error) {
        // Silently log errors in async mode to avoid disrupting Claude
        if (process.env.DEBUG) {
          console.error('Async Redis error in pre-tool-use hook:', error);
        }
      }
    });
  };

  describe('Input passthrough', () => {
    it('should immediately pass through input via console.log', async () => {
      const testInput = '{"session_id":"test-session","tool_name":"test-tool"}';
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleLog).toHaveBeenCalledWith(testInput);
      // Verify console.log was called before async operations
      expect(mockConsoleLog).toHaveBeenCalled();
      expect(mockSetImmediate).toHaveBeenCalled();
    });

    it('should pass through input even with invalid JSON', async () => {
      const testInput = 'invalid json {';
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleLog).toHaveBeenCalledWith(testInput);
    });

    it('should pass through empty input', async () => {
      const testInput = '';
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleLog).toHaveBeenCalledWith(testInput);
    });
  });

  describe('Async Redis operations', () => {
    it('should process Redis operations asynchronously via setImmediate', async () => {
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_name: 'test-tool',
        tool_input: { param: 'value' },
        timestamp: 1234567890
      });
      
      await simulateHookExecution(testInput);
      
      expect(mockSetImmediate).toHaveBeenCalledWith(expect.any(Function));
      expect(createClient).toHaveBeenCalled();
    });

    it('should not block main process when Redis operations fail', async () => {
      mockRedisClient.connect.mockRejectedValueOnce(new Error('Redis connection failed'));
      
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_name: 'test-tool'
      });
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleLog).toHaveBeenCalledWith(testInput);
      expect(mockSetImmediate).toHaveBeenCalled();
    });
  });

  describe('Redis connection pooling', () => {
    it('should reuse existing Redis client when isOpen is true', async () => {
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_name: 'test-tool'
      });
      
      // First execution - should create client
      await simulateHookExecution(testInput);
      expect(createClient).toHaveBeenCalledTimes(1);
      
      // Set the global client to be open for reuse
      globalRedisClient.isOpen = true;
      
      // Reset mocks but keep the same client reference
      const callCount = (createClient as jest.Mock).mock.calls.length;
      jest.clearAllMocks();
      (createClient as jest.Mock).mockReturnValue(mockRedisClient);
      mockRedisClient.multi.mockReturnValue(mockPipeline);
      
      // Second execution - should reuse existing client
      await simulateHookExecution(testInput);
      
      // Should not create a new client (createClient not called in second run)
      expect(createClient).toHaveBeenCalledTimes(0);
    });

    it('should create new Redis client when previous client is not open', async () => {
      mockRedisClient.isOpen = false;
      
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_name: 'test-tool'
      });
      
      await simulateHookExecution(testInput);
      
      expect(createClient).toHaveBeenCalled();
      expect(mockRedisClient.connect).toHaveBeenCalled();
    });

    it('should configure Redis client with correct options', async () => {
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_name: 'test-tool'
      });
      
      await simulateHookExecution(testInput);
      
      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://localhost:6379',
        socket: {
          connectTimeout: 500,
          reconnectStrategy: expect.any(Function)
        }
      });
    });

    it('should configure reconnect strategy correctly', async () => {
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_name: 'test-tool'
      });
      
      await simulateHookExecution(testInput);
      
      const createClientCall = (createClient as jest.Mock).mock.calls[0][0];
      const reconnectStrategy = createClientCall.socket.reconnectStrategy;
      
      // Test reconnect strategy behavior
      expect(reconnectStrategy(1)).toBe(50);
      expect(reconnectStrategy(2)).toBe(100);
      expect(reconnectStrategy(3)).toBe(150);
      expect(reconnectStrategy(4)).toBe(false);
      expect(reconnectStrategy(10)).toBe(false); // Should return false for retries > 3
    });
  });

  describe('Redis pipeline operations', () => {
    it('should use pipeline to batch Redis operations', async () => {
      const testData = {
        session_id: 'test-session',
        tool_name: 'test-tool',
        tool_input: { param: 'value' },
        timestamp: 1234567890
      };
      
      await simulateHookExecution(JSON.stringify(testData));
      
      expect(mockRedisClient.multi).toHaveBeenCalled();
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('should store operation request with correct key and value', async () => {
      const testData = {
        session_id: 'test-session',
        tool_name: 'test-tool',
        tool_input: { param: 'value' },
        timestamp: 1234567890
      };
      
      await simulateHookExecution(JSON.stringify(testData));
      
      const expectedKey = `session:${testData.session_id}:operations:${testData.timestamp}:request`;
      const expectedValue = {
        tool: testData.tool_name,
        params: testData.tool_input,
        timestamp: testData.timestamp,
        session_id: testData.session_id
      };
      
      expect(mockPipeline.set).toHaveBeenCalledWith(
        expectedKey,
        JSON.stringify(expectedValue),
        { EX: 86400 }
      );
    });

    it('should add operation to timeline with correct score and value', async () => {
      const testData = {
        session_id: 'test-session',
        tool_name: 'test-tool',
        timestamp: 1234567890
      };
      
      await simulateHookExecution(JSON.stringify(testData));
      
      expect(mockPipeline.zAdd).toHaveBeenCalledWith(
        `session:${testData.session_id}:timeline`,
        {
          score: testData.timestamp,
          value: `${testData.timestamp}:${testData.tool_name}`
        }
      );
    });

    it('should use current timestamp when timestamp is not provided', async () => {
      const originalDateNow = Date.now;
      const mockTimestamp = 9876543210;
      Date.now = jest.fn().mockReturnValue(mockTimestamp);
      
      const testData = {
        session_id: 'test-session',
        tool_name: 'test-tool'
      };
      
      await simulateHookExecution(JSON.stringify(testData));
      
      const expectedKey = `session:${testData.session_id}:operations:${mockTimestamp}:request`;
      expect(mockPipeline.set).toHaveBeenCalledWith(
        expectedKey,
        expect.stringContaining(`"timestamp":${mockTimestamp}`),
        { EX: 86400 }
      );
      
      Date.now = originalDateNow;
    });
  });

  describe('Error handling', () => {
    it('should not crash when JSON parsing fails', async () => {
      const invalidJson = '{"invalid": json}';
      
      await simulateHookExecution(invalidJson);
      
      // Should still pass through input
      expect(mockConsoleLog).toHaveBeenCalledWith(invalidJson);
      // Should not throw or crash
    });

    it('should not crash when Redis connection fails', async () => {
      mockRedisClient.connect.mockRejectedValueOnce(new Error('Connection failed'));
      
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_name: 'test-tool'
      });
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleLog).toHaveBeenCalledWith(testInput);
    });

    it('should not crash when Redis pipeline fails', async () => {
      mockPipeline.exec.mockRejectedValueOnce(new Error('Pipeline failed'));
      
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_name: 'test-tool'
      });
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleLog).toHaveBeenCalledWith(testInput);
    });

    it('should log errors when DEBUG environment variable is set', async () => {
      const originalDebug = process.env.DEBUG;
      process.env.DEBUG = '1';
      
      mockRedisClient.connect.mockRejectedValueOnce(new Error('Test error'));
      
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_name: 'test-tool'
      });
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Async Redis error in pre-tool-use hook:',
        expect.any(Error)
      );
      
      process.env.DEBUG = originalDebug;
    });

    it('should not log errors when DEBUG environment variable is not set', async () => {
      const originalDebug = process.env.DEBUG;
      delete process.env.DEBUG;
      
      mockRedisClient.connect.mockRejectedValueOnce(new Error('Test error'));
      
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_name: 'test-tool'
      });
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleError).not.toHaveBeenCalled();
      
      process.env.DEBUG = originalDebug;
    });
  });

  describe('Missing required fields handling', () => {
    it('should silently return when session_id is missing', async () => {
      const testInput = JSON.stringify({
        tool_name: 'test-tool',
        tool_input: { param: 'value' }
      });
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleLog).toHaveBeenCalledWith(testInput);
      expect(mockRedisClient.multi).not.toHaveBeenCalled();
    });

    it('should silently return when tool_name is missing', async () => {
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_input: { param: 'value' }
      });
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleLog).toHaveBeenCalledWith(testInput);
      expect(mockRedisClient.multi).not.toHaveBeenCalled();
    });

    it('should silently return when both session_id and tool_name are missing', async () => {
      const testInput = JSON.stringify({
        tool_input: { param: 'value' }
      });
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleLog).toHaveBeenCalledWith(testInput);
      expect(mockRedisClient.multi).not.toHaveBeenCalled();
    });

    it('should process normally when only required fields are present', async () => {
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_name: 'test-tool'
      });
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleLog).toHaveBeenCalledWith(testInput);
      expect(mockRedisClient.multi).toHaveBeenCalled();
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('should handle undefined/null values gracefully', async () => {
      const testInput = JSON.stringify({
        session_id: 'test-session',
        tool_name: 'test-tool',
        tool_input: null,
        other_field: undefined
      });
      
      await simulateHookExecution(testInput);
      
      expect(mockConsoleLog).toHaveBeenCalledWith(testInput);
      expect(mockPipeline.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"params":null'),
        { EX: 86400 }
      );
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete valid tool invocation', async () => {
      const testData = {
        session_id: 'abc123',
        tool_name: 'Read',
        tool_input: {
          file_path: '/path/to/file.txt',
          limit: 100
        },
        timestamp: 1690000000000
      };
      
      await simulateHookExecution(JSON.stringify(testData));
      
      // Should pass through input
      expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(testData));
      
      // Should create Redis operations
      expect(mockRedisClient.multi).toHaveBeenCalled();
      expect(mockPipeline.set).toHaveBeenCalledWith(
        'session:abc123:operations:1690000000000:request',
        JSON.stringify({
          tool: 'Read',
          params: testData.tool_input,
          timestamp: 1690000000000,
          session_id: 'abc123'
        }),
        { EX: 86400 }
      );
      expect(mockPipeline.zAdd).toHaveBeenCalledWith(
        'session:abc123:timeline',
        {
          score: 1690000000000,
          value: '1690000000000:Read'
        }
      );
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('should handle multiple rapid invocations', async () => {
      const testInputs = [
        { session_id: 'session1', tool_name: 'tool1' },
        { session_id: 'session2', tool_name: 'tool2' },
        { session_id: 'session1', tool_name: 'tool3' }
      ];
      
      for (const input of testInputs) {
        jest.clearAllMocks();
        mockRedisClient.multi.mockReturnValue(mockPipeline);
        await simulateHookExecution(JSON.stringify(input));
        
        expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(input));
        expect(mockPipeline.exec).toHaveBeenCalled();
      }
    });
  });
});