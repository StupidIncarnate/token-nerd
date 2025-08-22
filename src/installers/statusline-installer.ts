import * as fs from 'fs';
import * as path from 'path';
import { BaseInstaller } from './base-installer';
import { DETECTION_PATTERNS, TOKEN_NERD_VAR, TOKEN_NERD_COMMAND_PATTERN, TOKEN_NERD_PIPE_PATTERN } from '../shared-constants';
import { getClaudeDir, getClaudeSettingsPath, expandTilde } from './utils';

export class StatuslineInstaller extends BaseInstaller {
  private claudeDir: string;
  private settingsPath: string;

  constructor() {
    super();
    this.claudeDir = getClaudeDir();
    this.settingsPath = getClaudeSettingsPath();
  }

  getName(): string {
    return 'statusline';
  }

  private createBasicStatusline(): string {
    return `#!/bin/bash
# Basic Claude Code statusline with token-nerd integration  
${TOKEN_NERD_VAR}=$(cat | ${TOKEN_NERD_COMMAND_PATTERN})
echo "$\{${TOKEN_NERD_VAR}}"
`;
  }

  private writeStatuslineFile(filePath: string, content: string): void {
    const claudeDir = path.dirname(filePath);
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, content);
    fs.chmodSync(filePath, 0o755);
  }

  private updateSettingsJson(statuslineScript: string): void {
    const settings = fs.existsSync(this.settingsPath) 
      ? JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8')) 
      : {};
    
    settings.statusLine = { type: "command", command: statuslineScript };
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));
  }

  private enhanceExistingStatusline(statuslineScript: string): boolean {
    const content = fs.readFileSync(statuslineScript, 'utf-8');
    
    if (content.includes(DETECTION_PATTERNS.VARIABLE) || content.includes(DETECTION_PATTERNS.COMMAND)) {
      console.log('✓ Statusline already has token-nerd integration');
      return true;
    }
    
    // Find and enhance the last echo statement
    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('echo ') && !line.includes(TOKEN_NERD_VAR) && !line.includes(TOKEN_NERD_COMMAND_PATTERN)) {
        // Find existing JSON variable
        const jsonVarMatch = content.match(/(\w+)=\$\(cat\)/);
        const jsonVarName = jsonVarMatch ? jsonVarMatch[1] : 'json';
        
        // Create command that pipes existing JSON variable to npx
        const tokenCmd = `${TOKEN_NERD_VAR}=$(echo "$${jsonVarName}" | ${TOKEN_NERD_COMMAND_PATTERN})`;
        
        // Add token-nerd line before the echo
        lines.splice(i, 0, tokenCmd);
        
        // Update the echo to include token output
        if (line.includes('"')) {
          lines[i+1] = line.replace(/echo\s+"([^"]*)"/, `echo "$1${TOKEN_NERD_PIPE_PATTERN}"`);
        } else if (line.includes("'")) {
          lines[i+1] = line.replace(/echo\s+'([^']*)'/, `echo '$1${TOKEN_NERD_PIPE_PATTERN}'`);
        } else {
          lines[i+1] = line.replace(/echo\s+(.*)/, `echo "$1${TOKEN_NERD_PIPE_PATTERN}"`);
        }
        
        fs.writeFileSync(statuslineScript, lines.join('\n'));
        fs.chmodSync(statuslineScript, 0o755);
        console.log('✓ Enhanced existing statusline with token-nerd integration');
        return true;
      }
    }
    
    console.log('⚠️  Could not find echo statement to enhance - statusline format unknown');
    return false;
  }

  async doInstall(): Promise<void> {
    // Ensure Claude directory exists
    if (!fs.existsSync(this.claudeDir)) {
      fs.mkdirSync(this.claudeDir, { recursive: true });
    }

    let statuslineScript: string | undefined;
    
    // Check if settings.json exists and has statusline config
    if (fs.existsSync(this.settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
        if (settings.statusLine?.command) {
          // Extract script path from command
          const commandParts = settings.statusLine.command.split(' ');
          const scriptPath = commandParts[commandParts.length - 1];
          statuslineScript = expandTilde(scriptPath);
        }
      } catch (error) {
        console.log('⚠️  Could not parse settings.json');
        // Remove malformed file so we can create a fresh one
        fs.unlinkSync(this.settingsPath);
      }
    }
    
    // If no statusline configured, create basic one
    if (!statuslineScript) {
      statuslineScript = path.join(this.claudeDir, 'statusline-command.sh');
      this.writeStatuslineFile(statuslineScript, this.createBasicStatusline());
      this.updateSettingsJson(statuslineScript);
      console.log(`✓ Created statusline and added to settings.json`);
      return;
    }
    
    // If configured statusline doesn't exist, create basic one at that path
    if (!fs.existsSync(statuslineScript)) {
      console.log(`⚠️  Statusline script not found: ${statuslineScript}`);
      console.log('   Creating basic statusline instead...');
      this.writeStatuslineFile(statuslineScript, this.createBasicStatusline());
      console.log(`✓ Created basic statusline at ${statuslineScript}`);
      return;
    }
    
    // Back up existing statusline before enhancing
    await this.createBackup(statuslineScript, 'install');
    
    // Enhance existing statusline
    this.enhanceExistingStatusline(statuslineScript);
  }

  async doUninstall(): Promise<void> {
    // Find the statusline script path
    let statuslineScript: string | undefined;
    
    if (fs.existsSync(this.settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
        if (settings.statusLine?.command) {
          const commandParts = settings.statusLine.command.split(' ');
          const scriptPath = commandParts[commandParts.length - 1];
          statuslineScript = expandTilde(scriptPath);
        }
      } catch (error) {
        console.log('⚠️  Could not parse settings.json');
      }
    }

    if (!statuslineScript) {
      statuslineScript = path.join(this.claudeDir, 'statusline-command.sh');
    }

    if (fs.existsSync(statuslineScript)) {
      let content = fs.readFileSync(statuslineScript, 'utf-8');
      
      if (content.includes(TOKEN_NERD_VAR)) {
        // Backup before modifying
        await this.createBackup(statuslineScript, 'uninstall');
        
        // Remove TOKEN_NERD line
        content = content.replace(new RegExp(`^${TOKEN_NERD_VAR}=.*$`, 'gm'), '');
        
        // Fix echo line - remove the pipe part and direct variable references
        content = content.replace(new RegExp(` \\| \\$${TOKEN_NERD_VAR}`, 'g'), '');
        content = content.replace(new RegExp(`echo "\\$\\{${TOKEN_NERD_VAR}\\}"`, 'g'), 'echo ""');
        
        // Clean up extra empty lines
        content = content.replace(/\n\n\n+/g, '\n\n');
        
        fs.writeFileSync(statuslineScript, content);
        console.log('✓ Removed token-nerd integration from statusline');
      }
    }

    // Clean up any backup files older than current session
    await this.cleanupOldBackupFiles();
  }

  private async cleanupOldBackupFiles(): Promise<void> {
    try {
      const backupFiles = fs.readdirSync(this.claudeDir)
        .filter(f => f.startsWith('statusline-command.sh.backup.'));
      
      for (const backup of backupFiles) {
        fs.unlinkSync(path.join(this.claudeDir, backup));
      }
      
      if (backupFiles.length > 0) {
        console.log(`✓ Cleaned up ${backupFiles.length} old backup file(s)`);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  async checkInstalled(): Promise<boolean> {
    // Check if settings.json has statusline config
    if (!fs.existsSync(this.settingsPath)) {
      return false;
    }

    try {
      const settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
      if (!settings.statusLine?.command) {
        return false;
      }

      // Get statusline script path
      const commandParts = settings.statusLine.command.split(' ');
      const scriptPath = expandTilde(commandParts[commandParts.length - 1]);
      
      if (!fs.existsSync(scriptPath)) {
        return false;
      }

      // Check if it has our integration
      const content = fs.readFileSync(scriptPath, 'utf-8');
      return content.includes(DETECTION_PATTERNS.VARIABLE) || content.includes(DETECTION_PATTERNS.COMMAND);
    } catch (error) {
      return false;
    }
  }

  async validateInstallation(): Promise<boolean> {
    if (!await this.checkInstalled()) {
      return false;
    }

    try {
      // Validate settings.json is valid JSON
      const settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
      
      // Get statusline script path
      const commandParts = settings.statusLine.command.split(' ');
      const scriptPath = expandTilde(commandParts[commandParts.length - 1]);
      
      // Validate script file exists and is executable
      if (!fs.existsSync(scriptPath)) {
        return false;
      }

      const stats = fs.statSync(scriptPath);
      if (!(stats.mode & parseInt('111', 8))) { // Check if executable
        return false;
      }

      // Validate script contains our integration
      const content = fs.readFileSync(scriptPath, 'utf-8');
      return content.includes(TOKEN_NERD_COMMAND_PATTERN);
    } catch (error) {
      return false;
    }
  }
}