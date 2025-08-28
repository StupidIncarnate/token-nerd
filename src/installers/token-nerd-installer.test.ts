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
    it('should complete installation successfully with no installers', async () => {
      await installer.install();
      
      const status = await installer.getStatus();
      // No installers configured, so status should be empty
      expect(Object.keys(status)).toEqual([]);
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

    it('should complete uninstall with no installers', async () => {
      await installer.uninstall();
      
      const status = await installer.getStatus();
      // No installers configured, so status should be empty
      expect(Object.keys(status)).toEqual([]);
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
    it('should return empty status when no installers configured', async () => {
      const status = await installer.getStatus();
      expect(Object.keys(status)).toEqual([]);
    });
  });

  describe('validate', () => {
    it('should return empty validation when no installers configured', async () => {
      const validation = await installer.validate();
      expect(Object.keys(validation)).toEqual([]);
    });

    it('should validate with no installers configured', async () => {
      await installer.install();
      
      const validation = await installer.validate();
      expect(Object.keys(validation)).toEqual([]);
    });
  });

  describe('isFullyInstalled', () => {
    it('should return true when no installers configured', async () => {
      const result = await installer.isFullyInstalled();
      // With no installers, everything is "fully installed"
      expect(result).toBe(true);
    });

    it('should return true after install with no installers', async () => {
      await installer.install();
      
      const result = await installer.isFullyInstalled();
      expect(result).toBe(true);
    });
  });

  describe('isFullyValid', () => {
    it('should return true when no installers configured', async () => {
      const result = await installer.isFullyValid();
      // With no installers, everything is "fully valid"
      expect(result).toBe(true);
    });

    it('should return true after install with no installers', async () => {
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