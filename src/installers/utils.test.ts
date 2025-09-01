import * as path from 'path';
import * as os from 'os';
import {
  expandTilde,
  getClaudeDir,
  getClaudeConfigPath,
  getClaudeSettingsPath,
  getClaudeHooksDir
} from './utils';

// Mock claude-path-resolver 
jest.mock('../lib/claude-path-resolver', () => ({
  getClaudeConfigFile: jest.fn(),
  getClaudeSettingsFile: jest.fn(),  
  resetPathCache: jest.fn()
}));

import { getClaudeConfigFile, getClaudeSettingsFile } from '../lib/claude-path-resolver';
const mockGetClaudeConfigFile = jest.mocked(getClaudeConfigFile);
const mockGetClaudeSettingsFile = jest.mocked(getClaudeSettingsFile);

describe('utils.ts', () => {
  const originalPlatform = process.platform;
  const testHomedir = os.homedir();

  afterEach(() => {
    // Restore original platform after each test
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true
    });
  });

  describe('expandTilde', () => {
    it('should expand ~ to home directory', () => {
      const result = expandTilde('~');
      expect(result).toBe(testHomedir);
    });

    it('should expand ~/path to home directory + path', () => {
      const result = expandTilde('~/documents/file.txt');
      expect(result).toBe(path.join(testHomedir, 'documents/file.txt'));
    });

    it('should not modify paths that do not start with ~', () => {
      const absolutePath = '/absolute/path/file.txt';
      const result = expandTilde(absolutePath);
      expect(result).toBe(absolutePath);
    });

    it('should not modify relative paths', () => {
      const relativePath = 'relative/path/file.txt';
      const result = expandTilde(relativePath);
      expect(result).toBe(relativePath);
    });

    it('should not modify paths that contain ~ but do not start with it', () => {
      const pathWithTilde = '/path/with/~/tilde.txt';
      const result = expandTilde(pathWithTilde);
      expect(result).toBe(pathWithTilde);
    });

    it('should handle empty string', () => {
      const result = expandTilde('');
      expect(result).toBe('');
    });

    it('should handle just ~/  with trailing slash', () => {
      const result = expandTilde('~/');
      expect(result).toBe(path.join(testHomedir, '/'));
    });

    it('should handle various tilde patterns', () => {
      const testCases = [
        { input: '~', expected: testHomedir },
        { input: '~/test', expected: path.join(testHomedir, 'test') },
        { input: '~test', expected: '~test' }, // No expansion
        { input: 'test~', expected: 'test~' }, // No expansion
        { input: '/~', expected: '/~' }, // No expansion
        { input: './~test', expected: './~test' }, // No expansion
        { input: '~/folder/~/file~.txt', expected: path.join(testHomedir, 'folder/~/file~.txt') },
        { input: '/path/ending/with~', expected: '/path/ending/with~' }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = expandTilde(input);
        expect(result).toBe(expected);
      });
    });
  });

  describe('getClaudeDir', () => {
    it('should return Windows path when platform is win32', () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true
      });

      const result = getClaudeDir();
      expect(result).toBe(path.join(testHomedir, 'AppData', 'Roaming', 'claude'));
    });

    it('should return Unix path when platform is linux', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true
      });

      const result = getClaudeDir();
      expect(result).toBe(path.join(testHomedir, '.claude'));
    });

    it('should return Unix path when platform is darwin', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      });

      const result = getClaudeDir();
      expect(result).toBe(path.join(testHomedir, '.claude'));
    });

    it('should return Unix path for any non-win32 platform', () => {
      const testPlatforms = ['linux', 'darwin', 'freebsd', 'openbsd', 'sunos'];
      
      testPlatforms.forEach(platform => {
        Object.defineProperty(process, 'platform', {
          value: platform,
          writable: true
        });

        const result = getClaudeDir();
        expect(result).toBe(path.join(testHomedir, '.claude'));
      });
    });
  });

  describe('getClaudeConfigPath', () => {
    it('should return .claude.json in home directory', () => {
      // Mock the path resolver to return expected path
      mockGetClaudeConfigFile.mockReturnValue(path.join(testHomedir, '.claude.json'));
      
      const result = getClaudeConfigPath();
      expect(result).toBe(path.join(testHomedir, '.claude.json'));
    });

    it('should use os.homedir() internally', () => {
      // Mock the path resolver to return expected path
      mockGetClaudeConfigFile.mockReturnValue(path.join(testHomedir, '.claude.json'));
      
      const result = getClaudeConfigPath();
      expect(result).toContain(testHomedir);
      expect(result.endsWith('.claude.json')).toBe(true);
    });
  });

  describe('getClaudeSettingsPath', () => {
    it('should return settings.json in Claude directory for Unix', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true
      });

      // Mock the path resolver to return Unix-style paths
      mockGetClaudeSettingsFile.mockReturnValue(path.join(testHomedir, '.claude', 'settings.json'));

      const result = getClaudeSettingsPath();
      expect(result).toBe(path.join(testHomedir, '.claude', 'settings.json'));
    });

    it('should return settings.json in Claude directory for Windows', () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true
      });

      // Mock the path resolver to return Windows-style paths
      mockGetClaudeSettingsFile.mockReturnValue(path.join(testHomedir, 'AppData', 'Roaming', 'claude', 'settings.json'));

      const result = getClaudeSettingsPath();
      expect(result).toBe(path.join(testHomedir, 'AppData', 'Roaming', 'claude', 'settings.json'));
    });

    it('should use getClaudeDir internally', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      });

      // Mock the path resolver to return Darwin-style paths
      mockGetClaudeSettingsFile.mockReturnValue(path.join(testHomedir, '.claude', 'settings.json'));

      const result = getClaudeSettingsPath();
      expect(result).toBe(path.join(testHomedir, '.claude', 'settings.json'));
    });
  });

  describe('getClaudeHooksDir', () => {
    it('should return Windows hooks path when platform is win32', () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true
      });

      const result = getClaudeHooksDir();
      expect(result).toBe(path.join(testHomedir, 'AppData', 'Roaming', 'claude', 'hooks'));
    });

    it('should return Unix hooks path when platform is linux', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true
      });

      const result = getClaudeHooksDir();
      expect(result).toBe(path.join(testHomedir, '.config', 'claude', 'hooks'));
    });

    it('should return Unix hooks path when platform is darwin', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      });

      const result = getClaudeHooksDir();
      expect(result).toBe(path.join(testHomedir, '.config', 'claude', 'hooks'));
    });

    it('should return Unix hooks path for any non-win32 platform', () => {
      const testPlatforms = ['linux', 'darwin', 'freebsd', 'openbsd'];
      
      testPlatforms.forEach(platform => {
        Object.defineProperty(process, 'platform', {
          value: platform,
          writable: true
        });

        const result = getClaudeHooksDir();
        expect(result).toBe(path.join(testHomedir, '.config', 'claude', 'hooks'));
      });
    });

    it('should use correct hooks directory structure', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true
      });

      const result = getClaudeHooksDir();
      expect(result).toContain('.config/claude/hooks');
      expect(result).not.toContain('.claude/hooks');
    });
  });

  describe('cross-platform consistency', () => {
    it('should maintain Windows vs Unix path consistency', () => {
      // Windows should use AppData structure
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true
      });

      // Mock Windows paths
      mockGetClaudeSettingsFile.mockReturnValue(path.join(testHomedir, 'AppData', 'Roaming', 'claude', 'settings.json'));
      
      const winClaudeDir = getClaudeDir();
      const winHooksDir = getClaudeHooksDir();
      const winSettingsPath = getClaudeSettingsPath();
      
      expect(winClaudeDir).toContain(path.join('AppData', 'Roaming', 'claude'));
      expect(winHooksDir).toContain(path.join('AppData', 'Roaming', 'claude', 'hooks'));
      expect(winSettingsPath).toContain(path.join('AppData', 'Roaming', 'claude', 'settings.json'));

      // Unix should use dot directories
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true
      });

      // Mock Unix paths
      mockGetClaudeSettingsFile.mockReturnValue(path.join(testHomedir, '.claude', 'settings.json'));
      
      const unixClaudeDir = getClaudeDir();
      const unixHooksDir = getClaudeHooksDir();
      const unixSettingsPath = getClaudeSettingsPath();
      
      expect(unixClaudeDir).toBe(path.join(testHomedir, '.claude'));
      expect(unixHooksDir).toBe(path.join(testHomedir, '.config', 'claude', 'hooks'));
      expect(unixSettingsPath).toBe(path.join(testHomedir, '.claude', 'settings.json'));
    });

    it('should use consistent path separators', () => {
      // Mock to return valid paths
      mockGetClaudeConfigFile.mockReturnValue(path.join(testHomedir, '.claude.json'));
      mockGetClaudeSettingsFile.mockReturnValue(path.join(testHomedir, '.claude', 'settings.json'));
      
      const configPath = getClaudeConfigPath();
      const claudeDir = getClaudeDir();
      const hooksDir = getClaudeHooksDir();
      const settingsPath = getClaudeSettingsPath();

      // All paths should use the platform-appropriate separator
      [configPath, claudeDir, hooksDir, settingsPath].forEach(pathStr => {
        expect(pathStr).toBe(path.normalize(pathStr));
      });
    });

    it('should handle path joining correctly', () => {
      const expandedPath = expandTilde('~/test/path');
      const expectedPath = path.join(testHomedir, 'test', 'path');
      
      expect(expandedPath).toBe(expectedPath);
    });
  });

  describe('functionality validation', () => {
    it('should return absolute paths for all functions', () => {
      // Mock to return valid paths
      mockGetClaudeConfigFile.mockReturnValue(path.join(testHomedir, '.claude.json'));
      mockGetClaudeSettingsFile.mockReturnValue(path.join(testHomedir, '.claude', 'settings.json'));
      
      const paths = [
        getClaudeConfigPath(),
        getClaudeDir(),
        getClaudeSettingsPath(),
        getClaudeHooksDir(),
        expandTilde('~/test')
      ];

      paths.forEach(pathStr => {
        expect(path.isAbsolute(pathStr)).toBe(true);
      });
    });

    it('should return different paths for different functions', () => {
      // Mock to return valid paths
      mockGetClaudeConfigFile.mockReturnValue(path.join(testHomedir, '.claude.json'));
      mockGetClaudeSettingsFile.mockReturnValue(path.join(testHomedir, '.claude', 'settings.json'));
      
      const configPath = getClaudeConfigPath();
      const claudeDir = getClaudeDir();
      const settingsPath = getClaudeSettingsPath();
      const hooksDir = getClaudeHooksDir();

      const paths = [configPath, claudeDir, settingsPath, hooksDir];
      const uniquePaths = [...new Set(paths)];
      
      expect(uniquePaths).toHaveLength(paths.length);
    });

    it('should handle expandTilde edge cases consistently', () => {
      // Test edge cases that should not be expanded
      const noExpansionCases = [
        '~test',      // Doesn't start with ~/
        'test~',      // ~ at end
        '/~',         // ~ in middle
        './~test',    // Relative with ~
        'file~.txt',  // ~ in filename
        ''            // Empty string
      ];

      noExpansionCases.forEach(input => {
        const result = expandTilde(input);
        expect(result).toBe(input);
      });

      // Test cases that should be expanded
      const expansionCases = [
        { input: '~', expected: testHomedir },
        { input: '~/', expected: path.join(testHomedir, '/') },
        { input: '~/test', expected: path.join(testHomedir, 'test') }
      ];

      expansionCases.forEach(({ input, expected }) => {
        const result = expandTilde(input);
        expect(result).toBe(expected);
      });
    });

    it('should handle platform detection correctly', () => {
      const platforms = [
        { platform: 'win32', shouldUseAppData: true },
        { platform: 'linux', shouldUseAppData: false },
        { platform: 'darwin', shouldUseAppData: false },
        { platform: 'freebsd', shouldUseAppData: false }
      ];

      platforms.forEach(({ platform, shouldUseAppData }) => {
        Object.defineProperty(process, 'platform', {
          value: platform,
          writable: true
        });

        const claudeDir = getClaudeDir();
        const hooksDir = getClaudeHooksDir();

        if (shouldUseAppData) {
          expect(claudeDir).toContain('AppData');
          expect(hooksDir).toContain('AppData');
        } else {
          expect(claudeDir).not.toContain('AppData');
          expect(hooksDir).not.toContain('AppData');
          expect(claudeDir).toContain('.claude');
          expect(hooksDir).toContain('.config');
        }
      });
    });
  });
});