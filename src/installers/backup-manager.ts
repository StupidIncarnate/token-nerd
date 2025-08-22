import * as fs from 'fs';
import * as path from 'path';
import { BackupMetadata, InstallationState } from './types';
import { getClaudeDir } from './utils';

export class BackupManager {
  private stateFile: string;
  private backupDir: string;

  constructor() {
    const claudeDir = getClaudeDir();
    this.backupDir = path.join(claudeDir, 'token-nerd-backups');
    this.stateFile = path.join(this.backupDir, 'installation-state.json');
    this.ensureBackupDir();
  }

  private ensureBackupDir(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  async createBackup(
    filePath: string, 
    component: string, 
    operation: 'install' | 'uninstall'
  ): Promise<BackupMetadata | null> {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const timestamp = Date.now();
    const filename = path.basename(filePath);
    const backupFilename = `${filename}.${component}.${operation}.${timestamp}.backup`;
    const backupPath = path.join(this.backupDir, backupFilename);

    try {
      fs.copyFileSync(filePath, backupPath);
      
      const metadata: BackupMetadata = {
        originalPath: filePath,
        backupPath,
        timestamp,
        component,
        operation
      };

      await this.saveBackupMetadata(metadata);
      console.log(`✓ Backed up ${filePath} to ${path.basename(backupPath)}`);
      return metadata;
    } catch (error) {
      throw new Error(`Failed to create backup of ${filePath}: ${error}`);
    }
  }

  async restoreBackup(metadata: BackupMetadata): Promise<void> {
    if (!fs.existsSync(metadata.backupPath)) {
      throw new Error(`Backup file not found: ${metadata.backupPath}`);
    }

    try {
      fs.copyFileSync(metadata.backupPath, metadata.originalPath);
      console.log(`✓ Restored ${metadata.originalPath} from backup`);
    } catch (error) {
      throw new Error(`Failed to restore ${metadata.originalPath}: ${error}`);
    }
  }

  async removeBackup(metadata: BackupMetadata): Promise<void> {
    if (fs.existsSync(metadata.backupPath)) {
      fs.unlinkSync(metadata.backupPath);
    }
    await this.removeBackupMetadata(metadata);
  }

  async getInstallationState(): Promise<InstallationState> {
    if (!fs.existsSync(this.stateFile)) {
      return {
        backups: [],
        installedComponents: [],
        timestamp: Date.now()
      };
    }

    try {
      const content = fs.readFileSync(this.stateFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.warn('Failed to read installation state, starting fresh');
      return {
        backups: [],
        installedComponents: [],
        timestamp: Date.now()
      };
    }
  }

  async saveInstallationState(state: InstallationState): Promise<void> {
    try {
      // Ensure backup directory exists
      this.ensureBackupDir();
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      throw new Error(`Failed to save installation state: ${error}`);
    }
  }

  private async saveBackupMetadata(metadata: BackupMetadata): Promise<void> {
    const state = await this.getInstallationState();
    state.backups.push(metadata);
    state.timestamp = Date.now();
    await this.saveInstallationState(state);
  }

  private async removeBackupMetadata(metadata: BackupMetadata): Promise<void> {
    const state = await this.getInstallationState();
    state.backups = state.backups.filter(b => 
      b.originalPath !== metadata.originalPath || 
      b.timestamp !== metadata.timestamp
    );
    state.timestamp = Date.now();
    await this.saveInstallationState(state);
  }

  async getBackupsForComponent(component: string): Promise<BackupMetadata[]> {
    const state = await this.getInstallationState();
    return state.backups.filter(b => b.component === component);
  }

  async cleanupOldBackups(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
    const state = await this.getInstallationState();
    const cutoff = Date.now() - maxAge;
    
    const toRemove = state.backups.filter(b => b.timestamp < cutoff);
    
    for (const backup of toRemove) {
      try {
        if (fs.existsSync(backup.backupPath)) {
          fs.unlinkSync(backup.backupPath);
        }
      } catch (error) {
        console.warn(`Failed to remove old backup ${backup.backupPath}: ${error}`);
      }
    }

    state.backups = state.backups.filter(b => b.timestamp >= cutoff);
    await this.saveInstallationState(state);
    
    if (toRemove.length > 0) {
      console.log(`✓ Cleaned up ${toRemove.length} old backup(s)`);
    }
  }
}