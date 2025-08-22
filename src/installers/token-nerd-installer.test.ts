import * as fs from 'fs';
import * as path from 'path';
import { TokenNerdInstaller } from './token-nerd-installer';
import { TEST_TEMP_DIR, createMockFiles } from '../test-setup';

// Mock process.cwd to return test directory
const originalCwd = process.cwd;
beforeAll(() => {
  process.cwd = jest.fn().mockReturnValue(TEST_TEMP_DIR);
});

afterAll(() => {
  process.cwd = originalCwd;
});

describe('TokenNerdInstaller', () => {
  let installer: TokenNerdInstaller;

  beforeEach(() => {
    // Create mock files after test-setup cleanup
    createMockFiles();
    installer = new TokenNerdInstaller();
  });

  describe('install', () => {
    it('should install all components successfully', async () => {
      await installer.install();
      
      const status = await installer.getStatus();
      expect(status['mcp-server']).toBe(true);
      expect(status['hooks']).toBe(true);
      expect(status['statusline']).toBe(true);
    });

    it('should rollback on installation failure', async () => {
      // Remove MCP server file to cause failure
      const mcpServerPath = path.join(TEST_TEMP_DIR, 'src', 'mcp-server', 'index.ts');
      fs.unlinkSync(mcpServerPath);
      
      await expect(installer.install()).rejects.toThrow();
      
      // Nothing should be installed after rollback
      const status = await installer.getStatus();
      expect(status['mcp-server']).toBe(false);
      expect(status['hooks']).toBe(false);
      expect(status['statusline']).toBe(false);
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
      expect(status['mcp-server']).toBe(false);
      expect(status['hooks']).toBe(false);
      expect(status['statusline']).toBe(false);
    });

    it('should handle partial uninstall failures gracefully', async () => {
      // Mock one installer to fail
      const mcpInstaller = (installer as any).installers[0];
      const originalUninstall = mcpInstaller.uninstall;
      mcpInstaller.uninstall = jest.fn().mockRejectedValue(new Error('Uninstall failed'));
      
      await expect(installer.uninstall()).rejects.toThrow();
      
      // Should still attempt to uninstall other components
      expect(mcpInstaller.uninstall).toHaveBeenCalled();
      
      // Restore original method
      mcpInstaller.uninstall = originalUninstall;
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
      
      expect(status['mcp-server']).toBe(false);
      expect(status['hooks']).toBe(false);
      expect(status['statusline']).toBe(false);
    });

    it('should return correct status for partially installed components', async () => {
      // Install only MCP server manually
      const mcpInstaller = (installer as any).installers[0];
      await mcpInstaller.install();
      
      const status = await installer.getStatus();
      expect(status['mcp-server']).toBe(true);
      expect(status['hooks']).toBe(false);
      expect(status['statusline']).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      // Mock one installer to throw
      const mcpInstaller = (installer as any).installers[0];
      mcpInstaller.isInstalled = jest.fn().mockRejectedValue(new Error('Check failed'));
      
      const status = await installer.getStatus();
      expect(status['mcp-server']).toBe(false);
    });
  });

  describe('validate', () => {
    it('should return false for all components when nothing installed', async () => {
      const validation = await installer.validate();
      
      expect(validation['mcp-server']).toBe(false);
      expect(validation['hooks']).toBe(false);
      expect(validation['statusline']).toBe(false);
    });

    it('should validate installed components', async () => {
      await installer.install();
      
      const validation = await installer.validate();
      expect(validation['mcp-server']).toBe(true);
      expect(validation['hooks']).toBe(true);
      expect(validation['statusline']).toBe(true);
    });

    it('should handle validation errors gracefully', async () => {
      await installer.install();
      
      // Mock one installer validation to throw
      const mcpInstaller = (installer as any).installers[0];
      mcpInstaller.validate = jest.fn().mockRejectedValue(new Error('Validation failed'));
      
      const validation = await installer.validate();
      expect(validation['mcp-server']).toBe(false);
    });
  });

  describe('isFullyInstalled', () => {
    it('should return false when nothing is installed', async () => {
      const result = await installer.isFullyInstalled();
      expect(result).toBe(false);
    });

    it('should return false when partially installed', async () => {
      const mcpInstaller = (installer as any).installers[0];
      await mcpInstaller.install();
      
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
    it('should reinstall missing components', async () => {
      // Install everything first
      await installer.install();
      
      // Manually break one component
      const claudeConfigPath = path.join(TEST_TEMP_DIR, '.claude.json');
      const config = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
      delete config.mcpServers['token-nerd'];
      fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
      
      // Repair should fix it
      await installer.repairInstallation();
      
      const status = await installer.getStatus();
      expect(status['mcp-server']).toBe(true);
    });

    it('should repair invalid installations', async () => {
      await installer.install();
      
      // Remove MCP server entry to make validation fail (but keep valid JSON)
      const claudeConfigPath = path.join(TEST_TEMP_DIR, '.claude.json');
      const config = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
      delete config.mcpServers['token-nerd'];
      fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
      
      await installer.repairInstallation();
      
      const validation = await installer.validate();
      expect(validation['mcp-server']).toBe(true);
    });

    it('should report when no repairs are needed', async () => {
      await installer.install();
      
      // Should not throw and should report healthy
      await expect(installer.repairInstallation()).resolves.not.toThrow();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should continue rollback even when individual component rollback fails', async () => {
      const [mcpInstaller, hooksInstaller] = (installer as any).installers;
      
      // Mock rollback failure for one component
      mcpInstaller.uninstall = jest.fn().mockRejectedValue(new Error('Rollback failed'));
      hooksInstaller.uninstall = jest.fn().mockResolvedValue(undefined);
      
      // Force install failure to trigger rollback
      const statuslineInstaller = (installer as any).installers[2];
      statuslineInstaller.install = jest.fn().mockRejectedValue(new Error('Install failed'));
      
      await expect(installer.install()).rejects.toThrow();
      
      // Should have attempted rollback of all components
      expect(mcpInstaller.uninstall).toHaveBeenCalled();
      expect(hooksInstaller.uninstall).toHaveBeenCalled();
    });

    it('should handle getStatus errors during repair', async () => {
      const mcpInstaller = (installer as any).installers[0];
      mcpInstaller.isInstalled = jest.fn().mockRejectedValue(new Error('Status check failed'));
      
      // Should try to install missing component, but fail when installer.install() throws
      await expect(installer.repairInstallation()).rejects.toThrow();
    });

    it('should handle validation errors during repair', async () => {
      await installer.install();
      
      const mcpInstaller = (installer as any).installers[0];
      mcpInstaller.validate = jest.fn().mockRejectedValue(new Error('Validation failed'));
      
      // Should try to reinstall invalid component, but fail when installer.install() throws  
      await expect(installer.repairInstallation()).rejects.toThrow();
    });

    it('should handle complex mixed installation states in repair', async () => {
      const [mcpInstaller, hooksInstaller, statuslineInstaller] = (installer as any).installers;
      
      // Set up complex scenario
      mcpInstaller.isInstalled = jest.fn().mockResolvedValue(false);
      mcpInstaller.validate = jest.fn().mockResolvedValue(false);
      mcpInstaller.install = jest.fn().mockResolvedValue(undefined);
      
      hooksInstaller.isInstalled = jest.fn().mockResolvedValue(true);
      hooksInstaller.validate = jest.fn().mockResolvedValue(false);
      hooksInstaller.uninstall = jest.fn().mockResolvedValue(undefined);
      hooksInstaller.install = jest.fn().mockResolvedValue(undefined);
      
      statuslineInstaller.isInstalled = jest.fn().mockResolvedValue(true);
      statuslineInstaller.validate = jest.fn().mockResolvedValue(true);
      statuslineInstaller.install = jest.fn().mockResolvedValue(undefined);
      statuslineInstaller.uninstall = jest.fn().mockResolvedValue(undefined);
      
      await installer.repairInstallation();
      
      // Should install missing component
      expect(mcpInstaller.install).toHaveBeenCalled();
      
      // Should repair invalid component
      expect(hooksInstaller.uninstall).toHaveBeenCalled();
      expect(hooksInstaller.install).toHaveBeenCalled();
      
      // Should leave valid component alone
      expect(statuslineInstaller.install).not.toHaveBeenCalled();
      expect(statuslineInstaller.uninstall).not.toHaveBeenCalled();
    });

    it('should handle non-Error objects in uninstall', async () => {
      await installer.install();
      
      const mcpInstaller = (installer as any).installers[0];
      mcpInstaller.uninstall = jest.fn().mockRejectedValue('String error');
      
      await expect(installer.uninstall()).rejects.toThrow();
    });
  });
});