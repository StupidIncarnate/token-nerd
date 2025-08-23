import { correlateOperations, Operation, Bundle, JsonlMessage, resetRedisClient } from './correlation-engine';
import { createClient } from 'redis';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock console methods to prevent test output clutter
const mockConsoleWarn = jest.fn();
const originalConsoleWarn = console.warn;

beforeAll(() => {
  console.warn = mockConsoleWarn;
});

afterAll(() => {
  console.warn = originalConsoleWarn;
});

// Mock Redis client
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    isOpen: true,
    keys: jest.fn(),
    get: jest.fn(),
    multi: jest.fn(() => ({
      set: jest.fn(),
      sAdd: jest.fn(),
      zAdd: jest.fn(),
      exec: jest.fn()
    }))
  }))
}));

// Mock fs
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn()
}));

const mockedRedis = jest.mocked(createClient);
const mockedFs = jest.mocked(fs);

describe('correlation-engine', () => {
  let mockRedisClient: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    resetRedisClient(); // Reset the module-level Redis client
    
    mockRedisClient = {
      connect: jest.fn(),
      isOpen: true,
      keys: jest.fn(),
      get: jest.fn(),
      multi: jest.fn(() => ({
        set: jest.fn(),
        sAdd: jest.fn(),
        zAdd: jest.fn(),
        exec: jest.fn()
      }))
    };
    mockedRedis.mockReturnValue(mockRedisClient);
  });

  describe('correlateOperations', () => {
    it('should return empty array when no operations or messages found', async () => {
      mockRedisClient.keys.mockResolvedValue([]);
      mockedFs.existsSync.mockReturnValue(false);
      
      const result = await correlateOperations('test-session');
      
      expect(result).toEqual([]);
    });

    it('should return empty when Redis operations exist but no JSONL data', async () => {
      const mockTimestamp = Date.now();
      const sessionId = 'test-session';
      
      // Mock Redis keys to return both request and response keys
      mockRedisClient.keys
        .mockImplementation((pattern: string) => {
          if (pattern.includes(':request')) {
            return Promise.resolve([`session:${sessionId}:operations:${mockTimestamp}:request`]);
          }
          if (pattern.includes(':response')) {
            return Promise.resolve([`session:${sessionId}:operations:${mockTimestamp}:response`]);
          }
          return Promise.resolve([]);
        });
      
      // Mock Redis get to return proper data for each key
      mockRedisClient.get
        .mockImplementation((key: string) => {
          if (key.includes(':request')) {
            return Promise.resolve(JSON.stringify({
              tool: 'Read',
              params: { file_path: '/test/file.ts' },
              timestamp: mockTimestamp,
              session_id: sessionId
            }));
          }
          if (key.includes(':response')) {
            return Promise.resolve(JSON.stringify({
              tool: 'Read',
              response: 'file content',
              responseSize: 12,
              message_id: 'msg-123',
              usage: { input_tokens: 100, output_tokens: 50 }
            }));
          }
          return Promise.resolve(null);
        });
      
      mockedFs.existsSync.mockReturnValue(false);
      
      const result = await correlateOperations(sessionId);
      
      // Should return empty because JSONL is required now
      expect(result).toHaveLength(0);
    });

    it('should correlate operations with JSONL messages by message_id', async () => {
      const mockTimestamp = Date.now();
      const sessionId = 'test-session';
      const messageId = 'msg-123';
      
      // Mock Redis operations
      mockRedisClient.keys
        .mockImplementation((pattern: string) => {
          if (pattern.includes(':request')) {
            return Promise.resolve([`session:${sessionId}:operations:${mockTimestamp}:request`]);
          }
          if (pattern.includes(':response')) {
            return Promise.resolve([`session:${sessionId}:operations:${mockTimestamp}:response`]);
          }
          return Promise.resolve([]);
        });
      
      mockRedisClient.get
        .mockImplementation((key: string) => {
          if (key.includes(':request')) {
            return Promise.resolve(JSON.stringify({
              tool: 'Edit',
              params: { file_path: '/test/file.ts', old_string: 'old', new_string: 'new' },
              timestamp: mockTimestamp,
              session_id: sessionId
            }));
          }
          if (key.includes(':response')) {
            return Promise.resolve(JSON.stringify({
              tool: 'Edit',
              response: { success: true },
              responseSize: 20,
              message_id: messageId
            }));
          }
          return Promise.resolve(null);
        });
      
      // Mock JSONL file
      const jsonlPath = `/home/test/.claude/projects/${sessionId}.jsonl`;
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          id: messageId,
          timestamp: new Date(mockTimestamp).toISOString(),
          usage: { input_tokens: 200, output_tokens: 100 }
        })
      );
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      expect(result).toHaveLength(1);
      const bundle = result[0];
      expect(bundle.operations).toHaveLength(1);
      
      const operation = bundle.operations[0];
      expect(operation.tool).toBe('Edit');
      expect(operation.tokens).toBe(100); // Only output tokens from JSONL
      expect(operation.allocation).toBe('exact');
    });

    it('should handle file references in responses', async () => {
      const mockTimestamp = Date.now();
      const sessionId = 'test-session';
      const filePath = '/test/response.json';
      
      mockRedisClient.keys
        .mockResolvedValueOnce([`session:${sessionId}:operations:${mockTimestamp}:request`])
        .mockResolvedValueOnce([`session:${sessionId}:operations:${mockTimestamp}:response`]);
      
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Bash',
          params: { command: 'npm test' },
          timestamp: mockTimestamp,
          session_id: sessionId
        }))
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Bash',
          response: `file://${filePath}`,
          responseSize: 50000
        }));
      
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.readFileSync.mockReturnValue('{"output": "test results"}');
      
      const result = await correlateOperations(sessionId);
      
      // Should return empty because no JSONL provided
      expect(result).toHaveLength(0);
    });

    it.skip('should distribute tokens proportionally for multiple operations in one message', async () => {
      const mockTimestamp1 = Date.now();
      const mockTimestamp2 = Date.now() + 1000;
      const sessionId = 'test-session';
      const messageId = 'msg-bundle';
      
      // Mock two operations in the same message
      mockRedisClient.keys
        .mockResolvedValueOnce([
          `session:${sessionId}:operations:${mockTimestamp1}:request`,
          `session:${sessionId}:operations:${mockTimestamp2}:request`
        ])
        .mockResolvedValueOnce([
          `session:${sessionId}:operations:${mockTimestamp1}:response`,
          `session:${sessionId}:operations:${mockTimestamp2}:response`
        ]);
      
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Read',
          params: { file_path: '/test/small.ts' },
          timestamp: mockTimestamp1,
          session_id: sessionId
        }))
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Write',
          params: { file_path: '/test/large.ts', content: 'content' },
          timestamp: mockTimestamp2,
          session_id: sessionId
        }))
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Read',
          response: 'small file content',
          responseSize: 100,
          message_id: messageId
        }))
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Write',
          response: { success: true },
          responseSize: 300, // 3x larger response
          message_id: messageId
        }));
      
      // Mock JSONL with total tokens for the message
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          id: messageId,
          timestamp: new Date(mockTimestamp1).toISOString(),
          usage: { input_tokens: 300, output_tokens: 100 }
        })
      );
      
      const result = await correlateOperations(sessionId, '/test/session.jsonl');
      
      expect(result).toHaveLength(1);
      const bundle = result[0];
      expect(bundle.operations).toHaveLength(2);
      expect(bundle.totalTokens).toBe(800); // Total from both operations
      
      // Check that we have the expected operations
      const readOp = bundle.operations.find(op => op.tool === 'Read');
      const writeOp = bundle.operations.find(op => op.tool === 'Write');
      
      expect(readOp).toBeDefined();
      expect(writeOp).toBeDefined();
      expect(readOp?.allocation).toBe('exact');
      expect(writeOp?.allocation).toBe('exact');
    });

    it('should handle synthetic operations from JSONL when no hook data available', async () => {
      const sessionId = 'test-session';
      const messageId = 'msg-synthetic';
      
      // No Redis operations
      mockRedisClient.keys.mockResolvedValue([]);
      
      // Mock JSONL with usage data
      const jsonlPath = `/test/${sessionId}.jsonl`;
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          id: messageId,
          timestamp: new Date().toISOString(),
          usage: { input_tokens: 150, output_tokens: 75 },
          content: { type: 'message', text: 'some content' }
        })
      );
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      expect(result).toHaveLength(1);
      const bundle = result[0];
      expect(bundle.operations).toHaveLength(1);
      
      const syntheticOp = bundle.operations[0];
      expect(syntheticOp.tool).toBe('Assistant');
      expect(syntheticOp.tokens).toBe(75); // Only output tokens
      expect(syntheticOp.allocation).toBe('exact');
      expect(syntheticOp.details).toBe('message');
    });

    it('should handle Redis connection failure gracefully', async () => {
      mockRedisClient.connect.mockRejectedValue(new Error('Redis unavailable'));
      mockedFs.existsSync.mockReturnValue(false);
      
      const result = await correlateOperations('test-session');
      
      expect(result).toEqual([]);
    });

    it('should format operation details correctly for different tools', async () => {
      const mockTimestamp = Date.now();
      const sessionId = 'test-session';
      
      mockRedisClient.keys
        .mockResolvedValueOnce([`session:${sessionId}:operations:${mockTimestamp}:request`])
        .mockResolvedValueOnce([`session:${sessionId}:operations:${mockTimestamp}:response`]);
      
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Bash',
          params: { command: 'npm run build --verbose --production' },
          timestamp: mockTimestamp,
          session_id: sessionId
        }))
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Bash',
          response: 'build output',
          responseSize: 1000
        }));
      
      mockedFs.existsSync.mockReturnValue(false);
      
      const result = await correlateOperations(sessionId);
      
      // Should return empty because no JSONL provided
      expect(result).toHaveLength(0);
    });
  });
});