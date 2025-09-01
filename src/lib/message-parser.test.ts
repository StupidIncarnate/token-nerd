import { detectMessageType, processMessage } from './message-parser';
import type { JsonlMessage, Operation } from '../types';

describe('message-parser', () => {
  describe('detectMessageType', () => {
    it('should detect system message type', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: Date.now(),
        content: {
          type: 'system',
          message: { role: 'system', content: 'System prompt' }
        }
      };

      const result = detectMessageType(msg);

      expect(result.type).toBe('system');
      expect(result.isSystem).toBe(true);
      expect(result.isUser).toBe(false);
      expect(result.isAssistant).toBe(false);
      expect(result.isToolResult).toBe(false);
    });

    it('should detect user message type', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: Date.now(),
        content: {
          message: { role: 'user', content: 'User message' }
        }
      };

      const result = detectMessageType(msg);

      expect(result.type).toBe('user');
      expect(result.isUser).toBe(true);
      expect(result.isSystem).toBe(false);
      expect(result.isAssistant).toBe(false);
      expect(result.isToolResult).toBe(false);
    });

    it('should detect assistant message type', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: Date.now(),
        content: {
          message: { role: 'assistant', content: 'Assistant response' }
        }
      };

      const result = detectMessageType(msg);

      expect(result.type).toBe('assistant');
      expect(result.isAssistant).toBe(true);
      expect(result.isUser).toBe(false);
      expect(result.isSystem).toBe(false);
      expect(result.isToolResult).toBe(false);
    });

    it('should detect tool result message type', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: Date.now(),
        content: {
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool-123',
              content: 'Tool output'
            }]
          }
        }
      };

      const result = detectMessageType(msg);

      expect(result.type).toBe('toolResult');
      expect(result.isToolResult).toBe(true);
      expect(result.isUser).toBe(true); // Tool results are still user messages
      expect(result.isSystem).toBe(false);
      expect(result.isAssistant).toBe(false);
    });

    it('should return unknown for unrecognized message types', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: Date.now(),
        content: {}
      };

      const result = detectMessageType(msg);

      expect(result.type).toBe('unknown');
      expect(result.isUser).toBe(false);
      expect(result.isSystem).toBe(false);
      expect(result.isAssistant).toBe(false);
      expect(result.isToolResult).toBe(false);
    });
  });

  describe('processMessage', () => {
    const mockCreateSystemOperation = jest.fn();
    const mockCreateUserOperation = jest.fn();
    const mockCreateToolResponseOperation = jest.fn();
    const mockCreateAssistantOperation = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should process system message', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: Date.now(),
        content: { type: 'system', message: { role: 'system', content: 'System prompt' } }
      };

      const mockOperation: Operation = {
        tool: 'System',
        params: {},
        response: msg.content,
        responseSize: 100,
        timestamp: msg.timestamp,
        session_id: 'session-123',
        message_id: msg.id,
        tokens: 50,
        generationCost: 0,
        contextGrowth: 0,
        allocation: 'estimated',
        details: 'System message'
      };

      mockCreateSystemOperation.mockReturnValue(mockOperation);

      const result = processMessage(
        msg,
        'session-123',
        0,
        new Set(),
        new Map(),
        mockCreateSystemOperation,
        mockCreateUserOperation,
        mockCreateToolResponseOperation,
        mockCreateAssistantOperation
      );

      expect(mockCreateSystemOperation).toHaveBeenCalledWith(msg, 'session-123', 0);
      expect(result).toEqual({
        id: msg.id,
        timestamp: msg.timestamp,
        operations: [mockOperation],
        totalTokens: 50
      });
    });

    it('should process user message (non-tool result)', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: Date.now(),
        content: { message: { role: 'user', content: 'User message' } }
      };

      const mockOperation: Operation = {
        tool: 'User',
        params: {},
        response: 'User message',
        responseSize: 12,
        timestamp: msg.timestamp,
        session_id: 'session-123',
        message_id: msg.id,
        tokens: 10,
        generationCost: 0,
        contextGrowth: 0,
        allocation: 'estimated',
        details: 'User message'
      };

      mockCreateUserOperation.mockReturnValue(mockOperation);

      const result = processMessage(
        msg,
        'session-123',
        0,
        new Set(),
        new Map(),
        mockCreateSystemOperation,
        mockCreateUserOperation,
        mockCreateToolResponseOperation,
        mockCreateAssistantOperation
      );

      expect(mockCreateUserOperation).toHaveBeenCalledWith(msg, 'session-123', 0);
      expect(result).toEqual({
        id: msg.id,
        timestamp: msg.timestamp,
        operations: [mockOperation],
        totalTokens: 10
      });
    });

    it('should skip duplicate assistant messages', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: Date.now(),
        content: { message: { role: 'assistant', content: 'Assistant response' } },
        usage: { output_tokens: 20 }
      };

      const processedMessageIds = new Set(['test-id-"Assistant response"'.substring(0, 58)]);

      const result = processMessage(
        msg,
        'session-123',
        0,
        processedMessageIds,
        new Map(),
        mockCreateSystemOperation,
        mockCreateUserOperation,
        mockCreateToolResponseOperation,
        mockCreateAssistantOperation
      );

      expect(result).toBeNull();
      expect(mockCreateAssistantOperation).not.toHaveBeenCalled();
    });

    it('should return null for unknown message types', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: Date.now(),
        content: {}
      };

      const result = processMessage(
        msg,
        'session-123',
        0,
        new Set(),
        new Map(),
        mockCreateSystemOperation,
        mockCreateUserOperation,
        mockCreateToolResponseOperation,
        mockCreateAssistantOperation
      );

      expect(result).toBeNull();
    });
  });
});