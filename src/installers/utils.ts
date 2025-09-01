import * as path from 'path';
import * as os from 'os';
import { getClaudeConfigFile, getClaudeSettingsFile } from '../lib/claude-path-resolver';

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
 * @deprecated Use getClaudeConfigFile from claude-path-resolver for auto-detection
 */
export function getClaudeConfigPath(): string {
  return getClaudeConfigFile();
}

/**
 * Get the Claude settings file path
 * @deprecated Use getClaudeSettingsFile from claude-path-resolver for auto-detection  
 */
export function getClaudeSettingsPath(): string {
  return getClaudeSettingsFile();
}

/**
 * Get the Claude hooks directory path (~/.config/claude/hooks)
 */
export function getClaudeHooksDir(): string {
  return process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Roaming', 'claude', 'hooks')
    : path.join(os.homedir(), '.config', 'claude', 'hooks');
}

