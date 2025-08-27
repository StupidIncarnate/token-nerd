#!/usr/bin/env node

/**
 * Token Nerd MCP Server
 * 
 * This server's ONLY job is to ensure Redis is running
 * so that hooks can write to it.
 */

import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';

let redisProcess: ChildProcess | null = null;

async function isRedisRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const client = net.createConnection(6379, '127.0.0.1');
    client.on('connect', () => {
      client.end();
      resolve(true);
    });
    client.on('error', () => {
      resolve(false);
    });
    setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 1000);
  });
}

async function startRedis(): Promise<void> {
  if (await isRedisRunning()) {
    console.error('[Token-Nerd] Redis already running');
    return;
  }

  console.error('[Token-Nerd] Starting Redis...');
  redisProcess = spawn('redis-server', [
    '--port', '6379',
    '--daemonize', 'no',
    '--save', '60', '1',  // Save if at least 1 change in 60 seconds
    '--appendonly', 'yes'  // Enable AOF for durability
  ], {
    stdio: 'ignore',
    detached: false
  });

  // Wait for Redis to be ready
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (await isRedisRunning()) {
      console.error('[Token-Nerd] Redis started successfully');
      return;
    }
  }
  
  console.error('[Token-Nerd] Failed to start Redis');
  process.exit(1);
}

async function main() {
  // Start Redis
  await startRedis();
  
  // Keep the process alive
  console.error('[Token-Nerd] MCP server ready, Redis is running');
  
  // Handle MCP protocol properly
  let initialized = false;
  
  process.stdin.on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        
        if (message.method === 'initialize') {
          const response = {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              serverInfo: {
                name: 'token-nerd-redis',
                version: '1.0.0'
              }
            }
          };
          process.stdout.write(JSON.stringify(response) + '\n');
          
        } else if (message.method === 'notifications/initialized') {
          initialized = true;
          
        } else if (message.method === 'ping') {
          const response = {
            jsonrpc: '2.0',
            id: message.id,
            result: {}
          };
          process.stdout.write(JSON.stringify(response) + '\n');
          
        } else {
          // Return empty result for any other method
          if (message.id) {
            const response = {
              jsonrpc: '2.0',
              id: message.id,
              result: {}
            };
            process.stdout.write(JSON.stringify(response) + '\n');
          }
        }
      } catch (error) {
        // Ignore malformed JSON
      }
    }
  });

  // Handle shutdown
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('end', shutdown);
}

function shutdown() {
  console.error('[Token-Nerd] Shutting down...');
  if (redisProcess) {
    redisProcess.kill();
  }
  process.exit(0);
}

export { main };

// If run directly (not as import), execute main
if (require.main === module) {
  main().catch(console.error);
}