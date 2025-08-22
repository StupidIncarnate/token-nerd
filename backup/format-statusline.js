#!/usr/bin/env node
/**
 * Formats token count for statusline display
 * Shows real tokens with cache breakdown
 */

const { formatTokenCount } = require('./config');

const transcriptPath = process.argv[2];
const tokenCount = parseInt(process.argv[3]) || 0;

if (!tokenCount) {
  // Fallback to estimate
  console.log('~? (est)');
  process.exit(0);
}

// Use shared formatting with statusline-specific options
const output = formatTokenCount(tokenCount, {
  showPercentage: true,
  showWarning: true,
  showRemaining: true  // Show "X% left!" when critical
});

console.log(output);