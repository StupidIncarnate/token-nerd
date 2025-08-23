import { createClient } from 'redis';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface Operation {
  tool: string;
  params: any;
  response: any;
  responseSize: number;
  timestamp: number;
  session_id: string;
  message_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    total_tokens?: number;
  };
  tokens: number;
  allocation: 'exact' | 'proportional' | 'estimated';
  details: string;
}

export interface Bundle {
  id: string;
  timestamp: number;
  operations: Operation[];
  totalTokens: number;
}

export interface JsonlMessage {
  id: string;
  timestamp: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  content?: any;
}

let redisClient: any = null;

// Export for testing
export function resetRedisClient() {
  redisClient = null;
}

async function getRedisClient() {
  if (!redisClient || !redisClient.isOpen) {
    redisClient = createClient({
      url: 'redis://localhost:6379',
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: (retries) => retries > 3 ? false : Math.min(retries * 50, 500)
      }
    });
    try {
      await redisClient.connect();
    } catch (error) {
      console.warn('Warning: Redis not available, using file-based fallback');
      return null;
    }
  }
  return redisClient;
}

async function getHookOperations(sessionId: string): Promise<Operation[]> {
  const redis = await getRedisClient();
  if (!redis) return [];

  try {
    // Handle both short session IDs (first 8 chars) and full session IDs
    // First try exact match
    let requestKeys = await redis.keys(`session:${sessionId}:operations:*:request`);
    let responseKeys = await redis.keys(`session:${sessionId}:operations:*:response`);
    
    // If no exact match and sessionId looks like short version, search for full session ID
    if (requestKeys.length === 0 && sessionId.length === 8) {
      const allSessionKeys = await redis.keys(`session:${sessionId}*:operations:*:request`);
      requestKeys = allSessionKeys;
      const allResponseKeys = await redis.keys(`session:${sessionId}*:operations:*:response`);
      responseKeys = allResponseKeys;
    }
    
    // Create a map of timestamp -> operations
    const operationMap = new Map<string, Partial<Operation>>();
    
    // Process request data
    for (const key of requestKeys) {
      const timestamp = key.split(':')[3];
      const data = await redis.get(key);
      if (data) {
        const parsed = JSON.parse(data);
        operationMap.set(timestamp, {
          tool: parsed.tool,
          params: parsed.params,
          timestamp: parseInt(timestamp),
          session_id: parsed.session_id
        });
      }
    }
    
    // Process response data
    for (const key of responseKeys) {
      const timestamp = key.split(':')[3];
      const data = await redis.get(key);
      if (data) {
        const parsed = JSON.parse(data);
        const existing = operationMap.get(timestamp) || {};
        
        let response = parsed.response;
        // Handle file references
        if (typeof response === 'string' && response.startsWith('file://')) {
          const filePath = response.replace('file://', '');
          try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            response = JSON.parse(fileContent);
          } catch (error) {
            response = `[Large response stored in ${filePath}]`;
          }
        }
        
        operationMap.set(timestamp, {
          ...existing,
          response,
          responseSize: parsed.responseSize,
          message_id: parsed.message_id,
          usage: parsed.usage
        });
      }
    }
    
    // Convert to full operations
    const operations: Operation[] = [];
    for (const [timestamp, op] of operationMap.entries()) {
      if (op.tool && op.timestamp) {
        operations.push({
          tool: op.tool,
          params: op.params || {},
          response: op.response || {},
          responseSize: op.responseSize || 0,
          timestamp: op.timestamp,
          session_id: op.session_id || sessionId,
          message_id: op.message_id,
          usage: op.usage,
          tokens: 0, // Will be filled by correlation
          allocation: 'estimated',
          details: formatOperationDetails(op.tool, op.params)
        });
      }
    }
    
    return operations.sort((a, b) => a.timestamp - b.timestamp);
  } catch (error) {
    console.warn('Error fetching hook operations:', error);
    return [];
  }
}

