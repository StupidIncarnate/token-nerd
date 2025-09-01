export type MessageType = 'system' | 'user' | 'toolResult' | 'assistant' | 'unknown';

export interface MessageInfo {
  type: MessageType;
  isUser: boolean;
  isAssistant: boolean;
  isSystem: boolean;
  isToolResult: boolean;
}