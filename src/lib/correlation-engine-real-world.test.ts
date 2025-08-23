import { correlateOperations, resetRedisClient } from './correlation-engine';
import { createClient } from 'redis';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock Redis and fs
jest.mock('redis');
jest.mock('fs');

const mockedRedis = jest.mocked(createClient);
const mockedFs = jest.mocked(fs);

describe('correlation-engine: Real-world JSONL-only scenarios', () => {
  let mockRedisClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRedisClient();
    
    mockRedisClient = {
      connect: jest.fn(),
      isOpen: true,
      keys: jest.fn().mockResolvedValue([]), // Always empty Redis (no hook data)
      get: jest.fn()
    };
    mockedRedis.mockReturnValue(mockRedisClient);
  });

  describe('ACTUAL Claude JSONL format (no hooks)', () => {
    it('should create synthetic operations from real Claude JSONL format', async () => {
      // Mock JSONL with exact format from real Claude sessions
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue([
        // Summary line (no usage)
        '{"type":"summary","summary":"Test session"}',
        // User message (no usage)
        '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"test question"}]},"timestamp":"2025-08-23T04:25:37.253Z","uuid":"user-123"}',
        // Assistant message WITH usage data (this is what should be converted)
        '{"type":"assistant","message":{"id":"msg_123","role":"assistant","content":[{"type":"text","text":"test response"}],"usage":{"input_tokens":1000,"output_tokens":500,"cache_creation_input_tokens":200}},"timestamp":"2025-08-23T04:25:38.253Z","uuid":"assistant-123"}',
        // Another assistant message 
        '{"type":"assistant","message":{"id":"msg_124","role":"assistant","content":[{"type":"text","text":"another response"}],"usage":{"input_tokens":800,"output_tokens":300}},"timestamp":"2025-08-23T04:25:39.253Z","uuid":"assistant-124"}'
      ].join('\n'));

      const result = await correlateOperations('test-session', '/test/session.jsonl');

      // Should create 2 individual bundles (one per message)
      expect(result).toHaveLength(2);
      
      // Check first bundle
      const bundle1 = result[0];
      expect(bundle1.operations).toHaveLength(1);
      expect(bundle1.totalTokens).toBe(500); // Only output tokens (no input or cache)
      expect(bundle1.operations[0].message_id).toBe('msg_123');
      expect(bundle1.operations[0].tokens).toBe(500);

      // Check second bundle  
      const bundle2 = result[1];
      expect(bundle2.operations).toHaveLength(1);
      expect(bundle2.totalTokens).toBe(300); // Only output tokens
      expect(bundle2.operations[0].message_id).toBe('msg_124');
      expect(bundle2.operations[0].tokens).toBe(300);
    });

    it('should handle JSONL with no usage data gracefully', async () => {
      // Mock JSONL with only user messages and summaries (no usage data)
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue([
        '{"type":"summary","summary":"Test session"}',
        '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"test"}]},"timestamp":"2025-08-23T04:25:37.253Z"}',
        '{"type":"system","message":{"role":"system","content":"System message"},"timestamp":"2025-08-23T04:25:38.253Z"}'
      ].join('\n'));

      const result = await correlateOperations('empty-usage-session', '/test/session.jsonl');

      // Should return empty since no usage data found
      expect(result).toEqual([]);
    });

    it('should filter out messages without input_tokens or output_tokens', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue([
        // Message with complete usage
        '{"type":"assistant","message":{"id":"msg_good","usage":{"input_tokens":100,"output_tokens":50},"content":"good"},"timestamp":"2025-08-23T04:25:37.253Z"}',
        // Message with empty usage
        '{"type":"assistant","message":{"id":"msg_empty","usage":{},"content":"empty usage"},"timestamp":"2025-08-23T04:25:38.253Z"}',
        // Message with null usage
        '{"type":"assistant","message":{"id":"msg_null","usage":null,"content":"null usage"},"timestamp":"2025-08-23T04:25:39.253Z"}',
        // Message with only cache tokens (should still be included since it has input_tokens: 0)
        '{"type":"assistant","message":{"id":"msg_cache","usage":{"input_tokens":0,"cache_creation_input_tokens":200},"content":"cache only"},"timestamp":"2025-08-23T04:25:40.253Z"}'
      ].join('\n'));

      const result = await correlateOperations('filter-test-session', '/test/session.jsonl');

      // Should create 2 individual bundles
      expect(result).toHaveLength(2);
      
      const goodBundle = result.find(b => b.operations[0].message_id === 'msg_good');
      expect(goodBundle).toBeDefined();
      expect(goodBundle!.totalTokens).toBe(50); // Only output tokens
      
      const cacheBundle = result.find(b => b.operations[0].message_id === 'msg_cache');
      expect(cacheBundle).toBeDefined();
      expect(cacheBundle!.totalTokens).toBe(0); // 0 + 0 (no output tokens)
    });

    it('should handle malformed JSONL lines gracefully', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue([
        '{"type":"assistant","message":{"id":"msg_good","usage":{"input_tokens":100,"output_tokens":50}},"timestamp":"2025-08-23T04:25:37.253Z"}',
        'invalid json line here',
        '{"incomplete": "json"', // Incomplete JSON
        '{"type":"assistant","message":{"id":"msg_good2","usage":{"input_tokens":200,"output_tokens":100}},"timestamp":"2025-08-23T04:25:38.253Z"}'
      ].join('\n'));

      const result = await correlateOperations('malformed-session', '/test/session.jsonl');

      // Should create 2 individual bundles from valid lines only
      expect(result).toHaveLength(2);
      
      const firstBundle = result[0];
      expect(firstBundle.totalTokens).toBe(50); // Only output tokens
      
      const secondBundle = result[1];
      expect(secondBundle.totalTokens).toBe(100); // Only output tokens
    });

    it('should handle empty JSONL file', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('');

      const result = await correlateOperations('empty-file-session', '/test/empty.jsonl');

      expect(result).toEqual([]);
    });

    it('should handle missing JSONL file', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = await correlateOperations('missing-file-session', '/test/missing.jsonl');

      expect(result).toEqual([]);
    });

    it('should calculate response size correctly for different content types', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue([
        '{"type":"assistant","message":{"id":"msg_simple","usage":{"input_tokens":10,"output_tokens":5},"content":"simple text"},"timestamp":"2025-08-23T04:25:37.253Z"}',
        '{"type":"assistant","message":{"id":"msg_complex","usage":{"input_tokens":20,"output_tokens":10},"content":{"role":"assistant","text":"complex content","metadata":{"key":"value"}}},"timestamp":"2025-08-23T04:25:38.253Z"}'
      ].join('\n'));

      const result = await correlateOperations('response-size-session', '/test/session.jsonl');

      // Should create 2 individual bundles
      expect(result).toHaveLength(2);

      const simpleBundle = result.find(b => b.operations[0].message_id === 'msg_simple');
      const complexBundle = result.find(b => b.operations[0].message_id === 'msg_complex');

      expect(simpleBundle).toBeDefined();
      expect(complexBundle).toBeDefined();

      // Response size should reflect the JSON.stringify length of the content
      const simpleOp = simpleBundle!.operations[0];
      const complexOp = complexBundle!.operations[0];
      
      expect(simpleOp.responseSize).toBeGreaterThan(0);
      expect(complexOp.responseSize).toBeGreaterThan(simpleOp.responseSize);
    });

    it('should handle cache tokens in usage calculations', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        '{"type":"assistant","message":{"id":"msg_with_cache","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":200,"cache_read_input_tokens":300},"content":"response with cache"},"timestamp":"2025-08-23T04:25:37.253Z"}'
      );

      const result = await correlateOperations('cache-session', '/test/session.jsonl');

      expect(result).toHaveLength(1);
      const bundle = result[0];
      expect(bundle.operations).toHaveLength(1);

      const op = bundle.operations[0];
      // Should ONLY count output tokens, NOT input or cache tokens
      expect(op.tokens).toBe(50); // Only output tokens
      expect(op.usage?.cache_creation_input_tokens).toBe(200);
      expect(op.usage?.cache_read_input_tokens).toBe(300);
    });

    it('should create individual bundles for each message (not one massive bundle)', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue([
        '{"type":"assistant","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":5},"content":"first"},"timestamp":"2025-08-23T04:25:37.253Z"}',
        '{"type":"assistant","message":{"id":"msg_2","usage":{"input_tokens":20,"output_tokens":10},"content":"second"},"timestamp":"2025-08-23T04:25:38.253Z"}',
        '{"type":"assistant","message":{"id":"msg_3","usage":{"input_tokens":30,"output_tokens":15},"content":"third"},"timestamp":"2025-08-23T04:25:39.253Z"}'
      ].join('\n'));

      const result = await correlateOperations('individual-bundles-session', '/test/session.jsonl');

      // Should create 3 individual bundles, not 1 massive one
      expect(result).toHaveLength(3);
      
      expect(result[0].operations).toHaveLength(1);
      expect(result[0].totalTokens).toBe(5); // Only output tokens
      expect(result[0].operations[0].message_id).toBe('msg_1');
      
      expect(result[1].operations).toHaveLength(1);
      expect(result[1].totalTokens).toBe(10); // Only output tokens
      expect(result[1].operations[0].message_id).toBe('msg_2');
      
      expect(result[2].operations).toHaveLength(1);
      expect(result[2].totalTokens).toBe(15); // Only output tokens
      expect(result[2].operations[0].message_id).toBe('msg_3');
    });
  });

  describe('Edge cases that might cause 0 operations bug', () => {
    it('should handle session with Redis empty AND invalid JSONL path', async () => {
      // This tests the exact scenario we're seeing
      mockRedisClient.keys.mockResolvedValue([]); // No Redis data
      mockedFs.existsSync.mockReturnValue(false); // Invalid JSONL path

      const result = await correlateOperations('bug-scenario', '/invalid/path.jsonl');

      expect(result).toEqual([]);
    });

    it('should handle session with Redis empty AND empty JSONL content', async () => {
      // This might be causing the "1 bundle with 0 operations" bug
      mockRedisClient.keys.mockResolvedValue([]);
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('   \n\n   '); // Whitespace only

      const result = await correlateOperations('whitespace-session', '/test/whitespace.jsonl');

      expect(result).toEqual([]);
    });

    it('should handle JSONL with messages but no valid usage data', async () => {
      mockRedisClient.keys.mockResolvedValue([]);
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue([
        '{"type":"user","message":{"role":"user","content":"user message"},"timestamp":"2025-08-23T04:25:37.253Z"}',
        '{"type":"assistant","message":{"id":"msg_no_usage","role":"assistant","content":"response without usage"},"timestamp":"2025-08-23T04:25:38.253Z"}',
        '{"type":"assistant","message":{"id":"msg_zero_usage","usage":{"input_tokens":0,"output_tokens":0},"content":"response with zero usage"},"timestamp":"2025-08-23T04:25:39.253Z"}'
      ].join('\n'));

      const result = await correlateOperations('no-usage-session', '/test/session.jsonl');

      // Should create synthetic operations for messages with usage (even if zero)
      expect(result).toHaveLength(1);
      expect(result[0].operations).toHaveLength(1); // Only msg_zero_usage
      expect(result[0].operations[0].tokens).toBe(0);
    });
  });
});