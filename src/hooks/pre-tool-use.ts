#!/usr/bin/env -S npx tsx

import { createClient } from 'redis';

async function main() {
  // Read JSON from stdin
  let input = '';
  process.stdin.setEncoding('utf8');
  
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  
  try {
    const data = JSON.parse(input);
    
    // Extract relevant fields
    const {
      session_id,
      tool_name,
      tool_input,
      timestamp = Date.now()
    } = data;
    
    if (!session_id || !tool_name) {
      console.error('Missing required fields: session_id or tool_name');
      process.exit(1);
    }
    
    // Connect to Redis (MCP server ensures it's running)
    const redis = createClient({
      url: 'redis://localhost:6379',
      socket: {
        connectTimeout: 1000
      }
    });
    
    await redis.connect();
    
    // Store operation request
    const key = `session:${session_id}:operations:${timestamp}:request`;
    const value = {
      tool: tool_name,
      params: tool_input,
      timestamp,
      session_id
    };
    
    await redis.set(key, JSON.stringify(value), {
      EX: 86400 // Expire after 24 hours
    });
    
    // Track in sorted set for chronological retrieval
    await redis.zAdd(`session:${session_id}:timeline`, {
      score: timestamp,
      value: `${timestamp}:${tool_name}`
    });
    
    await redis.quit();
    
    // Pass through the input unchanged
    console.log(input);
    
  } catch (error) {
    console.error('Error in pre-tool-use hook:', error);
    // Still pass through the input even if Redis fails
    console.log(input);
    process.exit(1);
  }
}

main().catch(console.error);