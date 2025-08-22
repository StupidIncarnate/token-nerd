/**
 * Shared configuration for Token Nerd
 * Central place for limits, thresholds, and calculations
 */

// Token limits by model (discovered through testing)
const TOKEN_LIMITS = {
  'claude-opus-4-1': 156000,      // Compacts at ~156k
  'claude-sonnet-4': 156000,      // Appears to be same
  'default': 156000                // Use 156k as default (not 200k!)
};

// Alert thresholds
const THRESHOLDS = {
  SPIKE_TOKENS: 10000,           // Alert on jumps > 10k
  DANGER_PERCENT: 85,             // Red alert at 85%
  WARNING_PERCENT: 70,            // Yellow warning at 70%
  MONITOR_INTERVAL: 2000,         // Check every 2 seconds
};

// Calculate token percentage and status
function calculateTokenStatus(totalTokens, model = 'default') {
  const limit = TOKEN_LIMITS[model] || TOKEN_LIMITS.default;
  const percentage = Math.round((totalTokens / limit) * 100);
  const remaining = limit - totalTokens;
  const remainingPercent = 100 - percentage;
  
  let status = 'normal';
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
function formatTokenCount(tokens, options = {}) {
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
function estimateOperationsRemaining(currentTokens, averageDelta = 10000, model = 'default') {
  const status = calculateTokenStatus(currentTokens, model);
  return Math.floor(status.remaining / averageDelta);
}

// Check if spike occurred
function isSpike(tokenDelta) {
  return tokenDelta > THRESHOLDS.SPIKE_TOKENS;
}

module.exports = {
  TOKEN_LIMITS,
  THRESHOLDS,
  calculateTokenStatus,
  formatTokenCount,
  estimateOperationsRemaining,
  isSpike
};