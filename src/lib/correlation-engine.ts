import { createClient } from 'redis';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseJsonl, JsonlMessage } from './jsonl-utils';
import { estimateTokensFromContent } from './token-calculator';
import { getSnapshotForSession } from './stats-collector';

export { JsonlMessage };

export interface Operation {
  tool: string;
  params: any;
  response: any;
  responseSize: number;
  timestamp: number;
  session_id: string;
  message_id?: string;
  sequence?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    total_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
  tokens: number;  // Primary metric for display (context growth)
  generationCost: number;  // Output tokens (what was generated)
  contextGrowth: number;  // Cache creation tokens (new context added)
  ephemeral5m?: number;  // 5-minute cache tokens
  ephemeral1h?: number;  // 1-hour cache tokens
  cacheEfficiency?: number;  // Percentage of cache reuse
  timeGap?: number;  // Seconds since last message
  allocation: 'exact' | 'proportional' | 'estimated';
  details: string;
}

export interface Bundle {
  id: string;
  timestamp: number;
  operations: Operation[];
  totalTokens: number;
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

export async function getHookOperations(sessionId: string): Promise<Operation[]> {
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
    
    // Create a map of sequence -> operations
    const operationMap = new Map<number, Partial<Operation>>();
    
    // Process request data
    for (const key of requestKeys) {
      const timestamp = key.split(':')[3];
      const data = await redis.get(key);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.sequence !== undefined) {
          operationMap.set(parsed.sequence, {
            tool: parsed.tool,
            params: parsed.params,
            timestamp: parseInt(timestamp),
            session_id: parsed.session_id,
            sequence: parsed.sequence
          });
        }
      }
    }
    
    // Process response data
    for (const key of responseKeys) {
      const timestamp = key.split(':')[3];
      const data = await redis.get(key);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.sequence !== undefined) {
          const existing = operationMap.get(parsed.sequence) || {};
          
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
          
          operationMap.set(parsed.sequence, {
            ...existing,
            response,
            responseSize: parsed.responseSize,
            message_id: parsed.message_id,
            usage: parsed.usage,
            sequence: parsed.sequence,
            timestamp: existing.timestamp || parseInt(timestamp)
          });
        }
      }
    }
    
    // Convert to full operations
    const operations: Operation[] = [];
    operationMap.forEach((op, sequence) => {
      if (op.tool && op.timestamp) {
        operations.push({
          tool: op.tool,
          params: op.params || {},
          response: op.response || {},
          responseSize: op.responseSize || 0,
          timestamp: op.timestamp,
          session_id: op.session_id || sessionId,
          message_id: op.message_id,
          sequence: op.sequence,
          usage: op.usage,
          tokens: 0, // Will be filled by correlation
          generationCost: 0, // Will be filled by correlation
          contextGrowth: 0, // Will be filled by correlation
          allocation: 'estimated',
          details: formatOperationDetails(op.tool, op.params)
        });
      }
    });
    
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


