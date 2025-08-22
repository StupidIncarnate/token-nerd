#!/usr/bin/env -S npx tsx

import { createClient } from 'redis';

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

async function main() {
  // Read JSON from stdin
  let input = '';
  process.stdin.setEncoding('utf8');
  
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  
  // Pass through the input immediately
  console.log(input);
  
  // Process Redis operations asynchronously (fire-and-forget)
  setImmediate(async () => {
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
        return; // Silently fail for missing fields in async mode
      }
      
      const redis = await getRedisClient();
      
      // Store operation request
      const key = `session:${session_id}:operations:${timestamp}:request`;
      const value = {
        tool: tool_name,
        params: tool_input,
        timestamp,
        session_id
      };
      
      // Use pipeline for better performance
      const pipeline = redis.multi();
      pipeline.set(key, JSON.stringify(value), { EX: 86400 });
      pipeline.zAdd(`session:${session_id}:timeline`, {
        score: timestamp,
        value: `${timestamp}:${tool_name}`
      });
      await pipeline.exec();
      
    } catch (error) {
      // Silently log errors in async mode to avoid disrupting Claude
      if (process.env.DEBUG) {
        console.error('Async Redis error in pre-tool-use hook:', error);
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