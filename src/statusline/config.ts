/**
 * Statusline-specific configuration for Token Nerd
 * Imports shared constants and provides statusline-specific logic
 */

import {
  TOKEN_LIMITS,
  CALCULATION_CONSTANTS,
  ALERT_THRESHOLDS,
  UI_CONSTANTS
} from '../config';

// Re-export shared constants for backwards compatibility
export { TOKEN_LIMITS };

// Statusline-specific thresholds (combines shared constants with local ones)
export const THRESHOLDS = {
  SPIKE_TOKENS: CALCULATION_CONSTANTS.SPIKE_THRESHOLD_TOKENS,
  DANGER_PERCENT: ALERT_THRESHOLDS.DANGER_PERCENT,
  WARNING_PERCENT: ALERT_THRESHOLDS.WARNING_PERCENT,
  MONITOR_INTERVAL: UI_CONSTANTS.MONITOR_INTERVAL_MS,
} as const;

export interface TokenStatus {
  total: number;
  limit: number;
  percentage: number;
  remaining: number;
  remainingPercent: number;
  status: 'normal' | 'warning' | 'danger';
  emoji: string;
}

// Calculate token percentage and status
export function calculateTokenStatus(totalTokens: number, model: string = 'default'): TokenStatus {
  const limit = TOKEN_LIMITS[model as keyof typeof TOKEN_LIMITS] || TOKEN_LIMITS.default;
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

export interface FormatOptions {
  showPercentage?: boolean;
  showWarning?: boolean;
  showRemaining?: boolean;
}

// Format token count for display
export function formatTokenCount(tokens: number, options: FormatOptions = {}): string {
  const { showPercentage = true, showWarning = true, showRemaining = false } = options;
  const status = calculateTokenStatus(tokens);
  
  let output = tokens.toLocaleString();
  
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