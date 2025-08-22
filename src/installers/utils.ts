import * as path from 'path';
import * as os from 'os';

/**
 * Expand tilde (~) to home directory in file paths
 */
export function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Get the Claude configuration directory path for the current platform
 */
export function getClaudeDir(): string {
  return process.platform === 'win32' 
    ? path.join(os.homedir(), 'AppData', 'Roaming', 'claude')
    : path.join(os.homedir(), '.claude');
}

/**
 * Get the Claude configuration file path (.claude.json in home directory)
 */
export function getClaudeConfigPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

/**
 * Get the Claude settings file path
 */
export function getClaudeSettingsPath(): string {
  return path.join(getClaudeDir(), 'settings.json');
}

/**
 * Get the Claude hooks directory path (~/.config/claude/hooks)
 */
export function getClaudeHooksDir(): string {
  return process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Roaming', 'claude', 'hooks')
    : path.join(os.homedir(), '.config', 'claude', 'hooks');
}