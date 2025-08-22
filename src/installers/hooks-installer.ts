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
    this.sourceDir = path.join(process.cwd(), 'src', 'hooks');
    this.hooks = ['pre-tool-use', 'post-tool-use'];
  }

  getName(): string {
    return 'hooks';
  }

  async doInstall(): Promise<void> {
    // First, ensure hooks directory exists and create symlinks (for backwards compatibility)
    if (!fs.existsSync(this.hooksDir)) {
      fs.mkdirSync(this.hooksDir, { recursive: true });
      console.log(`✓ Created hooks directory: ${this.hooksDir}`);
    }

    // Create hook files in the directory
    for (const hook of this.hooks) {
      const sourcePath = path.join(this.sourceDir, `${hook}.ts`);
      const targetPath = path.join(this.hooksDir, hook);
      
      // Check if source file exists
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source hook not found: ${sourcePath}`);
      }
      
      // Check if target exists (including broken symlinks)
      let targetExists = false;
      let isSymlink = false;
      let linkTarget = '';
      
      try {
        const stats = fs.lstatSync(targetPath);
        targetExists = true;
        isSymlink = stats.isSymbolicLink();
        if (isSymlink) {
          linkTarget = fs.readlinkSync(targetPath);
        }
      } catch (error) {
        // File doesn't exist
        targetExists = false;
      }
      
      if (targetExists) {
        if (isSymlink && linkTarget === sourcePath) {
          console.log(`✓ Hook already installed: ${hook}`);
          continue;
        }
        
        // Backup the existing hook (if it's a real file, not a broken symlink)
        if (!isSymlink || fs.existsSync(linkTarget)) {
          await this.createBackup(targetPath, 'install');
        }
        fs.unlinkSync(targetPath);
      }
      
      // Create symlink
      fs.symlinkSync(sourcePath, targetPath);
      console.log(`✓ Created symlink: ${targetPath} -> ${sourcePath}`);
      
      // Make executable
      fs.chmodSync(targetPath, 0o755);
      console.log(`✓ Made executable: ${hook}`);
    }

    // Now configure hooks in settings.json (the modern approach)
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

    const preHookPath = path.join(this.hooksDir, 'pre-tool-use');
    const postHookPath = path.join(this.hooksDir, 'post-tool-use');

    settings.hooks.PreToolUse = [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: preHookPath
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
            command: postHookPath
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

    // Remove hook files from directory
    for (const hook of this.hooks) {
      const targetPath = path.join(this.hooksDir, hook);
      
      if (fs.existsSync(targetPath)) {
        // Only remove if it's our symlink
        if (fs.lstatSync(targetPath).isSymbolicLink()) {
          const linkTarget = fs.readlinkSync(targetPath);
          const sourcePath = path.join(this.sourceDir, `${hook}.ts`);
          
          if (linkTarget === sourcePath) {
            fs.unlinkSync(targetPath);
            console.log(`✓ Removed hook: ${hook}`);
          } else {
            console.log(`⚠️  Hook ${hook} points to different target, leaving it alone`);
          }
        } else {
          console.log(`⚠️  Hook ${hook} is not a symlink, leaving it alone`);
        }
      }
    }

    // Restore backed up hooks and settings
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
    // Check hook files in directory
    for (const hook of this.hooks) {
      const targetPath = path.join(this.hooksDir, hook);
      const sourcePath = path.join(this.sourceDir, `${hook}.ts`);
      
      if (!fs.existsSync(targetPath)) {
        return false;
      }
      
      if (!fs.lstatSync(targetPath).isSymbolicLink()) {
        return false;
      }
      
      const linkTarget = fs.readlinkSync(targetPath);
      if (linkTarget !== sourcePath) {
        return false;
      }
    }
    
    // Check settings.json configuration
    return this.checkSettingsConfiguration();
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
      const hasPreHook = settings.hooks.PreToolUse && 
        Array.isArray(settings.hooks.PreToolUse) &&
        settings.hooks.PreToolUse.some((config: any) => 
          config.matcher === "*" && 
          config.hooks?.some((hook: any) => 
            hook.type === "command" && 
            hook.command?.includes('pre-tool-use')
          )
        );

      const hasPostHook = settings.hooks.PostToolUse &&
        Array.isArray(settings.hooks.PostToolUse) &&
        settings.hooks.PostToolUse.some((config: any) => 
          config.matcher === "*" && 
          config.hooks?.some((hook: any) => 
            hook.type === "command" && 
            hook.command?.includes('post-tool-use')
          )
        );

      return hasPreHook && hasPostHook;
    } catch (error) {
      return false;
    }
  }

  async validateInstallation(): Promise<boolean> {
    // Check if all hooks are installed correctly
    if (!await this.checkInstalled()) {
      return false;
    }

    // Validate source files exist
    for (const hook of this.hooks) {
      const sourcePath = path.join(this.sourceDir, `${hook}.ts`);
      if (!fs.existsSync(sourcePath)) {
        return false;
      }
    }

    // Validate hooks are executable
    for (const hook of this.hooks) {
      const targetPath = path.join(this.hooksDir, hook);
      try {
        const stats = fs.statSync(targetPath);
        if (!(stats.mode & parseInt('111', 8))) { // Check if executable
          return false;
        }
      } catch (error) {
        return false;
      }
    }

    return true;
  }
}