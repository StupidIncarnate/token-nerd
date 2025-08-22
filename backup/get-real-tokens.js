#!/usr/bin/env node
/**
 * Gets real token count from Claude Code session transcript
 * Called by statusline-command.sh to show accurate numbers
 */

const fs = require('fs');
const readline = require('readline');
const { calculateTokenStatus } = require('./config');

async function getRealTokenCount(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) {
    return { total: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, percentage: 0 };
  }

  let lastMessageWithUsage = null;
  let highestTotal = 0;

  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const msg = JSON.parse(line);
      
      // Check both .usage and .message.usage (different message formats)
      const usage = msg.usage || (msg.message && msg.message.usage);
      
      if (usage) {
        // Calculate total for this message
        const messageTotal = (usage.input_tokens || 0) + 
                            (usage.output_tokens || 0) + 
                            (usage.cache_read_input_tokens || 0) + 
                            (usage.cache_creation_input_tokens || 0);
        
        // Track the highest total we've seen (tokens accumulate)
        if (messageTotal > highestTotal) {
          highestTotal = messageTotal;
          lastMessageWithUsage = usage;
        }
      }
    } catch (e) {
      // Skip malformed lines
    }
  }

  if (!lastMessageWithUsage) {
    return { total: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, percentage: 0 };
  }

  const total = highestTotal;
  const status = calculateTokenStatus(total);

  return {
    total,
    input: lastMessageWithUsage.input_tokens || 0,
    output: lastMessageWithUsage.output_tokens || 0,
    cacheRead: lastMessageWithUsage.cache_read_input_tokens || 0,
    cacheCreation: lastMessageWithUsage.cache_creation_input_tokens || 0,
    percentage: status.percentage
  };
}

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