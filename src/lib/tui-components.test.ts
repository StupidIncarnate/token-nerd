import { launchTUI } from './tui-components';
import { correlateOperations, getLinkedOperations } from './correlation-engine';

// Mock correlation engine
jest.mock('./correlation-engine', () => ({
  correlateOperations: jest.fn(),
  getLinkedOperations: jest.fn()
}));

// Mock readline
jest.mock('readline', () => ({
  createInterface: jest.fn(() => ({
    close: jest.fn()
  }))
}));

// Mock process.stdin
const originalStdin = process.stdin;
const mockStdin = {
  isTTY: true,
  setRawMode: jest.fn(),
  setEncoding: jest.fn(),
  on: jest.fn(),
  once: jest.fn()
} as any;

const mockedCorrelateOperations = jest.mocked(correlateOperations);

describe('tui-components', () => {
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;
  const originalExit = process.exit;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'clear').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(process.stdout, 'write').mockImplementation();
    jest.useFakeTimers();
    
    // Mock process.exit more robustly
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with "${code}"`);
    }) as any);
    
    // Mock process.stdin
    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      writable: true
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllTimers();
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
    
    // Restore process.stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      writable: true
    });
    
    // Ensure process.exit is properly restored
    process.exit = originalExit;
  });

  describe('TokenAnalyzer', () => {
    // We'll test the internal logic by creating a test-friendly version
    // Since TokenAnalyzer is not exported, we test through launchTUI
    
    it('should handle different bundle sorting modes', async () => {
      const mockBundles = [
        {
          id: 'bundle-1',
          timestamp: 1000,
          operations: [{
            tool: 'Read',
            params: { file_path: '/test/small.ts' },
            response: 'small content',
            responseSize: 100,
            timestamp: 1000,
            session_id: 'test',
            tokens: 25,
            contextGrowth: 25,
            generationCost: 0,
            allocation: 'exact' as const,
            details: 'small.ts'
          }],
          totalTokens: 25
        },
        {
          id: 'bundle-2', 
          timestamp: 2000,
          operations: [{
            tool: 'Write',
            params: { file_path: '/test/large.ts' },
            response: 'large content'.repeat(100),
            responseSize: 1300,
            timestamp: 2000,
            session_id: 'test',
            tokens: 100,
            contextGrowth: 100,
            generationCost: 0,
            allocation: 'exact' as const,
            details: 'large.ts'
          }],
          totalTokens: 100
        }
      ];
      
      mockedCorrelateOperations.mockResolvedValue(mockBundles);
      
      let keyHandler: Function;
      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          keyHandler = callback;
          // Use setTimeout to delay callback and prevent immediate synchronous execution
          setTimeout(() => callback(Buffer.from('q')), 0);
        }
      });
      
      let tuiPromise: Promise<void>;
      
      try {
        tuiPromise = launchTUI('test-session');
        // Run any pending timers to trigger the callback
        jest.runAllTimers();
        await tuiPromise;
      } catch (error) {
        expect((error as Error).message).toBe('process.exit called with "0"');
      }
      
      expect(mockedCorrelateOperations).toHaveBeenCalled();
      expect(mockStdin.on).toHaveBeenCalledWith('data', expect.any(Function));
    });
  });
  
  describe('launchTUI', () => {
    it('should handle empty operations gracefully', async () => {
      mockedCorrelateOperations.mockResolvedValue([]);
      
      // Mock stdin.once to simulate key press (this is what waitForKey uses)
      mockStdin.once.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          // Call immediately - we don't need setTimeout for .once()
          callback();
        }
      });

      try {
        await launchTUI('empty-session');
      } catch (error) {
        // Expected - process.exit is called
        expect((error as Error).message).toBe('process.exit called with "0"');
      }

      expect(mockedCorrelateOperations).toHaveBeenCalledWith('empty-session', undefined);
      expect(consoleSpy).toHaveBeenCalledWith('Loading operations for session empty-se...');
      expect(consoleSpy).toHaveBeenCalledWith('\nNo operations found for session empty-se');
    });

    it('should initialize with operations successfully', async () => {
      const mockBundles = [
        {
          id: 'bundle-1',
          timestamp: Date.now(),
          operations: [
            {
              tool: 'Read',
              params: { file_path: '/test/file.ts' },
              response: 'file content',
              responseSize: 100,
              timestamp: Date.now(),
              session_id: 'test-session',
              tokens: 50,
              generationCost: 0,
              contextGrowth: 50,
              allocation: 'exact' as const,
              details: 'file.ts'
            }
          ],
          totalTokens: 50
        }
      ];

      mockedCorrelateOperations.mockResolvedValue(mockBundles);
      
      // Mock stdin.on to prevent hanging
      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('q')), 0);
        }
      });

      let tuiPromise: Promise<void>;
      
      try {
        tuiPromise = launchTUI('test-session', '/test/session.jsonl');
        jest.runAllTimers();
        await tuiPromise;
      } catch (error) {
        // Expected - process.exit is called
        expect((error as Error).message).toBe('process.exit called with "0"');
      }

      expect(mockedCorrelateOperations).toHaveBeenCalledWith('test-session', '/test/session.jsonl');
      expect(consoleSpy).toHaveBeenCalledWith('Loading operations for session test-ses...');
      expect(mockStdin.setRawMode).toHaveBeenCalledWith(true);
      expect(mockStdin.setEncoding).toHaveBeenCalledWith('utf8');
    });

    it('should pass correct parameters to correlation engine', async () => {
      mockedCorrelateOperations.mockRejectedValue(new Error('test error')); // Force quick exit
      
      try {
        await launchTUI('specific-session', '/path/to/specific.jsonl');
      } catch (error) {
        // Expected
      }
      
      expect(mockedCorrelateOperations).toHaveBeenCalledWith('specific-session', '/path/to/specific.jsonl');
    });

    it('should work without jsonlPath parameter', async () => {
      mockedCorrelateOperations.mockRejectedValue(new Error('test error')); // Force quick exit
      
      try {
        await launchTUI('session-without-jsonl');
      } catch (error) {
        // Expected
      }
      
      expect(mockedCorrelateOperations).toHaveBeenCalledWith('session-without-jsonl', undefined);
    });
    
    it('should handle large datasets with pagination', async () => {
      // Create 25 bundles to test pagination (page size is 20)
      const mockBundles = Array.from({ length: 25 }, (_, i) => ({
        id: `bundle-${i}`,
        timestamp: 1000 + i,
        operations: [{
          tool: 'Read',
          params: { file_path: `/test/file${i}.ts` },
          response: `content ${i}`,
          responseSize: 100,
          timestamp: 1000 + i,
          session_id: 'test',
          tokens: 25,
          contextGrowth: 25,
          generationCost: 0,
          allocation: 'exact' as const,
          details: `file${i}.ts`
        }],
        totalTokens: 25
      }));
      
      mockedCorrelateOperations.mockResolvedValue(mockBundles);
      
      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('q')), 0);
        }
      });
      
      let tuiPromise: Promise<void>;
      
      try {
        tuiPromise = launchTUI('large-session');
        jest.runAllTimers();
        await tuiPromise;
      } catch (error) {
        expect((error as Error).message).toBe('process.exit called with "0"');
      }
      
      // Should display pagination info in console output
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Page 1/2'));
    });

    it('should handle ToolResponse bundles in hierarchical display', async () => {
      const mockBundles = [
        {
          id: 'assistant-1',
          timestamp: 1000,
          operations: [{
            tool: 'Assistant',
            params: {},
            response: [{
              type: 'tool_use',
              id: 'tool-123',
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
            details: 'Read: file.ts'
          }],
          totalTokens: 50
        },
        {
          id: 'tool-response-1',
          timestamp: 1100,
          operations: [{
            tool: 'ToolResponse',
            params: {},
            response: 'file content here',
            responseSize: 1000,
            timestamp: 1100,
            session_id: 'test',
            tool_use_id: 'tool-123',
            tokens: 270,
            contextGrowth: 0,
            generationCost: 0,
            allocation: 'estimated' as const,
            details: '1.0KB → ~270 est'
          }],
          totalTokens: 270
        }
      ];
      
      mockedCorrelateOperations.mockResolvedValue(mockBundles);
      
      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('q')), 0);
        }
      });
      
      try {
        const tuiPromise = launchTUI('test-session');
        jest.runAllTimers();
        await tuiPromise;
      } catch (error) {
        expect((error as Error).message).toBe('process.exit called with "0"');
      }
      
      // Should show the assistant message and the child ToolResponse
      // The TUI should group these together hierarchically
      expect(mockedCorrelateOperations).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Read: file.ts'));
    });

    it('should display context window changes correctly', async () => {
      const mockBundles = [
        {
          id: 'bundle-1',
          timestamp: 1000,
          operations: [{
            tool: 'User',
            params: {},
            response: 'Hello',
            responseSize: 20,
            timestamp: 1000,
            session_id: 'test',
            tokens: 5,
            contextGrowth: 0,
            generationCost: 0,
            allocation: 'estimated' as const,
            details: 'Hello'
          }],
          totalTokens: 5
        },
        {
          id: 'bundle-2',
          timestamp: 2000,
          operations: [{
            tool: 'Assistant',
            params: {},
            response: 'Hi there!',
            responseSize: 50,
            timestamp: 2000,
            session_id: 'test',
            tokens: 100,
            contextGrowth: 80,
            generationCost: 20,
            allocation: 'exact' as const,
            details: 'message',
            usage: {
              input_tokens: 25,
              output_tokens: 20,
              cache_creation_input_tokens: 80
            }
          }],
          totalTokens: 100
        }
      ];
      
      mockedCorrelateOperations.mockResolvedValue(mockBundles);
      
      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('q')), 0);
        }
      });
      
      try {
        const tuiPromise = launchTUI('test-session');
        jest.runAllTimers();
        await tuiPromise;
      } catch (error) {
        expect((error as Error).message).toBe('process.exit called with "0"');
      }
      
      // Should show context deltas and totals with running total calculation
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Total:'));
      expect(mockedCorrelateOperations).toHaveBeenCalled();
    });

    it('should handle child item indentation in display', async () => {
      const mockBundles = [
        {
          id: 'bundle-1',
          timestamp: 1000,
          operations: [{
            tool: 'Assistant',
            params: {},
            response: [{
              type: 'tool_use',
              id: 'tool-123',
              name: 'Bash',
              input: { command: 'ls -la' }
            }, {
              type: 'tool_use', 
              id: 'tool-456',
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
            details: '2 tool calls'
          }],
          totalTokens: 50
        }
      ];
      
      mockedCorrelateOperations.mockResolvedValue(mockBundles);
      
      mockStdin.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('q')), 0);
        }
      });
      
      try {
        const tuiPromise = launchTUI('test-session');
        jest.runAllTimers();
        await tuiPromise;
      } catch (error) {
        expect((error as Error).message).toBe('process.exit called with "0"');
      }
      
      // Should display the bundle with multiple tool calls
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('2 tool calls'));
    });
  });
});