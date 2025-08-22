export interface ComponentInstaller {
  install(): Promise<void>;
  uninstall(): Promise<void>;
  isInstalled(): Promise<boolean>;
  validate(): Promise<boolean>;
  getName(): string;
}

export interface BackupMetadata {
  originalPath: string;
  backupPath: string;
  timestamp: number;
  component: string;
  operation: 'install' | 'uninstall';
}

export interface InstallationState {
  backups: BackupMetadata[];
  installedComponents: string[];
  timestamp: number;
}

export class InstallationError extends Error {
  constructor(
    message: string,
    public component: string,
    public operation: 'install' | 'uninstall',
    public cause?: Error
  ) {
    super(message);
    this.name = 'InstallationError';
  }
}