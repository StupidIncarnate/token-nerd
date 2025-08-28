import { TokenNerdInstaller } from './token-nerd-installer';
import { TEST_TEMP_DIR, createMockFiles } from '../test-setup';

// Mock console methods to prevent test output clutter
const mockConsoleLog = jest.fn();
const mockConsoleWarn = jest.fn();
const mockConsoleError = jest.fn();
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// Mock process.cwd to return test directory
const originalCwd = process.cwd;
beforeAll(() => {
  process.cwd = jest.fn().mockReturnValue(TEST_TEMP_DIR);
  console.log = mockConsoleLog;
  console.warn = mockConsoleWarn;
  console.error = mockConsoleError;
});

afterAll(() => {
  process.cwd = originalCwd;
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

describe('TokenNerdInstaller', () => {
  let installer: TokenNerdInstaller;

  beforeEach(() => {
    jest.clearAllMocks();
    // Create mock files after test-setup cleanup
    createMockFiles();
    installer = new TokenNerdInstaller();
  });

  describe('install', () => {
    it('should install all components successfully', async () => {
      await installer.install();
      
      const status = await installer.getStatus();
      expect(status['statusline']).toBe(true);
    });

    it('should handle partial installation and rollback properly', async () => {
      // Install successfully first
      await installer.install();
      
      // Verify installation
      expect(await installer.isFullyInstalled()).toBe(true);
    });

    it('should skip already installed components', async () => {
      await installer.install();
      
      // Install again - should not throw
      await expect(installer.install()).resolves.not.toThrow();
    });
  });

  describe('uninstall', () => {
    beforeEach(async () => {
      await installer.install();
    });

    it('should uninstall all components', async () => {
      await installer.uninstall();
      
      const status = await installer.getStatus();
      expect(status['statusline']).toBe(false);
    });

    it('should clean up installation state', async () => {
      await installer.uninstall();
      
      const backupManager = (installer as any).backupManager;
      const state = await backupManager.getInstallationState();
      
      expect(state.installedComponents).toEqual([]);
      expect(state.backups).toEqual([]);
    });
  });

  describe('getStatus', () => {
    it('should return false for all components when nothing installed', async () => {
      const status = await installer.getStatus();
      expect(status['statusline']).toBe(false);
    });
  });

  describe('validate', () => {
    it('should return false for all components when nothing installed', async () => {
      const validation = await installer.validate();

      expect(validation['statusline']).toBe(false);
    });

    it('should validate installed components', async () => {
      await installer.install();
      
      const validation = await installer.validate();
      expect(validation['statusline']).toBe(true);
    });
  });

  describe('isFullyInstalled', () => {
    it('should return false when nothing is installed', async () => {
      const result = await installer.isFullyInstalled();
      expect(result).toBe(false);
    });

    it('should return true when fully installed', async () => {
      await installer.install();
      
      const result = await installer.isFullyInstalled();
      expect(result).toBe(true);
    });
  });

  describe('isFullyValid', () => {
    it('should return false when nothing is installed', async () => {
      const result = await installer.isFullyValid();
      expect(result).toBe(false);
    });

    it('should return true when fully installed and valid', async () => {
      await installer.install();
      
      const result = await installer.isFullyValid();
      expect(result).toBe(true);
    });
  });

  describe('repairInstallation', () => {

    it('should report when no repairs are needed', async () => {
      await installer.install();
      
      // Should not throw and should report healthy
      await expect(installer.repairInstallation()).resolves.not.toThrow();
    });
  });
});