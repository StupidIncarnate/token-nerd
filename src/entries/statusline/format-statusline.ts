#!/usr/bin/env tsx
/**
 * Formats token count for statusline display
 * Shows real tokens with cache breakdown
 */

import { formatTokenCount } from './config';

const transcriptPath = process.argv[2];
const tokenCount = parseInt(process.argv[3]) || 0;
const noColors = process.argv.includes('--no-colors');

if (!tokenCount) {
  // Fallback to estimate
  console.log('~? (est)');
  process.exit(0);
}

// Use shared formatting with statusline-specific options
const output = formatTokenCount(tokenCount, {
  showPercentage: true,
  showWarning: true,
  showRemaining: true,  // Show "X% left!" when critical
  showColors: !noColors // Disable colors if --no-colors flag is present
});

console.log(output);