import { discoverAllSessions, Session, extractProjectName, isSessionActive, getAssistantMessageCount } from './session-utils';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock fs module
jest.mock('fs', () => ({
  readdirSync: jest.fn(),
  existsSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn()
}));

// Mock os module
const mockHomedir = jest.fn(() => '/mock/home');
jest.mock('os', () => ({
  homedir: mockHomedir
}));

// Mock token calculator
jest.mock('./token-calculator', () => ({
  getCurrentTokenCount: jest.fn()
}));

// Mock jsonl-utils
jest.mock('./jsonl-utils', () => ({
  findJsonlPath: jest.fn(),
  parseJsonl: jest.fn(),
  scanClaudeProjects: jest.fn()
}));

const mockedFs = jest.mocked(fs);
const mockGetCurrentTokenCount = jest.requireMock('./token-calculator').getCurrentTokenCount;
const mockFindJsonlPath = jest.requireMock('./jsonl-utils').findJsonlPath;
const mockParseJsonl = jest.requireMock('./jsonl-utils').parseJsonl;
const mockScanClaudeProjects = jest.requireMock('./jsonl-utils').scanClaudeProjects;

describe('session-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractProjectName', () => {
    it('should extract project name from directory structure', () => {
      expect(extractProjectName({ projectDir: '-home-user-projects-myproject' })).toBe('myproject');
      expect(extractProjectName({ projectDir: 'simple-project' })).toBe('project');
      expect(extractProjectName({ projectDir: '-home-user-projects-home' })).toBe('home');
      expect(extractProjectName({ projectDir: 'unknown-structure' })).toBe('structure');
    });

    it('should handle edge cases', () => {
      expect(extractProjectName({ projectDir: '' })).toBe('unknown');
      expect(extractProjectName({ projectDir: 'single' })).toBe('single');
      expect(extractProjectName({ projectDir: '-leading-dash' })).toBe('dash');
    });
  });

  describe('isSessionActive', () => {
    it('should identify active sessions (modified in last 5 minutes)', () => {
      const now = new Date();
      const fourMinutesAgo = new Date(now.getTime() - 4 * 60 * 1000);
      const sixMinutesAgo = new Date(now.getTime() - 6 * 60 * 1000);

      expect(isSessionActive({ lastModified: fourMinutesAgo })).toBe(true);
      expect(isSessionActive({ lastModified: sixMinutesAgo })).toBe(false);
      expect(isSessionActive({ lastModified: now })).toBe(true);
    });
  });

  describe('discoverAllSessions', () => {
    it('should discover sessions across projects', async () => {
      const mockDate = new Date();
      
      mockScanClaudeProjects.mockReturnValue([
        {
          sessionId: 'session1',
          projectDir: '-home-user-projects-project1',
          filePath: '/mock/home/.claude/projects/-home-user-projects-project1/session1.jsonl',
          lastModified: mockDate
        },
        {
          sessionId: 'session2', 
          projectDir: '-home-user-projects-project1',
          filePath: '/mock/home/.claude/projects/-home-user-projects-project1/session2.jsonl',
          lastModified: mockDate
        },
        {
          sessionId: 'session3',
          projectDir: '-home-user-projects-project2',
          filePath: '/mock/home/.claude/projects/-home-user-projects-project2/session3.jsonl',
          lastModified: mockDate
        }
      ]);
      
      mockGetCurrentTokenCount.mockResolvedValue(1000);

      const result = await discoverAllSessions();

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('session1');
      expect(result[0].project).toBe('project1');
      expect(result[0].tokens).toBe(1000);
      expect(result[1].id).toBe('session2');
      expect(result[2].id).toBe('session3');
    });

    it('should return empty array when no files found', async () => {
      mockScanClaudeProjects.mockReturnValue([]);

      const result = await discoverAllSessions();

      expect(result).toEqual([]);
    });

    it('should handle errors gracefully', async () => {
      mockScanClaudeProjects.mockReturnValue([]);

      const result = await discoverAllSessions();

      expect(result).toEqual([]);
    });

    it('should extract project names correctly', async () => {
      mockScanClaudeProjects.mockReturnValue([
        {
          sessionId: 'session1',
          projectDir: '-home-user-projects-accessible',
          filePath: '/mock/projects/accessible/session1.jsonl',
          lastModified: new Date()
        }
      ]);
      
      mockGetCurrentTokenCount.mockResolvedValue(500);

      const result = await discoverAllSessions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('session1');
      expect(result[0].project).toBe('accessible');
    });

    it('should handle .save file filtering at the secure layer', async () => {
      // This test verifies that scanClaudeProjects already filters out .save files
      mockScanClaudeProjects.mockReturnValue([
        {
          sessionId: 'session',
          projectDir: '-home-user-projects-test',
          filePath: '/mock/projects/test/session.jsonl',
          lastModified: new Date()
        }
      ]);
      
      mockGetCurrentTokenCount.mockResolvedValue(100);

      const result = await discoverAllSessions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('session');
    });

    it('should sort sessions by last modified (most recent first)', async () => {
      const oldDate = new Date('2024-01-01');
      const newDate = new Date('2024-01-02');
      
      mockScanClaudeProjects.mockReturnValue([
        {
          sessionId: 'old-session',
          projectDir: '-home-user-projects-test',
          filePath: '/mock/projects/test/old-session.jsonl',
          lastModified: oldDate
        },
        {
          sessionId: 'new-session',
          projectDir: '-home-user-projects-test',
          filePath: '/mock/projects/test/new-session.jsonl',
          lastModified: newDate
        }
      ]);
      
      mockGetCurrentTokenCount.mockResolvedValue(100);

      const result = await discoverAllSessions();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('new-session'); // Most recent first
      expect(result[1].id).toBe('old-session');
    });
  });

  describe('getAssistantMessageCount', () => {
    it('should count messages with usage data', () => {
      const sessionId = 'test-session';
      const jsonlPath = '/mock/project/session.jsonl';
      
      mockFindJsonlPath.mockReturnValue(jsonlPath);
      mockParseJsonl.mockReturnValue([
        { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 50 } },
        { id: 'msg-2', usage: { cache_creation_input_tokens: 200 } },
        { id: 'msg-3', usage: { cache_read_input_tokens: 75 } },
        { id: 'msg-4', no_usage: true },
        { id: 'msg-5', usage: { input_tokens: 0 } }
      ]);

      const result = getAssistantMessageCount({ sessionId });

      expect(result).toBe(4); // msg-1, msg-2, msg-3, and msg-5
      expect(mockFindJsonlPath).toHaveBeenCalledWith(sessionId);
    });

    it('should return 0 when no JSONL file found', () => {
      mockFindJsonlPath.mockReturnValue(null);

      const result = getAssistantMessageCount({ sessionId: 'nonexistent-session' });

      expect(result).toBe(0);
    });

    it('should return 0 when JSONL file has no messages with usage', () => {
      const sessionId = 'no-usage-session';
      const jsonlPath = '/mock/project/session.jsonl';
      
      mockFindJsonlPath.mockReturnValue(jsonlPath);
      mockParseJsonl.mockReturnValue([
        { id: 'msg-1', content: 'text only' },
        { id: 'msg-2', timestamp: '2024-01-01T10:00:00Z' }
      ]);

      const result = getAssistantMessageCount({ sessionId });

      expect(result).toBe(0);
    });

    it('should count messages with any usage field present', () => {
      const sessionId = 'mixed-usage';
      const jsonlPath = '/mock/project/session.jsonl';
      
      mockFindJsonlPath.mockReturnValue(jsonlPath);
      mockParseJsonl.mockReturnValue([
        { id: 'msg-1', usage: { input_tokens: 100 } },
        { id: 'msg-2', usage: { output_tokens: 50 } }, 
        { id: 'msg-3', usage: { cache_creation_input_tokens: 200 } },
        { id: 'msg-4', usage: { cache_read_input_tokens: 75 } },
        { id: 'msg-5', other_field: 'value' },
        { id: 'msg-6' }
      ]);

      const result = getAssistantMessageCount({ sessionId });

      expect(result).toBe(4); // Messages with defined usage fields
    });
  });
});