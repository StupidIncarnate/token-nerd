#!/usr/bin/env tsx
/**
 * Gets real token count from Claude Code session transcript
 * Called by statusline-command.sh to show accurate numbers
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { calculateTokenStatus } from './config';
import { getCurrentTokenCount } from '../lib/token-calculator';

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

interface TokenResult {
  total: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  percentage: number;
}

export async function getRealTokenCount(transcriptPath: string): Promise<TokenResult> {
  const total = await getCurrentTokenCount(transcriptPath);
  
  if (total === 0) {
    return { total: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, percentage: 0 };
  }

  // Get detailed breakdown from last message for statusline details
  let lastMessageWithUsage: TokenUsage | null = null;

  if (fs.existsSync(transcriptPath)) {
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      
      try {
        const msg: TranscriptMessage = JSON.parse(line);
        const usage = msg.usage || msg.message?.usage;
        
        if (usage) {
          const messageTotal = (usage.input_tokens || 0) + 
                              (usage.output_tokens || 0) + 
                              (usage.cache_read_input_tokens || 0) + 
                              (usage.cache_creation_input_tokens || 0);
          
          if (messageTotal === total) {
            lastMessageWithUsage = usage;
          }
        }
      } catch (e) {
        // Skip malformed lines
      }
    }
  }

  const status = calculateTokenStatus(total);

  return {
    total,
    input: lastMessageWithUsage?.input_tokens || 0,
    output: lastMessageWithUsage?.output_tokens || 0,
    cacheRead: lastMessageWithUsage?.cache_read_input_tokens || 0,
    cacheCreation: lastMessageWithUsage?.cache_creation_input_tokens || 0,
    percentage: status.percentage
  };
}

// Only run main() if this file is executed directly (not imported)
if (require.main === module) {
  // Main execution
  async function main() {
    const transcriptPath = process.argv[2];
    
    if (!transcriptPath) {
      // Return empty result if no path provided
      console.log('0');
      process.exit(0);
    }

    try {
      const tokens = await getRealTokenCount(transcriptPath);
      
      // Output format that statusline can use
      // Just the total for now, can be enhanced
      console.log(tokens.total);
      
      // Debug info to stderr (won't interfere with statusline)
      if (process.env.DEBUG) {
        console.error('Token breakdown:', {
          total: tokens.total,
          input: tokens.input,
          output: tokens.output,
          cacheRead: tokens.cacheRead,
          cacheCreation: tokens.cacheCreation,
          percentage: tokens.percentage
        });
      }
    } catch (error) {
      console.error('Error reading transcript:', error);
      console.log('0');
    }
  }

  main();
}