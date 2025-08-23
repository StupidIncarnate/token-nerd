import * as fs from 'fs';
import * as readline from 'readline';

interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  total_tokens?: number;
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
          const messageTotal = (usage.input_tokens || 0) + 
                              (usage.output_tokens || 0) + 
                              (usage.cache_read_input_tokens || 0) + 
                              (usage.cache_creation_input_tokens || 0);
          
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
 * Rough estimation of tokens from content string
 * Using simple heuristic: ~4 chars per token (Claude's approximation)
 */
export function estimateTokensFromContent(content: string): number {
  return Math.ceil(content.length / 4);
}