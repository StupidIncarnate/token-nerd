import * as path from 'path';
import { JsonlMessage } from './jsonl-utils';
import { estimateTokensFromContent } from './token-calculator';
import { Operation } from './correlation-engine';

export function calculateCacheEfficiency(contextGrowth: number, cacheRead: number): number {
  const totalProcessed = contextGrowth + cacheRead;
  return totalProcessed > 0 ? (cacheRead / totalProcessed) * 100 : 0;
}

export function formatOperationDetails(tool: string, params: any): string {
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

export function extractToolUseDetails(messageContent: any, timeGap: number): { details: string; tool: string; params: any } {
  const hasToolUse = Array.isArray(messageContent) && messageContent.some((c: any) => c.type === 'tool_use');
  
  let details = 'message';
  if (timeGap > 300) {
    details = `⚠️ Cache expired (${Math.round(timeGap/60)}min gap)`;
  }
  
  let tool = 'Assistant';
  let params = {};
  
  if (hasToolUse) {
    const toolUses = messageContent.filter((c: any) => c.type === 'tool_use');
    if (toolUses.length === 1) {
      const toolUse = toolUses[0];
      const toolName = toolUse.name || 'Unknown';
      params = toolUse.input || {};
      const toolDetails = formatOperationDetails(toolName, params);
      details = `${toolName}: ${toolDetails}`;
      if (timeGap > 300) {
        details = `⚠️ ${details} (cache expired)`;
      }
    } else {
      details = `${toolUses.length} tool calls`;
      if (timeGap > 300) {
        details = `⚠️ ${details} (cache expired)`;
      }
    }
  }
  
  return { details, tool, params };
}

export function calculateContentPartIndex(
  messageContent: any, 
  messageId: string, 
  messageContentPartIndex: Map<string, number>
): number | undefined {
  if (messageContent && Array.isArray(messageContent) && messageContent.length === 1) {
    if (!messageContentPartIndex.has(messageId)) {
      messageContentPartIndex.set(messageId, 0);
      return 0;
    } else {
      const currentIndex = messageContentPartIndex.get(messageId)! + 1;
      messageContentPartIndex.set(messageId, currentIndex);
      return currentIndex;
    }
  }
  return undefined;
}

export function createSystemOperation(msg: JsonlMessage, sessionId: string, timeGap: number): Operation {
  let toolUseId: string | undefined;
  if (msg.content && typeof msg.content === 'object' && msg.content.toolUseID) {
    toolUseId = msg.content.toolUseID;
  }
  
  return {
    tool: 'System',
    params: {},
    response: msg.content || 'System prompt',
    responseSize: JSON.stringify(msg.content).length,
    timestamp: msg.timestamp,
    session_id: sessionId,
    message_id: msg.id,
    tool_use_id: toolUseId,
    tokens: estimateTokensFromContent(JSON.stringify(msg.content)),
    generationCost: 0,
    contextGrowth: 0,
    timeGap,
    allocation: 'estimated',
    details: 'Hidden system prompt/context',
    isSidechain: msg.isSidechain || false
  };
}

export function createUserOperation(msg: JsonlMessage, sessionId: string, timeGap: number): Operation {
  const userText = typeof msg.content?.message?.content === 'string' 
    ? msg.content.message.content 
    : msg.content?.message?.content?.[0]?.text || 'User message';
    
  return {
    tool: 'User',
    params: {},
    response: userText,
    responseSize: userText.length,
    timestamp: msg.timestamp,
    session_id: sessionId,
    message_id: msg.id,
    tokens: estimateTokensFromContent(userText),
    generationCost: 0,
    contextGrowth: 0,
    timeGap,
    allocation: 'estimated',
    details: userText.replace(/\s+/g, ' ').substring(0, 50) + (userText.length > 50 ? '...' : ''),
    isSidechain: msg.isSidechain || false
  };
}

export function createToolResponseOperation(msg: JsonlMessage, sessionId: string, timeGap: number): Operation {
  const toolResult = msg.content?.message?.content?.[0];
  
  let resultSize = 0;
  if (toolResult?.content) {
    if (typeof toolResult.content === 'string') {
      resultSize = toolResult.content.length;
    } else {
      resultSize = JSON.stringify(toolResult.content).length;
    }
  }
  
  const estimatedTokens = estimateTokensFromContent(resultSize);
  
  return {
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
    contextGrowth: 0,
    allocation: 'estimated',
    details: `${(resultSize / 1024).toFixed(1)}KB → ~${estimatedTokens.toLocaleString()} est`,
    isSidechain: msg.isSidechain || false
  };
}

export function createAssistantOperation(
  msg: JsonlMessage, 
  sessionId: string, 
  timeGap: number,
  messageContentPartIndex: Map<string, number>
): Operation {
  const contextGrowth = msg.usage?.cache_creation_input_tokens || 0;
  const generationCost = msg.usage?.output_tokens || 0;
  const cacheRead = msg.usage?.cache_read_input_tokens || 0;
  const messageTokens = contextGrowth || generationCost;
  
  const cacheEfficiency = calculateCacheEfficiency(contextGrowth, cacheRead);
  
  const ephemeral5m = msg.usage?.cache_creation?.ephemeral_5m_input_tokens || 0;
  const ephemeral1h = msg.usage?.cache_creation?.ephemeral_1h_input_tokens || 0;
  
  const messageContent = msg.content?.message?.content;
  const { details, tool, params } = extractToolUseDetails(messageContent, timeGap);
  const contentPartIndex = calculateContentPartIndex(messageContent, msg.id, messageContentPartIndex);
  
  return {
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
    details,
    isSidechain: msg.isSidechain || false,
    contentPartIndex
  };
}