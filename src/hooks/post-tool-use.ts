#!/usr/bin/env -S npx tsx

import { createClient } from 'redis';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

let redisClient: any = null;

async function getRedisClient() {
  if (!redisClient || !redisClient.isOpen) {
    redisClient = createClient({
      url: 'redis://localhost:6379',
      socket: {
        connectTimeout: 500,
        reconnectStrategy: (retries) => retries > 3 ? false : Math.min(retries * 50, 500)
      }
    });
    await redisClient.connect();
  }
  return redisClient;
}

function calculateResponseSize(response: any): { size: number; serialized?: string } {
  if (typeof response === 'string') {
    return { size: response.length };
  } else if (response && typeof response === 'object') {
    const serialized = JSON.stringify(response);
    return { size: serialized.length, serialized };
  }
  return { size: 0 };
}

export async function main() {
  // Read JSON from stdin
  let input = '';
  process.stdin.setEncoding('utf8');
  
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  
  // Pass through the input immediately
  console.log(input);
  
  // Process Redis and file operations asynchronously (fire-and-forget)
  setImmediate(async () => {
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
        return; // Silently fail for missing fields in async mode
      }
      
      // Calculate response size for proportional allocation
      const { size: responseSize, serialized } = calculateResponseSize(tool_response);
      
      const redis = await getRedisClient();
      
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
      
      // For large responses, store on filesystem asynchronously
      if (responseSize > 10000) {
        // Use unique filename to prevent collisions
        const uniqueId = `${timestamp}-${message_id || Math.random().toString(36).substring(2, 11)}`;
        const responsesDir = path.join(
          os.homedir(),
          '.claude',
          'token-nerd',
          'responses',
          session_id
        );
        
        const filePath = path.join(responsesDir, `${uniqueId}.json`);
        
        // Fire-and-forget file write (don't await) - reuse serialized JSON
        const responseJson = serialized || JSON.stringify(tool_response);
        fs.mkdir(responsesDir, { recursive: true })
          .then(() => fs.writeFile(filePath, responseJson))
          .catch(error => {
            if (process.env.DEBUG) {
              console.error('File write error in post-tool-use hook:', error);
            }
          });
        
        // Store reference in Redis instead
        value.response = `file://${filePath}`;
      }
      
      // Use pipeline for better performance
      const pipeline = redis.multi();
      pipeline.set(key, JSON.stringify(value), { EX: 86400 });
      
      // Link to message if provided
      if (message_id) {
        pipeline.sAdd(`message:${message_id}:operations`, `${timestamp}:${tool_name}`);
      }
      
      await pipeline.exec();
      
    } catch (error) {
      // Silently log errors in async mode to avoid disrupting Claude
      if (process.env.DEBUG) {
        console.error('Async Redis error in post-tool-use hook:', error);
      }
    }
  });
}

// Cleanup Redis connection on process exit
process.on('SIGTERM', async () => {
  if (redisClient && redisClient.isOpen) {
    await (redisClient as any).quit();
  }
});

process.on('SIGINT', async () => {
  if (redisClient && redisClient.isOpen) {
    await (redisClient as any).quit();
  }
});

main().catch(console.error);