export async function correlateOperations(sessionId: string, jsonlPath?: string): Promise<Bundle[]> {
  // Get ALL messages from JSONL (including user messages)
  const allMessages = jsonlPath ? parseJsonl(jsonlPath) : [];
  
  // Get operations from hooks (supplementary data)
  const operations = await getHookOperations(sessionId);
  
  if (allMessages.length === 0) {
    return [];
  }
  
  // Get context snapshot for this session to show startup cost
  const contextSnapshot = await getSnapshotForSession(sessionId);
  
  // Process ALL messages to understand the full conversation flow
  const bundles: Bundle[] = [];
  
  // Add context startup cost as first bundle if available
  if (contextSnapshot && contextSnapshot.stats) {
    const sessionStartTime = allMessages.length > 0 ? allMessages[0].timestamp - 1000 : contextSnapshot.timestamp;
    
    const startupOperation: Operation = {
      tool: 'Context',
      params: {},
      response: contextSnapshot.stats.display,
      responseSize: contextSnapshot.stats.display.length,
      timestamp: sessionStartTime,
      session_id: sessionId,
      tokens: contextSnapshot.stats.actualTokens,
      generationCost: 0,
      contextGrowth: contextSnapshot.stats.actualTokens,
      allocation: 'exact',
      details: `${Math.round(contextSnapshot.stats.actualTokens/1000)}k init cost`,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: contextSnapshot.stats.actualTokens,
        cache_read_input_tokens: 0
      }
    };
    
    bundles.push({
      id: 'startup-context',
      timestamp: sessionStartTime,
      operations: [startupOperation],
      totalTokens: contextSnapshot.stats.actualTokens
    });
  }
  
  // Group messages by assistant responses and their associated user/tool messages
  let currentBundle: Bundle | null = null;
  let toolOperationIndex = 0;
  let lastTimestamp = 0;
  
  for (const msg of allMessages) {
    const isUser = msg.content?.type === 'user' || msg.content?.message?.role === 'user';
    const isAssistant = msg.content?.type === 'assistant' || msg.content?.message?.role === 'assistant';
    const isSystem = msg.content?.type === 'system' || msg.content?.message?.role === 'system';
    const isToolResult = isUser && msg.content?.message?.content?.[0]?.type === 'tool_result';
    
    // Calculate time gap
    const timeGap = lastTimestamp ? (msg.timestamp - lastTimestamp) / 1000 : 0;
    lastTimestamp = msg.timestamp;
    
    if (isSystem) {
      // System message - often contains hidden prompts
      const systemOp: Operation = {
        tool: 'System',
        params: {},
        response: msg.content || 'System prompt',
        responseSize: JSON.stringify(msg.content).length,
        timestamp: msg.timestamp,
        session_id: sessionId,
        message_id: msg.id,
        tokens: Math.ceil(JSON.stringify(msg.content).length / 4),
        generationCost: 0,
        contextGrowth: 0,
        timeGap,
        allocation: 'estimated',
        details: 'Hidden system prompt/context'
      };
      
      bundles.push({
        id: msg.id,
        timestamp: msg.timestamp,
        operations: [systemOp],
        totalTokens: systemOp.tokens
      });
    } else if (isUser && !isToolResult) {
      // User message - create an entry for it
      const userText = typeof msg.content?.message?.content === 'string' 
        ? msg.content.message.content 
        : msg.content?.message?.content?.[0]?.text || 'User message';
        
      const userOp: Operation = {
        tool: 'User',
        params: {},
        response: userText,
        responseSize: userText.length,
        timestamp: msg.timestamp,
        session_id: sessionId,
        message_id: msg.id,
        tokens: Math.ceil(userText.length / 4), // Rough estimate
        generationCost: 0,
        contextGrowth: 0, // Will be counted in next assistant message
        timeGap,
        allocation: 'estimated',
        details: userText.substring(0, 50) + (userText.length > 50 ? '...' : '')
      };
      
      bundles.push({
        id: msg.id,
        timestamp: msg.timestamp,
        operations: [userOp],
        totalTokens: userOp.tokens
      });
    } else if (isToolResult) {
      // Tool response - THIS is often the hidden context gorger!
      const toolResult = msg.content?.message?.content?.[0];
      const resultSize = toolResult?.content?.length || 0;
      const estimatedTokens = Math.ceil(resultSize / 4);
      
      const toolResponseOp: Operation = {
        tool: 'ToolResponse',
        params: { tool_use_id: toolResult?.tool_use_id },
        response: toolResult?.content || '',
        responseSize: resultSize,
        timestamp: msg.timestamp,
        session_id: sessionId,
        message_id: msg.id,
        tokens: estimatedTokens,
        generationCost: 0,
        contextGrowth: 0,  // Don't count estimated values in context growth
        allocation: 'estimated',
        details: `${(resultSize / 1024).toFixed(1)}KB → ~${estimatedTokens.toLocaleString()} tokens`
      };
      
      bundles.push({
        id: msg.id,
        timestamp: msg.timestamp,
        operations: [toolResponseOp],
        totalTokens: estimatedTokens
      });
    } else if (isAssistant && msg.usage) {
      // Assistant message - process with all metrics
      const contextGrowth = msg.usage?.cache_creation_input_tokens || 0;
      const generationCost = msg.usage?.output_tokens || 0;
      const cacheRead = msg.usage?.cache_read_input_tokens || 0;
      const messageTokens = contextGrowth || generationCost;
      
      // Calculate cache efficiency
      const totalProcessed = contextGrowth + cacheRead;
      const cacheEfficiency = totalProcessed > 0 ? (cacheRead / totalProcessed) * 100 : 0;
      
      // Extract ephemeral cache data
      const ephemeral5m = msg.usage?.cache_creation?.ephemeral_5m_input_tokens || 0;
      const ephemeral1h = msg.usage?.cache_creation?.ephemeral_1h_input_tokens || 0;
      
      const messageContent = msg.content?.message?.content;
      const hasToolUse = Array.isArray(messageContent) && messageContent.some((c: any) => c.type === 'tool_use');
      
      // Add warning to details if cache expired
      let details = 'message';
      if (timeGap > 300) { // 5 minutes
        details = `⚠️ Cache expired (${Math.round(timeGap/60)}min gap)`;
      }
      
      // Create operation for this assistant message
      let tool = 'Assistant';
      let params = {};
      
      if (hasToolUse) {
        const toolUse = messageContent.find((c: any) => c.type === 'tool_use');
        if (toolUse) {
          // Keep as Assistant but note the tool use in details
          const toolName = toolUse.name || 'Unknown';
          params = toolUse.input || {};
          const toolDetails = formatOperationDetails(toolName, params);
          details = `calls ${toolName}: ${toolDetails}`;
          if (timeGap > 300) {
            details = `⚠️ ${details} (cache expired)`;
          }
        }
      }
      
      const operation: Operation = {
        tool,
        params,
        response: messageContent || msg.content,
        responseSize: JSON.stringify(messageContent || msg.content).length,
        timestamp: msg.timestamp,
        session_id: sessionId,
        message_id: msg.id,
        usage: msg.usage,
        tokens: messageTokens,
        generationCost,
        contextGrowth,
        ephemeral5m,
        ephemeral1h,
        cacheEfficiency,
        timeGap,
        allocation: 'exact',
        details
      };
      
      bundles.push({
        id: msg.id,
        timestamp: msg.timestamp,
        operations: [operation],
        totalTokens: messageTokens
      });
    }
  }
  
  return bundles.sort((a, b) => a.timestamp - b.timestamp);
}