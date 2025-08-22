import { ComponentInstaller, InstallationError } from './types';
import { BackupManager } from './backup-manager';

export abstract class BaseInstaller implements ComponentInstaller {
  protected backupManager: BackupManager;

  constructor() {
    this.backupManager = new BackupManager();
  }

  abstract getName(): string;
  abstract doInstall(): Promise<void>;
  abstract doUninstall(): Promise<void>;
  abstract checkInstalled(): Promise<boolean>;
  abstract validateInstallation(): Promise<boolean>;

  async install(): Promise<void> {
    const name = this.getName();
    
    try {
      console.log(`📦 Installing ${name}...`);
      
      if (await this.isInstalled()) {
        console.log(`⚠️  ${name} is already installed`);
        return;
      }

      await this.doInstall();
      await this.markAsInstalled();
      
      if (!(await this.validate())) {
        throw new InstallationError(`Installation validation failed for ${name}`, name, 'install');
      }
      
      console.log(`✓ ${name} installed successfully`);
    } catch (error) {
      throw new InstallationError(
        `Failed to install ${name}: ${error instanceof Error ? error.message : error}`,
        name,
        'install',
        error instanceof Error ? error : undefined
      );
    }
  }

  async uninstall(): Promise<void> {
    const name = this.getName();
    
    try {
      console.log(`🗑️  Uninstalling ${name}...`);
      
      if (!(await this.isInstalled())) {
        console.log(`⚠️  ${name} is not installed`);
        return;
      }

      await this.doUninstall();
      await this.markAsUninstalled();
      
      console.log(`✓ ${name} uninstalled successfully`);
    } catch (error) {
      throw new InstallationError(
        `Failed to uninstall ${name}: ${error instanceof Error ? error.message : error}`,
        name,
        'uninstall',
        error instanceof Error ? error : undefined
      );
    }
  }

  async isInstalled(): Promise<boolean> {
    try {
      const state = await this.backupManager.getInstallationState();
      return state.installedComponents.includes(this.getName()) && await this.checkInstalled();
    } catch (error) {
      return false;
    }
  }

  async validate(): Promise<boolean> {
    try {
      return await this.validateInstallation();
    } catch (error) {
      return false;
    }
  }

  protected async createBackup(filePath: string, operation: 'install' | 'uninstall') {
    return await this.backupManager.createBackup(filePath, this.getName(), operation);
  }

  private async markAsInstalled(): Promise<void> {
    const state = await this.backupManager.getInstallationState();
    if (!state.installedComponents.includes(this.getName())) {
      state.installedComponents.push(this.getName());
      state.timestamp = Date.now();
      await this.backupManager.saveInstallationState(state);
    }
  }

  private async markAsUninstalled(): Promise<void> {
    const state = await this.backupManager.getInstallationState();
    state.installedComponents = state.installedComponents.filter(c => c !== this.getName());
    state.timestamp = Date.now();
    await this.backupManager.saveInstallationState(state);
  }

  protected async restoreBackupsForComponent(): Promise<void> {
    const backups = await this.backupManager.getBackupsForComponent(this.getName());
    
    for (const backup of backups) {
      try {
        await this.backupManager.restoreBackup(backup);
      } catch (error) {
        console.warn(`Failed to restore backup ${backup.backupPath}: ${error}`);
      }
    }
  }

  protected async cleanupBackupsForComponent(): Promise<void> {
    const backups = await this.backupManager.getBackupsForComponent(this.getName());
    
    for (const backup of backups) {
      try {
        await this.backupManager.removeBackup(backup);
      } catch (error) {
        console.warn(`Failed to cleanup backup ${backup.backupPath}: ${error}`);
      }
    }
  }
}