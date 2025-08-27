import * as fs from 'fs';
import * as path from 'path';
import { BaseInstaller } from './base-installer';
import { getClaudeHooksDir, getClaudeSettingsPath } from './utils';

export class HooksInstaller extends BaseInstaller {
  private hooksDir: string;
  private sourceDir: string;
  private hooks: string[];

  constructor() {
    super();
    this.hooksDir = getClaudeHooksDir();
    this.sourceDir = path.join(__dirname, '../hooks');
    this.hooks = ['pre-tool-use', 'post-tool-use'];
  }

  getName(): string {
    return 'hooks';
  }

  async doInstall(): Promise<void> {
    // Configure hooks in settings.json to reference bin commands
    await this.configureHooksInSettings();
  }

  private async configureHooksInSettings(): Promise<void> {
    const settingsPath = getClaudeSettingsPath();
    
    // Read existing settings or create empty object
    let settings: any = {};
    if (fs.existsSync(settingsPath)) {
      await this.createBackup(settingsPath, 'install');
      try {
        const content = fs.readFileSync(settingsPath, 'utf8');
        settings = JSON.parse(content);
      } catch (error) {
        console.warn(`⚠️  Could not parse existing settings.json, creating new one`);
        settings = {};
      }
    } else {
      // Ensure directory exists
      const settingsDir = path.dirname(settingsPath);
      if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
      }
    }

    // Add hook configuration
    if (!settings.hooks) {
      settings.hooks = {};
    }

    settings.hooks.PreToolUse = [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: "token-nerd process:pre-hook"
          }
        ]
      }
    ];

    settings.hooks.PostToolUse = [
      {
        matcher: "*",
        hooks: [
          {
            type: "command", 
            command: "token-nerd process:post-hook"
          }
        ]
      }
    ];

    // Write updated settings
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`✓ Added hook configuration to ${settingsPath}`);
  }

  async doUninstall(): Promise<void> {
    // Remove hook configuration from settings.json
    await this.removeHooksFromSettings();

    // Restore backed up settings
    await this.restoreBackupsForComponent();
  }

  private async removeHooksFromSettings(): Promise<void> {
    const settingsPath = getClaudeSettingsPath();
    
    if (!fs.existsSync(settingsPath)) {
      return; // No settings file to modify
    }

    try {
      const content = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(content);
      
      if (settings.hooks) {
        // Remove our hook configurations
        delete settings.hooks.PreToolUse;
        delete settings.hooks.PostToolUse;
        
        // If hooks object is now empty, remove it entirely
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
        
        // Write updated settings
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log(`✓ Removed hook configuration from ${settingsPath}`);
      }
    } catch (error) {
      console.warn(`⚠️  Could not update settings.json during uninstall: ${error}`);
    }
  }

  async checkInstalled(): Promise<boolean> {
    // Check settings.json configuration only (no file copying anymore)
    return Promise.resolve(this.checkSettingsConfiguration());
  }

  private checkSettingsConfiguration(): boolean {
    const settingsPath = getClaudeSettingsPath();
    
    if (!fs.existsSync(settingsPath)) {
      return false;
    }

    try {
      const content = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(content);
      
      if (!settings.hooks) {
        return false;
      }

      // Check if our hook configuration exists
      const hasPreHook = !!(settings.hooks.PreToolUse && 
        Array.isArray(settings.hooks.PreToolUse) &&
        settings.hooks.PreToolUse.some((config: any) => 
          config.matcher === "*" && 
          config.hooks?.some((hook: any) => 
            hook.type === "command" && 
            hook.command === 'token-nerd process:pre-hook'
          )
        ));

      const hasPostHook = !!(settings.hooks.PostToolUse &&
        Array.isArray(settings.hooks.PostToolUse) &&
        settings.hooks.PostToolUse.some((config: any) => 
          config.matcher === "*" && 
          config.hooks?.some((hook: any) => 
            hook.type === "command" && 
            hook.command === 'token-nerd process:post-hook'
          )
        ));

      return hasPreHook && hasPostHook;
    } catch (error) {
      return false;
    }
  }

  async validateInstallation(): Promise<boolean> {
    // Check if hooks are configured correctly in settings
    return this.checkInstalled();
  }
}