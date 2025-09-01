/**
 * Central configuration constants for Token Nerd
 * 
 * This file consolidates all magic numbers and shared constants
 * used across the application to improve maintainability.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
  DANGER_PERCENT: 85,             // Red alert at 85%
  WARNING_PERCENT: 70,            // Yellow warning at 70%
} as const;

// UI and monitoring constants
export const UI_CONSTANTS = {
  MONITOR_INTERVAL_MS: 2000,      // Check every 2 seconds
} as const;

// Configuration utility functions

/**
 * Read Claude configuration and determine if auto-compact is enabled
 * Returns true if autoCompactEnabled is true or not present (default behavior)
 * Returns false if explicitly set to false
 */
export function isAutoCompactEnabled(): boolean {
  try {
    const configPath = path.join(os.homedir(), '.claude.json');
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
 */
export function getTokenLimit(): number {
  return isAutoCompactEnabled() ? TOKEN_LIMITS.AUTO_COMPACT : TOKEN_LIMITS.NO_AUTO_COMPACT;
}