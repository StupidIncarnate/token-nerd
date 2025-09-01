import { ComponentInstaller, InstallationError } from '../types';
import { BackupManager } from './backup-manager';
import { StatuslineInstaller } from './statusline-installer';

export class TokenNerdInstaller {
  private installers: ComponentInstaller[];
  private backupManager: BackupManager;

  constructor() {
    // Statusline installation is now manual - see README for setup instructions
    this.installers = [
      // new StatuslineInstaller()
    ];
    this.backupManager = new BackupManager();
  }

  async install(): Promise<void> {
    console.log('🔧 Setting up Token Nerd...\n');
    
    const installedComponents: string[] = [];
    
    try {
      // Clean up old backups first
      await this.backupManager.cleanupOldBackups();
      
      if (this.installers.length === 0) {
        console.log('ℹ️  No automatic installers configured - using manual setup mode\n');
      }
      
      for (const installer of this.installers) {
        await installer.install();
        installedComponents.push(installer.getName());
        console.log();
      }
      
      console.log('✅ Token Nerd installation complete!\n');
      console.log('📖 NEXT STEP: Set up your statusline for real-time token tracking:');
      console.log('   See README.md for complete setup instructions');
      console.log('   Quick setup: https://github.com/StupidIncarnate/token-nerd#statusline-setup');
      console.log('\nAfter setup, use "token-nerd" anytime to analyze your token usage!');
      
    } catch (error) {
      console.error('❌ Installation failed:', error instanceof Error ? error.message : error);
      
      // Attempt to rollback installed components
      console.log('\n🔄 Attempting to rollback...');
      try {
        await this.rollback(installedComponents);
        console.log('✓ Rollback completed');
      } catch (rollbackError) {
        console.error('❌ Rollback failed:', rollbackError instanceof Error ? rollbackError.message : rollbackError);
        console.error('Manual cleanup may be required');
      }
      
      throw error;
    }
  }

  async uninstall(): Promise<void> {
    console.log('🧹 Cleaning up Token Nerd installation...\n');
    
    const errors: Error[] = [];
    
    // Uninstall in reverse order
    for (const installer of [...this.installers].reverse()) {
      try {
        await installer.uninstall();
        console.log();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
        console.error(`⚠️  Failed to uninstall ${installer.getName()}: ${error}`);
      }
    }
    
    // Clean up data and backups
    console.log('🗑️  Cleaning up token-nerd data...');
    try {
      // Clean up installation state and old backups
      await this.backupManager.cleanupOldBackups(0); // Remove all backups
      const state = await this.backupManager.getInstallationState();
      state.installedComponents = [];
      state.backups = [];
      await this.backupManager.saveInstallationState(state);
      
      console.log('✓ Data cleanup complete');
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
      console.error(`⚠️  Data cleanup failed: ${error}`);
    }
    
    if (errors.length === 0) {
      console.log('✅ Token Nerd cleanup complete!');
      console.log('🔄 Restart Claude to finish cleanup');
    } else {
      console.log(`⚠️  Cleanup completed with ${errors.length} error(s)`);
      console.log('Some manual cleanup may be needed');
      throw new InstallationError(
        `Uninstall completed with errors: ${errors.map(e => e.message).join('; ')}`,
        'all',
        'uninstall'
      );
    }
  }

  async getStatus(): Promise<{ [key: string]: boolean }> {
    const status: { [key: string]: boolean } = {};
    
    for (const installer of this.installers) {
      try {
        status[installer.getName()] = await installer.isInstalled();
      } catch (error) {
        status[installer.getName()] = false;
      }
    }
    
    return status;
  }

  async validate(): Promise<{ [key: string]: boolean }> {
    const validation: { [key: string]: boolean } = {};
    
    for (const installer of this.installers) {
      try {
        validation[installer.getName()] = await installer.validate();
      } catch (error) {
        validation[installer.getName()] = false;
      }
    }
    
    return validation;
  }

  async isFullyInstalled(): Promise<boolean> {
    const status = await this.getStatus();
    return Object.values(status).every(installed => installed);
  }

  async isFullyValid(): Promise<boolean> {
    const validation = await this.validate();
    return Object.values(validation).every(valid => valid);
  }

  private async rollback(installedComponents: string[]): Promise<void> {
    // Rollback in reverse order of installation
    for (const componentName of [...installedComponents].reverse()) {
      const installer = this.installers.find(i => i.getName() === componentName);
      if (installer) {
        try {
          await installer.uninstall();
          console.log(`✓ Rolled back ${componentName}`);
        } catch (rollbackError) {
          console.error(`❌ Failed to rollback ${componentName}: ${rollbackError}`);
          // Continue with other rollbacks
        }
      }
    }
  }

  async repairInstallation(): Promise<void> {
    console.log('🔧 Repairing Token Nerd installation...\n');
    
    const status = await this.getStatus();
    const validation = await this.validate();
    
    let hasIssues = false;
    
    for (const installer of this.installers) {
      const name = installer.getName();
      const installed = status[name];
      const valid = validation[name];
      
      if (!installed) {
        console.log(`⚠️  ${name} is not installed - reinstalling...`);
        await installer.install();
        hasIssues = true;
      } else if (!valid) {
        console.log(`⚠️  ${name} installation is invalid - repairing...`);
        await installer.uninstall();
        await installer.install();
        hasIssues = true;
      } else {
        console.log(`✓ ${name} is properly installed`);
      }
    }
    
    if (!hasIssues) {
      console.log('\n✅ Token Nerd installation is healthy - no repairs needed');
    } else {
      console.log('\n✅ Token Nerd installation repaired successfully');
      console.log('🔄 Restart Claude to ensure all changes take effect');
    }
  }
}