import * as fs from 'fs';
import * as path from 'path';
import { BaseInstaller } from './base-installer';
import { getClaudeHooksDir } from './utils';

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
    // Ensure hooks directory exists
    if (!fs.existsSync(this.hooksDir)) {
      fs.mkdirSync(this.hooksDir, { recursive: true });
      console.log(`✓ Created hooks directory: ${this.hooksDir}`);
    }

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
  }

  async doUninstall(): Promise<void> {
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

    // Restore backed up hooks
    await this.restoreBackupsForComponent();
  }

  async checkInstalled(): Promise<boolean> {
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
    
    return true;
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