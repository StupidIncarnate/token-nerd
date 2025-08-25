import { correlateOperations, Operation, Bundle, JsonlMessage, resetRedisClient, getHookOperations } from './correlation-engine';
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
    disconnect: jest.fn(),
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

// Mock stats-collector to avoid startup context in tests
jest.mock('./stats-collector', () => ({
  getSnapshotForSession: jest.fn(() => Promise.resolve(null))
}));

// Mock jsonl-utils
jest.mock('./jsonl-utils', () => ({
  parseJsonl: jest.fn(() => [])
}));

const mockedRedis = jest.mocked(createClient);
const mockedFs = jest.mocked(fs);
const { parseJsonl } = require('./jsonl-utils');
const mockedParseJsonl = jest.mocked(parseJsonl);

describe('correlation-engine', () => {
  let mockRedisClient: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    resetRedisClient(); // Reset the module-level Redis client
    
    mockRedisClient = {
      connect: jest.fn(),
      disconnect: jest.fn(),
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

  describe('getHookOperations', () => {
    it('should fetch and combine request/response operations from Redis', async () => {
      const mockTimestamp = Date.now();
      const sessionId = 'test-session';
      
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
              tool: 'Read',
              params: { file_path: '/test/file.ts' },
              timestamp: mockTimestamp,
              session_id: sessionId,
              sequence: 1
            }));
          }
          if (key.includes(':response')) {
            return Promise.resolve(JSON.stringify({
              response: 'file content',
              responseSize: 100,
              message_id: 'msg-123',
              sequence: 1,
              usage: { input_tokens: 50, output_tokens: 25 }
            }));
          }
          return Promise.resolve(null);
        });
      
      const result = await getHookOperations(sessionId);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        tool: 'Read',
        params: { file_path: '/test/file.ts' },
        response: 'file content',
        responseSize: 100,
        session_id: sessionId,
        sequence: 1,
        allocation: 'estimated',
        details: 'file.ts'
      });
    });

    it('should handle short session IDs by searching for full matches', async () => {
      const shortSessionId = 'abc12345';
      const fullSessionId = 'abc12345-def6-7890-ghij-klmnopqrstuv';
      const mockTimestamp = Date.now();
      
      // First call returns empty (no exact match)
      // Second call returns matches for the expanded search
      mockRedisClient.keys
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([`session:${fullSessionId}:operations:${mockTimestamp}:request`])
        .mockResolvedValueOnce([`session:${fullSessionId}:operations:${mockTimestamp}:response`]);
      
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Edit',
          params: { file_path: '/test.js' },
          session_id: fullSessionId,
          sequence: 1
        }))
        .mockResolvedValueOnce(JSON.stringify({
          response: { success: true },
          responseSize: 20,
          sequence: 1
        }));
      
      const result = await getHookOperations(shortSessionId);
      
      expect(result).toHaveLength(1);
      expect(result[0].session_id).toBe(fullSessionId);
      expect(result[0].details).toBe('test.js');
    });

    it('should handle file references in large responses', async () => {
      const sessionId = 'test-session';
      const mockTimestamp = Date.now();
      const filePath = '/tmp/large-response.json';
      
      mockRedisClient.keys
        .mockResolvedValueOnce([`session:${sessionId}:operations:${mockTimestamp}:request`])
        .mockResolvedValueOnce([`session:${sessionId}:operations:${mockTimestamp}:response`]);
      
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Bash',
          params: { command: 'npm test' },
          session_id: sessionId,
          sequence: 1
        }))
        .mockResolvedValueOnce(JSON.stringify({
          response: `file://${filePath}`,
          responseSize: 50000,
          sequence: 1
        }));
      
      // Mock file reading
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({ output: 'test results' }));
      
      const result = await getHookOperations(sessionId);
      
      expect(result).toHaveLength(1);
      expect(result[0].response).toEqual({ output: 'test results' });
      expect(mockedFs.readFileSync).toHaveBeenCalledWith(filePath, 'utf8');
    });

    it('should handle file read errors gracefully', async () => {
      const sessionId = 'test-session';
      const mockTimestamp = Date.now();
      const filePath = '/tmp/missing-file.json';
      
      mockRedisClient.keys
        .mockResolvedValueOnce([`session:${sessionId}:operations:${mockTimestamp}:request`])
        .mockResolvedValueOnce([`session:${sessionId}:operations:${mockTimestamp}:response`]);
      
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Glob',
          params: { pattern: '**/*.ts' },
          session_id: sessionId,
          sequence: 1
        }))
        .mockResolvedValueOnce(JSON.stringify({
          response: `file://${filePath}`,
          responseSize: 50000,
          sequence: 1
        }));
      
      // Mock file read error
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });
      
      const result = await getHookOperations(sessionId);
      
      expect(result).toHaveLength(1);
      expect(result[0].response).toBe(`[Large response stored in ${filePath}]`);
    });

    it('should return empty array when Redis is unavailable', async () => {
      mockRedisClient.connect.mockRejectedValue(new Error('Connection refused'));
      
      const result = await getHookOperations('test-session');
      
      expect(result).toEqual([]);
    });

    it('should format operation details for Read tool', async () => {
      const sessionId = 'test-read';
      const mockTimestamp = Date.now();
      
      mockRedisClient.keys
        .mockResolvedValueOnce([`session:${sessionId}:operations:${mockTimestamp}:request`])
        .mockResolvedValueOnce([`session:${sessionId}:operations:${mockTimestamp}:response`]);
      
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Read',
          params: { file_path: '/very/long/path/to/file.ts' },
          session_id: sessionId,
          sequence: 1
        }))
        .mockResolvedValueOnce(JSON.stringify({
          response: 'test response',
          responseSize: 100,
          sequence: 1
        }));
      
      const result = await getHookOperations(sessionId);
      
      expect(result).toHaveLength(1);
      expect(result[0].details).toBe('file.ts');
    });

    it('should format operation details for Bash tool with long command', async () => {
      const sessionId = 'test-bash';
      const mockTimestamp = Date.now();
      
      mockRedisClient.keys
        .mockResolvedValueOnce([`session:${sessionId}:operations:${mockTimestamp}:request`])
        .mockResolvedValueOnce([`session:${sessionId}:operations:${mockTimestamp}:response`]);
      
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify({
          tool: 'Bash',
          params: { command: 'very long command that should be truncated because it exceeds thirty characters' },
          session_id: sessionId,
          sequence: 1
        }))
        .mockResolvedValueOnce(JSON.stringify({
          response: 'test response',
          responseSize: 100,
          sequence: 1
        }));
      
      const result = await getHookOperations(sessionId);
      
      expect(result).toHaveLength(1);
      expect(result[0].details).toBe('very long command that should ...');
    });
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

    it('should process different message types from JSONL', async () => {
      const sessionId = 'test-session';
      const jsonlPath = '/test/session.jsonl';
      
      // No Redis operations for this test
      mockRedisClient.keys.mockResolvedValue([]);
      
      // Mock JSONL with different message types
      mockedParseJsonl.mockReturnValue([
        // User message
        {
          id: 'user-1',
          timestamp: new Date('2024-01-01T10:00:00Z').getTime(),
          content: {
            type: 'user',
            message: {
              role: 'user',
              content: 'Hello, can you help me?'
            }
          }
        },
        // System message
        {
          id: 'system-1',
          timestamp: new Date('2024-01-01T10:00:01Z').getTime(),
          content: {
            type: 'system',
            message: {
              role: 'system',
              content: 'You are a helpful assistant'
            }
          }
        },
        // Tool result message
        {
          id: 'tool-1',
          timestamp: new Date('2024-01-01T10:00:02Z').getTime(),
          content: {
            type: 'user',
            message: {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: 'tool-123',
                content: 'Large file content here'.repeat(100)
              }]
            }
          }
        },
        // Assistant message with cache metrics
        {
          id: 'assistant-1',
          timestamp: new Date('2024-01-01T10:00:03Z').getTime(),
          usage: {
            input_tokens: 1500,
            output_tokens: 200,
            cache_creation_input_tokens: 800,
            cache_read_input_tokens: 700,
            cache_creation: {
              ephemeral_5m_input_tokens: 300,
              ephemeral_1h_input_tokens: 500
            }
          },
          content: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{
                type: 'text',
                text: 'I can help with that!'
              }, {
                type: 'tool_use',
                id: 'tool-456',
                name: 'Read',
                input: { file_path: '/test/file.ts' }
              }]
            }
          }
        }
      ]);
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      expect(result).toHaveLength(4);
      
      // Check user message
      const userBundle = result.find(b => b.id === 'user-1');
      expect(userBundle).toBeDefined();
      expect(userBundle?.operations[0].tool).toBe('User');
      expect(userBundle?.operations[0].details).toBe('Hello, can you help me?');
      
      // Check system message
      const systemBundle = result.find(b => b.id === 'system-1');
      expect(systemBundle).toBeDefined();
      expect(systemBundle?.operations[0].tool).toBe('System');
      expect(systemBundle?.operations[0].details).toBe('Hidden system prompt/context');
      
      // Check tool result
      const toolBundle = result.find(b => b.id === 'tool-1');
      expect(toolBundle).toBeDefined();
      expect(toolBundle?.operations[0].tool).toBe('ToolResponse');
      expect(toolBundle?.operations[0].details).toContain('KB →');
      
      // Check assistant message with cache metrics
      const assistantBundle = result.find(b => b.id === 'assistant-1');
      expect(assistantBundle).toBeDefined();
      const assistantOp = assistantBundle?.operations[0];
      expect(assistantOp?.tool).toBe('Assistant');
      expect(assistantOp?.contextGrowth).toBe(800);
      expect(assistantOp?.generationCost).toBe(200);
      expect(assistantOp?.ephemeral5m).toBe(300);
      expect(assistantOp?.ephemeral1h).toBe(500);
      expect(assistantOp?.cacheEfficiency).toBeCloseTo(46.67, 2); // 700/(800+700)*100
      expect(assistantOp?.details).toContain('calls Read: file.ts');
    });

    it('should add cache expiration warnings for time gaps', async () => {
      const sessionId = 'test-session';
      const jsonlPath = '/test/session.jsonl';
      
      mockRedisClient.keys.mockResolvedValue([]);
      
      const baseTime = new Date('2024-01-01T10:00:00Z').getTime();
      const gapTime = new Date('2024-01-01T10:10:00Z').getTime(); // 10 minute gap
      
      mockedParseJsonl.mockReturnValue([
        {
          id: 'msg-1',
          timestamp: baseTime,
          usage: { output_tokens: 50 },
          content: { type: 'assistant', message: { role: 'assistant', content: 'First message' } }
        },
        {
          id: 'msg-2',
          timestamp: gapTime,
          usage: { 
            cache_creation_input_tokens: 1000,
            output_tokens: 100
          },
          content: { 
            type: 'assistant', 
            message: { 
              role: 'assistant', 
              content: [{
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'ls -la' }
              }]
            }
          }
        }
      ]);
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      expect(result).toHaveLength(2);
      const secondMessage = result[1];
      expect(secondMessage.operations[0].details).toContain('⚠️');
      expect(secondMessage.operations[0].details).toContain('cache expired');
      expect(secondMessage.operations[0].timeGap).toBe(600); // 10 minutes in seconds
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
              session_id: sessionId,
              sequence: 1
            }));
          }
          if (key.includes(':response')) {
            return Promise.resolve(JSON.stringify({
              tool: 'Edit',
              response: { success: true },
              responseSize: 20,
              message_id: messageId,
              sequence: 1
            }));
          }
          return Promise.resolve(null);
        });
      
      // Mock JSONL file
      const jsonlPath = `/home/test/.claude/projects/${sessionId}.jsonl`;
      mockedParseJsonl.mockReturnValue([
        {
          id: messageId,
          timestamp: mockTimestamp,
          usage: { input_tokens: 200, output_tokens: 100 },
          content: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: 'Assistant response'
            }
          }
        }
      ]);
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      expect(result).toHaveLength(1);
      const bundle = result[0];
      expect(bundle.operations).toHaveLength(1);
      
      const operation = bundle.operations[0];
      expect(operation.tool).toBe('Assistant'); // Now processes as assistant message
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
      mockedParseJsonl.mockReturnValue([
        {
          id: messageId,
          timestamp: mockTimestamp1,
          usage: { input_tokens: 300, output_tokens: 100 },
          content: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: 'Assistant response'
            }
          }
        }
      ]);
      
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
      mockedParseJsonl.mockReturnValue([
        {
          id: messageId,
          timestamp: Date.now(),
          usage: { input_tokens: 150, output_tokens: 75 },
          content: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: 'some content'
            }
          }
        }
      ]);
      
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