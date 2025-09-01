/**
 * Central configuration constants for Token Nerd
 * 
 * This file consolidates all magic numbers and shared constants
 * used across the application to improve maintainability.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getClaudeConfigFile } from './lib/claude-path-resolver';
import { FileCache } from './lib/file-cache';

// Token limits based on Claude's autoCompactEnabled setting
export const TOKEN_LIMITS = {
  AUTO_COMPACT: 156000,           // When autoCompactEnabled: true (default) - compacts at ~156k
  NO_AUTO_COMPACT: 190000,        // When autoCompactEnabled: false - higher limit before manual management needed
} as const;

// Time-based constants (all in seconds)
export const TIME_CONSTANTS = {
  CACHE_EXPIRY_SECONDS: 300,      // 5 minutes - when cache expires
  SUBAGENT_ASSOCIATION_SECONDS: 10, // 10 seconds for sub-agent timing
} as const;

// Token calculation constants
export const CALCULATION_CONSTANTS = {
  CHARS_PER_TOKEN_ESTIMATE: 3.7,  // Heuristic for token estimation
  SPIKE_THRESHOLD_TOKENS: 10000,  // Alert on token jumps > 10k
} as const;

// Alert thresholds (percentages)
export const ALERT_THRESHOLDS = {
  DANGER_PERCENT: 90,             // Red alert at 90%
  WARNING_PERCENT: 75,            // Yellow warning at 75%
} as const;

// UI and monitoring constants
export const UI_CONSTANTS = {
  MONITOR_INTERVAL_MS: 2000,      // Check every 2 seconds
} as const;

// ANSI color codes for statusline styling
export const ANSI_COLORS = {
  YELLOW: '\x1b[33m',             // Yellow text for warnings (75-89%)
  RED: '\x1b[31m',                // Red text for danger (90%+)
  RESET: '\x1b[0m',               // Reset to default color
} as const;

// Cache for Claude configuration to avoid redundant file reads
const configCache = new FileCache<boolean>();

// Configuration utility functions

/**
 * Read Claude configuration and determine if auto-compact is enabled
 * Returns true if autoCompactEnabled is true or not present (default behavior)
 * Returns false if explicitly set to false
 * OPTIMIZED: Uses caching to avoid redundant config file reads
 */
export async function isAutoCompactEnabled(): Promise<boolean> {
  const configPath = getClaudeConfigFile();
  
  if (!fs.existsSync(configPath)) {
    return true; // Default to auto-compact enabled if no config file
  }

  try {
    return await configCache.get({
      key: 'auto-compact-enabled',
      filePath: configPath,
      computeFn: () => {
        try {
          const configContent = fs.readFileSync(configPath, 'utf-8');
          const config = JSON.parse(configContent);
          
          // Default to true if autoCompactEnabled is not specified
          return config.autoCompactEnabled !== false;
        } catch (error) {
          // If there's any error parsing the config, default to auto-compact enabled
          return true;
        }
      }
    });
  } catch (error) {
    // If there's any error with caching, default to auto-compact enabled
    return true;
  }
}

/**
 * Synchronous version for backward compatibility
 * @deprecated Use isAutoCompactEnabled() for better performance
 */
export function isAutoCompactEnabledSync(): boolean {
  try {
    const configPath = getClaudeConfigFile();
    if (!fs.existsSync(configPath)) {
      return true; // Default to auto-compact enabled if no config file
    }

    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    
    // Default to true if autoCompactEnabled is not specified
    return config.autoCompactEnabled !== false;
  } catch (error) {
    // If there's any error reading the config, default to auto-compact enabled
    return true;
  }
}

/**
 * Get the appropriate token limit based on Claude's configuration
 * Checks autoCompactEnabled setting and returns corresponding limit
 * OPTIMIZED: Uses cached config reading for better performance
 */
export async function getTokenLimit(): Promise<number> {
  const autoCompactEnabled = await isAutoCompactEnabled();
  return autoCompactEnabled ? TOKEN_LIMITS.AUTO_COMPACT : TOKEN_LIMITS.NO_AUTO_COMPACT;
}

/**
 * Synchronous version for backward compatibility
 * @deprecated Use getTokenLimit() for better performance
 */
export function getTokenLimitSync(): number {
  return isAutoCompactEnabledSync() ? TOKEN_LIMITS.AUTO_COMPACT : TOKEN_LIMITS.NO_AUTO_COMPACT;
}