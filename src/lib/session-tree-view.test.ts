import * as fs from 'fs';
import * as path from 'path';
import { SessionTreeView, selectSessionWithTreeView } from './session-tree-view';

// Mock console methods to prevent test output clutter
const mockConsoleError = jest.fn();
const originalConsoleError = console.error;

beforeAll(() => {
  console.error = mockConsoleError;
});

afterAll(() => {
  console.error = originalConsoleError;
});

// Mock token calculator
jest.mock('./token-calculator', () => ({
  getTokenCount: jest.fn().mockResolvedValue(100)
}));

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn()
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
import { getTokenCount } from './token-calculator';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;
const mockInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockGetTokenCount = getTokenCount as jest.MockedFunction<typeof getTokenCount>;

describe('SessionTreeView', () => {
  let treeView: SessionTreeView;
  let originalCwd: () => string;
  const mockHomeDir = '/mock/home';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock for getTokenCount
    mockGetTokenCount.mockResolvedValue(100);
    
    // Setup mock implementations
    mockHomedir.mockReturnValue(mockHomeDir);
    mockPath.join.mockImplementation((...parts) => parts.join('/'));
    mockPath.basename.mockImplementation((filepath: string, ext?: string) => {
      const name = filepath.split('/').pop() || '';
      return ext ? name.replace(ext, '') : name;
    });

    // Mock process.cwd
    originalCwd = process.cwd;
    Object.defineProperty(process, 'cwd', {
      value: jest.fn().mockReturnValue('/mock/projects/token-nerd'),
      configurable: true
    });

    treeView = new SessionTreeView();
  });

  afterEach(() => {
    Object.defineProperty(process, 'cwd', { value: originalCwd, configurable: true });
  });

  describe('initialization', () => {
    it('should initialize with empty projects when .claude/projects does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      
      await treeView.initialize();
      
      expect(treeView.getProjectNames()).toEqual([]);
      expect(mockFs.existsSync).toHaveBeenCalledWith(expect.stringContaining('.claude/projects'));
    });

    it('should load projects and sessions when directory exists', async () => {
      mockFs.existsSync.mockReturnValue(true);
      
      // Mock project directories
      const mockDirents = [
        { name: '-home-brutus-home-projects-token-nerd', isDirectory: () => true },
        { name: '-home-brutus-home-projects-other-app', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      
      // Mock session files for each project
      mockFs.readdirSync
        .mockReturnValueOnce(['session1.jsonl', 'session2.jsonl', 'session3.save'] as any)
        .mockReturnValueOnce(['session4.jsonl'] as any);
      
      // Mock file stats
      const mockStats = {
        mtime: new Date('2025-08-22T10:00:00Z'),
        size: 12000
      };
      mockFs.statSync.mockReturnValue(mockStats as any);
      
      await treeView.initialize();
      
      const projectNames = treeView.getProjectNames();
      expect(projectNames).toContain('token-nerd');
      expect(projectNames).toContain('other-app');
      expect(mockFs.readdirSync).toHaveBeenCalledTimes(3); // projects dir + 2 project dirs
    });

    it('should auto-expand current project based on working directory', async () => {
      mockFs.existsSync.mockReturnValue(true);
      
      const mockDirents = [
        { name: '-home-brutus-home-projects-token-nerd', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      mockFs.readdirSync.mockReturnValueOnce(['session1.jsonl'] as any);
      mockFs.statSync.mockReturnValue({
        mtime: new Date('2025-08-22T10:00:00Z'),
        size: 12000
      } as any);

      await treeView.initialize();
      
      expect(treeView.getCurrentProject()).toBe('token-nerd');
    });
  });

  describe('project detection', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      const mockDirents = [
        { name: '-home-brutus-home-projects-token-nerd', isDirectory: () => true },
        { name: '-home-brutus-home-projects-other-app', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      mockFs.readdirSync
        .mockReturnValueOnce(['session1.jsonl'] as any)
        .mockReturnValueOnce(['session2.jsonl'] as any);
      mockFs.statSync.mockReturnValue({
        mtime: new Date('2025-08-22T10:00:00Z'),
        size: 12000
      } as any);
    });

    it('should detect current project by exact name match', async () => {
      (process.cwd as jest.Mock).mockReturnValue('/some/path/token-nerd');
      
      await treeView.initialize();
      
      expect(treeView.getCurrentProject()).toBe('token-nerd');
    });

    it('should detect current project by path inclusion', async () => {
      (process.cwd as jest.Mock).mockReturnValue('/projects/token-nerd/src');
      
      await treeView.initialize();
      
      expect(treeView.getCurrentProject()).toBe('token-nerd');
    });

    it('should handle Windows paths', async () => {
      (process.cwd as jest.Mock).mockReturnValue('C:\\projects\\token-nerd\\src');
      
      await treeView.initialize();
      
      expect(treeView.getCurrentProject()).toBe('token-nerd');
    });

    it('should return null when no current project detected', async () => {
      // Create a new tree view with different working directory
      const originalCwdFn = process.cwd;
      Object.defineProperty(process, 'cwd', {
        value: jest.fn().mockReturnValue('/completely/different/path'),
        configurable: true
      });
      
      const newTreeView = new SessionTreeView();
      await newTreeView.initialize();
      
      expect(newTreeView.getCurrentProject()).toBeNull();
      
      // Restore the original cwd for other tests
      Object.defineProperty(process, 'cwd', { value: originalCwdFn, configurable: true });
    });
  });

  describe('session loading', () => {
    it('should load sessions with correct properties', async () => {
      // First call to existsSync is for the main directory
      mockFs.existsSync.mockReturnValueOnce(true);
      const mockDirents = [
        { name: '-home-brutus-home-projects-token-nerd', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      mockFs.readdirSync.mockReturnValueOnce(['session1.jsonl', 'session2.save'] as any);
      
      const now = new Date();
      const recentTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes ago
      
      // Mock statSync for the session file
      mockFs.statSync.mockReturnValue({
        mtime: recentTime,
        size: 15000
      } as any);
      
      // Subsequent calls to existsSync (for token calculator) return false
      mockFs.existsSync.mockReturnValue(false);
      
      // Override getTokenCount to return 0 for non-existent files
      mockGetTokenCount.mockResolvedValue(0);
      
      await treeView.initialize();
      
      const sessions = treeView.getProjectSessions('token-nerd');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        id: 'session1',
        project: 'token-nerd',
        tokens: 0, // Token calculator returns 0 for non-existent files
        isActive: true,
        path: expect.stringContaining('session1.jsonl')
      });
    });

    it('should exclude .save files', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const mockDirents = [
        { name: '-home-brutus-home-projects-test', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      mockFs.readdirSync.mockReturnValueOnce([
        'session1.jsonl',
        'session2.jsonl.save',
        'session3.save'
      ] as any);
      mockFs.statSync.mockReturnValue({
        mtime: new Date(),
        size: 10000
      } as any);
      
      await treeView.initialize();
      
      const sessions = treeView.getProjectSessions('test');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('session1');
    });

    it('should mark sessions as active if modified within 5 minutes', async () => {
      // First existsSync call for directory
      mockFs.existsSync.mockReturnValueOnce(true);
      const mockDirents = [
        { name: '-home-brutus-home-projects-test', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      mockFs.readdirSync.mockReturnValueOnce(['recent.jsonl', 'old.jsonl'] as any);
      
      const now = new Date();
      const recentTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes ago
      const oldTime = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes ago
      
      mockFs.statSync
        .mockReturnValueOnce({ mtime: recentTime, size: 10000 } as any)
        .mockReturnValueOnce({ mtime: oldTime, size: 10000 } as any);
        
      // Token calculator existsSync calls return false
      mockFs.existsSync.mockReturnValue(false);
      
      await treeView.initialize();
      
      const sessions = treeView.getProjectSessions('test');
      expect(sessions.find(s => s.id === 'recent')?.isActive).toBe(true);
      expect(sessions.find(s => s.id === 'old')?.isActive).toBe(false);
    });

    it('should sort sessions by last modified time, most recent first', async () => {
      // First existsSync for directory
      mockFs.existsSync.mockReturnValueOnce(true);
      const mockDirents = [
        { name: '-home-brutus-home-projects-test', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      mockFs.readdirSync.mockReturnValueOnce(['old.jsonl', 'new.jsonl', 'middle.jsonl'] as any);
      
      const oldTime = new Date('2025-08-20T10:00:00Z');
      const middleTime = new Date('2025-08-21T10:00:00Z');
      const newTime = new Date('2025-08-22T10:00:00Z');
      
      mockFs.statSync
        .mockReturnValueOnce({ mtime: oldTime, size: 10000 } as any)
        .mockReturnValueOnce({ mtime: newTime, size: 10000 } as any)
        .mockReturnValueOnce({ mtime: middleTime, size: 10000 } as any);
        
      // Token calculator existsSync calls return false
      mockFs.existsSync.mockReturnValue(false);
      
      await treeView.initialize();
      
      const sessions = treeView.getProjectSessions('test');
      expect(sessions.map(s => s.id)).toEqual(['new', 'middle', 'old']);
    });
  });

  describe('project name extraction', () => {
    it('should handle standard project format', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const mockDirents = [
        { name: '-home-brutus-home-projects-my-awesome-app', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      mockFs.readdirSync.mockReturnValueOnce(['session1.jsonl'] as any);
      mockFs.statSync.mockReturnValue({ mtime: new Date(), size: 10000 } as any);
      
      await treeView.initialize();
      
      expect(treeView.getProjectNames()).toContain('my-awesome-app');
    });

    it('should handle home directory special case', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const mockDirents = [
        { name: '-home-brutus-home', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      mockFs.readdirSync.mockReturnValueOnce(['session1.jsonl'] as any);
      mockFs.statSync.mockReturnValue({ mtime: new Date(), size: 10000 } as any);
      
      await treeView.initialize();
      
      expect(treeView.getProjectNames()).toContain('home');
    });

    it('should handle token-nerd project correctly', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const mockDirents = [
        { name: '-home-brutus-home-projects-token-nerd', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      mockFs.readdirSync.mockReturnValueOnce(['session1.jsonl'] as any);
      mockFs.statSync.mockReturnValue({ mtime: new Date(), size: 10000 } as any);
      
      await treeView.initialize();
      
      expect(treeView.getProjectNames()).toContain('token-nerd');
      expect(treeView.getProjectNames()).not.toContain('nerd');
    });

    it('should skip projects with no sessions', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const mockDirents = [
        { name: '-home-brutus-home-projects-empty', isDirectory: () => true },
        { name: '-home-brutus-home-projects-with-sessions', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      mockFs.readdirSync
        .mockReturnValueOnce([]) // empty project
        .mockReturnValueOnce(['session1.jsonl'] as any); // project with sessions
      mockFs.statSync.mockReturnValue({ mtime: new Date(), size: 10000 } as any);
      
      await treeView.initialize();
      
      const projectNames = treeView.getProjectNames();
      expect(projectNames).not.toContain('empty');
      expect(projectNames).toContain('with-sessions');
    });
  });

  describe('getAllSessions', () => {
    it('should return all sessions from all projects sorted by modification time', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const mockDirents = [
        { name: '-home-brutus-home-projects-app1', isDirectory: () => true },
        { name: '-home-brutus-home-projects-app2', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      mockFs.readdirSync
        .mockReturnValueOnce(['session1.jsonl'] as any)
        .mockReturnValueOnce(['session2.jsonl'] as any);
      
      const time1 = new Date('2025-08-20T10:00:00Z');
      const time2 = new Date('2025-08-22T10:00:00Z');
      
      mockFs.statSync
        .mockReturnValueOnce({ mtime: time1, size: 10000 } as any)
        .mockReturnValueOnce({ mtime: time2, size: 12000 } as any);
      
      await treeView.initialize();
      
      const allSessions = treeView.getAllSessions();
      expect(allSessions).toHaveLength(2);
      expect(allSessions[0].id).toBe('session2'); // most recent first
      expect(allSessions[1].id).toBe('session1');
    });
  });

  describe('selectSessionWithTreeView function', () => {
    it('should return null when no sessions found', async () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const result = await selectSessionWithTreeView();
      
      expect(result).toBeNull();
    });

    it('should prompt user with tree view when sessions exist', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const mockDirents = [
        { name: '-home-brutus-home-projects-token-nerd', isDirectory: () => true }
      ];
      mockFs.readdirSync.mockReturnValueOnce(mockDirents as any);
      mockFs.readdirSync.mockReturnValueOnce(['session1.jsonl'] as any);
      mockFs.statSync.mockReturnValue({ mtime: new Date(), size: 10000 } as any);
      
      mockInquirer.prompt.mockResolvedValueOnce({ selection: 'session1' });
      
      const result = await selectSessionWithTreeView();
      
      expect(result).toBe('session1');
      expect(mockInquirer.prompt).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'list',
          name: 'selection',
          message: 'Select session (↑↓ to navigate, Enter to select/expand):'
        })
      ]);
    });

    it('should handle project expansion and recursively show menu', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const mockDirents = [
        { name: '-home-brutus-home-projects-token-nerd', isDirectory: () => true }
      ];
      
      // Mock the calls in the right order for the recursive behavior
      mockFs.readdirSync
        .mockReturnValueOnce(mockDirents as any) // Projects directory
        .mockReturnValueOnce(['session1.jsonl'] as any); // Sessions in project
      mockFs.statSync.mockReturnValue({ mtime: new Date(), size: 10000 } as any);
      
      // First call returns project expansion, second call returns actual selection
      mockInquirer.prompt
        .mockResolvedValueOnce({ selection: 'project:token-nerd' })
        .mockResolvedValueOnce({ selection: 'session1' });
      
      const result = await selectSessionWithTreeView();
      
      expect(result).toBe('session1');
      expect(mockInquirer.prompt).toHaveBeenCalledTimes(2);
    });
  });
});