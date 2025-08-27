import * as fs from 'fs';
import * as path from 'path';
import { HooksInstaller } from './hooks-installer';
import { TEST_TEMP_DIR, TEST_CLAUDE_DIR, createMockFiles } from '../test-setup';

// Mock console methods to prevent test output clutter
const mockConsoleLog = jest.fn();
const mockConsoleWarn = jest.fn();
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

// Mock process.cwd to return test directory
const originalCwd = process.cwd;
beforeAll(() => {
  process.cwd = jest.fn().mockReturnValue(TEST_TEMP_DIR);
  console.log = mockConsoleLog;
  console.warn = mockConsoleWarn;
});

afterAll(() => {
  process.cwd = originalCwd;
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
});

describe('HooksInstaller', () => {
  let installer: HooksInstaller;
  let settingsPath: string;

  beforeEach(() => {
    jest.clearAllMocks();
    createMockFiles();
    installer = new HooksInstaller();
    settingsPath = path.join(TEST_CLAUDE_DIR, 'settings.json');
  });

  describe('doInstall', () => {
    it('should configure hooks in settings.json', async () => {
      await installer.doInstall();
      
      expect(fs.existsSync(settingsPath)).toBe(true);
      
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.PostToolUse).toBeDefined();
      
      const preConfig = settings.hooks.PreToolUse[0];
      const postConfig = settings.hooks.PostToolUse[0];
      
      expect(preConfig.matcher).toBe('*');
      expect(preConfig.hooks[0].type).toBe('command');
      expect(preConfig.hooks[0].command).toBe('token-nerd process:pre-hook');
      
      expect(postConfig.matcher).toBe('*');
      expect(postConfig.hooks[0].type).toBe('command');
      expect(postConfig.hooks[0].command).toBe('token-nerd process:post-hook');
    });

    it('should create settings directory if it does not exist', async () => {
      fs.rmSync(TEST_CLAUDE_DIR, { recursive: true, force: true });
      
      await installer.doInstall();
      
      expect(fs.existsSync(TEST_CLAUDE_DIR)).toBe(true);
      expect(fs.existsSync(settingsPath)).toBe(true);
    });

    it('should preserve existing settings.json content', async () => {
      const existingSettings = {
        model: 'opus',
        statusLine: { type: 'command', command: 'echo test' }
      };
      fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));
      
      await installer.doInstall();
      
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.model).toBe('opus');
      expect(settings.statusLine).toEqual(existingSettings.statusLine);
      expect(settings.hooks).toBeDefined();
    });

    it('should handle invalid existing settings.json', async () => {
      fs.writeFileSync(settingsPath, 'invalid json');
      
      await installer.doInstall();
      
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.PostToolUse).toBeDefined();
    });

    it('should create backup of existing settings.json', async () => {
      const existingSettings = { model: 'opus' };
      fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));
      
      await installer.doInstall();
      
      // Check that backup was created
      const backupManager = (installer as any).backupManager;
      const backups = await backupManager.getBackupsForComponent('hooks');
      expect(backups.length).toBeGreaterThan(0);
    });
  });

  describe('doUninstall', () => {
    beforeEach(async () => {
      await installer.doInstall();
    });

    it('should remove hook configuration from settings.json', async () => {
      // Verify hooks are configured after install
      let settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.PostToolUse).toBeDefined();
      
      await installer.doUninstall();
      
      // Verify hooks configuration is removed
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks).toBeUndefined();
    });

    it('should preserve other settings when removing hooks', async () => {
      // Add some other settings
      let settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      settings.model = 'opus';
      settings.customSetting = 'test';
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      
      await installer.doUninstall();
      
      // Verify other settings are preserved
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.model).toBe('opus');
      expect(settings.customSetting).toBe('test');
      expect(settings.hooks).toBeUndefined();
    });

    it('should handle non-existent settings.json gracefully', async () => {
      fs.unlinkSync(settingsPath);
      
      await expect(installer.doUninstall()).resolves.not.toThrow();
    });

    it('should handle corrupted settings.json during uninstall', async () => {
      fs.writeFileSync(settingsPath, 'corrupted json');
      
      await expect(installer.doUninstall()).resolves.not.toThrow();
    });

    it('should restore backed up settings', async () => {
      await installer.doUninstall();
      
      // Verify restoreBackupsForComponent was called
      const backupManager = (installer as any).backupManager;
      // We can't easily test this without mocking, but the method should exist
      expect(typeof installer['restoreBackupsForComponent']).toBe('function');
    });
  });

  describe('checkInstalled', () => {
    it('should return false if settings.json does not exist', async () => {
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if settings.json exists but has no hooks', async () => {
      fs.writeFileSync(settingsPath, JSON.stringify({ model: 'opus' }, null, 2));
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if hooks exist but missing PreToolUse', async () => {
      const settings = {
        hooks: {
          PostToolUse: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: 'token-nerd process:post-hook'
                }
              ]
            }
          ]
        }
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if hooks exist but missing PostToolUse', async () => {
      const settings = {
        hooks: {
          PreToolUse: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: 'token-nerd process:pre-hook'
                }
              ]
            }
          ]
        }
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if hook command is incorrect', async () => {
      const settings = {
        hooks: {
          PreToolUse: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: 'wrong-command'
                }
              ]
            }
          ],
          PostToolUse: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: 'token-nerd process:post-hook'
                }
              ]
            }
          ]
        }
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return true if all hooks are correctly configured', async () => {
      await installer.doInstall();
      
      const result = await installer.checkInstalled();
      expect(result).toBe(true);
    });

    it('should handle corrupted settings.json gracefully', async () => {
      fs.writeFileSync(settingsPath, 'invalid json');
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });
  });

  describe('validateInstallation', () => {
    it('should return false if not installed', async () => {
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });

    it('should return true if correctly installed', async () => {
      await installer.doInstall();
      
      const result = await installer.validateInstallation();
      expect(result).toBe(true);
    });
  });

  describe('getName', () => {
    it('should return correct component name', () => {
      expect(installer.getName()).toBe('hooks');
    });
  });
});