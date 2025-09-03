/**
 * Statusline-specific configuration for Token Nerd
 * Imports shared constants and provides statusline-specific logic
 */

import {
  TOKEN_LIMITS,
  CALCULATION_CONSTANTS,
  ALERT_THRESHOLDS,
  UI_CONSTANTS,
  ANSI_COLORS,
  getTokenLimitSync
} from '../../config';

// Re-export shared constants for backwards compatibility
export { TOKEN_LIMITS };

// Statusline-specific thresholds (combines shared constants with local ones)
export const THRESHOLDS = {
  SPIKE_TOKENS: CALCULATION_CONSTANTS.SPIKE_THRESHOLD_TOKENS,
  DANGER_PERCENT: ALERT_THRESHOLDS.DANGER_PERCENT,
  WARNING_PERCENT: ALERT_THRESHOLDS.WARNING_PERCENT,
  MONITOR_INTERVAL: UI_CONSTANTS.MONITOR_INTERVAL_MS,
} as const;

import type { TokenStatus, FormatOptions } from '../../types';

// Calculate token percentage and status
export function calculateTokenStatus(totalTokens: number, model: string = 'default'): TokenStatus {
  const limit = getTokenLimitSync();
  const percentage = Math.round((totalTokens / limit) * 100);
  const remaining = limit - totalTokens;
  const remainingPercent = 100 - percentage;
  
  let status: 'normal' | 'warning' | 'danger' = 'normal';
  let emoji = '';
  
  if (percentage >= THRESHOLDS.DANGER_PERCENT) {
    status = 'danger';
    emoji = '🔴';
  } else if (percentage >= THRESHOLDS.WARNING_PERCENT) {
    status = 'warning';
    emoji = '⚠️';
  }
  
  return {
    total: totalTokens,
    limit,
    percentage,
    remaining,
    remainingPercent,
    status,
    emoji
  };
}


// Format token count for display
export function formatTokenCount(tokens: number, options: FormatOptions = {}): string {
  const { showPercentage = true, showWarning = true, showRemaining = false, showColors = true } = options;
  const status = calculateTokenStatus(tokens);
  
  // Add color based on status (75-89% yellow, 90%+ red) - only if showColors is true
  let colorCode = '';
  let needsReset = false;
  
  if (showColors) {
    if (status.percentage >= THRESHOLDS.DANGER_PERCENT) {
      colorCode = ANSI_COLORS.RED;
      needsReset = true;
    } else if (status.percentage >= THRESHOLDS.WARNING_PERCENT) {
      colorCode = ANSI_COLORS.YELLOW;
      needsReset = true;
    }
  }
  
  let output = `${colorCode}${tokens.toLocaleString()}`;
  
  if (showPercentage) {
    output += ` (${status.percentage}%`;
    if (showWarning && status.emoji) {
      output += ` ${status.emoji}`;
    }
    output += ')';
  }
  
  if (showRemaining && status.percentage >= THRESHOLDS.DANGER_PERCENT) {
    output += ` | ${status.remainingPercent}% left!`;
  }
  
  if (needsReset) {
    output += ANSI_COLORS.RESET;
  }
  
  return output;
}

// Estimate operations remaining
export function estimateOperationsRemaining(currentTokens: number, averageDelta: number = 10000, model: string = 'default'): number {
  const status = calculateTokenStatus(currentTokens, model);
  return Math.floor(status.remaining / averageDelta);
}

// Check if spike occurred
export function isSpike(tokenDelta: number): boolean {
  return tokenDelta > THRESHOLDS.SPIKE_TOKENS;
}