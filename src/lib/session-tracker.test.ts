import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { listSessions, selectSession } from './session-tracker';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn()
}));

// Mock path module
jest.mock('path', () => ({
  join: jest.fn((...parts) => parts.join('/')),
  basename: jest.fn((filepath: string, ext?: string) => {
    const name = filepath.split('/').pop() || '';
    return ext ? name.replace(ext, '') : name;
  })
}));

// Mock os module
const mockHomedir = jest.fn();
jest.mock('os', () => ({
  homedir: mockHomedir
}));

// Mock inquirer
jest.mock('inquirer', () => ({
  prompt: jest.fn()
}));

import inquirer from 'inquirer';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;
// Remove this line since we're using direct mock
const mockInquirer = inquirer as jest.Mocked<typeof inquirer>;

describe('session-tracker', () => {
  const mockHomeDir = '/home/testuser';
  const mockProjectsDir = '/home/testuser/.claude/projects';

  beforeEach(() => {
    jest.clearAllMocks();
    mockHomedir.mockReturnValue(mockHomeDir);
    mockPath.join.mockImplementation((...parts) => parts.join('/'));
  });

  describe('listSessions', () => {
    it('should return empty array when projects directory does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const sessions = await listSessions();

      expect(sessions).toEqual([]);
      expect(mockFs.existsSync).toHaveBeenCalledWith(expect.stringContaining('/.claude/projects'));
    });

    it('should scan project directories and return session list', async () => {
      const mockDate = new Date('2023-01-01T12:00:00Z');
      
      // Mock directory structure
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-token-nerd', isDirectory: () => true },
          { name: '-home-user-projects-other-project', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['session1.jsonl', 'session2.jsonl', 'session3.jsonl.save'] as any)
        .mockReturnValueOnce(['session4.jsonl'] as any);

      // Mock file stats
      mockFs.statSync
        .mockReturnValueOnce({ mtime: mockDate, size: 10000 } as any)
        .mockReturnValueOnce({ mtime: new Date(Date.now() - 1000), size: 5000 } as any) // Active session
        .mockReturnValueOnce({ mtime: mockDate, size: 15000 } as any);

      const sessions = await listSessions();

      expect(sessions).toHaveLength(3);
      expect(sessions[0]).toMatchObject({
        id: 'session2',
        project: 'nerd',
        tokens: 50,
        isActive: true
      });
      expect(sessions[1]).toMatchObject({
        id: 'session1',
        project: 'nerd',
        tokens: 100,
        isActive: false
      });
      expect(sessions[2]).toMatchObject({
        id: 'session4',
        project: 'project',
        tokens: 150,
        isActive: false
      });
    });

    it('should handle home directory project correctly', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['session1.jsonl'] as any);

      mockFs.statSync.mockReturnValueOnce({ 
        mtime: new Date('2023-01-01T12:00:00Z'), 
        size: 1000 
      } as any);

      const sessions = await listSessions();

      expect(sessions[0].project).toBe('user');
    });

    it('should filter out .save files', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-test', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce([
          'session1.jsonl',
          'session2.jsonl.save',
          'session3.jsonl'
        ] as any);

      mockFs.statSync
        .mockReturnValueOnce({ mtime: new Date(), size: 1000 } as any)
        .mockReturnValueOnce({ mtime: new Date(), size: 2000 } as any);

      const sessions = await listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.id)).toEqual(['session1', 'session3']);
    });

    it('should sort sessions by last modified time (most recent first)', async () => {
      const oldDate = new Date('2023-01-01T12:00:00Z');
      const newDate = new Date('2023-01-02T12:00:00Z');
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-test', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['old-session.jsonl', 'new-session.jsonl'] as any);

      mockFs.statSync
        .mockReturnValueOnce({ mtime: oldDate, size: 1000 } as any)
        .mockReturnValueOnce({ mtime: newDate, size: 2000 } as any);

      const sessions = await listSessions();

      expect(sessions[0].id).toBe('new-session');
      expect(sessions[1].id).toBe('old-session');
    });

    it('should calculate tokens from file size', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-test', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['session.jsonl'] as any);

      mockFs.statSync.mockReturnValueOnce({ 
        mtime: new Date(), 
        size: 12345 
      } as any);

      const sessions = await listSessions();

      expect(sessions[0].tokens).toBe(Math.round(12345 / 100));
    });

    it('should detect active sessions (modified < 5 minutes ago)', async () => {
      const now = Date.now();
      const recentTime = new Date(now - 2 * 60 * 1000); // 2 minutes ago
      const oldTime = new Date(now - 10 * 60 * 1000); // 10 minutes ago

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-test', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['recent.jsonl', 'old.jsonl'] as any);

      mockFs.statSync
        .mockReturnValueOnce({ mtime: recentTime, size: 1000 } as any)
        .mockReturnValueOnce({ mtime: oldTime, size: 1000 } as any);

      const sessions = await listSessions();

      expect(sessions[0].isActive).toBe(true);
      expect(sessions[1].isActive).toBe(false);
    });

    it('should handle multiple project directories', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-project1', isDirectory: () => true },
          { name: '-home-user-projects-project2', isDirectory: () => true },
          { name: 'not-a-directory.txt', isDirectory: () => false }
        ] as any)
        .mockReturnValueOnce(['session1.jsonl'] as any)
        .mockReturnValueOnce(['session2.jsonl'] as any);

      mockFs.statSync
        .mockReturnValueOnce({ mtime: new Date(), size: 1000 } as any)
        .mockReturnValueOnce({ mtime: new Date(), size: 2000 } as any);

      const sessions = await listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.project)).toEqual(['project1', 'project2']);
    });

    it('should extract project name from directory correctly', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-brutus-home-projects-token-nerd', isDirectory: () => true },
          { name: '-home-user-projects-my-awesome-project', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['session1.jsonl'] as any)
        .mockReturnValueOnce(['session2.jsonl'] as any);

      mockFs.statSync
        .mockReturnValueOnce({ mtime: new Date(), size: 1000 } as any)
        .mockReturnValueOnce({ mtime: new Date(), size: 2000 } as any);

      const sessions = await listSessions();

      expect(sessions[0].project).toBe('nerd');
      expect(sessions[1].project).toBe('project');
    });

    it('should include session file path', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-test', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['session123.jsonl'] as any);

      mockFs.statSync.mockReturnValueOnce({ 
        mtime: new Date(), 
        size: 1000 
      } as any);

      const sessions = await listSessions();

      expect(sessions[0].path).toContain('/session123.jsonl');
    });
  });

  describe('selectSession', () => {
    it('should return null when no sessions are found', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await selectSession();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith('No Claude Code sessions found');
      consoleSpy.mockRestore();
    });

    it('should prompt user to select from available sessions', async () => {
      const mockDate = new Date('2023-01-01T12:00:00Z');
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-test', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['session1.jsonl', 'session2.jsonl'] as any);

      mockFs.statSync
        .mockReturnValueOnce({ mtime: mockDate, size: 1000 } as any)
        .mockReturnValueOnce({ mtime: new Date(Date.now() - 1000), size: 2000 } as any);

      mockInquirer.prompt.mockResolvedValue({ sessionId: 'session2' });

      const result = await selectSession();

      expect(result).toBe('session2');
      expect(mockInquirer.prompt).toHaveBeenCalledWith([
        {
          type: 'list',
          name: 'sessionId',
          message: 'Select session (↑↓ to navigate, Enter to select):',
          choices: [
            {
              name: '● session2 (test) - 20 tokens [ACTIVE]',
              value: 'session2'
            },
            {
              name: '○ session1 (test) - 10 tokens ',
              value: 'session1'
            }
          ]
        }
      ]);
    });

    it('should format session choices correctly with active indicators', async () => {
      const recentTime = new Date(Date.now() - 2 * 60 * 1000); // Active
      const oldTime = new Date(Date.now() - 10 * 60 * 1000); // Inactive

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-myproject', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['active123.jsonl', 'inactive456.jsonl'] as any);

      mockFs.statSync
        .mockReturnValueOnce({ mtime: recentTime, size: 5000 } as any)
        .mockReturnValueOnce({ mtime: oldTime, size: 10000 } as any);

      mockInquirer.prompt.mockResolvedValue({ sessionId: 'active123' });

      await selectSession();

      const choices = (mockInquirer.prompt.mock.calls[0][0] as any)[0].choices;
      expect(choices[0].name).toBe('● active12 (myproject) - 50 tokens [ACTIVE]');
      expect(choices[1].name).toBe('○ inactive (myproject) - 100 tokens ');
    });

    it('should handle large token counts with proper formatting', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-large', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['big-session.jsonl'] as any);

      mockFs.statSync.mockReturnValueOnce({ 
        mtime: new Date(Date.now() - 10 * 60 * 1000), 
        size: 1234567 
      } as any);

      mockInquirer.prompt.mockResolvedValue({ sessionId: 'big-session' });

      await selectSession();

      const choices = (mockInquirer.prompt.mock.calls[0][0] as any)[0].choices;
      expect(choices[0].name).toContain('12,346 tokens');
    });

    it('should truncate long session IDs to 8 characters', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-test', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['very-long-session-id-1234567890.jsonl'] as any);

      mockFs.statSync.mockReturnValueOnce({ 
        mtime: new Date(Date.now() - 10 * 60 * 1000), 
        size: 1000 
      } as any);

      mockInquirer.prompt.mockResolvedValue({ sessionId: 'very-long-session-id-1234567890' });

      await selectSession();

      const choices = (mockInquirer.prompt.mock.calls[0][0] as any)[0].choices;
      expect(choices[0].name).toContain('very-lon (test)');
    });
  });

  describe('error handling', () => {
    it('should handle fs.readdirSync errors gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(listSessions()).rejects.toThrow('Permission denied');
    });

    it('should handle fs.statSync errors gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-test', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['session.jsonl'] as any);

      mockFs.statSync.mockImplementation(() => {
        throw new Error('Stat failed');
      });

      await expect(listSessions()).rejects.toThrow('Stat failed');
    });

    it('should handle inquirer prompt errors', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-test', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['session.jsonl'] as any);

      mockFs.statSync.mockReturnValueOnce({ 
        mtime: new Date(), 
        size: 1000 
      } as any);

      mockInquirer.prompt.mockRejectedValue(new Error('User cancelled'));

      await expect(selectSession()).rejects.toThrow('User cancelled');
    });
  });

  describe('edge cases', () => {
    it('should handle empty project directories', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-empty', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce([]);

      const sessions = await listSessions();

      expect(sessions).toEqual([]);
    });

    it('should handle project directories with no jsonl files', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-test', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['README.md', 'config.json', 'data.txt'] as any);

      const sessions = await listSessions();

      expect(sessions).toEqual([]);
    });

    it('should handle zero-size files', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: '-home-user-projects-test', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['empty.jsonl'] as any);

      mockFs.statSync.mockReturnValueOnce({ 
        mtime: new Date(), 
        size: 0 
      } as any);

      const sessions = await listSessions();

      expect(sessions[0].tokens).toBe(0);
    });

    it('should handle malformed directory names', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync
        .mockReturnValueOnce([
          { name: 'malformed-directory', isDirectory: () => true },
          { name: '-', isDirectory: () => true },
          { name: '', isDirectory: () => true }
        ] as any)
        .mockReturnValueOnce(['session1.jsonl'] as any)
        .mockReturnValueOnce(['session2.jsonl'] as any)
        .mockReturnValueOnce(['session3.jsonl'] as any);

      mockFs.statSync
        .mockReturnValueOnce({ mtime: new Date(), size: 1000 } as any)
        .mockReturnValueOnce({ mtime: new Date(), size: 1000 } as any)
        .mockReturnValueOnce({ mtime: new Date(), size: 1000 } as any);

      const sessions = await listSessions();

      expect(sessions).toHaveLength(3);
      expect(sessions.map(s => s.project)).toEqual(['directory', 'unknown', 'unknown']);
    });
  });
});