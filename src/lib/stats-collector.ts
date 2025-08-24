import { execSync } from 'child_process';
import { createClient } from 'redis';
import { glob } from 'glob';
import fs from 'fs';
import os from 'os';
import { getRealTokenCount } from '../statusline/get-real-tokens';

export interface ContextStats {
  model: string;
  totalTokens: number;
  usedPercentage: number;
  contextBreakdown: {
    systemPrompt: number;
    systemTools: number;
    mcpTools: number;
    memoryFiles: number;
    messages: number;
    freeSpace: number;
  };
  mcpTools: Array<{
    name: string;
    tokens: number;
  }>;
  memoryFiles: Array<{
    name: string;
    path: string;
    tokens: number;
  }>;
}

export interface SessionStats {
  sessionId: string;
  timestamp: number;
  contextStats: ContextStats;
}

export async function collectContextStats(): Promise<{ display: string; actualTokens: number; sessionId: string } | null> {
  let tempSessionId: string | null = null;
  
  try {
    // Trigger a simple tool call to capture initial context cost via hooks
    const output = execSync('claude -p --output-format json "Use the Bash tool to run \'date\'"', { 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const result = JSON.parse(output);
    
    if (!result.session_id || !result.usage) {
      console.warn('Warning: Could not get session info from Claude headless mode');
      return null;
    }
    
    tempSessionId = result.session_id;
    
    // Calculate total initial context tokens
    const usage = result.usage;
    const totalTokens = (usage.input_tokens || 0) + 
                       (usage.cache_creation_input_tokens || 0) + 
                       (usage.cache_read_input_tokens || 0) + 
                       (usage.output_tokens || 0);
    
    const stats = {
      display: JSON.stringify({
        totalTokens,
        sessionId: result.session_id,
        usage: result.usage,
        timestamp: Date.now(),
        type: 'initial_context'
      }),
      actualTokens: totalTokens,
      sessionId: result.session_id
    };
    
    // Clean up the temporary session data
    if (tempSessionId) {
      await cleanupTempSession(tempSessionId);
    }
    
    return stats;
  } catch (error) {
    // Still try to cleanup if we got a session ID
    if (tempSessionId) {
      await cleanupTempSession(tempSessionId);
    }
    console.warn('Warning: Could not collect context stats:', (error as Error).message);
    return null;
  }
}

async function cleanupTempSession(sessionId: string): Promise<void> {
  let redisClient;
  try {
    redisClient = createClient({
      url: 'redis://localhost:6379',
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: (retries) => retries > 3 ? false : Math.min(retries * 50, 500)
      }
    });
    
    await redisClient.connect();
    
    // Clean up all Redis keys for this temporary session
    const sessionKeys = await redisClient.keys(`session:${sessionId}:*`);
    if (sessionKeys.length > 0) {
      await redisClient.del(sessionKeys);
      console.log(`Cleaned up ${sessionKeys.length} Redis keys for temp session ${sessionId.slice(0, 8)}`);
    }
    
    await redisClient.disconnect();
  } catch (error) {
    console.warn('Warning: Could not cleanup temp session from Redis:', (error as Error).message);
    if (redisClient) {
      try {
        await redisClient.disconnect();
      } catch {}
    }
  }
  
  // Also try to clean up the JSONL file
  try {
    const os = await import('os');
    const fs = await import('fs');
    const { glob } = await import('glob');
    
    const claudeProjectsDir = `${os.homedir()}/.claude/projects`;
    const pattern = `${claudeProjectsDir}/**/${sessionId}.jsonl`;
    const files = await glob(pattern, {});
    
    for (const file of files) {
      fs.unlinkSync(file);
      console.log(`Cleaned up temp JSONL file: ${file}`);
    }
  } catch (error) {
    // Ignore JSONL cleanup errors - it's not critical
  }
}

async function getCurrentSessionTokens(): Promise<number | null> {
  try {
    const { glob } = await import('glob');
    const os = await import('os');
    const fs = await import('fs');
    const { getRealTokenCount } = await import('../statusline/get-real-tokens');
    
    // Find the most recent JSONL file (current session)
    const claudeProjectsDir = `${os.homedir()}/.claude/projects`;
    const pattern = `${claudeProjectsDir}/**/*.jsonl`;
    const files = await glob(pattern, {});
    
    if (files.length === 0) return null;
    
    // Get the most recently modified file
    const mostRecent = files.reduce((latest: string, current: string) => {
      const currentStat = fs.statSync(current);
      const latestStat = fs.statSync(latest);
      return currentStat.mtime > latestStat.mtime ? current : latest;
    });
    
    const tokens = await getRealTokenCount(mostRecent);
    return tokens.total;
  } catch (error) {
    return null;
  }
}


export async function storeCurrentSnapshot(stats: { display: string; actualTokens: number; sessionId: string }): Promise<void> {
  let redisClient;
  try {
    redisClient = createClient({
      url: 'redis://localhost:6379',
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: (retries) => retries > 3 ? false : Math.min(retries * 50, 500)
      }
    });
    
    await redisClient.connect();
    
    const timestamp = Date.now();
    
    // Store as current snapshot for new sessions
    const currentKey = 'context:current';
    await redisClient.set(currentKey, JSON.stringify({ stats, timestamp }));
    
    // Store historic snapshot
    const historicKey = `context:snapshot:${timestamp}`;
    await redisClient.set(historicKey, JSON.stringify({ stats, timestamp }));
    
    await redisClient.disconnect();
  } catch (error) {
    console.warn('Warning: Could not store context snapshot in Redis:', (error as Error).message);
    if (redisClient) {
      try {
        await redisClient.disconnect();
      } catch {}
    }
  }
}