function formatOperationDetails(tool: string, params: any): string {
  switch (tool.toLowerCase()) {
    case 'read':
      return params?.file_path ? path.basename(params.file_path) : 'file';
    case 'write':
      return params?.file_path ? path.basename(params.file_path) : 'file';
    case 'edit':
      return params?.file_path ? path.basename(params.file_path) : 'file';
    case 'bash':
      const cmd = params?.command || '';
      return cmd.length > 30 ? cmd.substring(0, 30) + '...' : cmd;
    case 'glob':
      return params?.pattern || 'pattern';
    case 'grep':
      return params?.pattern || 'pattern';
    default:
      return tool;
  }
}

function parseJsonl(filePath: string): JsonlMessage[] {
  try {
    const expandedPath = filePath.replace('~', os.homedir());
    if (!fs.existsSync(expandedPath)) {
      return [];
    }
    
    const content = fs.readFileSync(expandedPath, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    return lines
      .map(line => {
        try {
          const parsed = JSON.parse(line);
          // Extract usage data - could be at root level or inside message object
          const usage = parsed.usage || parsed.message?.usage;
          const messageId = parsed.message?.id || parsed.id || parsed.uuid;
          
          return {
            id: messageId,
            timestamp: new Date(parsed.timestamp || 0).getTime(),
            usage: usage,
            content: parsed
          } as JsonlMessage;
        } catch (error) {
          return null;
        }
      })
      .filter((msg): msg is JsonlMessage => msg !== null);
  } catch (error) {
    console.warn('Error parsing JSONL:', error);
    return [];
  }
}

export async function correlateOperations(sessionId: string, jsonlPath?: string): Promise<Bundle[]> {
  // Get messages from JSONL (primary data source)
  const messages = jsonlPath ? parseJsonl(jsonlPath) : [];
  
  // Get operations from hooks (supplementary data)
  const operations = await getHookOperations(sessionId);
  
  if (messages.length === 0) {
    return [];
  }
  
  // Filter to only assistant messages with usage data
  const assistantMessages = messages.filter(msg => 
    msg.usage && (
      msg.usage.input_tokens !== undefined || 
      msg.usage.output_tokens !== undefined || 
      msg.usage.cache_creation_input_tokens !== undefined || 
      msg.usage.cache_read_input_tokens !== undefined
    )
  );
  
  if (assistantMessages.length === 0) {
    return [];
  }
  
  const bundles: Bundle[] = [];
  
  // Process each assistant message
  for (const message of assistantMessages) {
    // Only count output tokens - cache creation is context loading, not operation cost
    const messageTokens = (message.usage?.output_tokens || 0);
    
    // Find all operations that match this message ID
    const matchingOperations = operations.filter(op => op.message_id === message.id);
    
    if (matchingOperations.length === 0) {
      // No hook operations found - create synthetic operation for text-only message
      const syntheticOperation: Operation = {
        tool: 'Assistant',
        params: {},
        response: message.content,
        responseSize: JSON.stringify(message.content).length,
        timestamp: message.timestamp,
        session_id: sessionId,
        message_id: message.id,
        usage: message.usage,
        tokens: messageTokens,
        allocation: 'exact',
        details: 'message'
      };
      
      bundles.push({
        id: message.id,
        timestamp: message.timestamp,
        operations: [syntheticOperation],
        totalTokens: messageTokens
      });
    } else if (matchingOperations.length === 1) {
      // Single tool call - exact token allocation
      const operation = {
        ...matchingOperations[0],
        tokens: messageTokens,
        allocation: 'exact' as const
      };
      
      bundles.push({
        id: message.id,
        timestamp: message.timestamp,
        operations: [operation],
        totalTokens: messageTokens
      });
    } else {
      // Multiple tool calls (bundled) - proportional allocation
      const totalResponseSize = matchingOperations.reduce((sum, op) => sum + op.responseSize, 0);
      
      const bundledOperations = matchingOperations.map(op => {
        const proportion = totalResponseSize > 0 ? op.responseSize / totalResponseSize : 1 / matchingOperations.length;
        return {
          ...op,
          tokens: Math.round(messageTokens * proportion),
          allocation: 'proportional' as const
        };
      });
      
      bundles.push({
        id: message.id,
        timestamp: message.timestamp,
        operations: bundledOperations,
        totalTokens: messageTokens
      });
    }
  }
  
  return bundles.sort((a, b) => a.timestamp - b.timestamp);
}