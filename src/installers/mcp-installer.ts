import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseInstaller } from './base-installer';
import { getClaudeConfigPath } from './utils';

export class McpInstaller extends BaseInstaller {
  private claudeConfigPath: string;

  constructor() {
    super();
    this.claudeConfigPath = getClaudeConfigPath();
  }

  getName(): string {
    return 'mcp-server';
  }

  async doInstall(): Promise<void> {
    // Backup existing config if it exists
    if (fs.existsSync(this.claudeConfigPath)) {
      await this.createBackup(this.claudeConfigPath, 'install');
    }

    // Read existing config
    let config: any = {};
    if (fs.existsSync(this.claudeConfigPath)) {
      try {
        const content = fs.readFileSync(this.claudeConfigPath, 'utf-8');
        config = JSON.parse(content);
      } catch (error) {
        throw new Error(`Failed to parse Claude config: ${error}`);
      }
    }

    // Add MCP server configuration
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    if (config.mcpServers['token-nerd']) {
      console.log('⚠️  Token Nerd MCP server already configured in config file');
      return;
    }

    config.mcpServers['token-nerd'] = {
      "command": "token-nerd",
      "args": ["process:mcp"],
      "env": {
        "NODE_ENV": "production"
      }
    };

    // Write updated config
    try {
      // Ensure directory exists
      const configDir = path.dirname(this.claudeConfigPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      fs.writeFileSync(this.claudeConfigPath, JSON.stringify(config, null, 2));
      console.log('✓ Added Token Nerd MCP server to ~/.claude.json');
    } catch (error) {
      throw new Error(`Failed to write Claude config: ${error}`);
    }
  }

  async doUninstall(): Promise<void> {
    // Remove MCP server configuration from Claude config
    if (fs.existsSync(this.claudeConfigPath)) {
      // Backup before modifying
      await this.createBackup(this.claudeConfigPath, 'uninstall');

      try {
        const content = fs.readFileSync(this.claudeConfigPath, 'utf-8');
        const config = JSON.parse(content);
        
        if (config.mcpServers && config.mcpServers['token-nerd']) {
          delete config.mcpServers['token-nerd'];
          fs.writeFileSync(this.claudeConfigPath, JSON.stringify(config, null, 2));
          console.log('✓ Removed MCP server from Claude config');
        }
      } catch (error) {
        throw new Error(`Failed to remove MCP server from config: ${error}`);
      }
    }
  }

  async checkInstalled(): Promise<boolean> {
    if (!fs.existsSync(this.claudeConfigPath)) {
      return false;
    }

    try {
      const content = fs.readFileSync(this.claudeConfigPath, 'utf-8');
      const config = JSON.parse(content);
      return !!(config.mcpServers && config.mcpServers['token-nerd']);
    } catch (error) {
      return false;
    }
  }

  async validateInstallation(): Promise<boolean> {
    // Check if config file exists and has our MCP server
    if (!await this.checkInstalled()) {
      return false;
    }

    try {
      // Validate config file is valid JSON and has correct command
      const content = fs.readFileSync(this.claudeConfigPath, 'utf-8');
      const config = JSON.parse(content);
      
      const mcpConfig = config.mcpServers['token-nerd'];
      return !!(
        mcpConfig &&
        mcpConfig.command === 'token-nerd' &&
        Array.isArray(mcpConfig.args) &&
        mcpConfig.args.includes('process:mcp')
      );
    } catch (error) {
      return false;
    }
  }
}