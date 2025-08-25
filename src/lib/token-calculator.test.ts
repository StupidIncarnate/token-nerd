import { 
  getTokenCount, 
  calculateCumulativeTotal, 
  calculateConversationGrowth, 
  calculateRemainingCapacity,
  estimateTokensFromContent
} from './token-calculator';
import * as fs from 'fs';
import * as readline from 'readline';
import { Readable } from 'stream';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  createReadStream: jest.fn(),
  statSync: jest.fn()
}));

// Mock readline module
jest.mock('readline', () => ({
  createInterface: jest.fn()
}));

const mockedFs = jest.mocked(fs);
const mockedReadline = jest.mocked(readline);

describe('token-calculator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTokenCount', () => {
    const mockCreateAsyncIterator = (lines: string[]) => {
      const mockRl = {
        [Symbol.asyncIterator]: async function* () {
          for (const line of lines) {
            yield line;
          }
        }
      };
      
      mockedReadline.createInterface.mockReturnValue(mockRl as any);
    };

    it('should return 0 for non-existent file', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = await getTokenCount('/non/existent/file.jsonl');

      expect(result).toBe(0);
      expect(mockedFs.createReadStream).not.toHaveBeenCalled();
    });

    it('should calculate highest cumulative total from JSONL messages', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.createReadStream.mockReturnValue(new Readable() as any);

      const lines = [
        '{"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":25}}',
        '{"usage":{"input_tokens":200,"output_tokens":75,"cache_creation_input_tokens":100}}',
        '{"message":{"usage":{"input_tokens":300,"output_tokens":100,"cache_read_input_tokens":150}}}'
      ];

      mockCreateAsyncIterator(lines);

      const result = await getTokenCount('/test/session.jsonl');

      // Should return highest total: 300 + 100 + 150 = 550
      expect(result).toBe(550);
    });

    it('should track cumulative growth correctly', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.createReadStream.mockReturnValue(new Readable() as any);

      const lines = [
        '{"usage":{"input_tokens":100,"output_tokens":50}}', // Total: 150
        '{"usage":{"input_tokens":200,"output_tokens":75,"cache_creation_input_tokens":100}}', // Total: 375  
        '{"usage":{"input_tokens":150,"output_tokens":25}}', // Total: 175 (lower than previous)
        '{"usage":{"input_tokens":400,"output_tokens":100,"cache_read_input_tokens":200}}' // Total: 700 (highest)
      ];

      mockCreateAsyncIterator(lines);

      const result = await getTokenCount('/test/session.jsonl');

      expect(result).toBe(700); // Should track the highest seen
    });

    it('should handle messages without usage gracefully', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.createReadStream.mockReturnValue(new Readable() as any);

      const lines = [
        '{"id":"msg-1","timestamp":"2024-01-01T10:00:00Z"}',
        '{"usage":{"input_tokens":100,"output_tokens":50}}',
        '{"content":"no usage data"}',
        '{"usage":{"input_tokens":200,"output_tokens":75}}'
      ];

      mockCreateAsyncIterator(lines);

      const result = await getTokenCount('/test/session.jsonl');

      expect(result).toBe(275); // Only counts messages with usage
    });

    it('should skip malformed JSON lines', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.createReadStream.mockReturnValue(new Readable() as any);

      const lines = [
        '{"usage":{"input_tokens":100,"output_tokens":50}}',
        '{invalid json}',
        '',
        '{"usage":{"input_tokens":200,"output_tokens":75}}'
      ];

      mockCreateAsyncIterator(lines);

      const result = await getTokenCount('/test/session.jsonl');

      expect(result).toBe(275);
    });

    it('should skip empty lines', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.createReadStream.mockReturnValue(new Readable() as any);

      const lines = [
        '',
        '   ',
        '{"usage":{"input_tokens":100,"output_tokens":50}}',
        '\t',
        '{"usage":{"input_tokens":200,"output_tokens":75}}'
      ];

      mockCreateAsyncIterator(lines);

      const result = await getTokenCount('/test/session.jsonl');

      expect(result).toBe(275);
    });

    it('should fall back to file size estimation on parse error', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.createReadStream.mockImplementation(() => {
        throw new Error('Stream error');
      });
      mockedFs.statSync.mockReturnValue({ size: 10000 } as any);

      const result = await getTokenCount('/test/session.jsonl');

      expect(result).toBe(100); // 10000 / 100 = 100
      expect(mockedFs.statSync).toHaveBeenCalledWith('/test/session.jsonl');
    });

    it('should return 0 on both parse and stat errors', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.createReadStream.mockImplementation(() => {
        throw new Error('Stream error');
      });
      mockedFs.statSync.mockImplementation(() => {
        throw new Error('Stat error');
      });

      const result = await getTokenCount('/test/session.jsonl');

      expect(result).toBe(0);
    });

    it('should handle nested usage in message object', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.createReadStream.mockReturnValue(new Readable() as any);

      const lines = [
        '{"message":{"usage":{"input_tokens":100,"output_tokens":50}}}',
        '{"usage":{"input_tokens":200,"output_tokens":75}}' // Direct usage should also work
      ];

      mockCreateAsyncIterator(lines);

      const result = await getTokenCount('/test/session.jsonl');

      expect(result).toBe(275); // Max of 150 and 275
    });
  });

  describe('calculateCumulativeTotal', () => {
    it('should sum all token types correctly', () => {
      const usage = {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 25,
        cache_creation_input_tokens: 75
      };

      const result = calculateCumulativeTotal(usage);

      expect(result).toBe(250); // 100 + 50 + 25 + 75
    });

    it('should handle missing token fields', () => {
      const usage = {
        input_tokens: 100,
        output_tokens: 50
        // cache fields missing
      };

      const result = calculateCumulativeTotal(usage);

      expect(result).toBe(150); // 100 + 50 + 0 + 0
    });

    it('should handle undefined/null values', () => {
      const usage = {
        input_tokens: undefined as any,
        output_tokens: null as any,
        cache_read_input_tokens: 25,
        cache_creation_input_tokens: 75
      };

      const result = calculateCumulativeTotal(usage);

      expect(result).toBe(100); // 0 + 0 + 25 + 75
    });

    it('should handle empty usage object', () => {
      const usage = {};

      const result = calculateCumulativeTotal(usage);

      expect(result).toBe(0);
    });

    it('should handle large numbers correctly', () => {
      const usage = {
        input_tokens: 50000,
        output_tokens: 25000,
        cache_read_input_tokens: 100000,
        cache_creation_input_tokens: 75000
      };

      const result = calculateCumulativeTotal(usage);

      expect(result).toBe(250000);
    });
  });

  describe('calculateConversationGrowth', () => {
    it('should sum only input and output tokens', () => {
      const usage = {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 25, // Should be ignored
        cache_creation_input_tokens: 75 // Should be ignored
      };

      const result = calculateConversationGrowth(usage);

      expect(result).toBe(150); // Only 100 + 50
    });

    it('should handle missing input/output tokens', () => {
      const usage = {
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 200
      };

      const result = calculateConversationGrowth(usage);

      expect(result).toBe(0); // 0 + 0
    });

    it('should handle partial data', () => {
      const usage = {
        input_tokens: 100
        // output_tokens missing
      };

      const result = calculateConversationGrowth(usage);

      expect(result).toBe(100); // 100 + 0
    });
  });

  describe('calculateRemainingCapacity', () => {
    it('should calculate remaining capacity correctly with default limit', () => {
      const currentTotal = 50000;

      const result = calculateRemainingCapacity(currentTotal);

      expect(result).toEqual({
        remaining: 150000, // 200000 - 50000
        percentage: 75, // 150000/200000 * 100
        isNearLimit: false // 75% > 10%
      });
    });

    it('should identify near limit condition', () => {
      const currentTotal = 185000; // 92.5% used

      const result = calculateRemainingCapacity(currentTotal);

      expect(result).toEqual({
        remaining: 15000,
        percentage: 7.5, // 15000/200000 * 100
        isNearLimit: true // 7.5% < 10%
      });
    });

    it('should handle custom context window limit', () => {
      const currentTotal = 80000;
      const customLimit = 100000;

      const result = calculateRemainingCapacity(currentTotal, customLimit);

      expect(result).toEqual({
        remaining: 20000,
        percentage: 20, // 20000/100000 * 100
        isNearLimit: false
      });
    });

    it('should handle overuse (current > limit)', () => {
      const currentTotal = 220000; // Over the 200k limit

      const result = calculateRemainingCapacity(currentTotal);

      expect(result).toEqual({
        remaining: 0, // Math.max(0, negative) = 0
        percentage: 0,
        isNearLimit: true
      });
    });

    it('should handle zero current total', () => {
      const currentTotal = 0;

      const result = calculateRemainingCapacity(currentTotal);

      expect(result).toEqual({
        remaining: 200000,
        percentage: 100,
        isNearLimit: false
      });
    });

    it('should handle exact limit reached', () => {
      const currentTotal = 200000;

      const result = calculateRemainingCapacity(currentTotal);

      expect(result).toEqual({
        remaining: 0,
        percentage: 0,
        isNearLimit: true
      });
    });

    it('should detect near limit at exactly 10%', () => {
      const currentTotal = 180000; // Exactly 10% remaining

      const result = calculateRemainingCapacity(currentTotal);

      expect(result).toEqual({
        remaining: 20000,
        percentage: 10,
        isNearLimit: false // 10% is not < 10%
      });
    });

    it('should detect near limit just below 10%', () => {
      const currentTotal = 180001; // Just below 10% remaining

      const result = calculateRemainingCapacity(currentTotal);

      expect(result.percentage).toBeLessThan(10);
      expect(result.isNearLimit).toBe(true);
    });
  });

  describe('estimateTokensFromContent', () => {
    it('should estimate tokens using 4-char heuristic', () => {
      const content = 'This is a test string with exactly forty characters!'; // 52 chars

      const result = estimateTokensFromContent(content);

      expect(result).toBe(13); // Math.ceil(52 / 4) = 13
    });

    it('should handle empty strings', () => {
      const result = estimateTokensFromContent('');

      expect(result).toBe(0); // Math.ceil(0 / 4) = 0
    });

    it('should handle single character', () => {
      const result = estimateTokensFromContent('a');

      expect(result).toBe(1); // Math.ceil(1 / 4) = 1
    });

    it('should handle exactly divisible by 4', () => {
      const content = 'abcd'; // 4 chars

      const result = estimateTokensFromContent(content);

      expect(result).toBe(1); // Math.ceil(4 / 4) = 1
    });

    it('should round up partial tokens', () => {
      const content = 'abcde'; // 5 chars

      const result = estimateTokensFromContent(content);

      expect(result).toBe(2); // Math.ceil(5 / 4) = 2
    });

    it('should handle large content', () => {
      const content = 'x'.repeat(10000); // 10k chars

      const result = estimateTokensFromContent(content);

      expect(result).toBe(2500); // 10000 / 4 = 2500
    });

    it('should handle unicode characters', () => {
      const content = '🚀🎉✨🌟'; // 4 emoji (each may be multiple UTF-16 code units)

      const result = estimateTokensFromContent(content);

      expect(result).toBe(Math.ceil(content.length / 4)); // Use actual string length
    });

    it('should handle newlines and whitespace', () => {
      const content = 'Line 1\nLine 2\t\tIndented'; // 22 chars including whitespace

      const result = estimateTokensFromContent(content);

      expect(result).toBe(6); // Math.ceil(22 / 4) = 6
    });
  });
});