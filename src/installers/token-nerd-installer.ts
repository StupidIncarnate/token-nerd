import { ComponentInstaller, InstallationError } from './types';
import { BackupManager } from './backup-manager';
import { McpInstaller } from './mcp-installer';
import { HooksInstaller } from './hooks-installer';
import { StatuslineInstaller } from './statusline-installer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class TokenNerdInstaller {
  private installers: ComponentInstaller[];
  private backupManager: BackupManager;

  constructor() {
    this.installers = [
      new McpInstaller(),
      new HooksInstaller(),
      new StatuslineInstaller()
    ];
    this.backupManager = new BackupManager();
  }

  async install(): Promise<void> {
    console.log('🔧 Setting up Token Nerd...\n');
    
    const installedComponents: string[] = [];
    
    try {
      // Clean up old backups first
      await this.backupManager.cleanupOldBackups();
      
      for (const installer of this.installers) {
        await installer.install();
        installedComponents.push(installer.getName());
        console.log();
      }
      
      // Collect initial context stats for Redis
      console.log('📊 Collecting initial Claude context statistics...');
      try {
        const { collectContextStats, storeCurrentSnapshot } = await import('../lib/stats-collector');
        const stats = await collectContextStats();
        
        if (stats) {
          await storeCurrentSnapshot(stats);
          console.log(`✓ Initial context snapshot stored: ${stats.actualTokens.toLocaleString()} tokens`);
        } else {
          console.log('⚠️  No stats collected - Claude may not be running or accessible');
        }
      } catch (error) {
        console.log('⚠️  Could not collect initial stats:', (error as Error).message);
        console.log('   This is normal if Claude is not currently running');
      }
      
      console.log('\n✅ Token Nerd installation complete!\n');
      console.log('🔄 IMPORTANT: Restart Claude to enable token tracking:');
      console.log('   1. Exit claude session (Ctrl+C or type "exit")');
      console.log('   2. Run: claude');
      console.log();
      console.log('After restart, use "token-nerd" anytime to analyze your token usage!');
      
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
      // Clean up Redis data (session operations, etc.)
      await this.cleanupRedisData();
      
      // Clean up response files directory
      await this.cleanupResponseFiles();
      
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
      console.log('🔄 Restart Claude to stop the MCP server');
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

  private async cleanupRedisData(): Promise<void> {
    try {
      // Try to connect to Redis and clean up token-nerd related data
      const { createClient } = await import('redis');
      const client = createClient({
        url: 'redis://localhost:6379',
        socket: {
          connectTimeout: 500,
          reconnectStrategy: () => false // Don't retry
        }
      });

      await client.connect();
      
      // Find and delete all token-nerd session keys
      const sessionKeys = await client.keys('session:*:operations:*');
      const timelineKeys = await client.keys('session:*:timeline');
      const messageKeys = await client.keys('message:*:operations');
      
      const allKeys = [...sessionKeys, ...timelineKeys, ...messageKeys];
      
      if (allKeys.length > 0) {
        await client.del(allKeys);
        console.log(`✓ Cleaned up ${allKeys.length} Redis keys`);
      } else {
        console.log('✓ No Redis data to clean up');
      }
      
      await client.quit();
    } catch (error) {
      // Redis might not be running or accessible - this is okay during uninstall
      console.log('✓ Redis not accessible (this is normal during uninstall)');
    }
  }

  private async cleanupResponseFiles(): Promise<void> {
    const responsesDir = path.join(os.homedir(), '.claude', 'token-nerd');
    
    if (fs.existsSync(responsesDir)) {
      try {
        // Calculate total size for user info
        let totalSize = 0;
        let fileCount = 0;
        
        const calculateSize = (dir: string) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              calculateSize(entryPath);
            } else {
              totalSize += fs.statSync(entryPath).size;
              fileCount++;
            }
          }
        };
        
        calculateSize(responsesDir);
        
        // Remove the directory
        fs.rmSync(responsesDir, { recursive: true, force: true });
        
        const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
        console.log(`✓ Cleaned up ${fileCount} response files (${sizeMB} MB)`);
      } catch (error) {
        console.log(`⚠️  Could not clean up response files: ${error}`);
      }
    } else {
      console.log('✓ No response files to clean up');
    }
  }
}