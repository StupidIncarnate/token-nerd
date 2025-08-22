import * as fs from 'fs';
import * as path from 'path';
import { McpInstaller } from './mcp-installer';
import { TEST_TEMP_DIR, createMockFiles } from '../test-setup';

// Mock process.cwd to return test directory
const originalCwd = process.cwd;
beforeAll(() => {
  process.cwd = jest.fn().mockReturnValue(TEST_TEMP_DIR);
});

afterAll(() => {
  process.cwd = originalCwd;
});

describe('McpInstaller', () => {
  let installer: McpInstaller;
  let claudeConfigPath: string;
  let mcpServerPath: string;

  beforeEach(() => {
    createMockFiles();
    installer = new McpInstaller();
    claudeConfigPath = path.join(TEST_TEMP_DIR, '.claude.json');
    mcpServerPath = path.join(TEST_TEMP_DIR, 'src', 'mcp-server', 'index.ts');
  });

  describe('doInstall', () => {
    it('should create new claude config if none exists', async () => {
      await installer.doInstall();
      
      expect(fs.existsSync(claudeConfigPath)).toBe(true);
      
      const config = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
      expect(config.mcpServers['token-nerd']).toBeDefined();
      expect(config.mcpServers['token-nerd'].command).toBe('npx');
      expect(config.mcpServers['token-nerd'].args).toEqual(['tsx', mcpServerPath]);
    });

    it('should add to existing claude config', async () => {
      const existingConfig = {
        mcpServers: {
          'other-server': {
            command: 'other-command'
          }
        }
      };
      
      fs.writeFileSync(claudeConfigPath, JSON.stringify(existingConfig, null, 2));
      
      await installer.doInstall();
      
      const config = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
      expect(config.mcpServers['other-server']).toBeDefined();
      expect(config.mcpServers['token-nerd']).toBeDefined();
    });

    it('should not overwrite existing token-nerd config', async () => {
      const existingConfig = {
        mcpServers: {
          'token-nerd': {
            command: 'existing-command'
          }
        }
      };
      
      fs.writeFileSync(claudeConfigPath, JSON.stringify(existingConfig, null, 2));
      
      await installer.doInstall();
      
      const config = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
      expect(config.mcpServers['token-nerd'].command).toBe('existing-command');
    });

    it('should throw error if MCP server file does not exist', async () => {
      fs.unlinkSync(mcpServerPath);
      
      await expect(installer.doInstall()).rejects.toThrow('MCP server not found');
    });

    it('should throw error if config file is invalid JSON', async () => {
      fs.writeFileSync(claudeConfigPath, 'invalid json');
      
      await expect(installer.doInstall()).rejects.toThrow('Failed to parse Claude config');
    });
  });

  describe('doUninstall', () => {
    beforeEach(async () => {
      await installer.doInstall();
    });

    it('should remove token-nerd from claude config', async () => {
      await installer.doUninstall();
      
      const config = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
      expect(config.mcpServers['token-nerd']).toBeUndefined();
    });

    it('should handle non-existent config file gracefully', async () => {
      fs.unlinkSync(claudeConfigPath);
      
      await expect(installer.doUninstall()).resolves.not.toThrow();
    });

    it('should preserve other MCP servers', async () => {
      const config = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
      config.mcpServers['other-server'] = { command: 'other-command' };
      fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
      
      await installer.doUninstall();
      
      const updatedConfig = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
      expect(updatedConfig.mcpServers['other-server']).toBeDefined();
      expect(updatedConfig.mcpServers['token-nerd']).toBeUndefined();
    });
  });

  describe('checkInstalled', () => {
    it('should return false if config file does not exist', async () => {
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if token-nerd is not in config', async () => {
      fs.writeFileSync(claudeConfigPath, JSON.stringify({ mcpServers: {} }, null, 2));
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return true if token-nerd is configured', async () => {
      await installer.doInstall();
      
      const result = await installer.checkInstalled();
      expect(result).toBe(true);
    });

    it('should handle invalid JSON gracefully', async () => {
      fs.writeFileSync(claudeConfigPath, 'invalid json');
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });
  });

  describe('validateInstallation', () => {
    it('should return false if not installed', async () => {
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });

    it('should return false if MCP server file is missing', async () => {
      await installer.doInstall();
      fs.unlinkSync(mcpServerPath);
      
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });

    it('should return true if everything is valid', async () => {
      await installer.doInstall();
      
      const result = await installer.validateInstallation();
      expect(result).toBe(true);
    });

    it('should return false if config structure is invalid', async () => {
      const invalidConfig = {
        mcpServers: {
          'token-nerd': {
            command: 'wrong-command'
          }
        }
      };
      
      fs.writeFileSync(claudeConfigPath, JSON.stringify(invalidConfig, null, 2));
      
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });
  });

  describe('getName', () => {
    it('should return correct component name', () => {
      expect(installer.getName()).toBe('mcp-server');
    });
  });

  describe('Error Handling', () => {
    it('should throw error if config file is corrupted during uninstall', async () => {
      await installer.doInstall();
      
      fs.writeFileSync(claudeConfigPath, 'corrupted json content');
      
      await expect(installer.doUninstall()).rejects.toThrow('Failed to remove MCP server from config');
    });

    it('should handle config without mcpServers section during uninstall', async () => {
      const configWithoutMcpServers = { someOtherProperty: 'value' };
      fs.writeFileSync(claudeConfigPath, JSON.stringify(configWithoutMcpServers));
      
      await installer.doUninstall();
      
      const config = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
      expect(config.someOtherProperty).toBe('value');
    });

    it('should return false when config file is corrupted during validation', async () => {
      await installer.doInstall();
      fs.writeFileSync(claudeConfigPath, 'invalid json');
      
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });

    it('should return false when args is not an array', async () => {
      const invalidConfig = {
        mcpServers: {
          'token-nerd': {
            command: 'npx',
            args: 'not-an-array'
          }
        }
      };
      
      fs.writeFileSync(claudeConfigPath, JSON.stringify(invalidConfig));
      
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });

    it('should return false when args missing tsx', async () => {
      const invalidConfig = {
        mcpServers: {
          'token-nerd': {
            command: 'npx',
            args: ['wrong-tool', mcpServerPath]
          }
        }
      };
      
      fs.writeFileSync(claudeConfigPath, JSON.stringify(invalidConfig));
      
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });
  });
});