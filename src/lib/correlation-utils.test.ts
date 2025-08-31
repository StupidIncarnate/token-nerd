import { getLinkedOperations, enrichToolResponseDetails } from './correlation-utils';
import { Bundle, Operation } from './correlation-engine';

describe('correlation-utils', () => {
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

  describe('getLinkedOperations', () => {
    it('should find operations linked by tool_use_id', () => {
      const bundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            tool: 'Assistant',
            timestamp: 1234567890,
            response: [{
              type: 'tool_use',
              id: 'tool-123',
              name: 'read'
            }]
          }],
          totalTokens: 100
        },
        {
          id: 'bundle-2',
          timestamp: 1234567900,
          operations: [{
            ...mockOperation,
            tool: 'ToolResponse',
            timestamp: 1234567900,
            tool_use_id: 'tool-123',
            response: 'File contents'
          }],
          totalTokens: 50
        },
        {
          id: 'bundle-3',
          timestamp: 1234567910,
          operations: [{
            ...mockOperation,
            tool: 'ToolResponse',
            timestamp: 1234567910,
            tool_use_id: 'tool-456',
            response: 'Different tool response'
          }],
          totalTokens: 30
        }
      ];

      const result = getLinkedOperations(bundles, 'tool-123');

      expect(result).toHaveLength(2);
      expect(result[0].tool).toBe('Assistant');
      expect(result[1].tool).toBe('ToolResponse');
      expect(result[1].tool_use_id).toBe('tool-123');
      
      // Should be sorted by timestamp
      expect(result[0].timestamp).toBeLessThan(result[1].timestamp);
    });

    it('should return empty array when no matching tool_use_id found', () => {
      const bundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            tool: 'ToolResponse',
            tool_use_id: 'tool-456',
            response: 'Different tool response'
          }],
          totalTokens: 30
        }
      ];

      const result = getLinkedOperations(bundles, 'tool-123');

      expect(result).toHaveLength(0);
    });

    it('should handle assistant messages with multiple tool uses', () => {
      const bundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            tool: 'Assistant',
            response: [
              { type: 'tool_use', id: 'tool-123', name: 'read' },
              { type: 'tool_use', id: 'tool-456', name: 'write' }
            ]
          }],
          totalTokens: 100
        }
      ];

      const result = getLinkedOperations(bundles, 'tool-456');

      expect(result).toHaveLength(1);
      expect(result[0].tool).toBe('Assistant');
    });

    it('should handle non-array response content', () => {
      const bundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            tool: 'Assistant',
            response: 'String response'
          }],
          totalTokens: 100
        }
      ];

      const result = getLinkedOperations(bundles, 'tool-123');

      expect(result).toHaveLength(0);
    });
  });

  describe('enrichToolResponseDetails', () => {
    it('should enrich tool response details with filenames', () => {
      const bundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            tool: 'Assistant',
            response: [{
              type: 'tool_use',
              id: 'tool-123',
              name: 'read',
              input: { file_path: '/path/to/test.txt' }
            }]
          }],
          totalTokens: 100
        },
        {
          id: 'bundle-2',
          timestamp: 1234567900,
          operations: [{
            ...mockOperation,
            tool: 'ToolResponse',
            tool_use_id: 'tool-123',
            details: '1.2KB → ~300 est',
            response: 'File contents'
          }],
          totalTokens: 50
        }
      ];

      enrichToolResponseDetails(bundles);

      const toolResponseOp = bundles[1].operations[0];
      expect(toolResponseOp.details).toBe('test.txt');
    });

    it('should not modify operations without tool_use_id', () => {
      const bundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            tool: 'ToolResponse',
            details: 'Original details',
            response: 'Response without tool_use_id'
          }],
          totalTokens: 50
        }
      ];

      enrichToolResponseDetails(bundles);

      expect(bundles[0].operations[0].details).toBe('Original details');
    });

    it('should handle missing linked operations', () => {
      const bundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            tool: 'ToolResponse',
            tool_use_id: 'missing-tool-123',
            details: 'Original details',
            response: 'Response'
          }],
          totalTokens: 50
        }
      ];

      enrichToolResponseDetails(bundles);

      expect(bundles[0].operations[0].details).toBe('Original details');
    });

    it('should handle bash commands with truncation', () => {
      const bundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            tool: 'Assistant',
            response: [{
              type: 'tool_use',
              id: 'tool-123',
              name: 'bash',
              input: { command: 'very long command that exceeds thirty characters and should be truncated' }
            }]
          }],
          totalTokens: 100
        },
        {
          id: 'bundle-2',
          timestamp: 1234567900,
          operations: [{
            ...mockOperation,
            tool: 'ToolResponse',
            tool_use_id: 'tool-123',
            details: 'Original details',
            response: 'Command output'
          }],
          totalTokens: 50
        }
      ];

      enrichToolResponseDetails(bundles);

      const toolResponseOp = bundles[1].operations[0];
      expect(toolResponseOp.details).toBe('very long command that exceeds...');
    });

    it('should handle glob patterns', () => {
      const bundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1234567890,
          operations: [{
            ...mockOperation,
            tool: 'Assistant',
            response: [{
              type: 'tool_use',
              id: 'tool-123',
              name: 'glob',
              input: { pattern: '**/*.ts' }
            }]
          }],
          totalTokens: 100
        },
        {
          id: 'bundle-2',
          timestamp: 1234567900,
          operations: [{
            ...mockOperation,
            tool: 'ToolResponse',
            tool_use_id: 'tool-123',
            details: 'Original details',
            response: ['file1.ts', 'file2.ts']
          }],
          totalTokens: 50
        }
      ];

      enrichToolResponseDetails(bundles);

      const toolResponseOp = bundles[1].operations[0];
      expect(toolResponseOp.details).toBe('**/*.ts');
    });
  });
});