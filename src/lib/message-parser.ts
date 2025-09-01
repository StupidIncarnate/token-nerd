import type { JsonlMessage } from '../types';
import type { Operation, Bundle } from '../types';

import type { MessageType, MessageInfo } from '../types';

export function detectMessageType(msg: JsonlMessage): MessageInfo {
  const isUser = msg.content?.type === 'user' || msg.content?.message?.role === 'user';
  const isAssistant = msg.content?.type === 'assistant' || msg.content?.message?.role === 'assistant';
  const isSystem = msg.content?.type === 'system' || msg.content?.message?.role === 'system';
  const isToolResult = isUser && msg.content?.message?.content?.[0]?.type === 'tool_result';
  
  let type: MessageType = 'unknown';
  if (isSystem) type = 'system';
  else if (isToolResult) type = 'toolResult';
  else if (isUser) type = 'user';
  else if (isAssistant) type = 'assistant';
  
  return { type, isUser, isAssistant, isSystem, isToolResult };
}

export function processMessage(
  msg: JsonlMessage,
  sessionId: string,
  timeGap: number,
  processedMessageIds: Set<string>,
  messageContentPartIndex: Map<string, number>,
  createSystemOperation: (msg: JsonlMessage, sessionId: string, timeGap: number) => Operation,
  createUserOperation: (msg: JsonlMessage, sessionId: string, timeGap: number) => Operation,
  createToolResponseOperation: (msg: JsonlMessage, sessionId: string, timeGap: number) => Operation,
  createAssistantOperation: (msg: JsonlMessage, sessionId: string, timeGap: number, messageContentPartIndex: Map<string, number>) => Operation
): Bundle | null {
  const msgInfo = detectMessageType(msg);
  const { isUser, isAssistant, isSystem, isToolResult } = msgInfo;
  
  if (isSystem) {
    const operation = createSystemOperation(msg, sessionId, timeGap);
    return {
      id: msg.id,
      timestamp: msg.timestamp,
      operations: [operation],
      totalTokens: operation.tokens
    };
  }
  
  if (isUser && !isToolResult) {
    const operation = createUserOperation(msg, sessionId, timeGap);
    return {
      id: msg.id,
      timestamp: msg.timestamp,
      operations: [operation],
      totalTokens: operation.tokens
    };
  }
  
  if (isToolResult) {
    const operation = createToolResponseOperation(msg, sessionId, timeGap);
    return {
      id: msg.id,
      timestamp: msg.timestamp,
      operations: [operation],
      totalTokens: operation.tokens
    };
  }
  
  if (isAssistant && msg.usage) {
    const msgContent = msg.content?.message?.content;
    const contentKey = msg.id + '-' + JSON.stringify(msgContent || '').substring(0, 50);
    
    if (processedMessageIds.has(contentKey)) {
      return null; // Skip duplicates
    }
    processedMessageIds.add(contentKey);
    
    const operation = createAssistantOperation(msg, sessionId, timeGap, messageContentPartIndex);
    return {
      id: msg.id,
      timestamp: msg.timestamp,
      operations: [operation],
      totalTokens: operation.tokens
    };
  }
  
  return null; // Unknown message type
}