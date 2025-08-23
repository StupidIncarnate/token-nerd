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

async function processRedisOperations(input: string) {
  try {
    const data = JSON.parse(input);
    
    const {
      session_id,
      tool_name,
      tool_response,
      message_id,
      usage,
      timestamp = Date.now()
    } = data;
    
    if (!session_id || !tool_name) {
      return;
    }
    
    const { size: responseSize, serialized } = calculateResponseSize(tool_response);
    const redis = await getRedisClient();
    
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
    
    if (responseSize > 10000) {
      const uniqueId = `${timestamp}-${message_id || Math.random().toString(36).substring(2, 11)}`;
      const responsesDir = path.join(os.homedir(), '.claude', 'token-nerd', 'responses', session_id);
      const filePath = path.join(responsesDir, `${uniqueId}.json`);
      
      const responseJson = serialized || JSON.stringify(tool_response);
      fs.mkdir(responsesDir, { recursive: true })
        .then(() => fs.writeFile(filePath, responseJson))
        .catch(() => {}); // Silent fail
      
      value.response = `file://${filePath}`;
    }
    
    const pipeline = redis.multi();
    pipeline.set(key, JSON.stringify(value), { EX: 86400 });
    
    if (message_id) {
      pipeline.sAdd(`message:${message_id}:operations`, `${timestamp}:${tool_name}`);
    }
    
    await pipeline.exec();
  } catch (error) {
    // Silent fail
  }
}

async function main() {
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

main().catch(() => process.exit(1));