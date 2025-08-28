import * as path from 'path';
import { parseJsonl, JsonlMessage } from './jsonl-utils';
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
  tool_use_id?: string;  // Links tool requests to responses
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
  
  if (allMessages.length === 0) {
    return [];
  }
  
  // Process ALL messages to understand the full conversation flow
  const bundles: Bundle[] = [];
  const processedMessageIds = new Set<string>();  // Track processed message IDs to avoid duplicates

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
      // Extract toolUseID if present
      let toolUseId: string | undefined;
      if (msg.content && typeof msg.content === 'object' && msg.content.toolUseID) {
        toolUseId = msg.content.toolUseID;
      }
      
      const systemOp: Operation = {
        tool: 'System',
        params: {},
        response: msg.content || 'System prompt',
        responseSize: JSON.stringify(msg.content).length,
        timestamp: msg.timestamp,
        session_id: sessionId,
        message_id: msg.id,
        tool_use_id: toolUseId,
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
        details: userText.replace(/\s+/g, ' ').substring(0, 50) + (userText.length > 50 ? '...' : '')
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
        tool_use_id: toolResult?.tool_use_id,
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
      // Skip duplicate message IDs (streaming chunks of same message)
      if (msg.id && processedMessageIds.has(msg.id)) {
        continue;
      }
      if (msg.id) {
        processedMessageIds.add(msg.id);
      }
      
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
        const toolUses = messageContent.filter((c: any) => c.type === 'tool_use');
        if (toolUses.length === 1) {
          // Single tool call
          const toolUse = toolUses[0];
          const toolName = toolUse.name || 'Unknown';
          params = toolUse.input || {};
          const toolDetails = formatOperationDetails(toolName, params);
          details = `${toolName}: ${toolDetails}`;
          if (timeGap > 300) {
            details = `⚠️ ${details} (cache expired)`;
          }
        } else {
          // Multiple tool calls
          details = `${toolUses.length} tool calls`;
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
  
  // Post-process to enrich ToolResponse details with filenames from linked operations
  for (const bundle of bundles) {
    for (const op of bundle.operations) {
      if (op.tool === 'ToolResponse' && op.tool_use_id) {
        // Find the assistant message that created this tool_use_id
        const linkedOps = getLinkedOperations(bundles, op.tool_use_id);
        const assistantOp = linkedOps.find(linkedOp => linkedOp.tool === 'Assistant');
        
        if (assistantOp && assistantOp.response && Array.isArray(assistantOp.response)) {
          const toolUse = assistantOp.response.find((c: any) => 
            c.type === 'tool_use' && c.id === op.tool_use_id
          );
          
          if (toolUse) {
            const filename = formatOperationDetails(toolUse.name, toolUse.input);
            op.details = filename; // Override the size details with filename
          }
        }
      }
    }
  }
  
  return bundles.sort((a, b) => a.timestamp - b.timestamp);
}

// Find all operations linked by tool_use_id
export function getLinkedOperations(bundles: Bundle[], targetToolUseId: string): Operation[] {
  const linked: Operation[] = [];
  
  for (const bundle of bundles) {
    for (const op of bundle.operations) {
      // Find assistant messages that contain this tool_use_id
      if (op.tool === 'Assistant' && op.response) {
        const messageContent = Array.isArray(op.response) ? op.response : [];
        const hasTargetToolUse = messageContent.some((c: any) => 
          c.type === 'tool_use' && c.id === targetToolUseId
        );
        if (hasTargetToolUse) {
          linked.push(op);
        }
      }
      
      // Find tool responses and system messages with matching tool_use_id
      if (op.tool_use_id === targetToolUseId) {
        linked.push(op);
      }
    }
  }
  
  return linked.sort((a, b) => a.timestamp - b.timestamp);
}