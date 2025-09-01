import { 
  findTaskBundles,
  findFirstSidechainOperation,
  traverseUuidChain,
  createSubAgentBundle,
  processSubAgents
} from './sub-agent-processor';
import type { Bundle, Operation, JsonlMessage } from '../types';

describe('sub-agent-processor', () => {
  const mockOperation: Operation = {
    tool: 'Assistant',
    params: {},
    response: [],
    responseSize: 0,
    timestamp: 1234567890,
    session_id: 'session-123',
    tokens: 100,
    generationCost: 50,
    contextGrowth: 50,
    allocation: 'exact',
    details: 'Test operation'
  };

  describe('findTaskBundles', () => {
    it('should find bundles with Task tool uses', () => {
      const bundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            response: [{ type: 'tool_use', name: 'Task', input: { prompt: 'Test task' } }]
          }],
          totalTokens: 100
        },
        {
          id: 'bundle-2',
          timestamp: 1234567891,
          operations: [{
            ...mockOperation,
            response: [{ type: 'text', text: 'Regular response' }]
          }],
          totalTokens: 50
        }
      ];

      const result = findTaskBundles(bundles);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('bundle-1');
    });

    it('should return empty array when no task bundles found', () => {
      const bundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            response: [{ type: 'text', text: 'Regular response' }]
          }],
          totalTokens: 50
        }
      ];

      const result = findTaskBundles(bundles);

      expect(result).toHaveLength(0);
    });
  });

  describe('findFirstSidechainOperation', () => {
    it('should find sidechain operation matching task prompt', () => {
      const sidechainBundles: Bundle[] = [
        {
          id: 'sidechain-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            tool: 'User',
            response: 'Find files in directory'
          }],
          totalTokens: 20
        },
        {
          id: 'sidechain-2',
          timestamp: 1234567891,
          operations: [{
            ...mockOperation,
            tool: 'User',
            response: 'Another task'
          }],
          totalTokens: 15
        }
      ];

      const result = findFirstSidechainOperation(sidechainBundles, 'Find files in directory');

      expect(result).toBeDefined();
      expect(result!.id).toBe('sidechain-1');
    });

    it('should return undefined when no matching sidechain operation found', () => {
      const sidechainBundles: Bundle[] = [
        {
          id: 'sidechain-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            tool: 'User',
            response: 'Different task'
          }],
          totalTokens: 20
        }
      ];

      const result = findFirstSidechainOperation(sidechainBundles, 'Find files in directory');

      expect(result).toBeUndefined();
    });
  });

  describe('traverseUuidChain', () => {
    it('should traverse complete UUID chain', () => {
      const sidechainBundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            message_id: 'uuid-1'
          }],
          totalTokens: 50
        },
        {
          id: 'bundle-2',
          timestamp: 1234567891,
          operations: [{
            ...mockOperation,
            message_id: 'uuid-2'
          }],
          totalTokens: 30
        }
      ];

      const allMessages: JsonlMessage[] = [
        {
          id: 'msg-1',
          timestamp: 1234567890,
          content: { uuid: 'uuid-1' },
          isSidechain: true
        },
        {
          id: 'msg-2',
          timestamp: 1234567891,
          content: { uuid: 'uuid-2', parentUuid: 'uuid-1' },
          isSidechain: true
        }
      ];

      const result = traverseUuidChain('uuid-1', sidechainBundles, allMessages);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('bundle-1');
      expect(result[1].id).toBe('bundle-2');
    });

    it('should handle circular references gracefully', () => {
      const sidechainBundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            message_id: 'uuid-1'
          }],
          totalTokens: 50
        }
      ];

      const allMessages: JsonlMessage[] = [
        {
          id: 'msg-1',
          timestamp: 1234567890,
          content: { uuid: 'uuid-1', parentUuid: 'uuid-1' }, // Self-reference
          isSidechain: true
        }
      ];

      const result = traverseUuidChain('uuid-1', sidechainBundles, allMessages);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('bundle-1');
    });
  });

  describe('createSubAgentBundle', () => {
    it('should create sub-agent bundle from task sidechain bundles', () => {
      const taskSidechainBundles: Bundle[] = [
        {
          id: 'sidechain-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            timestamp: 1234567890
          }],
          totalTokens: 50
        },
        {
          id: 'sidechain-2',
          timestamp: 1234567900,
          operations: [{
            ...mockOperation,
            timestamp: 1234567900
          }],
          totalTokens: 30
        }
      ];

      const taskUse = {
        id: 'task-123',
        input: {
          subagent_type: 'test-agent',
          description: 'Test task description'
        }
      };

      const result = createSubAgentBundle(taskSidechainBundles, taskUse);

      expect(result.id).toBe('subagent-task-123');
      expect(result.isSubAgent).toBe(true);
      expect(result.subAgentType).toBe('test-agent');
      expect(result.parentTaskId).toBe('task-123');
      expect(result.operationCount).toBe(2);
      expect(result.totalTokens).toBe(200); // 2 operations * 100 tokens each
      expect(result.duration).toBe(10); // 1234567900 - 1234567890
      expect(result.operations[0].details).toBe('Test task description');
    });

    it('should use default values when task input is missing', () => {
      const taskSidechainBundles: Bundle[] = [
        {
          id: 'sidechain-1',
          timestamp: 1234567890,
          operations: [mockOperation],
          totalTokens: 50
        }
      ];

      const taskUse = { id: 'task-123', input: {} };

      const result = createSubAgentBundle(taskSidechainBundles, taskUse);

      expect(result.subAgentType).toBe('general-purpose');
      expect(result.operations[0].details).toBe('Sub-agent task');
      expect(result.operations[0].subAgentType).toBe('general-purpose');
      expect(result.operations[0].parentTaskId).toBe('task-123');
    });
  });

  describe('processSubAgents', () => {
    it('should process complete sub-agent workflow', () => {
      const mainBundles: Bundle[] = [
        {
          id: 'main-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            response: [{
              type: 'tool_use',
              name: 'Task',
              id: 'task-123',
              input: {
                prompt: 'Test task prompt',
                subagent_type: 'test-agent'
              }
            }]
          }],
          totalTokens: 100
        }
      ];

      const sidechainBundles: Bundle[] = [
        {
          id: 'sidechain-1',
          timestamp: 1234567900,
          operations: [{
            ...mockOperation,
            tool: 'User',
            response: 'Test task prompt',
            message_id: 'uuid-1'
          }],
          totalTokens: 20
        }
      ];

      const allMessages: JsonlMessage[] = [
        {
          id: 'task-response',
          timestamp: 1234567895,
          content: {
            message: {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: 'task-123',
                content: [{ type: 'text', text: 'Task completed' }]
              }]
            }
          }
        },
        {
          id: 'sidechain-msg',
          timestamp: 1234567900,
          content: { uuid: 'uuid-1' },
          isSidechain: true
        }
      ];

      const result = processSubAgents(mainBundles, sidechainBundles, allMessages);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('subagent-task-123');
      expect(result[0].parentTaskId).toBe('task-123');
      expect(result[0].subAgentType).toBe('test-agent');
      expect(result[0].operations).toHaveLength(1);
    });

    it('should handle missing task responses', () => {
      const mainBundles: Bundle[] = [
        {
          id: 'main-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            response: [{
              type: 'tool_use',
              name: 'Task',
              id: 'task-123',
              input: { prompt: 'Test task prompt' }
            }]
          }],
          totalTokens: 100
        }
      ];

      const sidechainBundles: Bundle[] = [];
      const allMessages: JsonlMessage[] = [];

      const result = processSubAgents(mainBundles, sidechainBundles, allMessages);

      expect(result).toHaveLength(0);
    });
  });
});