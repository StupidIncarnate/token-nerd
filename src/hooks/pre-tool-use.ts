#!/usr/bin/env -S npx tsx

import { createClient } from 'redis';
import { getAssistantMessageCount } from '../lib/jsonl-utils';

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

async function processRedisOperations(input: string) {
  try {
    const data = JSON.parse(input);
    
    const {
      session_id,
      tool_name,
      tool_input,
      timestamp = Date.now()
    } = data;
    
    if (!session_id || !tool_name) {
      return;
    }
    
    const redis = await getRedisClient();
    
    // Get sequence number from JSONL
    const sequence = getAssistantMessageCount(session_id);
    
    const key = `session:${session_id}:operations:${timestamp}:request`;
    const value = {
      tool: tool_name,
      params: tool_input,
      timestamp,
      session_id,
      sequence
    };
    
    const pipeline = redis.multi();
    pipeline.set(key, JSON.stringify(value), { EX: 86400 });
    pipeline.zAdd(`session:${session_id}:timeline`, {
      score: timestamp,
      value: `${timestamp}:${tool_name}`
    });
    await pipeline.exec();
  } catch (error) {
    // Silent fail
  }
}

export async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (chunk) => {
    input += chunk;
  });

  process.stdin.on('end', async () => {
    console.log(input);
    
    // Wait for Redis operations to complete
    await processRedisOperations(input);
    
    process.exit(0);
  });
}

// If run directly (not as import), execute main
if (require.main === module) {
  main().catch(() => process.exit(1));
}