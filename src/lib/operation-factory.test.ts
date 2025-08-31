import { 
  calculateCacheEfficiency,
  formatOperationDetails,
  extractToolUseDetails,
  calculateContentPartIndex,
  createSystemOperation,
  createUserOperation,
  createToolResponseOperation,
  createAssistantOperation
} from './operation-factory';
import { JsonlMessage } from './jsonl-utils';

describe('operation-factory', () => {
  describe('calculateCacheEfficiency', () => {
    it('should calculate cache efficiency correctly', () => {
      expect(calculateCacheEfficiency(100, 200)).toBe(66.66666666666666);
      expect(calculateCacheEfficiency(0, 100)).toBe(100);
      expect(calculateCacheEfficiency(100, 0)).toBe(0);
      expect(calculateCacheEfficiency(0, 0)).toBe(0);
    });
  });

  describe('formatOperationDetails', () => {
    it('should format read operations', () => {
      expect(formatOperationDetails('read', { file_path: '/path/to/file.txt' })).toBe('file.txt');
      expect(formatOperationDetails('read', {})).toBe('file');
    });

    it('should format bash operations', () => {
      expect(formatOperationDetails('bash', { command: 'ls -la' })).toBe('ls -la');
      expect(formatOperationDetails('bash', { command: 'very long command that exceeds thirty characters' })).toBe('very long command that exceeds...');
    });

    it('should format glob operations', () => {
      expect(formatOperationDetails('glob', { pattern: '*.ts' })).toBe('*.ts');
      expect(formatOperationDetails('glob', {})).toBe('pattern');
    });

    it('should return tool name for unknown tools', () => {
      expect(formatOperationDetails('unknown', {})).toBe('unknown');
    });
  });

  describe('extractToolUseDetails', () => {
    it('should extract single tool use details', () => {
      const messageContent = [{
        type: 'tool_use',
        name: 'read',
        input: { file_path: '/path/to/file.txt' }
      }];

      const result = extractToolUseDetails(messageContent, 0);

      expect(result.details).toBe('read: file.txt');
      expect(result.tool).toBe('Assistant');
      expect(result.params).toEqual({ file_path: '/path/to/file.txt' });
    });

    it('should handle multiple tool uses', () => {
      const messageContent = [
        { type: 'tool_use', name: 'read' },
        { type: 'tool_use', name: 'write' }
      ];

      const result = extractToolUseDetails(messageContent, 0);

      expect(result.details).toBe('2 tool calls');
      expect(result.tool).toBe('Assistant');
    });

    it('should add cache expiration warning for long time gaps', () => {
      const messageContent = [{
        type: 'tool_use',
        name: 'read',
        input: { file_path: '/path/to/file.txt' }
      }];

      const result = extractToolUseDetails(messageContent, 600); // 10 minutes

      expect(result.details).toBe('⚠️ read: file.txt (cache expired)');
    });

    it('should handle messages without tool use', () => {
      const messageContent = [{ type: 'text', text: 'Hello' }];

      const result = extractToolUseDetails(messageContent, 0);

      expect(result.details).toBe('message');
      expect(result.tool).toBe('Assistant');
    });
  });

  describe('calculateContentPartIndex', () => {
    it('should calculate content part index for single content messages', () => {
      const messageContentPartIndex = new Map();
      
      const result1 = calculateContentPartIndex([{ type: 'text' }], 'msg-1', messageContentPartIndex);
      expect(result1).toBe(0);
      
      const result2 = calculateContentPartIndex([{ type: 'text' }], 'msg-1', messageContentPartIndex);
      expect(result2).toBe(1);
    });

    it('should return undefined for multi-content messages', () => {
      const messageContentPartIndex = new Map();
      
      const result = calculateContentPartIndex([{ type: 'text' }, { type: 'text' }], 'msg-1', messageContentPartIndex);
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-array content', () => {
      const messageContentPartIndex = new Map();
      
      const result = calculateContentPartIndex('text content', 'msg-1', messageContentPartIndex);
      expect(result).toBeUndefined();
    });
  });

  describe('createSystemOperation', () => {
    it('should create system operation', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: 1234567890,
        content: {
          type: 'system',
          toolUseID: 'tool-123'
        }
      };

      const result = createSystemOperation(msg, 'session-123', 10);

      expect(result.tool).toBe('System');
      expect(result.session_id).toBe('session-123');
      expect(result.message_id).toBe('test-id');
      expect(result.tool_use_id).toBe('tool-123');
      expect(result.timeGap).toBe(10);
      expect(result.allocation).toBe('estimated');
      expect(result.details).toBe('Hidden system prompt/context');
    });
  });

  describe('createUserOperation', () => {
    it('should create user operation with string content', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: 1234567890,
        content: {
          message: {
            role: 'user',
            content: 'Hello world'
          }
        }
      };

      const result = createUserOperation(msg, 'session-123', 5);

      expect(result.tool).toBe('User');
      expect(result.response).toBe('Hello world');
      expect(result.responseSize).toBe(11);
      expect(result.timeGap).toBe(5);
      expect(result.details).toBe('Hello world');
    });

    it('should create user operation with array content', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: 1234567890,
        content: {
          message: {
            role: 'user',
            content: [{ text: 'Hello from array' }]
          }
        }
      };

      const result = createUserOperation(msg, 'session-123', 0);

      expect(result.response).toBe('Hello from array');
    });
  });

  describe('createToolResponseOperation', () => {
    it('should create tool response operation', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: 1234567890,
        content: {
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool-123',
              content: 'Tool output content'
            }]
          }
        }
      };

      const result = createToolResponseOperation(msg, 'session-123', 0);

      expect(result.tool).toBe('ToolResponse');
      expect(result.tool_use_id).toBe('tool-123');
      expect(result.response).toBe('Tool output content');
      expect(result.responseSize).toBe(19);
      expect(result.allocation).toBe('estimated');
      expect(result.details).toContain('KB →');
    });
  });

  describe('createAssistantOperation', () => {
    it('should create assistant operation with usage data', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: 1234567890,
        content: {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Assistant response' }]
          }
        },
        usage: {
          cache_creation_input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 25,
          cache_creation: {
            ephemeral_5m_input_tokens: 10,
            ephemeral_1h_input_tokens: 5
          }
        }
      };

      const messageContentPartIndex = new Map();
      const result = createAssistantOperation(msg, 'session-123', 120, messageContentPartIndex);

      expect(result.tool).toBe('Assistant');
      expect(result.contextGrowth).toBe(100);
      expect(result.generationCost).toBe(50);
      expect(result.tokens).toBe(100);
      expect(result.cacheEfficiency).toBeCloseTo(20, 5); // 25/(100+25) * 100
      expect(result.ephemeral5m).toBe(10);
      expect(result.ephemeral1h).toBe(5);
      expect(result.allocation).toBe('exact');
    });

    it('should handle assistant operation with tool use', () => {
      const msg: JsonlMessage = {
        id: 'test-id',
        timestamp: 1234567890,
        content: {
          message: {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              name: 'read',
              input: { file_path: '/test.txt' }
            }]
          }
        },
        usage: {
          output_tokens: 30
        }
      };

      const messageContentPartIndex = new Map();
      const result = createAssistantOperation(msg, 'session-123', 0, messageContentPartIndex);

      expect(result.details).toBe('read: test.txt');
      expect(result.params).toEqual({ file_path: '/test.txt' });
      expect(result.contentPartIndex).toBe(0);
    });
  });
});