import * as fs from 'fs';
import { JsonlReader } from './jsonl-utils';
import type { TranscriptMessage } from '../types';

import type { TokenUsage } from '../types';


/**
 * Gets accurate token count from JSONL transcript file
 * Used by both statusline and session selector for consistency
 */
export async function getTokenCount(transcriptPath: string): Promise<number> {
  if (!fs.existsSync(transcriptPath)) {
    return 0;
  }

  let highestTotal = 0;

  try {
    await JsonlReader.streamMessages(transcriptPath, (msg) => {
      // Check both .usage and .message.usage (different message formats)
      const usage = msg.usage || msg.message?.usage;
      
      if (usage) {
        // Calculate total for this message
        const messageTotal = calculateCumulativeTotal(usage);
        
        // Track the highest total we've seen (tokens accumulate)
        if (messageTotal > highestTotal) {
          highestTotal = messageTotal;
        }
      }
      
      return null; // We don't need to collect results, just track highestTotal
    });
  } catch (error) {
    // Fall back to file size estimate if parsing fails
    try {
      const stats = fs.statSync(transcriptPath);
      return Math.round(stats.size / 100);
    } catch (statError) {
      return 0;
    }
  }

  return highestTotal;
}

/**
 * Gets the current token count from the last message in JSONL transcript
 * Used specifically for statusline to show current context window usage
 */
export async function getCurrentTokenCount(transcriptPath: string): Promise<number> {
  if (!fs.existsSync(transcriptPath)) {
    return 0;
  }

  let lastTotal = 0;

  try {
    await JsonlReader.streamMessages(transcriptPath, (msg) => {
      // Check both .usage and .message.usage (different message formats)
      const usage = msg.usage || msg.message?.usage;
      
      if (usage) {
        // Calculate total for this message - always use the most recent
        lastTotal = calculateCumulativeTotal(usage);
      }
      
      return null; // We don't need to collect results, just track lastTotal
    });
  } catch (error) {
    // Fall back to file size estimate if parsing fails
    try {
      const stats = fs.statSync(transcriptPath);
      return Math.round(stats.size / 100);
    } catch (statError) {
      return 0;
    }
  }

  return lastTotal;
}

/**
 * Calculate cumulative total from usage data
 * Used by both getTokenCount and TUI for consistency
 */
export function calculateCumulativeTotal(usage: TokenUsage): number {
  return (usage.input_tokens || 0) + 
         (usage.output_tokens || 0) + 
         (usage.cache_read_input_tokens || 0) + 
         (usage.cache_creation_input_tokens || 0);
}

/**
 * Calculate conversation growth (input + output tokens only)
 * This represents actual context window consumption, not caching efficiency
 */
export function calculateConversationGrowth(usage: TokenUsage): number {
  return (usage.input_tokens || 0) + (usage.output_tokens || 0);
}

/**
 * Calculate remaining context window capacity
 * Claude Sonnet 4 has 200k token limit
 */
import { CALCULATION_CONSTANTS, getTokenLimit } from '../config';

export function calculateRemainingCapacity(currentTotal: number, contextWindowLimit: number = getTokenLimit()): {
  remaining: number;
  percentage: number;
  isNearLimit: boolean;
} {
  const remaining = Math.max(0, contextWindowLimit - currentTotal);
  const percentage = (remaining / contextWindowLimit) * 100;
  const isNearLimit = percentage < 10; // Less than 10% remaining
  
  return { remaining, percentage, isNearLimit };
}

/**
 * Rough estimation of tokens from content string or size
 * Using simple heuristic from config (consistent across codebase)
 */
export function estimateTokensFromContent(content: string): number;
export function estimateTokensFromContent(size: number): number;
export function estimateTokensFromContent(input: string | number): number {
  const length = typeof input === 'string' ? input.length : input;
  return Math.ceil(length / CALCULATION_CONSTANTS.CHARS_PER_TOKEN_ESTIMATE);
}