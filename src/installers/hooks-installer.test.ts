import * as fs from 'fs';
import * as path from 'path';
import { HooksInstaller } from './hooks-installer';
import { TEST_TEMP_DIR, TEST_HOOKS_DIR, TEST_CLAUDE_DIR, createMockFiles } from '../test-setup';

// Mock process.cwd to return test directory
const originalCwd = process.cwd;
beforeAll(() => {
  process.cwd = jest.fn().mockReturnValue(TEST_TEMP_DIR);
});

afterAll(() => {
  process.cwd = originalCwd;
});

describe('HooksInstaller', () => {
  let installer: HooksInstaller;
  let sourceDir: string;

  beforeEach(() => {
    createMockFiles();
    installer = new HooksInstaller();
    sourceDir = path.join(TEST_TEMP_DIR, 'src', 'hooks');
  });

  describe('doInstall', () => {
    it('should create symlinks for all hooks', async () => {
      await installer.doInstall();
      
      const preHookPath = path.join(TEST_HOOKS_DIR, 'pre-tool-use');
      const postHookPath = path.join(TEST_HOOKS_DIR, 'post-tool-use');
      
      expect(fs.existsSync(preHookPath)).toBe(true);
      expect(fs.existsSync(postHookPath)).toBe(true);
      
      expect(fs.lstatSync(preHookPath).isSymbolicLink()).toBe(true);
      expect(fs.lstatSync(postHookPath).isSymbolicLink()).toBe(true);
      
      const preTarget = fs.readlinkSync(preHookPath);
      const postTarget = fs.readlinkSync(postHookPath);
      
      expect(preTarget).toBe(path.join(sourceDir, 'pre-tool-use.ts'));
      expect(postTarget).toBe(path.join(sourceDir, 'post-tool-use.ts'));
    });

    it('should configure hooks in settings.json', async () => {
      await installer.doInstall();
      
      const settingsPath = path.join(TEST_CLAUDE_DIR, 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);
      
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.PostToolUse).toBeDefined();
      
      const preConfig = settings.hooks.PreToolUse[0];
      const postConfig = settings.hooks.PostToolUse[0];
      
      expect(preConfig.matcher).toBe('*');
      expect(preConfig.hooks[0].type).toBe('command');
      expect(preConfig.hooks[0].command).toContain('pre-tool-use');
      
      expect(postConfig.matcher).toBe('*');
      expect(postConfig.hooks[0].type).toBe('command');
      expect(postConfig.hooks[0].command).toContain('post-tool-use');
    });

    it('should preserve existing settings.json content', async () => {
      const settingsPath = path.join(TEST_CLAUDE_DIR, 'settings.json');
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

    it('should make hooks executable', async () => {
      await installer.doInstall();
      
      const preHookPath = path.join(TEST_HOOKS_DIR, 'pre-tool-use');
      const postHookPath = path.join(TEST_HOOKS_DIR, 'post-tool-use');
      
      const preStats = fs.statSync(preHookPath);
      const postStats = fs.statSync(postHookPath);
      
      // Check if executable bit is set
      expect(preStats.mode & parseInt('111', 8)).toBeTruthy();
      expect(postStats.mode & parseInt('111', 8)).toBeTruthy();
    });

    it('should skip if hook already installed', async () => {
      await installer.doInstall();
      
      // Install again - should not throw
      await expect(installer.doInstall()).resolves.not.toThrow();
    });

    it('should backup and replace existing non-symlink hooks', async () => {
      const preHookPath = path.join(TEST_HOOKS_DIR, 'pre-tool-use');
      
      // Create existing hook file (not symlink)
      fs.writeFileSync(preHookPath, 'existing hook content');
      
      await installer.doInstall();
      
      // Should be symlink now
      expect(fs.lstatSync(preHookPath).isSymbolicLink()).toBe(true);
      
      // Check that backup was created
      const backupManager = (installer as any).backupManager;
      const backups = await backupManager.getBackupsForComponent('hooks');
      expect(backups.length).toBeGreaterThan(0);
    });

    it('should throw error if source hook file does not exist', async () => {
      fs.unlinkSync(path.join(sourceDir, 'pre-tool-use.ts'));
      
      await expect(installer.doInstall()).rejects.toThrow('Source hook not found');
    });

    it('should create hooks directory if it does not exist', async () => {
      fs.rmSync(TEST_HOOKS_DIR, { recursive: true, force: true });
      
      await installer.doInstall();
      
      expect(fs.existsSync(TEST_HOOKS_DIR)).toBe(true);
    });
  });

  describe('doUninstall', () => {
    beforeEach(async () => {
      await installer.doInstall();
    });

    it('should remove symlinks created by installer', async () => {
      const preHookPath = path.join(TEST_HOOKS_DIR, 'pre-tool-use');
      const postHookPath = path.join(TEST_HOOKS_DIR, 'post-tool-use');
      
      expect(fs.existsSync(preHookPath)).toBe(true);
      expect(fs.existsSync(postHookPath)).toBe(true);
      
      await installer.doUninstall();
      
      expect(fs.existsSync(preHookPath)).toBe(false);
      expect(fs.existsSync(postHookPath)).toBe(false);
    });

    it('should remove hook configuration from settings.json', async () => {
      const settingsPath = path.join(TEST_CLAUDE_DIR, 'settings.json');
      
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
      const settingsPath = path.join(TEST_CLAUDE_DIR, 'settings.json');
      
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

    it('should not remove non-symlink hooks', async () => {
      const preHookPath = path.join(TEST_HOOKS_DIR, 'pre-tool-use');
      
      // Remove symlink and create regular file
      fs.unlinkSync(preHookPath);
      fs.writeFileSync(preHookPath, 'user hook content');
      
      await installer.doUninstall();
      
      // Should still exist
      expect(fs.existsSync(preHookPath)).toBe(true);
      expect(fs.readFileSync(preHookPath, 'utf-8')).toBe('user hook content');
    });

    it('should not remove symlinks pointing to different targets', async () => {
      const preHookPath = path.join(TEST_HOOKS_DIR, 'pre-tool-use');
      
      // Create a real target file for the symlink
      const otherTarget = path.join(TEST_TEMP_DIR, 'other-hook.ts');
      fs.writeFileSync(otherTarget, '// Other hook');
      
      // Remove our symlink and create one pointing elsewhere
      fs.unlinkSync(preHookPath);
      fs.symlinkSync(otherTarget, preHookPath);
      
      await installer.doUninstall();
      
      // Should still exist since it points to different target
      expect(fs.existsSync(preHookPath)).toBe(true);
      expect(fs.lstatSync(preHookPath).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(preHookPath)).toBe(otherTarget);
    });
  });

  describe('checkInstalled', () => {
    it('should return false if no hooks exist', async () => {
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if only some hooks exist', async () => {
      const preHookPath = path.join(TEST_HOOKS_DIR, 'pre-tool-use');
      fs.symlinkSync(path.join(sourceDir, 'pre-tool-use.ts'), preHookPath);
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if hooks are not symlinks', async () => {
      fs.writeFileSync(path.join(TEST_HOOKS_DIR, 'pre-tool-use'), 'regular file');
      fs.writeFileSync(path.join(TEST_HOOKS_DIR, 'post-tool-use'), 'regular file');
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if symlinks point to wrong targets', async () => {
      fs.symlinkSync('/wrong/path', path.join(TEST_HOOKS_DIR, 'pre-tool-use'));
      fs.symlinkSync('/wrong/path', path.join(TEST_HOOKS_DIR, 'post-tool-use'));
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if hooks exist but settings.json not configured', async () => {
      // Create hook files but not settings.json configuration
      const preHookPath = path.join(TEST_HOOKS_DIR, 'pre-tool-use');
      const postHookPath = path.join(TEST_HOOKS_DIR, 'post-tool-use');
      fs.symlinkSync(path.join(sourceDir, 'pre-tool-use.ts'), preHookPath);
      fs.symlinkSync(path.join(sourceDir, 'post-tool-use.ts'), postHookPath);
      fs.chmodSync(preHookPath, 0o755);
      fs.chmodSync(postHookPath, 0o755);
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if settings.json exists but missing hook configuration', async () => {
      // Create hook files
      const preHookPath = path.join(TEST_HOOKS_DIR, 'pre-tool-use');
      const postHookPath = path.join(TEST_HOOKS_DIR, 'post-tool-use');
      fs.symlinkSync(path.join(sourceDir, 'pre-tool-use.ts'), preHookPath);
      fs.symlinkSync(path.join(sourceDir, 'post-tool-use.ts'), postHookPath);
      fs.chmodSync(preHookPath, 0o755);
      fs.chmodSync(postHookPath, 0o755);
      
      // Create settings.json without hook configuration
      const settingsPath = path.join(TEST_CLAUDE_DIR, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ model: 'opus' }, null, 2));
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return true if all hooks are correctly installed and configured', async () => {
      await installer.doInstall();
      
      const result = await installer.checkInstalled();
      expect(result).toBe(true);
    });
  });

  describe('validateInstallation', () => {
    it('should return false if not installed', async () => {
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });

    it('should return false if source files are missing', async () => {
      await installer.doInstall();
      
      // Remove source file
      fs.unlinkSync(path.join(sourceDir, 'pre-tool-use.ts'));
      
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });

    it('should return false if hooks are not executable', async () => {
      await installer.doInstall();
      
      // Remove executable permission
      const preHookPath = path.join(TEST_HOOKS_DIR, 'pre-tool-use');
      fs.chmodSync(preHookPath, 0o644);
      
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });

    it('should return true if everything is valid', async () => {
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

  describe('Error Handling', () => {
    it('should handle broken symlinks during install', async () => {
      const preHookPath = path.join(TEST_HOOKS_DIR, 'pre-tool-use');
      const postHookPath = path.join(TEST_HOOKS_DIR, 'post-tool-use');
      fs.symlinkSync('/nonexistent/path', preHookPath);
      
      await installer.doInstall();
      
      // Should replace broken symlink and create the missing one
      expect(fs.lstatSync(preHookPath).isSymbolicLink()).toBe(true);
      expect(fs.lstatSync(postHookPath).isSymbolicLink()).toBe(true);
      const preTarget = fs.readlinkSync(preHookPath);
      const postTarget = fs.readlinkSync(postHookPath);
      expect(preTarget).toBe(path.join(sourceDir, 'pre-tool-use.ts'));
      expect(postTarget).toBe(path.join(sourceDir, 'post-tool-use.ts'));
    });

    it('should return false if hooks directory does not exist during validation', async () => {
      await installer.doInstall();
      fs.rmSync(TEST_HOOKS_DIR, { recursive: true });
      
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });

    it('should handle case where source directory does not exist', async () => {
      fs.rmSync(sourceDir, { recursive: true, force: true });
      
      await expect(installer.doInstall()).rejects.toThrow('Source hook not found');
    });

    it('should handle partial installation state', async () => {
      // Install only one hook manually
      const preHookPath = path.join(TEST_HOOKS_DIR, 'pre-tool-use');
      fs.symlinkSync(path.join(sourceDir, 'pre-tool-use.ts'), preHookPath);
      fs.chmodSync(preHookPath, 0o755);
      
      await installer.doInstall();
      
      // Should complete the installation
      const result = await installer.checkInstalled();
      expect(result).toBe(true);
    });
  });
});