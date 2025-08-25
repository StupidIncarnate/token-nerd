import { parseJsonl, findJsonlPath, getAssistantMessageCount } from './jsonl-utils';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock fs module
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  existsSync: jest.fn(),
  readdirSync: jest.fn()
}));

// Mock os module
const mockHomedir = jest.fn(() => '/mock/home');
jest.mock('os', () => ({
  homedir: mockHomedir
}));

const mockedFs = jest.mocked(fs);

describe('jsonl-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseJsonl', () => {
    it('should parse valid JSONL file correctly', () => {
      const jsonlContent = [
        '{"id":"msg-1","timestamp":"2024-01-01T10:00:00Z","usage":{"input_tokens":100,"output_tokens":50}}',
        '{"id":"msg-2","timestamp":"2024-01-01T10:01:00Z","usage":{"cache_creation_input_tokens":200}}',
        '{"message":{"id":"msg-3","usage":{"input_tokens":150}},"timestamp":"2024-01-01T10:02:00Z"}'
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(jsonlContent);

      const result = parseJsonl('/test/session.jsonl');

      expect(result).toHaveLength(3);
      
      // Check first message
      expect(result[0]).toEqual({
        id: 'msg-1',
        timestamp: new Date('2024-01-01T10:00:00Z').getTime(),
        usage: { input_tokens: 100, output_tokens: 50 },
        content: {
          id: 'msg-1',
          timestamp: '2024-01-01T10:00:00Z',
          usage: { input_tokens: 100, output_tokens: 50 }
        }
      });

      // Check message with cache creation
      expect(result[1].usage?.cache_creation_input_tokens).toBe(200);
      
      // Check nested message format
      expect(result[2].id).toBe('msg-3');
      expect(result[2].usage?.input_tokens).toBe(150);
    });

    it('should expand tilde in file path', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('{"id":"test","timestamp":"2024-01-01T10:00:00Z"}');
      
      parseJsonl('~/session.jsonl');

      // Should call existsSync and readFileSync with expanded path
      expect(mockedFs.existsSync).toHaveBeenCalled();
      expect(mockedFs.readFileSync).toHaveBeenCalled();
      
      // Verify the path was expanded (contains home directory)
      const existsCall = mockedFs.existsSync.mock.calls[0][0] as string;
      expect(existsCall).toMatch(/\/.*\/session\.jsonl/);
      expect(existsCall).not.toContain('~');
    });

    it('should return empty array for non-existent file', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = parseJsonl('/non/existent/file.jsonl');

      expect(result).toEqual([]);
      expect(mockedFs.readFileSync).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON lines gracefully', () => {
      const jsonlContent = [
        '{"id":"msg-1","timestamp":"2024-01-01T10:00:00Z"}',
        '{invalid json}',
        '',
        '{"id":"msg-2","timestamp":"2024-01-01T10:01:00Z"}'
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(jsonlContent);

      const result = parseJsonl('/test/session.jsonl');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2');
    });

    it('should handle file read errors', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });

      const result = parseJsonl('/error/file.jsonl');

      expect(result).toEqual([]);
    });

    it('should filter out empty lines and whitespace', () => {
      const jsonlContent = [
        '{"id":"msg-1","timestamp":"2024-01-01T10:00:00Z"}',
        '   ',
        '',
        '{"id":"msg-2","timestamp":"2024-01-01T10:01:00Z"}',
        '\t\n'
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(jsonlContent);

      const result = parseJsonl('/test/session.jsonl');

      expect(result).toHaveLength(2);
    });

    it('should extract message IDs from different formats', () => {
      const jsonlContent = [
        '{"message":{"id":"nested-id"},"timestamp":"2024-01-01T10:00:00Z"}',
        '{"id":"direct-id","timestamp":"2024-01-01T10:01:00Z"}',
        '{"uuid":"uuid-id","timestamp":"2024-01-01T10:02:00Z"}',
        '{"no_id_field":true,"timestamp":"2024-01-01T10:03:00Z"}'
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(jsonlContent);

      const result = parseJsonl('/test/session.jsonl');

      expect(result).toHaveLength(4);
      expect(result[0].id).toBe('nested-id');
      expect(result[1].id).toBe('direct-id');
      expect(result[2].id).toBe('uuid-id');
      expect(result[3].id).toBeUndefined();
    });

    it('should handle usage data from different locations', () => {
      const jsonlContent = [
        '{"id":"msg-1","usage":{"input_tokens":100},"timestamp":"2024-01-01T10:00:00Z"}',
        '{"id":"msg-2","message":{"usage":{"output_tokens":50}},"timestamp":"2024-01-01T10:01:00Z"}',
        '{"id":"msg-3","timestamp":"2024-01-01T10:02:00Z"}'
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(jsonlContent);

      const result = parseJsonl('/test/session.jsonl');

      expect(result).toHaveLength(3);
      expect(result[0].usage?.input_tokens).toBe(100);
      expect(result[1].usage?.output_tokens).toBe(50);
      expect(result[2].usage).toBeUndefined();
    });
  });

  describe('findJsonlPath', () => {
    it('should find JSONL file for session ID', () => {
      const sessionId = 'abc12345';
      const projectsDir = '/mock/home/.claude/projects';
      
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync
        .mockReturnValueOnce([
          { name: 'project1', isDirectory: () => true },
          { name: 'project2', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['session-abc12345-def.jsonl', 'other.txt'] as any)
        .mockReturnValueOnce(['unrelated.jsonl'] as any);

      const result = findJsonlPath(sessionId);

      expect(result).toMatch(/\/.*\.claude\/projects\/project1\/session-abc12345-def\.jsonl$/);
      // Check that readdirSync was called with the projects directory
      expect(mockedFs.readdirSync).toHaveBeenCalledWith(expect.stringMatching(/\.claude\/projects$/), { withFileTypes: true });
    });

    it('should return null when projects directory does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = findJsonlPath('test-session');

      expect(result).toBeNull();
    });

    it('should return null when no matching file found', () => {
      const sessionId = 'nonexistent';
      
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync
        .mockReturnValueOnce([
          { name: 'project1', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['different-session.jsonl', 'other.txt'] as any);

      const result = findJsonlPath(sessionId);

      expect(result).toBeNull();
    });

    it('should handle directory read errors', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = findJsonlPath('test-session');

      expect(result).toBeNull();
    });

    it('should skip non-directory entries', () => {
      const sessionId = 'test123';
      
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync
        .mockReturnValueOnce([
          { name: 'file.txt', isDirectory: () => false },
          { name: 'actual-project', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['session-test123.jsonl'] as any);

      const result = findJsonlPath(sessionId);

      expect(result).toMatch(/\/.*\.claude\/projects\/actual-project\/session-test123\.jsonl$/);
    });

    it('should match partial session ID in filename', () => {
      const sessionId = 'abc123';
      
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync
        .mockReturnValueOnce([
          { name: 'project1', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['conversation-abc123-def-456.jsonl'] as any);

      const result = findJsonlPath(sessionId);

      expect(result).toMatch(/\/.*\.claude\/projects\/project1\/conversation-abc123-def-456\.jsonl$/);
    });
  });

  describe('getAssistantMessageCount', () => {
    it('should count messages with usage data', () => {
      const sessionId = 'test-session';
      const jsonlPath = '/mock/project/session.jsonl';
      
      // Mock findJsonlPath
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync
        .mockReturnValueOnce([{ name: 'project', isDirectory: () => true }] as any)
        .mockReturnValueOnce(['session-test-session.jsonl'] as any);
      
      // Mock parseJsonl content
      const jsonlContent = [
        '{"id":"msg-1","usage":{"input_tokens":100,"output_tokens":50}}',
        '{"id":"msg-2","usage":{"cache_creation_input_tokens":200}}',
        '{"id":"msg-3","message":{"usage":{"cache_read_input_tokens":75}}}',
        '{"id":"msg-4","no_usage":true}',
        '{"id":"msg-5","usage":{"input_tokens":0}}'
      ].join('\n');
      
      mockedFs.readFileSync.mockReturnValue(jsonlContent);

      const result = getAssistantMessageCount(sessionId);

      expect(result).toBe(4); // msg-1, msg-2, msg-3, and msg-5 (empty usage still counts)
    });

    it('should return 0 when no JSONL file found', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = getAssistantMessageCount('nonexistent-session');

      expect(result).toBe(0);
    });

    it('should return 0 when JSONL file has no messages with usage', () => {
      const sessionId = 'no-usage-session';
      
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync
        .mockReturnValueOnce([{ name: 'project', isDirectory: () => true }] as any)
        .mockReturnValueOnce(['session-no-usage-session.jsonl'] as any);
      
      const jsonlContent = [
        '{"id":"msg-1","content":"text only"}',
        '{"id":"msg-2","timestamp":"2024-01-01T10:00:00Z"}'
      ].join('\n');
      
      mockedFs.readFileSync.mockReturnValue(jsonlContent);

      const result = getAssistantMessageCount(sessionId);

      expect(result).toBe(0);
    });

    it('should handle parseJsonl errors gracefully', () => {
      const sessionId = 'error-session';
      
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync
        .mockReturnValueOnce([{ name: 'project', isDirectory: () => true }] as any)
        .mockReturnValueOnce(['session-error-session.jsonl'] as any);
      
      // Mock readFileSync to throw error
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });

      const result = getAssistantMessageCount(sessionId);

      expect(result).toBe(0);
    });

    it('should count messages with any usage field present', () => {
      const sessionId = 'mixed-usage';
      
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync
        .mockReturnValueOnce([{ name: 'project', isDirectory: () => true }] as any)
        .mockReturnValueOnce(['session-mixed-usage.jsonl'] as any);
      
      const jsonlContent = [
        '{"id":"msg-1","usage":{"input_tokens":100}}',
        '{"id":"msg-2","usage":{"output_tokens":50}}', 
        '{"id":"msg-3","usage":{"cache_creation_input_tokens":200}}',
        '{"id":"msg-4","usage":{"cache_read_input_tokens":75}}',
        '{"id":"msg-5","usage":{"total_tokens":300}}',
        '{"id":"msg-6","other_field":"value"}',
        '{"id":"msg-7"}'
      ].join('\n');
      
      mockedFs.readFileSync.mockReturnValue(jsonlContent);

      const result = getAssistantMessageCount(sessionId);

      expect(result).toBe(4); // All messages with defined usage fields (msg-6 and msg-7 don't have usage)
    });
  });
});