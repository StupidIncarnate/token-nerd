import { launchTUI } from './tui-components';
import { correlateOperations } from './correlation-engine';

// Mock correlation engine
jest.mock('./correlation-engine', () => ({
  correlateOperations: jest.fn()
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

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'clear').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(process.stdout, 'write').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error('process.exit called');
    }) as any);
    
    // Mock process.stdin
    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      writable: true
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
    
    // Restore process.stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      writable: true
    });
  });

  describe('launchTUI', () => {
    it('should handle empty operations gracefully', async () => {
      mockedCorrelateOperations.mockResolvedValue([]);
      
      // Mock stdin.once to simulate immediate key press
      mockStdin.once.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('q')), 0);
        }
      });

      try {
        await launchTUI('empty-session');
      } catch (error) {
        // Expected - process.exit is called
        expect((error as Error).message).toBe('process.exit called');
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
          // Simulate 'q' key press after a short delay
          setTimeout(() => callback(Buffer.from('q')), 10);
        }
      });

      try {
        await launchTUI('test-session', '/test/session.jsonl');
      } catch (error) {
        // Expected - process.exit is called
        expect((error as Error).message).toBe('process.exit called');
      }

      expect(mockedCorrelateOperations).toHaveBeenCalledWith('test-session', '/test/session.jsonl');
      expect(consoleSpy).toHaveBeenCalledWith('Loading operations for session test-ses...');
      expect(mockStdin.setRawMode).toHaveBeenCalledWith(true);
      expect(mockStdin.setEncoding).toHaveBeenCalledWith('utf8');
    });

    it('should handle correlation errors gracefully', async () => {
      mockedCorrelateOperations.mockRejectedValue(new Error('Redis connection failed'));
      
      try {
        await launchTUI('error-session');
      } catch (error) {
        // Expected - process.exit is called
        expect((error as Error).message).toBe('process.exit called');
      }

      expect(console.error).toHaveBeenCalledWith('Failed to load operations:', expect.any(Error));
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
  });
});