export async function getCurrentSnapshot(): Promise<{ stats: { display: string; actualTokens: number; sessionId: string }; timestamp: number } | null> {
  let redisClient;
  try {
    redisClient = createClient({
      url: 'redis://localhost:6379',
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: (retries) => retries > 3 ? false : Math.min(retries * 50, 500)
      }
    });
    
    await redisClient.connect();
    
    const currentKey = 'context:current';
    const data = await redisClient.get(currentKey);
    
    await redisClient.disconnect();
    
    return data ? JSON.parse(data) : null;
  } catch (error) {
    if (redisClient) {
      try {
        await redisClient.disconnect();
      } catch {}
    }
    return null;
  }
}

export async function getSnapshotForSession(sessionId: string): Promise<{ stats: { display: string; actualTokens: number; sessionId: string }; timestamp: number } | null> {
  let redisClient;
  try {
    redisClient = createClient({
      url: 'redis://localhost:6379',
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: (retries) => retries > 3 ? false : Math.min(retries * 50, 500)
      }
    });
    
    await redisClient.connect();
    
    // First check if session has a specific snapshot stored
    const sessionSnapshotKey = `session:${sessionId}:context-snapshot`;
    const sessionSnapshot = await redisClient.get(sessionSnapshotKey);
    
    if (sessionSnapshot) {
      await redisClient.disconnect();
      return JSON.parse(sessionSnapshot);
    }
    
    // Find session start time from JSONL or estimate
    const sessionStartTime = await getSessionStartTime(sessionId);
    
    if (sessionStartTime) {
      // Find closest snapshot timestamp that's <= session start time
      const snapshotKeys = await redisClient.keys('context:snapshot:*');
      let closestSnapshot = null;
      let closestTimestamp = 0;
      
      for (const key of snapshotKeys) {
        const timestamp = parseInt(key.split(':')[2]);
        if (timestamp <= sessionStartTime && timestamp > closestTimestamp) {
          closestTimestamp = timestamp;
          const data = await redisClient.get(key);
          if (data) {
            closestSnapshot = JSON.parse(data);
          }
        }
      }
      
      if (closestSnapshot) {
        await redisClient.disconnect();
        return closestSnapshot;
      }
    }
    
    // Fallback to current snapshot
    const currentKey = 'context:current';
    const currentData = await redisClient.get(currentKey);
    
    await redisClient.disconnect();
    
    return currentData ? JSON.parse(currentData) : null;
  } catch (error) {
    if (redisClient) {
      try {
        await redisClient.disconnect();
      } catch {}
    }
    return null;
  }
}

async function getSessionStartTime(sessionId: string): Promise<number | null> {
  try {
    const os = await import('os');
    const fs = await import('fs');
    const path = await import('path');
    const { glob } = await import('glob');
    
    // Find the JSONL file for this session
    const claudeProjectsDir = `${os.homedir()}/.claude/projects`;
    const pattern = `${claudeProjectsDir}/**/${sessionId}.jsonl`;
    const files = await glob(pattern, {});
    
    if (files.length === 0) {
      // Fallback: use current time - this session might be active
      return Date.now();
    }
    
    const jsonlPath = files[0];
    
    // Read first line to get session start time
    const content = fs.readFileSync(jsonlPath, 'utf8');
    const lines = content.trim().split('\n');
    if (lines.length === 0) return Date.now();
    
    const firstLine = lines[0];
    const firstMessage = JSON.parse(firstLine);
    return new Date(firstMessage.timestamp).getTime();
  } catch (error) {
    return null;
  }
}

export async function assignSnapshotToSession(sessionId: string): Promise<void> {
  let redisClient;
  try {
    redisClient = createClient({
      url: 'redis://localhost:6379',
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: (retries) => retries > 3 ? false : Math.min(retries * 50, 500)
      }
    });
    
    await redisClient.connect();
    
    // Get current snapshot
    const currentKey = 'context:current';
    const currentData = await redisClient.get(currentKey);
    
    if (currentData) {
      // Assign this snapshot to the session
      const sessionSnapshotKey = `session:${sessionId}:context-snapshot`;
      await redisClient.set(sessionSnapshotKey, currentData);
    }
    
    await redisClient.disconnect();
  } catch (error) {
    if (redisClient) {
      try {
        await redisClient.disconnect();
      } catch {}
    }
  }
}

export async function getLatestSessionStats(sessionId: string): Promise<SessionStats | null> {
  let redisClient;
  try {
    redisClient = createClient({
      url: 'redis://localhost:6379',
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: (retries) => retries > 3 ? false : Math.min(retries * 50, 500)
      }
    });
    
    await redisClient.connect();
    
    const latestKey = `session:${sessionId}:stats:latest`;
    const data = await redisClient.get(latestKey);
    
    await redisClient.disconnect();
    
    return data ? JSON.parse(data) : null;
  } catch (error) {
    if (redisClient) {
      try {
        await redisClient.disconnect();
      } catch {}
    }
    return null;
  }
}