import * as fs from 'fs';
import * as path from 'path';
import { BackupManager } from './backup-manager';
import { BackupMetadata, InstallationState } from '../types';
import { TEST_TEMP_DIR, TEST_CLAUDE_DIR } from '../test-setup';

// Mock console methods to prevent test output clutter
const mockConsoleLog = jest.fn();
const mockConsoleWarn = jest.fn();
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

describe('BackupManager', () => {
  let backupManager: BackupManager;
  let testFile: string;

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = mockConsoleLog;
    console.warn = mockConsoleWarn;
    backupManager = new BackupManager();
    testFile = path.join(TEST_TEMP_DIR, 'test-file.txt');
    fs.writeFileSync(testFile, 'original content');
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  });

  describe('createBackup', () => {
    it('should create backup of existing file', async () => {
      const metadata = await backupManager.createBackup(testFile, 'test-component', 'install');
      
      expect(metadata).toBeTruthy();
      expect(metadata!.originalPath).toBe(testFile);
      expect(fs.existsSync(metadata!.backupPath)).toBe(true);
      expect(fs.readFileSync(metadata!.backupPath, 'utf-8')).toBe('original content');
      expect(metadata!.component).toBe('test-component');
      expect(metadata!.operation).toBe('install');
      expect(mockConsoleLog).toHaveBeenCalledWith(`✓ Backed up ${testFile} to ${metadata!.backupPath}`);
    });

    it('should return null for non-existent file', async () => {
      const nonExistentFile = path.join(TEST_TEMP_DIR, 'does-not-exist.txt');
      const metadata = await backupManager.createBackup(nonExistentFile, 'test-component', 'install');
      
      expect(metadata).toBe(null);
    });

    it('should save backup metadata to installation state', async () => {
      await backupManager.createBackup(testFile, 'test-component', 'install');
      
      const state = await backupManager.getInstallationState();
      expect(state.backups).toHaveLength(1);
      expect(state.backups[0].originalPath).toBe(testFile);
      expect(state.backups[0].component).toBe('test-component');
    });
  });

  describe('restoreBackup', () => {
    it('should restore file from backup', async () => {
      const metadata = await backupManager.createBackup(testFile, 'test-component', 'install');
      
      // Modify the original file
      fs.writeFileSync(testFile, 'modified content');
      expect(fs.readFileSync(testFile, 'utf-8')).toBe('modified content');
      
      // Restore from backup
      await backupManager.restoreBackup(metadata!);
      expect(fs.readFileSync(testFile, 'utf-8')).toBe('original content');
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('✓ Restored'));
    });

    it('should throw error if backup file does not exist', async () => {
      const fakeMetadata: BackupMetadata = {
        originalPath: testFile,
        backupPath: '/non/existent/backup.txt',
        timestamp: Date.now(),
        component: 'test',
        operation: 'install'
      };

      await expect(backupManager.restoreBackup(fakeMetadata)).rejects.toThrow('Backup file not found');
    });
  });

  describe('removeBackup', () => {
    it('should remove backup file and metadata', async () => {
      const metadata = await backupManager.createBackup(testFile, 'test-component', 'install');
      
      expect(fs.existsSync(metadata!.backupPath)).toBe(true);
      
      await backupManager.removeBackup(metadata!);
      
      expect(fs.existsSync(metadata!.backupPath)).toBe(false);
      
      const state = await backupManager.getInstallationState();
      expect(state.backups).toHaveLength(0);
    });
  });

  describe('getInstallationState', () => {
    it('should return default state if no state file exists', async () => {
      const state = await backupManager.getInstallationState();
      
      expect(state.backups).toEqual([]);
      expect(state.installedComponents).toEqual([]);
      expect(state.timestamp).toBeGreaterThan(0);
    });

    it('should read existing state file', async () => {
      const initialState: InstallationState = {
        backups: [],
        installedComponents: ['test-component'],
        timestamp: 12345
      };

      await backupManager.saveInstallationState(initialState);
      const state = await backupManager.getInstallationState();
      
      expect(state.installedComponents).toEqual(['test-component']);
      expect(state.timestamp).toBe(12345);
    });
  });

  describe('getBackupsForComponent', () => {
    it('should return backups for specific component', async () => {
      await backupManager.createBackup(testFile, 'component-a', 'install');
      
      const testFile2 = path.join(TEST_TEMP_DIR, 'test-file-2.txt');
      fs.writeFileSync(testFile2, 'content 2');
      await backupManager.createBackup(testFile2, 'component-b', 'install');
      
      const backupsA = await backupManager.getBackupsForComponent('component-a');
      const backupsB = await backupManager.getBackupsForComponent('component-b');
      
      expect(backupsA).toHaveLength(1);
      expect(backupsA[0].component).toBe('component-a');
      expect(backupsB).toHaveLength(1);
      expect(backupsB[0].component).toBe('component-b');
    });
  });

  describe('cleanupOldBackups', () => {
    it('should remove backups older than specified age', async () => {
      // Create old backup by mocking timestamp
      const oldTimestamp = Date.now() - (31 * 24 * 60 * 60 * 1000); // 31 days ago
      const metadata = await backupManager.createBackup(testFile, 'test-component', 'install');
      
      // Manually update the timestamp to make it old
      const state = await backupManager.getInstallationState();
      state.backups[0].timestamp = oldTimestamp;
      await backupManager.saveInstallationState(state);
      
      // Cleanup should remove it
      await backupManager.cleanupOldBackups(30 * 24 * 60 * 60 * 1000); // 30 days
      
      const newState = await backupManager.getInstallationState();
      expect(newState.backups).toHaveLength(0);
      expect(fs.existsSync(metadata!.backupPath)).toBe(false);
    });

    it('should remove backups older than specified age', async () => {
      // Create old backup by mocking timestamp
      const oldTimestamp = Date.now() - (31 * 24 * 60 * 60 * 1000); // 31 days ago
      const metadata = await backupManager.createBackup(testFile, 'test-component', 'install');
      
      // Manually update the timestamp to make it old
      const state = await backupManager.getInstallationState();
      state.backups[0].timestamp = oldTimestamp;
      await backupManager.saveInstallationState(state);
      
      // Cleanup should remove it
      await backupManager.cleanupOldBackups(30 * 24 * 60 * 60 * 1000); // 30 days
      
      const newState = await backupManager.getInstallationState();
      expect(newState.backups).toHaveLength(0);
      expect(fs.existsSync(metadata!.backupPath)).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle corrupted installation state file', async () => {
      const stateFile = (backupManager as any).stateFile;
      fs.writeFileSync(stateFile, 'invalid json{');
      
      const state = await backupManager.getInstallationState();
      expect(state.backups).toEqual([]);
      expect(state.installedComponents).toEqual([]);
    });

    it('should handle removing non-existent backup files', async () => {
      const fakeMetadata = {
        originalPath: '/fake/path',
        backupPath: '/fake/backup',
        timestamp: Date.now(),
        component: 'test',
        operation: 'install' as const
      };
      
      await expect(backupManager.removeBackup(fakeMetadata)).resolves.not.toThrow();
    });
  });
});