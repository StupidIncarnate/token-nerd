/**
 * Central configuration constants for Token Nerd
 * 
 * This file consolidates all magic numbers and shared constants
 * used across the application to improve maintainability.
 */

// Token limits by model (discovered through testing)
export const TOKEN_LIMITS = {
  'claude-opus-4-1': 156000,      // Compacts at ~156k
  'claude-sonnet-4': 156000,      // Appears to be same
  'default': 156000,              // Use 156k as default (not 200k!)
  LEGACY_DEFAULT: 200000,         // Old default for backwards compatibility
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