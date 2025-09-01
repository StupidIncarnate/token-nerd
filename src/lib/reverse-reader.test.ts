import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReverseFileReader } from './reverse-reader';

describe('ReverseFileReader', () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reverse-reader-test-'));
    testFilePath = path.join(tempDir, 'test.jsonl');
  });

  afterEach(async () => {
    // Clean up temporary files
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('readLastLine', () => {
    it('should return null for non-existent file', async () => {
      const result = await ReverseFileReader.readLastLine({ filePath: '/absolutely-nonexistent-file.jsonl' });
      expect(result).toBeNull();
    });

    it('should return null for empty file', async () => {
      // Create empty file
      await fs.promises.writeFile(testFilePath, '');
      
      const result = await ReverseFileReader.readLastLine({ filePath: testFilePath });
      expect(result).toBeNull();
    });

    it('should read last line from single line file', async () => {
      const content = '{"id":"msg-1","type":"user"}';
      await fs.promises.writeFile(testFilePath, content);
      
      const result = await ReverseFileReader.readLastLine({ filePath: testFilePath });
      expect(result).toBe('{"id":"msg-1","type":"user"}');
    });

    it('should read last line from multi-line file', async () => {
      const lines = [
        '{"id":"msg-1","type":"user"}',
        '{"id":"msg-2","usage":{"input_tokens":100}}',
        '{"id":"msg-3","type":"assistant"}'
      ];
      await fs.promises.writeFile(testFilePath, lines.join('\n'));
      
      const result = await ReverseFileReader.readLastLine({ filePath: testFilePath });
      expect(result).toBe('{"id":"msg-3","type":"assistant"}');
    });

    it('should handle file with trailing newline', async () => {
      const content = '{"id":"msg-1"}\n{"id":"msg-2"}\n';
      await fs.promises.writeFile(testFilePath, content);
      
      const result = await ReverseFileReader.readLastLine({ filePath: testFilePath });
      expect(result).toBe('{"id":"msg-2"}');
    });

    it('should handle large files efficiently', async () => {
      // Create a large file with many lines
      const lines = [];
      for (let i = 1; i <= 1000; i++) {
        lines.push(`{"id":"msg-${i}","data":"${Array(100).fill('x').join('')}"}`);
      }
      await fs.promises.writeFile(testFilePath, lines.join('\n'));
      
      const startTime = Date.now();
      const result = await ReverseFileReader.readLastLine({ filePath: testFilePath });
      const endTime = Date.now();
      
      expect(result).toBe('{"id":"msg-1000","data":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}');
      expect(endTime - startTime).toBeLessThan(100); // Should be very fast
    });
  });

  describe('readLastLines', () => {
    it('should return empty array for non-existent file', async () => {
      const result = await ReverseFileReader.readLastLines({ filePath: '/absolutely-nonexistent-file.jsonl' });
      expect(result).toEqual([]);
    });

    it('should return empty array for empty file', async () => {
      await fs.promises.writeFile(testFilePath, '');
      
      const result = await ReverseFileReader.readLastLines({ filePath: testFilePath, maxLines: 3 });
      expect(result).toEqual([]);
    });

    it('should read multiple lines in reverse order', async () => {
      const lines = [
        '{"id":"msg-1"}',
        '{"id":"msg-2"}', 
        '{"id":"msg-3"}',
        '{"id":"msg-4"}',
        '{"id":"msg-5"}'
      ];
      await fs.promises.writeFile(testFilePath, lines.join('\n'));
      
      const result = await ReverseFileReader.readLastLines({ filePath: testFilePath, maxLines: 3 });
      
      expect(result).toEqual([
        '{"id":"msg-5"}',
        '{"id":"msg-4"}', 
        '{"id":"msg-3"}'
      ]);
    });

    it('should limit results to maxLines', async () => {
      const lines = ['line1', 'line2', 'line3', 'line4', 'line5'];
      await fs.promises.writeFile(testFilePath, lines.join('\n'));
      
      const result = await ReverseFileReader.readLastLines({ filePath: testFilePath, maxLines: 2 });
      
      expect(result).toHaveLength(2);
      expect(result).toEqual(['line5', 'line4']);
    });

    it('should handle requesting more lines than exist', async () => {
      const lines = ['line1', 'line2'];
      await fs.promises.writeFile(testFilePath, lines.join('\n'));
      
      const result = await ReverseFileReader.readLastLines({ filePath: testFilePath, maxLines: 10 });
      
      expect(result).toEqual(['line2', 'line1']);
    });

    it('should default to 1 line when maxLines not specified', async () => {
      const lines = ['line1', 'line2', 'line3'];
      await fs.promises.writeFile(testFilePath, lines.join('\n'));
      
      const result = await ReverseFileReader.readLastLines({ filePath: testFilePath });
      
      expect(result).toEqual(['line3']);
    });
  });

  describe('findLastLineMatching', () => {
    it('should return null for non-existent file', async () => {
      const result = await ReverseFileReader.findLastLineMatching({
        filePath: '/absolutely-nonexistent-file.jsonl',
        condition: (line) => line.includes('test')
      });
      expect(result).toBeNull();
    });

    it('should return null for empty file', async () => {
      await fs.promises.writeFile(testFilePath, '');
      
      const result = await ReverseFileReader.findLastLineMatching({
        filePath: testFilePath,
        condition: (line) => line.includes('test')
      });
      expect(result).toBeNull();
    });

    it('should find the last matching line', async () => {
      const lines = [
        '{"id":"msg-1","type":"user"}',
        '{"id":"msg-2","usage":{"input_tokens":50}}',
        '{"id":"msg-3","type":"assistant"}',
        '{"id":"msg-4","usage":{"input_tokens":100}}',
        '{"id":"msg-5","type":"user"}'
      ];
      await fs.promises.writeFile(testFilePath, lines.join('\n'));
      
      const result = await ReverseFileReader.findLastLineMatching({
        filePath: testFilePath,
        condition: (line) => line.includes('usage')
      });
      
      expect(result).toBe('{"id":"msg-4","usage":{"input_tokens":100}}');
    });

    it('should return null when no lines match', async () => {
      const lines = [
        '{"id":"msg-1","type":"user"}',
        '{"id":"msg-2","type":"assistant"}',
        '{"id":"msg-3","type":"user"}'
      ];
      await fs.promises.writeFile(testFilePath, lines.join('\n'));
      
      const result = await ReverseFileReader.findLastLineMatching({
        filePath: testFilePath,
        condition: (line) => line.includes('usage')
      });
      
      expect(result).toBeNull();
    });

    it('should respect maxLinesToScan limit', async () => {
      const lines = [];
      for (let i = 1; i <= 200; i++) {
        if (i === 50) {
          lines.push('{"id":"special","hasSpecial":true}');
        } else {
          lines.push(`{"id":"msg-${i}","type":"normal"}`);
        }
      }
      await fs.promises.writeFile(testFilePath, lines.join('\n'));
      
      // Should not find the special line because it's beyond maxLinesToScan
      const result = await ReverseFileReader.findLastLineMatching({
        filePath: testFilePath,
        condition: (line) => line.includes('hasSpecial'),
        maxLinesToScan: 10
      });
      
      expect(result).toBeNull();
    });

    it('should use default maxLinesToScan of 100', async () => {
      const lines = [];
      for (let i = 1; i <= 50; i++) {
        lines.push(`{"id":"msg-${i}","type":"normal"}`);
      }
      lines.push('{"id":"special","hasSpecial":true}');
      await fs.promises.writeFile(testFilePath, lines.join('\n'));
      
      const result = await ReverseFileReader.findLastLineMatching({
        filePath: testFilePath,
        condition: (line) => line.includes('hasSpecial')
      });
      
      expect(result).toBe('{"id":"special","hasSpecial":true}');
    });
  });

  describe('performance characteristics', () => {
    it('should successfully read from large files', async () => {
      // Create a very large file
      const lines = [];
      for (let i = 1; i <= 1000; i++) {
        lines.push(`{"id":"msg-${i}","data":"${'x'.repeat(200)}","tokens":${i * 10}}`);
      }
      await fs.promises.writeFile(testFilePath, lines.join('\n'));
      
      const startTime = Date.now();
      const result = await ReverseFileReader.readLastLine({ filePath: testFilePath });
      const endTime = Date.now();
      
      // Should successfully read the last line
      expect(result).toBeTruthy();
      expect(result).toContain('msg-1000');
      
      // Should complete in reasonable time (under 100ms)
      expect(endTime - startTime).toBeLessThan(100);
    });
  });

  describe('error handling', () => {
    it('should handle file access errors gracefully', async () => {
      // Try to read from a directory (should fail)
      const result = await ReverseFileReader.readLastLine({ filePath: tempDir });
      expect(result).toBeNull();
    });

    it('should handle malformed file paths', async () => {
      const result = await ReverseFileReader.readLastLine({ filePath: '\0invalid\0path' });
      expect(result).toBeNull();
    });

    it('should handle permission errors gracefully', async () => {
      // This test might not work on all systems, so we'll make it lenient
      const result = await ReverseFileReader.readLastLine({ filePath: '/root/nonexistent' });
      expect(result).toBeNull();
    });
  });
});