#!/usr/bin/env -S npx tsx

import { createClient } from 'redis';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function calculateResponseSize(response: any): number {
  if (typeof response === 'string') {
    return response.length;
  } else if (response && typeof response === 'object') {
    return JSON.stringify(response).length;
  }
  return 0;
}

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
      tool_response,
      message_id,
      usage,
      timestamp = Date.now()
    } = data;
    
    if (!session_id || !tool_name) {
      console.error('Missing required fields: session_id or tool_name');
      process.exit(1);
    }
    
    // Calculate response size for proportional allocation
    const responseSize = calculateResponseSize(tool_response);
    
    // Connect to Redis (MCP server ensures it's running)
    const redis = createClient({
      url: 'redis://localhost:6379',
      socket: {
        connectTimeout: 1000
      }
    });
    
    await redis.connect();
    
    // Store operation response
    const key = `session:${session_id}:operations:${timestamp}:response`;
    let value: any = {
      tool: tool_name,
      response: tool_response,
      responseSize,
      timestamp,
      session_id,
      message_id,
      usage
    };
    
    // For large responses, store on filesystem
    if (responseSize > 10000) {
      const responsesDir = path.join(
        os.homedir(),
        '.claude',
        'token-nerd',
        'responses',
        session_id
      );
      
      if (!fs.existsSync(responsesDir)) {
        fs.mkdirSync(responsesDir, { recursive: true });
      }
      
      const filePath = path.join(responsesDir, `${timestamp}.json`);
      fs.writeFileSync(filePath, JSON.stringify(tool_response));
      
      // Store reference in Redis instead
      value.response = `file://${filePath}`;
    }
    
    await redis.set(key, JSON.stringify(value), {
      EX: 86400 // Expire after 24 hours
    });
    
    // Link to message if provided
    if (message_id) {
      await redis.sAdd(`message:${message_id}:operations`, `${timestamp}:${tool_name}`);
    }
    
    await redis.quit();
    
    // Pass through the input unchanged
    console.log(input);
    
  } catch (error) {
    console.error('Error in post-tool-use hook:', error);
    // Still pass through the input
    console.log(input);
    process.exit(1);
  }
}

main().catch(console.error);