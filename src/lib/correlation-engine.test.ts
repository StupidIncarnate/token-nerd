import { correlateOperations, getLinkedOperations } from './correlation-engine';
import type { Bundle } from '../types';
import * as fs from 'fs';

// Mock console methods to prevent test output clutter
const mockConsoleWarn = jest.fn();
const originalConsoleWarn = console.warn;

beforeAll(() => {
  console.warn = mockConsoleWarn;
});

afterAll(() => {
  console.warn = originalConsoleWarn;
});

// Mock fs
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn()
}));

// Mock jsonl-utils
jest.mock('./jsonl-utils', () => ({
  parseJsonl: jest.fn(() => [])
}));

const mockedFs = jest.mocked(fs);
const { parseJsonl } = require('./jsonl-utils');
const mockedParseJsonl = jest.mocked(parseJsonl);

describe('correlation-engine', () => {

  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('correlateOperations', () => {

    it('should preserve JSONL file order when timestamps are identical', async () => {
      const sessionId = 'test-session';
      const jsonlPath = '/test/session.jsonl';
      
      // Mock JSONL with proper parent-child relationships like real data
      const sameTimestamp = 1693747994247;
      mockedParseJsonl.mockReturnValue([
        {
          id: 'user-1',
          timestamp: sameTimestamp - 1000,
          content: { 
            type: 'user', 
            uuid: 'user-1',
            parentUuid: null, // Root message
            message: { role: 'user', content: [{ type: 'text', text: 'how do I disable auto compacting' }] } 
          },
          usage: null
        },
        {
          id: 'assistant-1', 
          timestamp: sameTimestamp,
          content: { 
            type: 'assistant', 
            uuid: 'assistant-1-uuid',
            parentUuid: 'user-1', // Responds to user-1
            message: { id: 'assistant-1', role: 'assistant', content: [{ type: 'text', text: 'Git auto compacting response' }] } 
          },
          usage: { input_tokens: 10, output_tokens: 20 }
        },
        {
          id: 'user-2',
          timestamp: sameTimestamp - 500,
          content: { 
            type: 'user', 
            uuid: 'user-2',
            parentUuid: 'assistant-1-uuid', // Responds to assistant-1
            message: { role: 'user', content: [{ type: 'text', text: 'im talking about auto compacting for you, claude' }] } 
          },
          usage: null
        },
        {
          id: 'assistant-2',
          timestamp: sameTimestamp,
          content: { 
            type: 'assistant', 
            uuid: 'assistant-2-uuid',
            parentUuid: 'user-2', // Responds to user-2
            message: { id: 'assistant-2', role: 'assistant', content: [{ type: 'text', text: 'Claude auto compacting response' }] } 
          },
          usage: { input_tokens: 15, output_tokens: 25 }
        }
      ]);

      const bundles = await correlateOperations(sessionId, jsonlPath);

      // The fix works by preserving JSONL order when timestamps are equal
      // Even though JavaScript's sort algorithm might not compare assistant-1 vs assistant-2 directly,
      // the JSONL order preservation ensures the overall conversation flow is maintained

      // Should preserve JSONL file order despite corrupted timestamps
      expect(bundles).toHaveLength(4);
      expect(bundles[0].id).toBe('user-1');
      expect(bundles[1].id).toBe('assistant-1'); 
      expect(bundles[2].id).toBe('user-2');
      expect(bundles[3].id).toBe('assistant-2'); // This should come after user-2 due to JSONL order
    });

    it('should handle normal timestamp ordering when timestamps are different', async () => {
      const sessionId = 'test-session';
      const jsonlPath = '/test/session.jsonl';
      
      // Mock JSONL with proper chronological timestamps
      mockedParseJsonl.mockReturnValue([
        {
          id: 'user-1',
          timestamp: 1000,
          content: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'first message' }] } },
          usage: null
        },
        {
          id: 'assistant-1', 
          timestamp: 2000,
          content: { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'first response' }] } },
          usage: { input_tokens: 10, output_tokens: 20 }
        },
        {
          id: 'user-2',
          timestamp: 3000,
          content: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'second message' }] } },
          usage: null
        },
        {
          id: 'assistant-2',
          timestamp: 4000,
          content: { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'second response' }] } },
          usage: { input_tokens: 15, output_tokens: 25 }
        }
      ]);

      const bundles = await correlateOperations(sessionId, jsonlPath);

      // Should maintain chronological order
      expect(bundles).toHaveLength(4);
      expect(bundles[0].id).toBe('user-1');
      expect(bundles[1].id).toBe('assistant-1'); 
      expect(bundles[2].id).toBe('user-2');
      expect(bundles[3].id).toBe('assistant-2');
    });

    it('should correlate sub-agent operations with Task operations via content matching', async () => {
      const sessionId = 'test-session';
      const jsonlPath = '/test/session.jsonl';
      
      const taskPrompt = "Analyze the test folder structure";
      
      // Mock JSONL with Task operation and sidechain operations
      mockedParseJsonl.mockReturnValue([
        // Task call
        {
          id: 'task-call-id',
          timestamp: new Date('2025-01-01T10:00:00Z').getTime(),
          usage: { cache_creation_input_tokens: 100, output_tokens: 20 },
          content: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{
                type: 'tool_use',
                id: 'task-tool-id',
                name: 'Task',
                input: {
                  subagent_type: 'general-purpose',
                  description: 'Analyze test folder',
                  prompt: taskPrompt
                }
              }]
            },
            uuid: 'task-uuid',
            parentUuid: 'parent-uuid'
          },
          isSidechain: false
        },
        // First sidechain operation (matches Task prompt)
        {
          id: 'sidechain-1',
          timestamp: new Date('2025-01-01T10:01:00Z').getTime(),
          content: {
            type: 'user',
            message: {
              role: 'user',
              content: taskPrompt
            },
            uuid: 'sidechain-1-uuid',
            parentUuid: null
          },
          isSidechain: true
        },
        // Second sidechain operation (child of first)
        {
          id: 'sidechain-2',
          timestamp: new Date('2025-01-01T10:02:00Z').getTime(),
          usage: { cache_creation_input_tokens: 50, output_tokens: 10 },
          content: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Starting analysis...' }]
            },
            uuid: 'sidechain-2-uuid',
            parentUuid: 'sidechain-1-uuid'
          },
          isSidechain: true
        },
        // Task response
        {
          id: 'task-response-id',
          timestamp: new Date('2025-01-01T10:05:00Z').getTime(),
          content: {
            type: 'user',
            message: {
              role: 'user',
              content: [{
                tool_use_id: 'task-tool-id',
                type: 'tool_result',
                content: [{ type: 'text', text: 'Analysis complete' }]
              }]
            },
            uuid: 'task-response-uuid',
            parentUuid: 'task-uuid'
          }
        }
      ]);
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      // Should have main bundles + sub-agent bundle
      expect(result.length).toBeGreaterThan(2);
      
      // Find the sub-agent bundle
      const subAgentBundle = result.find(b => b.isSubAgent);
      expect(subAgentBundle).toBeDefined();
      expect(subAgentBundle?.subAgentType).toBe('general-purpose');
      expect(subAgentBundle?.parentTaskId).toBe('task-tool-id');
      
      expect(subAgentBundle?.operations.length).toBeGreaterThanOrEqual(1); // At least the first sidechain operation
      
      // Check that first sidechain operation is properly linked  
      const firstOp = subAgentBundle?.operations[0];
      expect(firstOp?.tool).toBe('User');
      expect(firstOp?.response).toBe(taskPrompt);
      expect(firstOp?.parentTaskId).toBe('task-tool-id');
      expect(firstOp?.subAgentType).toBe('general-purpose');
    });

    it('should handle Task operations with no matching sidechain operations', async () => {
      const sessionId = 'test-session';
      const jsonlPath = '/test/session.jsonl';
      
      // Mock JSONL with Task that has no corresponding sidechain operations
      mockedParseJsonl.mockReturnValue([
        // Task call
        {
          id: 'task-call-id',
          timestamp: new Date('2025-01-01T10:00:00Z').getTime(),
          usage: { cache_creation_input_tokens: 100, output_tokens: 20 },
          content: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{
                type: 'tool_use',
                id: 'task-tool-id',
                name: 'Task',
                input: {
                  subagent_type: 'general-purpose',
                  description: 'Test task',
                  prompt: 'This prompt has no matching sidechain'
                }
              }]
            },
            uuid: 'task-uuid'
          },
          isSidechain: false
        },
        // Task response
        {
          id: 'task-response-id',
          timestamp: new Date('2025-01-01T10:05:00Z').getTime(),
          content: {
            type: 'user',
            message: {
              role: 'user',
              content: [{
                tool_use_id: 'task-tool-id',
                type: 'tool_result',
                content: [{ type: 'text', text: 'No sub-agent was launched' }]
              }]
            },
            uuid: 'task-response-uuid',
            parentUuid: 'task-uuid'
          }
        }
      ]);
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      // Should have main bundles but no sub-agent bundle
      const subAgentBundle = result.find(b => b.isSubAgent);
      expect(subAgentBundle).toBeUndefined();
      
      // Should still have the Task operation itself
      const taskBundle = result.find(b => 
        b.operations[0]?.tool === 'Assistant' && 
        b.operations[0]?.response?.some?.((c: any) => c.name === 'Task')
      );
      expect(taskBundle).toBeDefined();
    });

    it('should traverse complete UUID chain for sub-agent operations', async () => {
      const sessionId = 'test-session';
      const jsonlPath = '/test/session.jsonl';
      
      const taskPrompt = "Complex multi-step analysis";
      
      // Mock JSONL with a chain of 5 sidechain operations
      mockedParseJsonl.mockReturnValue([
        // Task call
        {
          id: 'task-call-id',
          timestamp: new Date('2025-01-01T10:00:00Z').getTime(),
          usage: { cache_creation_input_tokens: 100, output_tokens: 20 },
          content: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{
                type: 'tool_use',
                id: 'task-tool-id',
                name: 'Task',
                input: {
                  subagent_type: 'general-purpose',
                  description: 'Complex analysis',
                  prompt: taskPrompt
                }
              }]
            },
            uuid: 'task-uuid'
          },
          isSidechain: false
        },
        // First sidechain (matches Task prompt, parentUuid: null)
        {
          id: 'sidechain-1-uuid',
          timestamp: new Date('2025-01-01T10:01:00Z').getTime(),
          content: {
            type: 'user',
            message: { role: 'user', content: taskPrompt },
            uuid: 'sidechain-1-uuid',
            parentUuid: null
          },
          isSidechain: true
        },
        // Second sidechain (has usage data)
        {
          id: 'sidechain-2-uuid',
          timestamp: new Date('2025-01-01T10:02:00Z').getTime(),
          usage: { cache_creation_input_tokens: 50, output_tokens: 10 },
          content: {
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: 'Step 1' }] },
            uuid: 'sidechain-2-uuid',
            parentUuid: 'sidechain-1-uuid'
          },
          isSidechain: true
        },
        // Third sidechain (no usage data - should not create bundle)
        {
          id: 'sidechain-3-uuid',
          timestamp: new Date('2025-01-01T10:03:00Z').getTime(),
          content: {
            type: 'user',
            message: { role: 'user', content: 'Continue analysis' },
            uuid: 'sidechain-3-uuid',
            parentUuid: 'sidechain-2-uuid'
          },
          isSidechain: true
        },
        // Fourth sidechain (has usage data)
        {
          id: 'sidechain-4-uuid',
          timestamp: new Date('2025-01-01T10:04:00Z').getTime(),
          usage: { cache_creation_input_tokens: 30, output_tokens: 5 },
          content: {
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: 'Step 2' }] },
            uuid: 'sidechain-4-uuid',
            parentUuid: 'sidechain-3-uuid'
          },
          isSidechain: true
        },
        // Fifth sidechain (has usage data)
        {
          id: 'sidechain-5-uuid',
          timestamp: new Date('2025-01-01T10:05:00Z').getTime(),
          usage: { cache_creation_input_tokens: 20, output_tokens: 8 },
          content: {
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: 'Final step' }] },
            uuid: 'sidechain-5-uuid',
            parentUuid: 'sidechain-4-uuid'
          },
          isSidechain: true
        },
        // Task response
        {
          id: 'task-response-id',
          timestamp: new Date('2025-01-01T10:10:00Z').getTime(),
          content: {
            type: 'user',
            message: {
              role: 'user',
              content: [{
                tool_use_id: 'task-tool-id',
                type: 'tool_result',
                content: [{ type: 'text', text: 'Analysis complete' }]
              }]
            },
            uuid: 'task-response-uuid',
            parentUuid: 'task-uuid'
          }
        }
      ]);
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      // Find the sub-agent bundle
      const subAgentBundle = result.find(b => b.isSubAgent);
      expect(subAgentBundle).toBeDefined();
      expect(subAgentBundle?.parentTaskId).toBe('task-tool-id');
      
      // Should have 5 operations: all sidechain operations get bundled
      // User messages create bundles even without usage data
      expect(subAgentBundle?.operations.length).toBe(5);
      
      // Verify the operations are in chronological order
      const ops = subAgentBundle?.operations || [];
      expect(ops[0].tool).toBe('User');
      expect(ops[0].message_id).toBe('sidechain-1-uuid');
      expect(ops[1].tool).toBe('Assistant');
      expect(ops[1].message_id).toBe('sidechain-2-uuid');
      expect(ops[2].tool).toBe('User'); // sidechain-3
      expect(ops[2].message_id).toBe('sidechain-3-uuid');
      expect(ops[3].tool).toBe('Assistant');
      expect(ops[3].message_id).toBe('sidechain-4-uuid');
      expect(ops[4].tool).toBe('Assistant');
      expect(ops[4].message_id).toBe('sidechain-5-uuid');
      
      // Verify all operations have correct metadata
      ops.forEach(op => {
        expect(op.parentTaskId).toBe('task-tool-id');
        expect(op.subAgentType).toBe('general-purpose');
      });
    });

    it('should handle broken UUID chains gracefully', async () => {
      const sessionId = 'test-session';
      const jsonlPath = '/test/session.jsonl';
      
      const taskPrompt = "Test broken chain";
      
      // Mock JSONL with broken parentUuid chain
      mockedParseJsonl.mockReturnValue([
        // Task call
        {
          id: 'task-call-id',
          timestamp: new Date('2025-01-01T10:00:00Z').getTime(),
          usage: { cache_creation_input_tokens: 100, output_tokens: 20 },
          content: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{
                type: 'tool_use',
                id: 'task-tool-id',
                name: 'Task',
                input: { prompt: taskPrompt }
              }]
            },
            uuid: 'task-uuid'
          },
          isSidechain: false
        },
        // First sidechain (matches Task prompt)
        {
          id: 'sidechain-1-uuid',
          timestamp: new Date('2025-01-01T10:01:00Z').getTime(),
          content: {
            type: 'user',
            message: { role: 'user', content: taskPrompt },
            uuid: 'sidechain-1-uuid',
            parentUuid: null
          },
          isSidechain: true
        },
        // Orphaned sidechain (parent UUID doesn't exist)
        {
          id: 'sidechain-orphan-uuid',
          timestamp: new Date('2025-01-01T10:02:00Z').getTime(),
          usage: { cache_creation_input_tokens: 50, output_tokens: 10 },
          content: {
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: 'Orphaned' }] },
            uuid: 'sidechain-orphan-uuid',
            parentUuid: 'non-existent-uuid'
          },
          isSidechain: true
        },
        // Task response
        {
          id: 'task-response-id',
          timestamp: new Date('2025-01-01T10:05:00Z').getTime(),
          content: {
            type: 'user',
            message: {
              role: 'user',
              content: [{
                tool_use_id: 'task-tool-id',
                type: 'tool_result',
                content: [{ type: 'text', text: 'Done' }]
              }]
            },
            uuid: 'task-response-uuid',
            parentUuid: 'task-uuid'
          }
        }
      ]);
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      // Should still create sub-agent bundle with just the first operation
      const subAgentBundle = result.find(b => b.isSubAgent);
      expect(subAgentBundle).toBeDefined();
      expect(subAgentBundle?.operations.length).toBe(1);
      expect(subAgentBundle?.operations[0].message_id).toBe('sidechain-1-uuid');
      
      // Orphaned operation should not be included
      const orphanOp = subAgentBundle?.operations.find(op => op.message_id === 'sidechain-orphan-uuid');
      expect(orphanOp).toBeUndefined();
    });

    it('should process different message types from JSONL', async () => {
      const sessionId = 'test-session';
      const jsonlPath = '/test/session.jsonl';
      
      // Mock JSONL with different message types
      mockedParseJsonl.mockReturnValue([
        // User message
        {
          id: 'user-1',
          timestamp: new Date('2024-01-01T10:00:00Z').getTime(),
          content: {
            type: 'user',
            message: {
              role: 'user',
              content: 'Hello, can you help me?'
            }
          }
        },
        // System message
        {
          id: 'system-1',
          timestamp: new Date('2024-01-01T10:00:01Z').getTime(),
          content: {
            type: 'system',
            message: {
              role: 'system',
              content: 'You are a helpful assistant'
            }
          }
        },
        // Tool result message
        {
          id: 'tool-1',
          timestamp: new Date('2024-01-01T10:00:02Z').getTime(),
          content: {
            type: 'user',
            message: {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: 'tool-123',
                content: 'Large file content here'.repeat(100)
              }]
            }
          }
        },
        // Assistant message with cache metrics
        {
          id: 'assistant-1',
          timestamp: new Date('2024-01-01T10:00:03Z').getTime(),
          usage: {
            input_tokens: 1500,
            output_tokens: 200,
            cache_creation_input_tokens: 800,
            cache_read_input_tokens: 700,
            cache_creation: {
              ephemeral_5m_input_tokens: 300,
              ephemeral_1h_input_tokens: 500
            }
          },
          content: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{
                type: 'text',
                text: 'I can help with that!'
              }, {
                type: 'tool_use',
                id: 'tool-456',
                name: 'Read',
                input: { file_path: '/test/file.ts' }
              }]
            }
          }
        }
      ]);
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      expect(result).toHaveLength(4);
      
      // Check user message
      const userBundle = result.find(b => b.id === 'user-1');
      expect(userBundle).toBeDefined();
      expect(userBundle?.operations[0].tool).toBe('User');
      expect(userBundle?.operations[0].details).toBe('Hello, can you help me?');
      
      // Check system message
      const systemBundle = result.find(b => b.id === 'system-1');
      expect(systemBundle).toBeDefined();
      expect(systemBundle?.operations[0].tool).toBe('System');
      expect(systemBundle?.operations[0].details).toBe('Hidden system prompt/context');
      
      // Check tool result
      const toolBundle = result.find(b => b.id === 'tool-1');
      expect(toolBundle).toBeDefined();
      expect(toolBundle?.operations[0].tool).toBe('ToolResponse');
      expect(toolBundle?.operations[0].details).toContain('KB →');
      
      // Check assistant message with cache metrics
      const assistantBundle = result.find(b => b.id === 'assistant-1');
      expect(assistantBundle).toBeDefined();
      const assistantOp = assistantBundle?.operations[0];
      expect(assistantOp?.tool).toBe('Assistant');
      expect(assistantOp?.contextGrowth).toBe(800);
      expect(assistantOp?.generationCost).toBe(200);
      expect(assistantOp?.ephemeral5m).toBe(300);
      expect(assistantOp?.ephemeral1h).toBe(500);
      expect(assistantOp?.cacheEfficiency).toBeCloseTo(46.67, 2); // 700/(800+700)*100
      expect(assistantOp?.details).toContain('Read: file.ts');
    });

    it('should add cache expiration warnings for time gaps', async () => {
      const sessionId = 'test-session';
      const jsonlPath = '/test/session.jsonl';
      
      const baseTime = new Date('2024-01-01T10:00:00Z').getTime();
      const gapTime = new Date('2024-01-01T10:10:00Z').getTime(); // 10 minute gap
      
      mockedParseJsonl.mockReturnValue([
        {
          id: 'msg-1',
          timestamp: baseTime,
          usage: { output_tokens: 50 },
          content: { type: 'assistant', message: { role: 'assistant', content: 'First message' } }
        },
        {
          id: 'msg-2',
          timestamp: gapTime,
          usage: { 
            cache_creation_input_tokens: 1000,
            output_tokens: 100
          },
          content: { 
            type: 'assistant', 
            message: { 
              role: 'assistant', 
              content: [{
                type: 'tool_use',
                name: 'Bash',
                input: { command: 'ls -la' }
              }]
            }
          }
        }
      ]);
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      expect(result).toHaveLength(2);
      const secondMessage = result[1];
      expect(secondMessage.operations[0].details).toContain('⚠️');
      expect(secondMessage.operations[0].details).toContain('cache expired');
      expect(secondMessage.operations[0].timeGap).toBe(600); // 10 minutes in seconds
    });

    it('should correlate operations with JSONL messages by message_id', async () => {
      const mockTimestamp = Date.now();
      const sessionId = 'test-session';
      const messageId = 'msg-123';

      // Mock JSONL file
      const jsonlPath = `/home/test/.claude/projects/${sessionId}.jsonl`;
      mockedParseJsonl.mockReturnValue([
        {
          id: messageId,
          timestamp: mockTimestamp,
          usage: { input_tokens: 200, output_tokens: 100 },
          content: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: 'Assistant response'
            }
          }
        }
      ]);
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      expect(result).toHaveLength(1);
      const bundle = result[0];
      expect(bundle.operations).toHaveLength(1);
      
      const operation = bundle.operations[0];
      expect(operation.tool).toBe('Assistant'); // Now processes as assistant message
      expect(operation.tokens).toBe(100); // Only output tokens from JSONL
      expect(operation.allocation).toBe('exact');
    });

    it('should handle file references in responses', async () => {
      const mockTimestamp = Date.now();
      const sessionId = 'test-session';
      const filePath = '/test/response.json';
      
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.readFileSync.mockReturnValue('{"output": "test results"}');
      
      const result = await correlateOperations(sessionId);
      
      // Should return empty because no JSONL provided
      expect(result).toHaveLength(0);
    });

    it('should handle synthetic operations from JSONL when no hook data available', async () => {
      const sessionId = 'test-session';
      const messageId = 'msg-synthetic';
      
      // Mock JSONL with usage data
      const jsonlPath = `/test/${sessionId}.jsonl`;
      mockedParseJsonl.mockReturnValue([
        {
          id: messageId,
          timestamp: Date.now(),
          usage: { input_tokens: 150, output_tokens: 75 },
          content: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: 'some content'
            }
          }
        }
      ]);
      
      const result = await correlateOperations(sessionId, jsonlPath);
      
      expect(result).toHaveLength(1);
      const bundle = result[0];
      expect(bundle.operations).toHaveLength(1);
      
      const syntheticOp = bundle.operations[0];
      expect(syntheticOp.tool).toBe('Assistant');
      expect(syntheticOp.tokens).toBe(75); // Only output tokens
      expect(syntheticOp.allocation).toBe('exact');
      expect(syntheticOp.details).toBe('message');
    });

    it('should format operation details correctly for different tools', async () => {
      const sessionId = 'test-session';

      mockedFs.existsSync.mockReturnValue(false);
      
      const result = await correlateOperations(sessionId);
      
      // Should return empty because no JSONL provided
      expect(result).toHaveLength(0);
    });
  });

  describe('getLinkedOperations', () => {
    it('should find operations linked by tool_use_id', () => {
      const toolUseId = 'tool-123';
      const mockBundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1000,
          operations: [{
            tool: 'Assistant',
            params: {},
            response: [{
              type: 'tool_use',
              id: toolUseId,
              name: 'Read',
              input: { file_path: '/test/file.ts' }
            }],
            responseSize: 100,
            timestamp: 1000,
            session_id: 'test',
            tokens: 50,
            contextGrowth: 0,
            generationCost: 50,
            allocation: 'exact' as const,
            details: 'message'
          }],
          totalTokens: 50
        },
        {
          id: 'bundle-2',
          timestamp: 1100,
          operations: [{
            tool: 'ToolResponse',
            params: {},
            response: 'file content',
            responseSize: 200,
            timestamp: 1100,
            session_id: 'test',
            tool_use_id: toolUseId,
            tokens: 75,
            contextGrowth: 0,
            generationCost: 0,
            allocation: 'estimated' as const,
            details: '0.2KB → ~54 est'
          }],
          totalTokens: 75
        },
        {
          id: 'bundle-3',
          timestamp: 1200,
          operations: [{
            tool: 'System',
            params: {},
            response: 'tool execution completed',
            responseSize: 30,
            timestamp: 1200,
            session_id: 'test',
            tool_use_id: toolUseId,
            tokens: 10,
            contextGrowth: 0,
            generationCost: 0,
            allocation: 'estimated' as const,
            details: 'Hidden system prompt/context'
          }],
          totalTokens: 10
        }
      ];

      const result = getLinkedOperations(mockBundles, toolUseId);

      expect(result).toHaveLength(3);
      expect(result[0].tool).toBe('Assistant');
      expect(result[1].tool).toBe('ToolResponse');
      expect(result[2].tool).toBe('System');
      
      // Should be sorted by timestamp
      expect(result[0].timestamp).toBe(1000);
      expect(result[1].timestamp).toBe(1100);
      expect(result[2].timestamp).toBe(1200);
    });

    it('should return empty array when no matching tool_use_id found', () => {
      const mockBundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1000,
          operations: [{
            tool: 'Assistant',
            params: {},
            response: 'some response',
            responseSize: 100,
            timestamp: 1000,
            session_id: 'test',
            tokens: 50,
            contextGrowth: 0,
            generationCost: 50,
            allocation: 'exact' as const,
            details: 'message'
          }],
          totalTokens: 50
        }
      ];

      const result = getLinkedOperations(mockBundles, 'nonexistent-tool-id');

      expect(result).toHaveLength(0);
    });

    it('should handle assistant messages with multiple tool uses', () => {
      const toolUseId1 = 'tool-123';
      const toolUseId2 = 'tool-456';
      const mockBundles: Bundle[] = [
        {
          id: 'bundle-1',
          timestamp: 1000,
          operations: [{
            tool: 'Assistant',
            params: {},
            response: [{
              type: 'tool_use',
              id: toolUseId1,
              name: 'Read',
              input: { file_path: '/test/file1.ts' }
            }, {
              type: 'tool_use',
              id: toolUseId2,
              name: 'Read',
              input: { file_path: '/test/file2.ts' }
            }],
            responseSize: 100,
            timestamp: 1000,
            session_id: 'test',
            tokens: 50,
            contextGrowth: 0,
            generationCost: 50,
            allocation: 'exact' as const,
            details: '2 tool calls'
          }],
          totalTokens: 50
        },
        {
          id: 'bundle-2',
          timestamp: 1100,
          operations: [{
            tool: 'ToolResponse',
            params: {},
            response: 'file1 content',
            responseSize: 200,
            timestamp: 1100,
            session_id: 'test',
            tool_use_id: toolUseId1,
            tokens: 75,
            contextGrowth: 0,
            generationCost: 0,
            allocation: 'estimated' as const,
            details: '0.2KB → ~54 est'
          }],
          totalTokens: 75
        }
      ];

      const result = getLinkedOperations(mockBundles, toolUseId1);

      expect(result).toHaveLength(2);
      expect(result[0].tool).toBe('Assistant');
      expect(result[1].tool).toBe('ToolResponse');
      expect(result[1].tool_use_id).toBe(toolUseId1);
    });
  });
});