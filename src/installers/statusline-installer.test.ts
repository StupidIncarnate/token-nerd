import * as fs from 'fs';
import * as path from 'path';
import { StatuslineInstaller } from './statusline-installer';
import { TEST_TEMP_DIR, TEST_CLAUDE_DIR } from '../test-setup';
import { TOKEN_NERD_VAR, TOKEN_NERD_COMMAND_PATTERN } from '../shared-constants';

describe('StatuslineInstaller', () => {
  let installer: StatuslineInstaller;
  let settingsPath: string;

  beforeEach(() => {
    installer = new StatuslineInstaller();
    settingsPath = path.join(TEST_CLAUDE_DIR, 'settings.json');
  });

  describe('doInstall', () => {
    it('should create basic statusline if no settings exist', async () => {
      await installer.doInstall();
      
      expect(fs.existsSync(settingsPath)).toBe(true);
      
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.statusLine.type).toBe('command');
      expect(settings.statusLine.command).toContain('statusline-command.sh');
      
      const statuslineScript = settings.statusLine.command;
      expect(fs.existsSync(statuslineScript)).toBe(true);
      
      const content = fs.readFileSync(statuslineScript, 'utf-8');
      expect(content).toContain(TOKEN_NERD_VAR);
      expect(content).toContain(TOKEN_NERD_COMMAND_PATTERN);
    });

    it('should create basic statusline at configured path if script missing', async () => {
      const customPath = path.join(TEST_CLAUDE_DIR, 'custom-statusline.sh');
      const settings = {
        statusLine: {
          type: 'command',
          command: customPath
        }
      };
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      
      await installer.doInstall();
      
      expect(fs.existsSync(customPath)).toBe(true);
      
      const content = fs.readFileSync(customPath, 'utf-8');
      expect(content).toContain(TOKEN_NERD_VAR);
      expect(content).toContain(TOKEN_NERD_COMMAND_PATTERN);
    });

    it('should enhance existing statusline script', async () => {
      const statuslineScript = path.join(TEST_CLAUDE_DIR, 'existing-statusline.sh');
      const existingContent = `#!/bin/bash
json=$(cat)
echo "$json"
`;
      
      fs.writeFileSync(statuslineScript, existingContent);
      
      const settings = {
        statusLine: {
          type: 'command',
          command: statuslineScript
        }
      };
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      
      await installer.doInstall();
      
      const enhancedContent = fs.readFileSync(statuslineScript, 'utf-8');
      expect(enhancedContent).toContain(TOKEN_NERD_VAR);
      expect(enhancedContent).toContain('echo "$json | $TOKEN_NERD_OUTPUT"');
      
      // Should create backup
      const backupManager = (installer as any).backupManager;
      const backups = await backupManager.getBackupsForComponent('statusline');
      expect(backups.length).toBeGreaterThan(0);
    });

    it('should skip enhancement if already integrated', async () => {
      const statuslineScript = path.join(TEST_CLAUDE_DIR, 'integrated-statusline.sh');
      const integratedContent = `#!/bin/bash
json=$(cat)
${TOKEN_NERD_VAR}=$(echo "$json" | ${TOKEN_NERD_COMMAND_PATTERN})
echo "$json | $${TOKEN_NERD_VAR}"
`;
      
      fs.writeFileSync(statuslineScript, integratedContent);
      
      const settings = {
        statusLine: {
          type: 'command',
          command: statuslineScript
        }
      };
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      
      await installer.doInstall();
      
      // Content should be unchanged
      const content = fs.readFileSync(statuslineScript, 'utf-8');
      expect(content).toBe(integratedContent);
    });

    it('should handle malformed settings.json gracefully', async () => {
      fs.writeFileSync(settingsPath, 'invalid json');
      
      await expect(installer.doInstall()).resolves.not.toThrow();
      
      // Should create default statusline
      const updatedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(updatedSettings.statusLine).toBeDefined();
    });

    it('should make statusline script executable', async () => {
      await installer.doInstall();
      
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const statuslineScript = settings.statusLine.command;
      
      const stats = fs.statSync(statuslineScript);
      expect(stats.mode & parseInt('111', 8)).toBeTruthy();
    });
  });

  describe('doUninstall', () => {
    beforeEach(async () => {
      await installer.doInstall();
    });

    it('should remove token-nerd integration from statusline', async () => {
      await installer.doUninstall();
      
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const statuslineScript = settings.statusLine.command;
      
      const content = fs.readFileSync(statuslineScript, 'utf-8');
      expect(content).not.toContain(TOKEN_NERD_VAR);
    });

    it('should handle non-existent settings file gracefully', async () => {
      fs.unlinkSync(settingsPath);
      
      await expect(installer.doUninstall()).resolves.not.toThrow();
    });

    it('should handle non-existent statusline script gracefully', async () => {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const statuslineScript = settings.statusLine.command;
      fs.unlinkSync(statuslineScript);
      
      await expect(installer.doUninstall()).resolves.not.toThrow();
    });

    it('should backup before modifying statusline', async () => {
      await installer.doUninstall();
      
      const backupManager = (installer as any).backupManager;
      const backups = await backupManager.getBackupsForComponent('statusline');
      
      // Should have backups from both install and uninstall
      expect(backups.length).toBeGreaterThan(0);
    });

    it('should clean up old backup files', async () => {
      // Create some fake backup files
      const oldBackup1 = path.join(TEST_CLAUDE_DIR, 'statusline-command.sh.backup.123');
      const oldBackup2 = path.join(TEST_CLAUDE_DIR, 'statusline-command.sh.backup.456');
      
      fs.writeFileSync(oldBackup1, 'old backup 1');
      fs.writeFileSync(oldBackup2, 'old backup 2');
      
      await installer.doUninstall();
      
      expect(fs.existsSync(oldBackup1)).toBe(false);
      expect(fs.existsSync(oldBackup2)).toBe(false);
    });
  });

  describe('checkInstalled', () => {
    it('should return false if settings file does not exist', async () => {
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if no statusline configured', async () => {
      fs.writeFileSync(settingsPath, JSON.stringify({}, null, 2));
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if statusline script does not exist', async () => {
      const settings = {
        statusLine: {
          type: 'command',
          command: '/non/existent/script.sh'
        }
      };
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false if statusline has no token-nerd integration', async () => {
      const statuslineScript = path.join(TEST_CLAUDE_DIR, 'plain-statusline.sh');
      fs.writeFileSync(statuslineScript, '#!/bin/bash\necho "plain statusline"');
      
      const settings = {
        statusLine: {
          type: 'command',
          command: statuslineScript
        }
      };
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return true if statusline has token-nerd integration', async () => {
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

    it('should return false if settings.json is invalid', async () => {
      await installer.doInstall();
      
      fs.writeFileSync(settingsPath, 'invalid json');
      
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });

    it('should return false if statusline script is not executable', async () => {
      await installer.doInstall();
      
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const statuslineScript = settings.statusLine.command;
      
      fs.chmodSync(statuslineScript, 0o644); // Remove executable
      
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
      expect(installer.getName()).toBe('statusline');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle statusline with no echo statement', async () => {
      const statuslineScript = path.join(TEST_CLAUDE_DIR, 'no-echo-statusline.sh');
      const content = `#!/bin/bash
json=$(cat)
# No echo statement here
`;
      fs.writeFileSync(statuslineScript, content);
      
      const settings = {
        statusLine: { type: 'command', command: statuslineScript }
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      
      await installer.doInstall();
      
      const enhancedContent = fs.readFileSync(statuslineScript, 'utf-8');
      expect(enhancedContent).toBe(content); // Should be unchanged
    });

    it('should handle malformed settings.json during uninstall', async () => {
      await installer.doInstall();
      
      fs.writeFileSync(settingsPath, 'invalid json');
      
      await expect(installer.doUninstall()).resolves.not.toThrow();
    });

    it('should return false when settings.json has invalid JSON', async () => {
      fs.writeFileSync(settingsPath, 'invalid json');
      
      const result = await installer.checkInstalled();
      expect(result).toBe(false);
    });

    it('should return false when script path extraction fails', async () => {
      await installer.doInstall();
      
      const settings = { statusLine: { command: '' } };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      
      const result = await installer.validateInstallation();
      expect(result).toBe(false);
    });



    it('should handle echo with single quotes', async () => {
      const statuslineScript = path.join(TEST_CLAUDE_DIR, 'single-quote-statusline.sh');
      const content = `#!/bin/bash
json=$(cat)
echo 'status output'
`;
      fs.writeFileSync(statuslineScript, content);
      
      const settings = {
        statusLine: { type: 'command', command: statuslineScript }
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      
      await installer.doInstall();
      
      const enhancedContent = fs.readFileSync(statuslineScript, 'utf-8');
      expect(enhancedContent).toContain(TOKEN_NERD_VAR);
      expect(enhancedContent).toContain("echo 'status output | $TOKEN_NERD_OUTPUT'");
    });
  });
});