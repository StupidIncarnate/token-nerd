import * as fs from 'fs';
import * as readline from 'readline';

interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  total_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

interface TranscriptMessage {
  type?: string;
  usage?: TokenUsage;
  message?: {
    usage?: TokenUsage;
  };
}

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
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      
      try {
        const msg: TranscriptMessage = JSON.parse(line);
        
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
      } catch (e) {
        // Skip malformed lines
      }
    }
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
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      
      try {
        const msg: TranscriptMessage = JSON.parse(line);
        
        // Check both .usage and .message.usage (different message formats)
        const usage = msg.usage || msg.message?.usage;
        
        if (usage) {
          // Calculate total for this message - always use the most recent
          lastTotal = calculateCumulativeTotal(usage);
        }
      } catch (e) {
        // Skip malformed lines
      }
    }
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
export function calculateRemainingCapacity(currentTotal: number, contextWindowLimit: number = 200000): {
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
 * Using simple heuristic: ~3.7 chars per token (consistent across codebase)
 */
export function estimateTokensFromContent(content: string): number;
export function estimateTokensFromContent(size: number): number;
export function estimateTokensFromContent(input: string | number): number {
  const length = typeof input === 'string' ? input.length : input;
  return Math.ceil(length / 3.7);
}